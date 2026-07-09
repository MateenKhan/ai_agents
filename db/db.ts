import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';

// The code index is ONE shared database, not a per-worktree copy. Agents run in git
// worktrees (cwd = <repo>/.worktrees/<id>) where the gitignored local.db does not exist,
// so resolve the index from CODE_INDEX_ROOT (the host repo root, injected into every agent
// process by the runner) rather than the process cwd. Falls back to cwd for normal in-repo use.
const INDEX_ROOT = process.env.CODE_INDEX_ROOT || process.cwd();

export const DB_PATH = join(INDEX_ROOT, 'db', process.env.DB_FILE ?? 'local.db');

/** The sqlite filename that backs a project's code index. The 'default' project
 *  honors the DB_FILE env override (so a spawned `db:build` writes the right file);
 *  every other project indexes into its own `index-<projectId>.db`. */
export function dbFileFor(projectId: string): string {
  return projectId === 'default' ? (process.env.DB_FILE ?? 'local.db') : `index-${projectId}.db`;
}

// One long-lived handle per project index file. 'default' lives here too so getDb()
// and getDbFor('default') share a single connection.
const dbCache = new Map<string, DatabaseSync>();

/** Open (or reuse) the code-index DB for a project, initializing its schema on first open. */
export function getDbFor(projectId: string): DatabaseSync {
  const cached = dbCache.get(projectId);
  if (cached) {
    try { cached.exec('PRAGMA user_version'); return cached; }
    catch { dbCache.delete(projectId); }
  }
  const path = join(INDEX_ROOT, 'db', dbFileFor(projectId));
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 10000');
  initSchema(db);
  dbCache.set(projectId, db);
  return db;
}

/** Drop a project's cached connection so the next getDbFor() reopens fresh (after a rebuild). */
export function resetDbFor(projectId: string): void {
  const c = dbCache.get(projectId);
  try { c?.close(); } catch { /* already gone */ }
  dbCache.delete(projectId);
}

/** Back-compat: the default project's code index (local.db, or DB_FILE if overridden). */
export function getDb(): DatabaseSync {
  return getDbFor('default');
}

/** Drop the cached default connection so the next getDb() reopens the file fresh.
 *  Call this after rebuilding local.db, or the server keeps a handle to the old file. */
export function resetDb(): void {
  resetDbFor('default');
}

export function initSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      path          TEXT UNIQUE NOT NULL,
      language      TEXT,
      hash          TEXT,
      last_modified INTEGER
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL,
      start_line INTEGER,
      end_line   INTEGER,
      signature  TEXT,
      notes      TEXT,
      embedding  BLOB
    );

    CREATE TABLE IF NOT EXISTS edges (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      from_file INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      to_file   INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      edge_type TEXT NOT NULL DEFAULT 'imports',
      UNIQUE(from_file, to_file, edge_type)
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
    CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_file);
    CREATE INDEX IF NOT EXISTS idx_edges_to   ON edges(to_file);

    -- Small key/value store for cached, index-time artifacts (e.g. the LLM-generated
    -- project brief that agents read for free). Survives search; regenerated on build.
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}
