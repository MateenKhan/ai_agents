// ─────────────────────────────────────────────────────────────────────────────
// Migration idempotency (gap 30).
//
// The schema is "safe to re-run on every boot" — every table is CREATE TABLE IF
// NOT EXISTS, every index CREATE INDEX IF NOT EXISTS, and every additive ALTER is
// wrapped so an "already exists" error is swallowed. This test proves that promise
// by running the FULL migration path twice against a fresh throwaway DB and asserting
//   1. the second run does not throw, and
//   2. the tasks table gains no duplicate columns (a re-applied ALTER would).
//
// ISOLATION: this opens its OWN SQLite store on a randomly-named temp file and drives
// `runMigrations` (the path initTasksSchema / ensureMigrated('tasks') call under the
// hood) directly against it. It never touches the process config's tasksDbPath /
// logsDbPath, so the real local.db / logs.db are never opened, migrated, or written.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { openSqliteStore } from '../sqliteStore';
import { runMigrations } from '../migrations';
import type { Store } from '../store';

// A throwaway DB file, never the real one. Named uniquely so parallel runs don't collide.
const dbPath = join(tmpdir(), `mc-migidem-${randomBytes(6).toString('hex')}.db`);
let store: Store;

beforeAll(() => { store = openSqliteStore(dbPath); });

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { unlinkSync(dbPath + suffix); } catch { /* ignore */ }
  }
});

/** The declared column names of the `tasks` table, in schema order (SQLite). */
const taskColumns = async (): Promise<string[]> =>
  (await store.all<{ name: string }>(`PRAGMA table_info(tasks)`)).map(r => r.name);

describe('schema migration is idempotent (gap 30)', () => {
  it('running the full migration twice does not throw', async () => {
    await runMigrations(store, 'tasks');                       // first boot
    await expect(runMigrations(store, 'tasks')).resolves.toBeUndefined(); // second boot: no-op
  });

  it('the tasks table has NO duplicate columns after a second run', async () => {
    await runMigrations(store, 'tasks');
    await runMigrations(store, 'tasks');

    const cols = await taskColumns();
    // A re-applied additive ALTER (not wrapped in tryStep) would add a second `plan`, `journal`, …
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const c of cols) { if (seen.has(c)) dupes.push(c); seen.add(c); }
    expect(dupes).toEqual([]);
    // Unique-count === length is the same invariant, stated the other way round.
    expect(new Set(cols).size).toBe(cols.length);
  });

  it('a representative additive column is present EXACTLY once', async () => {
    await runMigrations(store, 'tasks');
    await runMigrations(store, 'tasks');

    const cols = await taskColumns();
    // `plan` and `journal` are additive columns (added by ALTER on old DBs, created up-front on
    // fresh ones). Either path must yield exactly one, never two.
    expect(cols.filter(c => c === 'plan')).toEqual(['plan']);
    expect(cols.filter(c => c === 'journal')).toEqual(['journal']);
  });
});
