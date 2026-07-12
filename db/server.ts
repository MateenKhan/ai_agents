/**
 * Persistent DB search daemon — loads Hugging Face model once, stays alive.
 * Starts with npm run dev. Accepts search queries via HTTP on localhost:6952.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { spawnSync, spawn } from 'child_process';
import { embedQuery } from './embedder.js';
import { getDb, getDbFor, resetDb, resetDbFor } from './db.js';
import { fromBuffer, cosine } from './embedder.js';
// Shared code index (Postgres + pgvector) — only used when getBackendConfig().kind==='postgres'.
import { codeIndexIsPostgres, pgSemanticSearch } from './indexPg.js';
import { readFileSync, writeFileSync, existsSync, appendFileSync, symlinkSync, readdirSync, statSync, unlinkSync, openSync, mkdirSync, rmSync } from 'fs';
import { join, dirname, resolve, isAbsolute } from 'path';

const PORT = parseInt(process.env.DB_SERVER_PORT ?? '6952');
const ACTIVE_AGENTS = new Set<string>();
const LOGS_DIR = join(process.cwd(), '.agent_logs');

const VERSION_INFO = (() => {
  let version = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    version = String(pkg.version ?? 'unknown');
  } catch { /* fall through */ }
  let commit: string | null = null;
  try {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: process.cwd(), encoding: 'utf-8', timeout: 2000 });
    if (r.status === 0) commit = (r.stdout || '').trim() || null;
  } catch { /* git optional */ }
  return {
    version,
    build: {
      commit,
      builtAt: new Date().toISOString(),
      node: process.version,
    },
    environment: process.env.NODE_ENV || 'development',
  };
})();

// Hard cap on request bodies — reject once accumulated bytes exceed this instead of buffering
// unbounded memory (DoS guard). The rejection carries a 413 so handlers can surface it clearly.
const MAX_BODY_BYTES = 10_000_000; // 10 MB
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let d = ''; let size = 0;
    req.on('data', c => {
      size += (c as Buffer).length;
      if (size > MAX_BODY_BYTES) {
        const err: any = new Error('request body too large'); err.statusCode = 413;
        req.destroy(); rej(err); return;
      }
      d += c;
    });
    req.on('end', () => res(d));
    req.on('error', rej);
  });
}

function keywordSearch(query: string, topK: number, projectId: string = 'default') {
  const db = getDbFor(projectId);
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const scoreExpr = words.map(() =>
    `((LOWER(n.name) LIKE ? OR LOWER(n.notes) LIKE ? OR LOWER(n.signature) LIKE ? OR LOWER(f.path) LIKE ?) * 1)`
  ).join(' + ');
  const params = words.flatMap(w => [`%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`]);
  const rows = db.prepare(`
    SELECT n.name, n.type, n.start_line, n.signature, f.path, (${scoreExpr}) as score
    FROM nodes n JOIN files f ON n.file_id = f.id
    WHERE (${scoreExpr}) > 0
    ORDER BY score DESC LIMIT ?
  `).all(...params, ...params, topK) as any[];
  return rows.map(r => ({ score: r.score, name: r.name, type: r.type, path: r.path, line: r.start_line, signature: r.signature }));
}

async function semanticSearch(query: string, topK: number, projectId: string = 'default') {
  // Shared-index path: when the datastore is Postgres, the daemon's /search runs the
  // cosine ANN query against the ONE pgvector index (all machines share it) rather than
  // this machine's local SQLite file. SQLite default (below) is unchanged.
  if (codeIndexIsPostgres()) return pgSemanticSearch(query, topK, projectId);

  const vec = await embedQuery(query);
  if (!vec) return keywordSearch(query, topK, projectId);

  const db = getDbFor(projectId);
  const rows = db.prepare(`
    SELECT n.name, n.type, n.start_line, n.signature, n.embedding, f.path
    FROM nodes n JOIN files f ON n.file_id = f.id
    WHERE n.embedding IS NOT NULL
  `).all() as any[];

  return rows
    .map(r => ({ score: cosine(vec, fromBuffer(r.embedding)), ...r }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(r => ({ score: +r.score.toFixed(4), name: r.name, type: r.type, path: r.path, line: r.start_line, signature: r.signature }));
}

// ── RAG: retrieval-augmented answer over the code index ────────────────────────
// Feeds the top code snippets (retrieved via semanticSearch) to a one-shot headless
// Claude call and returns the generated answer. Prompt is piped over stdin (not argv)
// so large snippet context never hits the OS command-line length limit.
function ragAnswer(question: string, ctx: string, cwd: string): Promise<string> {
  const prompt = [
    'You are a code-search assistant. Answer the developer\'s QUESTION using ONLY the',
    'code SNIPPETS below (retrieved from this project\'s index). Cite sources inline as',
    '`path:line`. If the snippets do not contain the answer, say so plainly — do not guess.',
    'Answer concisely in markdown.',
    '',
    `QUESTION: ${question}`,
    '',
    'SNIPPETS:',
    ctx,
  ].join('\n');

  const bin = process.env.CLAUDE_BIN || 'claude';
  const model = process.env.RAG_MODEL || 'sonnet';
  const flags = (process.env.CLAUDE_FLAGS || '--dangerously-skip-permissions').split(' ').filter(Boolean);
  const args = ['-p', '--model', model, '--output-format', 'text', ...flags];

  return new Promise(resolve => {
    let out = '', err = '', settled = false;
    const finish = (v: string) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); };
    let proc: ReturnType<typeof spawn>;
    try { proc = spawn(bin, args, { cwd, shell: false }); }
    catch (e: any) { return finish(`⚠ Could not launch Claude (${bin}): ${e?.message || e}`); }
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* already gone */ } finish('⚠ Claude timed out (120s).'); }, 120000);
    proc.stdout?.on('data', d => { out += d.toString(); });
    proc.stderr?.on('data', d => { err += d.toString(); });
    proc.on('error', e => finish(`⚠ Could not run Claude (${bin}): ${e?.message || e}. Is it on PATH? Set CLAUDE_BIN.`));
    proc.on('close', () => finish(out.trim() || (err.trim() ? `⚠ ${err.trim().slice(0, 600)}` : '(no answer returned)')));
    try { proc.stdin?.write(prompt); proc.stdin?.end(); } catch { /* pipe closed */ }
  });
}

import { getAllTasks, getTask, createTask, updateTask, deleteTask, bulkUpdatePriorities, getBoardSettings, updateBoardSettings, getTasksDb, getLogsDb, initTasksSchema, runMigrations, getGitConfig, setGitConfig, listGitTokensRaw, getGitTokenRaw, addGitToken, updateGitToken, deleteGitToken, getTokenAssignments, setTokenAssignment, getCodeIndexConfig, setCodeIndexConfig, getHeartbeat, getRecentLogs, listProjects, getProject, createProject, updateProject, deleteProject, createPendingGithubApp, getGithubApp, listGithubApps, listGithubAppsRaw, updateGithubApp, deleteGithubApp, mintInstallationToken, listAppInstallations, listInstallationRepos, setProjectRunConfig, setProjectReadiness, setProjectMaxConcurrency, getAgentDefaults, setAgentDefaults, type RunConfig, type Task } from './tasks.js';
// Datastore backend config — the persisted choice + its encrypted URL. Applied at boot.
import { getBackendConfig, setBackendConfig, getMaskedBackendConfig } from './backendConfig.ts';
import { specIssues } from './intakeGate.ts';
import { unifiedDiff } from './unifiedDiff.ts';
import { authenticateGitUrl } from './gitAuth.ts';
// Belt-and-suspenders redaction of git/curl output. The known token is already stripped by the
// callers; the shared redactSecrets also catches user:pass@ embedded in URLs and any GitHub token
// git happens to echo (plus Bearer/token=/password= pairs — a strict superset of the old local one).
import { redactSecrets } from '../agentic/redact.ts';
// The datastore seam: push the chosen backend (SQLite default / Postgres opt-in) into the
// async Store layer at boot, BEFORE any schema init or request handling.
import { configureBackend, isPostgres, getStore, ensureMigrated } from '../agentic/db/getStore.ts';
import { isInsideLogsRoot, logsRoot, safeSegment } from '../agentic/engine/task-log-file.ts';

// ── project scoping helpers ────────────────────────────────────────────────────
// Every project-scoped route reads ?project=<id> (default 'default'); body routes may
// also carry projectId. When a git route omits its `repo`, we default it to the
// project's repoPath (falling back to the host cwd).
/** Agent log files live FLAT in LOGS_DIR. Names come from the URL, so allow only a plain
 *  filename charset — no separators, no dots-dots. Anything else could escape via join(). */
function safeLogName(name: string): string | null {
  return /^[A-Za-z0-9_.-]+$/.test(name) && !name.includes('..') ? name : null;
}


function projectIdOf(req: IncomingMessage, body?: any): string {
  try { const p = new URL(req.url!, 'http://x').searchParams.get('project'); if (p) return p; } catch { /* bad url */ }
  if (body && body.projectId) return String(body.projectId);
  return 'default';
}
async function projectRepoPath(projectId: string): Promise<string> {
  try { const p = await getProject(projectId); if (p?.repoPath) return p.repoPath; } catch { /* no db */ }
  return process.cwd();
}

// ── Repo run-config: detect (heuristic + Opus) and execute install/run/build/test ──
type RunKey = 'install' | 'run' | 'build' | 'test';
interface RunProc {
  id: string; which: RunKey; cmd: string; projectId: string; cwd: string;
  log: string; running: boolean; exitCode: number | null; pid?: number; startedAt: string;
}
const runProcs = new Map<string, RunProc>();
const RUN_LOG_CAP = 200_000; // keep the last ~200KB of output per run

function pkgManager(root: string): 'pnpm' | 'yarn' | 'npm' | 'bun' {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb'))) return 'bun';
  return 'pnpm'; // default to pnpm (not npm): worktree-heavy flow needs pnpm's shared store, not npm's per-worktree copies
}

/** File-based stack detection. Returns a best-guess config + a human label, or null. */
function heuristicDetect(root: string): { config: RunConfig; source: string } | null {
  const has = (f: string) => { try { return existsSync(join(root, f)); } catch { return false; } };
  // Node / JS-TS
  if (has('package.json')) {
    const pm = pkgManager(root);
    let scripts: Record<string, string> = {};
    try { scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts || {}; } catch { /* ignore */ }
    const rc = pm === 'yarn' ? 'yarn' : `${pm} run`;
    const runScript = scripts.dev ? 'dev' : scripts.start ? 'start' : scripts.serve ? 'serve' : '';
    const run = !runScript ? '' : (runScript === 'start' && pm === 'npm') ? 'npm start' : `${rc} ${runScript}`;
    return { config: {
      install: `${pm} install`,
      run,
      build: scripts.build ? `${rc} build` : '',
      test: scripts.test ? (pm === 'npm' ? 'npm test' : `${pm} test`) : '',
    }, source: `node (${pm})` };
  }
  // Python
  if (has('pyproject.toml') && has('poetry.lock'))
    return { config: { install: 'poetry install', run: 'poetry run python main.py', build: '', test: 'poetry run pytest' }, source: 'python (poetry)' };
  if (has('requirements.txt')) {
    const entry = ['manage.py', 'main.py', 'app.py', 'run.py'].find(f => has(f)) || 'main.py';
    const run = entry === 'manage.py' ? 'python manage.py runserver' : `python ${entry}`;
    return { config: { install: 'pip install -r requirements.txt', run, build: '', test: 'pytest' }, source: 'python (pip)' };
  }
  // Java
  if (has('pom.xml')) return { config: { install: 'mvn install -DskipTests', run: 'mvn spring-boot:run', build: 'mvn package', test: 'mvn test' }, source: 'java (maven)' };
  if (has('build.gradle') || has('build.gradle.kts')) return { config: { install: 'gradle build -x test', run: 'gradle bootRun', build: 'gradle build', test: 'gradle test' }, source: 'java (gradle)' };
  // Go / Rust / Ruby
  if (has('go.mod')) return { config: { install: 'go mod download', run: 'go run .', build: 'go build ./...', test: 'go test ./...' }, source: 'go' };
  if (has('Cargo.toml')) return { config: { install: 'cargo fetch', run: 'cargo run', build: 'cargo build', test: 'cargo test' }, source: 'rust (cargo)' };
  if (has('Gemfile')) return { config: { install: 'bundle install', run: 'bundle exec ruby app.rb', build: '', test: 'bundle exec rspec' }, source: 'ruby' };
  // .NET
  try { if (readdirSync(root).some(f => f.endsWith('.csproj') || f.endsWith('.sln'))) return { config: { install: 'dotnet restore', run: 'dotnet run', build: 'dotnet build', test: 'dotnet test' }, source: 'dotnet' }; } catch { /* ignore */ }
  return null;
}

/** Deeper detection: spawn `claude -p` in the repo and parse a JSON answer. Best-effort. */
async function detectViaClaude(root: string): Promise<{ config: RunConfig; source: string } | null> {
  const bin = process.env.CLAUDE_BIN || 'claude';
  const prompt = 'Inspect the project in the current directory and determine the shell commands to set it up and run it. '
    + 'Output ONLY one JSON object, no prose, with string keys install, run, build, test (empty string if not applicable). '
    + 'Example: {"install":"pnpm i","run":"pnpm run dev","build":"pnpm run build","test":"pnpm test"}';
  return await new Promise((resolve) => {
    let out = ''; let done = false;
    const finish = (v: { config: RunConfig; source: string } | null) => { if (!done) { done = true; resolve(v); } };
    try {
      const proc = spawn(bin, ['-p', prompt], { cwd: root, shell: true });
      proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
      proc.on('error', () => finish(null));
      proc.on('exit', () => {
        const m = out.match(/\{[\s\S]*\}/);
        if (!m) return finish(null);
        try {
          const j = JSON.parse(m[0]);
          finish({ config: { install: j.install || '', run: j.run || '', build: j.build || '', test: j.test || '' }, source: 'opus' });
        } catch { finish(null); }
      });
      setTimeout(() => { try { proc.kill(); } catch { /* gone */ } finish(null); }, 60_000);
    } catch { finish(null); }
  });
}

/** Heuristic first; fall back to Opus when the stack is unknown or the run command is ambiguous. */
async function detectRunConfig(root: string): Promise<{ config: RunConfig; source: string }> {
  const h = heuristicDetect(root);
  if (h && h.config.run) return h;
  const c = await detectViaClaude(root);
  if (c && (c.config.run || c.config.install)) return c;
  return h || { config: { install: '', run: '', build: '', test: '' }, source: 'unknown' };
}

/** Kill a run's process tree (grandchildren too — dev servers fork). */
function killRun(rp: RunProc): void {
  if (!rp.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(rp.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-rp.pid, 'SIGKILL');
  } catch { /* already gone */ }
}

// Select the datastore backend (SQLite default; Postgres only if the host opted in via
// db/backend.json), then run migrations at startup (safe to re-run). Both are AWAITED before
// the server begins handling requests below.
console.log('[db-server] Running DB migrations...');
try {
  const backend = getBackendConfig();
  configureBackend({ kind: backend.kind, url: backend.url });
  // initTasksSchema (== runMigrations) is now async: portable migrations + legacy dod→scenario
  // + at-rest secret re-encryption. Await it so the schema exists before the first request.
  await initTasksSchema();
  console.log(`[db-server] DB ready (backend: ${backend.kind}).`);
} catch (e) {
  console.error('[db-server] Migration error:', e);
}

// ── Per-agent log hygiene ────────────────────────────────────────────────────
// Each agent writes its own <name>.log (overwritten fresh per run). Old ones from
// prior sessions / the 32-slot pool just accumulate, so we prune them — on boot
// (nothing is running) and in Heal (keeping only agents that are currently busy).
function pruneAgentLogs(keep: Set<string>): number {
  if (!existsSync(LOGS_DIR)) return 0;
  let n = 0;
  for (const f of readdirSync(LOGS_DIR)) {
    if (!f.endsWith('.log')) continue;
    const nm = f.replace(/\.log$/, '');
    if (nm === 'orchestrator' || nm === '__system__' || keep.has(nm)) continue; // keep system + busy
    try { unlinkSync(join(LOGS_DIR, f)); n++; } catch { /* locked */ }
  }
  return n;
}
try { const cleared = pruneAgentLogs(new Set()); if (cleared) console.log(`[db-server] 🧹 cleared ${cleared} stale agent log(s) on boot`); } catch { /* optional */ }

// ── DB self-heal gate ────────────────────────────────────────────────────────
// Every 30s we integrity-check the databases and pause the affected requests:
//  • BOARD (tasks.db / logs.db) is durable → NEVER auto-rebuilt (that would delete
//    your tasks). On corruption we PAUSE its get/update requests (503) and alert,
//    so nothing reads or writes a malformed board. Clears itself when healthy.
//  • CODE INDEX (local.db) is derived → on corruption we auto-rebuild it via
//    `db:build`, PAUSE /search while it rebuilds, then drop the stale handle.
let boardCorrupt: string | null = null;   // e.g. 'tasks.db' — pauses get/update
// Per-project code-index rebuild flags — a project's index-<pid>.db rebuild in flight.
// While ANY project is rebuilding, /search is paused (the gate runs before the body,
// so it can't know which project a POST /search targets).
// Completely purge a project's data: its embeddings DB file, code-index config, tasks, tokens,
// and the project row (deleteProject cascades the DB rows). Never touches the repo FOLDER — that
// is deleted separately and only when it lives inside the managed projects/ directory.
async function purgeProjectData(id: string): Promise<void> {
  // Task ids first: the logs-group `agent_db_usage` rows and the on-disk .log files key on
  // taskId, and the tasks rows are about to be deleted by deleteProject.
  let taskIds: string[] = [];
  try { taskIds = ((await getStore('tasks').all(`SELECT id FROM tasks WHERE projectId = ?`, [id])) as any[]).map(r => r.id); } catch { /* offline */ }
  try { resetDbFor(id); } catch { /* handle already closed */ }
  try { await deleteProject(id); } catch (e: any) { console.warn(`[db-server] purge project rows [${id}]: ${e?.message}`); }
  // logs.db group (kept out of tasks.db, so deleteProject can't reach it): agent_logs /
  // context_files / context_ops are project-scoped; agent_db_usage keys on taskId. `__system__`
  // orchestrator log lines carry no projectId and are deliberately left alone.
  try {
    await ensureMigrated('logs');
    const ls = getStore('logs');
    await ls.run(`DELETE FROM agent_logs WHERE projectId = ?`, [id]);
    await ls.run(`DELETE FROM context_files WHERE projectId = ?`, [id]);
    await ls.run(`DELETE FROM context_ops WHERE projectId = ?`, [id]);
    if (taskIds.length) await ls.run(`DELETE FROM agent_db_usage WHERE taskId IN (${taskIds.map(() => '?').join(',')})`, taskIds);
  } catch (e: any) { console.warn(`[db-server] purge project logs [${id}]: ${e?.message}`); }
  // Embeddings index DB files.
  for (const suf of ['', '-wal', '-shm']) {
    try { const f = join(process.cwd(), 'db', `index-${id}.db${suf}`); if (existsSync(f)) rmSync(f, { force: true }); } catch { /* file busy/missing */ }
  }
  // Per-task .log files live under <logsDir>/<projectId>/ — remove the whole project dir.
  try { const seg = safeSegment(id); if (seg) { const dir = join(logsRoot(), seg); if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } } catch { /* busy/missing */ }
}

const indexRebuilding = new Map<string, boolean>();
// Live index-build output per project — the Index tab polls /code-index/progress to show it.
const indexLogs = new Map<string, string[]>();
function pushIndexLog(pid: string, chunk: string) {
  const arr = indexLogs.get(pid); if (!arr) return;
  for (const seg of chunk.split(/\r?\n/)) { const s = seg.trim(); if (s) arr.push(s); }
  if (arr.length > 500) indexLogs.set(pid, arr.slice(-500));
}
const isRebuilding = (pid: string): boolean => indexRebuilding.get(pid) === true;
const anyRebuilding = (): boolean => { for (const v of indexRebuilding.values()) if (v) return true; return false; };

// ── system activity ── what the orchestrator/db-server is doing right now, surfaced
// to the UI's bottom-right status widget (cloning, reading/remembering a repo, etc).
// Keyed per project so each project's widget reflects its own clone/index activity.
type Activity = { kind: string; label: string; detail?: string; since: number };
const systemActivity = new Map<string, Activity>();
function setActivity(projectId: string, kind: string, label: string, detail?: string) { systemActivity.set(projectId, { kind, label, detail, since: Date.now() }); }
function clearActivity(projectId: string, kind: string) { if (systemActivity.get(projectId)?.kind === kind) systemActivity.delete(projectId); }

// Live clone progress, keyed by project — the Clone tab polls /git/clone-progress to
// stream git's output (Receiving/Resolving %). Collapses consecutive progress lines.
interface CloneProgress { lines: string[]; done: boolean; ok: boolean | null; dir: string; startedAt: number }
const cloneProgress = new Map<string, CloneProgress>();
function pushCloneOutput(projectId: string, chunk: string) {
  const p = cloneProgress.get(projectId); if (!p) return;
  for (const seg of chunk.split(/[\r\n]+/)) {
    const line = seg.trim(); if (!line) continue;
    // Git progress lines ("Receiving objects: 42% ...") repeat — replace the last if same label.
    const label = line.split(':')[0];
    const last = p.lines[p.lines.length - 1];
    if (last && /%/.test(line) && last.split(':')[0] === label) p.lines[p.lines.length - 1] = line;
    else p.lines.push(line);
  }
  if (p.lines.length > 300) p.lines = p.lines.slice(-300);
}

function dbQuickCheckOk(conn: any): boolean {
  try {
    const r: any = conn.prepare('PRAGMA quick_check').get();
    const val = r ? (r.quick_check ?? Object.values(r)[0]) : 'unknown';
    return val === 'ok';
  } catch { return false; }
}

function indexResponds(projectId: string = 'default'): boolean {
  // Cheap liveness probe — a malformed image throws here without a full scan.
  try { getDbFor(projectId).prepare('SELECT count(*) AS n FROM files').get(); return true; }
  catch { return false; }
}

async function rebuildIndex(reason: string, projectId: string = 'default'): Promise<void> {
  if (isRebuilding(projectId)) return;
  indexRebuilding.set(projectId, true);
  // Rebuild the project's target repo (its code_index root defaults to its repoPath).
  const ci = await getCodeIndexConfig(projectId);
  const root = ci.root || await projectRepoPath(projectId);
  const env: Record<string, string | undefined> = { ...process.env };
  env.CODE_INDEX_ROOT = root;
  env.CODE_INDEX_PROJECT = projectId; // scope the post-build project-brief pass to this project
  if (ci.glob) env.CODE_INDEX_GLOB = ci.glob;
  // The builder writes into the project's own index file via DB_FILE (getDb honors it).
  env.DB_FILE = projectId === 'default' ? (process.env.DB_FILE ?? 'local.db') : `index-${projectId}.db`;
  setActivity(projectId, 'indexing', 'Reading & remembering repo', root);
  indexLogs.set(projectId, [`$ db:build  (${root})`, 'Reading & remembering the repo…']);
  console.warn(`[db-server] 🛠 code index ${reason} [${projectId}] — rebuilding ${root} via db:build (DB_FILE=${env.DB_FILE}); /search paused`);
  const p = spawn('pnpm', ['run', 'db:build'], { cwd: process.cwd(), shell: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  p.stdout?.on('data', d => pushIndexLog(projectId, d.toString()));
  p.stderr?.on('data', d => pushIndexLog(projectId, d.toString()));
  const done = (msg: string, ok: boolean) => { indexRebuilding.set(projectId, false); clearActivity(projectId, 'indexing'); pushIndexLog(projectId, ok ? '✓ Index rebuilt — agents can now search this repo' : msg); try { resetDbFor(projectId); } catch { /* noop */ } console.log(`[db-server] ${msg}`); };
  p.on('exit', (code) => done(code === 0 ? `✅ code index rebuilt [${projectId}] — /search resumed` : `⚠ db:build exited ${code} [${projectId}] — /search resumed (may be degraded)`, code === 0));
  p.on('error', (err: any) => done(`⚠ db:build failed to start [${projectId}]: ${err?.message} — /search resumed`, false));
}

/** Probe the LIVE board datastore. Must follow the configured backend: on Postgres the
 *  local tasks.db/logs.db files are stale-or-absent, so quick_check'ing them would report
 *  "healthy" while the real database is down — a monitor that can never see the outage. */
async function probeBoardStore(): Promise<string | null> {
  if (isPostgres()) {
    // No quick_check equivalent: pg has no single-file image to corrupt. Reachability of
    // the board table IS the health signal (down/unreachable/schema-missing all surface).
    try { await getStore('tasks').get('SELECT 1 AS n'); } catch { return 'postgres'; }
    return null;
  }
  try {
    // tasks.db is the durable board and stays small — worth a full quick_check.
    if (!dbQuickCheckOk(getTasksDb())) return 'tasks.db';
    // logs.db can grow large — cheap liveness probe (a malformed image throws here).
    try { getLogsDb().prepare('SELECT 1 AS n').get(); } catch { return 'logs.db'; }
    return null;
  } catch { return 'tasks.db'; }
}

async function runDbIntegrityCheck(): Promise<void> {
  // Durable board store — corruption/outage pauses get/update; never auto-rebuilt.
  const bad = await probeBoardStore();
  if (bad && bad !== boardCorrupt) console.error(`[db-server] DB UNHEALTHY: ${bad} — get/update PAUSED; restore from git/backup, then restart`);
  else if (!bad && boardCorrupt) console.log('[db-server] board DB healthy again — get/update resumed');
  boardCorrupt = bad;

  // Code index (may be large) — cheap probe; auto-rebuild on failure. Periodic self-heal
  // watches the DEFAULT project's index; other projects rebuild on demand. Always SQLite:
  // the code index is a local per-project artifact, never moved to Postgres.
  if (!isRebuilding('default') && !indexResponds('default')) rebuildIndex('is corrupt', 'default');
}

// The integrity check must survive a throw without killing the process — but a check that
// KEEPS throwing means the health monitor is dead, and a dead monitor cannot honestly report
// "healthy". A single transient failure is tolerated; a persistent one is escalated to an
// un-missable warning, because that is exactly the case that once went unnoticed for minutes
// (an undefined `isPostgres` threw every tick while the board still served as if fine).
let monitorFailures = 0;
const tickIntegrity = () => {
  void runDbIntegrityCheck()
    .then(() => { monitorFailures = 0; })
    .catch(e => {
      monitorFailures++;
      const detail = e?.message || e;
      if (monitorFailures >= 3) {
        console.error(`[db-server] HEALTH MONITOR DOWN — the integrity check has failed ${monitorFailures} times in a row (${detail}). Board health is UNKNOWN, not necessarily healthy. Fix the monitor.`);
      } else {
        console.error(`[db-server] integrity check failed (${monitorFailures}/3): ${detail}`);
      }
    });
};
setInterval(tickIntegrity, 30_000);
setTimeout(tickIntegrity, 3_000); // one early check shortly after boot

// ── Review previews ──────────────────────────────────────────────────────────
// Build a task's branch and serve it statically on a free port so a human can see
// the REAL built feature before approving the merge, backed by an ISOLATED db-server
// on its own port using the worktree's own db/ copy (never the live tasks.db), so it
// runs safely alongside the pipeline with zero DB contention. Torn down on
// approve/reject or after a timeout. Cross-platform: node_modules is junction-linked
// into the worktree (works on Windows without admin, and on Ubuntu).
interface Preview { status: 'building' | 'ready' | 'error'; url?: string; port?: number; apiPort?: number; error?: string; logTail?: string; logName?: string; proc?: any; backendProc?: any; buildProc?: any; startedAt: number; }
const previews = new Map<string, Preview>();
let nextPreviewPort = parseInt(process.env.PREVIEW_PORT_BASE || '4310');
const PREVIEW_TTL_MS = 30 * 60 * 1000;
// Host the preview links resolve to. Localhost for dev; on a VPS set PREVIEW_HOST to
// the public hostname/IP (and PREVIEW_PROTOCOL=https behind TLS) so the "Open Preview"
// link and the built bundle's API calls point at a browser-reachable address.
const PREVIEW_HOST = process.env.PREVIEW_HOST || 'localhost';
const PREVIEW_PROTO = process.env.PREVIEW_PROTOCOL || 'http';
const previewBase = (p: number) => `${PREVIEW_PROTO}://${PREVIEW_HOST}:${p}`;

function teardownPreview(taskId: string): void {
  const p = previews.get(taskId);
  if (!p) return;
  try { p.proc?.kill(); } catch { /* gone */ }
  try { p.backendProc?.kill(); } catch { /* gone */ }
  try { p.buildProc?.kill(); } catch { /* gone */ }
  previews.delete(taskId);
  console.log(`[db-server] 🧹 preview torn down for ${taskId}`);
}

async function startPreview(taskId: string): Promise<void> {
  const existing = previews.get(taskId);
  if (existing && existing.status !== 'error') return; // already building/ready

  // PROJECT-AWARE: the worktree lives under the task's OWN project repo (honors repoPath), not
  // the host. The build/serve commands come from the project's detected run-config (install /
  // build), and the isolated backend is spawned ONLY if the cloned app actually has one — a
  // frontend-only clone (e.g. a Vite SPA) just gets install → build → vite preview.
  const pid = (await getTask(taskId))?.projectId || 'default';
  const root = await projectRepoPath(pid);
  const wt = join(root, '.worktrees', taskId);
  if (!existsSync(wt)) { previews.set(taskId, { status: 'error', error: 'worktree not found — is the task in review?', startedAt: Date.now() }); return; }

  const rc = ((await getProject(pid))?.runConfig || {}) as Partial<RunConfig>;

  const rootNm = join(root, 'node_modules');
  // Point the worktree at the PROJECT's real node_modules. Worktrees don't carry their own, and
  // any node_modules already in one is either a stale junction from a prior run or a partial dir
  // that lets Node wrongly walk UP to the host's modules — so drop it and (re)link the project's.
  const linkNodeModules = (): void => {
    try {
      const nm = join(wt, 'node_modules');
      if (existsSync(nm)) { try { rmSync(nm, { recursive: true, force: true }); } catch { /* busy */ } }
      if (existsSync(rootNm)) symlinkSync(rootNm, nm, 'junction');
    } catch (e: any) { console.warn(`[db-server] preview node_modules link: ${e?.message}`); }
  };

  const port = nextPreviewPort++;      // frontend (static) port
  const apiPort = nextPreviewPort++;   // isolated backend port (only used if the app has a backend)
  // Capture the install/build/serve output to a log so a FAILED step is diagnosable
  // (it also shows up as a `preview-<id>` chip in the Logs tab).
  const logName = `preview-${taskId}`;
  const previewLog = join(LOGS_DIR, `${logName}.log`);
  try { writeFileSync(previewLog, `── PREVIEW ${new Date().toISOString()} · ${taskId} · ui ${port} · api ${apiPort} · ${wt} ──\n`); } catch { /* dir missing */ }
  const toLog = (): any => { try { return openSync(previewLog, 'a'); } catch { return 'ignore'; } };
  const tail = (): string => { try { return readFileSync(previewLog, 'utf-8').split('\n').filter(Boolean).slice(-15).join('\n'); } catch { return ''; } };
  const logLine = (m: string) => { try { appendFileSync(previewLog, m.endsWith('\n') ? m : m + '\n'); } catch { /* */ } };
  previews.set(taskId, { status: 'building', port, apiPort, logName, startedAt: Date.now() });
  console.log(`[db-server] 🛠 building preview for ${taskId} in ${wt} — ui ${port}, api ${apiPort} (log: ${logName})`);

  const setErr = (error: string) => { previews.set(taskId, { status: 'error', error, logTail: tail(), logName, port, apiPort, startedAt: Date.now() }); console.warn(`[db-server] ✗ preview ${taskId}: ${error} — see ${logName}.log`); };
  // Run a shell command in the worktree, streaming to the preview log.
  const shell = (cmd: string, cb: (code: number | null) => void) => {
    logLine(`\n$ ${cmd}`);
    const p = spawn(cmd, { cwd: wt, shell: true, stdio: ['ignore', toLog(), toLog()] });
    p.on('error', (e: any) => setErr(`failed to start "${cmd}": ${e?.message}`));
    p.on('exit', cb);
    return p;
  };

  const hasBackend = existsSync(join(wt, 'db', 'server.ts'));
  const buildCmd = (rc.build && rc.build.trim()) || 'pnpm exec vite build';
  const installCmd = (rc.install && rc.install.trim()) || '';

  const serveStep = () => {
    // Frontend-only clone → nothing to repoint or run. Dashboard-style app → run its isolated
    // backend on apiPort and repoint the bundle's API URL at it.
    let backend: any = undefined;
    if (hasBackend) {
      try { repointApi(join(wt, 'dist'), previewBase(apiPort)); } catch (e: any) { console.warn(`[db-server] repoint: ${e?.message}`); }
      backend = spawn('pnpm', ['exec', 'tsx', 'db/server.ts'], { cwd: wt, shell: true, stdio: ['ignore', toLog(), toLog()], env: { ...process.env, DB_SERVER_PORT: String(apiPort), DB_FILE: 'local.db' } });
    }
    const serve = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(port), '--strictPort'], { cwd: wt, shell: true });
    let ready = false;
    const markReady = () => { if (ready) return; ready = true; previews.set(taskId, { status: 'ready', url: previewBase(port), port, apiPort, logName, proc: serve, backendProc: backend, startedAt: Date.now() }); console.log(`[db-server] ✅ preview ready for ${taskId} → ${previewBase(port)}`);
      // A green preview satisfies the "preview verified" leg of the project readiness gate.
      setProjectReadiness(pid, { previewVerifiedAt: new Date().toISOString() }).catch(() => { /* project gone */ }); };
    const onData = (d: any) => { try { appendFileSync(previewLog, String(d)); } catch { /* */ } if (/localhost:\d+/.test(String(d))) markReady(); };
    serve.stdout?.on('data', onData); serve.stderr?.on('data', onData);
    serve.on('error', (e: any) => setErr(`vite preview failed to start: ${e?.message}`));
    setTimeout(markReady, 5000); // fallback: preview + backend bind fast
    setTimeout(() => teardownPreview(taskId), PREVIEW_TTL_MS);
    serve.on('exit', () => { const p = previews.get(taskId); if (p?.proc === serve) { try { backend?.kill(); } catch { /* gone */ } previews.delete(taskId); } });
  };

  const buildStep = () => {
    linkNodeModules(); // point the worktree at the project's real (now-installed) node_modules
    const build = shell(buildCmd, (code) => { if (code !== 0) { setErr(`build failed (exit ${code}) — cmd: ${buildCmd}`); return; } serveStep(); });
    previews.set(taskId, { status: 'building', port, apiPort, logName, buildProc: build, startedAt: Date.now() });
  };

  // Ensure the PROJECT ITSELF is installed once (the "pnpm install after cloning" step): if the
  // repo root has no node_modules, run its install command AT THE ROOT so every worktree can link
  // it. Runs in the root (cwd) so pnpm's symlinked store resolves correctly for the whole repo.
  if (!existsSync(rootNm) && installCmd) {
    logLine(`(project not installed — running "${installCmd}" at repo root ${root})`);
    const inst = spawn(installCmd, { cwd: root, shell: true, stdio: ['ignore', toLog(), toLog()] });
    inst.on('error', (e: any) => setErr(`install failed to start "${installCmd}": ${e?.message}`));
    inst.on('exit', (code) => { if (code !== 0) { setErr(`install failed (exit ${code}) — cmd: ${installCmd}. The project may need manual setup.`); return; } buildStep(); });
    previews.set(taskId, { status: 'building', port, apiPort, logName, buildProc: inst, startedAt: Date.now() });
  } else {
    buildStep();
  }
}

/** Repoint the built bundle's hard-coded API URL at the isolated preview backend. */
function repointApi(distDir: string, apiBase: string): void {
  if (!existsSync(distDir)) return;
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(js|html)$/.test(f)) continue;
      const c = readFileSync(p, 'utf-8');
      if (c.includes('http://127.0.0.1:6952')) writeFileSync(p, c.split('http://127.0.0.1:6952').join(apiBase));
    }
  };
  walk(distDir);
}

// Model warmup is opt-in (EMBED_WARMUP=1). Otherwise the embedder lazy-loads
// on the first semantic search — dev startup stays instant.
if (process.env.EMBED_WARMUP === '1') {
  console.log('[db-server] Warming up Hugging Face model...');
  embedQuery('warmup').then(() => console.log('[db-server] Model ready.'));
} else {
  console.log('[db-server] Embedding model: lazy (loads on first search; set EMBED_WARMUP=1 to pre-warm)');
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS — this server holds credentials and has no auth, so we do NOT open it to any origin.
  // Allowed: same-host (covers the app on another port, incl. LAN) and localhost. A malicious
  // web page you visit therefore can't script this API. Override with CORS_ALLOW_ORIGIN
  // (a specific origin, or '*' to restore the old wide-open behavior). Non-browser callers
  // (curl, the agents) send no Origin and are unaffected — CORS only gates browsers.
  {
    const origin = req.headers.origin;
    if (origin) {
      const oHost = origin.replace(/^https?:\/\//, '').split(':')[0].toLowerCase();
      const reqHost = String(req.headers.host || '').split(':')[0].toLowerCase();
      const isLocal = oHost === 'localhost' || oHost === '127.0.0.1' || oHost === '[::1]';
      const sameHost = !!oHost && oHost === reqHost;
      const override = process.env.CORS_ALLOW_ORIGIN;
      if (override === '*' || isLocal || sameHost) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      else if (override) { res.setHeader('Access-Control-Allow-Origin', override); }
      // else: no ACAO header → the browser blocks the cross-origin read.
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  console.log(`[db-server] ${req.method} ${req.url}`);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  // DB self-heal gate — pause only the affected DB requests while a DB is unavailable.
  // Status/diagnostic routes (/health, /version, /heal, /agent-status) always pass through.
  {
    const u = req.url || '';
    const isBoardReq = u.startsWith('/tasks') || u.startsWith('/db/') || u.startsWith('/task-logs');
    if (boardCorrupt && isBoardReq) {
      res.statusCode = 503;
      res.setHeader('Retry-After', '5');
      const reason = boardCorrupt === 'postgres'
        ? 'the Postgres board database is unreachable — check the server and connection URL'
        : `${boardCorrupt} failed integrity check — restore/restart needed`;
      res.end(JSON.stringify({ error: 'DB temporarily unavailable', reason, retryAfter: 5 }));
      return;
    }
    if (anyRebuilding() && u.startsWith('/search')) {
      res.statusCode = 503;
      res.setHeader('Retry-After', '5');
      res.end(JSON.stringify({ error: 'Code index rebuilding — retry shortly', retryAfter: 5 }));
      return;
    }
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({ ok: true })); return;
  }

  if (req.method === 'GET' && req.url === '/version') {
    res.end(JSON.stringify(VERSION_INFO)); return;
  }

  // --- Backend: create tables on a Postgres target ("Create tables" button) ---
  // POST /backend/migrate { url } → open a pgStore to that url, run the portable
  // migrations (see agentic/db/migrations.ts) to CREATE every table, then close the
  // pool. Does NOT switch the live datastore (SQLite stays live) — it only prepares
  // a Postgres DB so a later Phase can point at it. Returns { ok } | { ok:false, error }.
  if (req.method === 'POST' && req.url === '/backend/migrate') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const url = String(body.url || '').trim();
      if (!url) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'url required' })); return; }
      const { openPgStore } = await import('../agentic/db/pgStore.ts');
      const { runMigrations: runStoreMigrations } = await import('../agentic/db/migrations.ts');
      const store = openPgStore(url);
      try {
        await runStoreMigrations(store);
        res.end(JSON.stringify({ ok: true }));
      } finally {
        await store.end().catch(() => { /* pool already closing */ });
      }
    } catch (e: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
    }
    return;
  }

  // --- Spec file API (read-only, specs dir only — inline review context) ---
  if (req.method === 'GET' && req.url?.startsWith('/spec/')) {
    const name = decodeURIComponent(req.url.split('/')[2] || '');
    if (!/^[\w.\-]+\.md$/.test(name)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'bad name' })); return; }
    const p = join(process.cwd(), 'next_changes', 'specs', name);
    try {
      res.end(JSON.stringify({ name, content: existsSync(p) ? readFileSync(p, 'utf-8') : null }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // --- ACCEPT: human says "work completed" → mark DONE + reclaim ALL its disk/DB space ---
  // Purges log rows, removes the task's worktree, deletes its branch (only if
  // merged), and drops its prompt files. One click = zero residue.
  if (req.method === 'POST' && req.url?.match(/^\/tasks\/[^/]+\/accept$/)) {
    const taskId = decodeURIComponent(req.url.split('/')[2]);
    const report: Record<string, any> = { taskId };
    try {
      const { updateTask: upd, purgeTaskLogs: purge } = await import('./tasks.js');
      upd(taskId, { status: 'DONE', completed: new Date().toISOString(), reviewNote: null, leaseExpiresAt: null, nextRetryAt: null });
      report.status = 'DONE';
      report.logsPurged = purge(taskId);

      const git = (args: string[]) => spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf-8', timeout: 15000 });
      const branch = `task/${taskId}`;
      const hasBranch = git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
      if (hasBranch) {
        const merged = git(['merge-base', '--is-ancestor', branch, 'HEAD']).status === 0;
        if (merged) {
          git(['worktree', 'remove', `.worktrees/${taskId}`, '--force']);
          git(['branch', '-D', branch]);
          report.branch = 'deleted (was merged)';
        } else {
          report.branch = 'KEPT — not merged into current branch yet (orchestrator will merge, then clean up)';
        }
      } else {
        report.branch = 'none';
      }

      // Prompt files for this task
      try {
        const dir = join(process.cwd(), 'data', 'task-prompts');
        if (existsSync(dir)) {
          for (const f of (await import('fs')).readdirSync(dir)) {
            if (f.includes(taskId)) (await import('fs')).unlinkSync(join(dir, f));
          }
        }
        report.prompts = 'cleaned';
      } catch { report.prompts = 'skip'; }

      res.end(JSON.stringify(report));
    } catch (e: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message, ...report }));
    }
    return;
  }

  // --- Review preview: build the task's branch & serve it on a free port ---
  if (req.url?.match(/^\/tasks\/[^/]+\/preview$/)) {
    const taskId = decodeURIComponent(req.url.split('/')[2]);
    if (req.method === 'POST') { await startPreview(taskId); const p = previews.get(taskId); res.end(JSON.stringify({ status: p?.status || 'building' })); return; }
    if (req.method === 'GET') { const p = previews.get(taskId); res.end(JSON.stringify(p ? { status: p.status, url: p.url, port: p.port, apiPort: p.apiPort, error: p.error, logTail: p.logTail, logName: p.logName } : { status: 'none' })); return; }
    if (req.method === 'DELETE') { teardownPreview(taskId); res.end(JSON.stringify({ ok: true })); return; }
  }

  // --- APPROVE / REJECT: the human's verdict at a human-gate stage. -------------
  //
  // These used to write `stage: 'merge'` and `stage: 'build'` directly, which hard-coded two
  // stage names into the server. A human gate declares its own outcomes — `approved` and
  // `rejected` in the shipped workflow — and where each one leads is drawn in the graph. So the
  // human reports an outcome exactly as an agent does, and the graph routes it.
  {
    const verdict = req.url?.match(/^\/tasks\/([^/]+)\/(approve|reject)$/);
    if (req.method === 'POST' && verdict) {
      const taskId = decodeURIComponent(verdict[1]);
      const outcome = verdict[2] === 'approve' ? 'approved' : 'rejected';
      try {
        const body = verdict[2] === 'reject' ? JSON.parse((await readBody(req)) || '{}') : {};
        const task = await getTask(taskId);
        if (!task) { res.statusCode = 404; res.end(JSON.stringify({ error: 'task not found' })); return; }

        const wf = await import('../agentic/workflow/index.ts');
        const { doc } = await wf.loadWorkflow(task.projectId || 'default');
        const decision = wf.routeOutcome(doc, task.stage || doc.entry, outcome);
        if (decision.kind !== 'advance') {
          res.statusCode = 409;
          res.end(JSON.stringify({
            error: `stage "${task.stage}" does not declare an "${outcome}" outcome`,
            allowed: decision.kind === 'unknown-outcome' ? decision.allowed : [],
          }));
          return;
        }

        teardownPreview(taskId);
        await updateTask(taskId, {
          stage: decision.to, handoffFrom: task.stage, lastOutcome: outcome,
          status: 'WORKING', started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null,
          // Approving clears the note; rejecting replaces it with the reason.
          ...(outcome === 'approved'
            ? { reviewNote: null }
            : { qaVerdict: null, reviewNote: body.reason || 'rejected by reviewer' }),
        });
        res.end(JSON.stringify({ ok: true, stage: decision.to }));
      } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  }

  // --- Purge task logs (called on human approval — "work accepted") ---
  if (req.method === 'DELETE' && req.url?.startsWith('/task-logs/')) {
    const taskId = decodeURIComponent(req.url.split('/')[2] || '');
    try {
      const { purgeTaskLogs } = await import('./tasks.js');
      res.end(JSON.stringify({ purged: await purgeTaskLogs(taskId) }));
    } catch (e: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // --- Per-task log FILE (GET /task-logs/<id>/file) ---
  // The task's own append-only log, spanning every stage. Its absolute path is read back from
  // `tasks.logPath`, never recomputed, so it survives a UI reload, a db-server restart, and the
  // agent slot being handed to another task. Must be matched before the DB-rows route below.
  if (req.method === 'GET' && /^\/task-logs\/[^/]+\/file(?:[?#]|$)/.test(req.url || '')) {
    const taskId = decodeURIComponent(req.url!.split('/')[2] || '');
    try {
      const task = await getTask(taskId);
      if (!task) { res.statusCode = 404; res.end(JSON.stringify({ error: 'task not found' })); return; }
      const p = task.logPath;
      // The path is stored data. A row written by an older build, a restored DB, or a hand-edit
      // must not be able to make the server read outside the logs root.
      if (p && !isInsideLogsRoot(p)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'log path outside logs root' })); return; }
      if (!p || !existsSync(p)) { res.end(JSON.stringify({ path: p ?? null, exists: false, lines: [] })); return; }
      const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
      res.end(JSON.stringify({ path: p, exists: true, lines }));
    } catch (e: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // --- Task Logs API (DB based — per task history for the detail view) ---
  if (req.method === 'GET' && req.url?.startsWith('/task-logs/')) {
    const taskId = decodeURIComponent(req.url.split('/')[2] || '');
    try {
      const { getAgentLogs } = await import('./tasks.js');
      res.end(JSON.stringify({ logs: await getAgentLogs(taskId, 100) }));
    } catch (e: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // --- Agent Logs API (File based) ---
  // DELETE /agent-logs/<name> — truncate one agent's log file (the UI's "Clear").
  // Logs are disposable: durable per-task history lives in logs.db, not these files.
  if (req.method === 'DELETE' && req.url?.startsWith('/agent-logs/')) {
    const raw = decodeURIComponent((req.url.split('/')[2] || '').split('?')[0]);
    const name = safeLogName(raw);
    if (!name) { res.statusCode = 400; res.end(JSON.stringify({ error: 'bad log name' })); return; }
    try {
      const p = join(LOGS_DIR, `${name}.log`);
      if (existsSync(p)) writeFileSync(p, '');
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith('/agent-logs/')) {
    const agentName = decodeURIComponent((req.url.split('/')[2] || '').split('?')[0]);
    // Synthetic in-memory streams (not backed by .agent_logs files): the live clone
    // output and the repo indexing ("reading & remembering") log, keyed per project.
    if (agentName === '__clone__' || agentName === '__index__') {
      const pid = projectIdOf(req);
      const buf = agentName === '__clone__' ? (cloneProgress.get(pid)?.lines || []) : (indexLogs.get(pid) || []);
      res.end(JSON.stringify(buf.map((l, i) => ({ id: i, message: l, timestamp: new Date().toISOString() }))));
      return;
    }
    // SECURITY: agentName comes straight off the URL. Without this guard a request for
    // `/agent-logs/..%2F..%2Fsecrets` would join() its way clean out of LOGS_DIR.
    const safe = safeLogName(agentName);
    if (!safe) { res.statusCode = 400; res.end(JSON.stringify({ error: 'bad log name' })); return; }
    const logPath = join(LOGS_DIR, `${safe}.log`);
    try {
      if (!existsSync(logPath)) {
        res.end(JSON.stringify([]));
        return;
      }
      // Strip null-byte padding (workspace filesystem corruption) so real lines show.
      const content = readFileSync(logPath, 'utf-8').replace(/\0/g, '');
      const lines = content.split('\n').filter(l => l.trim()).map((l, i) => ({
        id: i,
        message: l.replace(/\s+$/, ''),
        timestamp: new Date().toISOString() // Approximate
      }));
      res.end(JSON.stringify(lines));
    } catch (e: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // --- Heal: recovery sweep — reset stuck jobs, prune orphans, restart dispatch ---
  if (req.method === 'POST' && req.url === '/heal') {
    try {
      const { getAllTasks, updateTask, getHeartbeat } = await import('./tasks.js');
      const steps: { step: string; status: 'ok' | 'fixed' | 'warn'; detail: string }[] = [];
      const tasks = await getAllTasks();

      // 1 — stuck in-progress tasks. Reset ONLY if the lease is expired/missing (agent dead).
      // A live agent's lease is renewed by the watchdog every ~3s, so a future lease = actively
      // working — leave it alone, otherwise heal would spawn a 2nd agent on the same worktree.
      const now = Date.now();
      const isActive = (t: any) => t.leaseExpiresAt && new Date(t.leaseExpiresAt).getTime() >= now;
      const stuck = tasks.filter((t: any) => t.status === 'WORKING' && (t.started || t.claimedBy) && !isActive(t));
      const activeCount = tasks.filter((t: any) => t.status === 'WORKING' && (t.started || t.claimedBy) && isActive(t)).length;
      for (const t of stuck) await updateTask(t.id, { started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null, lastError: 'healed: reset to re-dispatch' });
      steps.push({
        step: 'Stuck in-progress tasks',
        status: stuck.length ? 'fixed' : 'ok',
        detail: stuck.length
          ? `reset ${stuck.length} (${stuck.map((t: any) => t.id).join(', ')}) → re-assigned`
          : (activeCount ? `none stuck · ${activeCount} actively working (left running)` : 'none stuck'),
      });

      // 2 — dead-lettered tasks (retries exhausted) → fresh budget
      // Dead-lettered tasks now sit in BLOCKED (with the reason); revive them to WORKING with a fresh budget.
      const dead = tasks.filter((t: any) => (t.status === 'WORKING' || t.status === 'BLOCKED') && t.nextRetryAt && new Date(t.nextRetryAt).getFullYear() > 3000);
      for (const t of dead) await updateTask(t.id, { status: 'WORKING', nextRetryAt: null, attempts: 0, lastError: 'healed: retry budget reset' });
      steps.push({ step: 'Dead-lettered tasks', status: dead.length ? 'fixed' : 'ok', detail: dead.length ? `revived ${dead.length}` : 'none' });

      // 3 — orphan git worktrees / branches from deleted tasks
      let pruned = 0; const pn: string[] = [];
      try {
        const list = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: process.cwd(), encoding: 'utf-8' }).stdout || '';
        const live = new Set(tasks.map((t: any) => t.id));
        for (const block of list.split(/\n\n+/)) {
          const m = block.match(/^worktree (.+)$/m); if (!m) continue;
          const p = m[1].trim(); if (!p.includes('.worktrees')) continue;
          const name = p.split(/[\\/]/).pop() || ''; const id = name.replace(/^plan-/, '');
          if (id && !live.has(id)) { spawnSync('git', ['worktree', 'remove', p, '--force'], { cwd: process.cwd() }); if (!name.startsWith('plan-')) spawnSync('git', ['branch', '-D', `task/${id}`], { cwd: process.cwd() }); pruned++; pn.push(name); }
        }
        spawnSync('git', ['worktree', 'prune'], { cwd: process.cwd() });
      } catch { /* git optional */ }
      steps.push({ step: 'Orphan worktrees', status: pruned ? 'fixed' : 'ok', detail: pruned ? `pruned ${pruned} (${pn.join(', ')})` : 'none' });

      // 4 — database integrity: SQLite quick_check catches "disk image malformed" early.
      const dbBad: string[] = [];
      try {
        const { getTasksDb, getLogsDb } = await import('./tasks.js');
        for (const [dbName, conn] of [['tasks.db', getTasksDb()], ['logs.db', getLogsDb()]] as [string, any][]) {
          try {
            const r: any = conn.prepare('PRAGMA quick_check').get();
            const val = r ? (r.quick_check ?? Object.values(r)[0]) : 'unknown';
            if (val !== 'ok') dbBad.push(dbName);
          } catch { dbBad.push(dbName); }
        }
      } catch { /* optional */ }
      steps.push({ step: 'Database integrity', status: dbBad.length ? 'warn' : 'ok', detail: dbBad.length ? `corrupt: ${dbBad.join(', ')} — rebuild/restore needed` : 'tasks.db + logs.db healthy' });

      // 5 — stale agent logs (keep only agents currently working)
      const busyAgents = new Set<string>(tasks.filter((t: any) => t.status === 'WORKING' && t.claimedBy).map((t: any) => t.claimedBy));
      const clearedLogs = pruneAgentLogs(busyAgents);
      steps.push({ step: 'Stale agent logs', status: clearedLogs ? 'fixed' : 'ok', detail: clearedLogs ? `cleared ${clearedLogs}` : 'none' });

      // 6 — orchestrator liveness — heal can reset jobs but CANNOT spawn agents
      // (that's the orchestrator's job, a separate process). Be honest if it's down.
      let hbAge = Infinity; let hbDetail = 'never started';
      try { const h: any = await getHeartbeat(); if (h?.lastBeatAt) { hbAge = Math.round((Date.now() - new Date(h.lastBeatAt).getTime()) / 1000); hbDetail = `last beat ${hbAge}s ago · circuit ${h.circuit}`; } } catch { /* optional */ }
      try { const s = await getBoardSettings() || {}; await updateBoardSettings({ ...s, agentStatus: 'STARTED' }); } catch { /* non-fatal */ }
      const orchDown = hbAge > 90;
      steps.push({
        step: 'Orchestrator',
        status: orchDown ? 'warn' : 'ok',
        detail: orchDown
          ? `DOWN (${hbDetail}) — nothing will run until you start it: pnpm run db:orchestrator`
          : `${hbDetail} · alive — reset jobs dispatch in a few seconds`,
      });

      // 7 — context memory GC. Reclaims files left in project context by abruptly-killed
      // agents (age-out stale unpinned + evict over-cap). Prunes by staleness/size, never
      // by "is an agent still holding it" — a dead process can't clean up after itself.
      try {
        const { sweepAllContext } = await import('../agentic/index.ts');
        const swept = await sweepAllContext();
        const freed = Object.values(swept).reduce((s: number, r: any) => s + (r.freedTokens || 0), 0);
        const projs = Object.keys(swept).length;
        steps.push({ step: 'Context memory GC', status: freed ? 'fixed' : 'ok', detail: freed ? `freed ${freed} tok across ${projs} project(s)` : (projs ? `${projs} project(s) within budget` : 'no context yet') });
      } catch (e: any) { steps.push({ step: 'Context memory GC', status: 'warn', detail: `sweep failed: ${e.message}` }); }

      res.end(JSON.stringify({ ok: true, healed: steps.filter(s => s.status === 'fixed').length, steps }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // --- Log file list (Logs tab chips) ---
  if (req.method === 'GET' && (req.url || '').split('?')[0] === '/agent-log-files') {
    try {
      const { readdirSync, statSync } = await import('fs');
      const { getAllTasks } = await import('./tasks.js');
      const live = (await getAllTasks()).filter((t: any) => t.status === 'WORKING' && t.claimedBy);
      // Derive the role from the task's live STAGE (authoritative, from the DB) rather than
      // parsing the log header — the parse could go stale and stick on the first stage.
      const STAGE_ROLE: Record<string, string> = { plan: 'architect', build: 'dev', qa: 'qa', review: 'review', merge: 'merge' };
      const byAgent = new Map<string, any>();
      for (const t of live) if (t.claimedBy) byAgent.set(t.claimedBy, t);
      const files = existsSync(LOGS_DIR)
        ? readdirSync(LOGS_DIR).filter(f => f.endsWith('.log')).map(f => {
            const p = join(LOGS_DIR, f);
            const st = statSync(p);
            const name = f.replace(/\.log$/, '');
            const isSystem = name === 'orchestrator' || name === '__system__';
            const task = byAgent.get(name);
            let now = '';
            if (!isSystem) now = task ? `${STAGE_ROLE[task.stage as string] || task.stage || 'working'} · ${task.id}` : 'idle';
            return { name, kind: isSystem ? 'system' : 'agent', sizeKB: Math.round(st.size / 1024), modified: st.mtime.toISOString(), now, busy: !!task };
          }).sort((a, b) => a.name.localeCompare(b.name))
        : [];
      // Surface the in-memory clone + indexing streams as pseudo log files for the
      // active project, so the Logs tab shows them alongside real agent logs.
      const pid = projectIdOf(req);
      const synth: any[] = [];
      const cp = cloneProgress.get(pid);
      if (cp && cp.lines.length) synth.push({ name: '__clone__', kind: 'system', sizeKB: 0, modified: new Date(cp.startedAt).toISOString(), now: cp.done ? (cp.ok ? 'clone done' : 'clone failed') : 'cloning', busy: !cp.done });
      const il = indexLogs.get(pid);
      if (il && il.length) synth.push({ name: '__index__', kind: 'system', sizeKB: 0, modified: new Date().toISOString(), now: isRebuilding(pid) ? 'reading repo' : 'idle', busy: isRebuilding(pid) });
      res.end(JSON.stringify({ files: [...synth, ...files] }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // --- Agents config (Agents tab) ---
  if (req.url === '/agents' && req.method === 'GET') {
    try {
      const { getAgents } = await import('../agentic/index.ts');
      res.end(JSON.stringify({ agents: (await getAgents()).map((a: any) => ({ ...a, enabled: a.enabled ? 1 : 0, isSystem: a.isSystem ? 1 : 0 })) }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (req.url === '/agents' && req.method === 'PUT') {
    try {
      const body = JSON.parse(await readBody(req));
      const { upsertAgent } = await import('../agentic/index.ts');
      await upsertAgent({ ...body, enabled: !!body.enabled, isSystem: !!body.isSystem });
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (req.url === '/agents/reset' && req.method === 'POST') {
    try { const { resetAgents } = await import('../agentic/index.ts'); await resetAgents(); res.end(JSON.stringify({ ok: true })); }
    catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // --- Workflow document ------------------------------------------------------
  // GET    /workflow?project=<id>   -> { doc, source, valid, stageIssues, docErrors, occupied }
  // PUT    /workflow?project=<id>   -> { doc } on success; 409 conflict / 422 invalid otherwise
  // DELETE /workflow?project=<id>   -> forget it; fall back to the built-in pipeline
  //
  // Every rule lives in agentic/workflow so the browser and this server run the SAME validator.
  // A client can be skipped with curl, and a workflow where some stage cannot reach the terminal
  // strands every task that reaches it — in WORKING forever, invisible.
  if ((req.url || '').split('?')[0] === '/workflow') {
    const pid = projectIdOf(req);
    try {
      const wf = await import('../agentic/workflow/index.ts');

      if (req.method === 'GET') {
        const { doc, source } = await wf.loadWorkflow(pid);
        const v = wf.validateWorkflow(doc);
        // Report which stages have live tasks on them, so the editor can lock those nodes
        // BEFORE the user drags them into the bin and gets a 409 for their trouble.
        const occupied = await wf.occupiedStagesFor(pid);
        res.end(JSON.stringify({ doc, source, valid: v.ok, docErrors: v.docErrors, stageIssues: v.stageIssues, occupied }));
        return;
      }

      if (req.method === 'PUT') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const doc = body.doc ?? body;
        const expectedRev = Number(body.expectedRev ?? doc?.rev ?? 0);
        if (!Number.isInteger(expectedRev) || expectedRev < 0) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'expectedRev must be a whole number' }));
          return;
        }

        const r = await wf.saveWorkflow(pid, doc, expectedRev);
        switch (r.kind) {
          case 'saved':
            console.log(`[db-server] workflow saved (${pid}) rev ${r.doc.rev}`);
            res.end(JSON.stringify({ ok: true, doc: r.doc }));
            return;
          // 409: somebody saved while you were editing. Their write stands; reload and reapply.
          case 'conflict':
            res.statusCode = 409;
            res.end(JSON.stringify({ error: 'the workflow changed while you were editing', currentRev: r.currentRev }));
            return;
          // 422: the document itself is wrong.
          case 'invalid':
            res.statusCode = 422;
            res.end(JSON.stringify({ error: 'invalid workflow', docErrors: r.docErrors, stageIssues: r.stageIssues }));
            return;
          // 409: a task is standing on ground this edit removes.
          case 'occupied':
            res.statusCode = 409;
            res.end(JSON.stringify({ error: 'a running task would be stranded', conflicts: r.conflicts }));
            return;
        }
      }

      if (req.method === 'DELETE') {
        await wf.resetWorkflow(pid);
        res.end(JSON.stringify({ ok: true, doc: wf.defaultWorkflow() }));
        return;
      }
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); return; }
  }

  // --- Restore defaults -------------------------------------------------------
  // GET  /db/restore-defaults?mode=delete|overwrite  → what WOULD happen (no writes)
  // POST /db/restore-defaults {"mode":"delete"|"overwrite"} → do it
  //
  // Scope is enforced in agentic/db/seed.ts, not here: `projects` and `tasks` are never
  // touched, and within board_settings only the declared config keys are. Resetting the
  // `default` project would repoint it at Piranha's own source tree.
  if ((req.url || '').split('?')[0] === '/db/restore-defaults') {
    const parseMode = (v: unknown): 'delete' | 'overwrite' | null =>
      v === 'delete' || v === 'overwrite' ? v : null;
    try {
      if (req.method === 'GET') {
        const raw = new URL(req.url!, 'http://x').searchParams.get('mode');
        const mode = parseMode(raw) ?? 'overwrite';
        const { previewRestore } = await import('../agentic/db/seed.ts');
        res.end(JSON.stringify(await previewRestore(mode)));
        return;
      }
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const mode = parseMode(body.mode);
        if (!mode) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'mode must be "delete" or "overwrite"' }));
          return;
        }
        const { restoreDefaults } = await import('../agentic/db/seed.ts');
        const result = await restoreDefaults(mode);
        console.log(`[db-server] restore-defaults (${mode}): agents ${result.agents.deleted}del/${result.agents.written}w, settings ${result.boardSettings.deleted}del/${result.boardSettings.written}w`);
        res.end(JSON.stringify({ ok: true, ...result }));
        return;
      }
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); return; }
  }
  // Global agent defaults (the fallback each project inherits). maxConcurrency 0 = unlimited.
  if (req.url === '/agent-defaults' && req.method === 'GET') {
    try { res.end(JSON.stringify(await getAgentDefaults())); }
    catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (req.url === '/agent-defaults' && req.method === 'PUT') {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      res.end(JSON.stringify(await setAgentDefaults({
        maxConcurrency: b.maxConcurrency != null ? Number(b.maxConcurrency) : undefined,
        permissionProfile: b.permissionProfile,
      })));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  const agentDel = req.url?.match(/^\/agents\/([^/]+)$/);
  if (agentDel && req.method === 'DELETE') {
    try { const { deleteAgent } = await import('../agentic/index.ts'); await deleteAgent(decodeURIComponent(agentDel[1])); res.end(JSON.stringify({ ok: true })); }
    catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // --- Project explorer + context memory (Context tab) ---
  // File tree for the project's repo (git-tracked files; respects .gitignore).
  if (req.method === 'GET' && req.url?.startsWith('/files')) {
    try {
      const root = await projectRepoPath(projectIdOf(req));
      // The 'default' project's repoPath is the orchestrator's own repo (the host cwd).
      // Context is for USER projects (one per git repo) — never expose the host's files here.
      if (root === process.cwd()) { res.end(JSON.stringify({ root, files: [], isHost: true })); return; }
      const { listRepoFiles } = await import('../agentic/index.ts');
      res.end(JSON.stringify({ root, files: listRepoFiles(root) }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  // Read one file (preview + token estimate). ?path=<repo-relative>
  if (req.method === 'GET' && req.url?.startsWith('/file?')) {
    try {
      const { estimateTokens } = await import('../agentic/index.ts');
      const u = new URL(req.url, 'http://x');
      const rel = u.searchParams.get('path') || '';
      const root = await projectRepoPath(projectIdOf(req));
      const abs = join(root, rel);
      if (!abs.startsWith(root) || rel.includes('..')) { res.statusCode = 400; res.end(JSON.stringify({ error: 'path escapes repo' })); return; }
      const bytes = statSync(abs).size;
      const tooBig = bytes > 512 * 1024;
      const content = tooBig ? '' : readFileSync(abs, 'utf-8');
      res.end(JSON.stringify({ path: rel, bytes, tokens: estimateTokens(bytes), truncated: tooBig, content }));
    } catch (e: any) { res.statusCode = 404; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── File Browser: write + AI-edit (the chat) — see docs/api-reference.md ──
  // These four blocks key on method + exact path, so they never collide with the GET /file(s)
  // reads above. AI-edit only PROPOSES; the human approves and the frontend calls PUT /file.

  // PUT /file — save (overwrite) an existing file. { path, content }
  if (req.method === 'PUT' && (req.url || '').split('?')[0] === '/file') {
    try {
      const body = JSON.parse(await readBody(req));
      const rel = String(body.path || '');
      const root = await projectRepoPath(projectIdOf(req, body));
      const abs = join(root, rel);
      if (!abs.startsWith(root) || rel.includes('..')) { res.statusCode = 400; res.end(JSON.stringify({ error: 'path escapes repo' })); return; }
      if (!existsSync(abs)) { res.statusCode = 404; res.end(JSON.stringify({ error: 'file does not exist — use POST to create' })); return; }
      writeFileSync(abs, String(body.content ?? ''), 'utf-8');
      res.end(JSON.stringify({ ok: true, path: rel, bytes: statSync(abs).size }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // POST /file — create a new file (+ parent dirs). Refuse if it already exists. { path, content? }
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/file') {
    try {
      const body = JSON.parse(await readBody(req));
      const rel = String(body.path || '');
      if (!rel.trim()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'path is required' })); return; }
      const root = await projectRepoPath(projectIdOf(req, body));
      const abs = join(root, rel);
      if (!abs.startsWith(root) || rel.includes('..')) { res.statusCode = 400; res.end(JSON.stringify({ error: 'path escapes repo' })); return; }
      if (existsSync(abs)) { res.statusCode = 409; res.end(JSON.stringify({ error: 'file already exists' })); return; }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, String(body.content ?? ''), 'utf-8');
      res.end(JSON.stringify({ ok: true, path: rel }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // DELETE /file?path= — delete a file.
  if (req.method === 'DELETE' && (req.url || '').split('?')[0] === '/file') {
    try {
      const rel = new URL(req.url!, 'http://x').searchParams.get('path') || '';
      const root = await projectRepoPath(projectIdOf(req));
      const abs = join(root, rel);
      if (!abs.startsWith(root) || rel.includes('..')) { res.statusCode = 400; res.end(JSON.stringify({ error: 'path escapes repo' })); return; }
      if (!existsSync(abs)) { res.statusCode = 404; res.end(JSON.stringify({ error: 'file not found' })); return; }
      unlinkSync(abs);
      res.end(JSON.stringify({ ok: true, path: rel }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // POST /file/ai-edit — the chat engine. Reads the tagged files + uploads + instruction, asks
  // `claude -p` (same CLI/auth as /intake — no API key) for full new contents, and returns a
  // proposal + unified diff per changed file. Writes NOTHING. Also reports timing/TPS metrics.
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/file/ai-edit') {
    try {
      const body = JSON.parse(await readBody(req));
      const instruction = String(body.instruction || '').trim();
      if (!instruction) { res.statusCode = 400; res.end(JSON.stringify({ error: 'instruction required' })); return; }
      const root = await projectRepoPath(projectIdOf(req, body));

      // Read each tagged repo file (guard per path); note skips to report in the answer.
      const tagged: Array<{ path: string }> = Array.isArray(body.files) ? body.files : [];
      const uploads: Array<{ name: string; content: string }> = Array.isArray(body.uploads) ? body.uploads : [];
      const skipped: string[] = [];
      const repoFiles: Array<{ path: string; content: string }> = [];
      for (const f of tagged) {
        const rel = String(f?.path || '');
        const abs = join(root, rel);
        if (!rel || !abs.startsWith(root) || rel.includes('..')) { skipped.push(`${rel || '(empty)'} — path escapes repo`); continue; }
        if (!existsSync(abs)) { skipped.push(`${rel} — missing`); continue; }
        if (statSync(abs).size > 512 * 1024) { skipped.push(`${rel} — >512KB`); continue; }
        repoFiles.push({ path: rel, content: readFileSync(abs, 'utf-8') });
      }

      // Cap total reference-upload bytes — the whole lot is inlined into the prompt, so an
      // oversized batch bloats the model call (and cost) before it ever runs. Reject early.
      const uploadBytes = uploads.reduce((n, u) => n + Buffer.byteLength(String(u?.content ?? ''), 'utf8'), 0);
      if (uploadBytes > 2_000_000) { res.statusCode = 413; res.end(JSON.stringify({ error: 'uploads too large — keep total reference files under 2 MB' })); return; }

      const prompt = [
        'You are a code-editing assistant. Apply the INSTRUCTION to the REPO FILES below.',
        'Return ONLY minified JSON — no markdown fences, no prose outside the JSON:',
        '{"answer":"<short explanation>","files":[{"path":"<repo path>","content":"<FULL new file content>"}]}',
        'Each entry must be the ENTIRE new file content, never a diff or a fragment. Include ONLY files you changed; omit the rest.',
        'The UPLOADS are reference context ONLY — never emit them as files.',
        '',
        `INSTRUCTION:\n${instruction}`,
        '',
        ...repoFiles.map(f => `=== ${f.path} ===\n${f.content}`),
        ...uploads.map(u => `=== upload: ${u.name} (reference only) ===\n${String(u.content ?? '')}`),
      ].join('\n');

      // One model session per chat thread. First turn issues a fresh id; later turns resume it
      // so a thread remembers its own history and no other thread's.
      const { randomUUID } = await import('node:crypto');
      const priorSession = String(body.sessionId || '').trim();
      const sessionId = priorSession || randomUUID();
      const sessionFlags = priorSession ? ['--resume', priorSession] : ['--session-id', sessionId];

      const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
      const model = ['haiku', 'sonnet', 'opus'].includes(String(body.model)) ? String(body.model) : 'sonnet';
      const effort = String(body.effort || '');
      const effortFlags = ['low', 'medium', 'high'].includes(effort) ? ['--effort', effort] : [];

      const t0 = Date.now();
      const proc = spawnSync(CLAUDE_BIN,
        ['-p', prompt, '--model', model, ...sessionFlags, ...effortFlags, '--output-format', 'json', '--dangerously-skip-permissions'],
        { encoding: 'utf8', timeout: 150000, maxBuffer: 16 * 1024 * 1024 });
      const wallMs = Date.now() - t0;
      // spawnSync killed on timeout → surface a clear 504, not the generic "could not parse" 502
      // (a timed-out run has no output to parse, so it would otherwise fall through as garbage).
      if ((proc as any).error?.code === 'ETIMEDOUT' || proc.signal === 'SIGTERM') {
        res.statusCode = 504; res.end(JSON.stringify({ error: 'the model timed out (took over 150s) — try a smaller instruction or fewer files' })); return;
      }
      const out = (proc.stdout || '') + (proc.stderr || '');

      // Parse the CLI JSON envelope, then the model's own JSON inside `.result`.
      let envelope: any = null;
      { const s = out.indexOf('{'); const e = out.lastIndexOf('}'); if (s >= 0 && e > s) { try { envelope = JSON.parse(out.slice(s, e + 1)); } catch { /* fall through */ } } }
      const resultText: string = typeof envelope?.result === 'string' ? envelope.result : out;
      let parsed: any = null;
      { const s = resultText.indexOf('{'); const e = resultText.lastIndexOf('}'); if (s >= 0 && e > s) { try { parsed = JSON.parse(resultText.slice(s, e + 1)); } catch { /* fall through */ } } }
      if (!parsed || !Array.isArray(parsed.files)) {
        res.statusCode = 502; res.end(JSON.stringify({ error: 'Could not parse a proposal from the model', raw: out.slice(0, 600) })); return;
      }

      // Each returned file → a proposal with a real unified diff. Never propose outside the repo.
      const proposals: Array<{ path: string; oldContent: string; newContent: string; diff: string }> = [];
      for (const f of parsed.files) {
        const rel = String(f?.path || '');
        const abs = join(root, rel);
        if (!rel || !abs.startsWith(root) || rel.includes('..')) { skipped.push(`${rel || '(empty)'} — proposal outside repo, dropped`); continue; }
        const newContent = String(f.content ?? '');
        const oldContent = existsSync(abs) ? readFileSync(abs, 'utf-8') : '';
        if (oldContent === newContent) continue; // no-op proposal
        proposals.push({ path: rel, oldContent, newContent, diff: unifiedDiff(rel, oldContent, newContent) });
      }

      // Metrics — response time + tokens/sec, straight from the CLI envelope (falls back to wall
      // clock if the envelope is missing). TPS is OVERALL: output tokens over the whole response.
      // We do NOT divide by (duration − ttft): the non-streaming json reports ttft ≈ duration, so
      // that window is a few ms and would inflate TPS into the thousands. ttft is exposed on its
      // own for the UI to show "time to first token" separately.
      const durationMs = Number(envelope?.duration_ms) || wallMs;
      const outputTokens = Number(envelope?.usage?.output_tokens) || 0;
      const tps = outputTokens > 0 && durationMs > 0 ? +(outputTokens / (durationMs / 1000)).toFixed(1) : 0;
      const metrics = {
        responseMs: durationMs,
        responseSec: +(durationMs / 1000).toFixed(2),
        ttftMs: Number(envelope?.ttft_ms) || null,
        outputTokens,
        inputTokens: Number(envelope?.usage?.input_tokens) || 0,
        tps,
        costUsd: Number(envelope?.total_cost_usd) || 0,
      };

      const answer = (String(parsed.answer || '') + (skipped.length ? `\n\n(skipped: ${skipped.join('; ')})` : '')).trim();
      res.end(JSON.stringify({ answer, sessionId, proposals, metrics }));
    } catch (e: any) { res.statusCode = e?.statusCode || 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // Context memory — what is in agents' working memory right now (per project).
  if (req.url?.startsWith('/context')) {
    try {
      const ctx = await import('../agentic/index.ts');
      const project = projectIdOf(req);
      const u = new URL(req.url, 'http://x');
      const cap = Number(u.searchParams.get('cap')) || ctx.DEFAULT_CONTEXT_CAP;

      if (req.method === 'GET' && /^\/context(\?.*)?$/.test(req.url)) {
        res.end(JSON.stringify({ files: await ctx.listContext(project), stats: await ctx.contextStats(project, cap) }));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/context/ops')) {
        res.end(JSON.stringify({ ops: await ctx.getContextOps(project, Number(u.searchParams.get('limit')) || 100) }));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/context/usage')) {
        res.end(JSON.stringify({ usage: await ctx.getFileUsage(project, Number(u.searchParams.get('limit')) || 50) }));
        return;
      }
      if (req.method === 'POST' && req.url.startsWith('/context/sweep')) {
        // GC = reconcile against disk truth (drop files deleted/renamed since last kept),
        // THEN age-out + enforce cap. The disk reconcile is what a manual Sweep adds over
        // the automatic merge-time sync — it catches deletes made outside the merge flow.
        const root = await projectRepoPath(project);
        const deleted = root === process.cwd() ? [] : await ctx.reconcileContext(project, ctx.listRepoFiles(root));
        const result = await ctx.sweepContext(project, { cap });
        res.end(JSON.stringify({ result: {
          ...result,
          deletedOnDisk: deleted.length,
          freedTokens: result.freedTokens + deleted.reduce((s, f) => s + (f.tokens || 0), 0),
        } }));
        return;
      }
      if (req.method === 'POST' && req.url.startsWith('/context/pin')) {
        const b = JSON.parse(await readBody(req));
        res.end(JSON.stringify({ ok: await ctx.setPinned(project, b.path, !!b.pinned, b.actor || 'user') }));
        return;
      }
      if (req.method === 'POST' && /^\/context(\?.*)?$/.test(req.url)) {
        const t0 = Date.now();
        const b = JSON.parse(await readBody(req));
        const root = await projectRepoPath(project);
        const abs = join(root, b.path);
        if (!abs.startsWith(root) || String(b.path).includes('..')) { res.statusCode = 400; res.end(JSON.stringify({ error: 'path escapes repo' })); return; }
        const bytes = statSync(abs).size;                 // read cost is timed into durationMs
        const tokens = ctx.estimateTokens(bytes);
        const r = await ctx.keepInContext({ projectId: project, path: b.path, tokens, addedBy: b.addedBy || 'user', pinned: b.pinned, taskId: b.taskId ?? null, durationMs: Date.now() - t0, cap });
        res.end(JSON.stringify({ file: r.file, evicted: r.evicted, stats: await ctx.contextStats(project, cap) }));
        return;
      }
      if (req.method === 'DELETE' && req.url.startsWith('/context')) {
        res.end(JSON.stringify({ ok: await ctx.removeFromContext(project, u.searchParams.get('path') || '', 'user', 'user removed') }));
        return;
      }
      res.statusCode = 404; res.end(JSON.stringify({ error: 'unknown context route' }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // --- DB browser (Database tab) — allowlisted tables across tasks.db + logs.db ---
  //
  // SQLITE ONLY, on purpose. Every query below leans on SQLite-specific surface: `PRAGMA
  // table_info` for the column list and the implicit `rowid` as the edit/delete key.
  // Postgres has neither (information_schema + a real primary key instead). Rather than
  // let it silently read the stale local .db files — reporting 0 rows while the live
  // Postgres board is full — the routes refuse. Porting them is tracked in PUT /backend.
  if (req.url?.startsWith('/db/table') && isPostgres()) {
    res.statusCode = 501;
    res.end(JSON.stringify({ error: 'The DB browser is SQLite-only', reason: 'This datastore is Postgres — inspect it with psql or your own client.' }));
    return;
  }
  if (req.url === '/db/tables' && req.method === 'GET') {
    try {
      const { getTasksDb, getLogsDb } = await import('./tasks.js');
      const defs = [
        { n: 'tasks', d: getTasksDb() }, { n: 'board_settings', d: getTasksDb() },
        { n: 'agents', d: getTasksDb() }, { n: 'memory', d: getTasksDb() },
        { n: 'agent_logs', d: getLogsDb() }, { n: 'agent_db_usage', d: getLogsDb() },
      ];
      const tables = defs.map(t => { let rows = 0; try { rows = (t.d.prepare(`SELECT COUNT(*) c FROM ${t.n}`).get() as any)?.c ?? 0; } catch { } return { name: t.n, rows }; });
      res.end(JSON.stringify({ tables }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  const dbRow = req.url?.match(/^\/db\/table\/([a-zA-Z_]+)(?:\/([^/?]+))?/);
  if (dbRow) {
    const table = dbRow[1]; const rowid = dbRow[2];
    try {
      const { getTasksDb, getLogsDb } = await import('./tasks.js');
      const TASKS = ['tasks', 'board_settings', 'agents', 'memory']; const LOGS = ['agent_logs', 'agent_db_usage'];
      const conn = TASKS.includes(table) ? getTasksDb() : LOGS.includes(table) ? getLogsDb() : null;
      if (!conn) { res.statusCode = 400; res.end(JSON.stringify({ error: 'table not allowed' })); return; }

      // Column names cannot be bound as parameters — they are interpolated into the SQL.
      // So they must come from the SCHEMA, never from the request body: `{"a = 1; DROP …": 1}`
      // as an update key would otherwise be executed verbatim. `table` is already allowlisted.
      const cols = (conn.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(c => ({ name: String(c.name), type: c.type, pk: c.pk }));
      const colNames = new Set(cols.map(c => c.name));
      const safeCols = (keys: string[]): string[] => keys.filter(k => colNames.has(k));

      if (req.method === 'POST' && rowid === 'bulk-delete') {
        const { rowids } = JSON.parse(await readBody(req)); const stmt = conn.prepare(`DELETE FROM ${table} WHERE rowid = ?`);
        for (const r of rowids || []) stmt.run(r); res.end(JSON.stringify({ ok: true, deleted: (rowids || []).length })); return;
      }
      if (req.method === 'POST' && rowid === 'bulk-update') {
        const { rowids, set } = JSON.parse(await readBody(req)); const col = safeCols(Object.keys(set || {}))[0];
        if (!col) { res.statusCode = 400; res.end(JSON.stringify({ error: 'no known column to update' })); return; }
        const stmt = conn.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`); for (const r of rowids || []) stmt.run(set[col], r);
        res.end(JSON.stringify({ ok: true })); return;
      }
      if (req.method === 'GET' && !rowid) {
        const u = new URL(req.url!, 'http://x');
        const limit = Math.min(200, parseInt(u.searchParams.get('limit') || '25')); const offset = parseInt(u.searchParams.get('offset') || '0');
        const q = u.searchParams.get('q') || ''; const sort = u.searchParams.get('sort'); const dir = u.searchParams.get('dir') === 'asc' ? 'ASC' : 'DESC';
        const columns = cols;
        let where = ''; const params: any[] = [];
        if (q) { where = 'WHERE ' + columns.map(c => `CAST(${c.name} AS TEXT) LIKE ?`).join(' OR '); for (const _ of columns) params.push(`%${q}%`); }
        const total = (conn.prepare(`SELECT COUNT(*) c FROM ${table} ${where}`).get(...params) as any)?.c ?? 0;
        const orderBy = (sort && colNames.has(sort)) ? `ORDER BY ${sort} ${dir}` : 'ORDER BY rowid DESC';
        const rows = conn.prepare(`SELECT rowid as _rowid, * FROM ${table} ${where} ${orderBy} LIMIT ? OFFSET ?`).all(...params, limit, offset);
        res.end(JSON.stringify({ columns, rows, total })); return;
      }
      if (req.method === 'POST' && !rowid) {
        const body = JSON.parse(await readBody(req)); const keys = safeCols(Object.keys(body));
        if (keys.length) conn.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => body[k]));
        res.end(JSON.stringify({ ok: true })); return;
      }
      if (req.method === 'PUT' && rowid) {
        const body = JSON.parse(await readBody(req)); const keys = safeCols(Object.keys(body).filter(k => k !== '_rowid'));
        if (keys.length) conn.prepare(`UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(',')} WHERE rowid = ?`).run(...keys.map(k => body[k]), rowid);
        res.end(JSON.stringify({ ok: true })); return;
      }
      if (req.method === 'DELETE' && rowid) { conn.prepare(`DELETE FROM ${table} WHERE rowid = ?`).run(rowid); res.end(JSON.stringify({ ok: true })); return; }
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); return; }
  }

  // --- Agent Status API ---
  // Also reports the plan-limit pause window: the orchestrator persists an ISO timestamp
  // under system_state.limitPausedUntil while the swarm waits for the limit to reset.
  // Read defensively — the table (or row) may not exist yet, and this diagnostic route
  // must always respond — so any failure just reports null.
  if (req.method === 'GET' && (req.url || '').split('?')[0] === '/agent-status') {
    let limitPausedUntil: string | null = null;
    try {
      const row = getTasksDb().prepare(`SELECT value FROM system_state WHERE key = 'limitPausedUntil'`).get() as any;
      limitPausedUntil = row?.value ?? null;
    } catch { /* system_state not created yet (parallel migration) — report null */ }
    res.end(JSON.stringify({ agents: Array.from(ACTIVE_AGENTS), limitPausedUntil }));
    return;
  }

  // --- Agent Stop (legacy UI-tracking no-op) ---
  // The real controls are the per-task lifecycle routes below (/tasks/:id/{start,pause,
  // resume,stop}) and the orchestrator routes (/orchestrator/{start,pause}). Agent
  // processes are owned by the orchestrator (a separate process) — the server never spawns
  // them. The dead `/agent-start/` antigravity spawner was removed. This endpoint just
  // clears any stale UI-tracking entry and returns ok so old clients don't error.
  if (req.method === 'POST' && req.url?.startsWith('/agent-stop/')) {
    const agentName = req.url.split('/')[2];
    ACTIVE_AGENTS.delete(agentName);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // --- Tasks API ---
  if (req.url?.startsWith('/tasks')) {

    try {
      if (req.method === 'GET' && req.url?.match(/^\/tasks(\?.*)?$/)) {
        const tasks = await getAllTasks(projectIdOf(req));
        res.end(JSON.stringify(tasks));
        return;
      }
      if (req.method === 'PUT' && req.url === '/tasks/bulk-priority') {
        const body = JSON.parse(await readBody(req));
        await bulkUpdatePriorities(body);
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      const idMatch = req.url.match(/^\/tasks\/([^/]+)$/);
      const triggerMatch = req.url.match(/^\/tasks\/([^/]+)\/trigger$/);

      // ── per-task lifecycle control (project-scoped via ?project=) ──────────────────
      // The server and orchestrator are SEPARATE processes sharing tasks.db. The server
      // can't kill an agent directly, so these routes only set DB flags; the orchestrator
      // (which owns the agent processes) reads them and enforces:
      //   start  → queue for dispatch (fresh: WORKING, control cleared, attempts reset)
      //   pause  → hold from the NEXT dispatch (a running agent is LEFT running)
      //   resume → clear the hold and re-queue for dispatch
      //   stop   → kill-now request: the orchestrator kills any live agent, then parks the
      //            task (AVAILABLE + control='paused') out of dispatch until resumed/started
      const lifecycleMatch = req.url.match(/^\/tasks\/([^/]+)\/(start|pause|resume|stop)$/);
      if (lifecycleMatch && req.method === 'POST') {
        const taskId = decodeURIComponent(lifecycleMatch[1]);
        const action = lifecycleMatch[2];
        if (action === 'start') {
          await updateTask(taskId, { status: 'WORKING', control: null, started: null, claimedBy: null, leaseExpiresAt: null, nextRetryAt: null, attempts: 0 });
          res.end(JSON.stringify({ ok: true }));
        } else if (action === 'pause') {
          await updateTask(taskId, { control: 'paused' });
          res.end(JSON.stringify({ ok: true }));
        } else if (action === 'resume') {
          await updateTask(taskId, { control: null, status: 'WORKING', started: null, claimedBy: null });
          res.end(JSON.stringify({ ok: true }));
        } else { // stop — orchestrator kills the agent + halts the task
          await updateTask(taskId, { control: 'stop' });
          res.end(JSON.stringify({ ok: true, stopping: true }));
        }
        return;
      }

      if (triggerMatch) {
        const taskId = triggerMatch[1];
        if (req.method === 'POST') {
          const task = (await getAllTasks()).find(t => t.id === taskId);
          if (task) {
            // QUEUE it — never claim it here. The db-server has no resource gate, no agent
            // pool and no worktrees, so it must not decide that work has started. Stamping
            // `started`/`claimedBy` from here STRANDS the task: dispatchPending only picks up
            // WORKING && !started, and the watchdog only reclaims rows that carry a
            // leaseExpiresAt — so it would be neither dispatched nor reclaimed, forever.
            // Hand it to the orchestrator, which queues it against CPU/RAM, the agent pool,
            // the per-project cap and the readiness gate, then claims it atomically.
            await updateTask(taskId, {
              status: 'WORKING', started: null, claimedBy: null,
              leaseExpiresAt: null, nextRetryAt: null,
            });
            console.log(`[db-server] Task queued for the orchestrator: ${task.title}`);

            // Build a rich agent prompt from the task
            const agentPrompt = [
              `TASK: ${task.title}`,
              task.description ? `\nDESCRIPTION:\n${task.description}` : '',
              `\nTASK_ID: ${task.id}`,
              `\nWhen done, mark as complete:\ncurl -X PUT http://127.0.0.1:6952/tasks/${task.id} -H "Content-Type: application/json" -d '{"status":"DONE","completed":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'"`
            ].filter(Boolean).join('');

            const logPath = join(LOGS_DIR, 'dev.log');
            appendFileSync(logPath, `[${new Date().toISOString()}] Triggered: ${task.title}\n`);

            res.end(JSON.stringify({ ok: true, agentPrompt }));
          } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Task not found' }));
          }
          return;
        }
      }

      // Generic POST /tasks — create new task (must come after triggerMatch)
      if (req.method === 'POST' && req.url?.match(/^\/tasks(\?.*)?$/)) {
        const body = JSON.parse(await readBody(req));
        await createTask({ ...body, projectId: projectIdOf(req, body) });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (idMatch) {
        const taskId = idMatch[1];
        // GET one task by id. Without this, a single-task fetch fell through to the 404 at the
        // bottom (the Postman "Get one task" entry was effectively unimplemented); callers had to
        // pull the whole list. Returns the task row, or 404 when it does not exist.
        if (req.method === 'GET') {
          const t = await getTask(taskId);
          if (!t) { res.statusCode = 404; res.end(JSON.stringify({ error: 'task not found' })); return; }
          res.end(JSON.stringify(t));
          return;
        }
        if (req.method === 'PUT') {
          const body = JSON.parse(await readBody(req));
          // ETC: an agent-supplied {etc: <minutes>} sets a countdown (capped at 30 min,
          // matching the hard runtime kill) and stamps when it was set.
          if (body.etc !== undefined) {
            const mins = Math.max(1, Math.min(30, Math.round(Number(body.etc) || 0)));
            body.etcMinutes = mins;
            body.etcSetAt = new Date().toISOString();
            delete body.etc;
          }

          // An agent reports an OUTCOME — a word describing what happened. It never names a
          // destination. Where an outcome leads is drawn in the workflow, so an agent cannot
          // skip a human gate, and cannot orphan a task by inventing a stage.
          if (body.outcome !== undefined) {
            body.lastOutcome = String(body.outcome);
            delete body.outcome;
          }
          // `{"reject": "why"}` is the bounce verb: return to whoever handed the task over.
          // `reject` is a reserved outcome word, so this can never collide with a routed exit.
          if (body.reject !== undefined) {
            body.lastOutcome = 'reject';
            if (typeof body.reject === 'string' && body.reject.trim()) body.reviewNote = body.reject;
            delete body.reject;
          }

          // `{"consult":{"to","question"}}` — ask another agent for advice mid-task. Stored as a
          // PENDING consult; the orchestrator validates it against the stage's `asks` + the caps,
          // runs a read-only advisor, folds the answer into consultLog, and re-runs this stage.
          // It is NOT an outcome and NOT a reject — the task stays exactly where it is.
          if (body.consult !== undefined) {
            const c = body.consult;
            if (c && typeof c === 'object' && typeof c.to === 'string' && c.to.trim()) {
              body.pendingConsult = {
                to: String(c.to).trim(),
                question: typeof c.question === 'string' ? c.question : '',
              };
            }
            delete body.consult;
          }

          // CONTROL-PLANE ONLY. `handoffFrom` decides where a reject lands and `hops` is the
          // budget that stops it looping — an agent able to write either could choose where its
          // own reject goes, and reset the cap that stops it doing so forever. `consultLog` is the
          // consult audit trail the orchestrator maintains; an agent must not rewrite its history.
          for (const owned of ['handoffFrom', 'hops', 'consultLog']) {
            if (owned in body) {
              console.warn(`[db-server] task ${taskId}: ignoring agent-supplied "${owned}" (control-plane only)`);
              delete body[owned];
            }
          }

          await updateTask(taskId, body);
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.method === 'DELETE') {
          console.log(`[db-server] Deleting task: ${taskId}`);
          await deleteTask(taskId);
          res.end(JSON.stringify({ ok: true }));
          return;
        }
      }
    } catch (e: any) {
      res.statusCode = e?.statusCode || 500;
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
  }

  if (req.url === '/settings') {
    try {
      if (req.method === 'GET') {
        const settings = await getBoardSettings();
        res.end(JSON.stringify(settings || {}));
        return;
      }
      if (req.method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        await updateBoardSettings(body);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
    } catch (e: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
  }
  // -----------------

  if (req.method === 'GET' && req.url === '/db-usage') {
    try {
      const { getDbUsageSummary } = await import('./tasks.js');
      res.end(JSON.stringify({ usage: await getDbUsageSummary() }));
    } catch (e: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // The ONE door to the code index. Searching also records who searched, remembers the files
  // that actually matched in the project's shared context, bumps their use counts, and evicts
  // by least-frequently-used. See db/searchContext.ts. None of that can be skipped, because
  // there is no other way in.
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/search') {
    try {
      const body = JSON.parse(await readBody(req));
      const { searchWithContext } = await import('./searchContext.js');
      const { results, remembered, evicted } = await searchWithContext({
        query: body.query,
        topK: body.topK ?? 10,
        projectId: projectIdOf(req, body),
        agentName: body.agentName ?? null,
        taskId: body.taskId ?? null,
      });
      res.end(JSON.stringify({ results, remembered, evicted }));
    } catch (e: any) {
      res.statusCode = e?.statusCode || 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Cached project brief (the "context brain"). GET returns it; POST /rebuild regenerates.
  if (req.method === 'GET' && (req.url || '').split('?')[0] === '/project-context') {
    const pid = projectIdOf(req);
    try {
      const { getProjectBrief } = await import('./brief.js');
      res.end(JSON.stringify(getProjectBrief(pid) || { brief: null, generatedAt: null, model: null }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/project-context/rebuild') {
    const pid = projectIdOf(req);
    try {
      const { generateProjectBrief } = await import('./brief.js');
      const root = await projectRepoPath(pid);
      // Fire-and-forget: the LLM pass can take ~15–120s; the UI polls GET for the result.
      generateProjectBrief(pid, root).catch(e => console.warn(`[db-server] brief rebuild [${pid}]: ${e?.message || e}`));
      res.end(JSON.stringify({ ok: true, started: true }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // RAG ask — retrieve top code snippets for a project, then have Claude answer the
  // question grounded in them. Returns { answer, sources }.
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/ask') {
    try {
      const body = JSON.parse(await readBody(req));
      const pid = projectIdOf(req, body);
      const q = String(body.query || '').trim();
      if (!q) { res.statusCode = 400; res.end(JSON.stringify({ error: 'query is required' })); return; }
      const topK = Math.min(Math.max(Number(body.topK) || 8, 1), 20);
      const results = await semanticSearch(q, topK, pid);
      const root = await projectRepoPath(pid);
      // Pull a small window of real source around each hit so the answer is grounded in code.
      const snippets = results.map(r => {
        try {
          const abs = join(root, r.path);
          if (!existsSync(abs)) return null;
          const lines = readFileSync(abs, 'utf-8').replace(/\0/g, '').split('\n');
          const from = Math.max(0, (Number(r.line) || 1) - 3);
          const to = Math.min(lines.length, from + 40);
          const code = lines.slice(from, to).join('\n');
          return { path: r.path, line: r.line, name: r.name, type: r.type, code };
        } catch { return null; }
      }).filter(Boolean) as Array<{ path: string; line: number; name: string; type: string; code: string }>;

      if (!snippets.length) {
        res.end(JSON.stringify({ answer: 'No indexed code matched that query. Try rebuilding the index or rephrasing.', sources: results }));
        return;
      }
      const ctx = snippets.map((s, i) => `[[${i + 1}]] ${s.path}:${s.line}  (${s.type} ${s.name})\n${s.code}`).join('\n\n---\n\n');
      const answer = await ragAnswer(q, ctx, root);
      res.end(JSON.stringify({ answer, sources: results }));
    } catch (e: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── CHAT INTAKE ── turn one natural-language message into many tasks.
  // Decomposition runs through `claude -p` (same CLI/auth the agents use — no
  // API key needed). Created tasks land as WORKING so the orchestrator starts them.
  if (req.method === 'POST' && req.url === '/intake') {
    try {
      const body = JSON.parse(await readBody(req));
      const message = String(body.message || '').trim();
      if (!message) { res.statusCode = 400; res.end(JSON.stringify({ error: 'message required' })); return; }

      const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
      const decompPrompt = [
        'You are a task-intake assistant for a software build queue.',
        'Break the USER REQUEST into concrete, independent, buildable tasks (1 per distinct piece of work).',
        'For EACH task provide: title (short imperative), description (1-3 sentences),',
        'scenarios (array of testable GIVEN/WHEN/THEN strings), and dod (a short human-verifiable acceptance checklist as ONE string).',
        'Respond with ONLY minified JSON, no markdown fences, no prose:',
        '{"tasks":[{"title":"...","description":"...","scenarios":["GIVEN ... WHEN ... THEN ..."],"dod":"..."}]}',
        '',
        'USER REQUEST:',
        message,
      ].join('\n');

      const proc = spawnSync(CLAUDE_BIN, ['-p', decompPrompt, '--dangerously-skip-permissions'], {
        encoding: 'utf8', timeout: 150000, maxBuffer: 16 * 1024 * 1024,
      });
      const out = (proc.stdout || '') + (proc.stderr || '');
      const start = out.indexOf('{'); const end = out.lastIndexOf('}');
      let parsed: any = null;
      if (start >= 0 && end > start) { try { parsed = JSON.parse(out.slice(start, end + 1)); } catch { /* fall through */ } }
      const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      if (!tasks.length) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: 'Could not parse tasks from the model', raw: out.slice(0, 600) }));
        return;
      }

      const created: any[] = [];
      const base = Date.now();
      const intakeProject = projectIdOf(req, body);
      const autoStart = body.autoStart !== false; // default: start agents immediately
      for (let i = 0; i < tasks.length; i++) {
        const t: any = tasks[i];
        const id = 'CHAT-' + (base + i).toString(36).toUpperCase().slice(-5) + Math.random().toString(36).slice(2, 4).toUpperCase();
        const scenarios: string[] = Array.isArray(t.scenarios) ? t.scenarios.map(String).filter((s: string) => s.trim()) : [];
        const description = (String(t.description || '') +
          (scenarios.length ? '\n\nAcceptance scenarios:\n- ' + scenarios.join('\n- ') : '')).trim();
        const title = String(t.title || 'Untitled task').slice(0, 200);
        // QUALITY GATE — evaluate the RAW dod (before the fallback fabricates one from the title),
        // so a genuinely missing DoD is caught. An under-specified task is created but NOT handed
        // to agents: it is held in AVAILABLE with a note saying what to add, whatever autoStart says.
        const issues = specIssues(title, scenarios, String(t.dod || '').trim());
        const gated = issues.length > 0;
        const task = {
          id,
          title,
          description,
          status: (autoStart && !gated) ? 'WORKING' : 'AVAILABLE',
          priority: i,
          dod: String(t.dod || scenarios.join(' ') || t.description || t.title || '').slice(0, 2000),
          reviewNote: gated ? `NEEDS REFINEMENT before running — ${issues.join('; ')}. Add these, then trigger the task.` : undefined,
          started: null,
          claimedBy: null,
          attempts: 0,
          projectId: intakeProject,
        };
        await createTask(task as any);
        created.push({ id, title: task.title, status: task.status, needsRefinement: gated, issues });
      }

      const gatedCount = created.filter((c: any) => c.needsRefinement).length;
      console.log(`[db-server] Intake: created ${created.length} task(s) from chat${gatedCount ? ` (${gatedCount} held for refinement)` : ''}`);
      res.end(JSON.stringify({ ok: true, created, gated: gatedCount }));
    } catch (e: any) {
      res.statusCode = e?.statusCode || 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ─── Git / GitHub-token endpoints ───────────────────────────────────────────
  // SECURITY: the GitHub token is stored in PLAINTEXT in the local sqlite
  // board_settings table (id='git_config'). It is NEVER returned raw over HTTP —
  // GET masks it, and clone output has the token stripped before it is returned.

  const maskToken = (t?: string): string => {
    if (!t) return '';
    if (t.length <= 8) return '••••';
    return t.slice(0, 4) + '••••' + t.slice(-4);
  };

  if (req.method === 'GET' && req.url === '/git/config') {
    try {
      const cfg = await getGitConfig();
      res.end(JSON.stringify({
        configured: !!cfg.token,
        username: cfg.username || '',
        host: cfg.host || 'github.com',
        tokenMasked: maskToken(cfg.token),
      }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'PUT' && req.url === '/git/config') {
    try {
      const body = await readBody(req);
      const b = body ? JSON.parse(body) : {};
      // Blank/absent token → coerce to undefined so setGitConfig PRESERVES the stored one.
      const token = (typeof b.token === 'string' && b.token.trim() !== '') ? b.token.trim() : undefined;
      await setGitConfig({ token, username: b.username, host: b.host });
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'DELETE' && req.url === '/git/config') {
    try {
      await setGitConfig({ token: '' }); // '' → explicit clear of the token
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith('/git/status')) {
    try {
      const url = new URL(req.url, 'http://x');
      const repo = url.searchParams.get('repo') || await projectRepoPath(projectIdOf(req));
      const r = spawnSync('git', ['status', '--porcelain=v1', '-b'], { cwd: repo, encoding: 'utf8' });
      if (r.error || r.status !== 0) {
        res.end(JSON.stringify({ ok: false, error: (r.stderr || r.error?.message || 'git error').trim(), repo }));
        return;
      }
      const lines = (r.stdout || '').split('\n').filter(l => l.length > 0);
      let branch = '';
      let ahead = 0;
      let behind = 0;
      const files: Array<{ path: string; x: string; y: string; staged: boolean; label: string }> = [];
      const labelFor = (x: string, y: string): string => {
        if (x === '?' && y === '?') return 'Untracked';
        if (x === 'R' || y === 'R') return 'Renamed';
        if (x === 'C' || y === 'C') return 'Copied';
        if (x === 'A' || y === 'A') return 'Added';
        if (x === 'D' || y === 'D') return 'Deleted';
        if (x === 'U' || y === 'U') return 'Conflicted';
        if (x === 'M' || y === 'M') return 'Modified';
        if (x === 'T' || y === 'T') return 'TypeChanged';
        return 'Modified';
      };
      for (const line of lines) {
        if (line.startsWith('##')) {
          // e.g. "## main...origin/main [ahead 1, behind 2]" or "## main"
          const info = line.slice(3).trim();
          branch = info.split('...')[0].split(' ')[0].trim();
          const am = info.match(/ahead (\d+)/);
          const bm = info.match(/behind (\d+)/);
          if (am) ahead = parseInt(am[1], 10);
          if (bm) behind = parseInt(bm[1], 10);
          continue;
        }
        const x = line[0];
        const y = line[1];
        let path = line.slice(3);
        // Renamed/copied entries look like "old -> new" — take the new path.
        if (path.includes(' -> ')) path = path.split(' -> ')[1];
        const staged = x !== ' ' && x !== '?';
        files.push({ path, x, y, staged, label: labelFor(x, y) });
      }
      res.end(JSON.stringify({ ok: true, repo, branch, ahead, behind, clean: files.length === 0, files }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith('/git/diff')) {
    try {
      const url = new URL(req.url, 'http://x');
      const repo = url.searchParams.get('repo') || await projectRepoPath(projectIdOf(req));
      const file = url.searchParams.get('file') || '';
      const r = spawnSync('git', ['diff', 'HEAD', '--', file], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      let diff = r.stdout || '';
      if (!diff.trim() && file) {
        // Untracked/new file: `git diff HEAD` shows nothing. Try no-index vs /dev/null.
        const r2 = spawnSync('git', ['diff', '--no-index', '--', '/dev/null', file], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        diff = (r2.stdout || '').trim() ? r2.stdout : '(untracked new file)';
      }
      res.end(JSON.stringify({ ok: true, diff }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/git/clone') {
    try {
      const body = await readBody(req);
      const b = body ? JSON.parse(body) : {};
      const url: string = String(b.url || '');
      let dir: string = String(b.dir || '');
      if (!url || !dir) { res.statusCode = 400; res.end(JSON.stringify({ error: 'url and dir are required' })); return; }
      // Resolve a RELATIVE target against the projects base (sibling of the orchestrator repo,
      // or PROJECTS_DIR) — never inside the orchestrator's own repo. Absolute paths are honored.
      if (!isAbsolute(dir)) dir = join(process.env.PROJECTS_DIR || join(process.cwd(), 'projects'), dir);
      const cloneProject = projectIdOf(req, b);
      // 'app:'<recordId> → mint a short-lived GitHub App installation token; else PAT/global.
      let cfg: { token?: string; username?: string; host?: string };
      const tokenId = b.tokenId ? String(b.tokenId) : '';
      if (tokenId.startsWith('app:')) {
        const minted = await mintInstallationToken(tokenId.slice(4));
        if (!minted) { res.statusCode = 400; res.end(JSON.stringify({ error: 'could not mint GitHub App installation token — is the app installed?' })); return; }
        cfg = { token: minted.token, username: minted.username, host: minted.host };
      } else {
        const tok = tokenId ? await getGitTokenRaw(tokenId) : null;
        cfg = tok ? { token: tok.token, username: tok.username, host: tok.host } : await getGitConfig();
      }
      const authUrl = authenticateGitUrl(url, cfg.token, cfg.username);
      // Ensure the parent dir exists so `git clone` into a nested path doesn't fail with
      // "could not create leading directories". git creates the leaf dir itself.
      try { const parent = dirname(dir); if (parent && parent !== '.') mkdirSync(parent, { recursive: true }); } catch { /* clone will surface a clearer error */ }
      const branch: string = String(b.branch || '').trim();
      // Async clone so the event loop stays free — the status widget can show "cloning".
      setActivity(cloneProject, 'cloning', 'Cloning repository', url);
      cloneProgress.set(cloneProject, { lines: [`$ git clone ${branch ? `-b ${branch} ` : ''}${url}`], done: false, ok: null, dir, startedAt: Date.now() });
      const cloneArgs = ['-c', 'credential.helper=', 'clone', '--progress', ...(branch ? ['-b', branch] : []), authUrl, dir];
      const stripTok = (s: string) => cfg.token ? s.split(cfg.token).join('***').split(encodeURIComponent(cfg.token)).join('***') : s;
      const r = await new Promise<{ status: number | null; out: string }>((resolve) => {
        // `-c credential.helper=` disables any (possibly broken) global helper — we auth
        // purely via the token baked into authUrl, so git must never call an external helper.
        const proc = spawn('git', cloneArgs, { shell: false });
        let out = '';
        const onData = (d: any) => { const s = stripTok(d.toString()); out += s; pushCloneOutput(cloneProject, s); };
        proc.stdout?.on('data', onData);
        proc.stderr?.on('data', onData);
        proc.on('exit', code => resolve({ status: code, out }));
        proc.on('error', err => resolve({ status: 1, out: String(err?.message || err) }));
      });
      clearActivity(cloneProject, 'cloning');
      const prog = cloneProgress.get(cloneProject);
      if (prog) { prog.done = true; prog.ok = r.status === 0; prog.lines.push(r.status === 0 ? '✓ Clone complete' : `✗ Clone failed (exit ${r.status})`); }
      let output = r.out;
      // NEVER echo the token back — strip it (and its url-encoded form) from output.
      if (cfg.token) {
        output = output.split(cfg.token).join('***');
        output = output.split(encodeURIComponent(cfg.token)).join('***');
      }
      // Persist the clone as a PROJECT so it's remembered (repo + folder + branch) and shows
      // up in the switcher / Repo / Context — never lost. First clone reuses the Default slot.
      let project: any = null;
      if (r.status === 0) {
        // The clone URL carried the token so git could authenticate; strip it back out of the
        // stored remote so the credential never persists in .git/config. Every fetch/push
        // injects a fresh token per-call (authenticateGitUrl), so a clean origin is all we keep.
        try { if (authUrl !== url) spawnSync('git', ['-C', dir, 'remote', 'set-url', 'origin', url], { encoding: 'utf8' }); } catch { /* non-fatal */ }
        try {
          const name = (dir.replace(/[\\/]+$/, '').split(/[\\/]+/).pop() || 'repo');
          const branchName = branch || (spawnSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout || '').trim() || undefined;
          const allProjs = await listProjects();
          const existing = allProjs.find(p => p.repoPath && resolve(p.repoPath) === resolve(dir));
          const onlyDefault = allProjs.length === 1 && allProjs[0].id === 'default';
          if (existing) { await updateProject(existing.id, { repoPath: dir, branch: branchName, cloneUrl: url }); project = await getProject(existing.id); }
          else if (onlyDefault) { await updateProject('default', { name, repoPath: dir, branch: branchName, cloneUrl: url }); project = await getProject('default'); }
          else { project = await createProject({ name, repoPath: dir, branch: branchName, cloneUrl: url }); }
        } catch (e: any) { console.warn(`[db-server] clone→project persist: ${e?.message}`); }
      }
      res.end(JSON.stringify({ ok: r.status === 0, dir, output: output.trim(), project }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Live clone progress — the Clone tab polls this while a clone runs.
  if (req.method === 'GET' && (req.url || '').split('?')[0] === '/git/clone-progress') {
    const p = cloneProgress.get(projectIdOf(req));
    res.end(JSON.stringify(p ? { lines: p.lines, done: p.done, ok: p.ok, dir: p.dir } : { lines: [], done: true, ok: null }));
    return;
  }

  // Delete a cloned repo folder (with guards). Frees the clone target so it can be re-cloned.
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/git/delete-repo') {
    try {
      const b = JSON.parse(await readBody(req) || '{}');
      const target = String(b.dir || '').trim();
      if (!target) { res.statusCode = 400; res.end(JSON.stringify({ error: 'dir is required' })); return; }
      // Resolve a RELATIVE dir against the SAME base clone uses (projects base = parent of the
      // orchestrator repo, or PROJECTS_DIR) — otherwise delete targets the wrong folder.
      const base = process.env.PROJECTS_DIR || join(process.cwd(), 'projects');
      const abs = isAbsolute(target) ? resolve(target) : resolve(base, target);
      const key = (p: string) => resolve(p).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
      // HARD GUARD on the FOLDER: this app may delete a folder ONLY when it is strictly inside the
      // managed projects/ directory. The app repo, its parent, a drive root, the base itself, and
      // ANY path outside projects/ (a pre-existing repo elsewhere on disk) are NEVER removed from
      // disk. Project DATA (tasks/embeddings/record) is still purged either way.
      const inside = key(abs).startsWith(key(base) + '/') && key(abs) !== key(base);
      let folderDeleted = false;
      if (inside && existsSync(abs)) { rmSync(abs, { recursive: true, force: true }); folderDeleted = true; }
      cloneProgress.delete(projectIdOf(req, b));
      // Completely remove the PROJECT that pointed at this folder — its tasks, embeddings DB, and
      // record — except the un-deletable 'default' (its repo is reset to the host).
      let removedProject: string | null = null;
      try {
        const owner = (await listProjects()).find(p => p.repoPath && key(p.repoPath) === key(abs));
        if (owner) {
          if (owner.id === 'default') await updateProject('default', { name: 'Default', repoPath: process.cwd(), branch: '', cloneUrl: '' });
          else { await purgeProjectData(owner.id); removedProject = owner.id; }
        }
      } catch (e: any) { console.warn(`[db-server] delete-repo project purge: ${e?.message}`); }
      res.end(JSON.stringify({ ok: true, folderDeleted, deleted: folderDeleted ? abs : null, folderKept: !inside, removedProject }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // Clone a git URL into a folder named exactly after the repo, then create (or, for the
  // first import, rename the Default slot to) the project pointing at it. Folder name ==
  // repository name == project label, so nothing can drift.
  if (req.method === 'POST' && req.url === '/git/clone-import') {
    try {
      const b = JSON.parse(await readBody(req) || '{}');
      const url: string = String(b.url || '').trim();
      if (!url) { res.statusCode = 400; res.end(JSON.stringify({ error: 'url is required' })); return; }
      const name = (url.replace(/[\\/]+$/, '').split(/[\\/:]+/).filter(Boolean).pop() || '').replace(/\.git$/i, '');
      if (!name) { res.statusCode = 400; res.end(JSON.stringify({ error: 'could not derive a repo name from the url' })); return; }
      // Clone as a sibling of this repo (override with PROJECTS_DIR) → e.g. C:\code\<name>.
      const base = process.env.PROJECTS_DIR || join(process.cwd(), 'projects');
      const dir = join(base, name);

      let cloned = false, output = '';
      if (existsSync(dir)) {
        // Adopt an existing checkout; refuse a non-git folder to avoid clobbering user data.
        if (!existsSync(join(dir, '.git'))) { res.statusCode = 409; res.end(JSON.stringify({ error: `folder already exists and is not a git repo: ${dir}` })); return; }
        output = `adopted existing repo at ${dir}`;
      } else {
        let cfg: { token?: string; username?: string; host?: string };
        const tokenId = b.tokenId ? String(b.tokenId) : '';
        if (tokenId.startsWith('app:')) {
          const minted = await mintInstallationToken(tokenId.slice(4));
          if (!minted) { res.statusCode = 400; res.end(JSON.stringify({ error: 'could not mint GitHub App installation token' })); return; }
          cfg = { token: minted.token, username: minted.username, host: minted.host };
        } else {
          const tok = tokenId ? await getGitTokenRaw(tokenId) : null;
          cfg = tok ? { token: tok.token, username: tok.username, host: tok.host } : await getGitConfig();
        }
        const authUrl = authenticateGitUrl(url, cfg.token, cfg.username);
        try { mkdirSync(base, { recursive: true }); } catch { /* clone surfaces a clearer error */ }
        const r = await new Promise<{ status: number | null; out: string }>((resolve) => {
          const proc = spawn('git', ['-c', 'credential.helper=', 'clone', authUrl, dir], { shell: false });
          let out = ''; proc.stdout?.on('data', d => out += d); proc.stderr?.on('data', d => out += d);
          proc.on('exit', code => resolve({ status: code, out })); proc.on('error', err => resolve({ status: 1, out: String(err?.message || err) }));
        });
        output = r.out;
        if (cfg.token) { output = output.split(cfg.token).join('***').split(encodeURIComponent(cfg.token)).join('***'); }
        if (r.status !== 0) { res.statusCode = 500; res.end(JSON.stringify({ error: `git clone failed: ${output.trim().slice(-500)}` })); return; }
        // Strip the token back out of the stored remote so it never persists in .git/config.
        try { if (authUrl !== url) spawnSync('git', ['-C', dir, 'remote', 'set-url', 'origin', url], { encoding: 'utf8' }); } catch { /* non-fatal */ }
        cloned = true;
      }

      // First import reuses the seeded Default slot; else a new project.
      const projects = await listProjects();
      const onlyDefault = projects.length === 1 && projects[0].id === 'default';
      let project;
      if (onlyDefault) { await updateProject('default', { name, repoPath: dir, emoji: b.emoji }); project = await getProject('default'); }
      else { project = await createProject({ name, repoPath: dir, emoji: b.emoji }); }
      res.end(JSON.stringify({ ok: true, project, cloned, dir, output: output.trim() }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  if (req.method === 'POST' && req.url === '/git/create-repo') {
    try {
      const body = await readBody(req);
      const b = body ? JSON.parse(body) : {};
      // Repo creation via GitHub App is not wired up yet — require a PAT for this op.
      if (b.tokenId && String(b.tokenId).startsWith('app:')) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'repo creation via GitHub App not supported yet — use a PAT' }));
        return;
      }
      const tokC = b.tokenId ? await getGitTokenRaw(String(b.tokenId)) : null;
      const cfg = tokC ? { token: tokC.token } : await getGitConfig();
      if (!cfg.token) { res.statusCode = 400; res.end(JSON.stringify({ error: 'No GitHub token configured' })); return; }
      const name = String(b.name || '');
      if (!name) { res.statusCode = 400; res.end(JSON.stringify({ error: 'name is required' })); return; }
      const gh = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + cfg.token,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ai-agents',
        },
        body: JSON.stringify({ name, private: !!b.private }),
      });
      const data: any = await gh.json().catch(() => ({}));
      if (!gh.ok) {
        res.end(JSON.stringify({ ok: false, error: data?.message || `GitHub API error ${gh.status}` }));
        return;
      }
      res.end(JSON.stringify({
        ok: true,
        repo: { full_name: data.full_name, clone_url: data.clone_url, html_url: data.html_url },
      }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── git init-repo ── first-run "start in a new folder": create the folder, git-init it,
  // and register it as a project. Local-only counterpart to /git/clone (which needs a URL).
  if (req.method === 'POST' && req.url === '/git/init-repo') {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const name = String(b.name || '').trim();
      const rawDir = String(b.dir || '').trim();
      if (!name) { res.statusCode = 400; res.end(JSON.stringify({ error: 'name is required' })); return; }
      if (!rawDir) { res.statusCode = 400; res.end(JSON.stringify({ error: 'dir is required' })); return; }
      const dir = isAbsolute(rawDir) ? rawDir : resolve(process.cwd(), rawDir);
      mkdirSync(dir, { recursive: true });
      const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, encoding: 'utf-8', timeout: 5000 });
      if (inside.status !== 0) {
        const init = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf-8', timeout: 10000 });
        if (init.status !== 0) { res.statusCode = 500; res.end(JSON.stringify({ error: `git init failed: ${(init.stderr || '').trim()}` })); return; }
      }
      // Worktree isolation needs a HEAD to branch from; give an empty repo one. Best-effort —
      // a repo with commits skips this, and a missing git identity falls back to an inline one.
      const hasHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8', timeout: 5000 }).status === 0;
      if (!hasHead) {
        spawnSync('git', ['-c', 'user.name=Piranha', '-c', 'user.email=piranha@localhost', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, encoding: 'utf-8', timeout: 10000 });
      }
      const project = await createProject({ name, repoPath: dir, emoji: b.emoji ? String(b.emoji) : undefined });
      res.end(JSON.stringify({ ok: true, dir, project }));
    } catch (e: any) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── git commit ── stage + commit in a repo/worktree. Author = repo git config.
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/git/commit') {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const repo = String(b.repo || await projectRepoPath(projectIdOf(req, b)));
      const message = String(b.message || '').trim();
      if (!message) { res.statusCode = 400; res.end(JSON.stringify({ error: 'commit message is required' })); return; }
      if (b.addAll !== false) spawnSync('git', ['add', '-A'], { cwd: repo, encoding: 'utf8' });
      const r = spawnSync('git', ['commit', '-m', message], { cwd: repo, encoding: 'utf8' });
      const output = ((r.stdout || '') + (r.stderr || '')).trim();
      let hash = '';
      if (r.status === 0) { const h = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }); hash = (h.stdout || '').trim(); }
      res.end(JSON.stringify({ ok: r.status === 0, hash, output }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── git push ── push a branch to origin using the stored token for https auth.
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/git/push') {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const repo = String(b.repo || await projectRepoPath(projectIdOf(req, b)));
      // 'app:'<recordId> → mint a GitHub App installation token; else PAT/global config.
      let cfg: { token?: string; username?: string; host?: string };
      const pushTokenId = b.tokenId ? String(b.tokenId) : '';
      if (pushTokenId.startsWith('app:')) {
        const minted = await mintInstallationToken(pushTokenId.slice(4));
        if (!minted) { res.statusCode = 400; res.end(JSON.stringify({ error: 'could not mint GitHub App installation token — is the app installed?' })); return; }
        cfg = { token: minted.token, username: minted.username, host: minted.host };
      } else {
        const tokP = pushTokenId ? await getGitTokenRaw(pushTokenId) : null;
        cfg = tokP ? { token: tokP.token, username: tokP.username, host: tokP.host } : await getGitConfig();
      }
      const cur = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, encoding: 'utf8' });
      const branch = String(b.branch || (cur.stdout || '').trim() || 'HEAD');
      const originR = spawnSync('git', ['remote', 'get-url', String(b.remote || 'origin')], { cwd: repo, encoding: 'utf8' });
      const origin = (originR.stdout || '').trim();
      if (!origin) { res.statusCode = 400; res.end(JSON.stringify({ error: 'no origin remote — set one or clone first' })); return; }
      const authUrl = authenticateGitUrl(origin, cfg.token, cfg.username);
      // Push HEAD to the named branch and set upstream so future pushes are simple.
      const r = spawnSync('git', ['push', '-u', authUrl, `HEAD:${branch}`], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      let output = ((r.stdout || '') + (r.stderr || '')).trim();
      if (cfg.token) { output = output.split(cfg.token).join('***').split(encodeURIComponent(cfg.token)).join('***'); }
      output = redactSecrets(output);
      res.end(JSON.stringify({ ok: r.status === 0, branch, output }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── git pull ── fetch + merge origin into the current branch (token auth for private https).
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/git/pull') {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const repo = String(b.repo || await projectRepoPath(projectIdOf(req, b)));
      let cfg: { token?: string; username?: string; host?: string };
      const tid = b.tokenId ? String(b.tokenId) : '';
      if (tid.startsWith('app:')) { const m = await mintInstallationToken(tid.slice(4)); if (!m) { res.statusCode = 400; res.end(JSON.stringify({ error: 'could not mint GitHub App token' })); return; } cfg = { token: m.token, username: m.username, host: m.host }; }
      else { const t = tid ? await getGitTokenRaw(tid) : null; cfg = t ? { token: t.token, username: t.username, host: t.host } : await getGitConfig(); }
      const cur = (spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout || '').trim();
      const origin = (spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: repo, encoding: 'utf8' }).stdout || '').trim();
      if (!origin) { res.statusCode = 400; res.end(JSON.stringify({ error: 'no origin remote' })); return; }
      let authUrl = origin;
      authUrl = authenticateGitUrl(origin, cfg.token, cfg.username);
      const r = spawnSync('git', ['-c', 'credential.helper=', 'pull', '--no-edit', authUrl, cur], { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      let output = ((r.stdout || '') + (r.stderr || '')).trim();
      if (cfg.token) { output = output.split(cfg.token).join('***').split(encodeURIComponent(cfg.token)).join('***'); }
      output = redactSecrets(output);
      res.end(JSON.stringify({ ok: r.status === 0, branch: cur, output }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── remote branches ── list a REMOTE's branches without cloning (for the Clone picker).
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/git/remote-branches') {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const url = String(b.url || '').trim();
      if (!url) { res.statusCode = 400; res.end(JSON.stringify({ error: 'url is required' })); return; }
      let cfg: { token?: string; username?: string };
      const tid = b.tokenId ? String(b.tokenId) : '';
      if (tid.startsWith('app:')) { const m = await mintInstallationToken(tid.slice(4)); cfg = m ? { token: m.token, username: m.username } : {}; }
      else { const t = tid ? await getGitTokenRaw(tid) : null; cfg = t ? { token: t.token, username: t.username } : await getGitConfig(); }
      let authUrl = url;
      authUrl = authenticateGitUrl(url, cfg.token, cfg.username);
      const r = spawnSync('git', ['-c', 'credential.helper=', 'ls-remote', '--heads', '--symref', authUrl], { encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
      if (r.status !== 0) { let out = ((r.stdout || '') + (r.stderr || '')).trim(); if (cfg.token) out = out.split(cfg.token).join('***'); out = redactSecrets(out); res.statusCode = 400; res.end(JSON.stringify({ error: 'could not list branches', output: out.slice(-400) })); return; }
      const lines = (r.stdout || '').split('\n');
      let def = ''; const branches: string[] = [];
      for (const ln of lines) {
        const sym = ln.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/); if (sym) { def = sym[1]; continue; }
        const m = ln.match(/refs\/heads\/(\S+)$/); if (m) branches.push(m[1]);
      }
      res.end(JSON.stringify({ ok: true, default: def, branches: Array.from(new Set(branches)).sort() }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── git branches ── list local + remote branches and the current one.
  if (req.method === 'GET' && (req.url || '').split('?')[0] === '/git/branches') {
    try {
      const u = new URL(req.url!, 'http://x');
      const repo = u.searchParams.get('repo') || await projectRepoPath(projectIdOf(req));
      const cur = (spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout || '').trim();
      const local = (spawnSync('git', ['branch', '--format=%(refname:short)'], { cwd: repo, encoding: 'utf8' }).stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
      const remote = (spawnSync('git', ['branch', '-r', '--format=%(refname:short)'], { cwd: repo, encoding: 'utf8' }).stdout || '').split('\n').map(s => s.trim()).filter(b => b && !b.includes('HEAD ->')).map(b => b.replace(/^origin\//, ''));
      const all = Array.from(new Set([...local, ...remote])).sort();
      res.end(JSON.stringify({ ok: true, current: cur, branches: all, local }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── git checkout ── switch to an existing branch (creates a local tracking branch if remote-only).
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/git/checkout') {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const repo = String(b.repo || await projectRepoPath(projectIdOf(req, b)));
      const branch = String(b.branch || '').trim();
      if (!branch) { res.statusCode = 400; res.end(JSON.stringify({ error: 'branch is required' })); return; }
      const r = spawnSync('git', ['checkout', branch], { cwd: repo, encoding: 'utf8' });
      const output = ((r.stdout || '') + (r.stderr || '')).trim();
      res.end(JSON.stringify({ ok: r.status === 0, branch, output }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── agent worktrees ── list OUR .worktrees/* and join the task board so the
  // --- Task CHANGES: the diff of a task's branch, for reviewing a non-visual task. ---------
  // A code/library task has nothing to PREVIEW, so review needs the diff + test evidence
  // instead of a running app. This returns exactly that for `task/<id>` against the base branch.
  //   GET /tasks/:id/changes?project=<id>
  //   -> { ok, base, branch, exists, commits:[{sha,subject}], files:[{path,status,additions,deletions}],
  //        diff:"<unified diff>", truncated, qaVerdict, summary }
  {
    const m = req.url?.match(/^\/tasks\/([^/]+)\/changes(?:\?|$)/);
    if (req.method === 'GET' && m) {
      const taskId = decodeURIComponent(m[1]);
      try {
        const project = projectIdOf(req);
        const repoRoot = await projectRepoPath(project);
        const branch = `task/${taskId}`;
        const task = await getTask(taskId);

        // Does the branch exist?
        const has = spawnSync('git', ['rev-parse', '--verify', '--quiet', branch], { cwd: repoRoot, encoding: 'utf8' });
        if (has.status !== 0) {
          res.end(JSON.stringify({ ok: true, exists: false, branch, base: null, files: [], commits: [], diff: '', qaVerdict: task?.qaVerdict ?? null, summary: task?.summary ?? null, plan: task?.plan ?? null, journal: task?.journal ?? [] }));
          return;
        }

        // Base = the branch agents merge INTO (repoRoot's current branch). Diff from the
        // merge-base so we show only what THIS task added, not unrelated base movement.
        const baseRef = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim() || 'HEAD';
        const range = `${baseRef}...${branch}`;

        const commits = (spawnSync('git', ['log', '--pretty=format:%h%x1f%s', `${baseRef}..${branch}`], { cwd: repoRoot, encoding: 'utf8' }).stdout || '')
          .split('\n').filter(Boolean).map(l => { const [sha, subject] = l.split('\x1f'); return { sha, subject }; });

        const files = (spawnSync('git', ['diff', '--numstat', range], { cwd: repoRoot, encoding: 'utf8' }).stdout || '')
          .split('\n').filter(Boolean).map(l => {
            const [add, del, path] = l.split('\t');
            return { path, additions: add === '-' ? null : Number(add), deletions: del === '-' ? null : Number(del) };
          });
        const statusOut = (spawnSync('git', ['diff', '--name-status', range], { cwd: repoRoot, encoding: 'utf8' }).stdout || '')
          .split('\n').filter(Boolean).reduce((acc, l) => { const [st, p] = l.split('\t'); if (p) acc[p] = st; return acc; }, {} as Record<string, string>);
        for (const f of files) (f as any).status = statusOut[f.path] || 'M';

        // meta=1 skips the full unified diff (a git diff over the whole change + up to 8 MB of
        // transfer). Callers that only need the file LIST — e.g. deciding whether a task has
        // anything to preview — pass it so a review queue can check every card cheaply.
        const metaOnly = new URL(req.url!, 'http://x').searchParams.get('meta') === '1';
        if (metaOnly) {
          res.end(JSON.stringify({
            ok: true, exists: true, base: baseRef, branch,
            commits, files, diff: '', truncated: false,
            qaVerdict: task?.qaVerdict ?? null, summary: task?.summary ?? null, plan: task?.plan ?? null, journal: task?.journal ?? [],
          }));
          return;
        }

        // The full unified diff, capped so a giant change can't blow the response or the browser.
        const MAX = 200_000;
        const full = spawnSync('git', ['diff', range], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).stdout || '';
        const truncated = full.length > MAX;
        const diff = truncated ? full.slice(0, MAX) + '\n… (diff truncated — open the branch to see the rest)' : full;

        res.end(JSON.stringify({
          ok: true, exists: true, base: baseRef, branch,
          commits, files, diff, truncated,
          qaVerdict: task?.qaVerdict ?? null, summary: task?.summary ?? null, plan: task?.plan ?? null, journal: task?.journal ?? [],
        }));
      } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  }

  // user sees which agent (claimedBy) did which task, its branch, and whether merged.
  if (req.method === 'GET' && req.url?.startsWith('/git/worktrees')) {
    try {
      const wtProject = projectIdOf(req);
      const repoRoot = await projectRepoPath(wtProject);
      const list = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
      // git prints worktree paths with FORWARD slashes (C:/code/...) even on Windows, while
      // path.join produces BACKslashes (C:\code\...). Comparing them with startsWith silently
      // matched nothing, so the UI showed "no worktrees" while they sat right there on disk.
      // Normalise both to forward slashes before comparing.
      const norm = (p: string) => p.replace(/\\/g, '/');
      const wtDir = norm(join(repoRoot, '.worktrees'));
      const tasks = await getAllTasks(wtProject);
      const byId = new Map(tasks.map((t: any) => [t.id, t]));
      const out: any[] = [];
      for (const block of (list.stdout || '').split('\n\n')) {
        const pm = block.match(/^worktree (.+)$/m);
        const bm = block.match(/^branch (.+)$/m);
        const hm = block.match(/^HEAD (.+)$/m);
        if (!pm) continue;
        const path = pm[1].trim();
        if (!norm(path).startsWith(wtDir)) continue; // only agent worktrees
        const ref = (bm ? bm[1].trim() : '').replace('refs/heads/', '');
        const name = path.split(/[\\/]/).pop() || '';
        const isPlan = name.startsWith('plan-');
        const taskId = name.replace(/^plan-/, '');
        const task: any = byId.get(taskId) || byId.get(name);
        // last commit subject/author/sha on this worktree's HEAD
        const lc = spawnSync('git', ['log', '-1', '--pretty=format:%h%x1f%an%x1f%ad%x1f%s', '--date=iso', 'HEAD'], { cwd: path, encoding: 'utf8' });
        const [sha = '', author = '', date = '', subject = ''] = (lc.stdout || '').split('\x1f');
        // merged into main HEAD?
        let merged = false;
        if (ref) { const anc = spawnSync('git', ['merge-base', '--is-ancestor', ref, 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }); merged = anc.status === 0; }
        out.push({
          path, name, taskId, branch: ref, isPlan,
          head: hm ? hm[1].trim().slice(0, 7) : sha,
          lastCommit: { sha, author, date, subject },
          merged,
          agent: task?.claimedBy || null,
          title: task?.title || null,
          status: task?.status || null,
          stage: task?.stage || null,
        });
      }
      res.end(JSON.stringify({ ok: true, worktrees: out }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── git log ── commit history for a repo/worktree/branch (who committed what).
  if (req.method === 'GET' && req.url?.startsWith('/git/log')) {
    try {
      const url = new URL(req.url, 'http://x');
      const repo = url.searchParams.get('repo') || await projectRepoPath(projectIdOf(req));
      const ref = url.searchParams.get('ref') || '';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 300);
      const args = ['log', `-n${limit}`, '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%P%x1f%s', '--date=iso'];
      if (ref) args.push(ref);
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      if (r.error || r.status !== 0) { res.end(JSON.stringify({ ok: false, error: (r.stderr || r.error?.message || 'git error').trim() })); return; }
      const commits = (r.stdout || '').split('\n').filter(Boolean).map(line => {
        const [hash, shortHash, author, email, date, parents, subject] = line.split('\x1f');
        const parentList = (parents || '').trim().split(/\s+/).filter(Boolean);
        return { hash, shortHash, author, email, date, subject, merge: parentList.length > 1 };
      });
      res.end(JSON.stringify({ ok: true, repo, ref, commits }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── git show ── a single commit's files + diff (drill-down from the log view).
  if (req.method === 'GET' && req.url?.startsWith('/git/show')) {
    try {
      const url = new URL(req.url, 'http://x');
      const repo = url.searchParams.get('repo') || await projectRepoPath(projectIdOf(req));
      const hash = url.searchParams.get('hash') || '';
      if (!hash) { res.statusCode = 400; res.end(JSON.stringify({ error: 'hash is required' })); return; }
      const ns = spawnSync('git', ['show', '--no-color', '--name-status', '--pretty=format:%an%x1f%ae%x1f%ad%x1f%s', '--date=iso', hash], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      const lines = (ns.stdout || '').split('\n');
      const [author = '', email = '', date = '', subject = ''] = (lines[0] || '').split('\x1f');
      const files = lines.slice(1).filter(Boolean).filter(l => /^[A-Z]\d*\t/.test(l)).map(l => {
        const parts = l.split('\t');
        return { status: parts[0][0], path: parts[parts.length - 1] };
      });
      const diffR = spawnSync('git', ['show', '--no-color', hash], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      res.end(JSON.stringify({ ok: true, hash, author, email, date, subject, files, diff: diffR.stdout || '' }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── multi-token management ── list/add/update/delete labeled PATs (tokens masked on read).
  if (req.method === 'GET' && req.url?.startsWith('/git/tokens') && !/^\/git\/tokens\/[^/?]+/.test(req.url)) {
    try {
      const pid = projectIdOf(req);
      const toks: any[] = (await listGitTokensRaw(pid)).map(t => ({
        id: t.id, label: t.label, scope: t.scope, username: t.username || '', host: t.host,
        createdAt: t.createdAt, tokenMasked: maskToken(t.token), source: 'pat',
      }));
      // Append INSTALLED GitHub Apps as pseudo-tokens so the pickers can offer them.
      // Their id is 'app:'+recordId; git ops mint an installation token on demand.
      for (const a of await listGithubAppsRaw(pid)) {
        if (!a.installationId) continue;
        toks.push({
          id: 'app:' + a.id, label: 'GitHub App: ' + (a.name || a.slug || a.id),
          scope: 'readwrite', username: 'x-access-token', host: 'github.com',
          source: 'github-app', tokenMasked: 'auto (installation token)', createdAt: a.createdAt,
        });
      }
      res.end(JSON.stringify({ ok: true, tokens: toks }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (req.method === 'POST' && req.url?.startsWith('/git/tokens') && !/^\/git\/tokens\/[^/?]+/.test(req.url)) {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      if (!b.token || !String(b.token).trim()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'token is required' })); return; }
      const row = await addGitToken({ label: b.label, token: String(b.token).trim(), scope: b.scope, username: b.username, host: b.host }, projectIdOf(req, b));
      res.end(JSON.stringify({ ok: true, id: row.id }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  {
    const m = req.url?.match(/^\/git\/tokens\/([^/?]+)(?:\?.*)?$/);
    if (m && req.method === 'PUT') {
      try {
        const b = JSON.parse((await readBody(req)) || '{}');
        await updateGitToken(decodeURIComponent(m[1]), { label: b.label, token: b.token, scope: b.scope, username: b.username, host: b.host });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
    if (m && req.method === 'DELETE') {
      try { await deleteGitToken(decodeURIComponent(m[1])); res.end(JSON.stringify({ ok: true })); }
      catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  }

  // ── per-agent token assignment ── which PAT each agent authenticates git with.
  if (req.method === 'GET' && req.url?.startsWith('/git/assignments')) {
    try {
      const assignments = await getTokenAssignments(projectIdOf(req));
      let agents: any[] = [];
      try { const { getAgents } = await import('../agentic/index.ts'); agents = (await getAgents()).map((a: any) => ({ role: a.role, label: a.label })); }
      catch { /* agents optional */ }
      res.end(JSON.stringify({ ok: true, assignments, agents }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (req.method === 'PUT' && req.url?.startsWith('/git/assignments')) {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      if (!b.agent) { res.statusCode = 400; res.end(JSON.stringify({ error: 'agent is required' })); return; }
      await setTokenAssignment(String(b.agent), b.tokenId ? String(b.tokenId) : null, projectIdOf(req, b));
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── create branch ── git checkout -b <name> [from] in a repo/worktree.
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/git/branch') {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const repo = String(b.repo || await projectRepoPath(projectIdOf(req, b)));
      const name = String(b.name || '').trim();
      if (!name) { res.statusCode = 400; res.end(JSON.stringify({ error: 'branch name is required' })); return; }
      const args = ['checkout', '-b', name];
      if (b.from && String(b.from).trim()) args.push(String(b.from).trim());
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      const output = ((r.stdout || '') + (r.stderr || '')).trim();
      res.end(JSON.stringify({ ok: r.status === 0, branch: name, output }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ─── GitHub App integration (Coolify-style manifest flow) ───────────────────
  // ADDED ALONGSIDE the PATs above (PATs untouched). The browser POSTs a manifest to
  // GitHub, GitHub auto-generates the App + private key and redirects to our callback,
  // we convert it, the user installs it, and thereafter we auto-mint short-lived
  // installation tokens for clone/push — no hand-crafted PAT.
  // SECURITY: the App's private key / secrets are stored plaintext locally (same model
  // as PATs) and NEVER sent raw over HTTP; minted tokens are stripped from git output.
  const DB_PUBLIC_URL = process.env.DB_PUBLIC_URL || `http://127.0.0.1:${PORT}`;
  const APP_UI_URL = process.env.APP_UI_URL || 'http://localhost:6951';

  // POST /git/github-app/manifest → create a pending record + return the manifest the
  // browser submits to GitHub. `state` (the record id) is echoed back to our callback.
  if (req.method === 'POST' && req.url?.startsWith('/git/github-app/manifest')) {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const pid = projectIdOf(req, b);
      const short = Math.random().toString(36).slice(2, 8);
      const name = (b.name && String(b.name).trim()) || `ai-agents-${short}`;
      const { id } = await createPendingGithubApp(pid, name);
      const org = b.org ? String(b.org).trim() : '';
      const postUrl = org
        ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?state=${encodeURIComponent(id)}`
        : `https://github.com/settings/apps/new?state=${encodeURIComponent(id)}`;
      const default_permissions = b.permissions && typeof b.permissions === 'object'
        ? b.permissions
        : { contents: 'write', administration: 'write', metadata: 'read', pull_requests: 'write', workflows: 'write' };
      // Prefer the host the browser is actually on (sent by the frontend) so the OAuth
      // callback resolves over LAN/remote, not just 127.0.0.1. Fall back to env/defaults.
      const dbBase = (b.dbPublicUrl && /^https?:\/\//.test(b.dbPublicUrl)) ? String(b.dbPublicUrl).replace(/\/$/, '') : DB_PUBLIC_URL;
      const uiUrl = (b.appUiUrl && /^https?:\/\//.test(b.appUiUrl)) ? String(b.appUiUrl).replace(/\/$/, '') : APP_UI_URL;
      const manifest = {
        name,
        url: uiUrl,
        redirect_url: `${dbBase}/git/github-app/callback`,
        // setup_url: where GitHub sends the browser AFTER the user installs the app. It
        // appends ?installation_id=&setup_action=; we encode our record id in the path so
        // the handler can mark the right app installed and bounce back to the UI.
        setup_url: `${dbBase}/git/github-app/setup/${encodeURIComponent(id)}`,
        setup_on_update: true,
        public: false,
        default_permissions,
        default_events: [],
      };
      res.end(JSON.stringify({ ok: true, state: id, postUrl, manifest }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // POST /git/github-app/manual → connect an ALREADY-EXISTING GitHub App by App ID + a
  // freshly-generated private key (.pem). Used when the manifest flow was interrupted, or
  // the user already made an app. We store it like a manifest-created app, then try to
  // auto-detect its installation so it's immediately usable. The user supplies exactly one
  // app — we never enumerate their other apps.
  if (req.method === 'POST' && req.url?.startsWith('/git/github-app/manual')) {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const pid = projectIdOf(req, b);
      const appId = String(b.appId || '').trim();
      const privateKey = String(b.privateKey || '').trim();
      const name = (b.name && String(b.name).trim()) || `github-app-${appId || 'manual'}`;
      const slug = b.slug ? String(b.slug).trim() : undefined;
      if (!/^\d+$/.test(appId)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'App ID must be numeric (find it on the app\'s settings page).' })); return; }
      if (!/BEGIN[\s\S]*PRIVATE KEY[\s\S]*END/.test(privateKey)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Private key must be a full PEM (-----BEGIN ... PRIVATE KEY-----).' })); return; }
      const { id } = await createPendingGithubApp(pid, name);
      await updateGithubApp(id, { appId, privateKey, name, slug, state: 'created' });
      // Best-effort auto-detect: sign a JWT with the key and look up installations.
      let installed = false; let account: string | null = null; let detectError: string | null = null;
      try {
        const installs = await listAppInstallations(appId, privateKey);
        if (installs.length) {
          const inst = installs.sort((a: any, c: any) => new Date(c.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
          account = inst?.account?.login || null;
          await updateGithubApp(id, { installationId: String(inst.id), account, state: 'installed' });
          installed = true;
        }
      } catch (e: any) { detectError = e?.message || 'could not reach GitHub to detect installation'; }
      res.end(JSON.stringify({ ok: true, id, installed, account, detectError }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // GET /git/github-app/callback?code=&state= → GitHub redirects the BROWSER here after
  // "Create GitHub App". We convert the manifest code into the App (id, slug, pem, …),
  // then serve an HTML page that bounces the browser to the install screen.
  if (req.method === 'GET' && req.url?.startsWith('/git/github-app/callback')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const htmlPage = (title: string, bodyHtml: string, redirectTo?: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${redirectTo ? `<meta http-equiv="refresh" content="2;url=${redirectTo}">` : ''}<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:64px auto;padding:0 20px;line-height:1.5;color:#111}a{color:#0969da}.card{border:1px solid #d0d7de;border-radius:12px;padding:24px}</style></head><body><div class="card">${bodyHtml}</div>${redirectTo ? `<script>setTimeout(function(){location.href=${JSON.stringify(redirectTo)}},1500)</script>` : ''}</body></html>`;
    try {
      const u = new URL(req.url, 'http://x');
      const code = u.searchParams.get('code') || '';
      const state = u.searchParams.get('state') || '';
      const rec = state ? await getGithubApp(state) : null;
      if (!code || !rec) {
        res.statusCode = 400;
        res.end(htmlPage('GitHub App error', `<h2>Could not complete setup</h2><p>${!code ? 'Missing code from GitHub.' : 'Unknown or expired setup session.'}</p><p><a href="${APP_UI_URL}">Return to the app</a></p>`));
        return;
      }
      const gh = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
        method: 'POST',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-agents' },
      });
      const data: any = await gh.json().catch(() => ({}));
      if (!gh.ok || !data?.id) {
        res.statusCode = 502;
        res.end(htmlPage('GitHub App error', `<h2>GitHub App conversion failed</h2><p>${(data?.message || `GitHub API error ${gh.status}`)}</p><p><a href="${APP_UI_URL}">Return to the app</a></p>`));
        return;
      }
      await updateGithubApp(rec.id, {
        appId: String(data.id),
        slug: data.slug,
        name: data.name || rec.name,
        privateKey: data.pem,
        clientId: data.client_id,
        clientSecret: data.client_secret,
        webhookSecret: data.webhook_secret,
        htmlUrl: data.html_url,
        state: 'created',
      });
      const installUrl = `https://github.com/apps/${data.slug}/installations/new`;
      res.end(htmlPage('GitHub App created', `<h2>GitHub App created ✓ — opening install…</h2><p>Redirecting you to install <b>${data.slug}</b> on your repositories.</p><p>If it doesn't open, <a href="${installUrl}">click here to install</a>.</p><hr><p>After installing, <a href="${APP_UI_URL}">return to the app</a> and click <b>Detect installation</b>.</p>`, installUrl));
    } catch (e: any) {
      res.statusCode = 500;
      res.end(htmlPage('GitHub App error', `<h2>Setup error</h2><p>${e.message}</p><p><a href="${APP_UI_URL}">Return to the app</a></p>`));
    }
    return;
  }

  // GET /git/github-app/setup/:state?installation_id=&setup_action= → GitHub redirects the
  // BROWSER here right after the user installs the app. We record the installation on the
  // matching record (so it becomes a usable token) and bounce back to the UI — no manual
  // "Detect installation" needed.
  {
    const m = req.url?.match(/^\/git\/github-app\/setup\/([^/?]+)(?:\?.*)?$/);
    if (m && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const bounce = (title: string, msg: string) =>
        `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta http-equiv="refresh" content="1;url=${APP_UI_URL}"><style>body{font-family:system-ui,sans-serif;max-width:640px;margin:64px auto;padding:0 20px;line-height:1.5;color:#111}a{color:#0969da}.card{border:1px solid #d0d7de;border-radius:12px;padding:24px}</style></head><body><div class="card"><h2>${title}</h2><p>${msg}</p><p><a href="${APP_UI_URL}">Return to the app now →</a></p></div><script>setTimeout(function(){location.href=${JSON.stringify(APP_UI_URL)}},1000)</script></body></html>`;
      try {
        const u = new URL(req.url!, 'http://x');
        const state = decodeURIComponent(m[1]);
        const installationId = u.searchParams.get('installation_id') || '';
        const rec = await getGithubApp(state);
        if (!rec?.appId || !rec.privateKey) {
          res.statusCode = 400;
          res.end(bounce('Setup session expired', 'Could not match this install to a pending app. Open the app and click Detect installation.'));
          return;
        }
        // Resolve the account login for the installation (best-effort) via an App JWT.
        let account: string | null = rec.account || null;
        try {
          const installs = await listAppInstallations(rec.appId, rec.privateKey);
          const inst = installationId
            ? installs.find((i: any) => String(i.id) === String(installationId))
            : installs.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
          if (inst) {
            await updateGithubApp(rec.id, { installationId: String(inst.id), account: inst.account?.login || account, state: 'installed' });
            account = inst.account?.login || account;
          } else if (installationId) {
            await updateGithubApp(rec.id, { installationId, state: 'installed' });
          }
        } catch { /* keep going — installation_id from the redirect is enough to mint tokens */
          if (installationId) await updateGithubApp(rec.id, { installationId, state: 'installed' });
        }
        res.end(bounce('Installed ✓', `<b>${rec.name}</b> is connected${account ? ` on ${account}` : ''}. It's now available as a token in Clone/Push.`));
      } catch (e: any) {
        res.statusCode = 500;
        res.end(bounce('Setup error', e.message));
      }
      return;
    }
  }

  // GET /git/github-apps?project=<id> → masked list (never secrets).
  if (req.method === 'GET' && req.url?.startsWith('/git/github-apps') && !/^\/git\/github-apps\/[^/?]+/.test(req.url)) {
    try {
      res.end(JSON.stringify({ ok: true, apps: await listGithubApps(projectIdOf(req)) }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // POST /git/github-apps/:id/detect-installation → find the installation via an App JWT.
  {
    const m = req.url?.match(/^\/git\/github-apps\/([^/?]+)\/detect-installation(?:\?.*)?$/);
    if (m && req.method === 'POST') {
      try {
        const rec = await getGithubApp(decodeURIComponent(m[1]));
        if (!rec?.appId || !rec.privateKey) { res.statusCode = 400; res.end(JSON.stringify({ error: 'app not created yet' })); return; }
        const installs = await listAppInstallations(rec.appId, rec.privateKey);
        if (!installs.length) { res.end(JSON.stringify({ ok: true, installed: false, account: null })); return; }
        // Newest/first installation wins.
        const inst = installs.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
        const account = inst?.account?.login || null;
        await updateGithubApp(rec.id, { installationId: String(inst.id), account, state: 'installed' });
        res.end(JSON.stringify({ ok: true, installed: true, account }));
      } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  }

  // GET /git/github-apps/:id/repos → repos this installation can access, for the clone picker.
  {
    const m = req.url?.match(/^\/git\/github-apps\/([^/?]+)\/repos(?:\?.*)?$/);
    if (m && req.method === 'GET') {
      try {
        const id = decodeURIComponent(m[1]);
        const rec = await getGithubApp(id);
        if (!rec?.installationId) { res.statusCode = 400; res.end(JSON.stringify({ error: 'app not installed yet — click Detect installation first' })); return; }
        const repos = await listInstallationRepos(id);
        res.end(JSON.stringify({ ok: true, repos }));
      } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  }

  // PATCH /git/github-apps/:id → rename (label) an existing app. Only `name` is editable.
  {
    const m = req.url?.match(/^\/git\/github-apps\/([^/?]+)(?:\?.*)?$/);
    if (m && (req.method === 'PATCH' || req.method === 'PUT')) {
      try {
        const b = JSON.parse((await readBody(req)) || '{}');
        const id = decodeURIComponent(m[1]);
        const name = String(b.name ?? '').trim();
        if (!name) { res.statusCode = 400; res.end(JSON.stringify({ error: 'name is required' })); return; }
        if (!await getGithubApp(id)) { res.statusCode = 404; res.end(JSON.stringify({ error: 'app not found' })); return; }
        await updateGithubApp(id, { name });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  }

  // DELETE /git/github-apps/:id
  {
    const m = req.url?.match(/^\/git\/github-apps\/([^/?]+)(?:\?.*)?$/);
    if (m && req.method === 'DELETE') {
      try { await deleteGithubApp(decodeURIComponent(m[1])); res.end(JSON.stringify({ ok: true })); }
      catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  }

  // ── Repo run-config: read / save / detect / run / logs / stop ───────────────────
  // GET /project/run-config?project= → { config, repoPath }
  if (req.method === 'GET' && req.url?.startsWith('/project/run-config')) {
    try {
      const pid = projectIdOf(req);
      const proj = await getProject(pid);
      res.end(JSON.stringify({ ok: true, config: proj?.runConfig || {}, repoPath: proj?.repoPath || await projectRepoPath(pid) }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  // PUT /project/run-config { config } → save (manual edits or accepted detection)
  if (req.method === 'PUT' && req.url?.startsWith('/project/run-config')) {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const pid = projectIdOf(req, b);
      const c = b.config || {};
      const clean: RunConfig = {
        install: String(c.install || '').trim(), run: String(c.run || '').trim(),
        build: String(c.build || '').trim(), test: String(c.test || '').trim(),
        cwd: String(c.cwd || '').trim() || undefined,
      };
      // A manual PUT is a user action → mark the run-config confirmed (readiness gate leg 2).
      // Callers that only cache an auto-detection should pass {confirm:false}.
      const confirm = b.confirm !== false;
      await setProjectRunConfig(pid, clean, confirm);
      res.end(JSON.stringify({ ok: true, config: clean, confirmed: confirm }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // GET /project/readiness?project= → whether the project may dispatch tasks, and why not.
  if (req.method === 'GET' && req.url?.startsWith('/project/readiness')) {
    try {
      const pid = projectIdOf(req);
      const p = await getProject(pid);
      const repo = !!p?.repoPath && existsSync(p.repoPath) && existsSync(join(p.repoPath, '.git'));
      const runConfig = !!p?.runConfigConfirmed;
      const preview = !!p?.previewVerifiedAt;
      const bypass = !!p?.readinessBypass;
      const reasons: string[] = [];
      if (!repo) reasons.push('no cloned git repo');
      if (!runConfig) reasons.push('run-config not confirmed');
      if (!preview) reasons.push('preview not verified');
      res.end(JSON.stringify({ ok: true, ready: bypass || reasons.length === 0, bypass, checks: { repo, runConfig, preview }, previewVerifiedAt: p?.previewVerifiedAt || null, reasons }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // POST /project/readiness/bypass { noExistingProject, notExecutable } → allow dispatch without
  // the full setup, but ONLY when the user confirms BOTH: there is no existing project to clone
  // AND the project is not executable (so a preview cannot apply). Both must be true or it 400s.
  if (req.method === 'POST' && req.url?.startsWith('/project/readiness/bypass')) {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const pid = projectIdOf(req, b);
      if (b.noExistingProject !== true || b.notExecutable !== true) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'bypass requires confirming BOTH: noExistingProject=true AND notExecutable=true' }));
        return;
      }
      await setProjectReadiness(pid, { readinessBypass: true });
      res.end(JSON.stringify({ ok: true, bypass: true }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  // POST /project/detect-run → heuristic + Opus detection against the project's repo
  if (req.method === 'POST' && req.url?.startsWith('/project/detect-run')) {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const pid = projectIdOf(req, b);
      const root = (await getProject(pid))?.repoPath || await projectRepoPath(pid);
      if (!existsSync(root)) { res.statusCode = 400; res.end(JSON.stringify({ error: `repo path not found: ${root} — clone a repo first` })); return; }
      const det = await detectRunConfig(root);
      res.end(JSON.stringify({ ok: true, config: det.config, source: det.source, repoPath: root }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  // POST /project/run { which } → spawn install|run|build|test; returns a runId
  if (req.method === 'POST' && req.url?.startsWith('/project/run') && !req.url.includes('/run/')) {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const pid = projectIdOf(req, b);
      const which = String(b.which || '') as RunKey;
      if (!['install', 'run', 'build', 'test'].includes(which)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'which must be install|run|build|test' })); return; }
      const proj = await getProject(pid);
      const cfg = proj?.runConfig || {};
      const cmd = String((cfg as any)[which] || '').trim();
      if (!cmd) { res.statusCode = 400; res.end(JSON.stringify({ error: `no ${which} command set — detect or enter one first` })); return; }
      const root = proj?.repoPath || await projectRepoPath(pid);
      const cwd = cfg.cwd ? join(root, cfg.cwd) : root;
      if (!existsSync(cwd)) { res.statusCode = 400; res.end(JSON.stringify({ error: `working dir not found: ${cwd}` })); return; }
      const id = 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const rp: RunProc = { id, which, cmd, projectId: pid, cwd, log: '', running: true, exitCode: null, startedAt: new Date().toISOString() };
      const proc = spawn(cmd, { cwd, shell: true, detached: process.platform !== 'win32' });
      rp.pid = proc.pid;
      const append = (s: string) => { rp.log += s; if (rp.log.length > RUN_LOG_CAP) rp.log = rp.log.slice(-RUN_LOG_CAP); };
      append(`$ ${cmd}\n`);
      proc.stdout?.on('data', (d: Buffer) => append(d.toString()));
      proc.stderr?.on('data', (d: Buffer) => append(d.toString()));
      proc.on('error', (err: any) => { append(`\n[spawn error] ${err?.message || err}\n`); rp.running = false; rp.exitCode = -1; });
      proc.on('exit', (code: number | null) => { append(`\n[exited ${code}]\n`); rp.running = false; rp.exitCode = code; });
      runProcs.set(id, rp);
      res.end(JSON.stringify({ ok: true, runId: id, which, cmd }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  // GET /project/run/logs?runId= → current log + running/exit state
  if (req.method === 'GET' && req.url?.startsWith('/project/run/logs')) {
    try {
      const u = new URL(req.url!, 'http://x');
      const rp = runProcs.get(u.searchParams.get('runId') || '');
      if (!rp) { res.statusCode = 404; res.end(JSON.stringify({ error: 'run not found' })); return; }
      res.end(JSON.stringify({ ok: true, which: rp.which, cmd: rp.cmd, running: rp.running, exitCode: rp.exitCode, log: rp.log, startedAt: rp.startedAt }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  // GET /project/runs?project= → active/recent runs for this project (no logs, just summaries)
  if (req.method === 'GET' && req.url?.startsWith('/project/runs')) {
    try {
      const pid = projectIdOf(req);
      const runs = [...runProcs.values()].filter(r => r.projectId === pid)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map(r => ({ runId: r.id, which: r.which, cmd: r.cmd, running: r.running, exitCode: r.exitCode, startedAt: r.startedAt }));
      res.end(JSON.stringify({ ok: true, runs }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  // POST /project/run/stop { runId } → kill the process tree
  if (req.method === 'POST' && req.url?.startsWith('/project/run/stop')) {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const rp = runProcs.get(String(b.runId || ''));
      if (!rp) { res.statusCode = 404; res.end(JSON.stringify({ error: 'run not found' })); return; }
      killRun(rp);
      rp.running = false;
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── code index status / heal / retarget ── per project (?project=<id>) ─────────
  // Live index-build output — the Index tab polls this while a rebuild runs.
  if (req.method === 'GET' && req.url?.startsWith('/code-index/progress')) {
    const pid = projectIdOf(req);
    res.end(JSON.stringify({ building: isRebuilding(pid), lines: indexLogs.get(pid) || [] }));
    return;
  }
  if (req.method === 'GET' && req.url?.startsWith('/code-index/status')) {
    try {
      const pid = projectIdOf(req);
      const ci = await getCodeIndexConfig(pid);
      const root = ci.root || await projectRepoPath(pid);
      let files = 0, nodes = 0, embedded = 0;
      try {
        const d = getDbFor(pid);
        files = (d.prepare('SELECT count(*) AS n FROM files').get() as any).n;
        nodes = (d.prepare('SELECT count(*) AS n FROM nodes').get() as any).n;
        embedded = (d.prepare('SELECT count(*) AS n FROM nodes WHERE embedding IS NOT NULL').get() as any).n;
      } catch { /* corrupt/empty */ }
      res.end(JSON.stringify({
        ok: true,
        root,
        glob: ci.glob || '',
        isDefault: !ci.root,
        files, nodes, embedded,
        coverage: nodes ? Math.round((embedded / nodes) * 100) : 0,
        healthy: indexResponds(pid),
        rebuilding: isRebuilding(pid),
      }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (req.method === 'POST' && req.url?.startsWith('/code-index/rebuild')) {
    try {
      const b = JSON.parse((await readBody(req).catch(() => '')) || '{}');
      rebuildIndex('manual rebuild requested', projectIdOf(req, b));
      res.end(JSON.stringify({ ok: true, rebuilding: true }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (req.method === 'PUT' && req.url?.startsWith('/code-index/root')) {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      const pid = projectIdOf(req, b);
      // root '' resets to the project's repoPath (default). glob optional.
      await setCodeIndexConfig({ root: b.root !== undefined ? String(b.root).trim() : undefined, glob: b.glob !== undefined ? String(b.glob).trim() : undefined }, pid);
      rebuildIndex('code index retargeted', pid);
      res.end(JSON.stringify({ ok: true, rebuilding: true }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── projects CRUD ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.url?.startsWith('/projects') && !/^\/projects\/[^/?]+/.test(req.url)) {
    try {
      const projects = await listProjects();
      res.end(JSON.stringify({ ok: true, projects, activeCount: ACTIVE_AGENTS.size }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (req.method === 'POST' && req.url?.startsWith('/projects') && !/^\/projects\/[^/?]+/.test(req.url)) {
    try {
      const b = JSON.parse((await readBody(req)) || '{}');
      if (!b.name || !String(b.name).trim()) { res.statusCode = 400; res.end(JSON.stringify({ error: 'name is required' })); return; }
      const project = await createProject({ name: String(b.name).trim(), repoPath: b.repoPath ? String(b.repoPath).trim() : undefined, emoji: b.emoji ? String(b.emoji) : undefined, branch: b.branch, cloneUrl: b.cloneUrl });
      res.end(JSON.stringify({ ok: true, project }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  {
    const m = req.url?.match(/^\/projects\/([^/?]+)/);
    if (m && req.method === 'PUT') {
      try {
        const id = decodeURIComponent(m[1]);
        const b = JSON.parse((await readBody(req)) || '{}');
        await updateProject(id, { name: b.name, repoPath: b.repoPath, emoji: b.emoji, branch: b.branch, cloneUrl: b.cloneUrl });
        // Per-project concurrency: null/'' → inherit global default; a number → cap (0 = unlimited).
        if ('maxConcurrency' in b) {
          const v = b.maxConcurrency;
          await setProjectMaxConcurrency(id, (v === null || v === '' || v === undefined) ? null : Number(v));
        }
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
    if (m && req.method === 'DELETE') {
      const id = decodeURIComponent(m[1]);
      if (id === 'default') { res.statusCode = 400; res.end(JSON.stringify({ error: 'cannot delete the default project' })); return; }
      try { await purgeProjectData(id); res.end(JSON.stringify({ ok: true })); }
      catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  }

  // ── orchestrator global pause/start ── flips board_settings.agentStatus. The
  // orchestrator loop reads it: PAUSED keeps it alive (heartbeat + watchdog) but stops
  // dispatching new work; STARTED resumes. (Separate process — this only sets the flag.)
  if (req.method === 'POST' && (req.url === '/orchestrator/pause' || req.url === '/orchestrator/start')) {
    try {
      const s = await getBoardSettings() || {};
      const agentStatus = req.url === '/orchestrator/pause' ? 'PAUSED' : 'STARTED';
      await updateBoardSettings({ ...s, agentStatus });
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── live events feed ── GET /events?project=&limit=&offset= — recent agent_logs rows
  // (newest first) joined with task metadata from the tasks DB for the UI's Events tab.
  // Tasks may have been deleted since their log lines were written; those rows still
  // render, with taskTitle/agent/attempt/logPath null. limit defaults to 100 (hard cap
  // 500); offset pages further back. getRecentLogs has no offset parameter, so we
  // over-fetch offset+limit rows and slice — the cap keeps that bounded.
  if (req.method === 'GET' && (req.url || '').split('?')[0] === '/events') {
    try {
      const u = new URL(req.url!, 'http://x');
      const limit = Math.min(500, Math.max(1, parseInt(u.searchParams.get('limit') || '', 10) || 100));
      const offset = Math.max(0, parseInt(u.searchParams.get('offset') || '', 10) || 0);
      const pid = projectIdOf(req);
      const rows = (await getRecentLogs(offset + limit, pid)).slice(offset, offset + limit);
      // One tasks read for the whole page, not one per row. Rows whose task is gone
      // simply miss from the map (logs.db outlives task deletion by design).
      const tasksById = new Map<string, Task>();
      try { for (const t of await getAllTasks(pid)) tasksById.set(t.id, t); } catch { /* tasks db optional */ }
      const events = rows.map(r => {
        const t = tasksById.get(r.taskId);
        // claimedBy is '<workerId>:<agentName>' — the readable name is the last segment.
        const agent = t?.claimedBy ? (String(t.claimedBy).split(':').pop() || null) : null;
        return {
          id: r.id,
          taskId: r.taskId,
          taskTitle: t?.title ?? null,
          agent,
          message: r.msg,
          type: r.type,
          ts: r.ts,
          attempt: t?.attempts ?? null,
          logPath: t?.logPath ?? null,
        };
      });
      res.end(JSON.stringify({ ok: true, events }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── system status ── one poll for the UI's live activity widget (per project). ──
  // Delete one event from the status-widget feed (a logs.db row). id in the path.
  {
    const m = (req.url || '').split('?')[0].match(/^\/system-status\/events\/(\d+)$/);
    if (req.method === 'DELETE' && m) {
      try {
        const { deleteAgentLog } = await import('../agentic/db/logs.js');
        const removed = await deleteAgentLog(Number(m[1]));
        res.end(JSON.stringify({ ok: true, removed }));
      } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
      return;
    }
  }
  // Clear the event feed for the project the board is showing (plus the engine-wide
  // '__system__' lines it displays). Other projects' history is not touched.
  if (req.method === 'DELETE' && (req.url || '').split('?')[0] === '/system-status/events') {
    try {
      const { clearAgentLogs } = await import('../agentic/db/logs.js');
      const removed = await clearAgentLogs(projectIdOf(req));
      res.end(JSON.stringify({ ok: true, removed }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith('/system-status')) {
    try {
      const pid = projectIdOf(req);
      let hb: any = null;
      try { hb = await getHeartbeat(); } catch { /* optional */ }
      const ci = await getCodeIndexConfig(pid);
      const root = ci.root || await projectRepoPath(pid);
      // Highest-priority current activity: explicit op → index rebuild → agents → idle.
      let activity: Activity | undefined = systemActivity.get(pid);
      if (!activity && isRebuilding(pid)) activity = { kind: 'indexing', label: 'Reading & remembering repo', detail: root, since: Date.now() };
      if (!activity && ACTIVE_AGENTS.size > 0) activity = { kind: 'agents', label: `${ACTIVE_AGENTS.size} agent(s) working`, detail: [...ACTIVE_AGENTS].join(', '), since: Date.now() };

      // Orchestrator liveness + always-on human-readable status line (from the heartbeat).
      let settings: any = {};
      try { settings = await getBoardSettings() || {}; } catch { /* optional */ }
      const lastBeatAt = hb?.lastBeatAt || null;
      const ageSec = lastBeatAt ? Math.round((Date.now() - new Date(lastBeatAt).getTime()) / 1000) : null;
      const orchestrator = {
        agentStatus: settings.agentStatus || null,
        statusLine: hb?.statusLine || null,
        lastBeatAt,
        ageSec,
        up: ageSec != null && ageSec < 30,
      };

      // Per-project task counts for the board summary.
      let counts = { pending: 0, working: 0, testing: 0, done: 0 };
      try {
        const tasks = await getAllTasks(pid);
        counts = {
          pending: tasks.filter((t: any) => t.status === 'WORKING' && !t.started).length,
          working: tasks.filter((t: any) => t.status === 'WORKING' && t.started).length,
          testing: tasks.filter((t: any) => t.status === 'TESTING').length,
          done: tasks.filter((t: any) => t.status === 'DONE').length,
        };
      } catch { /* optional */ }

      // Most recent log rows (newest-first) for the live event feed, scoped to the project the
      // board is showing. Unscoped, one project's failures scrolled through another's feed.
      // Engine-wide '__system__' lines are still included by getRecentLogs.
      let events: Array<{ id: number; ts: string; taskId: string; msg: string; type: string; projectId: string | null }> = [];
      try { events = await getRecentLogs(15, pid); } catch { /* logs.db optional */ }

      res.end(JSON.stringify({
        ok: true,
        activity: activity || { kind: 'idle', label: 'Idle', since: Date.now() },
        indexRebuilding: isRebuilding(pid),
        boardCorrupt,
        activeAgents: [...ACTIVE_AGENTS],
        circuit: hb?.circuit || null,
        mode: hb?.mode || null,
        indexRoot: root,
        orchestrator,
        counts,
        events,
      }));
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── Datastore backend ────────────────────────────────────────────────────────
  // Selects/records the datastore backend and (for Postgres) its ENCRYPTED URL.
  // The adapter IS built: at boot, configureBackend() points the async Store layer
  // (agentic/db/getStore.ts) at SqliteStore or PgStore and runs that backend's
  // migrations. Saving here only RECORDS the choice — the swap needs a restart,
  // because the Store is opened once at boot. Passwords are never returned.
  //
  //   GET  /backend        → { kind, target }  (masked; no password)
  //   POST /backend/test   { url } → { ok } | { ok:false, error }  (does NOT persist)
  //   PUT  /backend        { kind, url? } → masked  (encrypts + persists)
  if (req.url === '/backend' && req.method === 'GET') {
    try { res.end(JSON.stringify(getMaskedBackendConfig())); }
    catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (req.url === '/backend/test' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const url = String(body.url || '').trim();
      if (!url) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'url is required' })); return; }
      if (!/^postgres(ql)?:\/\//i.test(url)) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'url must be a postgres:// connection string' })); return; }
      const result = await testPostgres(url);
      res.end(JSON.stringify(result)); // 200 even on ok:false — the probe ran; the DB just refused/timed out
    } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: e.message })); }
    return;
  }
  if (req.url === '/backend' && req.method === 'PUT') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const masked = setBackendConfig({ kind: body.kind, url: body.url });
      // Takes effect on the next db-server boot, where configureBackend() reads this file
      // and opens the matching Store. Not hot-swappable: in-flight requests hold the old one.
      //
      // TODO(pg-db-browser): the Database tab (/db/table*) is still SQLite-only — it needs
      // `information_schema` for columns and a real primary key in place of `rowid`. Until
      // then those routes 501 under Postgres. Everything else already runs on both.
      res.end(JSON.stringify(masked));
    } catch (e: any) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

/**
 * Open a short-lived Postgres connection, run `SELECT 1`, and report reachability.
 * Never persists and never throws — connection/timeout failures return { ok:false }.
 * `pg` is imported lazily so the db-server still boots if the dep is absent.
 */
async function testPostgres(url: string): Promise<{ ok: boolean; error?: string }> {
  const TIMEOUT_MS = 5000;
  let Client: any;
  try {
    ({ Client } = await import('pg'));
  } catch {
    return { ok: false, error: 'pg module not installed on the server (run pnpm install)' };
  }
  const client = new Client({ connectionString: url, connectionTimeoutMillis: TIMEOUT_MS, statement_timeout: TIMEOUT_MS });
  const guard = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('connection timed out (5s)')), TIMEOUT_MS));
  try {
    await Promise.race([client.connect(), guard]);
    await Promise.race([client.query('SELECT 1'), guard]);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    try { await client.end(); } catch { /* already closed / never connected */ }
  }
}

// Bind to loopback by default — this server has no auth and holds credentials, so it must
// not be reachable from the network unless the operator opts in. Set HOST=0.0.0.0 (and a
// CORS_ALLOW_ORIGIN) only on a trusted LAN/VPS you control.
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`[db-server] Listening on http://${HOST}:${PORT}`);
  if (HOST === '0.0.0.0') console.warn('[db-server] ⚠ bound to 0.0.0.0 — reachable on the network with NO auth. Ensure this host is firewalled/trusted.');
});
