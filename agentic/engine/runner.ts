// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — headless agent runner
// Runs one agent per task through a hand-rolled @anthropic-ai/sdk tool loop against
// the Messages API (NOT `claude -p`). Because the runner dispatches tool calls itself,
// it IS the permission engine on the live path: the P0.3 sandbox (buildSandboxSettings'
// allow/deny + isReadOnlyRole) is enforced HERE, inside the tool executor, before any
// side effect — a `.claude/settings.json` on disk only governs the CLI. Also handles:
//  - per-role model tiering (--model)
//  - git-worktree isolation (plan / create / reuse / none)
//  - a FRESH log per run (the Logs tab always shows the current run)
//  - failure classification for the circuit breaker + stall detection
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, appendFileSync, symlinkSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, sep, basename } from 'node:path';
import type { RunResult, FailureKind, WorktreeMode, AgentRole } from '../types';
import { getConfig } from '../runtime-context';
import Anthropic from '@anthropic-ai/sdk';
import { resolveAgentToken, gitAuthEnv, getTask, getProject, updateTask } from '../db/tasks';
import { writeWorktreeSettings, buildSandboxSettings, isReadOnlyRole, bashDenyReason } from './sandbox';
import { taskLogPath } from './task-log-file';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
// An explicit CLAUDE_FLAGS env var still wins (power users / CI). Otherwise the flags are
// derived per-spawn from the user's OWNED setting — see SpawnOptions.skipPermissions.
// This used to hard-default to --dangerously-skip-permissions with no UI surface at all:
// the single most dangerous setting in the product, invisible.
const CLAUDE_FLAGS_ENV = process.env.CLAUDE_FLAGS
  ? process.env.CLAUDE_FLAGS.split(' ').filter(Boolean)
  : null;

function claudeFlags(profile: 'strict' | 'standard' | 'dangerous', role: AgentRole): string[] {
  if (CLAUDE_FLAGS_ENV) return CLAUDE_FLAGS_ENV;
  const flags = profile === 'dangerous' ? ['--dangerously-skip-permissions'] : ['--permission-mode', 'acceptEdits'];
  if (role === 'plan') flags.push('--disallowedTools', 'Edit,Write');
  return flags;
}
const AGENT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || String(30 * 60 * 1000));

/** Hard per-run turn bound (SPEC P0.4). Every spawn is capped at this many agent turns —
 *  the per-run analogue of `--max-turns 80` on the CLI — so a looping agent cannot spend
 *  unboundedly inside a single run. Named (not inline) so the cap is one obvious knob. */
export const MAX_TURNS_PER_RUN = 80;

export interface SpawnOptions {
  agentName: string;
  taskId: string;
  role: AgentRole;
  prompt: string;
  model: string;
  worktree: WorktreeMode;
  /** Agent permission profile. 'strict' prompts on write. 'standard' allows edits and safe bash. 'dangerous' skips all prompts. */
  permissionProfile?: 'strict' | 'standard' | 'dangerous';
  onExit: (result: RunResult) => void;
}

interface RunningAgent {
  abortController: AbortController;
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

// ── cost capture (SPEC P0.4) ───────────────────────────────────────────────────

/**
 * Extract `total_cost_usd` from one stream-json line, or null when the line is not a
 * `result` event (or carries no usable number). The CLI's final `result` event is the
 * authoritative per-run cost when an engine emits one; this parser is pure and engine-
 * agnostic so budgets stay comparable across runners (SPEC §4 `extractResult`).
 */
export function extractCostUsd(line: string): number | null {
  let ev: any;
  try { ev = JSON.parse(line); } catch { return null; }
  if (ev?.type !== 'result') return null;
  const cost = ev.total_cost_usd;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

// USD per **million** tokens, matched against the model string (tier names like 'opus'
// and full IDs like 'claude-opus-4-8' both hit). Cache reads bill at 0.1× the input
// rate and cache writes at 1.25× — the standard 5-minute-TTL premium.
const MODEL_PRICES: Array<{ match: RegExp; inPerMTok: number; outPerMTok: number }> = [
  { match: /fable|mythos/i, inPerMTok: 10, outPerMTok: 50 },
  { match: /opus/i, inPerMTok: 5, outPerMTok: 25 },
  { match: /haiku/i, inPerMTok: 1, outPerMTok: 5 },
  { match: /sonnet/i, inPerMTok: 3, outPerMTok: 15 },
];

/** USD cost of one API turn, from its usage block. Unknown models price as sonnet —
 *  a mid-tier estimate beats silently free. Pure — exported for tests. */
export function estimateTurnCostUsd(model: string, usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
} | null | undefined): number {
  if (!usage) return 0;
  const price = MODEL_PRICES.find(p => p.match.test(model || '')) ?? MODEL_PRICES[3];
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  return (
    inTok * price.inPerMTok
    + cacheWrite * price.inPerMTok * 1.25
    + cacheRead * price.inPerMTok * 0.1
    + outTok * price.outPerMTok
  ) / 1_000_000;
}

// ── spawn / kill ───────────────────────────────────────────────────────────────

/** Extract the reset epoch from the CLI's plan-limit message (e.g.
 *  "Claude AI usage limit reached|1783725600") and return it as an ISO timestamp. The epoch
 *  may be seconds or milliseconds — values below 10^12 are seconds (10^12 ms is ~2001, so no
 *  real reset time is ambiguous). Null when the message carries no epoch. Pure — exported for
 *  the orchestrator's pause computation and for tests. */
export function parseLimitReset(output: string): string | null {
  const m = /usage limit reached\|?\s*(\d{9,13})/i.exec(output || '');
  if (!m) return null;
  let epoch = parseInt(m[1], 10);
  if (epoch < 1e12) epoch *= 1000; // seconds → milliseconds
  return new Date(epoch).toISOString();
}

/** Classify a failed run's output. Pure — exported for tests.
 *  'limit' MUST be checked first, and only on the explicit plan-limit message: that output can
 *  also contain 429/rate-limit text, and demoting it to 'network' sends it to the circuit
 *  breaker's blind retries — burning the task's attempts on a window that stays shut for hours.
 *  A plain 429/overloaded/rate-limit WITHOUT the message stays 'network' (the breaker owns those). */
export function classify(out: string): FailureKind {
  const o = out.toLowerCase();
  if (/usage limit reached/.test(o)) return 'limit';
  if (/enotfound|econnrefused|econnreset|etimedout|fetch failed|network|socket hang up|rate.?limit|overloaded|429|529|503/.test(o)) return 'network';
  return 'crash';
}

export async function spawnHeadlessAgent(opts: SpawnOptions): Promise<boolean> {
  const { agentName, taskId, prompt, model, worktree, onExit } = opts;
  if (running.has(agentName)) return false;

  const logsDir = getConfig().paths.logsDir;
  mkdirSync(logsDir, { recursive: true });
  const logFile = join(logsDir, `${agentName}.log`);

  const task = await getTask(taskId).catch(() => null);
  const projectId = task?.projectId || 'default';

  const taskFile = taskLogPath(projectId, taskId);
  if (taskFile) {
    try { mkdirSync(dirname(taskFile), { recursive: true }); } catch { /* disk */ }
    if (task && task.logPath !== taskFile) {
      updateTask(taskId, { logPath: taskFile }).catch(() => { /* best-effort */ });
    }
  }

  const cwd = await resolveCwd(taskId, worktree);
  writeWorktreeSettings(cwd, opts.role, opts.permissionProfile || 'standard');

  const log = (line: string) => {
    const stamped = `[${new Date().toISOString()}] ${line}\n`;
    try { appendFileSync(logFile, stamped); } catch { /* disk */ }
    if (taskFile) { try { appendFileSync(taskFile, stamped); } catch { /* disk */ } }
  };
  const header = `── RUN START ${new Date().toISOString()} · ${agentName} · task=${taskId} · ${worktree} (${model}) ──\n`;
  try { writeFileSync(logFile, header); } catch { /* disk */ }
  if (taskFile) { try { appendFileSync(taskFile, header); } catch { /* disk */ } }

  let gitEnv: Record<string, string> = {};
  try {
    const tok = await resolveAgentToken(agentName);
    gitEnv = gitAuthEnv(tok);
    if (tok) log(`🔑 git auth: token "${tok.label}" (${tok.scope}) for ${tok.host}`);
  } catch { /* best-effort */ }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const ac = new AbortController();
  const startedAt = Date.now();
  let totalCost = 0;     // USD, summed per turn from usage (see estimateTurnCostUsd)
  let sawUsage = false;  // false ⇒ the run died before any API round-trip → costUsd: null
  let tail = '';

  const recordOutput = (chunk: string) => {
    tail = (tail + chunk).slice(-4000);
  };

  const timer = setTimeout(() => { try { ac.abort(); } catch { /* gone */ } }, AGENT_TIMEOUT_MS);
  running.set(agentName, { abortController: ac, taskId, startedAt, lastOutputAt: Date.now(), timer });

  log(`spawned: Anthropic Node.js Client -p … --model ${model}  (cwd=${cwd})`);

  // ── P0.3 sandbox, enforced in-process (the runner is the permission engine) ──
  // Derive the role/level profile ONCE. Read-only roles (owner, architect,
  // security-engineer, …) get ONLY Read — no Bash/Edit/Write tool is even offered,
  // replacing the old always-true role-vs-"plan" string gate. The profile's allow/deny
  // lists screen every Bash command below; file tools are confined to the worktree.
  const level = opts.permissionProfile || 'standard';
  const readOnly = isReadOnlyRole(opts.role);
  const sandboxProfile = buildSandboxSettings(opts.role, level);

  // The realpath'd worktree root — the boundary every Read/Write/Edit path is confined
  // to. Resolving symlinks here (and on each target's longest existing ancestor below)
  // closes the `symlink -> /etc/passwd` and `../../escape` holes the old join(cwd,…) left.
  const cwdReal = (() => { try { return realpathSync(cwd); } catch { return resolve(cwd); } })();
  const confineToWorktree = (p: string): string => {
    const resolved = resolve(cwd, String(p || ''));
    // realpath the longest EXISTING ancestor so a symlink anywhere on the path can't
    // point the (possibly not-yet-created) target outside the worktree.
    let probe = resolved; const tail: string[] = [];
    while (!existsSync(probe)) { const parent = dirname(probe); if (parent === probe) break; tail.unshift(basename(probe)); probe = parent; }
    let real: string;
    try { real = tail.length ? join(realpathSync(probe), ...tail) : realpathSync(probe); } catch { real = resolved; }
    if (real !== cwdReal && !real.startsWith(cwdReal + sep)) throw new Error(`sandbox: path escapes the worktree: ${p}`);
    return real;
  };

  const tools: Anthropic.Tool[] = [];
  if (!readOnly) {
    tools.push({
      name: 'Bash',
      description: 'Execute a bash command in the current working directory.',
      input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
    });
    tools.push({
      name: 'Edit',
      description: 'Edit a file by specifying search and replace strings.',
      input_schema: { type: 'object', properties: { path: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'search', 'replace'] }
    });
    tools.push({
      name: 'Write',
      description: 'Write text to a file.',
      input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }
    });
  }
  tools.push({
    name: 'Read',
    description: 'Read the contents of a file.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  });

  (async () => {
    let messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
    let turns = 0;

    while (turns < MAX_TURNS_PER_RUN) {
      if (ac.signal.aborted) break;
      turns++;

      try {
        const msg = await anthropic.messages.create({
          model: model || 'claude-3-7-sonnet-20250219',
          max_tokens: 8192,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          system: "You are an autonomous agent."
        }, { signal: ac.signal });

        const r = running.get(agentName);
        if (r) r.lastOutputAt = Date.now();

        // Cost capture (SPEC P0.4): price THIS turn's usage and accumulate. This is the
        // SDK-loop equivalent of the CLI's final `total_cost_usd` result event — the CLI
        // path parsed that event and threw the number away; here nothing carries a total,
        // so the run total is the sum of its turns.
        totalCost += estimateTurnCostUsd(model, msg.usage);
        sawUsage = true;

        messages.push({ role: 'assistant', content: msg.content });
        let nextMessage: Anthropic.MessageParam = { role: 'user', content: [] };
        
        for (const block of msg.content) {
          if (block.type === 'text') {
            const lines = block.text.split('\n');
            for (const ln of lines) if (ln.trim()) {
              log(`· ${ln.trim().slice(0, 200)}`);
              recordOutput(ln + '\n');
            }
          } else if (block.type === 'tool_use') {
            const toolName = block.name;
            const input: any = block.input;
            
            const detail = input.command || input.path || '';
            log(`${toolName}: ${String(detail).slice(0, 160)}`);
            recordOutput(`Tool ${toolName} called with ${JSON.stringify(input)}\n`);
            
            let result = '';
            let isError = false;
            try {
              if (readOnly && (toolName === 'Bash' || toolName === 'Write' || toolName === 'Edit')) {
                // Belt to the tool-surface braces above: a read-only role never writes or shells,
                // even if a tool_use for one arrives (e.g. from a resumed transcript).
                result = `sandbox: role "${opts.role}" is read-only — ${toolName} is not permitted`;
                isError = true;
              } else if (toolName === 'Bash') {
                // Screen the command against the profile's deny/allow lists BEFORE running it:
                // curl/wget/git push (and, at strict, anything outside the verify trio) are denied.
                const denied = bashDenyReason(String(input.command || ''), sandboxProfile, level);
                if (denied) { result = denied; isError = true; }
                else {
                  const env = { ...process.env, ...gitEnv, AGENT_NAME: agentName, TASK_ID: taskId, CODE_INDEX_ROOT: process.cwd(), CODE_INDEX_PROJECT: projectId };
                  result = execSync(input.command, { cwd, encoding: 'utf-8', timeout: 30000, env });
                }
              } else if (toolName === 'Read') {
                result = readFileSync(confineToWorktree(input.path), 'utf-8');
              } else if (toolName === 'Write') {
                writeFileSync(confineToWorktree(input.path), input.content);
                result = 'File written successfully.';
              } else if (toolName === 'Edit') {
                const abs = confineToWorktree(input.path);
                let text = readFileSync(abs, 'utf-8');
                text = text.replace(input.search, input.replace);
                writeFileSync(abs, text);
                result = 'File edited successfully.';
              } else {
                result = 'Tool not found.';
                isError = true;
              }
            } catch (e: any) {
              result = String(e.message || e);
              isError = true;
            }
            
            recordOutput(`Tool result: ${result}\n`);
            if (Array.isArray(nextMessage.content)) {
              nextMessage.content.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result,
                is_error: isError
              });
            }
          }
        }
        
        if (msg.stop_reason === 'tool_use') {
          messages.push(nextMessage);
        } else {
          break; // done
        }
      } catch (err: any) {
        if (err.name === 'AbortError') break;
        log(`API Error: ${err.message}`);
        recordOutput(`API Error: ${err.message}\n`);
        break;
      }
    }

    clearTimeout(timer);
    running.delete(agentName);
    const durationMs = Date.now() - startedAt;
    const failure: FailureKind = tail.includes('API Error:') ? classify(tail) : 'none';
    const code = failure === 'none' ? 0 : 1;
    log(`── EXIT code=${code} (${Math.round(durationMs / 1000)}s, ${failure}) ──`);
    onExit({ code, durationMs, failure, outputTail: tail, resetAt: failure === 'limit' ? parseLimitReset(tail) : null, costUsd: sawUsage ? totalCost : null });
  })();

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
  try { clearTimeout(r.timer); r.abortController.abort(); } catch { /* gone */ }
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
