// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — owned episodic memory (the v1 Memory seam default)
// Stores curated learnings ("we tried X, it broke because Y, fix is Z") in a
// compact table inside tasks.db, so accumulated knowledge travels with the repo.
// Recall is keyword-scored (no vector DB) — simple, owned, zero extra services.
// claude-mem or a vector store can replace this behind the same Memory interface.
// ─────────────────────────────────────────────────────────────────────────────

import type { Memory } from '../types';
import type { Store } from './store';
import { getStore, ensureMigrated } from './getStore';

/** The active tasks-group Store (memory lives in tasks.db), with schema guaranteed. */
async function store(): Promise<Store> {
  await ensureMigrated('tasks');
  return getStore('tasks');
}

const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'are', 'was', 'has', 'have', 'not', 'but', 'from', 'into', 'its']);

function keywords(s: string): string[] {
  return Array.from(new Set((s.toLowerCase().match(/[a-z0-9_]{3,}/g) || []).filter(w => !STOP.has(w))));
}

async function recall(query: string, limit: number) {
  const words = keywords(query);
  if (!words.length) return [];
  const s = await store();
  const rows = await s.all(`SELECT taskId, text, at FROM memory ORDER BY id DESC LIMIT 500`) as any[];
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
      const s = await store();
      await s.run(`INSERT INTO memory (taskId, role, kind, text, at) VALUES (?,?,?,?,?)`,
        [entry.taskId ?? null, entry.role ?? null, entry.kind, entry.text, new Date().toISOString()]);
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
      const hits = await recall(q, 6);
      if (!hits.length) return '';
      return [
        'MEMORY — learnings from related past work (do not repeat these mistakes):',
        ...hits.map(h => `  - ${h.text}`),
      ].join('\n');
    },
  };
}
