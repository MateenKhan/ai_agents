import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { buildConfig, setConfig } from '../index';
import { initTasksSchema, createTask, getTask, createProject, getProject, listProjects, updateBoardSettings, getBoardSettings, getAgentDefaults, setAgentDefaults } from '../db/tasks';
import { getAgents, upsertAgent } from '../db/agents';
import { getStore, ensureMigrated } from '../db/getStore';
import { DEFAULT_AGENTS } from '../db/defaults';
import { restoreDefaults, previewRestore, DEFAULT_BOARD_SETTINGS, isRestorableSettingKey } from '../db/seed';

const tempDbPath = join(tmpdir(), `mc-seed-${randomBytes(6).toString('hex')}.db`);
// logs.db lives in its own file; a `delete` restore clears it, so point it at a throwaway or
// the test would wipe the real db/logs.db.
const tempLogsPath = join(tmpdir(), `mc-seed-logs-${randomBytes(6).toString('hex')}.db`);

beforeAll(async () => {
  const cfg = buildConfig();
  cfg.paths.tasksDbPath = tempDbPath;
  cfg.paths.logsDbPath = tempLogsPath;
  setConfig(cfg);
  await initTasksSchema();
});

afterAll(() => {
  for (const base of [tempDbPath, tempLogsPath]) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { unlinkSync(base + suffix); } catch { /* ignore */ }
    }
  }
});

const raw = async () => { await ensureMigrated('tasks'); return getStore('tasks'); };

describe('declarative defaults exist at boot', () => {
  it('seedDefaults wrote agent_defaults, and getAgentDefaults reads them back', async () => {
    expect(DEFAULT_BOARD_SETTINGS).toHaveProperty('agent_defaults');
    const d = await getAgentDefaults();
    expect(d.maxConcurrency).toBe(0);
    expect(d.permissionProfile).toBe('standard');
  });

  it('boot seeding never overwrites a value the user has changed', async () => {
    await setAgentDefaults({ maxConcurrency: 7 });
    await initTasksSchema();               // boot again
    expect((await getAgentDefaults()).maxConcurrency).toBe(7);
    await setAgentDefaults({ maxConcurrency: 0 }); // restore for later cases
  });
});

describe('which board_settings keys are configuration', () => {
  it('only the declared keys are restorable — runtime state and repo pointers are not', () => {
    expect(isRestorableSettingKey('agent_defaults')).toBe(true);
    // These would break a live install if a restore wiped them.
    expect(isRestorableSettingKey('heartbeat')).toBe(false);           // live runtime state
    expect(isRestorableSettingKey('code_index:default')).toBe(false);  // points at a real checkout
    expect(isRestorableSettingKey('default')).toBe(false);             // orchestrator run/pause state
  });
});

// The whole point of restore. `delete` must be a factory reset of the SEEDED tables and
// nothing else — a "reset to defaults" that eats the user's project or tasks is a data-loss bug
// wearing a friendly label.
describe('restore blast radius', () => {
  beforeEach(async () => {
    const s = await raw();
    // A user-created project whose repoPath is NOT this repo. The migration seeds `default`
    // with repoPath = process.cwd(); resetting it would silently repoint agents at Piranha.
    await s.run(`UPDATE projects SET repoPath = ? WHERE id = 'default'`, ['/somewhere/user/repo']);
    await s.run(`DELETE FROM board_settings WHERE id IN ('heartbeat','code_index:default')`);
    await updateBoardSettings({ agentStatus: 'STARTED' });
    await s.run(`INSERT INTO board_settings (id,data) VALUES ('heartbeat',?)`, [JSON.stringify({ nextBeatAt: 'x' })]);
    await s.run(`INSERT INTO board_settings (id,data) VALUES ('code_index:default',?)`, [JSON.stringify({ root: '/somewhere/user/repo' })]);
  });

  for (const mode of ['overwrite', 'delete'] as const) {
    it(`[${mode}] never touches the projects table — repoPath survives`, async () => {
      const p = await createProject({ name: 'Real', repoPath: '/real/checkout' });
      await restoreDefaults(mode);

      expect((await getProject('default'))!.repoPath).toBe('/somewhere/user/repo');
      const survived = await getProject(p.id);
      expect(survived).not.toBeNull();
      expect(survived!.repoPath).toBe('/real/checkout');
    });

    it(`[${mode}] never touches tasks`, async () => {
      await createTask({ id: `keep-${mode}`, title: 'user work', status: 'WORKING' });
      await restoreDefaults(mode);
      expect(await getTask(`keep-${mode}`)).not.toBeNull();
    });

    it(`[${mode}] never touches heartbeat or code_index rows`, async () => {
      await restoreDefaults(mode);
      const s = await raw();
      const hb = await s.get(`SELECT data FROM board_settings WHERE id = 'heartbeat'`) as any;
      const ci = await s.get(`SELECT data FROM board_settings WHERE id = 'code_index:default'`) as any;
      expect(hb).not.toBeNull();
      expect(JSON.parse(ci.data).root).toBe('/somewhere/user/repo'); // the index still points at the real repo
    });

    it(`[${mode}] never touches the orchestrator run state`, async () => {
      await restoreDefaults(mode);
      expect((await getBoardSettings())?.agentStatus).toBe('STARTED');
    });

    it(`[${mode}] restores the built-in agents`, async () => {
      const s = await raw();
      await s.run(`DELETE FROM agents WHERE role = 'dev'`);          // user deleted a system role
      await s.run(`UPDATE agents SET model = 'haiku' WHERE role = 'architect'`); // and edited another

      await restoreDefaults(mode);

      const roles = (await getAgents()).map(a => a.role);
      for (const d of DEFAULT_AGENTS) expect(roles).toContain(d.role);
      expect((await getAgents()).find(a => a.role === 'architect')!.model)
        .toBe(DEFAULT_AGENTS.find(a => a.role === 'architect')!.model);
    });

    it(`[${mode}] reverts agent_defaults to the declared value`, async () => {
      await setAgentDefaults({ maxConcurrency: 9, permissionProfile: 'strict' });
      await restoreDefaults(mode);
      const d = await getAgentDefaults();
      expect(d.maxConcurrency).toBe(0);
      expect(d.permissionProfile).toBe('standard');
    });
  }
});

// The one behavioural difference between the two modes the user asked for.
describe('overwrite vs delete', () => {
  const custom = { role: 'reviewer' as any, label: 'Reviewer', enabled: true, model: 'sonnet', worktreeMode: 'none' as const, ord: 9, isSystem: false, promptTemplate: 'custom' };

  it('overwrite KEEPS a custom agent; delete REMOVES it', async () => {
    await upsertAgent(custom);
    expect((await getAgents()).map(a => a.role)).toContain('reviewer');

    await restoreDefaults('overwrite');
    expect((await getAgents()).map(a => a.role)).toContain('reviewer'); // survived

    await restoreDefaults('delete');
    expect((await getAgents()).map(a => a.role)).not.toContain('reviewer'); // wiped
  });
});

// The user's report: "delete all and restore is not deleting agent logs" — and the refinement:
// keep logs for tasks still on the board (failed/completed/in-review), clear only the orphans.
describe('delete clears ORPHANED logs.db telemetry but keeps live-task logs; overwrite keeps all', () => {
  const logsStore = async () => { await ensureMigrated('logs'); return getStore('logs'); };
  const addLog = async (taskId: string) => (await logsStore()).run(
    `INSERT INTO agent_logs (taskId, message, type, timestamp) VALUES (?,?,?,?)`,
    [taskId, 'x', 'info', new Date().toISOString()]);
  const logCountFor = async (taskId: string) => Number(
    (await (await logsStore()).get(`SELECT COUNT(*) c FROM agent_logs WHERE taskId = ?`, [taskId]) as any)?.c ?? 0);

  it('keeps a live task\'s logs, deletes an orphan\'s and the __system__ noise', async () => {
    await createTask({ id: 'LIVE-1', title: 'on the board', status: 'DONE' });
    await addLog('LIVE-1');         // belongs to a task still on the board
    await addLog('GONE-1');         // task no longer exists → orphan
    await addLog('__system__');     // orchestrator noise → orphan

    await restoreDefaults('overwrite');
    expect(await logCountFor('LIVE-1')).toBeGreaterThan(0); // overwrite touches no logs
    expect(await logCountFor('GONE-1')).toBeGreaterThan(0);

    const result = await restoreDefaults('delete');
    expect(await logCountFor('LIVE-1')).toBeGreaterThan(0); // KEPT — task is on the board
    expect(await logCountFor('GONE-1')).toBe(0);            // orphan cleared
    expect(await logCountFor('__system__')).toBe(0);        // noise cleared
    expect(result.logs.deleted).toBeGreaterThanOrEqual(2);
  });

  it('preview counts only the orphan rows delete would clear, and none for overwrite', async () => {
    await addLog('ANOTHER-GHOST');
    const del = await previewRestore('delete');
    expect(del.logsCleared.some(l => l.startsWith('agent_logs'))).toBe(true);
    expect((await previewRestore('overwrite')).logsCleared).toEqual([]);
  });
});

describe('previewRestore tells the truth before anything is written', () => {
  const custom = { role: 'auditor' as any, label: 'Auditor', enabled: true, model: 'sonnet', worktreeMode: 'none' as const, ord: 9, isSystem: false, promptTemplate: 'x' };

  it('names the custom agents delete would remove, and none for overwrite', async () => {
    await upsertAgent(custom);
    expect((await previewRestore('delete')).customAgentsRemoved).toContain('auditor');
    expect((await previewRestore('overwrite')).customAgentsRemoved).toEqual([]);
  });

  it('writes nothing', async () => {
    await upsertAgent(custom);
    const before = (await getAgents()).map(a => a.role).sort();
    await previewRestore('delete');
    expect((await getAgents()).map(a => a.role).sort()).toEqual(before);
  });

  it('lists projects and tasks as untouched', async () => {
    const p = await previewRestore('delete');
    expect(p.untouched).toContain('projects');
    expect(p.untouched).toContain('tasks');
  });
});
