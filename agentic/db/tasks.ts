// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — tasks.db (durable, committable)
// The task queue + board state. Scenarios (GWT) replace free-text DoD; `stage`
// routes the pipeline; `qaVerdict` gates merge; `docs` holds MinIO keys.
// Verbose run logs live in logs.db, not here, so this stays lean enough to commit.
// ─────────────────────────────────────────────────────────────────────────────

import os from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import type { Task, Scenario } from '../types';
import { getConfig } from '../runtime-context';
import { openDb } from './connection';
import type { Store } from './store';
import { upsert } from './store';
import { getStore, ensureMigrated } from './getStore';
// Secrets-at-rest: AES-256-GCM. encrypt() is a no-op on already-encrypted values;
// decrypt() passes legacy plaintext straight through (enables lazy migration).
import { encrypt, decrypt, isEncrypted } from './secretbox';

/** The active tasks-group Store, with schema guaranteed. Every exported db fn goes
 *  through this so the same code runs over SQLite (default) or Postgres. */
async function store(): Promise<Store> {
  await ensureMigrated('tasks');
  return getStore('tasks');
}

/**
 * One-time boot schema init for the tasks group. Runs the portable migrations (via
 * ensureMigrated → runMigrations), then the two SQLite-era one-shots that used to run
 * inside the old lazy `db()`: the legacy `dod`→scenario conversion and the at-rest
 * secret re-encryption. Both are best-effort and never block boot. The server / the
 * orchestrator await this once at startup, BEFORE handling requests.
 *
 * Kept exported under the names `initTasksSchema` / `runMigrations` (see db/tasks.ts
 * re-export) so existing boot callers keep working — they are now async.
 */
export async function initTasksSchema(): Promise<void> {
  await ensureMigrated('tasks');
  const s = getStore('tasks');
  try { await migrateLegacyDod(s); } catch { /* never block boot on migration */ }
  // Migrate any legacy plaintext secrets to ciphertext on first boot (best-effort).
  try { await reencryptSecretsAtRest(s); } catch { /* never block boot on migration */ }
  // Declared defaults (board_settings) — inserted only where absent, so a user's edits win.
  // Lives here rather than in runMigrations because seed.ts imports getStore, and getStore
  // imports migrations: hooking it there would close an import cycle.
  try { const { seedDefaults } = await import('./seed'); await seedDefaults(s); }
  catch { /* never block boot on seeding */ }
}

/** Convert legacy free-text `dod` → one THEN scenario, only where scenarios is empty.
 *  `dod` only ever existed on OLD SQLite DBs; the PRAGMA guard makes this a no-op on
 *  fresh DBs and on Postgres (which never had a `dod` column). */
async function migrateLegacyDod(s: Store): Promise<void> {
  if (s.dialect !== 'sqlite') return; // PRAGMA table_info is SQLite-only; pg never had `dod`.
  const cols = await s.all(`PRAGMA table_info(tasks)`);
  const hasDod = (cols as any[]).some(c => c.name === 'dod');
  if (!hasDod) return;
  const rows = await s.all(
    `SELECT id, dod FROM tasks WHERE dod IS NOT NULL AND TRIM(dod) <> '' AND (scenarios IS NULL OR scenarios = '')`
  );
  for (const r of rows as any[]) {
    await s.run(`UPDATE tasks SET scenarios = ? WHERE id = ?`, [JSON.stringify([{ then: String(r.dod) } as Scenario]), r.id]);
  }
}

/** Raw tasks.db connection (for the SQLite-only DB-browser endpoints, PRAGMA quick_check
 *  and VACUUM). Schema is ensured at boot via initTasksSchema(); this just hands back the
 *  shared WAL handle. */
export function getTasksDb(): DatabaseSync { return openDb(getConfig().paths.tasksDbPath); }

/**
 * At-rest migration: scan git_tokens + github_apps and re-write any secret that is
 * still stored in legacy PLAINTEXT as AES-256-GCM ciphertext. Idempotent (isEncrypted()
 * skips already-encrypted values) and BEST-EFFORT — every step is wrapped so a failure
 * never throws and never blocks boot. NEVER logs secret values, only counts.
 */
export async function reencryptSecretsAtRest(s: Store): Promise<void> {
  let migrated = 0, failed = 0;
  const enc = (v: any): any => (typeof v === 'string' && v && !isEncrypted(v)) ? encrypt(v) : v;
  try {
    // git_tokens.token
    const toks = await s.all(`SELECT id, token FROM git_tokens`) as any[];
    for (const t of toks) {
      try {
        if (typeof t.token === 'string' && t.token && !isEncrypted(t.token)) {
          await s.run(`UPDATE git_tokens SET token = ? WHERE id = ?`, [encrypt(t.token), t.id]); migrated++;
        }
      } catch { failed++; }
    }
    // github_apps: privateKey / clientSecret / webhookSecret
    const apps = await s.all(`SELECT id, privateKey, clientSecret, webhookSecret FROM github_apps`) as any[];
    for (const a of apps) {
      try {
        const pk = enc(a.privateKey), cs = enc(a.clientSecret), ws = enc(a.webhookSecret);
        if (pk !== a.privateKey || cs !== a.clientSecret || ws !== a.webhookSecret) {
          await s.run(`UPDATE github_apps SET privateKey = ?, clientSecret = ?, webhookSecret = ? WHERE id = ?`, [pk ?? null, cs ?? null, ws ?? null, a.id]); migrated++;
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

/** Read scenarios back out of a stored column (always a JSON array of Scenario). */
export function safeParseScenarios(v: any): Scenario[] {
  try {
    const arr = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(arr) ? arr.filter(s => s && typeof s.then === 'string') : [];
  } catch { return []; }
}

/** Parse ONE Gherkin block into a Scenario. A block with no THEN is treated as a bare
 *  acceptance statement — better a scenario the agent can read than a silently dropped one. */
function parseGherkinBlock(block: string): Scenario[] {
  const text = block.replace(/^\s*scenario\s*\d*\s*:?\s*/i, '').trim();
  if (!text) return [];
  const grab = (kw: string): string | undefined => {
    const m = text.match(new RegExp(`\\b${kw}\\b\\s+([\\s\\S]*?)(?=\\b(?:GIVEN|WHEN|THEN|AND)\\b|$)`, 'i'));
    return m?.[1]?.trim() || undefined;
  };
  const then = grab('THEN');
  if (!then) return [{ then: text }];
  return [{ given: grab('GIVEN'), when: grab('WHEN'), then }];
}

/** Accept whatever an agent PUTs for `scenarios` and normalise it to Scenario[].
 *
 *  The architect and owner prompts both tell agents to send a Gherkin STRING
 *  (`"scenarios":"GIVEN … WHEN … THEN …"`). Storing that with JSON.stringify and reading it
 *  back with safeParseScenarios yielded [] — the scenarios vanished, and since a task will not
 *  dispatch without at least one, the task silently stalled. Coerce here, at the only door
 *  into the column, so every writer benefits. */
export function coerceScenarios(v: any): Scenario[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v.flatMap(x =>
      typeof x === 'string' ? parseGherkinBlock(x)
      : (x && typeof x.then === 'string') ? [x as Scenario]
      : []);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    // A JSON array that arrived as a string (some clients double-encode).
    if (s.startsWith('[')) { try { return coerceScenarios(JSON.parse(s)); } catch { /* it's prose */ } }
    // Blank-line separated blocks; failing that, one scenario per line when each line has THEN.
    const blocks = s.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
    const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
    const perLine = blocks.length === 1 && lines.length > 1 && lines.every(l => /\bTHEN\b/i.test(l));
    return (perLine ? lines : blocks).flatMap(parseGherkinBlock);
  }
  if (typeof v === 'object' && typeof (v as any).then === 'string') return [v as Scenario];
  return [];
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

/** JSON.parse when it is JSON, otherwise hand back the raw value. */
function parseMaybeJson(v: any): any {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

function rowToTask(r: any): Task {
  return {
    ...r,
    dependsOn: parseArr(r.dependsOn),
    files: parseArr(r.files),
    docs: parseArr(r.docs),
    // coerce, not safeParse: rows written before the coercion existed hold a double-encoded
    // Gherkin string ('"GIVEN … THEN …"'), which safeParseScenarios turned into []. Parsing the
    // JSON layer first and coercing the result recovers those rows instead of stranding them
    // with no scenarios (and therefore un-dispatchable) forever.
    scenarios: coerceScenarios(parseMaybeJson(r.scenarios)),
    stageTimings: parseObj(r.stageTimings),
    // Consult (agent-to-agent question, mid-task). consultLog is a JSON array; pendingConsult is
    // a JSON object or null; consultAnswer is a plain string.
    consultLog: (() => { const v = parseMaybeJson(r.consultLog); return Array.isArray(v) ? v : []; })(),
    pendingConsult: (() => { const v = parseMaybeJson(r.pendingConsult); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; })(),
    journal: (() => { const v = parseMaybeJson(r.journal); return Array.isArray(v) ? v : []; })(),
  };
}

const COLS = 'id,title,description,status,priority,claimedBy,started,completed,dependsOn,files,parentId,scenarios,stage,qaVerdict,docs,reviewNote,leaseExpiresAt,attempts,nextRetryAt,lastError,model,summary,etcMinutes,etcSetAt,stageTimings,projectId,control,mergeBounces,rescueCount,logPath,intent,ownerNote,ownerBounces,lastOutcome,handoffFrom,hops,consultLog,pendingConsult,consultAnswer,failureDetail,plan,journal';

function toRow(t: Partial<Task>): any[] {
  return [
    t.id, t.title, t.description ?? null, t.status, t.priority ?? 0,
    t.claimedBy ?? null, t.started ?? null, t.completed ?? null,
    JSON.stringify(t.dependsOn ?? []), JSON.stringify(t.files ?? []), t.parentId ?? null,
    JSON.stringify(coerceScenarios(t.scenarios)), t.stage ?? null, t.qaVerdict ?? null,
    JSON.stringify(t.docs ?? []), t.reviewNote ?? null, t.leaseExpiresAt ?? null,
    t.attempts ?? 0, t.nextRetryAt ?? null, t.lastError ?? null, t.model ?? null, t.summary ?? null,
    t.etcMinutes ?? null, t.etcSetAt ?? null, JSON.stringify(t.stageTimings ?? {}),
    t.projectId ?? 'default', t.control ?? null, t.mergeBounces ?? 0, t.rescueCount ?? 0,
    t.logPath ?? null, t.intent ?? null, t.ownerNote ?? null, t.ownerBounces ?? 0,
    t.lastOutcome ?? null, t.handoffFrom ?? null, t.hops ?? 0,
    JSON.stringify(t.consultLog ?? []), t.pendingConsult ? JSON.stringify(t.pendingConsult) : null,
    t.consultAnswer ?? null, t.failureDetail ?? null, t.plan ?? null,
    JSON.stringify(t.journal ?? []),
  ];
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/** All tasks for a project (NULL projectId rows are treated as belonging to 'default'). */
export async function getAllTasks(projectId: string = 'default'): Promise<Task[]> {
  const s = await store();
  const rows = await s.all(
    `SELECT * FROM tasks WHERE (projectId = ? OR (projectId IS NULL AND ? = 'default'))`,
    [projectId, projectId],
  );
  return (rows as any[]).map(rowToTask);
}

export async function getTask(id: string): Promise<Task | null> {
  const s = await store();
  const r = await s.get(`SELECT * FROM tasks WHERE id = ?`, [id]);
  return r ? rowToTask(r) : null;
}

export async function createTask(task: Partial<Task> & { id: string; title: string; status: string }): Promise<void> {
  const s = await store();
  const ph = COLS.split(',').map(() => '?').join(',');
  // Capture the user's ask verbatim. `description` is fair game for agents to rewrite (the
  // architect folds its plan into it); `intent` is the immutable record of what was asked for,
  // and is the only thing "expectations not met" can be judged against later.
  const withIntent = { ...task, intent: task.intent ?? task.description ?? task.title };
  await s.run(`INSERT INTO tasks (${COLS}) VALUES (${ph})`, toRow(withIntent));
}

export async function updateTask(id: string, updates: Partial<Task>): Promise<void> {
  const s = await store();
  const current = await s.get(`SELECT * FROM tasks WHERE id = ?`, [id]);
  if (!current) throw new Error(`Task not found: ${id}`);
  const cur = rowToTask(current);
  const merged = { ...cur, ...updates, id };
  // WRITE-ONCE intent. Agents PUT arbitrary JSON at /tasks/:id; without this an architect or
  // an owner could quietly restate the user's ask to match what it built, and the acceptance
  // gate would then be checking the work against itself. Only a task that has no intent yet
  // (pre-migration rows) can gain one.
  if (cur.intent) merged.intent = cur.intent;
  const assignments = COLS.split(',').filter(c => c !== 'id').map(c => `${c}=?`).join(',');
  const row = toRow(merged);
  row.shift(); // drop id from the front (it goes to the WHERE clause)
  await s.run(`UPDATE tasks SET ${assignments} WHERE id = ?`, [...row, id]);
}

export async function deleteTask(id: string): Promise<void> {
  const s = await store();
  await s.run(`DELETE FROM tasks WHERE id = ?`, [id]);
}

export async function bulkUpdatePriorities(updates: Array<{ id: string; priority: number; status: string }>): Promise<void> {
  const s = await store();
  await s.tx(async t => {
    for (const u of updates) await t.run(`UPDATE tasks SET priority=?, status=? WHERE id=?`, [u.priority, u.status, u.id]);
  });
}

// ── Phase 3 — multi-orchestrator safety ────────────────────────────────────────
// Lets MANY orchestrator processes share ONE database without double-running a task
// or double-merging a project. On the default single-machine SQLite path these are
// behaviourally no-ops (the lone worker always wins its claim and its lock); the
// atomicity matters only when several machines point at one Postgres.

/** This orchestrator's stable identity across a run: env WORKER_ID, else host:pid.
 *  `claimedBy` on a task is stored as `${WORKER_ID}:${agentName}` so a task can be
 *  mapped back to the MACHINE that owns it (see listStaleWorkers + reclaim). */
export const WORKER_ID: string = process.env.WORKER_ID || `${os.hostname()}:${process.pid}`;

export interface WorkerRow { id: string; host?: string; pid?: number; startedAt?: string; lastBeatAt?: string }

/** Register (or refresh) this worker's row. Called once at orchestrator startup; a
 *  restart re-stamps startedAt with the new boot time. */
export async function registerWorker(id: string = WORKER_ID): Promise<void> {
  const s = await store();
  const now = new Date().toISOString();
  await upsert(s, 'workers', { id, host: os.hostname(), pid: process.pid, startedAt: now, lastBeatAt: now }, ['id']);
}

/** Heartbeat: bump lastBeatAt. Called every loop tick — cheap single-row UPDATE.
 *  (A worker always registered itself at boot, so the row exists.) */
export async function heartbeatWorker(id: string = WORKER_ID): Promise<void> {
  const s = await store();
  await s.run(`UPDATE workers SET lastBeatAt = ? WHERE id = ?`, [new Date().toISOString(), id]);
}

/** Workers whose last heartbeat is older than `olderThanMs` (or never beat) — i.e.
 *  machines that likely died. ISO-8601 text compares chronologically on SQLite and
 *  as TIMESTAMPTZ on Postgres. */
export async function listStaleWorkers(olderThanMs: number): Promise<WorkerRow[]> {
  const s = await store();
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  return s.all<WorkerRow>(
    `SELECT id, host, pid, startedAt, lastBeatAt FROM workers WHERE lastBeatAt IS NULL OR lastBeatAt < ?`,
    [cutoff],
  );
}

/**
 * Atomically claim a pending task for `worker`. Returns true IFF THIS call won the
 * task. Replaces the old "read pending → set claimedBy" race: the conditional UPDATE
 * only mutates a row that is still unclaimed/unstarted, so at most one worker's UPDATE
 * takes effect.
 *   - Postgres: `UPDATE … WHERE id=? AND (claimedBy IS NULL OR started IS NULL) RETURNING id`
 *     — the row lock serialises concurrent claimers; the loser's WHERE no longer matches
 *     (claimedBy now set), so it gets no RETURNING row.
 *   - SQLite: the same conditional UPDATE runs under the single writer lock, then we
 *     re-read to confirm we hold it (the changes()==1 equivalent). For the lone
 *     orchestrator this always succeeds.
 */
export async function claimTask(taskId: string, worker: string, leaseMs: number): Promise<boolean> {
  const s = await store();
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + leaseMs).toISOString();
  const sql = `UPDATE tasks SET claimedBy = ?, started = ?, leaseExpiresAt = ? WHERE id = ? AND (claimedBy IS NULL OR started IS NULL)`;
  if (s.dialect === 'postgres') {
    const row = await s.get(`${sql} RETURNING id`, [worker, now, lease, taskId]);
    return !!row;
  }
  await s.run(sql, [worker, now, lease, taskId]);
  const row = await s.get<{ claimedBy: string | null }>(`SELECT claimedBy FROM tasks WHERE id = ?`, [taskId]);
  return !!row && row.claimedBy === worker;
}

/**
 * Acquire the named advisory lock for `holder` with a `ttlMs` lease. Returns true IFF
 * granted. An UNEXPIRED lock (any holder) is never re-granted, so it also serialises
 * two merges on the SAME machine (what the old in-memory mergeInFlight() did). A crashed
 * holder's lock is taken over once its expiresAt passes.
 *
 * ONE atomic statement on BOTH dialects: the conditional upsert either inserts (no lock
 * row yet) or updates only when the existing lease has expired; `RETURNING name` yields a
 * row exactly when we took it. Postgres and SQLite (>= 3.35) both support this form, and
 * `excluded` is case-insensitive in both.
 *
 * This must NOT be a read-then-write: SQLite's writer lock covers a single statement, not
 * a SELECT+INSERT pair, so two orchestrator processes against the same .db file could both
 * observe "free" and both take the lock. Two orchestrators on one SQLite file is not
 * hypothetical — a stale process from a previous run is enough.
 */
export async function acquireLock(name: string, holder: string, ttlMs: number): Promise<boolean> {
  const s = await store();
  const nowIso = new Date().toISOString();
  const expires = new Date(Date.now() + ttlMs).toISOString();
  const row = await s.get(
    `INSERT INTO locks (name, holder, expiresAt) VALUES (?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET holder = excluded.holder, expiresAt = excluded.expiresAt
     WHERE locks.expiresAt < ? RETURNING name`,
    [name, holder, expires, nowIso],
  );
  return !!row;
}

/** Release a lock — only if `holder` still owns it (no-op otherwise). */
export async function releaseLock(name: string, holder: string): Promise<void> {
  const s = await store();
  await s.run(`DELETE FROM locks WHERE name = ? AND holder = ?`, [name, holder]);
}

// ── board settings + heartbeat (orchestrator liveness) ─────────────────────────

export async function getBoardSettings(): Promise<any> {
  const s = await store();
  const r = await s.get(`SELECT data FROM board_settings WHERE id = ?`, ['default']);
  return r ? JSON.parse(r.data) : null;
}

export async function updateBoardSettings(settings: any): Promise<void> {
  const s = await store();
  await upsert(s, 'board_settings', { id: 'default', data: JSON.stringify(settings) }, ['id']);
}

// ── git config (GitHub token storage in board_settings id='git_config') ────────
// SECURITY: the token is stored in PLAINTEXT in the local sqlite board_settings
// table. It is never returned raw over HTTP (server masks it on read).

export interface GitConfig { token?: string; username?: string; host?: string }

export async function getGitConfig(): Promise<GitConfig> {
  const s = await store();
  const r = await s.get(`SELECT data FROM board_settings WHERE id = ?`, ['git_config']);
  try { return r ? JSON.parse(r.data) : {}; } catch { return {}; }
}

export async function setGitConfig(cfg: GitConfig): Promise<void> {
  const s = await store();
  const prev = await getGitConfig();
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
  await upsert(s, 'board_settings', { id: 'git_config', data: JSON.stringify(merged) }, ['id']);
}

// ── Multiple labeled PAT tokens + per-agent assignment ────────────────────────
export type GitScope = 'readonly' | 'readwrite';
export interface GitToken { id: string; label: string; token: string; scope: GitScope; username?: string; host: string; createdAt: string }

/**
 * GIT CREDENTIALS ARE GLOBAL, not project-scoped.
 *
 * Scope follows ownership: a PAT or GitHub App belongs to the ACCOUNT, not to one repo. A user
 * has one GitHub account and many projects in it. Scoping credentials per project forced them to
 * re-paste the same token for every project and multiplied the places to rotate — and to leak — it.
 *
 * The `projectId` column and the `projectId` parameters are retained for provenance and for
 * source compatibility, but they are IGNORED by every read path below. Do not reintroduce a
 * `WHERE projectId = ?` filter here.
 */

/** Full rows INCLUDING the raw token — internal use only (git ops, agent auth). Never send over HTTP. */
export async function listGitTokensRaw(_projectId?: string): Promise<GitToken[]> {
  const s = await store();
  // Decrypt `token` so callers (git ops, HTTP masking) receive the real PAT.
  const rows = await s.all(`SELECT * FROM git_tokens ORDER BY createdAt ASC`) as GitToken[];
  return rows.map(t => ({ ...t, token: decrypt(t.token) }));
}
export async function getGitTokenRaw(id: string): Promise<GitToken | null> {
  const s = await store();
  const r = await s.get(`SELECT * FROM git_tokens WHERE id = ?`, [id]) as GitToken | null;
  if (!r) return null;
  return { ...r, token: decrypt(r.token) }; // decrypt so callers get the real token
}
export async function addGitToken(t: { label: string; token: string; scope?: GitScope; username?: string; host?: string }, _projectId?: string): Promise<GitToken> {
  const s = await store();
  // Token labels must be unique across the account (a user may hold several PATs / GitHub
  // apps with different scopes) — auto-suffix a duplicate rather than reject it.
  const existing = new Set((await listGitTokensRaw()).map(x => x.label));
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
  // projectId is left NULL — credentials are account-owned, not project-owned.
  await s.run(`INSERT INTO git_tokens (id,label,token,scope,username,host,createdAt,projectId) VALUES (?,?,?,?,?,?,?,NULL)`,
    [row.id, row.label, encrypt(row.token), row.scope, row.username, row.host, row.createdAt]);
  return row;
}
export async function updateGitToken(id: string, patch: { label?: string; token?: string; scope?: GitScope; username?: string; host?: string }): Promise<void> {
  const s = await store();
  const cur = await getGitTokenRaw(id);
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
  await s.run(`UPDATE git_tokens SET label=?,token=?,scope=?,username=?,host=? WHERE id=?`,
    [next.label, encrypt(next.token), next.scope, next.username, next.host, id]);
}
export async function deleteGitToken(id: string): Promise<void> {
  const s = await store();
  await s.run(`DELETE FROM git_tokens WHERE id = ?`, [id]);
  await s.run(`DELETE FROM git_token_assignments WHERE tokenId = ?`, [id]); // drop dangling assignments
}

/** Agent → token assignments. GLOBAL: the PK is `agent`, so an agent holds ONE assignment,
 *  and credentials are account-owned. `projectId` is ignored (see the note above). */
export async function getTokenAssignments(_projectId?: string): Promise<Record<string, string>> {
  const s = await store();
  const rows = await s.all(`SELECT agent, tokenId FROM git_token_assignments`) as any[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.agent] = r.tokenId;
  return out;
}
export async function setTokenAssignment(agent: string, tokenId: string | null, _projectId?: string): Promise<void> {
  const s = await store();
  // git_token_assignments PK is `agent`: one assignment per agent, account-wide.
  if (!tokenId) {
    await s.run(`DELETE FROM git_token_assignments WHERE agent = ?`, [agent]);
    return;
  }
  await upsert(s, 'git_token_assignments', { agent, tokenId }, ['agent']);
}

/** Resolve the token an agent should authenticate git with: explicit assignment, else the '*' default. */
export async function resolveAgentToken(agentName: string, _projectId?: string): Promise<GitToken | null> {
  const a = await getTokenAssignments();
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
export async function getCodeIndexConfig(projectId: string = 'default'): Promise<CodeIndexConfig> {
  const s = await store();
  const r = await s.get(`SELECT data FROM board_settings WHERE id = ?`, [`code_index:${projectId}`]) as any;
  if (r) { try { return JSON.parse(r.data); } catch { return {}; } }
  // Back-compat: pre-project installs stored the default project's config at 'code_index'.
  if (projectId === 'default') {
    const legacy = await s.get(`SELECT data FROM board_settings WHERE id = 'code_index'`) as any;
    if (legacy) { try { return JSON.parse(legacy.data); } catch { return {}; } }
  }
  return {};
}
export async function setCodeIndexConfig(cfg: CodeIndexConfig, projectId: string = 'default'): Promise<void> {
  const s = await store();
  const prev = await getCodeIndexConfig(projectId);
  const merged: CodeIndexConfig = {
    root: cfg.root !== undefined ? cfg.root : prev.root,
    glob: cfg.glob !== undefined ? cfg.glob : prev.glob,
  };
  await upsert(s, 'board_settings', { id: `code_index:${projectId}`, data: JSON.stringify(merged) }, ['id']);
}

// ── Projects ── every task/token/index is scoped to one; 'default' always exists.
/** How to install/run/build/test a project's cloned repo. `cwd` is an optional subdir. */
export interface RunConfig { install?: string; run?: string; build?: string; test?: string; cwd?: string }
export interface Project { id: string; name: string; repoPath?: string; emoji?: string; createdAt: string; runConfig?: RunConfig; branch?: string; cloneUrl?: string; maxConcurrency?: number | null; runConfigConfirmed?: boolean; previewVerifiedAt?: string | null; readinessBypass?: boolean }

const PROJECT_COLS = `id,name,repoPath,emoji,createdAt,runConfig,branch,cloneUrl,maxConcurrency,runConfigConfirmed,previewVerifiedAt,readinessBypass`;
export async function listProjects(): Promise<Project[]> {
  const s = await store();
  const rows = await s.all(`SELECT ${PROJECT_COLS} FROM projects ORDER BY (id='default') DESC, createdAt ASC`);
  return (rows as any[]).map(rowToProject) as Project[];
}
function rowToProject(r: any): Project | null {
  if (!r) return null;
  let runConfig: RunConfig | undefined;
  if (r.runConfig) { try { runConfig = JSON.parse(r.runConfig); } catch { /* ignore malformed */ } }
  return { id: r.id, name: r.name, repoPath: r.repoPath ?? undefined, emoji: r.emoji ?? undefined, createdAt: r.createdAt, runConfig, branch: r.branch ?? undefined, cloneUrl: r.cloneUrl ?? undefined, maxConcurrency: r.maxConcurrency ?? null, runConfigConfirmed: !!r.runConfigConfirmed, previewVerifiedAt: r.previewVerifiedAt ?? null, readinessBypass: !!r.readinessBypass };
}
export async function getProject(id: string): Promise<Project | null> {
  const s = await store();
  return rowToProject(await s.get(`SELECT ${PROJECT_COLS} FROM projects WHERE id = ?`, [id]));
}
/** Set (or clear) a project's run config. Pass undefined to clear. When `confirmed` (a user
 *  explicitly saved/accepted it, not a background auto-detect), also mark the readiness flag. */
export async function setProjectRunConfig(id: string, cfg: RunConfig | undefined, confirmed = false): Promise<void> {
  const s = await store();
  if (!await getProject(id)) throw new Error('project not found');
  await s.run(`UPDATE projects SET runConfig = ? WHERE id = ?`, [cfg ? JSON.stringify(cfg) : null, id]);
  if (confirmed && cfg) await s.run(`UPDATE projects SET runConfigConfirmed = 1 WHERE id = ?`, [id]);
}

/** Readiness flags gating task dispatch (see the orchestrator gate). Each field is optional;
 *  only the provided ones are updated. `readinessBypass` must ONLY be set true after the user
 *  confirms both "no existing project" and "not executable". */
export async function setProjectReadiness(id: string, patch: { runConfigConfirmed?: boolean; previewVerifiedAt?: string | null; readinessBypass?: boolean }): Promise<void> {
  const s = await store();
  const cur = await getProject(id);
  if (!cur) throw new Error('project not found');
  const rcc = patch.runConfigConfirmed !== undefined ? (patch.runConfigConfirmed ? 1 : 0) : (cur.runConfigConfirmed ? 1 : 0);
  const pv = patch.previewVerifiedAt !== undefined ? patch.previewVerifiedAt : (cur.previewVerifiedAt ?? null);
  const rb = patch.readinessBypass !== undefined ? (patch.readinessBypass ? 1 : 0) : (cur.readinessBypass ? 1 : 0);
  await s.run(`UPDATE projects SET runConfigConfirmed = ?, previewVerifiedAt = ?, readinessBypass = ? WHERE id = ?`, [rcc, pv, rb, id]);
}
/** Set a project's max concurrent agents. null → inherit the global default; 0 → unlimited. */
export async function setProjectMaxConcurrency(id: string, n: number | null): Promise<void> {
  const s = await store();
  if (!await getProject(id)) throw new Error('project not found');
  const val = n == null ? null : Math.max(0, Math.floor(n));
  await s.run(`UPDATE projects SET maxConcurrency = ? WHERE id = ?`, [val, id]);
}

// ── Agent defaults ── global fallbacks stored in the DB (board_settings 'agent_defaults'),
// editable from Settings. A project's own value overrides these; here maxConcurrency 0 =
// unlimited (resource-gated only), which is the out-of-the-box default.
/** Global agent defaults. `skipPermissions` maps to `--dangerously-skip-permissions`:
 *  headless `claude -p` blocks on a permission prompt without it, so agents cannot run
 *  unattended when it is OFF. Defaults to true (the product works out of the box) but is
 *  now a VISIBLE, owned setting rather than a silent env-var default. */
export interface AgentDefaults { maxConcurrency: number; skipPermissions: boolean }
export async function getAgentDefaults(): Promise<AgentDefaults> {
  const s = await store();
  const r = await s.get(`SELECT data FROM board_settings WHERE id = 'agent_defaults'`) as any;
  try {
    const d = r ? JSON.parse(r.data) : {};
    return {
      maxConcurrency: Math.max(0, Math.floor(Number(d.maxConcurrency) || 0)),
      skipPermissions: d.skipPermissions !== false, // absent => true (back-compat)
    };
  } catch { return { maxConcurrency: 0, skipPermissions: true }; }
}
export async function setAgentDefaults(d: Partial<AgentDefaults>): Promise<AgentDefaults> {
  const s = await store();
  const cur = await getAgentDefaults();
  const next: AgentDefaults = {
    maxConcurrency: d.maxConcurrency != null ? Math.max(0, Math.floor(d.maxConcurrency)) : cur.maxConcurrency,
    skipPermissions: d.skipPermissions != null ? !!d.skipPermissions : cur.skipPermissions,
  };
  await upsert(s, 'board_settings', { id: 'agent_defaults', data: JSON.stringify(next) }, ['id']);
  return next;
}
export async function createProject(p: { name: string; repoPath?: string; emoji?: string; branch?: string; cloneUrl?: string }): Promise<Project> {
  const s = await store();
  const row: Project = {
    id: 'proj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: p.name || 'Project',
    repoPath: p.repoPath || undefined,
    emoji: p.emoji || '📁',
    createdAt: new Date().toISOString(),
    branch: p.branch || undefined,
    cloneUrl: p.cloneUrl || undefined,
  };
  await s.run(`INSERT INTO projects (id,name,repoPath,emoji,createdAt,branch,cloneUrl) VALUES (?,?,?,?,?,?,?)`,
    [row.id, row.name, row.repoPath ?? null, row.emoji ?? null, row.createdAt, row.branch ?? null, row.cloneUrl ?? null]);
  // A project's code index defaults to indexing its own repoPath.
  if (row.repoPath) { try { await setCodeIndexConfig({ root: row.repoPath }, row.id); } catch { /* non-fatal */ } }
  return row;
}
export async function updateProject(id: string, patch: { name?: string; repoPath?: string; emoji?: string; branch?: string; cloneUrl?: string }): Promise<void> {
  const s = await store();
  const cur = await getProject(id);
  if (!cur) throw new Error('project not found');
  const next: Project = {
    ...cur,
    name: patch.name ?? cur.name,
    repoPath: patch.repoPath !== undefined ? patch.repoPath : cur.repoPath,
    emoji: patch.emoji ?? cur.emoji,
    branch: patch.branch !== undefined ? patch.branch : cur.branch,
    cloneUrl: patch.cloneUrl !== undefined ? patch.cloneUrl : cur.cloneUrl,
  };
  await s.run(`UPDATE projects SET name=?, repoPath=?, emoji=?, branch=?, cloneUrl=? WHERE id=?`,
    [next.name, next.repoPath ?? null, next.emoji ?? null, next.branch ?? null, next.cloneUrl ?? null, id]);
}
export async function deleteProject(id: string): Promise<void> {
  if (id === 'default') throw new Error('cannot delete the default project');
  const s = await store();
  // Agent memory keys on taskId (not projectId), so drop this project's memory rows via its
  // tasks BEFORE the tasks themselves are deleted — otherwise they orphan in memory forever.
  await s.run(`DELETE FROM memory WHERE taskId IN (SELECT id FROM tasks WHERE projectId = ?)`, [id]);
  await s.run(`DELETE FROM tasks WHERE projectId = ?`, [id]);
  // Deleting a project must NOT delete git credentials. Tokens and GitHub Apps are
  // account-owned and shared by every project — dropping them here used to destroy the
  // user's GitHub access for all their other projects.
  await s.run(`DELETE FROM board_settings WHERE id = ?`, [`code_index:${id}`]);
  await s.run(`DELETE FROM projects WHERE id = ?`, [id]);
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
export async function beatHeartbeat(partial: Partial<Omit<Heartbeat, 'count' | 'lastBeatAt'>>): Promise<void> {
  const s = await store();
  const row = await s.get(`SELECT data FROM board_settings WHERE id = 'heartbeat'`) as any;
  const prev: Heartbeat | null = row ? JSON.parse(row.data) : null;
  const hb: Heartbeat = {
    nextBeatAt: prev?.nextBeatAt ?? '', activeAgents: prev?.activeAgents ?? [],
    circuit: prev?.circuit ?? 'closed', mode: prev?.mode ?? 'headless', statusLine: prev?.statusLine ?? '',
    ...partial,
    count: (prev?.count ?? 0) + 1, lastBeatAt: new Date().toISOString(),
  };
  await upsert(s, 'board_settings', { id: 'heartbeat', data: JSON.stringify(hb) }, ['id']);
}

export async function getHeartbeat(): Promise<Heartbeat | null> {
  const s = await store();
  const row = await s.get(`SELECT data FROM board_settings WHERE id = 'heartbeat'`) as any;
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
export async function createPendingGithubApp(projectId: string = 'default', name?: string): Promise<{ id: string }> {
  const s = await store();
  const id = 'gha_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await s.run(
    `INSERT INTO github_apps (id, projectId, name, state, createdAt) VALUES (?, ?, ?, 'pending', ?)`,
    [id, projectId || 'default', name ?? null, new Date().toISOString()],
  );
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

export async function getGithubApp(id: string): Promise<GithubApp | null> {
  const s = await store();
  const r = await s.get(`SELECT * FROM github_apps WHERE id = ?`, [id]) as GithubApp | null;
  return r ? decryptAppSecrets(r) : null;
}

/** Full rows INCLUDING secrets — internal use only (JWT signing, token minting). Never send over HTTP. */
/** GLOBAL, like git_tokens: a GitHub App belongs to the account and is installed on repos.
 *  `projectId` is retained as provenance only and is ignored here. */
export async function listGithubAppsRaw(_projectId?: string): Promise<GithubApp[]> {
  const s = await store();
  const rows = await s.all(`SELECT * FROM github_apps ORDER BY createdAt ASC`) as GithubApp[];
  return rows.map(decryptAppSecrets);
}

/** Masked list for HTTP — NEVER returns privateKey / clientSecret / webhookSecret. */
export async function listGithubApps(_projectId?: string): Promise<GithubAppPublic[]> {
  return (await listGithubAppsRaw()).map(a => ({
    id: a.id, name: a.name, slug: a.slug, appId: a.appId, htmlUrl: a.htmlUrl,
    state: a.state, account: a.account, installed: !!a.installationId, createdAt: a.createdAt,
  }));
}

const GHA_COLS = ['appId', 'slug', 'name', 'privateKey', 'clientId', 'clientSecret', 'webhookSecret', 'htmlUrl', 'installationId', 'account', 'state'];
// These three columns hold secrets and are encrypted at rest on every write.
const GHA_SECRET_COLS = new Set(['privateKey', 'clientSecret', 'webhookSecret']);
export async function updateGithubApp(id: string, patch: Partial<GithubApp>): Promise<void> {
  const keys = GHA_COLS.filter(k => (patch as any)[k] !== undefined);
  if (!keys.length) return;
  const s = await store();
  const set = keys.map(k => `${k} = ?`).join(', ');
  // Encrypt secret columns; encrypt() is a no-op if the value is already ciphertext.
  const values = keys.map(k => {
    const v = (patch as any)[k];
    return (GHA_SECRET_COLS.has(k) && typeof v === 'string' && v) ? encrypt(v) : v;
  });
  await s.run(`UPDATE github_apps SET ${set} WHERE id = ?`, [...values, id]);
}

export async function deleteGithubApp(id: string): Promise<void> {
  const s = await store();
  await s.run(`DELETE FROM github_apps WHERE id = ?`, [id]);
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
    const app = await getGithubApp(recordId);
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
