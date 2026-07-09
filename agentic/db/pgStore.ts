// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — Postgres adapter for the Store abstraction
// Wraps a `pg` connection Pool behind the async Store surface. This is the real
// async path (unlike sqliteStore, which is sync-under-async). Placeholders are
// written as `?` at the call-site and rewritten to `$1..$n` here via toPg().
//
// STATUS: correct-by-construction. There is no local Postgres to test against in
// this environment, so this adapter is verified by construction + the shared
// toPg()/buildUpsert() unit tests — it needs a real Postgres instance to exercise
// end-to-end (see POST /backend/migrate in db/server.ts, which opens one of these
// and runs runMigrations against it to "create tables").
// ─────────────────────────────────────────────────────────────────────────────

import { Pool, types, type PoolClient, type PoolConfig } from 'pg';
import type { Store } from './store';
import { toPg } from './store';
import { ALL_COLUMN_NAMES } from './migrations';

// node-pg returns int8/BIGINT as a STRING (it refuses to silently lose precision past
// 2^53). SQLite hands back numbers, and the callers rely on that: `COUNT(*) c` is compared
// with `count === 0`, and the BIGINT IDENTITY `id` columns (agent_logs, agent_db_usage,
// memory) are used as numbers. Parse int8 as a number so both dialects agree. Our counts
// and surrogate ids are far below 2^53, so no precision is at risk.
types.setTypeParser(20 /* int8 */, (v: string) => parseInt(v, 10));

// ── Identifier-case reconciliation (Postgres only) ────────────────────────────
// Columns are created + queried UNQUOTED, so Postgres folds them to lower-case
// (`claimedBy` → `claimedby`). The SQL is self-consistent, but pg returns row objects
// keyed by the folded name, while every row→object mapper reads camelCase. Map the
// keys back to their canonical spelling on the way out. Keys we don't recognise (SQL
// aliases like `distance`, snake_case code-index columns) are passed through untouched.
const CANONICAL_BY_LOWER: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const name of ALL_COLUMN_NAMES) {
    const lower = name.toLowerCase();
    // Only remap where folding actually changes the name; ignore ambiguous collisions.
    if (lower !== name && !m.has(lower)) m.set(lower, name);
  }
  return m;
})();

function normalizeRow<T>(row: any): T {
  if (!row || typeof row !== 'object') return row as T;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const canonical = CANONICAL_BY_LOWER.get(key);
    if (canonical && canonical !== key) { out[canonical] = row[key]; changed = true; }
    else out[key] = row[key];
  }
  return (changed ? out : row) as T;
}

export class PgStore implements Store {
  readonly dialect = 'postgres' as const;

  // `client` is set only for a transaction-scoped Store — all its queries run on the
  // one pinned connection between BEGIN and COMMIT/ROLLBACK. Otherwise queries go to
  // the pool (which checks out + returns a connection per query).
  constructor(private readonly pool: Pool, private readonly client?: PoolClient) {}

  /** The pooled connection for a tx, else the pool itself (both expose .query). */
  private q(): Pool | PoolClient {
    return this.client ?? this.pool;
  }

  async exec(sql: string): Promise<void> {
    // exec is DDL / no-param SQL — not placeholder-rewritten. Postgres accepts
    // multiple `;`-separated statements in a simple-query call.
    await this.q().query(sql);
  }

  async run(sql: string, params: any[] = []): Promise<void> {
    await this.q().query(toPg(sql), params);
  }

  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const r = await this.q().query(toPg(sql), params);
    return r.rows[0] === undefined ? null : normalizeRow<T>(r.rows[0]);
  }

  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const r = await this.q().query(toPg(sql), params);
    return r.rows.map(row => normalizeRow<T>(row));
  }

  /** Check out ONE pooled client, run BEGIN → fn → COMMIT (ROLLBACK on throw), then
   *  release it back to the pool. The Store passed to `fn` is pinned to that client
   *  so every statement inside the callback is part of the same transaction. */
  async tx<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    // A nested tx (already inside a client) reuses the same connection — no BEGIN
    // nesting (Postgres would warn); the outer tx owns commit/rollback.
    if (this.client) return fn(this);

    const client = await this.pool.connect();
    const scoped = new PgStore(this.pool, client);
    try {
      await client.query('BEGIN');
      const result = await fn(scoped);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be broken */ }
      throw e;
    } finally {
      client.release();
    }
  }

  /** Close the pool. Call when a short-lived Store (e.g. the migrate endpoint) is done. */
  async end(): Promise<void> {
    await this.pool.end();
  }
}

/** Open a PgStore against a `postgres://…` connection string (or a full PoolConfig).
 *  The url typically comes from getBackendConfig() (decrypted) or is passed directly
 *  by the POST /backend/migrate endpoint. */
export function openPgStore(url: string, extra?: Omit<PoolConfig, 'connectionString'>): PgStore {
  return new PgStore(new Pool({ connectionString: url, ...extra }));
}
