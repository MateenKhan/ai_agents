// previewRestore must TELL THE TRUTH: whatever it predicts, restoreDefaults must then do.
// The sibling agentic/__tests__/seed.test.ts proves the blast radius and the mode
// differences; this file isolates PARITY — for each mode, the preview's promised agents /
// settings / orphan-log counts equal what the real restore actually writes and clears.
//
// Temp-DB harness (both tasks.db AND logs.db pointed at throwaway files) copied from
// agentic/__tests__/seed.test.ts, so nothing here can touch the real db/*.db.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { buildConfig, setConfig } from '../../index';
import { initTasksSchema, createTask } from '../tasks';
import { getAgents, upsertAgent } from '../agents';
import { getStore, ensureMigrated } from '../getStore';
import { DEFAULT_AGENTS } from '../defaults';
import { restoreDefaults, previewRestore } from '../seed';

const tempDbPath = join(tmpdir(), `mc-parity-${randomBytes(6).toString('hex')}.db`);
const tempLogsPath = join(tmpdir(), `mc-parity-logs-${randomBytes(6).toString('hex')}.db`);

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

const logsStore = async () => { await ensureMigrated('logs'); return getStore('logs'); };
const addLog = async (taskId: string) => (await logsStore()).run(
  `INSERT INTO agent_logs (taskId, message, type, timestamp) VALUES (?,?,?,?)`,
  [taskId, 'x', 'info', new Date().toISOString()]);

/** Pull the integer out of a preview entry like "agent_logs (3 rows)" / "agent_db_usage (1 row)". */
const parseCount = (entry: string): number => {
  const m = entry.match(/\((\d+)\s+rows?\)/);
  return m ? Number(m[1]) : 0;
};
const previewLogTotal = (entries: string[]): number => entries.reduce((n, e) => n + parseCount(e), 0);

describe('preview ↔ restore agent parity', () => {
  for (const mode of ['overwrite', 'delete'] as const) {
    it(`[${mode}] builtInAgentsReverted names exactly the agents restore writes`, async () => {
      const preview = await previewRestore(mode);
      const result = await restoreDefaults(mode);

      // Preview promises to revert every built-in role, and restore writes exactly that many.
      expect(preview.builtInAgentsReverted.sort()).toEqual(DEFAULT_AGENTS.map(a => a.role).sort());
      expect(result.agents.written).toBe(DEFAULT_AGENTS.length);

      // And after the restore, every promised role is actually present on the board.
      const roles = (await getAgents()).map(a => a.role);
      for (const r of preview.builtInAgentsReverted) expect(roles).toContain(r);
    });
  }

  it('[delete] customAgentsRemoved predicts exactly the custom roles delete strips', async () => {
    const custom = { role: 'parity-custom' as any, label: 'Parity', enabled: true, model: 'sonnet', worktreeMode: 'none' as const, ord: 9, isSystem: false, promptTemplate: 'x' };
    await upsertAgent(custom);

    const preview = await previewRestore('delete');
    expect(preview.customAgentsRemoved).toContain('parity-custom');

    await restoreDefaults('delete');
    const rolesAfter = (await getAgents()).map(a => a.role);
    // Everything the preview said would be removed is gone; nothing it didn't name was.
    for (const r of preview.customAgentsRemoved) expect(rolesAfter).not.toContain(r);
    const builtIn = new Set(DEFAULT_AGENTS.map(a => a.role));
    expect(rolesAfter.filter(r => !builtIn.has(r as any))).toEqual([]);
  });

  it('[overwrite] promises to remove no custom agents, and keeps them', async () => {
    const custom = { role: 'parity-keep' as any, label: 'Keep', enabled: true, model: 'sonnet', worktreeMode: 'none' as const, ord: 9, isSystem: false, promptTemplate: 'x' };
    await upsertAgent(custom);

    const preview = await previewRestore('overwrite');
    expect(preview.customAgentsRemoved).toEqual([]);

    await restoreDefaults('overwrite');
    expect((await getAgents()).map(a => a.role)).toContain('parity-keep');
  });
});

describe('preview ↔ restore orphan-log parity', () => {
  it('[delete] the orphan count preview shows equals the rows delete actually clears', async () => {
    // One live task (its logs must be KEPT) and several orphans (no task / __system__ noise).
    await createTask({ id: 'PARITY-LIVE', title: 'on the board', status: 'DONE' });
    await addLog('PARITY-LIVE');
    await addLog('PARITY-GHOST-1');
    await addLog('PARITY-GHOST-2');
    await addLog('__system__');

    const logs = await logsStore();
    const orphansBefore = Number((await logs.get(
      `SELECT COUNT(*) c FROM agent_logs WHERE taskId <> 'PARITY-LIVE'`) as any)?.c ?? 0);
    const liveBefore = Number((await logs.get(
      `SELECT COUNT(*) c FROM agent_logs WHERE taskId = 'PARITY-LIVE'`) as any)?.c ?? 0);

    // Predict, then act — with no state change in between the two must agree.
    const preview = await previewRestore('delete');
    const predicted = previewLogTotal(preview.logsCleared);
    const result = await restoreDefaults('delete');

    // The preview's summed orphan count == restore's reported deletions == rows that vanished.
    expect(predicted).toBe(orphansBefore);
    expect(result.logs.deleted).toBe(predicted);

    const liveAfter = Number((await logs.get(
      `SELECT COUNT(*) c FROM agent_logs WHERE taskId = 'PARITY-LIVE'`) as any)?.c ?? 0);
    const orphansAfter = Number((await logs.get(
      `SELECT COUNT(*) c FROM agent_logs WHERE taskId <> 'PARITY-LIVE'`) as any)?.c ?? 0);
    expect(liveAfter).toBe(liveBefore); // live-task history untouched
    expect(orphansAfter).toBe(0);       // every orphan the preview counted is gone
  });

  it('[overwrite] preview shows nothing to clear and restore clears nothing', async () => {
    await addLog('ANOTHER-ORPHAN');
    const before = Number((await (await logsStore()).get(
      `SELECT COUNT(*) c FROM agent_logs`) as any)?.c ?? 0);

    const preview = await previewRestore('overwrite');
    const result = await restoreDefaults('overwrite');

    expect(preview.logsCleared).toEqual([]);
    expect(result.logs.deleted).toBe(0);
    const after = Number((await (await logsStore()).get(
      `SELECT COUNT(*) c FROM agent_logs`) as any)?.c ?? 0);
    expect(after).toBe(before); // overwrite touches no logs at all
  });
});
