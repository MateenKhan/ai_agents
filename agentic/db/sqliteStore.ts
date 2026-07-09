// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — SQLite adapter for the Store abstraction
// Wraps node:sqlite's `DatabaseSync` (synchronous under the hood) behind the async
// Store surface. Reuses openDb() so it inherits the SAME WAL + busy_timeout +
// foreign_keys semantics as the live connection pool — a Store opened on a path
// shares the one long-lived handle for that file (never opens a second handle).
//
// NOTE: node:sqlite is synchronous, so every method returns an already-resolved
// promise. This keeps SQLite behaviour bit-for-bit identical to today while giving
// call-sites the async signature they need to also work over Postgres.
// ─────────────────────────────────────────────────────────────────────────────

import type { DatabaseSync } from 'node:sqlite';
import { openDb } from './connection';
import type { Store } from './store';

export class SqliteStore implements Store {
  readonly dialect = 'sqlite' as const;

  constructor(private readonly conn: DatabaseSync) {}

  /** The raw handle — for the few sqlite-only paths (PRAGMA quick_check, VACUUM). */
  get connection(): DatabaseSync { return this.conn; }

  async exec(sql: string): Promise<void> {
    this.conn.exec(sql);
  }

  async run(sql: string, params: any[] = []): Promise<void> {
    this.conn.prepare(sql).run(...params);
  }

  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const row = this.conn.prepare(sql).get(...params) as T | undefined;
    return row ?? null;
  }

  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return this.conn.prepare(sql).all(...params) as T[];
  }

  /** SQLite has one writer, so a plain BEGIN/COMMIT is enough. The same handle is
   *  reused inside `fn` (node:sqlite has no separate transaction object). */
  async tx<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    this.conn.exec('BEGIN');
    try {
      const result = await fn(this);
      this.conn.exec('COMMIT');
      return result;
    } catch (e) {
      try { this.conn.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    }
  }
}

/** Open (or reuse) a WAL SQLite connection at `path` and wrap it as a Store. */
export function openSqliteStore(path: string): SqliteStore {
  return new SqliteStore(openDb(path));
}
