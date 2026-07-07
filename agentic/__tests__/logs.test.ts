import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Point logs.db at a throwaway temp file BEFORE the first logs helper runs.
import { buildConfig, setConfig } from '../index';
import { addAgentLog, getRecentLogs } from '../db/logs';

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
  it('returns rows newest-first with the { ts, taskId, msg, type } event shape', () => {
    // Insert in a known order; id is autoincrement so ordering is deterministic
    // regardless of timestamp collisions.
    addAgentLog('task-a', 'first', 'info');
    addAgentLog('task-a', 'second', 'success');
    addAgentLog('task-b', 'third', 'warning');
    addAgentLog('task-b', 'fourth', 'error');

    const rows = getRecentLogs(10);
    expect(rows.length).toBe(4);

    // Newest-first: the last inserted comes back first.
    expect(rows.map(r => r.msg)).toEqual(['fourth', 'third', 'second', 'first']);

    const newest = rows[0];
    expect(newest.taskId).toBe('task-b');
    expect(newest.msg).toBe('fourth');
    expect(newest.type).toBe('error');
    expect(typeof newest.ts).toBe('string');
    expect(newest.ts.length).toBeGreaterThan(0);
    // Only the four event-contract keys are surfaced (no raw id/message/timestamp columns).
    expect(Object.keys(newest).sort()).toEqual(['msg', 'taskId', 'ts', 'type']);
  });

  it('respects the limit, returning the N most-recent rows newest-first', () => {
    for (let i = 0; i < 6; i++) addAgentLog('task-c', `msg-${i}`, 'info');

    const rows = getRecentLogs(3);
    expect(rows.length).toBe(3);
    // The three most recent across ALL tasks are the last three task-c inserts.
    expect(rows.map(r => r.msg)).toEqual(['msg-5', 'msg-4', 'msg-3']);
  });
});
