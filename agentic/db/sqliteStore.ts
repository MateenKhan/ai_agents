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

  /** Transactions run one at a time on this handle. See `tx` for why. */
  private txChain: Promise<unknown> = Promise.resolve();
  /** >0 while a transaction is open on this handle, so a nested `tx` joins it. */
  private txDepth = 0;

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

  /**
   * Run `fn` inside a transaction, serialised against every other transaction on this handle.
   *
   * The serialisation is the whole point, and it used to be missing. `fn` is async, so it
   * yields at every `await`. With a plain BEGIN/COMMIT on a shared connection, a second `tx()`
   * could start while the first was still open: its BEGIN landed *inside* the first
   * transaction, and if it then threw, its ROLLBACK discarded the first transaction's work too.
   * "SQLite has one writer" is true of separate processes; it says nothing about two
   * interleaved async calls in one process.
   *
   * Postgres never had this problem, because pgStore checks out a dedicated client per
   * transaction. Here there is one handle, so transactions queue on `txChain` instead.
   *
   * A nested `tx()` joins the open transaction rather than starting a second one — the same
   * rule pgStore follows, and it keeps a helper that opens its own transaction usable from
   * inside a larger one.
   */
  async tx<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    if (this.txDepth > 0) return fn(this);

    const run = async (): Promise<T> => {
      this.txDepth++;
      this.conn.exec('BEGIN');
      try {
        const result = await fn(this);
        this.conn.exec('COMMIT');
        return result;
      } catch (e) {
        try { this.conn.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      } finally {
        this.txDepth--;
      }
    };

    // Queue behind whatever is already running, whether it settled ok or threw.
    const result = this.txChain.then(run, run);
    this.txChain = result.then(() => undefined, () => undefined);
    return result;
  }
}

/** Open (or reuse) a WAL SQLite connection at `path` and wrap it as a Store. */
export function openSqliteStore(path: string): SqliteStore {
  return new SqliteStore(openDb(path));
}
