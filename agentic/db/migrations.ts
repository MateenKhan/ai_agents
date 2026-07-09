// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — portable schema migrations (Phase 1 foundation)
// The schema expressed ONCE, as an ordered + idempotent list of portable steps,
// runnable against ANY Store (SQLite today, Postgres for multi-machine). This is
// the single source of truth for "create the tables" and mirrors the combined
//   initSchema() + migrate() of tasks.ts, plus the inline schemas of
//   logs.ts, agents.ts and memory.ts.
//
// Covered tables: tasks, board_settings, git_tokens, git_token_assignments,
//   github_apps, projects, agents, agent_meta, agent_logs, agent_db_usage, memory.
//
// DIALECT NOTES
//  • Type differences are handled by the small per-dialect maps below (TEXT/INTEGER
//    on SQLite vs TEXT/BIGINT/BOOLEAN/TIMESTAMPTZ on Postgres). Auto-increment PKs
//    map INTEGER PRIMARY KEY AUTOINCREMENT → BIGINT GENERATED ALWAYS AS IDENTITY.
//  • Additive ALTERs are wrapped in tryStep() so an "already exists" error is
//    ignored (same intent as connection.ts tryEach). Each step is its own
//    statement — NOT wrapped in one big transaction — because a failed ALTER inside
//    a Postgres transaction would abort the whole block; here a caught failure
//    leaves the next step unaffected (autocommit per statement).
//  • IDENTIFIER CASING (RESOLVED): the schema uses unquoted camelCase column names
//    (claimedBy, createdAt, …). Postgres folds unquoted identifiers to lower-case, so
//    on Postgres these columns become claimedby / createdat. That is internally
//    consistent (queries fold the same way), but the row-object KEYS pg returns would
//    be lower-cased while the row→object mappers in tasks.ts/etc. read camelCase.
//    Reconciled by a key-normalising result mapper in pgStore, driven by the
//    ALL_COLUMN_NAMES export below. SQLite preserves declared case and is unaffected.
// ─────────────────────────────────────────────────────────────────────────────

import type { Store } from './store';

type Dialect = 'sqlite' | 'postgres';

/** The two SQLite files the schema is split across. Postgres uses ONE database for both.
 *  Declared here (next to TABLE_GROUP) so getStore can import it without a cycle. */
export type DbGroup = 'tasks' | 'logs';

// Semantic column types → concrete per-dialect SQL types.
const TYPE: Record<'text' | 'int' | 'bool' | 'ts', Record<Dialect, string>> = {
  text: { sqlite: 'TEXT', postgres: 'TEXT' },
  int: { sqlite: 'INTEGER', postgres: 'BIGINT' },
  // Booleans: the entire codebase writes 0/1 (`enabled ? 1 : 0`) and reads truthiness.
  // A native pg BOOLEAN would reject an integer param ("column is of type boolean but
  // expression is of type integer"), so pg stores SMALLINT and behaves exactly like
  // SQLite. No coercion layer, no caller changes.
  bool: { sqlite: 'INTEGER', postgres: 'SMALLINT' },
  // Timestamps: stored as ISO-8601 strings everywhere. A pg TIMESTAMPTZ would hand back
  // JS Date objects, but callers treat these as strings (Date.parse, lexicographic
  // `expiresAt < ?` compares, JSON to the UI). ISO-8601 UTC sorts lexicographically ==
  // chronologically, so TEXT keeps both dialects byte-identical. We never use SQL date
  // functions on these columns; if that ever changes, revisit this.
  ts: { sqlite: 'TEXT', postgres: 'TEXT' },
};

/** Auto-increment surrogate PK. */
function serialPk(d: Dialect): string {
  return d === 'sqlite'
    ? 'INTEGER PRIMARY KEY AUTOINCREMENT'
    : 'BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY';
}

interface Col {
  name: string;
  type: 'text' | 'int' | 'bool' | 'ts' | 'serial';
  pk?: boolean;
  notNull?: boolean;
  /** Literal default. For `bool`, pass a JS boolean (rendered 0/1 vs true/false). */
  default?: string | number | boolean;
}

function colSql(d: Dialect, c: Col): string {
  if (c.type === 'serial') return `${c.name} ${serialPk(d)}`;
  let s = `${c.name} ${TYPE[c.type][d]}`;
  if (c.pk) s += ' PRIMARY KEY';
  if (c.notNull) s += ' NOT NULL';
  if (c.default !== undefined) {
    let def: string;
    // bool is INTEGER/SMALLINT on both dialects (see TYPE) — always emit 0/1, never
    // a `true`/`false` literal, which SMALLINT would reject.
    if (c.type === 'bool') def = c.default ? '1' : '0';
    else if (typeof c.default === 'string') def = `'${c.default}'`;
    else def = String(c.default);
    s += ` DEFAULT ${def}`;
  }
  return s;
}

function createTable(d: Dialect, name: string, cols: Col[]): string {
  return `CREATE TABLE IF NOT EXISTS ${name} (\n  ${cols.map(c => colSql(d, c)).join(',\n  ')}\n)`;
}

function addColumn(d: Dialect, table: string, col: Col): string {
  return `ALTER TABLE ${table} ADD COLUMN ${colSql(d, col)}`;
}

/** Run a step that may fail if already applied (additive ALTER) — swallow the error.
 *  Mirrors connection.ts tryEach for the async Store surface. */
async function tryStep(store: Store, sql: string): Promise<void> {
  try { await store.exec(sql); } catch { /* already applied */ }
}

// ── Table column definitions (FULL / final shape — fresh DBs get every column) ──

const TASKS: Col[] = [
  { name: 'id', type: 'text', pk: true },
  { name: 'title', type: 'text', notNull: true },
  { name: 'description', type: 'text' },
  { name: 'status', type: 'text', notNull: true },
  { name: 'priority', type: 'int', default: 0 },
  { name: 'claimedBy', type: 'text' },
  { name: 'started', type: 'ts' },
  { name: 'completed', type: 'ts' },
  { name: 'dependsOn', type: 'text' },
  { name: 'files', type: 'text' },
  { name: 'parentId', type: 'text' },
  { name: 'scenarios', type: 'text' },
  { name: 'stage', type: 'text' },
  { name: 'qaVerdict', type: 'text' },
  { name: 'docs', type: 'text' },
  { name: 'reviewNote', type: 'text' },
  { name: 'leaseExpiresAt', type: 'ts' },
  { name: 'attempts', type: 'int', default: 0 },
  { name: 'nextRetryAt', type: 'ts' },
  { name: 'lastError', type: 'text' },
  { name: 'model', type: 'text' },
  { name: 'summary', type: 'text' },
  { name: 'etcMinutes', type: 'int' },
  { name: 'etcSetAt', type: 'ts' },
  { name: 'stageTimings', type: 'text' },
  // ── additive (also created up-front on fresh DBs) ──
  { name: 'projectId', type: 'text' },
  { name: 'control', type: 'text' },
  { name: 'mergeBounces', type: 'int' },
  { name: 'rescueCount', type: 'int' },
  // Fully-qualified path of this task's own log file. Persisted so the log survives a
  // db-server restart, an orchestrator crash, or an agent-slot being reused by another task:
  // the file is found by TASK, not by whichever pool slot happened to run it.
  { name: 'logPath', type: 'text' },
];

const BOARD_SETTINGS: Col[] = [
  { name: 'id', type: 'text', pk: true },
  { name: 'data', type: 'text', notNull: true },
];

const GIT_TOKENS: Col[] = [
  { name: 'id', type: 'text', pk: true },
  { name: 'label', type: 'text', notNull: true },
  { name: 'token', type: 'text', notNull: true },
  { name: 'scope', type: 'text', notNull: true, default: 'readonly' },
  { name: 'username', type: 'text' },
  { name: 'host', type: 'text', notNull: true, default: 'github.com' },
  { name: 'createdAt', type: 'ts', notNull: true },
  { name: 'projectId', type: 'text' }, // additive
];

const GIT_TOKEN_ASSIGNMENTS: Col[] = [
  { name: 'agent', type: 'text', pk: true },
  { name: 'tokenId', type: 'text', notNull: true },
  { name: 'projectId', type: 'text' }, // additive
];

const GITHUB_APPS: Col[] = [
  { name: 'id', type: 'text', pk: true },
  { name: 'projectId', type: 'text', notNull: true },
  { name: 'appId', type: 'text' },
  { name: 'slug', type: 'text' },
  { name: 'name', type: 'text' },
  { name: 'privateKey', type: 'text' },
  { name: 'clientId', type: 'text' },
  { name: 'clientSecret', type: 'text' },
  { name: 'webhookSecret', type: 'text' },
  { name: 'htmlUrl', type: 'text' },
  { name: 'installationId', type: 'text' },
  { name: 'account', type: 'text' },
  { name: 'state', type: 'text' },
  { name: 'createdAt', type: 'ts', notNull: true },
];

const PROJECTS: Col[] = [
  { name: 'id', type: 'text', pk: true },
  { name: 'name', type: 'text', notNull: true },
  { name: 'repoPath', type: 'text' },
  { name: 'emoji', type: 'text' },
  { name: 'createdAt', type: 'ts', notNull: true },
  // ── additive ──
  { name: 'runConfig', type: 'text' },
  { name: 'branch', type: 'text' },
  { name: 'cloneUrl', type: 'text' },
  { name: 'maxConcurrency', type: 'int' },
  // ── project readiness gate (additive) ── flags stored 0/1 on SQLite today.
  { name: 'runConfigConfirmed', type: 'bool' },
  { name: 'previewVerifiedAt', type: 'ts' },
  { name: 'readinessBypass', type: 'bool' },
];

const AGENTS: Col[] = [
  { name: 'role', type: 'text', pk: true },
  { name: 'label', type: 'text', notNull: true },
  { name: 'enabled', type: 'bool', notNull: true, default: true },
  { name: 'model', type: 'text', notNull: true },
  { name: 'worktreeMode', type: 'text', notNull: true },
  { name: 'ord', type: 'int', notNull: true, default: 0 },
  { name: 'isSystem', type: 'bool', notNull: true, default: false },
  { name: 'promptTemplate', type: 'text', notNull: true },
  { name: 'mergePromptTemplate', type: 'text' },
  { name: 'rescuePromptTemplate', type: 'text' }, // additive
];

const AGENT_META: Col[] = [
  { name: 'k', type: 'text', pk: true },
  { name: 'v', type: 'text' },
];

const AGENT_LOGS: Col[] = [
  { name: 'id', type: 'serial' },
  { name: 'taskId', type: 'text', notNull: true },
  { name: 'message', type: 'text', notNull: true },
  { name: 'type', type: 'text', notNull: true, default: 'info' },
  { name: 'timestamp', type: 'ts', notNull: true },
  // Logs belong to the WORK, so they are scoped to the project that owns the task. Without
  // this, getRecentLogs() returns rows across every project (cross-project bleed).
  { name: 'projectId', type: 'text' }, // additive
];

const AGENT_DB_USAGE: Col[] = [
  { name: 'id', type: 'serial' },
  { name: 'agentName', type: 'text', notNull: true },
  { name: 'taskId', type: 'text' },
  { name: 'query', type: 'text' },
  { name: 'timestamp', type: 'ts', notNull: true },
];

const MEMORY: Col[] = [
  { name: 'id', type: 'serial' },
  { name: 'taskId', type: 'text' },
  { name: 'role', type: 'text' },
  { name: 'kind', type: 'text', notNull: true },
  { name: 'text', type: 'text', notNull: true },
  { name: 'at', type: 'ts', notNull: true },
];

// ── Phase 3 (multi-orchestrator safety) ──────────────────────────────────────
// A row per live orchestrator process sharing this DB. `id` is WORKER_ID
// (env WORKER_ID, else `${hostname}:${pid}`). `lastBeatAt` is bumped every loop
// tick; a worker whose beat is older than ~2× the task lease is treated as a dead
// MACHINE and its in-flight tasks are reclaimed by the watchdog.
const WORKERS: Col[] = [
  { name: 'id', type: 'text', pk: true },
  { name: 'host', type: 'text' },
  { name: 'pid', type: 'int' },
  { name: 'startedAt', type: 'ts' },
  { name: 'lastBeatAt', type: 'ts' },
];

// Cross-machine advisory locks. Today only `merge:<projectId>` is used — one machine
// merges a given project at a time. `holder` is the WORKER_ID; `expiresAt` is a TTL so
// a crashed holder's lock is reclaimable without a manual release.
const LOCKS: Col[] = [
  { name: 'name', type: 'text', pk: true },
  { name: 'holder', type: 'text' },
  { name: 'expiresAt', type: 'ts' },
];

// ── Project context memory (logs group) ─────────────────────────────────────
// The per-project set of files currently held in agents' working context — a CACHE,
// not an ownership ledger (see context.ts). `context_files` is the live set (one row
// per project+path, UNIQUE(projectId, path) is the upsert conflict target); every
// mutation appends a `context_ops` audit row.
const CONTEXT_FILES: Col[] = [
  { name: 'id', type: 'serial' },
  { name: 'projectId', type: 'text', notNull: true },
  { name: 'path', type: 'text', notNull: true },
  { name: 'tokens', type: 'int', notNull: true, default: 0 },
  { name: 'pinned', type: 'bool', notNull: true, default: false },
  { name: 'addedBy', type: 'text' },
  { name: 'useCount', type: 'int', notNull: true, default: 0 },
  { name: 'addedAt', type: 'ts', notNull: true },
  { name: 'lastUsedAt', type: 'ts', notNull: true },
];

const CONTEXT_OPS: Col[] = [
  { name: 'id', type: 'serial' },
  { name: 'projectId', type: 'text', notNull: true },
  { name: 'path', type: 'text' },
  { name: 'op', type: 'text', notNull: true },
  { name: 'actor', type: 'text' },
  { name: 'taskId', type: 'text' },
  { name: 'tokens', type: 'int' },
  { name: 'durationMs', type: 'int' },
  { name: 'reason', type: 'text' },
  { name: 'ts', type: 'ts', notNull: true },
];


// Additive ALTERs — historically added by migrate() to pre-existing tables. On a
// fresh DB the columns are already present (in the CREATE TABLE above) so these are
// caught + ignored; on an OLD SQLite DB run through this list they upgrade it.
const ADDITIVE: Array<[string, Col]> = [
  ['tasks', { name: 'scenarios', type: 'text' }],
  ['tasks', { name: 'stage', type: 'text' }],
  ['tasks', { name: 'qaVerdict', type: 'text' }],
  ['tasks', { name: 'docs', type: 'text' }],
  ['tasks', { name: 'model', type: 'text' }],
  ['tasks', { name: 'summary', type: 'text' }],
  ['tasks', { name: 'etcMinutes', type: 'int' }],
  ['tasks', { name: 'etcSetAt', type: 'ts' }],
  ['tasks', { name: 'stageTimings', type: 'text' }],
  ['tasks', { name: 'projectId', type: 'text' }],
  ['tasks', { name: 'control', type: 'text' }],
  ['tasks', { name: 'mergeBounces', type: 'int' }],
  ['tasks', { name: 'rescueCount', type: 'int' }],
  ['git_tokens', { name: 'projectId', type: 'text' }],
  ['git_token_assignments', { name: 'projectId', type: 'text' }],
  ['projects', { name: 'runConfig', type: 'text' }],
  ['projects', { name: 'branch', type: 'text' }],
  ['projects', { name: 'cloneUrl', type: 'text' }],
  ['projects', { name: 'maxConcurrency', type: 'int' }],
  ['projects', { name: 'runConfigConfirmed', type: 'bool' }],
  ['projects', { name: 'previewVerifiedAt', type: 'ts' }],
  ['projects', { name: 'readinessBypass', type: 'bool' }],
  // Logs are work-owned: scope them to the project, and remember each task's own log file.
  ['agent_logs', { name: 'projectId', type: 'text' }],
  ['tasks', { name: 'logPath', type: 'text' }],
  ['agents', { name: 'rescuePromptTemplate', type: 'text' }],
];

/**
 * Every canonical (camelCase) column name in the schema.
 *
 * We create + query columns UNQUOTED, so Postgres folds them to lower-case
 * (`claimedBy` → `claimedby`). That is self-consistent for the SQL itself, but the row
 * objects pg hands back are keyed by the folded, lower-case name — while every row→object
 * mapper (tasks.ts, agents.ts, …) reads camelCase. `pgStore` uses this list to map result
 * keys back to their canonical spelling. SQLite preserves declared case, so it is
 * unaffected; this is a Postgres-only reconciliation.
 */
export const ALL_COLUMN_NAMES: readonly string[] = Array.from(new Set(
  ([] as Col[]).concat(
    TASKS, BOARD_SETTINGS, GIT_TOKENS, GIT_TOKEN_ASSIGNMENTS, GITHUB_APPS, PROJECTS,
    AGENTS, AGENT_META, AGENT_LOGS, AGENT_DB_USAGE, MEMORY, WORKERS, LOCKS,
    CONTEXT_FILES, CONTEXT_OPS,
    ADDITIVE.map(([, c]) => c),
  ).map(c => c.name),
));

/**
 * Run the full schema against any Store (SQLite or Postgres). Idempotent: every
 * table is CREATE TABLE IF NOT EXISTS, every index is CREATE INDEX IF NOT EXISTS,
 * and every additive ALTER is wrapped so "already exists" is ignored. Safe to
 * re-run on every boot and safe to run against a fresh Postgres to "create tables".
 */
/** Which SQLite file owns each table. Postgres keeps every table in ONE database, so this
 *  mapping only constrains the SQLite layout — where `tasks.db` and `logs.db` are distinct
 *  files. Without it, running the full schema against both files gives each one a complete
 *  set of empty shadow tables (a phantom `projects`, `git_tokens`, … in logs.db), and a
 *  mis-grouped query then silently reads an EMPTY table instead of failing loudly. */
const TABLE_GROUP: Record<string, DbGroup> = {
  tasks: 'tasks', board_settings: 'tasks', git_tokens: 'tasks', git_token_assignments: 'tasks',
  github_apps: 'tasks', projects: 'tasks', agents: 'tasks', agent_meta: 'tasks', memory: 'tasks',
  workers: 'tasks', locks: 'tasks',
  agent_logs: 'logs', agent_db_usage: 'logs', context_files: 'logs', context_ops: 'logs',
};

const BASE_TABLES: Array<[string, Col[]]> = [
  ['tasks', TASKS], ['board_settings', BOARD_SETTINGS], ['git_tokens', GIT_TOKENS],
  ['git_token_assignments', GIT_TOKEN_ASSIGNMENTS], ['github_apps', GITHUB_APPS],
  ['projects', PROJECTS], ['agents', AGENTS], ['agent_meta', AGENT_META],
  ['memory', MEMORY], ['workers', WORKERS], ['locks', LOCKS],
  ['agent_logs', AGENT_LOGS], ['agent_db_usage', AGENT_DB_USAGE],
  ['context_files', CONTEXT_FILES], ['context_ops', CONTEXT_OPS],
];

/** [owning table, index SQL] — an index is created only when its table is. */
const INDEXES: Array<[string, string]> = [
  ['tasks', 'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)'],
  ['tasks', 'CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage)'],
  ['tasks', 'CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(projectId)'],
  ['agent_logs', 'CREATE INDEX IF NOT EXISTS idx_agent_logs_task ON agent_logs(taskId)'],
  ['agent_logs', 'CREATE INDEX IF NOT EXISTS idx_agent_logs_project ON agent_logs(projectId)'],
  ['agent_db_usage', 'CREATE INDEX IF NOT EXISTS idx_db_usage_agent ON agent_db_usage(agentName)'],
  ['agent_db_usage', 'CREATE INDEX IF NOT EXISTS idx_db_usage_task ON agent_db_usage(taskId)'],
  ['memory', 'CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory(kind)'],
  // context_files: (projectId, path) MUST be unique — it is the ON CONFLICT target the
  // keepInContext upsert relies on. The plain projectId index serves the list/stats reads.
  ['context_files', 'CREATE UNIQUE INDEX IF NOT EXISTS idx_ctx_files_proj_path ON context_files(projectId, path)'],
  ['context_files', 'CREATE INDEX IF NOT EXISTS idx_ctx_files_proj ON context_files(projectId)'],
  ['context_ops', 'CREATE INDEX IF NOT EXISTS idx_ctx_ops_proj ON context_ops(projectId)'],
];

/**
 * Run the schema against `store`. Pass `group` to restrict it to the tables that live in that
 * SQLite file; omit it (or run against Postgres, which is a single database) to create
 * everything. Idempotent either way.
 *
 * NOTE: existing SQLite files created before this became group-aware still carry the empty
 * shadow tables. They are harmless and are deliberately NOT dropped here — dropping tables is
 * destructive and this function must stay safe to re-run.
 */
export async function runMigrations(store: Store, group?: DbGroup): Promise<void> {
  const d = store.dialect;
  // Postgres = one database, so every table belongs. SQLite without a group = create all
  // (used by POST /backend/migrate and by callers that want the full schema).
  const wanted = (table: string): boolean =>
    d === 'postgres' || !group || TABLE_GROUP[table] === group;

  // 1 — base tables ------------------------------------------------------------
  for (const [name, cols] of BASE_TABLES) {
    if (wanted(name)) await store.exec(createTable(d, name, cols));
  }

  // 2 — additive ALTERs (no-op on fresh DBs; upgrade old SQLite DBs) -----------
  for (const [table, col] of ADDITIVE) {
    if (wanted(table)) await tryStep(store, addColumn(d, table, col));
  }

  // 3 — indexes (created AFTER their columns are guaranteed to exist) ----------
  for (const [table, sql] of INDEXES) {
    if (wanted(table)) await store.exec(sql);
  }

  // 4 — seed the always-present 'default' project (idempotent) -----------------
  // Only where `projects` actually lives; the app assumes 'default' always exists.
  if (!wanted('projects')) return;
  const now = new Date().toISOString();
  const cwd = process.cwd();
  if (d === 'sqlite') {
    await store.run(
      `INSERT OR IGNORE INTO projects (id,name,repoPath,emoji,createdAt) VALUES ('default','Default',?,'📦',?)`,
      [cwd, now],
    );
  } else {
    await store.run(
      `INSERT INTO projects (id,name,repoPath,emoji,createdAt) VALUES ('default','Default',?,'📦',?) ON CONFLICT (id) DO NOTHING`,
      [cwd, now],
    );
  }
}
