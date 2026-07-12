// ─────────────────────────────────────────────────────────────────────────────
// File-API security regression tests (security-audit-2026-07 §1a, §1b, §1c, §6a).
//
// Two layers:
//   1. confineRepoPath / isDeniedFile — the pure confinement the /file verbs share:
//      host-repo refusal, realpath symlink/traversal rejection, sensitive-file denylist.
//   2. HTTP — the unauthenticated /api/fs/* family (incl. the spawnSync RCE /api/fs/run)
//      is deleted (→ 404), and GET /file for the host repo does not leak the master key.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confineRepoPath, isDeniedFile, server } from '../server.js';

const temps: string[] = [];
function makeRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'piranha-file-sec-'));
  temps.push(d);
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'src', 'a.ts'), 'export const a = 1;\n');
  return d;
}

afterAll(() => {
  for (const d of temps) { try { rmSync(d, { recursive: true, force: true }); } catch { /* win locks */ } }
});

describe('isDeniedFile — sensitive files blocked regardless of project', () => {
  it('denies the master key, env files, and any SQLite DB (+ WAL/SHM)', () => {
    for (const p of ['.secret.key', 'db/.secret.key', '.env', '.env.local', 'config/.env.production',
                     'db/tasks.db', 'x.db-wal', 'y.db-shm', 'a/b/local.db']) {
      expect(isDeniedFile(p)).toBe(true);
    }
  });
  it('allows ordinary source files', () => {
    for (const p of ['src/a.ts', 'README.md', 'package.json', 'env.example', 'notes.dbx']) {
      expect(isDeniedFile(p)).toBe(false);
    }
  });
});

describe('confineRepoPath — realpath confinement + host-repo refusal', () => {
  it('refuses the host repo (default project → process.cwd()) for ANY path', () => {
    const c = confineRepoPath(process.cwd(), 'src/a.ts');
    expect('error' in c && c.status).toBe(403);
    // …including the AES master key — the §1b default-project leak.
    const k = confineRepoPath(process.cwd(), 'db/.secret.key');
    expect('error' in k && k.status).toBe(403);
  });

  it('rejects traversal and absolute-path escapes', () => {
    const root = makeRepo();
    for (const rel of ['../outside.txt', 'src/../../escape', '..']) {
      const c = confineRepoPath(root, rel);
      expect('error' in c && c.status).toBe(400);
    }
    const abs = confineRepoPath(root, join(root, '..', 'evil.txt')); // absolute
    expect('error' in abs && abs.status).toBe(400);
  });

  it('rejects the sensitive-file denylist inside a user repo (403)', () => {
    const root = makeRepo();
    for (const rel of ['.secret.key', '.env', 'db/local.db']) {
      const c = confineRepoPath(root, rel);
      expect('error' in c && c.status).toBe(403);
    }
  });

  it('accepts an in-repo file and returns its resolved absolute path', () => {
    const root = makeRepo();
    const c = confineRepoPath(root, 'src/a.ts');
    expect('abs' in c).toBe(true);
    if ('abs' in c) expect(c.abs.endsWith('a.ts')).toBe(true);
    // a not-yet-created file whose parent is in-repo is allowed (the create path)
    const create = confineRepoPath(root, 'src/new.ts');
    expect('abs' in create).toBe(true);
  });

  it('follows symlinks and rejects one that escapes the repo (realpath, not string-prefix)', () => {
    const root = makeRepo();
    const outsideDir = mkdtempSync(join(tmpdir(), 'piranha-outside-'));
    temps.push(outsideDir);
    const secret = join(outsideDir, 'secret.txt');
    writeFileSync(secret, 'TOP SECRET\n');
    let linked = false;
    try { symlinkSync(secret, join(root, 'link'), 'file'); linked = true; }
    catch { /* no symlink privilege (Windows without dev mode) — skip the assertion */ }
    if (linked) {
      const c = confineRepoPath(root, 'link');
      expect('error' in c && c.status).toBe(400); // resolved target is outside root
    }
  });
});

describe('HTTP — /api/fs/* removed, host /file does not leak the master key', () => {
  let base: string;
  beforeAll(async () => {
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${(server.address() as any).port}`;
        resolve();
      });
    });
  });
  afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

  it('POST /api/fs/run (the spawnSync RCE) is gone → 404', async () => {
    const r = await fetch(`${base}/api/fs/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo pwned' }),
    });
    expect(r.status).toBe(404);
    const j: any = await r.json();
    expect(j.stdout).toBeUndefined(); // never executed
  });

  it('the read/write/list/delete/rename FS twins are all gone → 404', async () => {
    const cases: Array<[string, string]> = [
      ['GET', '/api/fs/read?path=db/.secret.key'],
      ['GET', '/api/fs/list'],
      ['POST', '/api/fs/write'],
      ['PUT', '/api/fs/rename'],
      ['DELETE', '/api/fs/delete?path=x'],
    ];
    for (const [method, path] of cases) {
      const r = await fetch(`${base}${path}`, { method });
      expect(r.status).toBe(404);
    }
  });

  it('GET /file?path=db/.secret.key&project=default refuses (host repo) and returns no key', async () => {
    const r = await fetch(`${base}/file?path=${encodeURIComponent('db/.secret.key')}&project=default`);
    expect(r.status).not.toBe(200);
    const text = await r.text();
    // whatever the body, it must not carry file content of the key
    expect(text).not.toMatch(/BEGIN|-----|[A-Fa-f0-9]{64}/);
  });
});
