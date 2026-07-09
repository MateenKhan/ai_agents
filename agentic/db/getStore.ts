// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — active datastore selection (Phase 1b seam)
// One place the async db layer asks "which Store do I write to?". Default is
// SQLite (two files: tasks.db + logs.db) with ZERO config — Postgres is OPTIONAL
// and only ever used when the host explicitly calls configureBackend({kind:'postgres'}).
// agentic-core stays standalone: it does NOT import db/backendConfig.ts; the host
// (db-server) reads that at boot and pushes the choice in here via configureBackend().
// ─────────────────────────────────────────────────────────────────────────────
import type { Store } from './store';
import { openSqliteStore } from './sqliteStore';
import { openPgStore } from './pgStore';
import { runMigrations, type DbGroup } from './migrations';
import { getConfig } from '../runtime-context';

// Owned by migrations.ts (it holds the table→group map); re-exported for existing importers.
export type { DbGroup };
interface Backend { kind: 'sqlite' | 'postgres'; url?: string }

// Default: SQLite, no config. Never Postgres unless the host opts in.
let backend: Backend = { kind: 'sqlite' };
const cache = new Map<string, Store>();

/** Host (db-server) pushes the chosen backend at boot. Clears cached stores AND the
 *  migration flags, so the next getStore()/ensureMigrated() opens and migrates the new
 *  target — otherwise repointing at a different Postgres URL would reuse the 'pg' flag
 *  and skip creating its tables. Postgres is opt-in ONLY. */
export function configureBackend(b: Backend): void {
  backend = b?.kind === 'postgres' && b.url ? { kind: 'postgres', url: b.url } : { kind: 'sqlite' };
  cache.clear();
  migrated.clear();
  inFlight.clear();
}

/** True when the live datastore is Postgres (a single shared database). */
export function isPostgres(): boolean { return backend.kind === 'postgres'; }

/** The Store for a table group. SQLite routes tasks vs logs to their own files;
 *  Postgres puts every table in ONE database, so both groups share one Store. */
export function getStore(group: DbGroup): Store {
  const key = backend.kind === 'postgres' ? 'pg' : group;
  let s = cache.get(key);
  if (!s) {
    if (backend.kind === 'postgres') {
      s = openPgStore(backend.url!);
    } else {
      const path = group === 'logs' ? getConfig().paths.logsDbPath : getConfig().paths.tasksDbPath;
      s = openSqliteStore(path);
    }
    cache.set(key, s);
  }
  return s;
}

// Run schema migrations at most once per distinct Store (per group for sqlite, once
// for the shared pg database). Callers await ensureMigrated() before first use.
// `inFlight` de-dupes concurrent callers: without it two racing callers both start
// runMigrations against the same store (harmless — every step is idempotent — but it
// doubles the DDL and, on Postgres, can have two sessions issue the same DDL at once).
const migrated = new Set<string>();
const inFlight = new Map<string, Promise<void>>();

export async function ensureMigrated(group: DbGroup): Promise<void> {
  const key = backend.kind === 'postgres' ? 'pg' : group;
  if (migrated.has(key)) return;
  let p = inFlight.get(key);
  if (!p) {
    // Pass the group so SQLite creates ONLY this file's tables (Postgres = one DB, gets all).
    p = runMigrations(getStore(group), group)
      .then(() => { migrated.add(key); })
      .finally(() => { inFlight.delete(key); });
    inFlight.set(key, p);
  }
  await p; // a failed migration rejects every waiter and is retried on the next call
}

/** Test/reset hook — drop cached stores + migration flags (used by tests). */
export function _resetStores(): void { cache.clear(); migrated.clear(); inFlight.clear(); }
