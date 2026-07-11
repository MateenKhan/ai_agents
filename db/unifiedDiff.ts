import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/** A git-style unified diff between two in-memory versions of one repo file. Uses
 *  `git diff --no-index` (real @@ hunks, what <DiffView> renders) via two temp files, then
 *  rewrites the temp paths back to the repo-relative path so the header reads a/<rel> b/<rel>. */
export function unifiedDiff(rel: string, oldContent: string, newContent: string): string {
  const base = join(tmpdir(), `aiedit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const oldP = base + '.old';
  const newP = base + '.new';
  try {
    writeFileSync(oldP, oldContent, 'utf-8');
    writeFileSync(newP, newContent, 'utf-8');
    const r = spawnSync('git', ['diff', '--no-index', '--', oldP, newP], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    let d = r.stdout || '';
    if (!d) return '';
    // git prints the temp paths in the header lines — quoted and backslash-escaped on Windows,
    // so a literal substitution is fragile. Rewrite the three header lines to the repo-relative
    // path instead. No /g flag = only the FIRST match, which is the file header (it precedes any
    // hunk, so a removed content line starting with "--- " can never be hit).
    d = d.replace(/^diff --git .*$/m, `diff --git a/${rel} b/${rel}`)
         .replace(/^--- .*$/m, `--- a/${rel}`)
         .replace(/^\+\+\+ .*$/m, `+++ b/${rel}`);
    return d;
  } catch { return ''; }
  finally {
    try { unlinkSync(oldP); } catch { /* noop */ }
    try { unlinkSync(newP); } catch { /* noop */ }
  }
}
