// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — project file listing (disk truth)
//
// The authoritative "what files exist in this project right now" set. Shared by the
// /files API (explorer tree) and merge-time context reconcile so BOTH see the same
// disk truth — otherwise the tree and the in-memory context could disagree.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Heavy/generated dirs the fs-walk fallback never descends into.
const SKIP = new Set(['node_modules', '.git', 'dist', '.worktrees', '.agent_logs', '.vite', '.ignored', 'coverage', '.next']);

/** Repo-relative, sorted file list for a project root. Prefers `git ls-files` (respects
 *  .gitignore, fast); falls back to a bounded fs walk (caps at 5000 files, skips the heavy
 *  dirs above) when the root isn't a git repo. Returns `[]` on any failure — callers treat
 *  an empty set as "unknown", never as "everything was deleted". */
export function listRepoFiles(root: string): string[] {
  const r = spawnSync('git', ['-C', root, 'ls-files'], { encoding: 'utf-8', timeout: 8000, maxBuffer: 32 * 1024 * 1024 });
  let files = (r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (files.length === 0) {
    const out: string[] = [];
    const walk = (dir: string, rel: string) => {
      if (out.length >= 5000) return;
      let entries: any[] = [];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (out.length >= 5000) return;
        if (e.name.startsWith('.') && e.name !== '.env.example') { if (SKIP.has(e.name)) continue; }
        if (SKIP.has(e.name)) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(dir, e.name), childRel);
        else out.push(childRel);
      }
    };
    walk(root, '');
    files = out;
  }
  return files.sort();
}
