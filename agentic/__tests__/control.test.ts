import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Bind tasks.ts's cached connection to a throwaway temp DB BEFORE the first helper
// call (mirrors agentic/__tests__/tasks.test.ts).
import { buildConfig, setConfig } from '../index';
import { createTask, getTask, getAllTasks, updateTask } from '../db/tasks';

const tempDbPath = join(tmpdir(), `mc-control-${randomBytes(6).toString('hex')}.db`);

beforeAll(() => {
  const cfg = buildConfig();
  cfg.paths.tasksDbPath = tempDbPath;
  setConfig(cfg); // must precede the first db() call below
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { unlinkSync(tempDbPath + suffix); } catch { /* ignore */ }
  }
});

describe('task control lifecycle', () => {
  it('defaults control to null when a task is created without one', () => {
    createTask({ id: 'ctl-default', title: 'No control', status: 'todo' });
    const t = getTask('ctl-default');
    expect(t).not.toBeNull();
    expect(t!.control).toBeNull();
  });

  it('updateTask({control}) persists control and leaves status untouched', () => {
    createTask({ id: 'ctl-pause', title: 'Pause me', status: 'in_progress' });
    updateTask('ctl-pause', { control: 'paused' });

    const viaGet = getTask('ctl-pause')!;
    expect(viaGet.control).toBe('paused');
    expect(viaGet.status).toBe('in_progress'); // control update must not alter status

    const viaAll = getAllTasks().find(x => x.id === 'ctl-pause')!;
    expect(viaAll.control).toBe('paused'); // round-trips through the row→Task mapping
    expect(viaAll.status).toBe('in_progress');
  });

  it('walks paused → resume(null) → stop, persisting each transition', () => {
    createTask({ id: 'ctl-seq', title: 'Sequence', status: 'todo' });
    expect(getTask('ctl-seq')!.control).toBeNull();

    updateTask('ctl-seq', { control: 'paused' });
    expect(getTask('ctl-seq')!.control).toBe('paused');

    updateTask('ctl-seq', { control: null }); // resume
    expect(getTask('ctl-seq')!.control).toBeNull();

    updateTask('ctl-seq', { control: 'stop' });
    expect(getTask('ctl-seq')!.control).toBe('stop');

    // Final state also survives the getAllTasks mapping path.
    const fromAll = getAllTasks().find(x => x.id === 'ctl-seq')!;
    expect(fromAll.control).toBe('stop');
    expect(fromAll.status).toBe('todo');
  });
});
