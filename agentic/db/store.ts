// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — datastore abstraction (Phase 1 foundation)
// A minimal async query surface the rest of the code can target so the live
// datastore can be SQLite (default, today) OR Postgres (multi-machine). This file
// is the INTERFACE + the portable-SQL helpers only; the concrete adapters live in
// sqliteStore.ts (node:sqlite) and pgStore.ts (pg Pool).
//
// SCOPE: this is the foundation. The existing synchronous db functions in
// tasks.ts / logs.ts / agents.ts / memory.ts are NOT yet routed through a Store —
// converting those call-sites to async is Phase 1b. SQLite stays the live path.
// ─────────────────────────────────────────────────────────────────────────────

/** The dialect-agnostic query surface every backend implements. All methods are
 *  async so the same code works over `pg` (real async) and node:sqlite (sync under
 *  the hood, returns already-resolved promises). SQL is written with `?`
 *  placeholders everywhere; the Postgres adapter rewrites `?`→`$1..$n` via `toPg`. */
export interface Store {
  /** 'sqlite' or 'postgres' — lets call-sites branch on the rare non-portable bit. */
  dialect: 'sqlite' | 'postgres';
  /** Run DDL / multi-statement SQL with no params (CREATE TABLE, PRAGMA, etc). */
  exec(sql: string): Promise<void>;
  /** Run a parameterised write (INSERT/UPDATE/DELETE). No rows returned. */
  run(sql: string, params?: any[]): Promise<void>;
  /** One row, or null when the query matches nothing. */
  get<T = any>(sql: string, params?: any[]): Promise<T | null>;
  /** All matching rows. */
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  /** Run `fn` inside a transaction; commit on resolve, rollback on throw. The Store
   *  handed to `fn` is scoped to the transaction (a pooled client for pg). */
  tx<T>(fn: (s: Store) => Promise<T>): Promise<T>;
}

// ── Portable SQL helpers ──────────────────────────────────────────────────────

/**
 * Rewrite SQLite-style `?` placeholders to Postgres `$1..$n`.
 *
 * The scanner skips `?` characters that appear inside single-quoted string
 * literals (so `WHERE note = 'why?'` is left alone) and treats the SQL-standard
 * doubled-quote escape (`''`) as a literal quote. Everything else that is a bare
 * `?` becomes the next positional parameter. `pg` uses 1-based `$n`.
 */
export function toPg(sql: string): string {
  let out = '';
  let n = 0;
  let inStr = false; // inside a '...' single-quoted string literal
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      out += ch;
      if (ch === "'") {
        // Doubled '' is an escaped quote — stay in the string.
        if (sql[i + 1] === "'") { out += "'"; i++; }
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") { inStr = true; out += ch; continue; }
    if (ch === '?') { out += '$' + (++n); continue; }
    out += ch;
  }
  return out;
}

/** Result of `buildUpsert` — the portable SQL + the ordered params. Exported so the
 *  generated SQL can be unit-tested without a live database. */
export interface UpsertSql { sql: string; params: any[]; }

/**
 * Build a dialect-correct UPSERT for `row` keyed on `conflictCols`.
 *
 * Why a helper and not raw SQL: `INSERT OR REPLACE` (SQLite) cannot be blindly
 * rewritten to Postgres, so the upsert is the ONE portable write path.
 *   - sqlite   → `INSERT OR REPLACE INTO t (cols) VALUES (?,…)`
 *   - postgres → `INSERT INTO t (cols) VALUES (?,…) ON CONFLICT (keys) DO UPDATE
 *                 SET col = EXCLUDED.col, …` (or `DO NOTHING` when every column is
 *                 part of the conflict key).
 *
 * Placeholders stay as `?`; the pg adapter's `run` rewrites them via `toPg`.
 */
export function buildUpsert(
  dialect: 'sqlite' | 'postgres',
  table: string,
  row: Record<string, any>,
  conflictCols: string[],
): UpsertSql {
  const cols = Object.keys(row);
  if (cols.length === 0) throw new Error('upsert: row has no columns');
  const params = cols.map(c => row[c]);
  const placeholders = cols.map(() => '?').join(', ');
  const colList = cols.join(', ');

  if (dialect === 'sqlite') {
    return { sql: `INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${placeholders})`, params };
  }

  // Postgres: update every non-key column from the would-be inserted row.
  const keys = new Set(conflictCols);
  const updates = cols.filter(c => !keys.has(c));
  const conflict = conflictCols.join(', ');
  const doClause = updates.length
    ? `DO UPDATE SET ${updates.map(c => `${c} = EXCLUDED.${c}`).join(', ')}`
    : 'DO NOTHING';
  return {
    sql: `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT (${conflict}) ${doClause}`,
    params,
  };
}

/** Execute a dialect-correct UPSERT against `store`. See `buildUpsert`. */
export async function upsert(
  store: Store,
  table: string,
  row: Record<string, any>,
  conflictCols: string[],
): Promise<void> {
  const { sql, params } = buildUpsert(store.dialect, table, row, conflictCols);
  await store.run(sql, params);
}
