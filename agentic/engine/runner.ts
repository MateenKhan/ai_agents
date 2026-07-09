// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — headless agent runner
// Spawns `claude -p` as a child process per task. No WSL/tmux/IDE. Handles:
//  - per-role model tiering (--model)
//  - git-worktree isolation (plan / create / reuse / none)
//  - a FRESH log per run (the Logs tab always shows the current run)
//  - stream-json parsing into readable action lines (search / read / edit / cmd)
//  - failure classification for the circuit breaker + stall detection
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, appendFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { RunResult, FailureKind, WorktreeMode, AgentRole } from '../types';
import { getConfig } from '../runtime-context';
import { resolveAgentToken, gitAuthEnv, getTask, getProject } from '../db/tasks';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_FLAGS = (process.env.CLAUDE_FLAGS || '--dangerously-skip-permissions').split(' ').filter(Boolean);
const AGENT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || String(30 * 60 * 1000));

export interface SpawnOptions {
  agentName: string;
  taskId: string;
  role: AgentRole;
  prompt: string;
  model: string;
  worktree: WorktreeMode;
  onExit: (result: RunResult) => void;
}

interface RunningAgent {
  proc: ChildProcess;
  taskId: string;
  startedAt: number;
  lastOutputAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const running = new Map<string, RunningAgent>();

// ── git worktree isolation ─────────────────────────────────────────────────────

function git(cmd: string, cwd?: string): void {
  execSync(`git ${cmd}`, { stdio: 'pipe', cwd: cwd || process.cwd() });
}

/** Is `cwd` inside a git work tree? Cheap, stderr-suppressed — lets the pipeline
 *  degrade gracefully (run without worktree isolation) when a repo isn't git-init'd,
 *  instead of spamming `fatal: not a git repository` every poll. */
export function isGitRepo(cwd: string = process.cwd()): boolean {
  try { execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe', cwd }); return true; }
  catch { return false; }
}

/** The git repo a task's worktrees live under. Project-scoped: a task in a project
 *  with a valid repoPath isolates into THAT repo; anything else → the host cwd
 *  (so the default single-project flow is byte-for-byte unchanged). Best-effort. */
async function projectRootFor(taskId: string): Promise<string> {
  try {
    const t = await getTask(taskId);
    const proj = await getProject(t?.projectId || 'default');
    // Honor a configured repoPath for ANY project, including 'default'. The seeded default's
    // repoPath IS the host cwd, so single-project installs stay byte-for-byte unchanged; a
    // default explicitly pointed at another repo (as in a renamed/retargeted project) now
    // isolates into THAT repo — matching how the code index (projectRepoPath) already resolves.
    if (proj?.repoPath && existsSync(proj.repoPath)) return proj.repoPath;
  } catch { /* missing project/db → host cwd */ }
  return process.cwd();
}

/** The directory a task's worktrees live in, for BOTH spawn and cleanup so they agree.
 *  Default project (root === host cwd) → the configured worktreesDir exactly as before;
 *  a project repo elsewhere → <repoPath>/.worktrees. Returns the repo root too, since
 *  `git worktree remove/add` must run inside that repo. Best-effort. */
async function worktreeDirFor(taskId: string): Promise<{ root: string; dir: string }> {
  const root = await projectRootFor(taskId);
  const dir = root === process.cwd() ? getConfig().paths.worktreesDir : join(root, '.worktrees');
  return { root, dir };
}

/** Junction-link the project's node_modules into a fresh worktree. `git worktree add` never
 *  copies node_modules, so without this the agent's `pnpm run build`/`test` checks would resolve
 *  deps by walking UP to the host repo — fragile and wrong. The project is installed once (the
 *  readiness gate requires a verified preview, which runs `pnpm install` at the root), so here we
 *  only LINK — space-efficient (pnpm's store is shared) and instant. Best-effort. */
function linkNodeModules(root: string, worktree: string): void {
  try {
    if (worktree === root) return;
    const rootNm = join(root, 'node_modules');
    const nm = join(worktree, 'node_modules');
    if (!existsSync(rootNm) || existsSync(nm)) return; // nothing to link, or already present
    symlinkSync(rootNm, nm, 'junction');
  } catch { /* link is best-effort — the agent can still install if it must */ }
}

/** Resolve the working directory for a run, creating a worktree if the mode needs one. */
async function resolveCwd(taskId: string, mode: WorktreeMode): Promise<string> {
  const { root, dir } = await worktreeDirFor(taskId);
  // No git repo → worktree isolation is impossible; run the agent directly in the
  // repo root (degrade gracefully rather than failing on every `git worktree add`).
  if (mode === 'none' || !isGitRepo(root)) return root;
  mkdirSync(dir, { recursive: true });

  if (mode === 'plan') {
    const path = join(dir, `plan-${taskId}`);
    if (!existsSync(path)) {
      try { git(`worktree add --detach "${path}" HEAD`, root); } catch { return root; }
    }
    linkNodeModules(root, path);
    return path;
  }

  // create | reuse → the dev's branch worktree task/<id>
  const path = join(dir, taskId);
  if (existsSync(path)) { linkNodeModules(root, path); return path; } // reuse (or a retry of the same task)
  if (mode === 'reuse') {
    // Expected to exist from the dev stage; if missing, fall back to creating it.
    try { git(`worktree add "${path}" "task/${taskId}"`, root); linkNodeModules(root, path); return path; } catch { /* create below */ }
  }
  try { git(`worktree add "${path}" -b "task/${taskId}"`, root); }
  catch { try { git(`worktree add "${path}" "task/${taskId}"`, root); } catch { return root; } }
  linkNodeModules(root, path);
  return path;
}

export async function removeWorktree(taskId: string): Promise<void> {
  try {
    const { root, dir } = await worktreeDirFor(taskId);
    const path = join(dir, taskId);
    if (existsSync(path)) git(`worktree remove "${path}" --force`, root);
  } catch { /* leave for orphan sweep */ }
}

export async function removePlanWorktree(taskId: string): Promise<void> {
  try {
    const { root, dir } = await worktreeDirFor(taskId);
    const path = join(dir, `plan-${taskId}`);
    if (existsSync(path)) git(`worktree remove "${path}" --force`, root);
  } catch { /* leave for orphan sweep */ }
}

// ── stream-json → readable action lines ────────────────────────────────────────

const KIND: Record<string, string> = {
  Bash: '$', Read: 'read', Edit: 'edit', Write: 'write', MultiEdit: 'edit',
  Grep: 'search', Glob: 'search', Task: 'subagent', WebFetch: 'fetch', WebSearch: 'search',
};

/** Turn one stream-json line into a short human-readable action, or null to skip. */
function parseEvent(line: string): string | null {
  let ev: any;
  try { ev = JSON.parse(line); } catch { return null; }
  const content = ev?.message?.content;
  if (ev?.type === 'assistant' && Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (c?.type === 'tool_use') {
        const kind = KIND[c.name] || c.name?.toLowerCase() || 'tool';
        const i = c.input || {};
        const detail = i.command || i.file_path || i.path || i.pattern || i.query || i.description || '';
        parts.push(`${kind}: ${String(detail).slice(0, 160)}`.trim());
      } else if (c?.type === 'text' && c.text?.trim()) {
        parts.push(`· ${c.text.trim().slice(0, 200)}`);
      }
    }
    return parts.length ? parts.join('\n') : null;
  }
  if (ev?.type === 'result') {
    return `— result (${ev.subtype || 'done'})`;
  }
  return null;
}

// ── spawn / kill ───────────────────────────────────────────────────────────────

function classify(out: string): FailureKind {
  const o = out.toLowerCase();
  if (/enotfound|econnrefused|econnreset|etimedout|fetch failed|network|socket hang up|rate.?limit|overloaded|429|529|503/.test(o)) return 'network';
  return 'crash';
}

export async function spawnHeadlessAgent(opts: SpawnOptions): Promise<boolean> {
  const { agentName, taskId, prompt, model, worktree, onExit } = opts;
  if (running.has(agentName)) return false;

  const logsDir = getConfig().paths.logsDir;
  mkdirSync(logsDir, { recursive: true });
  const logFile = join(logsDir, `${agentName}.log`);

  const cwd = await resolveCwd(taskId, worktree);

  // FRESH log each run — the Logs tab shows only the current task's run.
  // Durable per-task history lives in logs.db, so overwriting here loses nothing.
  // Each line is stamped with HH:MM:SS so the Logs tab can show/hide per-line time.
  // Full ISO stamp (date + time) so the Logs tab can show either date+time or just time.
  const log = (line: string) => { try { appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`); } catch { /* disk */ } };
  try {
    writeFileSync(logFile, `── RUN START ${new Date().toISOString()} · ${agentName} · task=${taskId} · ${worktree} (${model}) ──\n`);
  } catch { /* disk */ }

  const modelArgs = model ? ['--model', model] : [];
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', ...modelArgs, ...CLAUDE_FLAGS];

  // Agents authenticate git with their assigned PAT (or the '*' default) — injected as a
  // per-process Authorization header scoped to the token's host. No token → no git auth env.
  let gitEnv: Record<string, string> = {};
  try {
    let projectId = 'default';
    try { const t = await getTask(taskId); if (t?.projectId) projectId = t.projectId; } catch { /* default */ }
    const tok = await resolveAgentToken(agentName, projectId);
    gitEnv = gitAuthEnv(tok);
    if (tok) log(`🔑 git auth: token "${tok.label}" (${tok.scope}) for ${tok.host}`);
  } catch { /* token lookup is best-effort — never block a run */ }

  let proc: ChildProcess;
  try {
    // CODE_INDEX_ROOT pins the shared code index to the HOST repo root (where the db server
    // and local.db live), so `db:search`'s offline fallback resolves the ONE index even though
    // the agent's cwd is a worktree that has no local.db of its own. The daemon path (127.0.0.1
    // :6952/search) already works from any cwd; this makes the fallback work too.
    // CODE_INDEX_PROJECT scopes the search to THIS task's project so a multi-project install
    // queries the right per-project index (index-<projectId>.db), not the default one.
    let indexProject = 'default';
    try { indexProject = (await getTask(taskId))?.projectId || 'default'; } catch { /* default */ }
    proc = spawn(CLAUDE_BIN, args, { cwd, env: { ...process.env, ...gitEnv, AGENT_NAME: agentName, TASK_ID: taskId, CODE_INDEX_ROOT: process.cwd(), CODE_INDEX_PROJECT: indexProject } });
  } catch (e: any) {
    log(`SPAWN FAILED: ${e?.message || e}`);
    return false;
  }

  const startedAt = Date.now();
  let tail = '';
  let buf = '';

  const record = (chunk: string) => {
    const rec = running.get(agentName);
    if (rec) rec.lastOutputAt = Date.now();
    tail = (tail + chunk).slice(-4000);
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const ln of lines) {
      if (!ln.trim()) continue;
      const action = parseEvent(ln);
      if (action) log(action);
    }
  };

  proc.stdout?.on('data', d => record(d.toString()));
  proc.stderr?.on('data', d => record(d.toString()));

  const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, AGENT_TIMEOUT_MS);

  proc.on('exit', (code) => {
    clearTimeout(timer);
    running.delete(agentName);
    const durationMs = Date.now() - startedAt;
    const failure: FailureKind = code === 0 ? 'none' : classify(tail);
    log(`── EXIT code=${code} (${Math.round(durationMs / 1000)}s, ${failure}) ──`);
    onExit({ code, durationMs, failure, outputTail: tail });
  });

  // Spawn-level failure (e.g. `claude` not found / not launchable) fires 'error',
  // NOT 'exit'. Without this the task would stay claimed forever with an empty log.
  proc.on('error', (err: any) => {
    clearTimeout(timer);
    running.delete(agentName);
    const msg = err?.message || String(err);
    log(`── SPAWN ERROR: ${msg} — is '${CLAUDE_BIN}' on PATH? (set CLAUDE_BIN to the full path if not) ──`);
    onExit({ code: null, durationMs: Date.now() - startedAt, failure: 'crash', outputTail: msg });
  });

  running.set(agentName, { proc, taskId, startedAt, lastOutputAt: Date.now(), timer });
  log(`spawned: ${CLAUDE_BIN} -p … --model ${model}  (cwd=${cwd})`);
  return true;
}

export function isAgentBusy(agentName: string): boolean {
  return running.has(agentName);
}

export function isTaskRunning(taskId: string): boolean {
  for (const r of running.values()) if (r.taskId === taskId) return true;
  return false;
}

/** Milliseconds since an agent last produced output — for the stall detector. */
export function agentIdleMs(agentName: string): number {
  const r = running.get(agentName);
  return r ? Date.now() - r.lastOutputAt : 0;
}

export function killAgent(agentName: string): void {
  const r = running.get(agentName);
  if (!r) return;
  try { clearTimeout(r.timer); r.proc.kill('SIGKILL'); } catch { /* gone */ }
  running.delete(agentName);
}

const normPath = (s: string): string => s.replace(/\\/g, '/').replace(/\/+$/, '');

/** Prune OUR worktrees + branches whose task no longer exists, inside ONE repo `root`,
 *  limited to worktrees under `dir` (never other git worktrees). Returns removed names. */
function pruneOrphansIn(root: string, dir: string, liveTaskIds: Set<string>): string[] {
  const removed: string[] = [];
  if (!isGitRepo(root)) return removed;                  // non-git → nothing to prune, skip the fatal
  let list = '';
  try { list = execSync('git worktree list --porcelain', { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', cwd: root }); } catch { return removed; }

  for (const block of list.split(/\n\n+/)) {
    const m = block.match(/^worktree (.+)$/m);
    if (!m) continue;
    const path = m[1].trim();
    if (!normPath(path).startsWith(normPath(dir) + '/')) continue; // only our .worktrees/*
    const name = path.split(/[\\/]/).pop() || '';
    const isPlan = name.startsWith('plan-');
    const id = isPlan ? name.slice(5) : name;
    if (!id || liveTaskIds.has(id)) continue;            // task still exists → keep

    try { git(`worktree remove "${path}" --force`, root); removed.push(name); } catch { /* skip */ }
    if (!isPlan) {                                        // abandoned dev branch → delete
      try { git(`branch -D "task/${id}"`, root); } catch { /* no branch */ }
    }
  }
  try { execSync('git worktree prune', { stdio: 'pipe', cwd: root }); } catch { /* skip */ }
  return removed;
}

/** Prune orphan worktrees/branches in the HOST repo (default project). Cheap; run often. */
export function pruneOrphans(liveTaskIds: Set<string>): string[] {
  return pruneOrphansIn(process.cwd(), getConfig().paths.worktreesDir, liveTaskIds);
}

/** Sweep the HOST repo AND every additional project repo (their <repo>/.worktrees). Used by
 *  the periodic cleaner so orphans in non-default project repos don't leak forever.
 *  `liveTaskIds` must be the union of task ids across ALL projects (ids are globally unique,
 *  so a worktree is removed only when its id belongs to no project). */
export function pruneOrphansAll(liveTaskIds: Set<string>, projectRoots: string[]): string[] {
  const removed = pruneOrphans(liveTaskIds);
  const host = normPath(process.cwd());
  for (const root of projectRoots) {
    if (!root || normPath(root) === host) continue;      // host already swept above
    removed.push(...pruneOrphansIn(root, join(root, '.worktrees'), liveTaskIds));
  }
  return removed;
}
