import { describe, it, expect } from 'vitest';
import { tmpdir } from 'os';
import { unifiedDiff } from '../unifiedDiff';

// unifiedDiff shells out to real `git diff --no-index` (git is on PATH in CI/dev), then rewrites
// the temp-file paths in the header back to the repo-relative `rel`. These tests exercise the real
// git path and assert on the rendered diff — including that the OS temp dir never leaks into it.
describe('unifiedDiff (git diff --no-index wrapper)', () => {
  it('renders a MODIFY with hunk header and a/<rel> b/<rel> header', () => {
    const rel = 'src/config.ts';
    const d = unifiedDiff(rel, 'PORT = 3000\n', 'PORT = 4000\n');
    expect(d).toContain('-PORT = 3000');
    expect(d).toContain('+PORT = 4000');
    expect(d).toMatch(/^@@.*@@/m);
    // Header rewritten to repo-relative path, not a temp path.
    expect(d).toContain(`--- a/${rel}`);
    expect(d).toContain(`+++ b/${rel}`);
    expect(d).toContain(`diff --git a/${rel} b/${rel}`);
    // The OS temp dir string must never survive into the output.
    expect(d).not.toContain(tmpdir());
  });

  it('renders a NEW file (empty old) as an addition', () => {
    const rel = 'src/new-file.ts';
    const d = unifiedDiff(rel, '', 'const a = 1;\nconst b = 2;\n');
    expect(d).toContain('+const a = 1;');
    expect(d).toContain('+const b = 2;');
    // git marks the old side as absent for a new file.
    expect(d).toMatch(/new file|--- a\//);
    expect(d).toContain(`+++ b/${rel}`);
    expect(d).not.toContain(tmpdir());
  });

  it('renders a DELETION (empty new) as a removal', () => {
    const rel = 'src/gone.ts';
    const d = unifiedDiff(rel, 'const a = 1;\nconst b = 2;\n', '');
    expect(d).toContain('-const a = 1;');
    expect(d).toContain('-const b = 2;');
    expect(d).toMatch(/deleted file|\+\+\+ b\//);
    expect(d).toContain(`--- a/${rel}`);
    expect(d).not.toContain(tmpdir());
  });

  it('returns empty string when old === new (git diff exits 0 with no output)', () => {
    const d = unifiedDiff('src/same.ts', 'unchanged\n', 'unchanged\n');
    expect(d).toBe('');
  });

  it('never leaks the OS temp path into the header for any change', () => {
    const rel = 'deep/nested/path/file.ts';
    const d = unifiedDiff(rel, 'a\n', 'b\n');
    expect(d).not.toContain(tmpdir());
    expect(d).toContain(`a/${rel}`);
    expect(d).toContain(`b/${rel}`);
  });
});
