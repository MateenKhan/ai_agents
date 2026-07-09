import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Point the runtime config at a throwaway temp DB BEFORE any tasks helper runs,
// so tasks.ts's cached `schemaReady` + connection pool bind to the temp file and
// never touch the real board. buildConfig/setConfig come from the public barrel.
import { buildConfig, setConfig } from '../index';
import {
  gitAuthEnv,
  createProject,
  listProjects,
  addGitToken,
  listGitTokensRaw,
  setTokenAssignment,
  resolveAgentToken,
  deleteProject,
  createTask,
  getTask,
  claimTask,
  acquireLock,
  releaseLock,
  registerWorker,
  heartbeatWorker,
  listStaleWorkers,
  type GitToken,
} from '../db/tasks';

const tempDbPath = join(tmpdir(), `mc-test-${randomBytes(6).toString('hex')}.db`);

beforeAll(() => {
  const cfg = buildConfig();
  cfg.paths.tasksDbPath = tempDbPath;
  setConfig(cfg); // must precede the first db() call in any helper below
});

afterAll(() => {
  // WAL leaves -wal/-shm sidecars; remove all, ignore if absent.
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { unlinkSync(tempDbPath + suffix); } catch { /* ignore */ }
  }
});

// ── gitAuthEnv: pure, no DB ────────────────────────────────────────────────────
describe('gitAuthEnv', () => {
  it('builds GIT_CONFIG_* env with a Basic auth header from user:token', () => {
    const tok = { id: 't1', label: 'l', token: 'sekret', scope: 'readonly', username: 'alice', host: 'github.com', createdAt: '' } as GitToken;
    const env = gitAuthEnv(tok);
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
    const m = env.GIT_CONFIG_VALUE_0.match(/^Authorization: Basic (.+)$/);
    expect(m).not.toBeNull();
    expect(Buffer.from(m![1], 'base64').toString()).toBe('alice:sekret');
  });

  it('honors a custom host', () => {
    const tok = { id: 't', label: 'l', token: 'x', scope: 'readonly', username: 'u', host: 'ghe.corp.io', createdAt: '' } as GitToken;
    expect(gitAuthEnv(tok).GIT_CONFIG_KEY_0).toBe('http.https://ghe.corp.io/.extraheader');
  });

  it('defaults a missing username to x-access-token', () => {
    const tok = { id: 't', label: 'l', token: 'ghp_abc', scope: 'readonly', username: '', host: 'github.com', createdAt: '' } as GitToken;
    const b64 = gitAuthEnv(tok).GIT_CONFIG_VALUE_0.replace('Authorization: Basic ', '');
    expect(Buffer.from(b64, 'base64').toString()).toBe('x-access-token:ghp_abc');
  });

  it('returns {} for a null token or a token with no secret', () => {
    expect(gitAuthEnv(null)).toEqual({});
    expect(gitAuthEnv({ id: 't', label: 'l', token: '', scope: 'readonly', host: 'github.com', createdAt: '' } as GitToken)).toEqual({});
  });
});

// ── project + token scoping (DB-backed against the temp DB) ────────────────────
describe('projects', () => {
  it('createProject returns a proj_ id and listProjects includes it plus default', async () => {
    const p = await createProject({ name: 'Scoped', repoPath: '/tmp/repo' });
    expect(p.id).toMatch(/^proj_/);
    const ids = (await listProjects()).map(x => x.id);
    expect(ids).toContain('default'); // seeded in migrate()
    expect(ids).toContain(p.id);
  });
});

// Git credentials are ACCOUNT-owned, not project-owned: one GitHub account, many projects.
// Scoping them per project made the user re-paste the same token for every project and
// multiplied the places to rotate it. These tests pin the global semantics.
describe('git credentials are global (not project-scoped)', () => {
  it('a token added under one project is visible from every project', async () => {
    const p1 = await createProject({ name: 'P1' });
    const p2 = await createProject({ name: 'P2' });
    const added = await addGitToken({ label: 'ci', token: 'ghp_iso', scope: 'readonly' }, p1.id);
    expect(added.id).toMatch(/^tok_/);

    const inP1 = await listGitTokensRaw(p1.id);
    expect(inP1.map(t => t.id)).toContain(added.id);
    // raw rows carry the plaintext token (internal getter)
    expect(inP1.find(t => t.id === added.id)!.token).toBe('ghp_iso');

    // …and the SAME credential resolves from another project, and with no project at all.
    expect((await listGitTokensRaw(p2.id)).map(t => t.id)).toContain(added.id);
    expect((await listGitTokensRaw()).map(t => t.id)).toContain(added.id);
  });
});

describe('resolveAgentToken', () => {
  it('returns the explicit assignment for an assigned agent, else the "*" default', async () => {
    const p = await createProject({ name: 'Resolve' });
    const devTok = await addGitToken({ label: 'dev', token: 'ghp_dev', scope: 'readwrite' }, p.id);
    const defTok = await addGitToken({ label: 'def', token: 'ghp_def', scope: 'readonly' }, p.id);

    await setTokenAssignment('dev', devTok.id);
    await setTokenAssignment('*', defTok.id);

    expect((await resolveAgentToken('dev'))!.id).toBe(devTok.id);   // explicit
    expect((await resolveAgentToken('qa'))!.id).toBe(defTok.id);    // falls back to '*'
    // assignments are account-wide: the same answer from any project
    expect((await resolveAgentToken('dev', p.id))!.id).toBe(devTok.id);
  });

  it('returns null when neither an assignment nor a "*" default exists', async () => {
    // Assignments are global now, so clear the ones the previous case created — a project id
    // no longer isolates them (that is the point of the change).
    await setTokenAssignment('dev', null);
    await setTokenAssignment('*', null);
    expect(await resolveAgentToken('dev')).toBeNull();
  });
});

describe('deleteProject', () => {
  it('removes the project but PRESERVES account-wide git credentials', async () => {
    const p = await createProject({ name: 'Doomed' });
    const tok = await addGitToken({ label: 'x', token: 'ghp_del', scope: 'readonly' }, p.id);
    expect((await listGitTokensRaw()).map(t => t.id)).toContain(tok.id);

    await deleteProject(p.id);

    // The project is gone; the credential is NOT — deleting one project must never destroy
    // the GitHub access every other project shares.
    expect((await listProjects()).map(x => x.id)).not.toContain(p.id);
    expect((await listGitTokensRaw()).map(t => t.id)).toContain(tok.id);
  });

  it('refuses to delete the default project', async () => {
    await expect(deleteProject('default')).rejects.toThrow();
  });
});

// ── Phase 3 — multi-orchestrator safety (SQLite-correctness of the primitives) ──
describe('claimTask (atomic conditional claim)', () => {
  it('the first claim wins; a second worker cannot re-claim the same task', async () => {
    await createTask({ id: 'clm1', title: 'claimable', status: 'WORKING' });
    expect(await claimTask('clm1', 'hostA:1:agent-1', 60_000)).toBe(true);   // won
    expect(await claimTask('clm1', 'hostB:1:agent-1', 60_000)).toBe(false);  // lost — already claimed
    expect((await getTask('clm1'))!.claimedBy).toBe('hostA:1:agent-1');
  });

  it('lets a lone worker claim an unclaimed task', async () => {
    await createTask({ id: 'clm2', title: 'solo', status: 'WORKING' });
    expect(await claimTask('clm2', 'hostA:1:agent-2', 60_000)).toBe(true);
    const tk = await getTask('clm2');
    expect(tk!.started).toBeTruthy();
    expect(tk!.leaseExpiresAt).toBeTruthy();
  });
});

describe('acquireLock / releaseLock (merge lock)', () => {
  it('is exclusive while held and re-grantable after release', async () => {
    expect(await acquireLock('merge:p1', 'hostA', 60_000)).toBe(true);
    expect(await acquireLock('merge:p1', 'hostB', 60_000)).toBe(false); // held by A
    await releaseLock('merge:p1', 'hostA');
    expect(await acquireLock('merge:p1', 'hostB', 60_000)).toBe(true);  // now free
    await releaseLock('merge:p1', 'hostB');
  });

  it('an expired lock can be taken over by another holder', async () => {
    expect(await acquireLock('merge:p2', 'hostA', -1)).toBe(true);      // acquired already-expired
    expect(await acquireLock('merge:p2', 'hostB', 60_000)).toBe(true);  // takes over the expired lock
    await releaseLock('merge:p2', 'hostB');
  });

  it('grants to exactly ONE of many concurrent contenders (no read-then-write race)', async () => {
    // acquireLock must be a single atomic statement. A SELECT-then-INSERT would let two
    // orchestrator processes on the same .db file both observe "free" and both win —
    // which would let two machines merge at once.
    const contenders = ['w1', 'w2', 'w3', 'w4', 'w5'];
    const results = await Promise.all(contenders.map(w => acquireLock('merge:race', w, 60_000)));
    expect(results.filter(Boolean)).toHaveLength(1);

    // and the winner is the one actually recorded as holder
    const winner = contenders[results.indexOf(true)];
    await releaseLock('merge:race', 'someone-else');            // wrong holder: no-op
    expect(await acquireLock('merge:race', 'other', 60_000)).toBe(false); // still held
    await releaseLock('merge:race', winner);                    // true holder frees it
    expect(await acquireLock('merge:race', 'other', 60_000)).toBe(true);
    await releaseLock('merge:race', 'other');
  });

  it('releaseLock only frees the lock for its true holder', async () => {
    expect(await acquireLock('merge:p3', 'hostA', 60_000)).toBe(true);
    await releaseLock('merge:p3', 'hostB'); // wrong holder → no-op
    expect(await acquireLock('merge:p3', 'hostC', 60_000)).toBe(false); // still held by A
    await releaseLock('merge:p3', 'hostA');
  });
});

describe('workers heartbeat + staleness', () => {
  it('a freshly-registered/heartbeat worker is not stale; a wide window makes it stale', async () => {
    await registerWorker('wkr-1');
    await heartbeatWorker('wkr-1');
    expect((await listStaleWorkers(60_000)).map(w => w.id)).not.toContain('wkr-1'); // beat < 60s ago
    expect((await listStaleWorkers(-1)).map(w => w.id)).toContain('wkr-1');         // cutoff in the future
  });
});
