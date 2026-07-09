import { getDb, getDbFor, initSchema } from './db.js';
import { embedQuery, fromBuffer, cosine } from './embedder.js';
import {
  codeIndexIsPostgres, pgSemanticSearch, pgBlastRadius, pgCallers, pgDependencies,
} from './indexPg.js';

type FileRow = { id: number; path: string }
type NodeRow = { id: number; name: string; type: string; start_line: number; signature: string; path: string; embedding: Buffer | null }

// node:sqlite returns Record<string,SQLOutputValue>[] — cast via unknown
const cast = <T>(v: unknown): T => v as T;

export async function semanticSearch(queryText: string, topK = 10, projectId: string = 'default') {
  // Shared-index path: when the datastore is Postgres, query the ONE pgvector index
  // (cosine ANN in SQL) instead of loading a per-machine SQLite file's embeddings and
  // scoring in JS. SQLite default (below) is unchanged.
  if (codeIndexIsPostgres()) return pgSemanticSearch(queryText, topK, projectId);

  const db  = getDbFor(projectId);
  const vec = await embedQuery(queryText);

  if (!vec) {
    // Keyword fallback: match query words against name, notes, signature, path
    const words = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    // Score = number of words that match per row
    const scoreExpr = words.map(() =>
      `((LOWER(n.name) LIKE ? OR LOWER(n.notes) LIKE ? OR LOWER(n.signature) LIKE ? OR LOWER(f.path) LIKE ?) * 1)`
    ).join(' + ');
    const scoreParams = words.flatMap(w => [`%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`]);
    const rows = cast<(NodeRow & { notes: string | null; score: number })[]>(db.prepare(`
      SELECT n.id, n.name, n.type, n.start_line, n.signature, n.notes, f.path,
             (${scoreExpr}) as score
      FROM nodes n JOIN files f ON n.file_id = f.id
      WHERE (${scoreExpr}) > 0
      ORDER BY score DESC
      LIMIT ?
    `).all(...scoreParams, ...scoreParams, topK));
    console.log('(keyword fallback — local embedding error)');
    return rows.map(r => ({ score: r.score, name: r.name, type: r.type, path: r.path, line: r.start_line, signature: r.signature }));
  }

  const rows = cast<NodeRow[]>(db.prepare(`
    SELECT n.id, n.name, n.type, n.start_line, n.signature, n.embedding, f.path
    FROM nodes n JOIN files f ON n.file_id = f.id
    WHERE n.embedding IS NOT NULL
  `).all());

  const scored = rows
    .map(r => ({ score: cosine(vec, fromBuffer(r.embedding!)), ...r }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map(r => ({ score: +r.score.toFixed(4), name: r.name, type: r.type, path: r.path, line: r.start_line, signature: r.signature }));
}

export async function blastRadius(filePath: string, hops = 3, projectId: string = 'default'): Promise<string[]> {
  if (codeIndexIsPostgres()) return pgBlastRadius(filePath, hops, projectId);
  const db    = getDb();
  const start = cast<FileRow | undefined>(db.prepare('SELECT id FROM files WHERE path LIKE ?').get(`%${filePath}%`));
  if (!start) { return []; }

  const visited = new Set<number>([start.id]);
  const queue   = [start.id];

  for (let h = 0; h < hops && queue.length; h++) {
    const current = [...queue];
    queue.length  = 0;
    for (const id of current) {
      const parents = cast<{ from_file: number }[]>(db.prepare('SELECT from_file FROM edges WHERE to_file = ?').all(id));
      for (const { from_file } of parents) {
        if (!visited.has(from_file)) { visited.add(from_file); queue.push(from_file); }
      }
    }
  }

  visited.delete(start.id);
  const ids = [...visited];
  if (!ids.length) { return []; }
  const paths = cast<{ path: string }[]>(db.prepare(`SELECT path FROM files WHERE id IN (${ids.join(',')})`).all());
  return paths.map(p => p.path);
}

export async function callers(filePath: string, projectId: string = 'default'): Promise<string[]> {
  if (codeIndexIsPostgres()) return pgCallers(filePath, projectId);
  const db  = getDb();
  const row = cast<FileRow | undefined>(db.prepare('SELECT id FROM files WHERE path LIKE ?').get(`%${filePath}%`));
  if (!row) { return []; }
  const rows = cast<{ path: string }[]>(
    db.prepare(`SELECT f.path FROM edges e JOIN files f ON e.from_file = f.id WHERE e.to_file = ?`).all(row.id)
  );
  return rows.map(r => r.path);
}

export async function dependencies(filePath: string, projectId: string = 'default'): Promise<string[]> {
  if (codeIndexIsPostgres()) return pgDependencies(filePath, projectId);
  const db  = getDb();
  const row = cast<FileRow | undefined>(db.prepare('SELECT id FROM files WHERE path LIKE ?').get(`%${filePath}%`));
  if (!row) { return []; }
  const rows = cast<{ path: string }[]>(
    db.prepare(`SELECT f.path FROM edges e JOIN files f ON e.to_file = f.id WHERE e.from_file = ?`).all(row.id)
  );
  return rows.map(r => r.path);
}

export function annotate(filePath: string, notes: string) {
  const db  = getDb();
  const row = cast<FileRow | undefined>(db.prepare('SELECT id FROM files WHERE path LIKE ?').get(`%${filePath}%`));
  if (!row) { console.error('File not found:', filePath); return; }
  db.prepare('UPDATE nodes SET notes = ? WHERE file_id = ?').run(notes, row.id);
  console.log(`Annotated nodes in ${filePath}`);
}

export function stats() {
  const db = getDb();
  initSchema(db);
  const g  = (sql: string) => cast<{ c: number }>(db.prepare(sql).get()).c;
  const files    = g('SELECT COUNT(*) as c FROM files');
  const nodes    = g('SELECT COUNT(*) as c FROM nodes');
  const edges    = g('SELECT COUNT(*) as c FROM edges');
  const embedded = g('SELECT COUNT(*) as c FROM nodes WHERE embedding IS NOT NULL');
  return { files, nodes, edges, embedded, embeddingCoverage: nodes ? `${Math.round(embedded / nodes * 100)}%` : '0%' };
}
