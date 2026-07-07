// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — the orchestrator (the brain)
// Routes tasks through plan → build → qa → merge, tiers models per role, isolates
// work in worktrees, and keeps the whole thing alive unattended: circuit breaker
// (API outages), watchdog + stall detector, resource gate, backoff/dead-letter,
// orphan cleanup, heartbeat. Single writer — only this process merges.
// ─────────────────────────────────────────────────────────────────────────────

import https from 'node:https';
import os from 'node:os';
import { appendFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

/** The git repo a task's merge/ancestry checks run in. Project-scoped: a task in a
 *  project with a valid repoPath uses THAT repo; anything else → the host cwd (so the
 *  default single-project flow is byte-for-byte unchanged). Mirrors runner.projectRootFor. */
function repoCwdFor(taskId: string): string {
  try {
    const tk = getTask(taskId);
    const pid = tk?.projectId || 'default';
    if (pid && pid !== 'default') {
      const proj = getProject(pid);
      if (proj?.repoPath && existsSync(proj.repoPath)) return proj.repoPath;
    }
  } catch { /* missing project/db → host cwd */ }
  return process.cwd();
}

/** True if the task's branch is already merged into the current HEAD (in its project repo). */
function isMergedIntoHead(taskId: string): boolean {
  try { execSync(`git merge-base --is-ancestor task/${taskId} HEAD`, { stdio: 'pipe', cwd: repoCwdFor(taskId) }); return true; }
  catch { return false; }
}

/** Current branch name in a task's project repo (for readable "Merging into <branch>"). */
function currentBranch(taskId: string): string {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { stdio: 'pipe', cwd: repoCwdFor(taskId) }).toString().trim() || 'HEAD'; }
  catch { return 'HEAD'; }
}
import type { AgenticConfig, AgentConfig, AgentRole, Task, Stage, FailureKind, WorktreeMode, RunResult } from '../types';
import { setConfig, getConfig } from '../runtime-context';
import {
  getAllTasks, getTask, updateTask, getBoardSettings, updateBoardSettings, beatHeartbeat, getTasksDb, getProject,
} from '../db/tasks';
import { addAgentLog, getLogsDb } from '../db/logs';
import { getAgents } from '../db/agents';
import { renderPrompt } from './prompts';
import {
  spawnHeadlessAgent, isAgentBusy, isTaskRunning, agentIdleMs, killAgent,
  removeWorktree, removePlanWorktree, pruneOrphans, isGitRepo,
} from './runner';

const POLL_MS = 3000;
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
function computeSteadyStatus(): string {
  if (breaker.state === 'open') return '⛔ Anthropic API unreachable — dispatch paused, retrying every 15s';
  const working = agentTaskMap.size;
  const pending = getAllTasks().filter(
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
  if (stage === 'merge') return { role: 'architect', stage: 'merge' };
  return null; // 'merged' / unknown → not dispatchable
}

function agentMap(): Record<string, AgentConfig> {
  const m: Record<string, AgentConfig> = {};
  for (const a of getAgents()) m[a.role] = a;
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

// ── retry / dead-letter ──────────────────────────────────────────────────────
function scheduleRetry(id: string, attempts: number, note: string): void {
  const backoff = Math.min(5 * 60 * 1000, 5000 * 2 ** attempts);
  updateTask(id, { nextRetryAt: new Date(Date.now() + backoff).toISOString(), started: null, claimedBy: null, lastError: note });
  log(id, `↻ retry in ${Math.round(backoff / 1000)}s (attempt ${attempts}) — ${note}`, 'warning');
}
function deadLetter(id: string, note: string): void {
  // Move to BLOCKED (not left in WORKING) so the failure is VISIBLE on the board with
  // its reason, instead of a stuck task masquerading as active. Heal/human can revive.
  updateTask(id, { status: 'BLOCKED', started: null, claimedBy: null, nextRetryAt: DEAD_LETTER_AT, lastError: note });
  log(id, `☠ dead-letter → BLOCKED — ${note}. Fix the cause and re-trigger, or Heal to retry.`, 'error');
}
function failTask(task: Task, kind: FailureKind, note: string): void {
  breakerFailure(kind);
  const attempts = task.attempts || 0;
  if (attempts >= maxAttempts()) deadLetter(task.id, `${maxAttempts()} attempts exhausted (${note})`);
  else scheduleRetry(task.id, attempts, note);
}

// ── dispatch ─────────────────────────────────────────────────────────────────
async function dispatch(task: Task, route: Routed, ac: AgentConfig, name: string): Promise<void> {
  const attempts = (task.attempts || 0) + 1;
  const model = modelFor(route.role, ac);
  const wt = worktreeFor(route.role, route.stage, ac);
  let prompt: string;
  try { prompt = await renderPrompt(ac, task, route.stage); }
  catch (e: any) { scheduleRetry(task.id, attempts, `prompt render failed: ${e?.message || e}`); return; }

  updateTask(task.id, {
    claimedBy: name, started: new Date().toISOString(), attempts,
    leaseExpiresAt: new Date(Date.now() + leaseMs()).toISOString(),
    nextRetryAt: null, lastError: null, model,
  });
  agentTaskMap.set(name, task.id);

  const ok = spawnHeadlessAgent({
    agentName: name, taskId: task.id, role: route.role, prompt, model, worktree: wt,
    onExit: (r) => handleAgentExit(name, task.id, route, r),
  });
  if (ok) log(task.id, `🚀 ${route.role} (${model}) as ${name} — stage ${route.stage}, attempt ${attempts}/${maxAttempts()}`, 'success');
  else { agentTaskMap.delete(name); scheduleRetry(task.id, attempts, 'spawn failed'); }
}

async function dispatchPending(): Promise<void> {
  const now = Date.now();
  const pending = getAllTasks().filter(
    // 'paused' holds a task out of dispatch; 'stop' is a kill-now request handled by the
    // watchdog — neither should be dispatched here.
    x => x.status === 'WORKING' && !x.started && x.control !== 'paused' && x.control !== 'stop'
      && (!x.nextRetryAt || Date.parse(x.nextRetryAt) <= now)
  );
  if (!pending.length || !breakerAllows()) return;

  const agents = agentMap();
  for (const task of pending) {
    // QA passed → human review gate (PRE-merge). Park it in Human Review, keep the
    // worktree so a preview can be built, and don't dispatch until the human approves.
    if (task.stage === 'review') {
      updateTask(task.id, { status: 'TESTING', started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null });
      log(task.id, '🧑‍⚖️ QA passed — awaiting your review (build a preview, then approve to merge)', 'success');
      continue;
    }
    if (!canSpawn(agentTaskMap.size)) break;
    const route = nextRoute(task);
    if (!route) continue;
    // Already merged? Don't re-run the merge agent — it's approved, mark it done.
    if (route.role === 'architect' && route.stage === 'merge' && isMergedIntoHead(task.id)) {
      removeWorktree(task.id);
      updateTask(task.id, { status: 'DONE', stage: 'merged', completed: new Date().toISOString(), started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null });
      log(task.id, '🔀 already merged — approved & done', 'success');
      continue;
    }
    if (task.stage !== route.stage) { updateTask(task.id, { stage: route.stage }); task.stage = route.stage; }
    const ac = agents[route.role];
    if (!ac || !ac.enabled) continue;
    const name = getAvailableAgent();
    if (!name) break;
    // Live status: name the work about to start (merge reads its target branch).
    if (route.role === 'architect' && route.stage === 'merge') setStatus(`Merging "${task.title}" into ${currentBranch(task.id)}`, true);
    else setStatus(`Dispatching ${route.stage.toUpperCase()} for "${task.title}" → ${route.role}`, true);
    await dispatch(task, route, ac, name);
  }
}

// ── exit handling ──────────────────────────────────────────────────────────────
function refreshIndex(): void {
  try { getConfig().codeIndex?.refresh?.(m => log('__system__', m, 'info')); } catch { /* optional */ }
}

function handleAgentExit(name: string, taskId: string, route: Routed, r: RunResult): void {
  agentTaskMap.delete(name);
  if (route.role === 'architect' && route.stage === 'plan') removePlanWorktree(taskId);

  const fresh = getTask(taskId);
  if (!fresh) return;

  // Record actual time THIS run took, accumulated per role (for Analytics: who took how long).
  if (r.durationMs) {
    const timings: Record<string, number> = { ...(fresh.stageTimings || {}) };
    timings[route.role] = (timings[route.role] || 0) + r.durationMs;
    updateTask(taskId, { stageTimings: timings });
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
    updateTask(taskId, { started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null, lastError: null, attempts: 0 });

    if (route.role === 'qa' && fresh.qaVerdict === 'fail' && fresh.reviewNote) {
      getConfig().memory?.remember({ taskId, role: 'qa', kind: 'gotcha', text: `QA failed: ${fresh.reviewNote}` }).catch(() => {});
    }
    // ENFORCE review-before-merge in the control plane: whatever stage the qa agent set
    // (old prompts route to 'merge'), a PASS always goes to Human Review first. The human
    // previews the branch and approves; only /approve advances it to merge. This makes the
    // gate independent of the agent prompt, so it can't be skipped by a stale qa template.
    if (route.role === 'qa' && fresh.qaVerdict === 'pass' && fresh.stage !== 'review') {
      updateTask(taskId, { stage: 'review' });
      log(taskId, '🔎 QA passed → Human Review (preview + approve before merge)', 'info');
    }
    if (route.role === 'architect' && route.stage === 'merge') {
      removeWorktree(taskId);            // merged → drop the dev worktree
      refreshIndex();
      updateTask(taskId, { status: 'DONE', completed: new Date().toISOString() }); // human already approved pre-merge
      log(taskId, '🔀 merged into current branch — approved & done', 'success');
      setStatus(`Merged "${fresh.title}" — done`, true);
    } else {
      log(taskId, `✅ ${route.role} finished ${route.stage} → stage ${getTask(taskId)?.stage}`, 'success');
    }
    return;
  }

  // Exited without advancing (crashed, or finished but skipped its callback) → failure.
  const note = r.failure === 'none' ? 'exited without advancing the stage (missing callback)' : `${r.failure}: ${r.outputTail.slice(-200)}`;
  log(taskId, `❌ ${name} failed at ${route.stage} — ${note}`, 'error');
  failTask(fresh, r.failure === 'none' ? 'crash' : r.failure, note);
}

// ── watchdog + stall ─────────────────────────────────────────────────────────
function watchdog(): void {
  const now = Date.now();
  for (const task of getAllTasks()) {
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
      updateTask(task.id, { status: 'AVAILABLE', control: 'paused', started: null, claimedBy: null, leaseExpiresAt: null });
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
        failTask(task, 'timeout', `exceeded ${Math.round(maxRunMs() / 60000)}min max runtime (likely looping)`);
      } else if (name && stallMs() > 0 && agentIdleMs(name) > stallMs()) {
        log(task.id, `🛑 stall — ${name} produced no output for ${Math.round(agentIdleMs(name) / 1000)}s, killing`, 'warning');
        killAgent(name); agentTaskMap.delete(name);
        failTask(task, 'stall', 'agent stalled (no output)');
      } else {
        updateTask(task.id, { leaseExpiresAt: new Date(now + leaseMs()).toISOString() }); // renew
      }
      continue;
    }
    if (Date.parse(task.leaseExpiresAt) > now) continue; // lease still valid
    if (name) { killAgent(name); agentTaskMap.delete(name); }
    failTask(task, 'crash', 'watchdog: lease expired, no live agent');
  }
}

// ── main loop ──────────────────────────────────────────────────────────────────
export function startOrchestrator(config?: AgenticConfig): void {
  if (config) setConfig(config);
  try { mkdirSync(getConfig().paths.logsDir, { recursive: true }); writeFileSync(sysLogFile(), `── ORCHESTRATOR START ${new Date().toISOString()} ──\n`); } catch { /* disk */ }
  getAgents(); // triggers agent-table seed
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
    for (const task of getAllTasks()) {
      if (task.status === 'WORKING' && task.started) {
        updateTask(task.id, { started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null, attempts: 0, lastError: 'reconciled on restart' });
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
      const settings = getBoardSettings();
      if (settings?.agentStatus === 'STARTING') {
        updateBoardSettings({ ...settings, agentStatus: 'STARTED' });
        log('__system__', '▶ STARTED — watching for WORKING tasks', 'success');
      }
      // PAUSED keeps the orchestrator ALIVE (heartbeat + watchdog: stop requests, stalls,
      // lease reclaim still enforced) but stops handing out NEW work. STARTED resumes dispatch.
      const status = settings?.agentStatus;
      if (status === 'STARTED' || status === 'PAUSED') {
        watchdog();
        if (n % 10 === 0) {
          const removed = pruneOrphans(new Set(getAllTasks().map(x => x.id)));
          if (removed.length) log('__system__', `🧹 pruned orphan worktrees: ${removed.join(', ')}`, 'info');
          dbHealthCheck(log); // SQLite integrity check every ~30s
        }
        await sampleCpu();      // refresh live CPU% for the resource gate
        if (status === 'PAUSED') {
          setStatus('Paused by user');
        } else {
          await dispatchPending();
          setStatus(computeSteadyStatus()); // steady line unless a transition already set one this tick
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
