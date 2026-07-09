// ─────────────────────────────────────────────────────────────────────────────
// db/indexPg.ts — SHARED code index on Postgres + pgvector (Design §3, Phase 4)
//
// WHY: the code index (embeddings + import graph) is normally a per-machine SQLite
// file (db/local.db / db/index-<projectId>.db, see db/db.ts). When the datastore
// backend is Postgres (getBackendConfig().kind === 'postgres'), we instead point the
// code index at ONE shared Postgres database so EVERY machine queries the same index
// rather than each rebuilding its own local copy.
//
// The SQLite path is the ZERO-CONFIG DEFAULT and is left completely untouched — this
// module is only reached when codeIndexIsPostgres() is true. builder.ts / query.ts /
// db/server.ts branch to the functions here at their top and otherwise run their
// existing SQLite logic verbatim.
//
// SCOPING: a single shared DB holds every project's index, so the per-project SQLite
// FILE is replaced by a `project_id TEXT` column on every table. All reads/writes are
// scoped `WHERE project_id = $1`.
//
// STATUS: correct-by-construction. There is no local Postgres/pgvector in this
// environment, so this path cannot be exercised end-to-end here (the SQLite default
// is what the test gate verifies). The target Postgres MUST have the `pgvector`
// extension available (`CREATE EXTENSION vector`) — see ensurePgIndexSchema().
// ─────────────────────────────────────────────────────────────────────────────

import { glob } from 'node:fs/promises';
import { join } from 'node:path';
import { getBackendConfig } from './backendConfig.ts';
import { parseFile, parseCssFile, resolveImportPath } from './parser.js';
import { embed, embedQuery } from './embedder.js';
import { openPgStore } from '../agentic/db/pgStore.ts';
import type { Store } from '../agentic/db/store.ts';

// Embedding width. nomic-embed-text is 768-dim (see db/embedder.ts). Overridable via
// EMBED_DIM so a different local model can be dropped in without editing SQL — the
// vector column and any `::vector` casts all read this one value.
const EMBED_DIM = parseInt(process.env.EMBED_DIM ?? '768', 10);

// Same repo-root / glob resolution the SQLite builder uses (db/builder.ts), so the pg
// path indexes exactly the same file set.
const ROOT = process.env.CODE_INDEX_ROOT || process.cwd();

/** True when the code index should live in the shared Postgres DB rather than a local
 *  SQLite file. Reuses the EXISTING backend signal — no separate config. */
export function codeIndexIsPostgres(): boolean {
  return getBackendConfig().kind === 'postgres';
}

/** The active project scope for a shared-index build/query when a caller doesn't pass one. */
export function defaultProjectId(): string {
  return process.env.CODE_INDEX_PROJECT ?? 'default';
}

// ── Shared pg connection (one pool for the whole code index) ────────────────────
let pgStore: Store | null = null;
let schemaReady = false;

/** Lazily open (once) the pg Store for the shared code index and ensure its schema
 *  exists. Reuses agentic/db/pgStore.ts (the same `pg` Pool wrapper the datastore uses)
 *  and getBackendConfig().url (decrypted). Throws if the backend isn't Postgres. */
async function getIndexStore(): Promise<Store> {
  const cfg = getBackendConfig();
  if (cfg.kind !== 'postgres' || !cfg.url) {
    throw new Error('indexPg: pg code index requested but backend is not postgres');
  }
  if (!pgStore) pgStore = openPgStore(cfg.url);
  if (!schemaReady) { await ensurePgIndexSchema(pgStore); schemaReady = true; }
  return pgStore;
}

// ── Schema + migration ──────────────────────────────────────────────────────────
// Mirrors db/db.ts (files / nodes / edges / meta) with two shared-DB adaptations:
//   1. every table carries `project_id TEXT` (multi-project scoping by column, since
//      there is no per-project file), and
//   2. nodes.embedding is a pgvector `vector(EMBED_DIM)` instead of a SQLite BLOB.
// Tables are prefixed `code_` so the code index coexists cleanly with the datastore
// tables (tasks, projects, …) that share this same Postgres database.
export async function ensurePgIndexSchema(store: Store): Promise<void> {
  // pgvector must be installed on the target server for `vector` to be a known type.
  // CREATE EXTENSION IF NOT EXISTS is idempotent but needs the extension available.
  await store.exec('CREATE EXTENSION IF NOT EXISTS vector');

  await store.exec(`
    CREATE TABLE IF NOT EXISTS code_files (
      id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id    TEXT NOT NULL,
      path          TEXT NOT NULL,
      language      TEXT,
      hash          TEXT,
      last_modified BIGINT,
      UNIQUE(project_id, path)
    )
  `);

  await store.exec(`
    CREATE TABLE IF NOT EXISTS code_nodes (
      id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_id    BIGINT NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL,
      start_line INTEGER,
      end_line   INTEGER,
      signature  TEXT,
      notes      TEXT,
      embedding  vector(${EMBED_DIM})
    )
  `);

  await store.exec(`
    CREATE TABLE IF NOT EXISTS code_edges (
      id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id TEXT NOT NULL,
      from_file  BIGINT NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
      to_file    BIGINT NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
      edge_type  TEXT NOT NULL DEFAULT 'imports',
      UNIQUE(project_id, from_file, to_file, edge_type)
    )
  `);

  await store.exec(`
    CREATE TABLE IF NOT EXISTS code_meta (
      project_id TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT,
      PRIMARY KEY(project_id, key)
    )
  `);

  await store.exec('CREATE INDEX IF NOT EXISTS idx_code_nodes_file ON code_nodes(file_id)');
  await store.exec('CREATE INDEX IF NOT EXISTS idx_code_nodes_project ON code_nodes(project_id)');
  await store.exec('CREATE INDEX IF NOT EXISTS idx_code_nodes_name ON code_nodes(name)');
  await store.exec('CREATE INDEX IF NOT EXISTS idx_code_edges_from ON code_edges(from_file)');
  await store.exec('CREATE INDEX IF NOT EXISTS idx_code_edges_to ON code_edges(to_file)');

  // ANN index for cosine similarity (pgvector `<=>` operator = cosine DISTANCE under
  // vector_cosine_ops). ivfflat needs ANALYZE/rows to be effective and is approximate;
  // it is safe to create up-front. lists=100 is a reasonable default for small/medium
  // indexes. (An hnsw index — `USING hnsw (embedding vector_cosine_ops)` — is an
  // alternative on pgvector >= 0.5.0 if higher recall is wanted.)
  await store.exec(
    'CREATE INDEX IF NOT EXISTS idx_code_nodes_embedding ON code_nodes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)',
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Format a Float32Array as a pgvector text literal: '[v1,v2,…]'. Bound as a text
 *  param and cast with `::vector` at the call-site so it never hits the argv limit. */
function toVectorLiteral(vec: Float32Array): string {
  return '[' + Array.from(vec).join(',') + ']';
}

// ── Build / write path ──────────────────────────────────────────────────────────
// Mirrors db/builder.ts but async, against pg, scoped by project_id. Reached only
// from builder.ts's buildFull/buildIncremental when codeIndexIsPostgres() is true.

/** Full rebuild of one project's slice of the shared index: wipe its rows, re-parse,
 *  re-embed. Other projects' rows are untouched (everything is project_id-scoped). */
export async function buildFullPg(projectId = defaultProjectId()): Promise<void> {
  const store = await getIndexStore();
  // Delete order respects FK cascade, but be explicit and project-scoped.
  await store.run('DELETE FROM code_edges WHERE project_id = ?', [projectId]);
  await store.run('DELETE FROM code_nodes WHERE project_id = ?', [projectId]);
  await store.run('DELETE FROM code_files WHERE project_id = ?', [projectId]);
  await indexFilesPg(store, projectId, true);
}

/** Incremental update: only re-parse files whose content hash changed. */
export async function buildIncrementalPg(projectId = defaultProjectId()): Promise<void> {
  const store = await getIndexStore();
  await indexFilesPg(store, projectId, false);
}

async function indexFilesPg(store: Store, projectId: string, full: boolean): Promise<void> {
  // Same glob as db/builder.ts::indexFiles.
  const fileIter = glob('src/**/*.{ts,tsx,js,jsx,css}', {
    cwd: ROOT,
    exclude: (f) => f.includes('node_modules') || f.includes('dist'),
  });
  const files: string[] = [];
  for await (const f of fileIter) files.push(join(ROOT, f));
  console.log(`Found ${files.length} files (pg index, project ${projectId})`);

  let parsed = 0;
  for (const absPath of files) {
    const result = absPath.endsWith('.css') ? parseCssFile(absPath, ROOT) : parseFile(absPath, ROOT);
    if (!result) continue;

    const existing = await store.get<{ id: number; hash: string }>(
      'SELECT id, hash FROM code_files WHERE project_id = ? AND path = ?',
      [projectId, result.path],
    );
    if (!full && existing?.hash === result.hash) continue;

    // Upsert the file row (INSERT … ON CONFLICT on (project_id, path)).
    await store.run(
      `INSERT INTO code_files (project_id, path, language, hash, last_modified)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (project_id, path)
       DO UPDATE SET language = EXCLUDED.language, hash = EXCLUDED.hash, last_modified = EXCLUDED.last_modified`,
      [projectId, result.path, result.language, result.hash, result.lastModified],
    );
    const row = await store.get<{ id: number }>(
      'SELECT id FROM code_files WHERE project_id = ? AND path = ?',
      [projectId, result.path],
    );
    if (!row) continue;

    // Replace this file's nodes + outgoing edges (cascade handled by FK, but scope explicitly).
    await store.run('DELETE FROM code_nodes WHERE file_id = ?', [row.id]);
    await store.run('DELETE FROM code_edges WHERE from_file = ?', [row.id]);
    for (const n of result.nodes) {
      await store.run(
        `INSERT INTO code_nodes (project_id, file_id, name, type, start_line, end_line, signature)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [projectId, row.id, n.name, n.type, n.startLine, n.endLine, n.signature],
      );
    }

    parsed++;
    if (parsed % 20 === 0) process.stdout.write(`\rParsed ${parsed} files`);
  }
  console.log(`\rParsed ${parsed} files. Resolving edges...`);

  await resolveEdgesPg(store, projectId);
  await generateEmbeddingsPg(store, projectId);
}

async function resolveEdgesPg(store: Store, projectId: string): Promise<void> {
  const allFiles = await store.all<{ id: number; path: string }>(
    'SELECT id, path FROM code_files WHERE project_id = ?',
    [projectId],
  );
  const pathMap = new Map<string, number>();
  for (const f of allFiles) {
    pathMap.set(f.path, f.id);
    pathMap.set(f.path.replace(/\.(tsx?|jsx?)$/, ''), f.id);
  }

  for (const file of allFiles) {
    const absPath = join(ROOT, file.path);
    const result = absPath.endsWith('.css') ? parseCssFile(absPath, ROOT) : parseFile(absPath, ROOT);
    if (!result) continue;

    const fromDir = file.path.split('/').slice(0, -1).join('/');
    for (const imp of result.imports) {
      const resolved = resolveImportPath(fromDir, imp);
      const toId = pathMap.get(resolved) ?? pathMap.get(resolved.replace(/\.(tsx?|jsx?)$/, ''));
      if (toId && toId !== file.id) {
        await store.run(
          `INSERT INTO code_edges (project_id, from_file, to_file, edge_type)
           VALUES (?, ?, ?, 'imports')
           ON CONFLICT (project_id, from_file, to_file, edge_type) DO NOTHING`,
          [projectId, file.id, toId],
        );
      }
    }
  }
  console.log('Edges resolved.');
}

async function generateEmbeddingsPg(store: Store, projectId: string): Promise<void> {
  const pending = await store.all<{ id: number; name: string; type: string; signature: string; notes: string | null; path: string }>(
    `SELECT n.id, n.name, n.type, n.signature, n.notes, f.path
     FROM code_nodes n JOIN code_files f ON n.file_id = f.id
     WHERE n.project_id = ? AND n.embedding IS NULL`,
    [projectId],
  );
  if (!pending.length) { console.log('Embeddings up to date.'); return; }

  console.log(`Embedding ${pending.length} nodes...`);
  let done = 0;
  for (const node of pending) {
    const text = `${node.type} ${node.name} in ${node.path}: ${node.signature}. ${node.notes ?? ''}`;
    const vec = await embed(text);
    if (vec) {
      // Bind the vector as a text literal and cast with ::vector (mirrors the SQLite
      // BLOB write in builder.ts, but pgvector-native).
      await store.run('UPDATE code_nodes SET embedding = ?::vector WHERE id = ?', [toVectorLiteral(vec), node.id]);
    }
    done++;
    if (done % 5 === 0 || done === pending.length) {
      process.stdout.write(`\rEmbedded ${done}/${pending.length} nodes...`);
    }
  }
  process.stdout.write('\n');
}

// ── Search path ─────────────────────────────────────────────────────────────────
// Result rows use the SAME shape the SQLite semanticSearch returns
// ({ score, name, type, path, line, signature }) so callers are backend-agnostic.

type SearchHit = { score: number; name: string; type: string; path: string; line: number; signature: string };

/** Semantic search over the shared index. Runs the ANN query in Postgres:
 *    ORDER BY embedding <=> $query::vector   (pgvector `<=>` = cosine DISTANCE)
 *  and returns score = 1 - distance (so 1.0 = identical, matching cosine similarity).
 *  Falls back to keyword search when the local embedder is unavailable — same policy
 *  as the SQLite path. */
export async function pgSemanticSearch(queryText: string, topK = 10, projectId = defaultProjectId()): Promise<SearchHit[]> {
  const vec = await embedQuery(queryText);
  if (!vec) return pgKeywordSearch(queryText, topK, projectId);

  const store = await getIndexStore();
  const rows = await store.all<{ name: string; type: string; start_line: number; signature: string; path: string; distance: number }>(
    `SELECT n.name, n.type, n.start_line, n.signature, f.path,
            (n.embedding <=> ?::vector) AS distance
     FROM code_nodes n JOIN code_files f ON n.file_id = f.id
     WHERE n.project_id = ? AND n.embedding IS NOT NULL
     ORDER BY n.embedding <=> ?::vector
     LIMIT ?`,
    [toVectorLiteral(vec), projectId, toVectorLiteral(vec), topK],
  );
  return rows.map(r => ({
    score: +(1 - Number(r.distance)).toFixed(4),
    name: r.name, type: r.type, path: r.path, line: r.start_line, signature: r.signature,
  }));
}

/** Keyword fallback (local embedding unavailable) — mirrors the SQLite fallback in
 *  db/query.ts / db/server.ts, project_id-scoped. */
export async function pgKeywordSearch(queryText: string, topK = 10, projectId = defaultProjectId()): Promise<SearchHit[]> {
  const store = await getIndexStore();
  const words = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return [];
  const scoreExpr = words.map(() =>
    `((LOWER(n.name) LIKE ? OR LOWER(n.notes) LIKE ? OR LOWER(n.signature) LIKE ? OR LOWER(f.path) LIKE ?)::int)`
  ).join(' + ');
  const scoreParams = words.flatMap(w => [`%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`]);
  const rows = await store.all<{ name: string; type: string; start_line: number; signature: string; path: string; score: number }>(
    `SELECT n.name, n.type, n.start_line, n.signature, f.path, (${scoreExpr}) AS score
     FROM code_nodes n JOIN code_files f ON n.file_id = f.id
     WHERE n.project_id = ? AND (${scoreExpr}) > 0
     ORDER BY score DESC
     LIMIT ?`,
    // params order: score-expr (SELECT) · project_id · score-expr (WHERE) · topK
    [...scoreParams, projectId, ...scoreParams, topK],
  );
  console.log('(keyword fallback — local embedding error)');
  return rows.map(r => ({ score: Number(r.score), name: r.name, type: r.type, path: r.path, line: r.start_line, signature: r.signature }));
}

// ── Graph queries ───────────────────────────────────────────────────────────────
// project_id-scoped SQL on code_edges, mirroring db/query.ts blastRadius/callers/deps.

/** Reverse-reachability: every file that (transitively, up to `hops`) imports `filePath`. */
export async function pgBlastRadius(filePath: string, hops = 3, projectId = defaultProjectId()): Promise<string[]> {
  const store = await getIndexStore();
  const start = await store.get<{ id: number }>(
    'SELECT id FROM code_files WHERE project_id = ? AND path LIKE ?',
    [projectId, `%${filePath}%`],
  );
  if (!start) return [];

  const visited = new Set<number>([start.id]);
  let frontier = [start.id];
  for (let h = 0; h < hops && frontier.length; h++) {
    const next: number[] = [];
    for (const id of frontier) {
      const parents = await store.all<{ from_file: number }>(
        'SELECT from_file FROM code_edges WHERE project_id = ? AND to_file = ?',
        [projectId, id],
      );
      for (const { from_file } of parents) {
        if (!visited.has(from_file)) { visited.add(from_file); next.push(from_file); }
      }
    }
    frontier = next;
  }

  visited.delete(start.id);
  const ids = [...visited];
  if (!ids.length) return [];
  // Build an IN-list of placeholders (ids are internal integers, not user input).
  const placeholders = ids.map(() => '?').join(',');
  const rows = await store.all<{ path: string }>(
    `SELECT path FROM code_files WHERE project_id = ? AND id IN (${placeholders})`,
    [projectId, ...ids],
  );
  return rows.map(r => r.path);
}

/** Direct callers: files that import `filePath`. */
export async function pgCallers(filePath: string, projectId = defaultProjectId()): Promise<string[]> {
  const store = await getIndexStore();
  const row = await store.get<{ id: number }>(
    'SELECT id FROM code_files WHERE project_id = ? AND path LIKE ?',
    [projectId, `%${filePath}%`],
  );
  if (!row) return [];
  const rows = await store.all<{ path: string }>(
    `SELECT f.path FROM code_edges e JOIN code_files f ON e.from_file = f.id
     WHERE e.project_id = ? AND e.to_file = ?`,
    [projectId, row.id],
  );
  return rows.map(r => r.path);
}

/** Direct dependencies: files that `filePath` imports. */
export async function pgDependencies(filePath: string, projectId = defaultProjectId()): Promise<string[]> {
  const store = await getIndexStore();
  const row = await store.get<{ id: number }>(
    'SELECT id FROM code_files WHERE project_id = ? AND path LIKE ?',
    [projectId, `%${filePath}%`],
  );
  if (!row) return [];
  const rows = await store.all<{ path: string }>(
    `SELECT f.path FROM code_edges e JOIN code_files f ON e.to_file = f.id
     WHERE e.project_id = ? AND e.from_file = ?`,
    [projectId, row.id],
  );
  return rows.map(r => r.path);
}
