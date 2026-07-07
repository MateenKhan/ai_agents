import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { isGitRepo } from '../engine/runner';

// Detect git availability once so the suite skips gracefully on a git-less host
// rather than reporting a false failure (git should normally be present).
let gitAvailable = true;
try { execSync('git --version', { stdio: 'pipe' }); } catch { gitAvailable = false; }

const dirs: string[] = [];
function makeTempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'mc-gitrepo-'));
  dirs.push(d);
  return d;
}

beforeAll(() => { /* nothing global to set up */ });

afterAll(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('isGitRepo', () => {
  it('returns false for a fresh, non-git temp directory', () => {
    const dir = makeTempDir();
    expect(isGitRepo(dir)).toBe(false);
  });

  it.runIf(gitAvailable)('returns true for a directory after git init', () => {
    const dir = makeTempDir();
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    expect(isGitRepo(dir)).toBe(true);
  });
});
