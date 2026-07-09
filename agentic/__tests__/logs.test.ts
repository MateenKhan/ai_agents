import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Point logs.db at a throwaway temp file BEFORE the first logs helper runs.
import { buildConfig, setConfig } from '../index';
import { addAgentLog, getRecentLogs, clearAgentLogs, purgeTaskLogs } from '../db/logs';

const tempDbPath = join(tmpdir(), `mc-logs-${randomBytes(6).toString('hex')}.db`);

beforeAll(() => {
  const cfg = buildConfig();
  cfg.paths.logsDbPath = tempDbPath;
  setConfig(cfg); // must precede the first db() call below
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { unlinkSync(tempDbPath + suffix); } catch { /* ignore */ }
  }
});

describe('getRecentLogs', () => {
  it('returns rows newest-first with the { ts, taskId, msg, type } event shape', async () => {
    // Insert in a known order; id is autoincrement so ordering is deterministic
    // regardless of timestamp collisions.
    await addAgentLog('task-a', 'first', 'info');
    await addAgentLog('task-a', 'second', 'success');
    await addAgentLog('task-b', 'third', 'warning');
    await addAgentLog('task-b', 'fourth', 'error');

    const rows = await getRecentLogs(10);
    expect(rows.length).toBe(4);

    // Newest-first: the last inserted comes back first.
    expect(rows.map(r => r.msg)).toEqual(['fourth', 'third', 'second', 'first']);

    const newest = rows[0];
    expect(newest.taskId).toBe('task-b');
    expect(newest.msg).toBe('fourth');
    expect(newest.type).toBe('error');
    expect(typeof newest.ts).toBe('string');
    expect(newest.ts.length).toBeGreaterThan(0);
    // The event contract: raw `message`/`timestamp` columns are renamed, `id` is surfaced
    // (the feed's dismiss action needs it) and `projectId` carries the scope.
    expect(Object.keys(newest).sort()).toEqual(['id', 'msg', 'projectId', 'taskId', 'ts', 'type']);
  });

  it('respects the limit, returning the N most-recent rows newest-first', async () => {
    for (let i = 0; i < 6; i++) await addAgentLog('task-c', `msg-${i}`, 'info');

    const rows = await getRecentLogs(3);
    expect(rows.length).toBe(3);
    // The three most recent across ALL tasks are the last three task-c inserts.
    expect(rows.map(r => r.msg)).toEqual(['msg-5', 'msg-4', 'msg-3']);
  });
});

// Logs follow the WORK, and work is per-project: a task belongs to exactly one project, so
// its log rows must never surface in another project's feed. Only engine-wide '__system__'
// lines are project-less and shown everywhere.
describe('project scoping', () => {
  beforeEach(async () => { await clearAgentLogs(); });

  it('getRecentLogs(limit, projectId) returns that project\'s rows plus __system__, never another project\'s', async () => {
    await addAgentLog('t-alpha', 'alpha work', 'info', 'proj_alpha');
    await addAgentLog('t-beta', 'beta work', 'info', 'proj_beta');
    await addAgentLog('__system__', 'engine tick', 'info');

    const alpha = await getRecentLogs(50, 'proj_alpha');
    const msgs = alpha.map(r => r.msg);
    expect(msgs).toContain('alpha work');
    expect(msgs).toContain('engine tick'); // engine lines are shown in every project
    expect(msgs).not.toContain('beta work'); // the bleed this scoping exists to stop

    // Unscoped still sees everything (the DB-browser view).
    expect((await getRecentLogs(50)).map(r => r.msg).sort())
      .toEqual(['alpha work', 'beta work', 'engine tick']);
  });

  it('addAgentLog stores the projectId it is given, and null for unscoped lines', async () => {
    await addAgentLog('t-alpha', 'scoped', 'info', 'proj_alpha');
    await addAgentLog('__system__', 'unscoped', 'info');
    const rows = await getRecentLogs(10);
    expect(rows.find(r => r.msg === 'scoped')!.projectId).toBe('proj_alpha');
    expect(rows.find(r => r.msg === 'unscoped')!.projectId).toBeNull();
  });

  it('clearAgentLogs(projectId) removes exactly what that project\'s feed shows', async () => {
    await addAgentLog('t-alpha', 'alpha', 'info', 'proj_alpha');
    await addAgentLog('t-beta', 'beta', 'info', 'proj_beta');
    await addAgentLog('__system__', 'engine', 'info');

    // Clear must be the inverse of the scoped read: the project's rows AND the __system__
    // lines it displays. Otherwise "Clear" leaves rows visibly on screen.
    expect(await clearAgentLogs('proj_alpha')).toBe(2);
    expect(await getRecentLogs(50, 'proj_alpha')).toEqual([]);

    // …and another project's history is untouched.
    expect((await getRecentLogs(50)).map(r => r.msg)).toEqual(['beta']);
  });

  it('clearAgentLogs() with no project still wipes everything', async () => {
    await addAgentLog('t-alpha', 'alpha', 'info', 'proj_alpha');
    await addAgentLog('__system__', 'engine', 'info');
    expect(await clearAgentLogs()).toBe(2);
    expect(await getRecentLogs(50)).toEqual([]);
  });

  it('purgeTaskLogs keeps the surviving summary row inside the task\'s project', async () => {
    await addAgentLog('t-alpha', 'one', 'info', 'proj_alpha');
    await addAgentLog('t-alpha', 'two', 'info', 'proj_alpha');

    expect(await purgeTaskLogs('t-alpha')).toBe(2);

    // The one summary row that replaces the history must still be in proj_alpha's feed,
    // otherwise approving a task silently drops it out of the project it belonged to.
    const alpha = await getRecentLogs(50, 'proj_alpha');
    expect(alpha).toHaveLength(1);
    expect(alpha[0].projectId).toBe('proj_alpha');
    expect(alpha[0].msg).toMatch(/Approved by human/);
  });
});
