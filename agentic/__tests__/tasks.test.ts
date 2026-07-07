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
  it('createProject returns a proj_ id and listProjects includes it plus default', () => {
    const p = createProject({ name: 'Scoped', repoPath: '/tmp/repo' });
    expect(p.id).toMatch(/^proj_/);
    const ids = listProjects().map(x => x.id);
    expect(ids).toContain('default'); // seeded in migrate()
    expect(ids).toContain(p.id);
  });
});

describe('git token project isolation', () => {
  it('lists a token only under its own project', () => {
    const p1 = createProject({ name: 'P1' });
    const p2 = createProject({ name: 'P2' });
    const added = addGitToken({ label: 'ci', token: 'ghp_iso', scope: 'readonly' }, p1.id);
    expect(added.id).toMatch(/^tok_/);

    const inP1 = listGitTokensRaw(p1.id);
    expect(inP1.map(t => t.id)).toContain(added.id);
    // raw rows carry the plaintext token (internal getter)
    expect(inP1.find(t => t.id === added.id)!.token).toBe('ghp_iso');

    expect(listGitTokensRaw(p2.id).map(t => t.id)).not.toContain(added.id);
  });
});

describe('resolveAgentToken', () => {
  it('returns the explicit assignment for an assigned agent, else the "*" default', () => {
    const p = createProject({ name: 'Resolve' });
    const devTok = addGitToken({ label: 'dev', token: 'ghp_dev', scope: 'readwrite' }, p.id);
    const defTok = addGitToken({ label: 'def', token: 'ghp_def', scope: 'readonly' }, p.id);

    setTokenAssignment('dev', devTok.id, p.id);
    setTokenAssignment('*', defTok.id, p.id);

    expect(resolveAgentToken('dev', p.id)!.id).toBe(devTok.id);   // explicit
    expect(resolveAgentToken('qa', p.id)!.id).toBe(defTok.id);    // falls back to '*'
  });

  it('returns null when neither an assignment nor a "*" default exists', () => {
    const p = createProject({ name: 'NoTokens' });
    expect(resolveAgentToken('dev', p.id)).toBeNull();
  });
});

describe('deleteProject', () => {
  it('removes the project and its tokens', () => {
    const p = createProject({ name: 'Doomed' });
    addGitToken({ label: 'x', token: 'ghp_del', scope: 'readonly' }, p.id);
    expect(listGitTokensRaw(p.id).length).toBeGreaterThan(0);

    deleteProject(p.id);

    expect(listGitTokensRaw(p.id)).toEqual([]);
    expect(listProjects().map(x => x.id)).not.toContain(p.id);
  });

  it('refuses to delete the default project', () => {
    expect(() => deleteProject('default')).toThrow();
  });
});
