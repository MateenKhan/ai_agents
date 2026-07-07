import { glob } from 'node:fs/promises';
import { join } from 'path';
import { getDb, initSchema } from './db.js';
import { parseFile, parseCssFile, resolveImportPath } from './parser.js';
import { embed, toBuffer } from './embedder.js';
import type { DatabaseSync } from 'node:sqlite';

// Which repo to index. Defaults to the host repo (cwd), but the db-server sets
// CODE_INDEX_ROOT to the user's ACTIVE repo (e.g. a cloned repo) so the embedding
// DB reflects the codebase actually being worked on — not ai-agents itself.
const ROOT = process.env.CODE_INDEX_ROOT || process.cwd();
const GLOB = process.env.CODE_INDEX_GLOB || '**/*.{ts,tsx,js,jsx,mjs,cjs,css}';
const EXCLUDE_DIRS = ['node_modules', 'dist', '.git', '.worktrees', 'build', '.next', 'coverage', 'out', '.cache'];

export async function buildFull() {
  const db = getDb();
  initSchema(db);
  db.exec('DELETE FROM edges; DELETE FROM nodes; DELETE FROM files;');
  await indexFiles(db, true);
}

export async function buildIncremental() {
  const db = getDb();
  initSchema(db);
  await indexFiles(db, false);
}

async function indexFiles(db: DatabaseSync, full: boolean) {
  const fileIter = glob('src/**/*.{ts,tsx,js,jsx,css}', { cwd: ROOT, exclude: (f) => f.includes('node_modules') || f.includes('dist') });
  const files: string[] = [];
  for await (const f of fileIter) files.push(join(ROOT, f));
  console.log(`Found ${files.length} files`);

  const upsertFile  = db.prepare(`INSERT OR REPLACE INTO files (path, language, hash, last_modified) VALUES (?, ?, ?, ?)`);
  const getFile     = db.prepare(`SELECT id, hash FROM files WHERE path = ?`);
  const insertNode  = db.prepare(`INSERT INTO nodes (file_id, name, type, start_line, end_line, signature) VALUES (?, ?, ?, ?, ?, ?)`);
  const deleteNodes = db.prepare(`DELETE FROM nodes WHERE file_id = ?`);
  const deleteEdges = db.prepare(`DELETE FROM edges WHERE from_file = ?`);

  let parsed = 0;
  for (const absPath of files) {
    const result = absPath.endsWith('.css') ? parseCssFile(absPath, ROOT) : parseFile(absPath, ROOT);
    if (!result) continue;

    const existing = getFile.get(result.path) as { id: number; hash: string } | undefined;
    if (!full && existing?.hash === result.hash) continue;

    upsertFile.run(result.path, result.language, result.hash, result.lastModified);
    const row = getFile.get(result.path) as { id: number };
    deleteNodes.run(row.id);
    deleteEdges.run(row.id);
    for (const n of result.nodes) {
      insertNode.run(row.id, n.name, n.type, n.startLine, n.endLine, n.signature);
    }

    parsed++;
    if (parsed % 20 === 0) process.stdout.write(`\rParsed ${parsed} files`);
  }
  console.log(`\rParsed ${parsed} files. Resolving edges...`);

  await resolveEdges(db);
  await generateEmbeddings(db);
}

async function resolveEdges(db: DatabaseSync) {
  const allFiles = db.prepare('SELECT id, path FROM files').all() as { id: number; path: string }[];
  const pathMap  = new Map<string, number>();

  for (const f of allFiles) {
    pathMap.set(f.path, f.id);
    pathMap.set(f.path.replace(/\.(tsx?|jsx?)$/, ''), f.id);
  }

  const insertEdge = db.prepare(`INSERT OR IGNORE INTO edges (from_file, to_file, edge_type) VALUES (?, ?, 'imports')`);

  for (const file of allFiles) {
    const absPath = join(ROOT, file.path);
    const result  = absPath.endsWith('.css') ? parseCssFile(absPath, ROOT) : parseFile(absPath, ROOT);
    if (!result) continue;

    const fromDir = file.path.split('/').slice(0, -1).join('/');
    for (const imp of result.imports) {
      const resolved = resolveImportPath(fromDir, imp);
      const toId = pathMap.get(resolved) ?? pathMap.get(resolved.replace(/\.(tsx?|jsx?)$/, ''));
      if (toId && toId !== file.id) insertEdge.run(file.id, toId);
    }
  }
  console.log('Edges resolved.');
}

async function generateEmbeddings(db: DatabaseSync) {
  const pending = db.prepare(`
    SELECT n.id, n.name, n.type, n.signature, n.notes, f.path
    FROM nodes n JOIN files f ON n.file_id = f.id
    WHERE n.embedding IS NULL
  `).all() as { id: number; name: string; type: string; signature: string; notes: string | null; path: string }[];

  if (!pending.length) { console.log('Embeddings up to date.'); return; }

  const update = db.prepare('UPDATE nodes SET embedding = ? WHERE id = ?');
  console.log(`Embedding ${pending.length} nodes...`);

  let done = 0;
  for (const node of pending) {
    const text = `${node.type} ${node.name} in ${node.path}: ${node.signature}. ${node.notes ?? ''}`;
    const vec  = await embed(text);
    if (vec) {
      update.run(toBuffer(vec), node.id);
    }
    done++;
    if (done % 5 === 0 || done === pending.length) {
      process.stdout.write(`\rEmbedded ${done}/${pending.length} nodes...`);
    }
  }
  process.stdout.write('\n');
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
