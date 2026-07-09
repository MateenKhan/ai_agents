// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — the orchestrator (the brain)
// Routes tasks through plan → build → qa → merge, tiers models per role, isolates
// work in worktrees, and keeps the whole thing alive unattended: circuit breaker
// (API outages), watchdog + stall detector, resource gate, backoff/dead-letter,
// orphan cleanup, heartbeat. Single writer — only this process merges.
// ─────────────────────────────────────────────────────────────────────────────

import https from 'node:https';
import http from 'node:http';
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
    const removed = reconcileContext(pid, listRepoFiles(await repoCwdFor(taskId)));
    if (removed.length) log(taskId, `🧹 context: dropped ${removed.length} file(s) deleted by the merge`, 'info');
  } catch { /* context reconcile is best-effort — never block a merge */ }
}
import type { AgenticConfig, AgentConfig, AgentRole, Task, Stage, FailureKind, WorktreeMode, RunResult } from '../types';
import { setConfig, getConfig } from '../runtime-context';
import {
  getAllTasks, getTask, updateTask, getBoardSettings, updateBoardSettings, beatHeartbeat, getTasksDb, getProject, listProjects, getAgentDefaults,
} from '../db/tasks';
import { addAgentLog, getLogsDb } from '../db/logs';
import { getAgents } from '../db/agents';
import { renderPrompt } from './prompts';
import {
  spawnHeadlessAgent, isAgentBusy, isTaskRunning, agentIdleMs, killAgent,
  removeWorktree, removePlanWorktree, pruneOrphans, pruneOrphansAll, isGitRepo,
} from './runner';
import { reconcileContext } from '../db/context';
import { listRepoFiles } from './repo-files';

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
const sysLogFile = () => join(getConfig().paths.logsDir, 'orchestrator.log');
const log = (taskId: string, msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
  const line = `[${new Date().toISOString()}] ${taskId === '__system__' ? '' : `[${taskId}] `}${msg}`;
  try { console.log('[ai]', line); } catch { /* stdout closed */ }
  try { addAgentLog(taskId, msg, type); } catch { /* logs.db busy */ }
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
  if (beat) { try { beatHeartbeat({ statusLine }); } catch { /* logs busy */ } }
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
const DB_HEALTH_URL = `http://127.0.0.1:${process.env.DB_SERVER_PORT || '6952'}/health`;
const dbBreaker = { state: 'closed' as 'closed' | 'open' };
let dbProbing = false;
let lastDbSpawnAt = 0;

function probeDbServer(): Promise<boolean> {
  return new Promise(res => {
    const req = http.get(DB_HEALTH_URL, r => { r.resume(); res((r.statusCode ?? 0) >= 200 && (r.statusCode ?? 0) < 500); });
    req.on('error', () => res(false));
    req.setTimeout(2500, () => { req.destroy(); res(false); });
  });
}
function dbBreakerAllows(): boolean { return dbBreaker.state !== 'open'; }

/** Fallback heal (Layer 2b): spawn a fresh db-server if the health probe keeps failing.
 *  Rate-limited so we never spawn a storm — if the daemon is merely slow (or Layer-1's
 *  supervisor already respawned it), the duplicate loses the port race and exits harmlessly. */
function trySpawnDbServer(): void {
  if (Date.now() - lastDbSpawnAt < 20000) return; // one attempt per ~20s
  lastDbSpawnAt = Date.now();
  try {
    log('__system__', '🩹 spawning a fresh db-server (fallback heal)…', 'warning');
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
    if (++fails >= 2) trySpawnDbServer(); // give Layer-1's supervisor a beat, then spawn as fallback
    setTimeout(tick, 5000);
  });
  tick();
}

// How many times a task may be escalated to the architect for a re-plan before it
// dead-letters to BLOCKED (env RESCUE_MAX, default 1 — one re-plan then human).
const MAX_RESCUE = Math.max(0, parseInt(process.env.RESCUE_MAX || '') || 1);

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

/** Periodic SQLite integrity check — warns loudly if a board DB is corrupt. */
function dbHealthCheck(logFn: (id: string, m: string, t?: 'info' | 'success' | 'warning' | 'error') => void): void {
  for (const [name, conn] of [['tasks.db', getTasksDb()], ['logs.db', getLogsDb()]] as [string, any][]) {
    try {
      const r: any = conn.prepare('PRAGMA quick_check').get();
      const val = r ? (r.quick_check ?? Object.values(r)[0]) : 'unknown';
      if (val !== 'ok') logFn('__system__', `🩺 DB CORRUPT: ${name} failed quick_check (${val}) — restore/rebuild needed`, 'error');
    } catch (e: any) { logFn('__system__', `🩺 DB CORRUPT: ${name} — ${e?.message}`, 'error'); }
  }
}

// ── stage routing ──────────────────────────────────────────────────────────────
interface Routed { role: AgentRole; stage: Stage; }

function nextRoute(task: Task): Routed | null {
  const tg = t();
  let stage: Stage = task.stage || 'plan';
  if (stage === 'plan') {
    if (tg.enableArchitect === false) stage = 'build';
    else return { role: 'architect', stage: 'plan' };
  }
  if (stage === 'build') return { role: 'dev', stage: 'build' };
  if (stage === 'qa') {
    if (tg.enableQa === false) stage = 'merge';
    else return { role: 'qa', stage: 'qa' };
  }
  // Rescue: a dev/qa stage exhausted its retries → architect re-plans (read-only), then
  // hands back to 'build'. Disabled installs (no architect) skip straight to dead-letter.
  if (stage === 'rescue') {
    if (tg.enableArchitect === false) return null;
    return { role: 'architect', stage: 'rescue' };
  }
  if (stage === 'merge') return { role: 'architect', stage: 'merge' };
  return null; // 'merged' / unknown → not dispatchable
}

async function agentMap(): Promise<Record<string, AgentConfig>> {
  const m: Record<string, AgentConfig> = {};
  for (const a of await getAgents()) m[a.role] = a;
  return m;
}
function modelFor(role: AgentRole, a: AgentConfig): string { return getConfig().models?.[role] || a.model; }
function worktreeFor(role: AgentRole, stage: string, a: AgentConfig): WorktreeMode {
  return (role === 'architect' && stage === 'merge') ? 'none' : a.worktreeMode;
}
function getAvailableAgent(): string | null {
  for (const n of AGENT_POOL) if (!agentTaskMap.has(n) && !isAgentBusy(n)) return n;
  return null;
}

/** True if a merge is currently running. Only ONE merge may touch the shared repo root
 *  at a time — `git merge` mutates the working tree/index, so two concurrent merges in
 *  the same checkout corrupt each other. A second approved task waits its turn. */
async function mergeInFlight(): Promise<boolean> {
  for (const id of agentTaskMap.values()) {
    if ((await getTask(id))?.stage === 'merge') return true;
  }
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
async function scheduleRetry(id: string, attempts: number, note: string): Promise<void> {
  const backoff = Math.min(5 * 60 * 1000, 5000 * 2 ** attempts);
  await updateTask(id, { nextRetryAt: new Date(Date.now() + backoff).toISOString(), started: null, claimedBy: null, lastError: note });
  log(id, `↻ retry in ${Math.round(backoff / 1000)}s (attempt ${attempts}) — ${note}`, 'warning');
}
async function deadLetter(id: string, note: string): Promise<void> {
  // Move to BLOCKED (not left in WORKING) so the failure is VISIBLE on the board with
  // its reason, instead of a stuck task masquerading as active. Heal/human can revive.
  await updateTask(id, { status: 'BLOCKED', started: null, claimedBy: null, nextRetryAt: DEAD_LETTER_AT, lastError: note });
  log(id, `☠ dead-letter → BLOCKED — ${note}. Fix the cause and re-trigger, or Heal to retry.`, 'error');
}
async function failTask(task: Task, kind: FailureKind, note: string): Promise<void> {
  breakerFailure(kind);
  const attempts = task.attempts || 0;
  if (attempts < maxAttempts()) { await scheduleRetry(task.id, attempts, note); return; }
  // Retries exhausted. A genuine dev/qa failure gets ONE architect rescue (re-plan) before we
  // give up — the architect diagnoses and hands a fresh brief back to the dev. Architect-stage
  // failures (plan/rescue/merge) and rescue-budget exhaustion dead-letter straight to BLOCKED.
  const stage = task.stage;
  const canRescue = (stage === 'build' || stage === 'qa')
    && (task.rescueCount || 0) < MAX_RESCUE
    && t().enableArchitect !== false; // no architect enabled → nobody to re-plan
  if (canRescue) {
    await escalateToArchitect(task, `${maxAttempts()} attempts exhausted (${note})`);
  } else {
    await deadLetter(task.id, `${maxAttempts()} attempts exhausted (${note})`);
  }
}

/** Route a repeatedly-failing dev/qa task to the architect for a re-plan, then back to the dev.
 *  Resets the per-stage retry budget (attempts) and records the rescue so a task that keeps
 *  failing even after re-planning eventually dead-letters instead of looping. */
async function escalateToArchitect(task: Task, note: string): Promise<void> {
  const failedStage = task.stage;
  // rescueCount is incremented at DISPATCH (see dispatchPending) so the cap applies uniformly
  // whether the rescue was triggered here OR by a dev/qa self-reporting that it's blocked.
  await updateTask(task.id, {
    stage: 'rescue', status: 'WORKING',
    started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null,
    attempts: 0, lastError: note,
    reviewNote: `RESCUE NEEDED — the ${failedStage} stage failed and could not self-recover (${note}). Diagnose the root cause and REVISE the plan so a fresh dev can succeed; do not just repeat the old brief.`,
  });
  log(task.id, `🩺 ${failedStage} exhausted retries → ARCHITECT rescue — re-planning`, 'warning');
  setStatus(`Rescuing "${task.title}" — architect re-planning after ${failedStage} failures`, true);
}

// ── periodic architect triage pass ────────────────────────────────────────────
const DB_PORT = process.env.DB_SERVER_PORT || '6952';
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
    const cands = (await getAllTasks(pid)).filter(x =>
      (x.status === 'WORKING' || x.status === 'TESTING')
      && !!x.stage && ['build', 'qa', 'review', 'rescue'].includes(x.stage)
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
    prompt: triagePromptFor(pid, tasks), model: modelFor('architect', arch), worktree: 'none',
    onExit: (r) => { release(); log('__system__', `🔭 architect triage done (${pid}, ${tasks.length} task(s), ${r.failure})`, r.failure === 'none' ? 'success' : 'warning'); },
  });
  if (ok) { log('__system__', `🔭 architect triage — reviewing ${tasks.length} in-flight task(s) in project ${pid}`, 'info'); setStatus(`Architect triage — reviewing ${tasks.length} task(s) in ${pid}`, true); }
  else release();
}

// ── dispatch ─────────────────────────────────────────────────────────────────
async function dispatch(task: Task, route: Routed, ac: AgentConfig, name: string): Promise<void> {
  const attempts = (task.attempts || 0) + 1;
  const model = modelFor(route.role, ac);
  const wt = worktreeFor(route.role, route.stage, ac);
  let prompt: string;
  try { prompt = await renderPrompt(ac, task, route.stage); }
  catch (e: any) { await scheduleRetry(task.id, attempts, `prompt render failed: ${e?.message || e}`); return; }

  await updateTask(task.id, {
    claimedBy: name, started: new Date().toISOString(), attempts,
    leaseExpiresAt: new Date(Date.now() + leaseMs()).toISOString(),
    nextRetryAt: null, lastError: null, model,
  });
  agentTaskMap.set(name, task.id);

  const ok = await spawnHeadlessAgent({
    agentName: name, taskId: task.id, role: route.role, prompt, model, worktree: wt,
    onExit: (r) => { handleAgentExit(name, task.id, route, r).catch(e => log(task.id, `exit handler error: ${e?.message || e}`, 'error')); },
  });
  if (ok) log(task.id, `🚀 ${route.role} (${model}) as ${name} — stage ${route.stage}, attempt ${attempts}/${maxAttempts()}`, 'success');
  else { agentTaskMap.delete(name); await scheduleRetry(task.id, attempts, 'spawn failed'); }
}

async function dispatchPending(): Promise<void> {
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
    // QA passed → human review gate (PRE-merge). Park it in Human Review, keep the
    // worktree so a preview can be built, and don't dispatch until the human approves.
    if (task.stage === 'review') {
      await updateTask(task.id, { status: 'TESTING', started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null });
      log(task.id, '🧑‍⚖️ QA passed — awaiting your review (build a preview, then approve to merge)', 'success');
      continue;
    }
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
    const route = nextRoute(task);
    if (!route) continue;
    // Already merged? Don't re-run the merge agent — it's approved, mark it done.
    if (route.role === 'architect' && route.stage === 'merge' && await isMergedIntoHead(task.id)) {
      await removeWorktree(task.id);
      await reconcileContextAfterMerge(task.id);
      await updateTask(task.id, { status: 'DONE', stage: 'merged', completed: new Date().toISOString(), started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null });
      log(task.id, '🔀 already merged — approved & done', 'success');
      continue;
    }
    // MERGE LOCK — serialize merges into the shared repo root. If one is already running,
    // leave this approved task pending and pick it up on a later tick (order preserved).
    if (route.role === 'architect' && route.stage === 'merge' && await mergeInFlight()) continue;
    // RESCUE BUDGET — enforced here so it covers BOTH triggers: the orchestrator's own
    // auto-escalation AND a dev/qa self-reporting it's blocked (PUT stage="rescue"). Cap the
    // number of architect re-plans so a task can't loop rescue→build→rescue forever.
    if (route.stage === 'rescue') {
      const rc = task.rescueCount || 0;
      if (rc >= MAX_RESCUE) {
        await deadLetter(task.id, `rescue budget exhausted (${MAX_RESCUE} re-plan${MAX_RESCUE === 1 ? '' : 's'}) — still blocked, needs a human`);
        continue;
      }
      await updateTask(task.id, { rescueCount: rc + 1 });
      log(task.id, `🩺 architect rescue pass ${rc + 1}/${MAX_RESCUE} — re-planning`, 'warning');
    }
    if (task.stage !== route.stage) { await updateTask(task.id, { stage: route.stage }); task.stage = route.stage; }
    const ac = agents[route.role];
    if (!ac || !ac.enabled) continue;
    const name = getAvailableAgent();
    if (!name) break;
    // Live status: name the work about to start (merge reads its target branch).
    if (route.role === 'architect' && route.stage === 'merge') setStatus(`Merging "${task.title}" into ${await currentBranch(task.id)}`, true);
    else setStatus(`Dispatching ${route.stage.toUpperCase()} for "${task.title}" → ${route.role}`, true);
    await dispatch(task, route, ac, name);
  }
}

// ── exit handling ──────────────────────────────────────────────────────────────
function refreshIndex(): void {
  try { getConfig().codeIndex?.refresh?.(m => log('__system__', m, 'info')); } catch { /* optional */ }
}

async function handleAgentExit(name: string, taskId: string, route: Routed, r: RunResult): Promise<void> {
  agentTaskMap.delete(name);
  // plan + rescue both run the architect in a throwaway read-only worktree — drop it on exit.
  if (route.role === 'architect' && (route.stage === 'plan' || route.stage === 'rescue')) await removePlanWorktree(taskId);

  const fresh = await getTask(taskId);
  if (!fresh) return;

  // Record actual time THIS run took, accumulated per role (for Analytics: who took how long).
  if (r.durationMs) {
    const timings: Record<string, number> = { ...(fresh.stageTimings || {}) };
    timings[route.role] = (timings[route.role] || 0) + r.durationMs;
    await updateTask(taskId, { stageTimings: timings });
    fresh.stageTimings = timings;
  }

  // The agent advances its stage (or verdict) via the API when it succeeds.
  const advanced = fresh.stage !== route.stage || fresh.status === 'TESTING' || fresh.status === 'DONE';

  if (r.failure === 'none' && advanced) {
    breakerSuccess();
    // Clear started/claimedBy so the NEXT stage gets dispatched — the agent already
    // advanced the `stage` field, and dispatch only picks up WORKING && !started.
    // Reset attempts to 0 so maxAttempts counts RETRIES PER STAGE, not cumulative
    // dispatches across stages (which used to dead-letter every task at the merge stage).
    await updateTask(taskId, { started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null, lastError: null, attempts: 0 });

    if (route.role === 'qa' && fresh.qaVerdict === 'fail' && fresh.reviewNote) {
      getConfig().memory?.remember({ taskId, role: 'qa', kind: 'gotcha', text: `QA failed: ${fresh.reviewNote}` }).catch(() => {});
    }
    // ENFORCE review-before-merge in the control plane: whatever stage the qa agent set
    // (old prompts route to 'merge'), a PASS always goes to Human Review first. The human
    // previews the branch and approves; only /approve advances it to merge. This makes the
    // gate independent of the agent prompt, so it can't be skipped by a stale qa template.
    if (route.role === 'qa' && fresh.qaVerdict === 'pass' && fresh.stage !== 'review') {
      await updateTask(taskId, { stage: 'review' });
      log(taskId, '🔎 QA passed → Human Review (preview + approve before merge)', 'info');
    }
    if (route.role === 'architect' && route.stage === 'merge') {
      await removeWorktree(taskId);            // merged → drop the dev worktree
      await reconcileContextAfterMerge(taskId); // merged → drop context entries for files the merge deleted
      refreshIndex();
      await updateTask(taskId, { status: 'DONE', completed: new Date().toISOString() }); // human already approved pre-merge
      log(taskId, '🔀 merged into current branch — approved & done', 'success');
      setStatus(`Merged "${fresh.title}" — done`, true);
    } else if (route.stage === 'rescue') {
      // Architect re-planned and handed back to the dev — clear the stale RESCUE note so the
      // dev works from the fresh {{plan}}, not the old failure feedback.
      await updateTask(taskId, { reviewNote: null });
      log(taskId, `✅ architect re-planned (rescue) → back to dev at stage ${(await getTask(taskId))?.stage}`, 'success');
    } else {
      const newStage = (await getTask(taskId))?.stage;
      const ROUTABLE = ['plan', 'build', 'qa', 'review', 'merge', 'merged', 'rescue'];
      if (!newStage || !ROUTABLE.includes(newStage)) {
        // The agent advanced to an unknown/non-pipeline stage (e.g. an architect declaring a
        // task impossible by inventing stage="blocked"). Left alone it sits un-dispatchable in
        // WORKING forever — surface it as a real BLOCKED so it's visible and can be healed.
        await deadLetter(taskId, `agent set an unroutable stage "${newStage}" at ${route.stage} — task cannot proceed as briefed (see its summary/note)`);
      } else {
        log(taskId, `✅ ${route.role} finished ${route.stage} → stage ${newStage}`, 'success');
      }
    }
    return;
  }

  // MERGE CONFLICT KICKBACK — a merge that didn't land (the architect couldn't cleanly
  // integrate task/<id> into the base branch) bounces the task back to the DEV to rebase
  // its branch onto the base, re-commit, then re-run qa → review → merge. This is the
  // "one merge active; on conflict the dev rebases" policy, enforced in the control plane
  // so it holds even with a stale merge prompt. Network failures are NOT conflicts — let
  // those retry the merge via the breaker/backoff instead of forcing a full dev cycle.
  if (route.role === 'architect' && route.stage === 'merge' && r.failure !== 'network' && !(await isMergedIntoHead(taskId))) {
    // Abort any half-applied merge so the working tree is clean for the next task.
    try { execSync('git merge --abort', { stdio: 'pipe', cwd: await repoCwdFor(taskId) }); } catch { /* nothing to abort */ }
    const MAX_MERGE_BOUNCES = 3;
    const bounces = (fresh.mergeBounces || 0) + 1;
    if (bounces > MAX_MERGE_BOUNCES) {
      await deadLetter(taskId, `merge still conflicts after ${MAX_MERGE_BOUNCES} rebase attempts — needs a human`);
      return;
    }
    breakerSuccess(); // a merge conflict is not an API outage
    const base = await currentBranch(taskId);
    await updateTask(taskId, {
      stage: 'build', qaVerdict: null, status: 'WORKING',
      started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null, lastError: null,
      attempts: 0, mergeBounces: bounces,
      reviewNote: `MERGE CONFLICT: your branch task/${taskId} no longer merges cleanly into ${base}. Reconcile it: run \`git rebase ${base}\` (or \`git merge ${base}\` into your branch), resolve the conflicts, re-run the sanity checks, and re-commit. Do NOT change scope — only bring your branch up to date with ${base}.`,
    });
    log(taskId, `↩ merge conflict — bounced to DEV to rebase onto ${base} (attempt ${bounces}/${MAX_MERGE_BOUNCES})`, 'warning');
    setStatus(`Merge conflict on "${fresh.title}" — sent back to dev to rebase onto ${base}`, true);
    return;
  }

  // Exited without advancing. Before blaming the agent, rule out an INFRA fault: an agent that
  // finished cleanly (failure 'none') but didn't advance its stage may simply have been unable to
  // REACH the db-server for its callback. If 6952 is down, that's infra — heal it and requeue the
  // SAME stage WITHOUT burning a retry, instead of marching the task toward BLOCKED.
  if (r.failure === 'none') {
    const dbUp = await probeDbServer();
    if (!dbUp) {
      openDbBreaker('an agent finished but its stage-advance callback could not reach the db-server');
      await updateTask(taskId, {
        started: null, claimedBy: null, leaseExpiresAt: null,
        nextRetryAt: new Date(Date.now() + 8000).toISOString(),
        attempts: Math.max(0, (fresh.attempts || 1) - 1), // do NOT count an infra fault against the budget
        lastError: 'db-server unreachable — infra fault; will resume when healed',
      });
      log(taskId, `🩹 ${route.stage} did not advance, but db-server was DOWN — infra fault, not the agent; will retry the same stage once healed`, 'warning');
      return;
    }
  }

  // Genuine failure (crash, timeout, stall, or finished-but-skipped-callback with db healthy).
  const note = r.failure === 'none' ? 'exited without advancing the stage (missing callback)' : `${r.failure}: ${r.outputTail.slice(-200)}`;
  log(taskId, `❌ ${name} failed at ${route.stage} — ${note}`, 'error');
  await failTask((await getTask(taskId)) || fresh, r.failure === 'none' ? 'crash' : r.failure, note);
}

// ── watchdog + stall ─────────────────────────────────────────────────────────
async function watchdog(): Promise<void> {
  const now = Date.now();
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
  log('__system__', `🚀 orchestrator started — up to ${MAX_AGENTS > 0 ? MAX_AGENTS : AGENT_POOL.length} agents, gated at ${CPU_HIGH_PCT}% CPU / ${MEM_HIGH_PCT}% RAM, lease ${Math.round(leaseMs() / 60000)}min, maxRun ${Math.round(maxRunMs() / 60000)}min, autoMerge ${t().autoMergeOnQaPass !== false}`, 'success');

  // Host repo not git-init'd? The default project then runs WITHOUT worktree isolation
  // or merge. Say so once, clearly — projects pointing at a cloned git repo get the full
  // pipeline. (`git init` the host to enable isolation for default-project tasks.)
  if (!isGitRepo()) log('__system__', '⚠ host repo is not a git repository — default-project tasks run in-place (no worktree isolation / no merge). Point a project at a cloned git repo for the full plan→build→qa→merge pipeline, or run `git init` here.', 'warning');

  // Reconcile on boot: a fresh process has NO live agents, so any WORKING task still
  // holding a `started` claim was orphaned when the previous process died (crash/restart).
  // Reset it (fresh attempts) so it re-dispatches cleanly instead of the watchdog
  // dead-lettering it 15 min later. This makes restarts safe for in-flight work.
  try {
    for (const task of await allTasks()) {
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
        if (n % 3 === 0) beatHeartbeat({ statusLine });
        // …and the fuller snapshot less often (~every 60s).
        if (n % 20 === 0) {
          beatHeartbeat({
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
