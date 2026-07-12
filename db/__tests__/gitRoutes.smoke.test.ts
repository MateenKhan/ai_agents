/**
 * /git/* routes smoke test — proves the two load-bearing claims of the P0.5 wave-1 move:
 *   1. importing db/server.ts no longer binds the port at import time (the old
 *      module-scope `server.listen` made endpoint tests impossible), and
 *   2. the /git/* endpoints answer through the new router exactly as before.
 * Exercises read-only endpoints only (status / branches / log) against a throwaway
 * temp repo, so no board DB or network is touched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { appRouter, server as dbServer } from '../server.js';

let repo: string;
let srv: Server;
let base: string;

describe('/git/* routes (smoke, read-only)', () => {
  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), 'piranha-git-smoke-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-b', 'main');
    git('config', 'user.email', 'smoke@test.local');
    git('config', 'user.name', 'Smoke Test');
    writeFileSync(join(repo, 'hello.txt'), 'hello\n');
    git('add', '-A');
    git('commit', '-m', 'initial commit');

    await new Promise<void>(resolve => {
      srv = createServer(async (req, res) => {
        const handled = await appRouter.handle(req as any, res as any);
        if (!handled) { res.statusCode = 404; res.end(JSON.stringify({ error: 'unmatched' })); }
      });
      // ephemeral port picked by the OS — NOT the db-server's own bind
      srv.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${(srv.address() as any).port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>(r => (srv ? srv.close(() => r()) : r()));
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* Windows file locks */ }
  });

  it('importing db/server.ts does NOT bind the db-server port', () => {
    // the defect this wave fixed: `server.listen` ran at import time
    expect(dbServer.listening).toBe(false);
  });

  it('GET /git/status reports a clean repo on main', async () => {
    const r = await fetch(`${base}/git/status?repo=${encodeURIComponent(repo)}`);
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.ok).toBe(true);
    expect(j.branch).toBe('main');
    expect(j.clean).toBe(true);
    expect(j.files).toEqual([]);
    expect(j.repo).toBe(repo);
  });

  it('GET /git/branches lists main as the current branch', async () => {
    const r = await fetch(`${base}/git/branches?repo=${encodeURIComponent(repo)}`);
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.ok).toBe(true);
    expect(j.current).toBe('main');
    expect(j.branches).toContain('main');
    expect(j.local).toContain('main');
  });

  it('GET /git/log returns the initial commit with author metadata', async () => {
    const r = await fetch(`${base}/git/log?repo=${encodeURIComponent(repo)}&limit=10`);
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.ok).toBe(true);
    expect(j.commits).toHaveLength(1);
    expect(j.commits[0].subject).toBe('initial commit');
    expect(j.commits[0].author).toBe('Smoke Test');
    expect(j.commits[0].merge).toBe(false);
    expect(j.commits[0].hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('unmatched non-git paths still fall through to the legacy server routes', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(404); // this harness has no legacy routes; handle() returned false
  });
});
