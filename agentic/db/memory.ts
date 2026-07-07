// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — owned episodic memory (the v1 Memory seam default)
// Stores curated learnings ("we tried X, it broke because Y, fix is Z") in a
// compact table inside tasks.db, so accumulated knowledge travels with the repo.
// Recall is keyword-scored (no vector DB) — simple, owned, zero extra services.
// claude-mem or a vector store can replace this behind the same Memory interface.
// ─────────────────────────────────────────────────────────────────────────────

import type { DatabaseSync } from 'node:sqlite';
import type { Memory } from '../types';
import { getConfig } from '../runtime-context';
import { openDb } from './connection';

let ready = false;

function db(): DatabaseSync {
  const conn = openDb(getConfig().paths.tasksDbPath);
  if (!ready) {
    conn.exec(`CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId TEXT,
      role TEXT,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      at TEXT NOT NULL
    )`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory(kind)`);
    ready = true;
  }
  return conn;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'are', 'was', 'has', 'have', 'not', 'but', 'from', 'into', 'its']);

function keywords(s: string): string[] {
  return Array.from(new Set((s.toLowerCase().match(/[a-z0-9_]{3,}/g) || []).filter(w => !STOP.has(w))));
}

function recall(query: string, limit: number) {
  const words = keywords(query);
  if (!words.length) return [];
  const rows = db().prepare(`SELECT taskId, text, at FROM memory ORDER BY id DESC LIMIT 500`).all() as any[];
  return rows
    .map(r => {
      const hay = String(r.text).toLowerCase();
      const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
      return { text: String(r.text), taskId: r.taskId ?? undefined, at: String(r.at), score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The owned default implementation of the Memory seam. */
export function createOwnedMemory(): Memory {
  return {
    async remember(entry) {
      db().prepare(`INSERT INTO memory (taskId, role, kind, text, at) VALUES (?,?,?,?,?)`)
        .run(entry.taskId ?? null, entry.role ?? null, entry.kind, entry.text, new Date().toISOString());
    },
    async recall(query, limit = 8) {
      return recall(query, limit);
    },
    async primeFor(task) {
      const q = [
        task.title,
        task.description ?? '',
        ...(task.scenarios ?? []).map(s => `${s.given ?? ''} ${s.when ?? ''} ${s.then}`),
      ].join(' ');
      const hits = recall(q, 6);
      if (!hits.length) return '';
      return [
        'MEMORY — learnings from related past work (do not repeat these mistakes):',
        ...hits.map(h => `  - ${h.text}`),
      ].join('\n');
    },
  };
}
