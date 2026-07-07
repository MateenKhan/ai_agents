import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFile, resolveImportPath } from '../parser';

let rootDir: string;
let absPath: string;

const SOURCE = `import { helper } from './helper';

export function alpha(a: number): number {
  return a + 1;
}

export const beta = (x: string) => x.toUpperCase();

export class Gamma {
  run() { return 42; }
}
`;

beforeAll(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'mc-parser-'));
  absPath = join(rootDir, 'sample.ts');
  writeFileSync(absPath, SOURCE, 'utf-8');
});

afterAll(() => {
  try { unlinkSync(absPath); } catch { /* ignore */ }
  try { rmSync(rootDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('parseFile', () => {
  it('returns the expected file-level metadata', () => {
    const parsed = parseFile(absPath, rootDir);
    expect(parsed).not.toBeNull();
    expect(parsed!.language).toBe('typescript');
    // 32-char md5 hex
    expect(parsed!.hash).toMatch(/^[0-9a-f]{32}$/);
    // relPath is absPath minus rootDir, backslashes normalized, leading slash stripped
    expect(parsed!.path).toBe('sample.ts');
    expect(typeof parsed!.lastModified).toBe('number');
  });

  it('extracts declared node names', () => {
    const parsed = parseFile(absPath, rootDir)!;
    const names = parsed.nodes.map(n => n.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names).toContain('Gamma');
  });

  it('classifies node types (function / class)', () => {
    const parsed = parseFile(absPath, rootDir)!;
    const byName = Object.fromEntries(parsed.nodes.map(n => [n.name, n.type]));
    expect(byName['alpha']).toBe('function');
    expect(byName['beta']).toBe('function');
    expect(byName['Gamma']).toBe('class');
  });

  it('collects relative imports', () => {
    const parsed = parseFile(absPath, rootDir)!;
    expect(parsed.imports).toContain('./helper');
  });

  it('returns null for a non-existent file', () => {
    expect(parseFile(join(rootDir, 'does-not-exist.ts'), rootDir)).toBeNull();
  });
});

describe('resolveImportPath', () => {
  it('resolves a "./x" relative import against a dir', () => {
    expect(resolveImportPath('src/components', './Button')).toBe('src/components/Button');
  });

  it('resolves "../x" by walking up one level', () => {
    expect(resolveImportPath('src/components', '../lib/util')).toBe('src/lib/util');
  });

  it('collapses redundant "./" segments', () => {
    expect(resolveImportPath('a/b', './c/./d')).toBe('a/b/c/d');
  });
});
