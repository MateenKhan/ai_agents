// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — project context memory (logs group, disposable)
//
// The per-project set of files currently held in agents' working context ("what
// is in Claude's memory right now"). Modeled as a CACHE, never an ownership ledger:
//   • auto-added files (agent db:search hits) are LRU cache entries — evicted by
//     staleness / size cap, NEVER by trusting a dying agent to clean up.
//   • user-added files are PINS — never auto-evicted.
// Every mutation writes a high-quality op-log row (op + actor + tokens + durationMs
// + reason) so the UI can show keep / read / evict timings. The logs datastore is
// disposable; context rebuilds as agents run. Schema lives in migrations.ts and is
// routed through the async Store (SQLite default, Postgres opt-in).
// ─────────────────────────────────────────────────────────────────────────────

import type { Store } from './store';
import { getStore, ensureMigrated } from './getStore';

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

/** The active logs-group Store, with schema guaranteed. Context tables live in logs.db
 *  today (disposable), so they share the logs group. */
async function store(): Promise<Store> {
  await ensureMigrated('logs');
  return getStore('logs');
}

const now = () => new Date().toISOString();

async function logOp(s: Store, row: Omit<ContextOpRow, 'id' | 'ts'>): Promise<void> {
  await s.run(
    `INSERT INTO context_ops (projectId, path, op, actor, taskId, tokens, durationMs, reason, ts)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [row.projectId, row.path, row.op, row.actor ?? null, row.taskId ?? null,
     row.tokens ?? null, row.durationMs ?? null, row.reason ?? null, now()]);
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

/** A single file may never occupy more than this share of the budget. Without it, one huge
 *  file is admitted and then either evicts the entire rest of the context to make room, or —
 *  if it is pinned — parks itself over the cap permanently. Env: CONTEXT_MAX_FILE_TOKENS. */
export const MAX_FILE_TOKENS = Math.max(1,
  parseInt(process.env.CONTEXT_MAX_FILE_TOKENS || '', 10) || Math.floor(DEFAULT_CONTEXT_CAP / 2));

/** Put a file INTO context (or refresh an existing entry). Bumps use-count, records a
 *  `keep` op with timing, then enforces the size cap by evicting LRU entries.
 *
 *  A file larger than the per-file ceiling is REJECTED (never inserted) and `file` comes back
 *  null — admitting it would immediately blow the budget. Because of that ceiling, the entry we
 *  just wrote can never be the one enforceCap evicts (it is the most-recently-used and is
 *  smaller than the cap), so reading it back afterwards is safe. */
export async function keepInContext(a: KeepArgs): Promise<{ file: ContextFile | null; evicted: ContextFile[] }> {
  const t0 = Date.now();
  const s = await store();
  const isUser = a.addedBy === 'user';
  const pin = (a.pinned ?? isUser) ? 1 : 0;
  const cap = a.cap ?? DEFAULT_CONTEXT_CAP;
  const ceiling = Math.min(MAX_FILE_TOKENS, cap);
  if (a.tokens > ceiling) {
    await logOp(s, { projectId: a.projectId, path: a.path, op: 'evict', actor: a.addedBy,
      taskId: a.taskId ?? null, tokens: a.tokens, durationMs: Date.now() - t0,
      reason: `rejected: ${a.tokens} tokens exceeds the per-file ceiling (${ceiling})` });
    console.warn(`[context] ${a.projectId}: refused ${a.path} — ${a.tokens} tokens > per-file ceiling ${ceiling}`);
    return { file: null, evicted: [] };
  }
  await s.run(
    `INSERT INTO context_files (projectId, path, tokens, pinned, addedBy, useCount, addedAt, lastUsedAt)
     VALUES (?,?,?,?,?,1,?,?)
     ON CONFLICT(projectId, path) DO UPDATE SET
       tokens=excluded.tokens,
       useCount=context_files.useCount+1,
       lastUsedAt=excluded.lastUsedAt,
       pinned=MAX(context_files.pinned, excluded.pinned)`,
    [a.projectId, a.path, a.tokens, pin, a.addedBy, now(), now()]);
  await logOp(s, { projectId: a.projectId, path: a.path, op: 'keep', actor: a.addedBy,
    taskId: a.taskId ?? null, tokens: a.tokens, durationMs: a.durationMs ?? (Date.now() - t0),
    reason: isUser ? 'user pinned' : 'agent kept' });
  const evicted = await enforceCap(a.projectId, cap);
  // Safe by construction (see doc comment): the row we just kept is the most-recently-used and
  // is under the per-file ceiling, so enforceCap cannot have evicted it. Still read it back
  // rather than asserting — a null here means an invariant broke, not a crash for the caller.
  const file = await getContextFile(a.projectId, a.path);
  return { file, evicted };
}

/** Record that a file already in context was READ again — bumps LRU recency + use-count
 *  and logs a `read` op with the read time. No-op (returns false) if not in context. */
export async function touchContext(projectId: string, path: string, actor: string, taskId?: string | null, durationMs?: number): Promise<boolean> {
  const s = await store();
  const before = ((await s.get(`SELECT COUNT(*) c FROM context_files WHERE projectId=? AND path=?`, [projectId, path]) as any)?.c) ?? 0;
  await s.run(`UPDATE context_files SET useCount=useCount+1, lastUsedAt=? WHERE projectId=? AND path=?`,
    [now(), projectId, path]);
  const hit = Number(before) > 0;
  if (hit) await logOp(s, { projectId, path, op: 'read', actor, taskId: taskId ?? null, tokens: null, durationMs: durationMs ?? null, reason: 'read from memory' });
  return hit;
}

export async function getContextFile(projectId: string, path: string): Promise<ContextFile | null> {
  const s = await store();
  const r = await s.get(`SELECT * FROM context_files WHERE projectId=? AND path=?`, [projectId, path]) as any;
  return r ?? null;
}

/** Current context set — pins first, then most-recently-used. */
export async function listContext(projectId: string): Promise<ContextFile[]> {
  const s = await store();
  return await s.all(`SELECT * FROM context_files WHERE projectId=? ORDER BY pinned DESC, lastUsedAt DESC`,
    [projectId]) as any[];
}

export interface ContextStats { projectId: string; cap: number; totalTokens: number; fileCount: number; pinnedCount: number; pct: number; }

export async function contextStats(projectId: string, cap = DEFAULT_CONTEXT_CAP): Promise<ContextStats> {
  const s = await store();
  const r = await s.get(
    `SELECT COALESCE(SUM(tokens),0) tot, COUNT(*) n, COALESCE(SUM(pinned),0) pins FROM context_files WHERE projectId=?`,
    [projectId]) as any;
  const totalTokens = Number(r?.tot ?? 0);
  return { projectId, cap, totalTokens, fileCount: Number(r?.n ?? 0), pinnedCount: Number(r?.pins ?? 0), pct: cap ? Math.round((totalTokens / cap) * 100) : 0 };
}

/** Remove a file from context. `unpin` op if it was a pin, else `evict`. */
export async function removeFromContext(projectId: string, path: string, actor = 'user', reason = 'removed'): Promise<boolean> {
  const t0 = Date.now();
  const s = await store();
  const existing = await getContextFile(projectId, path);
  if (!existing) return false;
  await s.run(`DELETE FROM context_files WHERE projectId=? AND path=?`, [projectId, path]);
  await logOp(s, { projectId, path, op: existing.pinned ? 'unpin' : 'evict', actor,
    taskId: null, tokens: existing.tokens, durationMs: Date.now() - t0, reason });
  return true;
}

export async function setPinned(projectId: string, path: string, pinned: boolean, actor = 'user'): Promise<boolean> {
  const s = await store();
  const before = ((await s.get(`SELECT COUNT(*) c FROM context_files WHERE projectId=? AND path=?`, [projectId, path]) as any)?.c) ?? 0;
  await s.run(`UPDATE context_files SET pinned=? WHERE projectId=? AND path=?`,
    [pinned ? 1 : 0, projectId, path]);
  const hit = Number(before) > 0;
  if (hit) await logOp(s, { projectId, path, op: pinned ? 'pin' : 'unpin', actor, taskId: null, tokens: null, durationMs: null, reason: pinned ? 'pinned' : 'unpinned' });
  return hit;
}

/**
 * Evict least-recently-used files until total ≤ cap, in two passes:
 *   1. unpinned entries (plain LRU cache entries)
 *   2. SYSTEM auto-pins (addedBy <> 'user') — e.g. the rule files prompts.ts pins on every
 *      dispatch. These were previously exempt, which meant the "cap" was not a bound at all:
 *      auto-pinned files alone could exceed it forever and nothing would ever reclaim them.
 * A USER pin is never evicted — an explicit human decision outranks the budget. If user pins
 * alone still exceed the cap we log loudly rather than silently pretending we are under it.
 *
 * Each eviction is logged with the over-cap reason + timing. Returns evicted rows.
 */
export async function enforceCap(projectId: string, cap = DEFAULT_CONTEXT_CAP): Promise<ContextFile[]> {
  const s = await store();
  const evicted: ContextFile[] = [];
  let { totalTokens } = await contextStats(projectId, cap);
  if (totalTokens <= cap) return evicted;

  const evictRows = async (rows: any[], reason: string) => {
    for (const f of rows) {
      if (totalTokens <= cap) break;
      const t0 = Date.now();
      await s.run(`DELETE FROM context_files WHERE projectId=? AND path=?`, [projectId, f.path]);
      await logOp(s, { projectId, path: f.path, op: 'evict', actor: 'gc', taskId: null, tokens: f.tokens, durationMs: Date.now() - t0, reason });
      totalTokens -= f.tokens;
      evicted.push(f);
    }
  };

  // Pass 1 — plain LRU cache entries.
  await evictRows(
    await s.all(`SELECT * FROM context_files WHERE projectId=? AND pinned=0 ORDER BY lastUsedAt ASC`, [projectId]) as any[],
    `over cap (${cap})`,
  );

  // Pass 2 — system auto-pins (never a user pin). Last resort, so the budget actually holds.
  if (totalTokens > cap) {
    await evictRows(
      await s.all(
        `SELECT * FROM context_files WHERE projectId=? AND pinned=1 AND (addedBy IS NULL OR addedBy <> 'user') ORDER BY lastUsedAt ASC`,
        [projectId]) as any[],
      `over cap (${cap}) — evicting system auto-pin`,
    );
  }

  // Only USER pins remain and they still blow the budget. Never evict those silently.
  if (totalTokens > cap) {
    console.warn(`[context] project ${projectId}: user-pinned files total ${totalTokens} tokens, over the ${cap} cap. Unpin something.`);
  }
  return evicted;
}

export interface SweepResult { agedOut: number; overCap: number; freedTokens: number; }

/** Health-check GC: age out stale unpinned entries, then enforce the cap. This is the
 *  ONLY thing that reclaims orphans left by abruptly-killed agents — it prunes by
 *  staleness/size, never by "is an agent still holding it". */
export async function sweepContext(projectId: string, opts: { cap?: number; maxAgeMs?: number } = {}): Promise<SweepResult> {
  const t0 = Date.now();
  const s = await store();
  const cap = opts.cap ?? DEFAULT_CONTEXT_CAP;
  const maxAgeMs = opts.maxAgeMs ?? 2 * 60 * 60 * 1000; // 2h default TTL for unpinned
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const stale = await s.all(
    `SELECT * FROM context_files WHERE projectId=? AND pinned=0 AND lastUsedAt < ?`,
    [projectId, cutoff]) as any[];
  let freed = 0;
  for (const f of stale) {
    await s.run(`DELETE FROM context_files WHERE projectId=? AND path=?`, [projectId, f.path]);
    await logOp(s, { projectId, path: f.path, op: 'evict', actor: 'gc', taskId: null, tokens: f.tokens, durationMs: null, reason: 'stale (aged out)' });
    freed += f.tokens;
  }
  const overCap = await enforceCap(projectId, cap);
  freed += overCap.reduce((sum, f) => sum + f.tokens, 0);
  const result: SweepResult = { agedOut: stale.length, overCap: overCap.length, freedTokens: freed };
  await logOp(s, { projectId, path: null, op: 'sweep', actor: 'gc', taskId: null, tokens: freed, durationMs: Date.now() - t0,
    reason: `aged ${result.agedOut} · over-cap ${result.overCap} · freed ${freed} tok` });
  return result;
}

/** Sweep every project that has context rows (called by the health check). */
export async function sweepAllContext(opts: { cap?: number; maxAgeMs?: number } = {}): Promise<Record<string, SweepResult>> {
  const s = await store();
  const projects = await s.all(`SELECT DISTINCT projectId FROM context_files`) as any[];
  const out: Record<string, SweepResult> = {};
  for (const p of projects) out[p.projectId] = await sweepContext(p.projectId, opts);
  return out;
}

/** Reconcile context against the project's REAL files on disk. Any entry whose path is not
 *  in `livePaths` is dropped — a merge or a manual delete removed the file, so holding it in
 *  memory is pure staleness (its preview 404s, agents burn budget on a ghost). Unlike LRU /
 *  sweep this removes PINNED entries too: a pin on a file that no longer exists is dead.
 *  Each removal logs an `evict` op with reason `deleted on disk`. The caller passes the
 *  authoritative disk set (git ls-files); this module never touches the filesystem. */
export async function reconcileContext(projectId: string, livePaths: Iterable<string>, actor = 'gc'): Promise<ContextFile[]> {
  const live = livePaths instanceof Set ? livePaths : new Set(livePaths);
  const s = await store();
  const current = await s.all(`SELECT * FROM context_files WHERE projectId=?`, [projectId]) as any[];
  const removed: ContextFile[] = [];
  for (const f of current) {
    if (live.has(f.path)) continue;
    const t0 = Date.now();
    await s.run(`DELETE FROM context_files WHERE projectId=? AND path=?`, [projectId, f.path]);
    await logOp(s, { projectId, path: f.path, op: 'evict', actor, taskId: null, tokens: f.tokens, durationMs: Date.now() - t0, reason: 'deleted on disk' });
    removed.push(f);
  }
  return removed;
}

export interface FileUsage { path: string; uses: number; agents: number; lastUsedAt: string | null; inContext: 0 | 1; tokens: number | null; }

/** Most-used files for a project (Analytics): use-count, distinct-agent count, last used,
 *  and whether the file is still in context. Aggregated from the op log. */
export async function getFileUsage(projectId: string, limit = 50): Promise<FileUsage[]> {
  const s = await store();
  return await s.all(
    `SELECT o.path                                            AS path,
            SUM(CASE WHEN o.op IN ('keep','read') THEN 1 ELSE 0 END) AS uses,
            COUNT(DISTINCT CASE WHEN o.op IN ('keep','read') AND o.actor NOT IN ('user','gc') THEN o.actor END) AS agents,
            MAX(o.ts)                                         AS lastUsedAt,
            CASE WHEN cf.path IS NOT NULL THEN 1 ELSE 0 END   AS inContext,
            cf.tokens                                         AS tokens
     FROM context_ops o
     LEFT JOIN context_files cf ON cf.projectId=o.projectId AND cf.path=o.path
     WHERE o.projectId=? AND o.path IS NOT NULL
     GROUP BY o.path, cf.path, cf.tokens
     ORDER BY uses DESC, lastUsedAt DESC
     LIMIT ?`,
    [projectId, limit]) as any[];
}

/** Recent op-log rows (newest first) — the high-quality timeline the UI renders. */
export async function getContextOps(projectId: string, limit = 100): Promise<ContextOpRow[]> {
  const s = await store();
  return await s.all(`SELECT * FROM context_ops WHERE projectId=? ORDER BY id DESC LIMIT ?`,
    [projectId, limit]) as any[];
}
