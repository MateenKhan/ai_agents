// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — the orchestrator (the brain)
// Routes tasks through plan → build → qa → merge, tiers models per role, isolates
// work in worktrees, and keeps the whole thing alive unattended: circuit breaker
// (API outages), watchdog + stall detector, resource gate, backoff/dead-letter,
// orphan cleanup, heartbeat. Single writer — only this process merges.
// ─────────────────────────────────────────────────────────────────────────────

import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { appendFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, spawn } from 'node:child_process';

/** The git repo a task's merge/ancestry checks run in. Project-scoped: a task in a
 *  project with a valid repoPath uses THAT repo; anything else → the host cwd (so the
 *  default single-project flow is byte-for-byte unchanged). Mirrors runner.projectRootFor. */
async function repoCwdFor(taskId: string): Promise<string> {
  try {
    const tk = await getTask(taskId);
    // Honor a configured repoPath for ANY project, including 'default' (its seeded repoPath is
    // the host cwd, so normal installs are unchanged). Keeps merge/ancestry checks in the SAME
    // repo the runner builds worktrees in, and matches the index's projectRepoPath resolution.
    const proj = await getProject(tk?.projectId || 'default');
    if (proj?.repoPath && existsSync(proj.repoPath)) return proj.repoPath;
  } catch { /* missing project/db → host cwd */ }
  return process.cwd();
}

/** True if the task's branch is already merged into the current HEAD (in its project repo). */
async function isMergedIntoHead(taskId: string): Promise<boolean> {
  try { execSync(`git merge-base --is-ancestor task/${taskId} HEAD`, { stdio: 'pipe', cwd: await repoCwdFor(taskId) }); return true; }
  catch { return false; }
}

/** Current branch name in a task's project repo (for readable "Merging into <branch>"). */
async function currentBranch(taskId: string): Promise<string> {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { stdio: 'pipe', cwd: await repoCwdFor(taskId) }).toString().trim() || 'HEAD'; }
  catch { return 'HEAD'; }
}

/** After a merge lands, drop context-memory entries whose file no longer exists on disk —
 *  the merged work may have deleted/renamed files. This is the AUTOMATIC sync point: every
 *  merge keeps the Context panel truthful without a manual Sweep. Keyed on the same
 *  `projectId || 'default'` the API/agents use so it matches the stored rows. Best-effort —
 *  a git/db hiccup here must never taint a completed merge. */
async function reconcileContextAfterMerge(taskId: string): Promise<void> {
  try {
    const pid = (await getTask(taskId))?.projectId || 'default';
    const removed = await reconcileContext(pid, listRepoFiles(await repoCwdFor(taskId)));
    if (removed.length) log(taskId, `🧹 context: dropped ${removed.length} file(s) deleted by the merge`, 'info');
  } catch { /* context reconcile is best-effort — never block a merge */ }
}
import type { AgenticConfig, AgentConfig, AgentRole, Task, FailureKind, QaVerdict, RunResult, JournalEntry } from '../types';
import { setConfig, getConfig } from '../runtime-context';
import {
  getAllTasks, getTask, updateTask, getBoardSettings, updateBoardSettings, beatHeartbeat, getTasksDb, getProject, listProjects, getAgentDefaults,
  WORKER_ID, registerWorker, heartbeatWorker, listStaleWorkers, claimTask, acquireLock, releaseLock,
  getSystemState, setSystemState,
} from '../db/tasks';
import { isPostgres } from '../db/getStore';
import { addAgentLog, getLogsDb } from '../db/logs';
import { getAgents } from '../db/agents';
import { renderPrompt } from './prompts';
// Routing is graph-driven. Stage names mean nothing to the engine; `behaviour` grants every
// special power, and an agent reports an OUTCOME rather than naming a destination.
import { loadWorkflow } from '../workflow/store';
import {
  placeTask, routeOutcome, routeReject, nearestHumanGate, allowedOutcomes, reconcileVerdict,
  mayWriteVerdict, takesMergeLock, worktreeFor as worktreeForStage, modelFor as modelForStage, capsFor,
  stageById, canConsult, consultsUsed,
} from '../workflow/route';
import type { Stage as WfStage, WorkflowDoc } from '../workflow/types';
import {
  spawnHeadlessAgent, isAgentBusy, isTaskRunning, agentIdleMs, killAgent,
  removeWorktree, removePlanWorktree, pruneOrphans, pruneOrphansAll, isGitRepo,
} from './runner';
import { reconcileContext } from '../db/context';
import { listRepoFiles } from './repo-files';
import { redactSecrets } from '../redact';

const POLL_MS = 3000;
// Deep-cleaner cadence: sweep orphan worktrees/branches across EVERY project repo (not just
// the host) every ~30 min. The cheap host-only sweep still runs every ~30s in the loop.
const CLEANER_EVERY_TICKS = Math.max(1, Math.round((30 * 60 * 1000) / POLL_MS));
// Agent slots are just identities — concurrency is bound by the resource gate below,
// not by this count. Provide plenty (env AGENT_POOL=csv to name them, or AGENT_POOL_SIZE=n).
const AGENT_POOL = (() => {
  if (process.env.AGENT_POOL) return process.env.AGENT_POOL.split(',').map(s => s.trim()).filter(Boolean);
  const n = Math.max(1, parseInt(process.env.AGENT_POOL_SIZE || '') || 32);
  return Array.from({ length: n }, (_, i) => `agent-${i + 1}`);
})();
const DEAD_LETTER_AT = '9999-01-01T00:00:00.000Z';

const agentTaskMap = new Map<string, string>(); // agentName → taskId
// taskId → projectId, refreshed every tick from allTasks(). Log rows are project-scoped, and
// log() is on the hot path, so the project is read from here rather than from tasks.db per line.
const taskProjects = new Map<string, string>();
const sysLogFile = () => join(getConfig().paths.logsDir, 'orchestrator.log');
const log = (taskId: string, msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
  const line = `[${new Date().toISOString()}] ${taskId === '__system__' ? '' : `[${taskId}] `}${msg}`;
  try { console.log('[ai]', line); } catch { /* stdout closed */ }
  // addAgentLog is async: a sync try/catch would NOT catch its rejection, so a transient
  // logs.db lock would surface as an unhandled rejection (fatal on modern Node). Swallow it
  // on the promise itself — logging is best-effort and must never take the orchestrator down.
  // '__system__' lines belong to the engine, not to a project, and stay unscoped.
  const write = (pid: string | null) => addAgentLog(taskId, msg, type, pid).catch(() => { /* logs.db busy */ });
  const known = taskProjects.get(taskId);
  if (known !== undefined || taskId === '__system__') write(known ?? null);
  else {
    // A task logged before the first allTasks() tick (e.g. created and dispatched in the same
    // moment) is not in the map yet. Resolve it once, off the hot path, and memoise.
    getTask(taskId)
      .then(t => { const pid = t?.projectId || null; if (pid) taskProjects.set(taskId, pid); return write(pid); })
      .catch(() => write(null));
  }
  try { appendFileSync(sysLogFile(), line + '\n'); } catch { /* disk */ }
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── always-on human-readable status ────────────────────────────────────────────
// A plain-English line describing what the orchestrator is doing RIGHT NOW, surfaced
// to the UI via the heartbeat. Meaningful transitions call setStatus(line, true) to
// beat immediately; the loop recomputes a steady-state line and beats it every few ticks.
let statusLine = 'Starting up…';
function setStatus(line: string, beat = false): void {
  statusLine = line;
  // beatHeartbeat is async — swallow on the promise (a sync catch misses the rejection).
  if (beat) beatHeartbeat({ statusLine }).catch(() => { /* logs busy */ });
}

// ── config-derived knobs ───────────────────────────────────────────────────────
const t = () => getConfig().toggles || {};
const leaseMs = () => t().taskLeaseMs ?? 15 * 60 * 1000;
const maxAttempts = () => t().maxAttempts ?? 3;
const stallMs = () => t().agentStallMs ?? 8 * 60 * 1000;
// Hard wall-clock cap per agent run: a task taking this long is pathological (looping).
const maxRunMs = () => t().maxTaskRunMs ?? 30 * 60 * 1000;

// ── circuit breaker ────────────────────────────────────────────────────────────
const breaker = { state: 'closed' as 'closed' | 'open', failures: 0 };
let probing = false;

function breakerFailure(kind: FailureKind): void {
  if (kind !== 'network') return; // crashes are task-specific, not an outage
  breaker.failures++;
  if (breaker.failures >= 3 && breaker.state === 'closed') {
    breaker.state = 'open';
    log('__system__', '⛔ circuit OPEN — API unreachable, pausing dispatch and probing', 'warning');
    setStatus('⛔ Anthropic API unreachable — dispatch paused, retrying every 15s', true);
    startProbe();
  }
}
function breakerSuccess(): void { breaker.failures = 0; breaker.state = 'closed'; }
function breakerAllows(): boolean { return breaker.state !== 'open'; }

function probeApi(): Promise<boolean> {
  return new Promise(res => {
    const req = https.get('https://api.anthropic.com/', r => { r.destroy(); res(true); });
    req.on('error', () => res(false));
    req.setTimeout(8000, () => { req.destroy(); res(false); });
  });
}
function startProbe(): void {
  if (probing) return;
  probing = true;
  const tick = () => probeApi().then(ok => {
    if (ok) { breaker.state = 'closed'; breaker.failures = 0; probing = false; log('__system__', '✅ circuit CLOSED — API reachable, resuming', 'success'); }
    else setTimeout(tick, 15000);
  });
  tick();
}

// ── db-server (6952) breaker ─────────────────────────────────────────────────────
// The orchestrator writes SQLite DIRECTLY, so it survives a db-server crash — but the
// AGENTS (separate processes in worktrees) need HTTP 6952 to advance their stage and to
// query the code index. If that daemon is down, an agent that finished its work looks like
// it "exited without advancing" — an INFRA fault, not the agent's fault. When we detect it,
// we pause dispatch, heal the daemon (Layer 1 restarts it; we also spawn as a fallback), and
// auto-resume the SAME stage once it's back — without burning the task's retry budget.
const DB_PORT = parseInt(process.env.DB_SERVER_PORT || '6952', 10);
const DB_HEALTH_URL = `http://127.0.0.1:${DB_PORT}/health`;
const dbBreaker = { state: 'closed' as 'closed' | 'open' };
let dbProbing = false;
let lastDbSpawnAt = 0;

/** True when SOMETHING is already listening on `port` (even if it isn't answering /health
 *  yet — e.g. a db-server that is still booting, or one a process supervisor just restarted). */
function portInUse(port: number): Promise<boolean> {
  return new Promise(res => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v: boolean) => { try { sock.destroy(); } catch { /* closed */ } res(v); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(1500, () => done(false));
  });
}

function probeDbServer(): Promise<boolean> {
  return new Promise(res => {
    const req = http.get(DB_HEALTH_URL, r => { r.resume(); res((r.statusCode ?? 0) >= 200 && (r.statusCode ?? 0) < 500); });
    req.on('error', () => res(false));
    req.setTimeout(2500, () => { req.destroy(); res(false); });
  });
}
function dbBreakerAllows(): boolean { return dbBreaker.state !== 'open'; }

/** Fallback heal (Layer 2b): spawn a fresh db-server ONLY when nothing at all is listening.
 *  A duplicate does NOT "lose the port race harmlessly" — it dies with EADDRINUSE, which can
 *  push the process supervisor (concurrently --restart-tries) into a restart loop as the two
 *  healers fight. So we gate on portInUse() and rate-limit to one attempt per ~30s. */
async function trySpawnDbServer(): Promise<void> {
  if (Date.now() - lastDbSpawnAt < 30000) return; // one attempt per ~30s
  // NEVER spawn while something already holds the port. A process supervisor (the `agents`
  // script runs concurrently with --restart-tries) also resurrects the db-server, and a
  // booting server binds the port before it answers /health. Spawning here anyway starts a
  // SECOND db-server that loses the bind, dies with EADDRINUSE, and can push the supervisor
  // into a restart loop — the two healers fight each other. Only step in when nothing is
  // listening at all; otherwise just keep probing and let it finish coming up.
  if (await portInUse(DB_PORT)) return;
  lastDbSpawnAt = Date.now();
  try {
    log('__system__', '🩹 nothing listening on the db port — spawning a fresh db-server (fallback heal)…', 'warning');
    const child = spawn('pnpm run db:server:stable', {
      cwd: process.cwd(), env: { ...process.env }, detached: true, stdio: 'ignore', shell: true,
    });
    child.unref();
  } catch (e: any) { log('__system__', `db-server spawn failed: ${e?.message || e}`, 'error'); }
}

function openDbBreaker(reason: string): void {
  if (dbBreaker.state === 'open') return;
  dbBreaker.state = 'open';
  log('__system__', `⛔ db-server (6952) unreachable — pausing dispatch and healing (${reason})`, 'warning');
  setStatus('⛔ db-server offline — healing, dispatch paused', true);
  startDbProbe();
}
function startDbProbe(): void {
  if (dbProbing) return;
  dbProbing = true;
  let fails = 0;
  const tick = () => probeDbServer().then(ok => {
    if (ok) {
      dbBreaker.state = 'closed'; dbProbing = false;
      log('__system__', '✅ db-server reachable again — resuming; tasks paused by the outage will retry their stage', 'success');
      return;
    }
    // give Layer-1's supervisor a beat, then spawn as fallback (only if the port is truly free).
    // trySpawnDbServer is async now — swallow on the promise so a failure can't become an
    // unhandled rejection inside this probe loop.
    if (++fails >= 2) trySpawnDbServer().catch(() => { /* fallback heal is best-effort */ });
    setTimeout(tick, 5000);
  });
  tick();
}

// ── plan-limit pause ─────────────────────────────────────────────────────────────
// When `claude -p` fails because the user's Claude PLAN usage window is exhausted, the
// failure says nothing about the task and nothing transient about the network: every
// agent dispatched before the window resets fails the same way, burning attempts. So the
// WHOLE swarm pauses. The resume time is persisted in system_state ('limitPausedUntil'),
// which is what makes a restart during the pause stay paused — the dispatch gate reads
// the durable value, so the boot path needs no special handling.
const LIMIT_PAUSE_KEY = 'limitPausedUntil';
// The CLI's limit message usually carries the reset epoch; when it doesn't, wait this long.
const LIMIT_PAUSE_DEFAULT_MS = 30 * 60 * 1000;
let limitPausedUntilMs: number | null = null; // in-memory mirror of the persisted value
let limitPauseAnnounced = false;              // so entering the pause logs exactly once

/** Pause the swarm for a 'limit' run result and put the task back in the pool untouched:
 *  the attempt dispatch() spent is refunded, nothing dead-letters, and the circuit breaker
 *  is not fed — a shut usage window is neither the task's fault nor an API outage. */
async function pauseForLimit(task: Task, r: RunResult): Promise<void> {
  // 1–3 min of jitter past the reset, so a fleet sharing one plan doesn't slam the API
  // in the same second the window opens.
  const jitter = 60_000 + Math.floor(Math.random() * 120_000);
  const base = r.resetAt ? Date.parse(r.resetAt) : NaN;
  const until = (Number.isFinite(base) ? base : Date.now() + LIMIT_PAUSE_DEFAULT_MS) + jitter;
  const iso = new Date(until).toISOString();
  await setSystemState(LIMIT_PAUSE_KEY, iso);
  limitPausedUntilMs = until;
  limitPauseAnnounced = true; // this IS the entering-the-pause announcement
  await updateTask(task.id, {
    started: null, claimedBy: null, leaseExpiresAt: null,
    attempts: Math.max(0, (task.attempts || 1) - 1), // refund — the run never got to work
    nextRetryAt: iso, lastError: 'plan usage limit reached — swarm paused until the window resets',
  });
  log(task.id, `⏸ plan limit reached — swarm paused until ${iso}`, 'warning');
  setStatus(`⏸ plan limit reached — swarm paused until ${iso}`, true);
}

/** The dispatch gate: true while the persisted pause is in force. Reads the durable value
 *  once per call (dispatchPending runs once per loop tick, which already does DB reads), so
 *  a pause set by a previous process — or by another worker sharing the DB — is honoured.
 *  Clears the value and logs the resume exactly once when the window passes. */
async function limitPauseActive(): Promise<boolean> {
  const iso = await getSystemState(LIMIT_PAUSE_KEY);
  if (!iso) { limitPausedUntilMs = null; limitPauseAnnounced = false; return false; }
  const until = Date.parse(iso);
  if (Number.isFinite(until) && until > Date.now()) {
    if (!limitPauseAnnounced || limitPausedUntilMs !== until) {
      log('__system__', `⏸ plan limit reached — swarm paused until ${iso}`, 'warning');
      setStatus(`⏸ plan limit reached — swarm paused until ${iso}`, true);
    }
    limitPausedUntilMs = until;
    limitPauseAnnounced = true;
    return true;
  }
  // The window passed (or the stored value is garbage) — clear it and resume.
  await setSystemState(LIMIT_PAUSE_KEY, null);
  limitPausedUntilMs = null;
  limitPauseAnnounced = false;
  log('__system__', '▶ limit window over — resuming dispatch', 'success');
  return false;
}

// How many times a task may be escalated to the architect for a re-plan before it
// dead-letters to BLOCKED (env RESCUE_MAX, default 1 — one re-plan then human).
const MAX_RESCUE = Math.max(0, parseInt(process.env.RESCUE_MAX || '') || 1);

// ── what a failure MEANS ───────────────────────────────────────────────────────
/** An infrastructure failure says nothing about the task. The API (or the DB) was
 *  unreachable, so no agent ever got to judge the work. `timeout`/`stall`/`crash` are
 *  task-specific — the agent ran and misbehaved — and those DO consume the budget. */
export function isInfraFailure(kind: FailureKind): boolean { return kind === 'network'; }

/** What to do about a failed run. Pure, so the policy can be tested without a live agent —
 *  which matters because the expensive mistakes here are silent: escalating an outage to an
 *  opus architect, or dead-lettering work that was never actually evaluated. */
export type FailureAction = 'retry' | 'infra-wait' | 'escalate' | 'human-review' | 'dead-letter';

export function decideFailure(a: {
  failure: FailureKind;
  attempts: number;
  maxAttempts: number;
  /** Escalations already spent from this stage. */
  rescuesUsed: number;
  /** `caps.rescues` for this stage. */
  maxRescues: number;
  /** The stage declares a `blocked` outcome, so it has somewhere to escalate to. */
  hasBlockedOutcome: boolean;
  /** A human gate is reachable from here. */
  hasHumanGate: boolean;
  /** A verify stage has already passed this work. */
  qaPassed: boolean;
}): FailureAction {
  // FIRST, before the budget is even consulted. The Anthropic API being down is not a fact
  // about this task: the circuit breaker opens on the 3rd network failure and maxAttempts is
  // also 3, so an outage used to exhaust the budget on the very tick the breaker tripped —
  // waking an opus architect to "re-plan" a task whose plan was never the problem, and then
  // dead-lettering it when the architect's own run failed for the same reason.
  if (isInfraFailure(a.failure)) return 'infra-wait';

  if (a.attempts < a.maxAttempts) return 'retry';

  // A stage that declares `blocked` has somewhere to send a task it cannot finish. That is
  // the graph's version of the old hard-coded rescue: where `blocked` goes is drawn, not
  // baked in. Budgeted, so a task cannot loop build → plan → build forever.
  if (a.hasBlockedOutcome && a.rescuesUsed < a.maxRescues) return 'escalate';

  // A stage that runs AFTER a passing verdict is advisory: the work has already been proven,
  // and a broken reviewer must not condemn it. Hand it to a person instead of BLOCKED.
  if (a.qaPassed && a.hasHumanGate) return 'human-review';

  return 'dead-letter';
}

// The old `enableOwner` / `maxOwnerBounces` toggles are gone. Routing is graph-driven: a stage
// leaves the pipeline by being deleted from the workflow, and the bounce budget is the
// document's `hopCap`, which counts every reject in any direction.

// ── periodic architect triage ────────────────────────────────────────────────────
// Every TRIAGE_MS the orchestrator wakes ONE architect in read-only "triage" mode to
// review a project's in-flight tasks in a single batched run and re-plan/nudge the stuck
// ones — the efficient realisation of "an architect oversees ~5 tasks" without keeping an
// LLM process alive 24/7. 0 disables. Tasks under review are frozen from normal dispatch for
// the duration so the triage agent never races a live worker.
const TRIAGE_MS = Math.max(0, parseInt(process.env.ARCHITECT_TRIAGE_MS || '') || 5 * 60 * 1000);
const TRIAGE_MAX_TASKS = Math.max(1, parseInt(process.env.ARCHITECT_TRIAGE_MAX || '') || 5);
const TRIAGE_EVERY_TICKS = TRIAGE_MS > 0 ? Math.max(1, Math.round(TRIAGE_MS / POLL_MS)) : 0;
const triaging = new Set<string>(); // task ids under review by a triage pass — held out of dispatch
let triageCursor = 0;               // round-robin index across projects

// ── resource gate ──────────────────────────────────────────────────────────────
// Concurrency follows the machine, not a fixed count: keep spawning while the box
// has headroom, and WAIT once CPU or RAM crosses the threshold (default 80%, env-
// tunable). MAX_AGENTS (if set) is an optional hard backstop — recommended, because
// LLM agents are network-bound and CPU/RAM alone won't cap API rate-limit / cost.
const CPU_HIGH_PCT = Math.min(100, Math.max(1, parseInt(process.env.CPU_HIGH_PCT || '') || 80));
const MEM_HIGH_PCT = Math.min(100, Math.max(1, parseInt(process.env.MEM_HIGH_PCT || '') || 80));
const MAX_AGENTS = Math.max(0, parseInt(process.env.MAX_AGENTS || '') || 0); // 0 = no hard cap

let liveCpuPct = 0; // refreshed each poll tick by sampleCpu()
function cpuTimes(): { idle: number; total: number } {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { for (const v of Object.values(c.times)) total += v; idle += c.times.idle; }
  return { idle, total };
}
/** Cross-platform CPU% over a short window (works on Windows, unlike loadavg). */
async function sampleCpu(ms = 300): Promise<void> {
  const a = cpuTimes(); await sleep(ms); const b = cpuTimes();
  const dTotal = b.total - a.total;
  liveCpuPct = dTotal <= 0 ? 0 : Math.min(100, Math.max(0, Math.round(100 * (1 - (b.idle - a.idle) / dTotal))));
}
function usedMemPct(): number { const total = os.totalmem(); return total ? Math.round(100 * (1 - os.freemem() / total)) : 0; }

function canSpawn(active: number): boolean {
  if (active >= AGENT_POOL.length) return false;            // no free agent slot
  if (MAX_AGENTS > 0 && active >= MAX_AGENTS) return false; // optional hard backstop
  if (liveCpuPct >= CPU_HIGH_PCT) return false;             // CPU saturated → wait
  if (usedMemPct() >= MEM_HIGH_PCT) return false;           // RAM saturated → wait
  return true;
}

/** The steady-state status line, derived from the current snapshot (breaker, resource
 *  gate, live agents, pending queue). Transient lines (Dispatching/Merging) are set
 *  directly during those actions and get overwritten by this on the next quiet tick. */
async function computeSteadyStatus(): Promise<string> {
  if (breaker.state === 'open') return '⛔ Anthropic API unreachable — dispatch paused, retrying every 15s';
  if (dbBreaker.state === 'open') return '⛔ db-server offline — healing, dispatch paused';
  // The in-memory mirror is refreshed by the dispatch gate each tick — cheap and current.
  if (limitPausedUntilMs && limitPausedUntilMs > Date.now()) {
    return `⏸ plan limit reached — swarm paused until ${new Date(limitPausedUntilMs).toISOString()}`;
  }
  const working = agentTaskMap.size;
  const pending = (await allTasks()).filter(
    x => x.status === 'WORKING' && !x.started && x.control !== 'paused' && x.control !== 'stop'
      && (!x.nextRetryAt || Date.parse(x.nextRetryAt) <= Date.now())
  ).length;
  if (working === 0 && liveCpuPct >= CPU_HIGH_PCT) return `Waiting for resources — CPU ${liveCpuPct}%`;
  if (working === 0 && usedMemPct() >= MEM_HIGH_PCT) return `Waiting for resources — RAM ${usedMemPct()}%`;
  if (working > 0) return `${working} agent(s) working · ${pending} pending`;
  if (pending > 0) return `${pending} task(s) pending — dispatching`;
  return 'Idle — nothing to dispatch';
}

/** Periodic SQLite integrity check — warns loudly if a board DB is corrupt.
 *  SQLite-only: `PRAGMA quick_check` and the raw getTasksDb()/getLogsDb() handles are
 *  meaningless under Postgres (they would open a stale/empty local .db file), so skip. */
function dbHealthCheck(logFn: (id: string, m: string, t?: 'info' | 'success' | 'warning' | 'error') => void): void {
  if (isPostgres()) return;
  for (const [name, conn] of [['tasks.db', getTasksDb()], ['logs.db', getLogsDb()]] as [string, any][]) {
    try {
      const r: any = conn.prepare('PRAGMA quick_check').get();
      const val = r ? (r.quick_check ?? Object.values(r)[0]) : 'unknown';
      if (val !== 'ok') logFn('__system__', `🩺 DB CORRUPT: ${name} failed quick_check (${val}) — restore/rebuild needed`, 'error');
    } catch (e: any) { logFn('__system__', `🩺 DB CORRUPT: ${name} — ${e?.message}`, 'error'); }
  }
}

// ── the workflow document ──────────────────────────────────────────────────────
// Reloaded once per tick, not once per task: a tick reads the board anyway, and a stale graph
// for three seconds is harmless, while a database read per task is not.
const wfCache = new Map<string, WorkflowDoc>();
function clearWorkflowCache(): void { wfCache.clear(); }

async function workflowFor(projectId: string): Promise<WorkflowDoc> {
  const hit = wfCache.get(projectId);
  if (hit) return hit;
  const { doc } = await loadWorkflow(projectId);
  wfCache.set(projectId, doc);
  return doc;
}

// ── stage routing ──────────────────────────────────────────────────────────────
/** What is about to run: the workflow stage, and the agent row that backs it. */
interface Routed { stage: WfStage; agent: AgentConfig; }

async function agentMap(): Promise<Record<string, AgentConfig>> {
  const m: Record<string, AgentConfig> = {};
  for (const a of await getAgents()) m[a.role] = a;
  return m;
}

/** The model this stage runs on: the stage wins, the agents table is the default. */
function modelFor(stage: WfStage, agent: AgentConfig | undefined): string {
  // getConfig().models is a role-keyed override for CI/tests; the stage still wins over it.
  const roleDefault = (stage.agentRef ? getConfig().models?.[stage.agentRef as AgentRole] : undefined) ?? agent?.model;
  return modelForStage(stage, roleDefault) ?? 'sonnet';
}
function getAvailableAgent(): string | null {
  for (const n of AGENT_POOL) if (!agentTaskMap.has(n) && !isAgentBusy(n)) return n;
  return null;
}

// ── Phase 3 — multi-orchestrator coordination ─────────────────────────────────
// `claimedBy` is stamped `${WORKER_ID}:${agentName}` so a task maps back to the
// MACHINE running it. The merge lock is a DB row (`merge:<projectId>`) held for the
// duration of a merge — only ONE machine merges a given project at a time (a plain
// in-memory flag couldn't coordinate across machines). git merge mutates the shared
// working tree/index, so two concurrent merges in one checkout would corrupt each other.
const workerAgentId = (name: string): string => `${WORKER_ID}:${name}`;
const mergeLockName = (pid: string): string => `merge:${pid}`;
/** Merge-lock TTL: long enough to outlast a real merge, capped so a crashed holder's
 *  lock is reclaimable. Tracks the hard per-run cap (after which the agent is killed). */
const mergeLockTtl = (): number => Math.max(5 * 60 * 1000, maxRunMs() || 0, leaseMs());

/** True if `claimedBy` belongs to one of the given (stale) worker ids. `claimedBy` is
 *  `${workerId}:${agent}`; match the worker prefix without parsing internal colons. */
function claimedByStaleWorker(claimedBy: string | null | undefined, stale: Set<string>): boolean {
  if (!claimedBy) return false;
  for (const w of stale) if (claimedBy === w || claimedBy.startsWith(w + ':')) return true;
  return false;
}

// ── multi-project helpers ────────────────────────────────────────────────────────
// The orchestrator serves EVERY project, not just 'default': it unions tasks across all
// projects and dispatches them together, each project capped by its own concurrency.
const projectOf = (task: Task): string => task.projectId || 'default';

/** All tasks across all projects (NULL projectId rows belong to 'default'; no dup — a task
 *  is returned under exactly one project). */
async function allTasks(): Promise<Task[]> {
  const out: Task[] = [];
  for (const p of await listProjects()) for (const tk of await getAllTasks(p.id)) out.push(tk);
  // Rebuilt (not merged) so tasks deleted from the board stop pinning an entry here.
  taskProjects.clear();
  for (const tk of out) taskProjects.set(tk.id, projectOf(tk));
  return out;
}

/** How many agents are currently running for a project (by the live agentTaskMap). */
async function activeForProject(pid: string): Promise<number> {
  let n = 0;
  for (const id of agentTaskMap.values()) { const tk = await getTask(id); if (tk && projectOf(tk) === pid) n++; }
  return n;
}

/** A project's max concurrent agents: its own override, else the global default; 0 = unlimited. */
async function projectCap(pid: string): Promise<number> {
  try {
    const p = await getProject(pid);
    if (p && p.maxConcurrency != null) return Math.max(0, p.maxConcurrency);
  } catch { /* fall through to global default */ }
  return Math.max(0, (await getAgentDefaults()).maxConcurrency || 0);
}

// ── retry / dead-letter ──────────────────────────────────────────────────────
/** The durable failure summary the NEXT attempt reads: the failure kind plus the last ~40 lines
 *  of the run's output. `lastError` stays a short one-liner (for the board/triage); this is the
 *  fuller evidence the retrying agent needs so it does not repeat the same mistake blind. */
/** Scrub the obvious secrets out of captured agent output before it is stored in the task,
 *  injected into the next prompt, or shown to a human. The implementation now lives in the shared
 *  `../redact` module (also used by the db-server); re-exported here so existing importers of
 *  `redactSecrets` from this file keep working unchanged. */
export { redactSecrets };

export function failureDetailFrom(label: string, outputTail: string): string {
  const tail = redactSecrets((outputTail || '').split('\n').slice(-40).join('\n').trim());
  return `${label}${tail ? `\n${tail}` : ''}`;
}

// ── stage journal ──────────────────────────────────────────────────────────────
const JOURNAL_CAP = 20; // keep the last N entries; the trail, not the whole archaeology.
/** The task's journal with one entry appended (timestamped, capped). Returned so the caller can
 *  fold it into the SAME updateTask as the transition — one write, no separate round-trip. */
export function withJournal(task: Task, entry: Omit<JournalEntry, 'ts'>): JournalEntry[] {
  const prior = Array.isArray(task.journal) ? task.journal : [];
  const note = entry.note ? String(entry.note).replace(/\s+/g, ' ').trim().slice(0, 200) : undefined;
  return [...prior, { ts: new Date().toISOString(), ...entry, note }].slice(-JOURNAL_CAP);
}
async function scheduleRetry(id: string, attempts: number, note: string, detail?: string): Promise<void> {
  const backoff = Math.min(5 * 60 * 1000, 5000 * 2 ** attempts);
  const upd: Partial<Task> = { nextRetryAt: new Date(Date.now() + backoff).toISOString(), started: null, claimedBy: null, lastError: note };
  // Only a GENUINE agent failure records failureDetail (fed into the retry prompt). An infra
  // wait passes no detail — the agent never ran, so there is nothing to warn the next run about.
  if (detail !== undefined) upd.failureDetail = detail;
  await updateTask(id, upd);
  log(id, `↻ retry in ${Math.round(backoff / 1000)}s (attempt ${attempts}) — ${note}`, 'warning');
}
async function deadLetter(id: string, note: string, detail?: string): Promise<void> {
  // Move to BLOCKED (not left in WORKING) so the failure is VISIBLE on the board with
  // its reason, instead of a stuck task masquerading as active. Heal/human can revive.
  await updateTask(id, { status: 'BLOCKED', started: null, claimedBy: null, nextRetryAt: DEAD_LETTER_AT, lastError: note, failureDetail: detail ?? note });
  log(id, `☠ dead-letter → BLOCKED — ${note}. Fix the cause and re-trigger, or Heal to retry.`, 'error');
}
async function failTask(task: Task, kind: FailureKind, note: string, detail?: string): Promise<void> {
  breakerFailure(kind);
  // The durable, fuller failure summary the next attempt reads. Defaults to the short note when
  // the caller has no run output (e.g. a watchdog kill), so every failure records SOMETHING.
  const failDetail = detail ?? note;
  const attempts = task.attempts || 0;
  const doc = await workflowFor(projectOf(task));
  const stage = task.stage ? doc.stages.find(s => s.id === task.stage) : undefined;

  // The stage vanished from the workflow while the agent ran. Nothing can be decided about it.
  if (!stage) {
    await deadLetter(task.id, `stage "${task.stage}" is not in this project's workflow — ${note}`);
    return;
  }

  const perStage = capsFor(stage);
  const stageMaxAttempts = perStage?.attempts ?? maxAttempts();
  const blocked = stage.outcomes.find(o => o.when === 'blocked');
  const gate = nearestHumanGate(doc, stage.id);

  const action = decideFailure({
    failure: kind,
    attempts,
    maxAttempts: stageMaxAttempts,
    rescuesUsed: task.rescueCount || 0,
    maxRescues: perStage?.rescues ?? MAX_RESCUE,
    hasBlockedOutcome: !!blocked,
    hasHumanGate: !!gate,
    qaPassed: task.qaVerdict === 'pass',
  });

  // Journal every GENUINE failure (an infra wait is not the agent's fault, so it is not one) —
  // the trail records that this stage failed and what the outcome was, for the next agent/human.
  if (action !== 'infra-wait') {
    const journal = withJournal(task, { stage: stage.id, agent: stage.agentRef ?? stage.id, outcome: `fail:${kind}`, note });
    await updateTask(task.id, { journal });
    task.journal = journal; // keep the in-memory task current for any later reads in this call
  }

  switch (action) {
    case 'infra-wait': {
      // REFUND the attempt. dispatch() already spent one before the agent even reached the API,
      // and an outage must not eat a task's retry budget — otherwise a five-minute Anthropic
      // blip permanently costs every in-flight task a third of its lives.
      const refunded = Math.max(0, attempts - 1);
      await updateTask(task.id, { attempts: refunded });
      // Back off on the OUTAGE's severity (consecutive network failures), not on this task's
      // attempt count — which we just refunded and which no longer tracks anything real.
      await scheduleRetry(task.id, Math.min(6, breaker.failures), `infrastructure unavailable — ${note}`);
      log(task.id, `🌐 infrastructure failure (${note}) — attempt refunded, stage kept; waiting for the API to return`, 'warning');
      return;
    }
    case 'retry':
      await scheduleRetry(task.id, attempts, note, failDetail);
      return;
    case 'human-review':
      await updateTask(task.id, {
        stage: gate!, handoffFrom: stage.id, status: 'WORKING',
        started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null, attempts: 0,
        failureDetail: failDetail,
      });
      log(task.id, `🧑‍⚖️ "${stage.id}" could not finish (${note}) — passing already-verified work to "${gate}" rather than blocking it`, 'warning');
      return;
    case 'escalate': {
      // The graph's version of the old hard-coded rescue: the stage declares a `blocked`
      // outcome, and where that goes is drawn rather than baked in.
      const rescues = (task.rescueCount || 0) + 1;
      await updateTask(task.id, {
        stage: blocked!.to, handoffFrom: stage.id, lastOutcome: 'blocked', status: 'WORKING',
        started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null,
        attempts: 0, rescueCount: rescues, lastError: note, failureDetail: failDetail,
        reviewNote: `BLOCKED — the "${stage.id}" stage failed and could not self-recover (${note}). Diagnose the root cause and REVISE the plan so a fresh run can succeed; do not just repeat the old brief.`,
      });
      log(task.id, `🩺 "${stage.id}" exhausted its retries → escalating to "${blocked!.to}" (${rescues}/${perStage?.rescues ?? MAX_RESCUE})`, 'warning');
      setStatus(`Rescuing "${task.title}" — re-planning after ${stage.id} failures`, true);
      return;
    }
    case 'dead-letter':
      await deadLetter(task.id, `${stageMaxAttempts} attempts exhausted (${note})`);
      return;
  }
}

// ── periodic architect triage pass ────────────────────────────────────────────
function triagePromptFor(pid: string, tasks: Task[]): string {
  const rows = tasks.map(x => {
    const age = x.started ? `${Math.round((Date.now() - Date.parse(x.started)) / 60000)}min at stage` : 'waiting to be picked up';
    return `- [${x.id}] "${x.title}" — stage=${x.stage}, status=${x.status}, attempts=${x.attempts || 0}, rescues=${x.rescueCount || 0}, ${age}` +
      (x.lastError ? `, lastError=${String(x.lastError).slice(0, 160)}` : '') +
      (x.nextRetryAt && x.nextRetryAt !== DEAD_LETTER_AT ? `, retryAt=${x.nextRetryAt}` : '');
  }).join('\n');
  const put = (body: string) => `     curl -X PUT http://127.0.0.1:${DB_PORT}/tasks/<id> -H "Content-Type: application/json" -d '${body}'`;
  return [
    `You are the ARCHITECT running a read-only TRIAGE pass over project "${pid}". Below are its in-flight tasks that are between stages and may be stuck. You did the planning; now make sure each reaches human review. For EACH task decide and act — but ONLY act on ones that are genuinely stuck; leave healthy ones alone.`,
    '',
    'DECISIONS (per task):',
    '  • HEALTHY / just moving normally → do NOTHING.',
    '  • Needs a nudge (ambiguous or thin brief, a missing detail the dev needs) → add guidance WITHOUT changing its stage:',
    put('{"reviewNote":"GUIDANCE: <concrete next step for the dev/qa>"}'),
    '  • Genuinely STUCK (repeated failures, an oversized/wrong plan, a contradictory scenario) → hand it to a rescue re-plan:',
    put('{"stage":"rescue","reviewNote":"BLOCKED: <root cause + exactly what to change>"}'),
    '',
    'RULES: Do NOT write application code. Do NOT touch tasks that are progressing fine. Base every decision on the REAL code (use the shared index) and each task\'s history below. Be surgical — a needless rescue costs a whole re-plan cycle.',
    '',
    'IN-FLIGHT TASKS:',
    rows,
  ].join('\n');
}

async function triagePass(): Promise<void> {
  if (TRIAGE_MS <= 0 || t().enableArchitect === false) return;
  if (isAgentBusy('triage')) return; // one triage at a time
  const arch = (await agentMap())['architect'];
  if (!arch || !arch.enabled) return;

  // Round-robin the projects so a busy project doesn't starve the others of oversight.
  const projects = await listProjects();
  if (!projects.length) return;
  let picked: { pid: string; tasks: Task[] } | null = null;
  for (let i = 0; i < projects.length; i++) {
    const pid = projects[(triageCursor + i) % projects.length].id;
    const doc = await workflowFor(pid);
    // A task worth triaging is one somewhere in the middle of the pipeline: past the entry,
    // not yet finished. Naming the stages here would have re-introduced exactly the coupling
    // this change removes — rename `qa` to `tapora` and triage would silently stop seeing it.
    const inFlight = (x: Task): boolean => {
      if (!x.stage) return false;
      const stage = doc.stages.find(s => s.id === x.stage);
      return !!stage && stage.behaviour !== 'terminal' && x.stage !== doc.entry;
    };
    const cands = (await getAllTasks(pid)).filter(x =>
      (x.status === 'WORKING' || x.status === 'TESTING')
      && inFlight(x)
      && !isTaskRunning(x.id)               // never race a live worker
      && !triaging.has(x.id)
      && x.control !== 'paused' && x.control !== 'stop'
    ).slice(0, TRIAGE_MAX_TASKS);
    if (cands.length) { picked = { pid, tasks: cands }; triageCursor = (triageCursor + i + 1) % projects.length; break; }
  }
  if (!picked) return;

  const { pid, tasks } = picked;
  const anchor = tasks[0];
  for (const x of tasks) triaging.add(x.id); // freeze from dispatch for the run
  const release = () => { for (const x of tasks) triaging.delete(x.id); };
  const ok = await spawnHeadlessAgent({
    agentName: 'triage', taskId: anchor.id, role: 'architect',
    // Triage is not a workflow stage; it runs the architect directly, on the architect's model.
    prompt: triagePromptFor(pid, tasks), model: getConfig().models?.architect || arch.model, worktree: 'none',
    permissionProfile: await getPermissionProfile(),
    onExit: (r) => { release(); log('__system__', `🔭 architect triage done (${pid}, ${tasks.length} task(s), ${r.failure})`, r.failure === 'none' ? 'success' : 'warning'); },
  });
  if (ok) { log('__system__', `🔭 architect triage — reviewing ${tasks.length} in-flight task(s) in project ${pid}`, 'info'); setStatus(`Architect triage — reviewing ${tasks.length} task(s) in ${pid}`, true); }
  else release();
}

/** Does the user allow agents to run with `--dangerously-skip-permissions`?
 *  Owned in Settings -> Agent safety. Absent => true, so the product works out of the box —
 *  but it is now a VISIBLE setting rather than a silent env-var default. */
async function getPermissionProfile(): Promise<'strict' | 'standard' | 'dangerous'> {
  try { return (await getAgentDefaults()).permissionProfile; } catch { return 'standard'; }
}

// ── dispatch ─────────────────────────────────────────────────────────────────
async function dispatch(task: Task, route: Routed, name: string): Promise<void> {
  const { stage, agent: ac } = route;
  const attempts = (task.attempts || 0) + 1;
  const model = modelFor(stage, ac);
  const wt = worktreeForStage(stage);
  const role = stage.agentRef ?? ac.role;
  const perStage = capsFor(stage);

  let prompt: string;
  try {
    // The agent is told the outcome words it may report, and never a stage name.
    const doc = await workflowFor(projectOf(task));
    // The peers this stage may consult, resolved from its `asks` (each entry is a stage id whose
    // agent advises). Labelled with that stage's role so the prompt names who answers.
    const asks = (stage.asks ?? []).map(id => ({ to: id, agent: stageById(doc, id)?.agentRef ?? undefined }));
    prompt = await renderPrompt(ac, task, stage.id, {
      promptRef: stage.promptRef,
      outcomes: allowedOutcomes(doc, stage.id),
      asks,
    });
  }
  catch (e: any) { await scheduleRetry(task.id, attempts, `prompt render failed: ${e?.message || e}`); return; }

  await updateTask(task.id, {
    claimedBy: workerAgentId(name), started: new Date().toISOString(), attempts,
    leaseExpiresAt: new Date(Date.now() + leaseMs()).toISOString(),
    nextRetryAt: null, lastError: null, model,
  });
  agentTaskMap.set(name, task.id);

  // `qaVerdict` is a TASK field: every stage after a verify stage inherits it. Remember what it
  // was before this run, so the exit handler can tell a stage that WROTE a verdict from one that
  // merely carried the existing one forward.
  const verdictBefore: QaVerdict = task.qaVerdict ?? null;

  const ok = await spawnHeadlessAgent({
    agentName: name, taskId: task.id, role: role as AgentRole, prompt, model, worktree: wt,
    permissionProfile: await getPermissionProfile(),
    onExit: (r) => { handleAgentExit(name, task.id, route, r, verdictBefore).catch(e => log(task.id, `exit handler error: ${e?.message || e}`, 'error')); },
  });
  if (ok) log(task.id, `🚀 ${role} (${model}) as ${name} — stage ${stage.id}, attempt ${attempts}/${perStage?.attempts ?? maxAttempts()}`, 'success');
  else {
    agentTaskMap.delete(name);
    // Never spawned → the exit handler won't run; free the merge lock we took (if any).
    if (takesMergeLock(stage)) {
      try { await releaseLock(mergeLockName(projectOf(task)), WORKER_ID); } catch { /* TTL is the backstop */ }
    }
    await scheduleRetry(task.id, attempts, 'spawn failed');
  }
}

async function dispatchPending(): Promise<void> {
  // Plan-limit pause: while the persisted window is in force, dispatch NOTHING this tick —
  // the plan's usage budget is account-wide, so every spawn would fail identically.
  if (await limitPauseActive()) return;
  const now = Date.now();
  const pending = (await allTasks()).filter(
    // 'paused' holds a task out of dispatch; 'stop' is a kill-now request handled by the
    // watchdog — neither should be dispatched here.
    x => x.status === 'WORKING' && !x.started && x.control !== 'paused' && x.control !== 'stop'
      && !triaging.has(x.id) // frozen while an architect triage pass is reviewing it
      && (!x.nextRetryAt || Date.parse(x.nextRetryAt) <= now)
  );
  if (!pending.length || !breakerAllows() || !dbBreakerAllows()) return;

  const agents = await agentMap();
  for (const task of pending) {
    const doc = await workflowFor(projectOf(task));
    const place = placeTask(doc, task.stage);

    // The task stands on a stage the document no longer contains. Saving refuses to remove an
    // occupied stage, but a restored backup, a hand-edit, or a task carried over from an older
    // revision can all land here. Park it loudly: this is the `stage="blocked"` orphan class,
    // and it must never be silent.
    if (place.kind === 'unknown-stage') {
      await deadLetter(task.id, `stage "${place.stageId}" is not in this project's workflow — restore it, or move the task to a stage that exists`);
      continue;
    }

    // A terminal reached by routing rather than by the merge stage's own exit.
    if (place.kind === 'terminal') {
      await updateTask(task.id, { status: 'DONE', completed: new Date().toISOString(), started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null });
      log(task.id, '✅ reached the end of the workflow — done', 'success');
      continue;
    }

    // Park for a person. Keep the worktree so a preview can still be built.
    if (place.kind === 'human-gate') {
      await updateTask(task.id, { status: 'TESTING', started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null });
      // Several different things park here, and saying "QA passed" for all of them is a lie the
      // user then has to debug: an ambiguous ask parks before anything is built, and an
      // exhausted hop budget parks work an agent still objects to.
      if (!task.qaVerdict && task.ownerNote) {
        log(task.id, `🧑‍💼 needs your input before any work starts — ${task.ownerNote.slice(0, 160)}`, 'warning');
      } else if (task.qaVerdict === 'pass' && task.ownerNote) {
        log(task.id, '🧑‍⚖️ QA passed, but an agent still objects — read its note, then approve or reject', 'warning');
      } else {
        log(task.id, `🧑‍⚖️ awaiting your review at "${place.stage.id}" (build a preview, then approve)`, 'success');
      }
      continue;
    }

    const stage = place.stage;
    if (!canSpawn(agentTaskMap.size)) break;
    const pid = projectOf(task);
    // PROJECT READINESS GATE — a project may only dispatch tasks once it's set up: a cloned git
    // repo (NO implicit host-cwd fallback), a user-confirmed run-config, and a verified preview.
    // Bypassable ONLY when the user has confirmed BOTH "no existing project" and "not executable"
    // (readinessBypass). Otherwise block loudly so uninstalled/unbuildable projects can't silently
    // run agents on the wrong tree or burn runs that can never be verified.
    const proj = await getProject(pid);
    if (!proj?.readinessBypass) {
      const reasons: string[] = [];
      if (!proj?.repoPath || !existsSync(proj.repoPath) || !isGitRepo(proj.repoPath)) reasons.push('no cloned git repo');
      if (!proj?.runConfigConfirmed) reasons.push('run-config not confirmed');
      if (!proj?.previewVerifiedAt) reasons.push('preview not verified');
      if (reasons.length) {
        await deadLetter(task.id, `project "${pid}" not ready — ${reasons.join(', ')}. Finish setup (clone → confirm run-config → verify preview), or bypass by confirming BOTH: no existing project AND not executable.`);
        continue;
      }
    }
    // Per-project concurrency cap: skip (don't break) so OTHER projects with headroom still
    // dispatch this tick. cap 0 = unlimited (resource-gated only).
    const cap = await projectCap(pid);
    if (cap > 0 && await activeForProject(pid) >= cap) continue;

    const isMerge = takesMergeLock(stage);

    // Already merged? Don't re-run the merge agent — it's approved, mark it done.
    if (isMerge && await isMergedIntoHead(task.id)) {
      await removeWorktree(task.id);
      await reconcileContextAfterMerge(task.id);
      const after = routeOutcome(doc, stage.id, 'done');
      await updateTask(task.id, {
        status: 'DONE',
        stage: after.kind === 'advance' ? after.to : task.stage,
        completed: new Date().toISOString(), started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null,
      });
      log(task.id, '🔀 already merged — approved & done', 'success');
      continue;
    }

    // A stage whose agent is missing or switched off cannot run. Removing a stage from the
    // pipeline is done by deleting it from the workflow, not by disabling its agent — so say
    // so out loud rather than leaving the task un-dispatchable and invisible.
    const ac = stage.agentRef ? agents[stage.agentRef] : undefined;
    if (!ac) {
      await deadLetter(task.id, `stage "${stage.id}" needs the agent "${stage.agentRef}", which does not exist — add it, or remove the stage from the workflow`);
      continue;
    }
    if (!ac.enabled) {
      await deadLetter(task.id, `stage "${stage.id}" needs the agent "${stage.agentRef}", which is disabled — enable it, or remove the stage from the workflow`);
      continue;
    }

    const name = getAvailableAgent();
    if (!name) break;

    // MERGE LOCK (cross-machine) — take the DB lock BEFORE claiming so only ONE machine
    // merges a given project at a time. Held until the merge agent exits (released in
    // handleAgentExit / on spawn failure), with a TTL backstop if this process dies.
    if (isMerge && !(await acquireLock(mergeLockName(pid), WORKER_ID, mergeLockTtl()))) continue;
    // ATOMIC CLAIM — reserve the task for THIS worker before spawning. On multi-machine
    // Postgres only one worker's conditional UPDATE wins; on single-machine SQLite the
    // lone worker always wins. If we lost the race, another machine got it → skip.
    if (!(await claimTask(task.id, workerAgentId(name), leaseMs()))) {
      if (isMerge) { try { await releaseLock(mergeLockName(pid), WORKER_ID); } catch { /* ignore */ } }
      log(task.id, '⏭ claimed by another worker — skipping', 'info');
      continue;
    }

    // A task that had no stage now has one: record where it is, so a reject has a sender and
    // the board shows the truth.
    if (task.stage !== stage.id) { await updateTask(task.id, { stage: stage.id }); task.stage = stage.id; }

    if (isMerge) setStatus(`Merging "${task.title}" into ${await currentBranch(task.id)}`, true);
    else setStatus(`Dispatching ${stage.id.toUpperCase()} for "${task.title}" → ${stage.agentRef}`, true);
    await dispatch(task, { stage, agent: ac }, name);
  }
}

// ── exit handling ──────────────────────────────────────────────────────────────
function refreshIndex(): void {
  try { getConfig().codeIndex?.refresh?.(m => log('__system__', m, 'info')); } catch { /* optional */ }
}

/**
 * An agent rejected the work handed to it: the brief is wrong, or the verdict's basis is.
 *
 * The task returns to its SENDER, which is not the same as "the previous stage". When QA fails
 * a task back to the dev, the dev's sender is QA — so the dev's reject goes forward to QA.
 * That is why every reject counts one hop whatever its direction, and why the cap cannot be a
 * comparison of stage positions.
 *
 * A spent hop budget never dead-letters. A task nobody can agree on is a person's problem, so
 * it goes to a human gate with its history intact.
 */
async function applyReject(doc: WorkflowDoc, task: Task, stage: WfStage): Promise<void> {
  const decision = routeReject(doc, { stageId: stage.id, handoffFrom: task.handoffFrom, hops: task.hops ?? 0 });

  if (decision.kind === 'no-sender') {
    await deadLetter(task.id, `stage "${stage.id}" rejected the task, but nothing handed it over — there is nowhere to send it back to`);
    return;
  }
  if (decision.kind === 'unknown-stage') {
    await deadLetter(task.id, `stage "${decision.stageId}" vanished from the workflow while the agent ran`);
    return;
  }
  if (decision.kind === 'hop-cap') {
    if (!decision.to) {
      await deadLetter(task.id, `hop cap of ${doc.hopCap} reached and this workflow has no human gate to escalate to`);
      return;
    }
    await updateTask(task.id, {
      stage: decision.to, hops: decision.hops, lastOutcome: 'reject', handoffFrom: stage.id,
      started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null, attempts: 0, failureDetail: null,
      journal: withJournal(task, { stage: stage.id, agent: stage.agentRef ?? stage.id, outcome: 'reject', note: task.reviewNote ?? undefined }),
    });
    log(task.id, `🛑 hop cap reached (${decision.hops}/${doc.hopCap}) — sending to "${decision.to}" for a person to settle`, 'warning');
    return;
  }

  await updateTask(task.id, {
    stage: decision.to, hops: decision.hops, lastOutcome: 'reject', handoffFrom: stage.id,
    started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null, attempts: 0, failureDetail: null,
    journal: withJournal(task, { stage: stage.id, agent: stage.agentRef ?? stage.id, outcome: 'reject', note: task.reviewNote ?? undefined }),
  });
  log(task.id, `↩ "${stage.id}" rejected back to its sender "${decision.to}" — hop ${decision.hops}/${doc.hopCap}`, 'warning');
}

/**
 * The word the agent reported, or null when it reported nothing.
 *
 * Two paths, because the prompts still name stages while this migration lands:
 *   • `lastOutcome` — the new contract. The agent says what happened, never where to go.
 *   • a changed `stage` — the legacy contract. Accepted only when it names a stage that
 *     exists in this project's workflow, and it is translated back into whichever outcome
 *     routes there. An agent still cannot invent a destination.
 */
function reportedOutcome(doc: WorkflowDoc, stage: WfStage, fresh: Task): { outcome: string | null; legacy: boolean } {
  if (fresh.lastOutcome) return { outcome: fresh.lastOutcome, legacy: false };
  if (fresh.stage && fresh.stage !== stage.id) {
    const hit = stage.outcomes.find(o => o.to === fresh.stage);
    if (hit) return { outcome: hit.when, legacy: true };
  }
  return { outcome: null, legacy: false };
}

/**
 * A read-only ADVISOR answers a peer's consult. Spawned with worktree 'none' (no branch, no
 * commits), on the target stage's model, and WAITED for — its onExit resolves the promise. The
 * advisor writes its reply via `{"consultAnswer":…}`, which we read back off the task.
 *
 * DEPTH-1 lives here: the advisor's prompt offers no consult, and this run never goes through
 * handleAgentExit, so an advisor can never itself trigger another consult.
 */
async function runAdvisor(name: string, task: Task, target: WfStage, ac: AgentConfig, model: string, pc: NonNullable<Task['pendingConsult']>): Promise<string> {
  const role = (target.agentRef ?? ac.role) as AgentRole;
  const prompt = [
    `You are the ${role.toUpperCase()}, acting as a READ-ONLY ADVISOR. A peer agent working on`,
    `task ${task.id} ("${task.title}") is blocked and has asked you a question. ANSWER it — do not`,
    'do their work, do not write, edit, commit, or check out anything. You are advice, not hands.',
    '',
    'THEIR QUESTION:',
    pc.question || '(no question text was given — give your best, specific guidance for this task)',
    '',
    'Use the shared code index to ground your answer, then reply concisely and concretely (cite',
    'files as path:line where you can). When done, POST your answer and STOP — report NOTHING else',
    '(no outcome, no verdict, no stage change):',
    `  curl -X PUT http://127.0.0.1:6952/tasks/${task.id} -H "Content-Type: application/json" -d '{"consultAnswer":"<your answer>"}'`,
  ].join('\n');

  const profile = await getPermissionProfile();
  agentTaskMap.set(name, task.id);
  log(task.id, `🔎 advisor ${role} (${model}) as ${name} — answering a peer's consult`, 'info');
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; agentTaskMap.delete(name); resolve(); };
    spawnHeadlessAgent({
      agentName: name, taskId: task.id, role, prompt, model, worktree: 'none',
      permissionProfile: profile, onExit: () => done(),
    }).then(ok => { if (!ok) done(); }).catch(() => done());
  });
  const fresh = await getTask(task.id);
  const answer = fresh?.consultAnswer?.trim();
  return answer || '(the advisor returned no answer)';
}

/**
 * Handle a pending consult on `task` at `stage`: validate it against the stage's `asks` and the
 * caps, run the advisor, record the answer, and re-dispatch the SAME stage. A consult is not a
 * hop and does not move the task; it also refunds its attempt so it never eats the retry budget.
 */
async function handleConsult(doc: WorkflowDoc, task: Task, stage: WfStage): Promise<void> {
  breakerSuccess(); // the agent reached the API to post its consult — not an outage
  const pc = task.pendingConsult!;
  const clog = task.consultLog ?? [];
  const used = consultsUsed(clog, stage.id);

  // Re-dispatch the asking stage, clearing the pending consult. Refund the attempt dispatch()
  // spent: a consult round-trip is not a failed run and must not consume the stage's budget.
  const redispatch = async (note: string, type: 'info' | 'warning' = 'info') => {
    await updateTask(task.id, {
      pendingConsult: null, consultAnswer: null,
      started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null,
      attempts: Math.max(0, (task.attempts || 1) - 1),
    });
    log(task.id, note, type);
  };

  const decision = canConsult(stage, pc.to, used.stage, used.task);
  if (decision.kind !== 'ok') {
    const why =
      decision.kind === 'not-permitted' ? `"${stage.id}" may only consult: ${decision.allowed.join(', ') || 'no one'}`
      : decision.kind === 'stage-cap' ? `consult cap for this stage reached (${decision.cap})`
      : `consult cap for this task reached (${decision.cap})`;
    await redispatch(`💬 ignoring consult to "${pc.to}" — ${why}; re-running "${stage.id}"`, 'warning');
    return;
  }

  // `pc.to` is an entry from the stage's `asks` — a stage id whose agent is the advisor.
  const target = stageById(doc, pc.to);
  const advisorRole = target?.agentRef ?? null;
  const agents = await agentMap();
  const ac = advisorRole ? agents[advisorRole] : undefined;
  if (!target || !ac || !ac.enabled) {
    await redispatch(`💬 cannot consult "${pc.to}" — no runnable agent backs it; re-running "${stage.id}"`, 'warning');
    return;
  }

  // Defer when there is no slot OR the resource gate is closed: an advisor is another agent
  // process, so spawning one while RAM/CPU is saturated is exactly what canSpawn exists to
  // prevent. Keep the pending consult so it retries on a later, healthier tick.
  const name = (canSpawn(agentTaskMap.size) && getAvailableAgent()) || null;
  if (!name) {
    await updateTask(task.id, { started: null, claimedBy: null, leaseExpiresAt: null });
    log(task.id, `💬 consult to "${pc.to}" deferred — no free slot or resources are tight; will retry`, 'info');
    return;
  }

  const answer = await runAdvisor(name, task, target, ac, modelFor(target, ac), pc);
  const entry = { from: stage.id, to: pc.to, question: pc.question, answer, at: new Date().toISOString() };
  await updateTask(task.id, {
    consultLog: [...clog, entry],
    pendingConsult: null, consultAnswer: null,
    started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null,
    attempts: Math.max(0, (task.attempts || 1) - 1), // the consult round-trip is free
  });
  log(task.id, `💬 consulted "${pc.to}" (${advisorRole}) — answer stored; re-running "${stage.id}"`, 'success');
  setStatus(`Consulted ${advisorRole} for "${task.title}" — resuming ${stage.id}`, true);
}

async function handleAgentExit(name: string, taskId: string, route: Routed, r: RunResult, verdictBefore: QaVerdict = null): Promise<void> {
  agentTaskMap.delete(name);
  const stage = route.stage;
  const role = stage.agentRef ?? route.agent.role;

  // Release the cross-machine merge lock on EVERY merge exit path (success, conflict, crash,
  // kill) — this is the single choke point that guarantees the lock is freed.
  if (takesMergeLock(stage)) {
    const pid = (await getTask(taskId))?.projectId || 'default';
    try { await releaseLock(mergeLockName(pid), WORKER_ID); } catch { /* TTL is the backstop */ }
  }
  // A `plan` stage runs in a throwaway read-only worktree — drop it on exit.
  if (stage.behaviour === 'plan') await removePlanWorktree(taskId);

  const fresh = await getTask(taskId);
  if (!fresh) return;
  const doc = await workflowFor(projectOf(fresh));

  // Record actual time THIS run took, accumulated per role (for Analytics: who took how long).
  if (r.durationMs) {
    const timings: Record<string, number> = { ...(fresh.stageTimings || {}) };
    timings[role] = (timings[role] || 0) + r.durationMs;
    await updateTask(taskId, { stageTimings: timings });
    fresh.stageTimings = timings;
  }

  // Only a `verify` stage may CHANGE the QA verdict. Checking mere presence destroyed a
  // legitimate verdict: `qaVerdict` lives on the task, so the owner's acceptance gate inherits
  // `pass` from QA and would have had it wiped on the way to human review.
  const { verdict, rejected } = reconcileVerdict(stage, verdictBefore, fresh.qaVerdict);
  if (rejected) {
    await updateTask(taskId, { qaVerdict: verdict });
    log(taskId, `⚠ stage "${stage.id}" tried to change the QA verdict but is not a verify stage — reverted to "${verdict ?? 'none'}"`, 'warning');
    fresh.qaVerdict = verdict;
  }

  if (r.failure === 'none') {
    // CONSULT — the agent asked a peer for advice and exited (freeing its slot). This is neither
    // an outcome nor a reject: run a read-only advisor, fold its answer into the log, and re-run
    // THIS stage. Handled before the "reported nothing" path, since a consult reports no outcome.
    if (fresh.pendingConsult && fresh.pendingConsult.to) {
      await handleConsult(doc, fresh, stage);
      return;
    }

    const { outcome, legacy } = reportedOutcome(doc, stage, fresh);

    // The agent exited cleanly but reported nothing. Before blaming it, rule out an INFRA
    // fault: the most likely reason an agent could not report its outcome is that it could not
    // REACH the db-server to do so. Heal and retry the same stage without burning a retry,
    // rather than marching a healthy task toward BLOCKED.
    if (!outcome) {
      if (!(await probeDbServer())) {
        openDbBreaker('an agent finished but its outcome callback could not reach the db-server');
        await updateTask(taskId, {
          started: null, claimedBy: null, leaseExpiresAt: null,
          nextRetryAt: new Date(Date.now() + 8000).toISOString(),
          attempts: Math.max(0, (fresh.attempts || 1) - 1),  // an infra fault costs no budget
          lastError: 'db-server unreachable — infra fault; will resume when healed',
        });
        log(taskId, `🩹 "${stage.id}" reported no outcome, but the db-server was DOWN — infra fault, not the agent; retrying once healed`, 'warning');
        return;
      }
      const noReport = `agent finished without reporting an outcome (expected one of: ${stage.outcomes.map(o => o.when).join(', ') || 'none'})`;
      await failTask(fresh, 'crash', noReport, failureDetailFrom(noReport, r.outputTail));
      return;
    }

    breakerSuccess();

    // A reject returns the task to whoever handed it over, and costs one hop in any direction.
    if (outcome === 'reject') { await applyReject(doc, fresh, stage); return; }

    const decision = routeOutcome(doc, stage.id, outcome);
    if (decision.kind !== 'advance') {
      // The agent reported a word this stage does not declare. Do not guess: a lenient default
      // would hand routing power straight back to the agent.
      await deadLetter(taskId, decision.kind === 'unknown-outcome'
        ? `stage "${stage.id}" reported the outcome "${decision.outcome}", which it does not declare (allowed: ${decision.allowed.join(', ') || 'none'})`
        : `stage "${decision.stageId}" vanished from the workflow while the agent ran`);
      return;
    }

    if (role === 'qa' && fresh.qaVerdict === 'fail' && fresh.reviewNote) {
      getConfig().memory?.remember({ taskId, role: 'qa', kind: 'gotcha', text: `QA failed: ${fresh.reviewNote}` }).catch(() => {});
    }

    // Clear started/claimedBy so the NEXT stage is dispatched, and reset attempts so the retry
    // budget counts RETRIES PER STAGE rather than cumulative dispatches across the pipeline.
    // A plan-behaviour stage's summary IS the plan: freeze it into `plan` now, before the dev's
    // own summary overwrites `summary`, so the build stage still reads the original brief.
    await updateTask(taskId, {
      stage: decision.to,
      handoffFrom: stage.id,          // set by the control plane; a reject returns to the sender
      lastOutcome: outcome,
      ...(stage.behaviour === 'plan' && fresh.summary ? { plan: fresh.summary } : {}),
      journal: withJournal(fresh, { stage: stage.id, agent: role, outcome, note: fresh.summary ?? undefined }),
      started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null, lastError: null, failureDetail: null, attempts: 0,
    });

    if (takesMergeLock(stage)) {
      await removeWorktree(taskId);              // merged → drop the dev worktree
      await reconcileContextAfterMerge(taskId);  // drop context entries for files the merge deleted
      refreshIndex();
      log(taskId, '🔀 merged into current branch — approved & done', 'success');
      setStatus(`Merged "${fresh.title}" — done`, true);
    }

    log(taskId, `✅ ${role} finished "${stage.id}" → reported "${outcome}" → ${decision.to}${legacy ? ' (legacy stage write)' : ''}`, 'success');
    return;
  }

  // PLAN LIMIT — handled before the merge-conflict kickback and before failTask, because it
  // is neither: a merge that died on the usage limit did not conflict (bouncing it would cost
  // the dev a pointless rebase cycle), and failTask's retry/dead-letter budget must not be
  // spent on a window that stays shut for hours. Pause the swarm; the task goes back untouched.
  if (r.failure === 'limit') {
    await pauseForLimit(fresh, r);
    return;
  }

  // MERGE CONFLICT KICKBACK — a merge that didn't land (the architect couldn't cleanly
  // integrate task/<id> into the base branch) bounces the task back to the DEV to rebase
  // its branch onto the base, re-commit, then re-run qa → review → merge. This is the
  // "one merge active; on conflict the dev rebases" policy, enforced in the control plane
  // so it holds even with a stale merge prompt. Network failures are NOT conflicts — let
  // those retry the merge via the breaker/backoff instead of forcing a full dev cycle.
  // Reached only when the run genuinely failed: crash, timeout, stall, or network.
  //
  // The stage that holds the merge lock is special. A merge that did not land means the branch
  // conflicts, and the fix is for the dev to rebase — not for the merge to be retried. Network
  // failures are NOT conflicts: let those retry the merge via the breaker rather than forcing a
  // whole dev cycle. `conflict` is a declared outcome of the merge stage, so where it goes is
  // the graph's decision, not this function's.
  if (takesMergeLock(stage) && r.failure !== 'network' && !(await isMergedIntoHead(taskId))) {
    // Abort any half-applied merge so the working tree is clean for the next task.
    try { execSync('git merge --abort', { stdio: 'pipe', cwd: await repoCwdFor(taskId) }); } catch { /* nothing to abort */ }
    const conflict = routeOutcome(doc, stage.id, 'conflict');
    const maxConflicts = capsFor(stage)?.conflicts ?? 3;
    const bounces = (fresh.mergeBounces || 0) + 1;
    if (conflict.kind !== 'advance') {
      await deadLetter(taskId, `merge conflicted, but stage "${stage.id}" declares no "conflict" outcome — add one, or resolve the conflict by hand`);
      return;
    }
    if (bounces > maxConflicts) {
      await deadLetter(taskId, `merge still conflicts after ${maxConflicts} rebase attempts — needs a human`);
      return;
    }
    breakerSuccess(); // a merge conflict is not an API outage
    const base = await currentBranch(taskId);
    await updateTask(taskId, {
      stage: conflict.to, handoffFrom: stage.id, lastOutcome: 'conflict',
      qaVerdict: null, status: 'WORKING',
      started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null, lastError: null, failureDetail: null,
      attempts: 0, mergeBounces: bounces,
      reviewNote: `MERGE CONFLICT: your branch task/${taskId} no longer merges cleanly into ${base}. Reconcile it: run \`git rebase ${base}\` (or \`git merge ${base}\` into your branch), resolve the conflicts, re-run the sanity checks, and re-commit. Do NOT change scope — only bring your branch up to date with ${base}.`,
    });
    log(taskId, `↩ merge conflict — bounced to "${conflict.to}" to rebase onto ${base} (attempt ${bounces}/${maxConflicts})`, 'warning');
    setStatus(`Merge conflict on "${fresh.title}" — sent back to rebase onto ${base}`, true);
    return;
  }

  const note = `${r.failure}: ${r.outputTail.slice(-200)}`;
  log(taskId, `❌ ${name} failed at "${stage.id}" — ${note}`, 'error');
  await failTask((await getTask(taskId)) || fresh, r.failure, note, failureDetailFrom(r.failure, r.outputTail));
}

// ── watchdog + stall ─────────────────────────────────────────────────────────
/**
 * Periodic reconcile (~every 60s). Finds WORKING tasks that were stamped `started` but carry NO
 * `leaseExpiresAt` and have no live agent here. Such rows are stranded: `dispatchPending` only
 * picks up `WORKING && !started`, and `watchdog` only reclaims rows that HAVE a lease — so
 * nobody owns them. (Anything the orchestrator itself claims always gets a lease via claimTask,
 * so these only come from an outside writer marking work as started.)
 *
 * This NEVER starts a task. It only clears the false claim so the next dispatch tick can queue
 * it through the normal gates — CPU/RAM resource gate, agent pool, per-project concurrency cap,
 * project readiness — and then claim it atomically. Deciding when work actually begins is the
 * orchestrator's job alone.
 */
async function reconcileStranded(): Promise<void> {
  for (const task of await allTasks()) {
    if (task.status !== 'WORKING' || !task.started) continue;
    if (task.leaseExpiresAt) continue;   // leased → the watchdog owns it
    if (isTaskRunning(task.id)) continue; // genuinely running on this worker
    await updateTask(task.id, {
      started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null,
      lastError: 'reconciled: marked started with no lease and no agent — requeued for dispatch',
    });
    log(task.id, '🩺 reconciled — was marked started with no lease and no agent; requeued for the orchestrator to schedule', 'warning');
  }
}

async function watchdog(): Promise<void> {
  const now = Date.now();
  // Cross-machine reclaim: build the set of STALE workers (machines that stopped
  // heartbeating for > ~2× the lease). A dead machine's in-flight tasks return to the
  // pool for another machine. This worker is beating, so it's never in the set — and we
  // additionally guard on isTaskRunning() so a machine can never reclaim work it is itself
  // actively running. Skipped entirely on single-machine SQLite (no other workers exist).
  const staleWorkers = new Set<string>();
  if (isPostgres()) {
    try {
      for (const w of await listStaleWorkers(leaseMs() * 2)) {
        if (w.id && w.id !== WORKER_ID) staleWorkers.add(w.id);
      }
    } catch { /* workers table unavailable — skip cross-machine reclaim this tick */ }
  }
  for (const task of await allTasks()) {
    // ── stop request (set by the server, a separate process) ── kill any live agent NOW
    // and park the task out of dispatch (AVAILABLE + control 'paused') until the user resumes.
    // This is how a stop crosses the process boundary: server writes control='stop' to the
    // DB; the orchestrator (which owns the agent processes) sees it and enforces the kill.
    if (task.control === 'stop') {
      let sname: string | undefined;
      for (const [a, id] of agentTaskMap) if (id === task.id) sname = a;
      if (isTaskRunning(task.id)) {
        if (sname) { killAgent(sname); agentTaskMap.delete(sname); }
      }
      await updateTask(task.id, { status: 'AVAILABLE', control: 'paused', started: null, claimedBy: null, leaseExpiresAt: null });
      log(task.id, '⏹ stopped by user', 'warning');
      setStatus(`Stopped "${task.title}" by user request`, true);
      continue;
    }
    // ── stale-machine reclaim ── a task owned by a dead MACHINE (its worker went stale)
    // returns to the pool. Guard: never touch a task THIS process is actively running.
    if (staleWorkers.size && task.status === 'WORKING' && task.started
        && claimedByStaleWorker(task.claimedBy, staleWorkers) && !isTaskRunning(task.id)) {
      await updateTask(task.id, {
        started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null,
        attempts: 0, lastError: 'reclaimed from a stale worker (its machine stopped heartbeating)',
      });
      log(task.id, `♻ reclaimed from stale worker ${task.claimedBy} — returning to the pool for another machine`, 'warning');
      continue;
    }
    if (task.status !== 'WORKING' || !task.started || !task.leaseExpiresAt) continue;
    let name: string | undefined;
    for (const [a, id] of agentTaskMap) if (id === task.id) name = a;

    if (isTaskRunning(task.id)) {
      const runMs = now - Date.parse(task.started);
      if (name && maxRunMs() > 0 && runMs > maxRunMs()) {
        // Hard wall-clock cap: still producing output, but running far too long → looping.
        log(task.id, `⏱ hard timeout — ${name} ran ${Math.round(runMs / 60000)}min (cap ${Math.round(maxRunMs() / 60000)}min), killing (likely stuck in a loop)`, 'warning');
        killAgent(name); agentTaskMap.delete(name);
        await failTask(task, 'timeout', `exceeded ${Math.round(maxRunMs() / 60000)}min max runtime (likely looping)`);
      } else if (name && stallMs() > 0 && agentIdleMs(name) > stallMs()) {
        log(task.id, `🛑 stall — ${name} produced no output for ${Math.round(agentIdleMs(name) / 1000)}s, killing`, 'warning');
        killAgent(name); agentTaskMap.delete(name);
        await failTask(task, 'stall', 'agent stalled (no output)');
      } else {
        await updateTask(task.id, { leaseExpiresAt: new Date(now + leaseMs()).toISOString() }); // renew
      }
      continue;
    }
    if (Date.parse(task.leaseExpiresAt) > now) continue; // lease still valid
    if (name) { killAgent(name); agentTaskMap.delete(name); }
    await failTask(task, 'crash', 'watchdog: lease expired, no live agent');
  }
}

// ── main loop ──────────────────────────────────────────────────────────────────
export async function startOrchestrator(config?: AgenticConfig): Promise<void> {
  if (config) setConfig(config);
  try { mkdirSync(getConfig().paths.logsDir, { recursive: true }); writeFileSync(sysLogFile(), `── ORCHESTRATOR START ${new Date().toISOString()} ──\n`); } catch { /* disk */ }
  await getAgents(); // triggers agent-table seed
  // Register this worker in the shared DB (Phase 3). Its heartbeat (each loop tick) lets
  // other machines detect it if it dies and reclaim its tasks. Best-effort — never block boot.
  try { await registerWorker(); } catch (e: any) { log('__system__', `worker register failed: ${e?.message || e}`, 'warning'); }
  log('__system__', `🚀 orchestrator started as worker ${WORKER_ID} — up to ${MAX_AGENTS > 0 ? MAX_AGENTS : AGENT_POOL.length} agents, gated at ${CPU_HIGH_PCT}% CPU / ${MEM_HIGH_PCT}% RAM, lease ${Math.round(leaseMs() / 60000)}min, maxRun ${Math.round(maxRunMs() / 60000)}min, autoMerge ${t().autoMergeOnQaPass !== false}`, 'success');

  // Host repo not git-init'd? The default project then runs WITHOUT worktree isolation
  // or merge. Say so once, clearly — projects pointing at a cloned git repo get the full
  // pipeline. (`git init` the host to enable isolation for default-project tasks.)
  if (!isGitRepo()) log('__system__', '⚠ host repo is not a git repository — default-project tasks run in-place (no worktree isolation / no merge). Point a project at a cloned git repo for the full plan→build→qa→merge pipeline, or run `git init` here.', 'warning');

  // Reconcile on boot: a fresh process has NO live agents, so any WORKING task still
  // holding a `started` claim was orphaned when the previous process died (crash/restart).
  // Reset it (fresh attempts) so it re-dispatches cleanly instead of the watchdog
  // dead-lettering it 15 min later. This makes restarts safe for in-flight work.
  //
  // SINGLE-MACHINE ONLY: a blanket reset is safe when we are the only writer. Under
  // multi-machine Postgres it would stomp tasks OTHER live machines are running, so we
  // skip it — a restarting machine's old (now-stale) worker id is instead reclaimed by
  // the watchdog's stale-worker path once its heartbeat lapses (~2× lease).
  try {
    if (!isPostgres()) for (const task of await allTasks()) {
      if (task.status === 'WORKING' && task.started) {
        await updateTask(task.id, { started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null, attempts: 0, lastError: 'reconciled on restart' });
        log(task.id, '↻ reconciled on restart — previous agent died with the old process; re-dispatching from its last committed state', 'warning');
      }
    }
  } catch { /* non-fatal */ }

  loop();
}

async function loop(): Promise<void> {
  let n = 0;
  while (true) {
    try {
      const settings = await getBoardSettings();
      if (settings?.agentStatus === 'STARTING') {
        await updateBoardSettings({ ...settings, agentStatus: 'STARTED' });
        log('__system__', '▶ STARTED — watching for WORKING tasks', 'success');
      }
      // PAUSED keeps the orchestrator ALIVE (heartbeat + watchdog: stop requests, stalls,
      // lease reclaim still enforced) but stops handing out NEW work. STARTED resumes dispatch.
      const status = settings?.agentStatus;
      if (status === 'STARTED' || status === 'PAUSED') {
        // Heartbeat this worker (Phase 3) so peers can tell we're alive; a lapsed beat is
        // how another machine learns we died and reclaims our tasks. Best-effort.
        try { await heartbeatWorker(); } catch { /* DB busy — next tick */ }
        await watchdog();
        if (n % 10 === 0) {
          const removed = pruneOrphans(new Set((await allTasks()).map(x => x.id)));
          if (removed.length) log('__system__', `🧹 pruned orphan worktrees: ${removed.join(', ')}`, 'info');
          dbHealthCheck(log); // SQLite integrity check every ~30s
        }
        // Deep cleaner (~every 30 min): sweep orphan worktrees/branches in ALL project repos,
        // not just the host. Union task ids across projects so a live task in one project is
        // never pruned while sweeping another (ids are globally unique).
        if (n > 0 && n % CLEANER_EVERY_TICKS === 0) {
          try {
            const projects = await listProjects();
            const liveIds = new Set<string>();
            for (const p of projects) for (const tk of await getAllTasks(p.id)) liveIds.add(tk.id);
            const roots = projects.map(p => p.repoPath).filter((r): r is string => !!r);
            const removed = pruneOrphansAll(liveIds, roots);
            if (removed.length) log('__system__', `🧹 deep clean — pruned orphan worktrees across projects: ${removed.join(', ')}`, 'info');
          } catch (e: any) { log('__system__', `deep clean skipped: ${e?.message || e}`, 'warning'); }
        }
        await sampleCpu();      // refresh live CPU% for the resource gate
        // Re-read every project's workflow once per tick. Without this the document is cached
        // for the life of the process, and saving a workflow would appear to do nothing until
        // a restart. Once per tick, not once per task: a tick reads the board anyway.
        clearWorkflowCache();
        if (status === 'PAUSED') {
          setStatus('Paused by user');
        } else {
          await dispatchPending();
          // Periodic architect triage: wake one architect to review a project's in-flight tasks
          // and re-plan/nudge the stuck ones (only while actively STARTED, not while paused).
          if (TRIAGE_EVERY_TICKS > 0 && n > 0 && n % TRIAGE_EVERY_TICKS === 0) await triagePass();
          setStatus(await computeSteadyStatus()); // steady line unless a transition already set one this tick
        }
        // Beat the human-readable status line OFTEN (~every 9s) so the UI feels live…
        // Awaited so a heartbeat failure lands in this loop's try/catch (logged) rather than
        // escaping as an unhandled rejection — beatHeartbeat is async since the Store refactor.
        if (n % 3 === 0) await beatHeartbeat({ statusLine });
        // …and the fuller snapshot less often (~every 60s), alongside the periodic reconcile
        // that un-strands tasks an outside writer marked as started. Reconcile only requeues —
        // dispatchPending below decides IF and WHEN anything actually runs.
        if (n % 20 === 0) {
          await reconcileStranded();
          await beatHeartbeat({
            nextBeatAt: new Date(Date.now() + POLL_MS * 20 + 15000).toISOString(),
            activeAgents: [...agentTaskMap.entries()].map(([a, id]) => `${a}→${id}`),
            circuit: breaker.state, mode: 'headless', statusLine,
          });
        }
      }
    } catch (e: any) {
      log('__system__', `loop error: ${e?.message || e}`, 'error');
    }
    n++;
    await sleep(POLL_MS);
  }
}
