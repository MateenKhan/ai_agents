// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — tasks.db (durable, committable)
// The task queue + board state. Scenarios (GWT) replace free-text DoD; `stage`
// routes the pipeline; `qaVerdict` gates merge; `docs` holds MinIO keys.
// Verbose run logs live in logs.db, not here, so this stays lean enough to commit.
// ─────────────────────────────────────────────────────────────────────────────

import type { DatabaseSync } from 'node:sqlite';
import type { Task, Scenario } from '../types';
import { getConfig } from '../runtime-context';
import { openDb, tryEach } from './connection';
// Secrets-at-rest: AES-256-GCM. encrypt() is a no-op on already-encrypted values;
// decrypt() passes legacy plaintext straight through (enables lazy migration).
import { encrypt, decrypt, isEncrypted } from './secretbox';

let schemaReady = false;

function db(): DatabaseSync {
  const conn = openDb(getConfig().paths.tasksDbPath);
  if (!schemaReady) {
    initSchema(conn); migrate(conn); schemaReady = true;
    // Migrate any legacy plaintext secrets to ciphertext on first boot (best-effort).
    // Pass `conn` (not db()) to avoid re-entering this init block. Never blocks boot.
    try { reencryptSecretsAtRest(conn); } catch { /* never block boot on migration */ }
  }
  return conn;
}

export function initSchema(conn: DatabaseSync): void {
  conn.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    claimedBy TEXT,
    started TEXT,
    completed TEXT,
    dependsOn TEXT,
    files TEXT,
    parentId TEXT,
    scenarios TEXT,
    stage TEXT,
    qaVerdict TEXT,
    docs TEXT,
    reviewNote TEXT,
    leaseExpiresAt TEXT,
    attempts INTEGER DEFAULT 0,
    nextRetryAt TEXT,
    lastError TEXT,
    model TEXT,
    summary TEXT,
    etcMinutes INTEGER,
    etcSetAt TEXT,
    stageTimings TEXT
  )`);
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
  // NOTE: idx on `stage` is created in migrate(), AFTER the column is guaranteed to exist
  // (on a pre-existing tasks.db the column is added by migration, not by this CREATE TABLE).
  conn.exec(`CREATE TABLE IF NOT EXISTS board_settings (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  // Multiple labeled GitHub PATs. scope: 'readonly' (clone/fetch) | 'readwrite' (push).
  // SECURITY: `token` is AES-256-GCM ENCRYPTED at rest (see ./secretbox); decrypted only
  // in the raw readers for git ops, and never returned raw over HTTP (masked).
  conn.exec(`CREATE TABLE IF NOT EXISTS git_tokens (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    token TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'readonly',
    username TEXT,
    host TEXT NOT NULL DEFAULT 'github.com',
    createdAt TEXT NOT NULL
  )`);
  // Which token each agent uses. agent = agent role/name; the special row agent='*'
  // is the default applied to every agent that has no explicit assignment.
  conn.exec(`CREATE TABLE IF NOT EXISTS git_token_assignments (
    agent TEXT PRIMARY KEY,
    tokenId TEXT NOT NULL
  )`);
  // GitHub App integration (Coolify-style manifest flow) — ADDED ALONGSIDE the PATs
  // above; PATs remain fully supported. A record moves through three states:
  //   'pending'   — manifest generated, awaiting GitHub's create+redirect
  //   'created'   — manifest converted → we hold appId + private key (pem)
  //   'installed' — user installed the app → we hold the installationId
  // SECURITY: privateKey / clientSecret / webhookSecret are AES-256-GCM ENCRYPTED at rest
  // (see ./secretbox); decrypted only in the raw readers used for JWT signing / token
  // minting. They are NEVER returned raw over HTTP — the masked list (listGithubApps)
  // omits them entirely, and minted installation tokens are stripped from echoed git output.
  conn.exec(`CREATE TABLE IF NOT EXISTS github_apps (
    id TEXT PRIMARY KEY, projectId TEXT NOT NULL, appId TEXT, slug TEXT, name TEXT,
    privateKey TEXT, clientId TEXT, clientSecret TEXT, webhookSecret TEXT, htmlUrl TEXT,
    installationId TEXT, account TEXT, state TEXT, createdAt TEXT NOT NULL
  )`);
  // Projects — everything (tasks, tokens, assignments, code index) is scoped to one.
  // A 'default' project always exists (seeded in migrate) so single-project installs
  // keep working with zero configuration.
  conn.exec(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repoPath TEXT,
    emoji TEXT,
    createdAt TEXT NOT NULL
  )`);
}

/** Additive migrations for repos whose tasks.db predates the scenario/stage model.
 *  Old `dod` text is preserved and converted into a single THEN-scenario once. */
export function migrate(conn: DatabaseSync): void {
  tryEach([
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN scenarios TEXT`),
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN stage TEXT`),
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN qaVerdict TEXT`),
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN docs TEXT`),
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN model TEXT`),
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN summary TEXT`),
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN etcMinutes INTEGER`),
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN etcSetAt TEXT`),
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN stageTimings TEXT`),
    // Index on stage — only valid once the column above exists.
    () => conn.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage)`),
    // ── PROJECT SCOPING (additive) ── nullable projectId; NULL is treated as 'default'.
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN projectId TEXT`),
    // ── LIFECYCLE CONTROL (additive) ── null = run; 'paused' = hold; 'stop' = kill-now.
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN control TEXT`),
    // ── MERGE CONFLICT BOUNCES (additive) ── count of merge→build kickbacks (rebase asks).
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN mergeBounces INTEGER`),
    // ── ARCHITECT RESCUE PASSES (additive) ── count of dev/qa→architect re-plan escalations.
    () => conn.exec(`ALTER TABLE tasks ADD COLUMN rescueCount INTEGER`),
    () => conn.exec(`ALTER TABLE git_tokens ADD COLUMN projectId TEXT`),
    () => conn.exec(`ALTER TABLE git_token_assignments ADD COLUMN projectId TEXT`),
    () => conn.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(projectId)`),
    // ── RUN CONFIG (additive) ── JSON { install, run, build, test, cwd } per project.
    () => conn.exec(`ALTER TABLE projects ADD COLUMN runConfig TEXT`),
    // ── CLONE PROVENANCE (additive) ── remember where a project's repo came from so a
    // cloned repo + its checked-out branch is persisted and never lost.
    () => conn.exec(`ALTER TABLE projects ADD COLUMN branch TEXT`),
    () => conn.exec(`ALTER TABLE projects ADD COLUMN cloneUrl TEXT`),
    // ── PER-PROJECT CONCURRENCY (additive) ── max simultaneous agents for this project.
    // NULL = inherit the global default (board_settings 'agent_defaults'); 0 = unlimited.
    () => conn.exec(`ALTER TABLE projects ADD COLUMN maxConcurrency INTEGER`),
    // ── PROJECT READINESS (additive) ── a project may only dispatch tasks once it's set up:
    // a cloned git repo, a user-confirmed run-config, and a verified (green) preview. The gate
    // is bypassable ONLY when the user confirms BOTH: there is no existing project to clone AND
    // the project is not executable (so a preview can't apply). See orchestrator dispatch gate.
    () => conn.exec(`ALTER TABLE projects ADD COLUMN runConfigConfirmed INTEGER`),
    () => conn.exec(`ALTER TABLE projects ADD COLUMN previewVerifiedAt TEXT`),
    () => conn.exec(`ALTER TABLE projects ADD COLUMN readinessBypass INTEGER`),
    // Seed the always-present 'default' project (repoPath = the host repo).
    () => conn.prepare(
      `INSERT OR IGNORE INTO projects (id,name,repoPath,emoji,createdAt) VALUES ('default','Default',?,'📦',?)`
    ).run(process.cwd(), new Date().toISOString()),
    // Convert legacy dod → one THEN scenario, only where scenarios is empty.
    () => {
      const hasDod = (conn.prepare(`PRAGMA table_info(tasks)`).all() as any[]).some(c => c.name === 'dod');
      if (!hasDod) return;
      const rows = conn.prepare(
        `SELECT id, dod FROM tasks WHERE dod IS NOT NULL AND TRIM(dod) <> '' AND (scenarios IS NULL OR scenarios = '')`
      ).all() as any[];
      const upd = conn.prepare(`UPDATE tasks SET scenarios = ? WHERE id = ?`);
      for (const r of rows) {
        upd.run(JSON.stringify([{ then: String(r.dod) } as Scenario]), r.id);
      }
    },
  ]);
}

/** Raw tasks.db connection (for DB-browser endpoints and ad-hoc queries). */
export function getTasksDb(): DatabaseSync { return db(); }

/**
 * Lazy at-rest migration: scan git_tokens + github_apps and re-write any secret that is
 * still stored in legacy PLAINTEXT as AES-256-GCM ciphertext. Idempotent (isEncrypted()
 * skips already-encrypted values) and BEST-EFFORT — every step is wrapped so a failure
 * never throws and never blocks boot. NEVER logs secret values, only counts.
 * Called once from the schema-init path; `conn` is passed there to avoid re-entering it.
 */
export function reencryptSecretsAtRest(conn: DatabaseSync = db()): void {
  let migrated = 0, failed = 0;
  const enc = (v: any): any => (typeof v === 'string' && v && !isEncrypted(v)) ? encrypt(v) : v;
  try {
    // git_tokens.token
    const toks = conn.prepare(`SELECT id, token FROM git_tokens`).all() as any[];
    const updTok = conn.prepare(`UPDATE git_tokens SET token = ? WHERE id = ?`);
    for (const t of toks) {
      try {
        if (typeof t.token === 'string' && t.token && !isEncrypted(t.token)) {
          updTok.run(encrypt(t.token), t.id); migrated++;
        }
      } catch { failed++; }
    }
    // github_apps: privateKey / clientSecret / webhookSecret
    const apps = conn.prepare(`SELECT id, privateKey, clientSecret, webhookSecret FROM github_apps`).all() as any[];
    const updApp = conn.prepare(`UPDATE github_apps SET privateKey = ?, clientSecret = ?, webhookSecret = ? WHERE id = ?`);
    for (const a of apps) {
      try {
        const pk = enc(a.privateKey), cs = enc(a.clientSecret), ws = enc(a.webhookSecret);
        if (pk !== a.privateKey || cs !== a.clientSecret || ws !== a.webhookSecret) {
          updApp.run(pk ?? null, cs ?? null, ws ?? null, a.id); migrated++;
        }
      } catch { failed++; }
    }
    if (migrated || failed) {
      console.log(`[secretbox] at-rest migration: encrypted ${migrated} legacy plaintext secret row(s), ${failed} failed`);
    }
  } catch { /* never throw from migration */ }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function parseArr(v: any): string[] { try { return v ? JSON.parse(v) : []; } catch { return []; } }

export function safeParseScenarios(v: any): Scenario[] {
  try {
    const arr = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(arr) ? arr.filter(s => s && typeof s.then === 'string') : [];
  } catch { return []; }
}

/** Render scenarios as Gherkin text for an agent prompt. */
export function scenariosToGherkin(scenarios?: Scenario[]): string {
  if (!scenarios?.length) return '';
  return scenarios.map((s, i) => {
    const lines = [`Scenario ${i + 1}:`];
    if (s.given) lines.push(`  GIVEN ${s.given}`);
    if (s.when) lines.push(`  WHEN ${s.when}`);
    lines.push(`  THEN ${s.then}`);
    return lines.join('\n');
  }).join('\n\n');
}

function parseObj(v: any): Record<string, number> { try { return v ? JSON.parse(v) : {}; } catch { return {}; } }

function rowToTask(r: any): Task {
  return {
    ...r,
    dependsOn: parseArr(r.dependsOn),
    files: parseArr(r.files),
    docs: parseArr(r.docs),
    scenarios: safeParseScenarios(r.scenarios),
    stageTimings: parseObj(r.stageTimings),
  };
}

const COLS = 'id,title,description,status,priority,claimedBy,started,completed,dependsOn,files,parentId,scenarios,stage,qaVerdict,docs,reviewNote,leaseExpiresAt,attempts,nextRetryAt,lastError,model,summary,etcMinutes,etcSetAt,stageTimings,projectId,control,mergeBounces,rescueCount';

function toRow(t: Partial<Task>): any[] {
  return [
    t.id, t.title, t.description ?? null, t.status, t.priority ?? 0,
    t.claimedBy ?? null, t.started ?? null, t.completed ?? null,
    JSON.stringify(t.dependsOn ?? []), JSON.stringify(t.files ?? []), t.parentId ?? null,
    JSON.stringify(t.scenarios ?? []), t.stage ?? null, t.qaVerdict ?? null,
    JSON.stringify(t.docs ?? []), t.reviewNote ?? null, t.leaseExpiresAt ?? null,
    t.attempts ?? 0, t.nextRetryAt ?? null, t.lastError ?? null, t.model ?? null, t.summary ?? null,
    t.etcMinutes ?? null, t.etcSetAt ?? null, JSON.stringify(t.stageTimings ?? {}),
    t.projectId ?? 'default', t.control ?? null, t.mergeBounces ?? 0, t.rescueCount ?? 0,
  ];
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/** All tasks for a project (NULL projectId rows are treated as belonging to 'default'). */
export function getAllTasks(projectId: string = 'default'): Task[] {
  return (db().prepare(
    `SELECT * FROM tasks WHERE (projectId = ? OR (projectId IS NULL AND ? = 'default'))`
  ).all(projectId, projectId) as any[]).map(rowToTask);
}

export function getTask(id: string): Task | null {
  const r = db().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as any;
  return r ? rowToTask(r) : null;
}

export function createTask(task: Partial<Task> & { id: string; title: string; status: string }): void {
  const ph = COLS.split(',').map(() => '?').join(',');
  db().prepare(`INSERT INTO tasks (${COLS}) VALUES (${ph})`).run(...toRow(task));
}

export function updateTask(id: string, updates: Partial<Task>): void {
  const conn = db();
  const current = conn.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as any;
  if (!current) throw new Error(`Task not found: ${id}`);
  const merged = { ...rowToTask(current), ...updates, id };
  const assignments = COLS.split(',').filter(c => c !== 'id').map(c => `${c}=?`).join(',');
  const row = toRow(merged);
  row.shift(); // drop id from the front (it goes to the WHERE clause)
  conn.prepare(`UPDATE tasks SET ${assignments} WHERE id = ?`).run(...row, id);
}

export function deleteTask(id: string): void {
  db().prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
}

export function bulkUpdatePriorities(updates: Array<{ id: string; priority: number; status: string }>): void {
  const conn = db();
  const stmt = conn.prepare(`UPDATE tasks SET priority=?, status=? WHERE id=?`);
  conn.exec('BEGIN TRANSACTION');
  try {
    for (const u of updates) stmt.run(u.priority, u.status, u.id);
    conn.exec('COMMIT');
  } catch (e) { conn.exec('ROLLBACK'); throw e; }
}

// ── board settings + heartbeat (orchestrator liveness) ─────────────────────────

export function getBoardSettings(): any {
  const r = db().prepare(`SELECT data FROM board_settings WHERE id = ?`).get('default') as any;
  return r ? JSON.parse(r.data) : null;
}

export function updateBoardSettings(settings: any): void {
  db().prepare(`INSERT OR REPLACE INTO board_settings (id, data) VALUES ('default', ?)`).run(JSON.stringify(settings));
}

// ── git config (GitHub token storage in board_settings id='git_config') ────────
// SECURITY: the token is stored in PLAINTEXT in the local sqlite board_settings
// table. It is never returned raw over HTTP (server masks it on read).

export interface GitConfig { token?: string; username?: string; host?: string }

export function getGitConfig(): GitConfig {
  const r = db().prepare(`SELECT data FROM board_settings WHERE id = ?`).get('git_config') as any;
  try { return r ? JSON.parse(r.data) : {}; } catch { return {}; }
}

export function setGitConfig(cfg: GitConfig): void {
  const prev = getGitConfig();
  // Token merge rules:
  //   - undefined/null incoming → PRESERVE the existing stored token (never wipe).
  //   - ''                       → explicit clear (DELETE endpoint uses this).
  //   - non-empty                → set the new token.
  let token: string | undefined;
  if (cfg.token === undefined || cfg.token === null) token = prev.token;
  else if (cfg.token === '') token = undefined;
  else token = cfg.token;
  // username/host: overwrite only when a non-empty value is supplied, else keep prior.
  const username = (cfg.username === undefined || cfg.username === null || cfg.username === '')
    ? prev.username : cfg.username;
  const host = (cfg.host === undefined || cfg.host === null || cfg.host === '')
    ? prev.host : cfg.host;
  const merged: GitConfig = {};
  if (token) merged.token = token;
  if (username) merged.username = username;
  if (host) merged.host = host;
  db().prepare(`INSERT OR REPLACE INTO board_settings (id, data) VALUES ('git_config', ?)`).run(JSON.stringify(merged));
}

// ── Multiple labeled PAT tokens + per-agent assignment ────────────────────────
export type GitScope = 'readonly' | 'readwrite';
export interface GitToken { id: string; label: string; token: string; scope: GitScope; username?: string; host: string; createdAt: string }

/** Full rows INCLUDING the raw token — internal use only (git ops, agent auth). Never send over HTTP.
 *  Scoped to a project; NULL-projectId rows belong to 'default'. */
export function listGitTokensRaw(projectId: string = 'default'): GitToken[] {
  // Decrypt `token` so callers (git ops, HTTP masking) receive the real PAT.
  return (db().prepare(
    `SELECT * FROM git_tokens WHERE (projectId = ? OR (projectId IS NULL AND ? = 'default')) ORDER BY createdAt ASC`
  ).all(projectId, projectId) as GitToken[]).map(t => ({ ...t, token: decrypt(t.token) }));
}
export function getGitTokenRaw(id: string): GitToken | null {
  const r = db().prepare(`SELECT * FROM git_tokens WHERE id = ?`).get(id) as GitToken | undefined;
  if (!r) return null;
  return { ...r, token: decrypt(r.token) }; // decrypt so callers get the real token
}
export function addGitToken(t: { label: string; token: string; scope?: GitScope; username?: string; host?: string }, projectId: string = 'default'): GitToken {
  // Token labels must be unique within a project (a user may hold several PATs / GitHub
  // apps with different scopes) — auto-suffix a duplicate rather than reject it.
  const existing = new Set(listGitTokensRaw(projectId).map(x => x.label));
  const base = (t.label || 'token').trim() || 'token';
  let label = base;
  for (let n = 2; existing.has(label); n++) label = `${base} (${n})`;
  const row: GitToken = {
    id: 'tok_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    label,
    token: t.token,
    scope: t.scope === 'readwrite' ? 'readwrite' : 'readonly',
    username: t.username || '',
    host: t.host || 'github.com',
    createdAt: new Date().toISOString(),
  };
  // Encrypt the token at rest; `row` returned to the caller keeps the plaintext token.
  db().prepare(`INSERT INTO git_tokens (id,label,token,scope,username,host,createdAt,projectId) VALUES (?,?,?,?,?,?,?,?)`)
    .run(row.id, row.label, encrypt(row.token), row.scope, row.username, row.host, row.createdAt, projectId);
  return row;
}
export function updateGitToken(id: string, patch: { label?: string; token?: string; scope?: GitScope; username?: string; host?: string }): void {
  const cur = getGitTokenRaw(id);
  if (!cur) throw new Error('token not found');
  const next: GitToken = {
    ...cur,
    label: patch.label ?? cur.label,
    token: (patch.token && patch.token.trim() !== '') ? patch.token.trim() : cur.token, // blank keeps existing
    scope: patch.scope ?? cur.scope,
    username: patch.username ?? cur.username,
    host: patch.host ?? cur.host,
  };
  // `next.token` is plaintext here (cur.token came back decrypted). Encrypt at rest.
  db().prepare(`UPDATE git_tokens SET label=?,token=?,scope=?,username=?,host=? WHERE id=?`)
    .run(next.label, encrypt(next.token), next.scope, next.username, next.host, id);
}
export function deleteGitToken(id: string): void {
  db().prepare(`DELETE FROM git_tokens WHERE id = ?`).run(id);
  db().prepare(`DELETE FROM git_token_assignments WHERE tokenId = ?`).run(id); // drop dangling assignments
}

export function getTokenAssignments(projectId: string = 'default'): Record<string, string> {
  const rows = db().prepare(
    `SELECT agent, tokenId FROM git_token_assignments WHERE (projectId = ? OR (projectId IS NULL AND ? = 'default'))`
  ).all(projectId, projectId) as any[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.agent] = r.tokenId;
  return out;
}
export function setTokenAssignment(agent: string, tokenId: string | null, projectId: string = 'default'): void {
  // NOTE: git_token_assignments PK is `agent` (additive projectId column). An agent
  // therefore holds one assignment at a time; setting it stamps the active project.
  if (!tokenId) {
    db().prepare(`DELETE FROM git_token_assignments WHERE agent = ? AND (projectId = ? OR (projectId IS NULL AND ? = 'default'))`)
      .run(agent, projectId, projectId);
    return;
  }
  db().prepare(`INSERT OR REPLACE INTO git_token_assignments (agent, tokenId, projectId) VALUES (?, ?, ?)`)
    .run(agent, tokenId, projectId);
}

/** Resolve the token an agent should authenticate git with: explicit assignment, else the '*' default. */
export function resolveAgentToken(agentName: string, projectId: string = 'default'): GitToken | null {
  const a = getTokenAssignments(projectId);
  const id = a[agentName] || a['*'];
  return id ? getGitTokenRaw(id) : null;
}

/** Per-process env that makes `git` send the PAT as an Authorization header, scoped to the token's host.
 *  Non-persistent (no global git config, no temp files); safe to hand a single child process. */
export function gitAuthEnv(t: GitToken | null): Record<string, string> {
  if (!t?.token) return {};
  const user = t.username || 'x-access-token';
  const b64 = Buffer.from(`${user}:${t.token}`).toString('base64');
  const host = t.host || 'github.com';
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.https://${host}/.extraheader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${b64}`,
  };
}

// ── code-index target ── which repo the embedding DB indexes (default: host repo).
// Stored per project under board_settings id = `code_index:<projectId>`.
export interface CodeIndexConfig { root?: string; glob?: string }
export function getCodeIndexConfig(projectId: string = 'default'): CodeIndexConfig {
  const conn = db();
  const r = conn.prepare(`SELECT data FROM board_settings WHERE id = ?`).get(`code_index:${projectId}`) as any;
  if (r) { try { return JSON.parse(r.data); } catch { return {}; } }
  // Back-compat: pre-project installs stored the default project's config at 'code_index'.
  if (projectId === 'default') {
    const legacy = conn.prepare(`SELECT data FROM board_settings WHERE id = 'code_index'`).get() as any;
    if (legacy) { try { return JSON.parse(legacy.data); } catch { return {}; } }
  }
  return {};
}
export function setCodeIndexConfig(cfg: CodeIndexConfig, projectId: string = 'default'): void {
  const prev = getCodeIndexConfig(projectId);
  const merged: CodeIndexConfig = {
    root: cfg.root !== undefined ? cfg.root : prev.root,
    glob: cfg.glob !== undefined ? cfg.glob : prev.glob,
  };
  db().prepare(`INSERT OR REPLACE INTO board_settings (id, data) VALUES (?, ?)`).run(`code_index:${projectId}`, JSON.stringify(merged));
}

// ── Projects ── every task/token/index is scoped to one; 'default' always exists.
/** How to install/run/build/test a project's cloned repo. `cwd` is an optional subdir. */
export interface RunConfig { install?: string; run?: string; build?: string; test?: string; cwd?: string }
export interface Project { id: string; name: string; repoPath?: string; emoji?: string; createdAt: string; runConfig?: RunConfig; branch?: string; cloneUrl?: string; maxConcurrency?: number | null; runConfigConfirmed?: boolean; previewVerifiedAt?: string | null; readinessBypass?: boolean }

const PROJECT_COLS = `id,name,repoPath,emoji,createdAt,runConfig,branch,cloneUrl,maxConcurrency,runConfigConfirmed,previewVerifiedAt,readinessBypass`;
export function listProjects(): Project[] {
  return (db().prepare(`SELECT ${PROJECT_COLS} FROM projects ORDER BY (id='default') DESC, createdAt ASC`).all() as any[]).map(rowToProject) as Project[];
}
function rowToProject(r: any): Project | null {
  if (!r) return null;
  let runConfig: RunConfig | undefined;
  if (r.runConfig) { try { runConfig = JSON.parse(r.runConfig); } catch { /* ignore malformed */ } }
  return { id: r.id, name: r.name, repoPath: r.repoPath ?? undefined, emoji: r.emoji ?? undefined, createdAt: r.createdAt, runConfig, branch: r.branch ?? undefined, cloneUrl: r.cloneUrl ?? undefined, maxConcurrency: r.maxConcurrency ?? null, runConfigConfirmed: !!r.runConfigConfirmed, previewVerifiedAt: r.previewVerifiedAt ?? null, readinessBypass: !!r.readinessBypass };
}
export function getProject(id: string): Project | null {
  return rowToProject(db().prepare(`SELECT ${PROJECT_COLS} FROM projects WHERE id = ?`).get(id));
}
/** Set (or clear) a project's run config. Pass undefined to clear. When `confirmed` (a user
 *  explicitly saved/accepted it, not a background auto-detect), also mark the readiness flag. */
export function setProjectRunConfig(id: string, cfg: RunConfig | undefined, confirmed = false): void {
  if (!getProject(id)) throw new Error('project not found');
  db().prepare(`UPDATE projects SET runConfig = ? WHERE id = ?`).run(cfg ? JSON.stringify(cfg) : null, id);
  if (confirmed && cfg) db().prepare(`UPDATE projects SET runConfigConfirmed = 1 WHERE id = ?`).run(id);
}

/** Readiness flags gating task dispatch (see the orchestrator gate). Each field is optional;
 *  only the provided ones are updated. `readinessBypass` must ONLY be set true after the user
 *  confirms both "no existing project" and "not executable". */
export function setProjectReadiness(id: string, patch: { runConfigConfirmed?: boolean; previewVerifiedAt?: string | null; readinessBypass?: boolean }): void {
  const cur = getProject(id);
  if (!cur) throw new Error('project not found');
  const rcc = patch.runConfigConfirmed !== undefined ? (patch.runConfigConfirmed ? 1 : 0) : (cur.runConfigConfirmed ? 1 : 0);
  const pv = patch.previewVerifiedAt !== undefined ? patch.previewVerifiedAt : (cur.previewVerifiedAt ?? null);
  const rb = patch.readinessBypass !== undefined ? (patch.readinessBypass ? 1 : 0) : (cur.readinessBypass ? 1 : 0);
  db().prepare(`UPDATE projects SET runConfigConfirmed = ?, previewVerifiedAt = ?, readinessBypass = ? WHERE id = ?`).run(rcc, pv, rb, id);
}
/** Set a project's max concurrent agents. null → inherit the global default; 0 → unlimited. */
export function setProjectMaxConcurrency(id: string, n: number | null): void {
  if (!getProject(id)) throw new Error('project not found');
  const val = n == null ? null : Math.max(0, Math.floor(n));
  db().prepare(`UPDATE projects SET maxConcurrency = ? WHERE id = ?`).run(val, id);
}

// ── Agent defaults ── global fallbacks stored in the DB (board_settings 'agent_defaults'),
// editable from Settings. A project's own value overrides these; here maxConcurrency 0 =
// unlimited (resource-gated only), which is the out-of-the-box default.
export interface AgentDefaults { maxConcurrency: number }
export function getAgentDefaults(): AgentDefaults {
  const r = db().prepare(`SELECT data FROM board_settings WHERE id = 'agent_defaults'`).get() as any;
  try {
    const d = r ? JSON.parse(r.data) : {};
    return { maxConcurrency: Math.max(0, Math.floor(Number(d.maxConcurrency) || 0)) };
  } catch { return { maxConcurrency: 0 }; }
}
export function setAgentDefaults(d: Partial<AgentDefaults>): AgentDefaults {
  const cur = getAgentDefaults();
  const next: AgentDefaults = { maxConcurrency: d.maxConcurrency != null ? Math.max(0, Math.floor(d.maxConcurrency)) : cur.maxConcurrency };
  db().prepare(`INSERT OR REPLACE INTO board_settings (id, data) VALUES ('agent_defaults', ?)`).run(JSON.stringify(next));
  return next;
}
export function createProject(p: { name: string; repoPath?: string; emoji?: string; branch?: string; cloneUrl?: string }): Project {
  const row: Project = {
    id: 'proj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: p.name || 'Project',
    repoPath: p.repoPath || undefined,
    emoji: p.emoji || '📁',
    createdAt: new Date().toISOString(),
    branch: p.branch || undefined,
    cloneUrl: p.cloneUrl || undefined,
  };
  db().prepare(`INSERT INTO projects (id,name,repoPath,emoji,createdAt,branch,cloneUrl) VALUES (?,?,?,?,?,?,?)`)
    .run(row.id, row.name, row.repoPath ?? null, row.emoji ?? null, row.createdAt, row.branch ?? null, row.cloneUrl ?? null);
  // A project's code index defaults to indexing its own repoPath.
  if (row.repoPath) { try { setCodeIndexConfig({ root: row.repoPath }, row.id); } catch { /* non-fatal */ } }
  return row;
}
export function updateProject(id: string, patch: { name?: string; repoPath?: string; emoji?: string; branch?: string; cloneUrl?: string }): void {
  const cur = getProject(id);
  if (!cur) throw new Error('project not found');
  const next: Project = {
    ...cur,
    name: patch.name ?? cur.name,
    repoPath: patch.repoPath !== undefined ? patch.repoPath : cur.repoPath,
    emoji: patch.emoji ?? cur.emoji,
    branch: patch.branch !== undefined ? patch.branch : cur.branch,
    cloneUrl: patch.cloneUrl !== undefined ? patch.cloneUrl : cur.cloneUrl,
  };
  db().prepare(`UPDATE projects SET name=?, repoPath=?, emoji=?, branch=?, cloneUrl=? WHERE id=?`)
    .run(next.name, next.repoPath ?? null, next.emoji ?? null, next.branch ?? null, next.cloneUrl ?? null, id);
}
export function deleteProject(id: string): void {
  if (id === 'default') throw new Error('cannot delete the default project');
  const conn = db();
  conn.prepare(`DELETE FROM tasks WHERE projectId = ?`).run(id);
  conn.prepare(`DELETE FROM git_tokens WHERE projectId = ?`).run(id);
  conn.prepare(`DELETE FROM git_token_assignments WHERE projectId = ?`).run(id);
  conn.prepare(`DELETE FROM board_settings WHERE id = ?`).run(`code_index:${id}`);
  conn.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
}

export interface Heartbeat {
  count: number; lastBeatAt: string; nextBeatAt: string;
  activeAgents: string[]; circuit: string; mode: string;
  /** Human-readable, always-on description of what the orchestrator is doing right now. */
  statusLine: string;
}

/** Record a heartbeat. Fields NOT supplied are carried over from the previous beat, so a
 *  cheap `beatHeartbeat({ statusLine })` can refresh the live status line frequently
 *  without re-sending the full agent/circuit snapshot. */
export function beatHeartbeat(partial: Partial<Omit<Heartbeat, 'count' | 'lastBeatAt'>>): void {
  const conn = db();
  const row = conn.prepare(`SELECT data FROM board_settings WHERE id = 'heartbeat'`).get() as any;
  const prev: Heartbeat | null = row ? JSON.parse(row.data) : null;
  const hb: Heartbeat = {
    nextBeatAt: prev?.nextBeatAt ?? '', activeAgents: prev?.activeAgents ?? [],
    circuit: prev?.circuit ?? 'closed', mode: prev?.mode ?? 'headless', statusLine: prev?.statusLine ?? '',
    ...partial,
    count: (prev?.count ?? 0) + 1, lastBeatAt: new Date().toISOString(),
  };
  conn.prepare(`INSERT OR REPLACE INTO board_settings (id, data) VALUES ('heartbeat', ?)`).run(JSON.stringify(hb));
}

export function getHeartbeat(): Heartbeat | null {
  const row = db().prepare(`SELECT data FROM board_settings WHERE id = 'heartbeat'`).get() as any;
  return row ? JSON.parse(row.data) : null;
}

// ── GitHub App integration (manifest flow) ─────────────────────────────────────
// ADDED ALONGSIDE the multi-PAT system — the PATs above are untouched. Lets a user
// create a GitHub App from the UI (manifest → GitHub auto-generates App + private
// key), install it, and then use auto-minted short-lived installation tokens for
// clone/push — no hand-crafted PAT.
//
// SECURITY: privateKey / clientSecret / webhookSecret are AES-256-GCM ENCRYPTED at rest in
// the local sqlite github_apps table (see ./secretbox), decrypted only for JWT signing /
// token minting. They are NEVER sent raw over HTTP — listGithubApps() masks them out, and
// minted tokens are stripped from output.
import { createSign } from 'node:crypto';

export interface GithubApp {
  id: string; projectId: string; appId?: string; slug?: string; name?: string;
  privateKey?: string; clientId?: string; clientSecret?: string; webhookSecret?: string;
  htmlUrl?: string; installationId?: string; account?: string; state?: string; createdAt: string;
}

/** Public (masked) shape safe to return over HTTP — never carries the secrets. */
export interface GithubAppPublic {
  id: string; name?: string; slug?: string; appId?: string; htmlUrl?: string;
  state?: string; account?: string; installed: boolean; createdAt: string;
}

/** Create a 'pending' app record BEFORE the browser POSTs the manifest to GitHub.
 *  Its id doubles as the manifest `state` GitHub echoes back to the callback. */
export function createPendingGithubApp(projectId: string = 'default', name?: string): { id: string } {
  const id = 'gha_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  db().prepare(
    `INSERT INTO github_apps (id, projectId, name, state, createdAt) VALUES (?, ?, ?, 'pending', ?)`
  ).run(id, projectId || 'default', name ?? null, new Date().toISOString());
  return { id };
}

/** Decrypt the three at-rest secrets so callers get usable values (JWT signing, token minting). */
function decryptAppSecrets(a: GithubApp): GithubApp {
  return {
    ...a,
    privateKey: a.privateKey != null ? decrypt(a.privateKey) : a.privateKey,
    clientSecret: a.clientSecret != null ? decrypt(a.clientSecret) : a.clientSecret,
    webhookSecret: a.webhookSecret != null ? decrypt(a.webhookSecret) : a.webhookSecret,
  };
}

export function getGithubApp(id: string): GithubApp | null {
  const r = db().prepare(`SELECT * FROM github_apps WHERE id = ?`).get(id) as GithubApp | undefined;
  return r ? decryptAppSecrets(r) : null;
}

/** Full rows INCLUDING secrets — internal use only (JWT signing, token minting). Never send over HTTP. */
export function listGithubAppsRaw(projectId: string = 'default'): GithubApp[] {
  return (db().prepare(
    `SELECT * FROM github_apps WHERE (projectId = ? OR (projectId IS NULL AND ? = 'default')) ORDER BY createdAt ASC`
  ).all(projectId, projectId) as GithubApp[]).map(decryptAppSecrets);
}

/** Masked list for HTTP — NEVER returns privateKey / clientSecret / webhookSecret. */
export function listGithubApps(projectId: string = 'default'): GithubAppPublic[] {
  return listGithubAppsRaw(projectId).map(a => ({
    id: a.id, name: a.name, slug: a.slug, appId: a.appId, htmlUrl: a.htmlUrl,
    state: a.state, account: a.account, installed: !!a.installationId, createdAt: a.createdAt,
  }));
}

const GHA_COLS = ['appId', 'slug', 'name', 'privateKey', 'clientId', 'clientSecret', 'webhookSecret', 'htmlUrl', 'installationId', 'account', 'state'];
// These three columns hold secrets and are encrypted at rest on every write.
const GHA_SECRET_COLS = new Set(['privateKey', 'clientSecret', 'webhookSecret']);
export function updateGithubApp(id: string, patch: Partial<GithubApp>): void {
  const keys = GHA_COLS.filter(k => (patch as any)[k] !== undefined);
  if (!keys.length) return;
  const set = keys.map(k => `${k} = ?`).join(', ');
  // Encrypt secret columns; encrypt() is a no-op if the value is already ciphertext.
  const values = keys.map(k => {
    const v = (patch as any)[k];
    return (GHA_SECRET_COLS.has(k) && typeof v === 'string' && v) ? encrypt(v) : v;
  });
  db().prepare(`UPDATE github_apps SET ${set} WHERE id = ?`).run(...values, id);
}

export function deleteGithubApp(id: string): void {
  db().prepare(`DELETE FROM github_apps WHERE id = ?`).run(id);
}

// ── App JWT (RS256, Node built-in crypto — no external lib) ─────────────────────
const b64url = (b: Buffer | string): string =>
  (Buffer.isBuffer(b) ? b : Buffer.from(b)).toString('base64url');

/** Build a short-lived (10 min) App JWT signed with the app's private key (RS256). */
export function buildAppJwt(appId: string, pem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // iat backdated 60s to tolerate clock drift; exp is the GitHub max of 10 minutes.
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signingInput = `${header}.${payload}`;
  const sig = createSign('RSA-SHA256').update(signingInput).sign(pem);
  return `${signingInput}.${b64url(sig)}`;
}

// In-memory installation-token cache, keyed by app RECORD id. Tokens live ~1h; we
// refresh when <5 min from expiry. Never persisted (short-lived, re-mintable).
const installTokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Mint (or reuse a cached) GitHub App installation token for git auth.
 * Returns { token, username:'x-access-token', host:'github.com' } or null on ANY failure.
 * Use as: https://x-access-token:<token>@github.com/owner/repo.git
 */
export async function mintInstallationToken(
  recordId: string
): Promise<{ token: string; username: 'x-access-token'; host: string } | null> {
  try {
    const app = getGithubApp(recordId);
    if (!app?.appId || !app.privateKey || !app.installationId) return null;
    const host = 'github.com';

    // Reuse a cached token that still has >5 min of life.
    const cached = installTokenCache.get(recordId);
    if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
      return { token: cached.token, username: 'x-access-token', host };
    }

    const jwt = buildAppJwt(app.appId, app.privateKey);
    const r = await fetch(`https://api.github.com/app/installations/${app.installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ai-agents',
      },
    });
    if (!r.ok) return null;
    const data: any = await r.json().catch(() => null);
    if (!data?.token) return null;
    const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : Date.now() + 55 * 60 * 1000;
    installTokenCache.set(recordId, { token: data.token, expiresAt });
    return { token: data.token, username: 'x-access-token', host };
  } catch {
    return null;
  }
}

export interface InstallationRepo { full_name: string; clone_url: string; private: boolean; default_branch?: string }

/** List repos an app installation can access (for the clone picker). Mints a token and
 *  pages GET /installation/repositories. Returns [] on any failure. */
export async function listInstallationRepos(recordId: string): Promise<InstallationRepo[]> {
  const minted = await mintInstallationToken(recordId);
  if (!minted) return [];
  try {
    const out: any[] = [];
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
        headers: { Authorization: `token ${minted.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ai-agents' },
      });
      if (!r.ok) break;
      const data: any = await r.json().catch(() => null);
      const repos: any[] = data?.repositories || [];
      out.push(...repos);
      if (repos.length < 100) break;
    }
    return out
      .map(x => ({ full_name: x.full_name, clone_url: x.clone_url, private: !!x.private, default_branch: x.default_branch }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  } catch { return []; }
}

/** List an app's installations via an App JWT — used by detect-installation. Returns [] on failure. */
export async function listAppInstallations(appId: string, pem: string): Promise<any[]> {
  try {
    const jwt = buildAppJwt(appId, pem);
    const r = await fetch('https://api.github.com/app/installations', {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ai-agents',
      },
    });
    if (!r.ok) return [];
    const data: any = await r.json().catch(() => null);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
