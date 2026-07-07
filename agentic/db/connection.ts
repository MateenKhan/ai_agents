// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — SQLite connection pool
// One long-lived WAL handle per database file (tasks.db, logs.db). WAL lets the
// server and orchestrator processes read/write concurrently; each process keeps
// its own handle. Never close these mid-run — they are reused for the session.
// ─────────────────────────────────────────────────────────────────────────────

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const pool = new Map<string, DatabaseSync>();

/** Open (or reuse) a WAL-mode connection at `path`. Creates the parent dir. */
export function openDb(path: string): DatabaseSync {
  const existing = pool.get(path);
  if (existing) {
    try { existing.exec('PRAGMA user_version'); return existing; }
    catch { pool.delete(path); }
  }
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* dir exists */ }
  const db = new DatabaseSync(path);
  // busy_timeout FIRST — so the journal_mode/migration writes below WAIT for a lock
  // instead of failing instantly ("database is locked") when the db-server and
  // orchestrator both open this file at boot.
  db.exec('PRAGMA busy_timeout = 15000');
  // WAL by default — correct for the two processes sharing this file concurrently on a
  // normal filesystem. Override to DELETE (SQLITE_JOURNAL_MODE=DELETE) only if the FS
  // mishandles WAL's shared-memory sidecar (some cloud-synced / network / virtual mounts).
  const journal = (process.env.SQLITE_JOURNAL_MODE || 'WAL').toUpperCase();
  db.exec(`PRAGMA journal_mode = ${journal}`);
  db.exec(`PRAGMA synchronous = ${journal === 'WAL' ? 'NORMAL' : 'FULL'}`);
  db.exec('PRAGMA foreign_keys = ON');
  pool.set(path, db);
  return db;
}

/** Run steps that may fail if already applied (idempotent migrations). */
export function tryEach(steps: Array<() => void>): void {
  for (const step of steps) {
    try { step(); } catch { /* already applied */ }
  }
}
