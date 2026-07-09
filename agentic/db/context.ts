// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — project context memory (logs.db, disposable)
//
// The per-project set of files currently held in agents' working context ("what
// is in Claude's memory right now"). Modeled as a CACHE, never an ownership ledger:
//   • auto-added files (agent db:search hits) are LRU cache entries — evicted by
//     staleness / size cap, NEVER by trusting a dying agent to clean up.
//   • user-added files are PINS — never auto-evicted.
// Every mutation writes a high-quality op-log row (op + actor + tokens + durationMs
// + reason) so the UI can show keep / read / evict timings. logs.db is disposable;
// context rebuilds as agents run.
// ─────────────────────────────────────────────────────────────────────────────

import type { DatabaseSync } from 'node:sqlite';
import { getConfig } from '../runtime-context';
import { openDb } from './connection';

/** Default context budget. Past ~200K Haiku is unusable; large contexts also dilute
 *  attention ("context rot") — the cap is a quality+cost guardrail, LRU-enforced. */
export const DEFAULT_CONTEXT_CAP = 300_000;

/** Rough token estimate from raw bytes (~3.7 bytes/token for source). Cheap + instant;
 *  swap for a real tokenizer count later if exactness is ever needed. */
export function estimateTokens(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / 3.7));
}

export type ContextOp = 'keep' | 'read' | 'evict' | 'pin' | 'unpin' | 'refresh' | 'sweep';

export interface ContextFile {
  projectId: string;
  path: string;
  tokens: number;
  pinned: 0 | 1;
  addedBy: string | null;
  useCount: number;
  addedAt: string;
  lastUsedAt: string;
}

export interface ContextOpRow {
  id?: number;
  projectId: string;
  path: string | null;
  op: ContextOp;
  actor: string | null;
  taskId: string | null;
  tokens: number | null;
  durationMs: number | null;
  reason: string | null;
  ts: string;
}

let ready = false;

function db(): DatabaseSync {
  const conn = openDb(getConfig().paths.logsDbPath);
  if (!ready) {
    conn.exec(`CREATE TABLE IF NOT EXISTS context_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projectId  TEXT NOT NULL,
      path       TEXT NOT NULL,
      tokens     INTEGER NOT NULL DEFAULT 0,
      pinned     INTEGER NOT NULL DEFAULT 0,
      addedBy    TEXT,
      useCount   INTEGER NOT NULL DEFAULT 0,
      addedAt    TEXT NOT NULL,
      lastUsedAt TEXT NOT NULL,
      UNIQUE(projectId, path)
    )`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_ctx_files_proj ON context_files(projectId)`);
    conn.exec(`CREATE TABLE IF NOT EXISTS context_ops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projectId  TEXT NOT NULL,
      path       TEXT,
      op         TEXT NOT NULL,
      actor      TEXT,
      taskId     TEXT,
      tokens     INTEGER,
      durationMs INTEGER,
      reason     TEXT,
      ts         TEXT NOT NULL
    )`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_ctx_ops_proj ON context_ops(projectId)`);
    ready = true;
  }
  return conn;
}

const now = () => new Date().toISOString();

function logOp(row: Omit<ContextOpRow, 'id' | 'ts'>): void {
  db().prepare(
    `INSERT INTO context_ops (projectId, path, op, actor, taskId, tokens, durationMs, reason, ts)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(row.projectId, row.path, row.op, row.actor ?? null, row.taskId ?? null,
        row.tokens ?? null, row.durationMs ?? null, row.reason ?? null, now());
}

export interface KeepArgs {
  projectId: string;
  path: string;
  tokens: number;
  /** 'user' pins are never auto-evicted; an agent name is an LRU cache entry. */
  addedBy: string;
  pinned?: boolean;
  taskId?: string | null;
  /** End-to-end time the caller spent producing this (e.g. file read). Logged. */
  durationMs?: number;
  /** Budget override; defaults to DEFAULT_CONTEXT_CAP. Enforced after the keep. */
  cap?: number;
}

/** Put a file INTO context (or refresh an existing entry). Bumps use-count, records a
 *  `keep` op with timing, then enforces the size cap by evicting LRU unpinned files. */
export function keepInContext(a: KeepArgs): { file: ContextFile; evicted: ContextFile[] } {
  const t0 = Date.now();
  const conn = db();
  const isUser = a.addedBy === 'user';
  const pin = (a.pinned ?? isUser) ? 1 : 0;
  conn.prepare(
    `INSERT INTO context_files (projectId, path, tokens, pinned, addedBy, useCount, addedAt, lastUsedAt)
     VALUES (?,?,?,?,?,1,?,?)
     ON CONFLICT(projectId, path) DO UPDATE SET
       tokens=excluded.tokens,
       useCount=context_files.useCount+1,
       lastUsedAt=excluded.lastUsedAt,
       pinned=MAX(context_files.pinned, excluded.pinned)`
  ).run(a.projectId, a.path, a.tokens, pin, a.addedBy, now(), now());
  logOp({ projectId: a.projectId, path: a.path, op: 'keep', actor: a.addedBy,
    taskId: a.taskId ?? null, tokens: a.tokens, durationMs: a.durationMs ?? (Date.now() - t0),
    reason: isUser ? 'user pinned' : 'agent kept' });
  const evicted = enforceCap(a.projectId, a.cap ?? DEFAULT_CONTEXT_CAP);
  const file = getContextFile(a.projectId, a.path)!;
  return { file, evicted };
}

/** Record that a file already in context was READ again — bumps LRU recency + use-count
 *  and logs a `read` op with the read time. No-op (returns false) if not in context. */
export function touchContext(projectId: string, path: string, actor: string, taskId?: string | null, durationMs?: number): boolean {
  const r = db().prepare(
    `UPDATE context_files SET useCount=useCount+1, lastUsedAt=? WHERE projectId=? AND path=?`
  ).run(now(), projectId, path);
  const hit = (r.changes ?? 0) > 0;
  if (hit) logOp({ projectId, path, op: 'read', actor, taskId: taskId ?? null, tokens: null, durationMs: durationMs ?? null, reason: 'read from memory' });
  return hit;
}

export function getContextFile(projectId: string, path: string): ContextFile | null {
  const r = db().prepare(`SELECT * FROM context_files WHERE projectId=? AND path=?`).get(projectId, path) as any;
  return r ?? null;
}

/** Current context set — pins first, then most-recently-used. */
export function listContext(projectId: string): ContextFile[] {
  return db().prepare(
    `SELECT * FROM context_files WHERE projectId=? ORDER BY pinned DESC, lastUsedAt DESC`
  ).all(projectId) as any[];
}

export interface ContextStats { projectId: string; cap: number; totalTokens: number; fileCount: number; pinnedCount: number; pct: number; }

export function contextStats(projectId: string, cap = DEFAULT_CONTEXT_CAP): ContextStats {
  const r = db().prepare(
    `SELECT COALESCE(SUM(tokens),0) tot, COUNT(*) n, COALESCE(SUM(pinned),0) pins FROM context_files WHERE projectId=?`
  ).get(projectId) as any;
  const totalTokens = r?.tot ?? 0;
  return { projectId, cap, totalTokens, fileCount: r?.n ?? 0, pinnedCount: r?.pins ?? 0, pct: cap ? Math.round((totalTokens / cap) * 100) : 0 };
}

/** Remove a file from context. `unpin` op if it was a pin, else `evict`. */
export function removeFromContext(projectId: string, path: string, actor = 'user', reason = 'removed'): boolean {
  const t0 = Date.now();
  const existing = getContextFile(projectId, path);
  if (!existing) return false;
  db().prepare(`DELETE FROM context_files WHERE projectId=? AND path=?`).run(projectId, path);
  logOp({ projectId, path, op: existing.pinned ? 'unpin' : 'evict', actor,
    taskId: null, tokens: existing.tokens, durationMs: Date.now() - t0, reason });
  return true;
}

export function setPinned(projectId: string, path: string, pinned: boolean, actor = 'user'): boolean {
  const r = db().prepare(`UPDATE context_files SET pinned=? WHERE projectId=? AND path=?`)
    .run(pinned ? 1 : 0, projectId, path);
  const hit = (r.changes ?? 0) > 0;
  if (hit) logOp({ projectId, path, op: pinned ? 'pin' : 'unpin', actor, taskId: null, tokens: null, durationMs: null, reason: pinned ? 'pinned' : 'unpinned' });
  return hit;
}

/** Evict least-recently-used UNPINNED files until total ≤ cap. Pins are never touched.
 *  Each eviction is logged with the over-cap reason + timing. Returns evicted rows. */
export function enforceCap(projectId: string, cap = DEFAULT_CONTEXT_CAP): ContextFile[] {
  const evicted: ContextFile[] = [];
  let { totalTokens } = contextStats(projectId, cap);
  if (totalTokens <= cap) return evicted;
  // LRU order among unpinned candidates.
  const candidates = db().prepare(
    `SELECT * FROM context_files WHERE projectId=? AND pinned=0 ORDER BY lastUsedAt ASC`
  ).all(projectId) as any[];
  for (const f of candidates) {
    if (totalTokens <= cap) break;
    const t0 = Date.now();
    db().prepare(`DELETE FROM context_files WHERE projectId=? AND path=?`).run(projectId, f.path);
    logOp({ projectId, path: f.path, op: 'evict', actor: 'gc', taskId: null, tokens: f.tokens, durationMs: Date.now() - t0, reason: `over cap (${cap})` });
    totalTokens -= f.tokens;
    evicted.push(f);
  }
  return evicted;
}

export interface SweepResult { agedOut: number; overCap: number; freedTokens: number; }

/** Health-check GC: age out stale unpinned entries, then enforce the cap. This is the
 *  ONLY thing that reclaims orphans left by abruptly-killed agents — it prunes by
 *  staleness/size, never by "is an agent still holding it". */
export function sweepContext(projectId: string, opts: { cap?: number; maxAgeMs?: number } = {}): SweepResult {
  const t0 = Date.now();
  const cap = opts.cap ?? DEFAULT_CONTEXT_CAP;
  const maxAgeMs = opts.maxAgeMs ?? 2 * 60 * 60 * 1000; // 2h default TTL for unpinned
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const stale = db().prepare(
    `SELECT * FROM context_files WHERE projectId=? AND pinned=0 AND lastUsedAt < ?`
  ).all(projectId, cutoff) as any[];
  let freed = 0;
  for (const f of stale) {
    db().prepare(`DELETE FROM context_files WHERE projectId=? AND path=?`).run(projectId, f.path);
    logOp({ projectId, path: f.path, op: 'evict', actor: 'gc', taskId: null, tokens: f.tokens, durationMs: null, reason: 'stale (aged out)' });
    freed += f.tokens;
  }
  const overCap = enforceCap(projectId, cap);
  freed += overCap.reduce((s, f) => s + f.tokens, 0);
  const result: SweepResult = { agedOut: stale.length, overCap: overCap.length, freedTokens: freed };
  logOp({ projectId, path: null, op: 'sweep', actor: 'gc', taskId: null, tokens: freed, durationMs: Date.now() - t0,
    reason: `aged ${result.agedOut} · over-cap ${result.overCap} · freed ${freed} tok` });
  return result;
}

/** Sweep every project that has context rows (called by the health check). */
export function sweepAllContext(opts: { cap?: number; maxAgeMs?: number } = {}): Record<string, SweepResult> {
  const projects = db().prepare(`SELECT DISTINCT projectId FROM context_files`).all() as any[];
  const out: Record<string, SweepResult> = {};
  for (const p of projects) out[p.projectId] = sweepContext(p.projectId, opts);
  return out;
}

/** Reconcile context against the project's REAL files on disk. Any entry whose path is not
 *  in `livePaths` is dropped — a merge or a manual delete removed the file, so holding it in
 *  memory is pure staleness (its preview 404s, agents burn budget on a ghost). Unlike LRU /
 *  sweep this removes PINNED entries too: a pin on a file that no longer exists is dead.
 *  Each removal logs an `evict` op with reason `deleted on disk`. PURE — the caller passes
 *  the authoritative disk set (git ls-files); this module never touches the filesystem. */
export function reconcileContext(projectId: string, livePaths: Iterable<string>, actor = 'gc'): ContextFile[] {
  const live = livePaths instanceof Set ? livePaths : new Set(livePaths);
  const current = db().prepare(`SELECT * FROM context_files WHERE projectId=?`).all(projectId) as any[];
  const removed: ContextFile[] = [];
  for (const f of current) {
    if (live.has(f.path)) continue;
    const t0 = Date.now();
    db().prepare(`DELETE FROM context_files WHERE projectId=? AND path=?`).run(projectId, f.path);
    logOp({ projectId, path: f.path, op: 'evict', actor, taskId: null, tokens: f.tokens, durationMs: Date.now() - t0, reason: 'deleted on disk' });
    removed.push(f);
  }
  return removed;
}

export interface FileUsage { path: string; uses: number; agents: number; lastUsedAt: string | null; inContext: 0 | 1; tokens: number | null; }

/** Most-used files for a project (Analytics): use-count, distinct-agent count, last used,
 *  and whether the file is still in context. Aggregated from the op log. */
export function getFileUsage(projectId: string, limit = 50): FileUsage[] {
  return db().prepare(
    `SELECT o.path                                            AS path,
            SUM(CASE WHEN o.op IN ('keep','read') THEN 1 ELSE 0 END) AS uses,
            COUNT(DISTINCT CASE WHEN o.op IN ('keep','read') AND o.actor NOT IN ('user','gc') THEN o.actor END) AS agents,
            MAX(o.ts)                                         AS lastUsedAt,
            CASE WHEN cf.path IS NOT NULL THEN 1 ELSE 0 END   AS inContext,
            cf.tokens                                         AS tokens
     FROM context_ops o
     LEFT JOIN context_files cf ON cf.projectId=o.projectId AND cf.path=o.path
     WHERE o.projectId=? AND o.path IS NOT NULL
     GROUP BY o.path
     ORDER BY uses DESC, lastUsedAt DESC
     LIMIT ?`
  ).all(projectId, limit) as any[];
}

/** Recent op-log rows (newest first) — the high-quality timeline the UI renders. */
export function getContextOps(projectId: string, limit = 100): ContextOpRow[] {
  return db().prepare(`SELECT * FROM context_ops WHERE projectId=? ORDER BY id DESC LIMIT ?`)
    .all(projectId, limit) as any[];
}
