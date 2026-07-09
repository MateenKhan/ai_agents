import { describe, it, expect, beforeAll } from 'vitest';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { buildConfig, setConfig } from '../index';
import { taskLogPath, isInsideLogsRoot, safeSegment, logsRoot } from '../engine/task-log-file';

const root = join(tmpdir(), 'mc-logs-root');

beforeAll(() => {
  const cfg = buildConfig();
  cfg.paths.logsDir = root;
  setConfig(cfg);
});

describe('taskLogPath', () => {
  it('gives every task its own file under its project directory', () => {
    const a = taskLogPath('proj_a', 'task-1');
    const b = taskLogPath('proj_a', 'task-2');
    const c = taskLogPath('proj_b', 'task-1');

    expect(a).toBe(join(root, 'proj_a', 'task-1.log'));
    expect(a).not.toBe(b); // one log per task, not per agent slot
    expect(a).not.toBe(c); // same task id in another project never collides
  });

  it('returns an absolute path (it is persisted to the DB and reopened later)', () => {
    const p = taskLogPath('proj_a', 'task-1')!;
    expect(resolve(p)).toBe(p);
  });

  it('falls back to the default project when projectId is missing', () => {
    expect(taskLogPath(null, 't')).toBe(join(root, 'default', 't.log'));
    expect(taskLogPath(undefined, 't')).toBe(join(root, 'default', 't.log'));
  });
});

describe('safeSegment', () => {
  it('neutralises traversal and separators', () => {
    // A task id reaches taskLogPath from the DB and a project id from the URL; neither may
    // introduce a path separator or climb out of the logs root. Traversal needs a segment that
    // is *only* dots, so the leading dot-run is what has to die — `..` inside a name is an
    // ordinary filename character once the separators are gone.
    expect(safeSegment('..')).toBe('_');
    expect(safeSegment('...')).toBe('_');
    expect(safeSegment('.')).toBe('_');
    expect(safeSegment('../../etc')).toBe('__.._etc');
    expect(safeSegment('a/b')).toBe('a_b');
    expect(safeSegment('a\\b')).toBe('a_b');
    expect(safeSegment('C:')).toBe('C_');
    expect(safeSegment('.hidden')).toBe('_hidden');
    expect(safeSegment('')).toBeNull();
    expect(safeSegment('x'.repeat(201))).toBeNull();
  });

  it('never emits a separator or a dot-only segment for any input', () => {
    const nasty = ['..', '.', '...', '../..', 'a/../../b', '..\\..\\w', '/etc/passwd', 'C:\\Windows', '....'];
    for (const input of nasty) {
      const out = safeSegment(input);
      if (out === null) continue;
      expect(out).not.toContain('/');
      expect(out).not.toContain('\\');
      expect(out).not.toMatch(/^\.+$/); // never `.` or `..`, the only traversing segments
    }
  });

  it('leaves ordinary ids untouched', () => {
    expect(safeSegment('proj_a-1.2')).toBe('proj_a-1.2');
  });

  it('keeps a traversing id inside the root once joined', () => {
    const p = taskLogPath('../../..', '../../etc/passwd')!;
    expect(isInsideLogsRoot(p)).toBe(true);
  });
});

describe('isInsideLogsRoot', () => {
  it('accepts paths under the root and the root itself', () => {
    expect(isInsideLogsRoot(logsRoot())).toBe(true);
    expect(isInsideLogsRoot(join(root, 'proj', 'x.log'))).toBe(true);
  });

  it('rejects paths outside the root, including traversal back out of it', () => {
    // `tasks.logPath` is stored data: a restored DB or an older build must not be able to
    // point the read endpoint at an arbitrary file.
    expect(isInsideLogsRoot(join(root, '..', 'secrets.txt'))).toBe(false);
    expect(isInsideLogsRoot(join(tmpdir(), 'elsewhere.log'))).toBe(false);
  });

  it('rejects a sibling directory that merely shares the root as a prefix', () => {
    // `<root>-evil` starts with `<root>` as a plain string; only a separator-aware check
    // rejects it.
    expect(isInsideLogsRoot(root + '-evil' + sep + 'x.log')).toBe(false);
  });
});
