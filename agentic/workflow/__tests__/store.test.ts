import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { buildConfig, setConfig } from '../../index';
import { initTasksSchema, createTask, updateTask, deleteTask } from '../../db/tasks';
import { getStore, ensureMigrated } from '../../db/getStore';
import { loadWorkflow, saveWorkflow, resetWorkflow, occupiedStagesFor, workflowKey } from '../store';
import { defaultWorkflow } from '../defaultWorkflow';
import type { WorkflowDoc } from '../types';

const tempDbPath = join(tmpdir(), `mc-wf-${randomBytes(6).toString('hex')}.db`);
const PID = 'default';

beforeAll(async () => {
  const cfg = buildConfig();
  cfg.paths.tasksDbPath = tempDbPath;
  setConfig(cfg);
  await initTasksSchema();
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { unlinkSync(tempDbPath + suffix); } catch { /* ignore */ }
  }
});

beforeEach(async () => {
  await resetWorkflow(PID);
  await ensureMigrated('tasks');
  await getStore('tasks').run(`DELETE FROM tasks`);
});

const stage = (doc: WorkflowDoc, id: string) => doc.stages.find(s => s.id === id)!;

/** Remove a stage and every reference to it, so the document stays VALID. Otherwise the
 *  validator refuses it first and we never reach the occupancy check we are testing. */
function dropStage(doc: WorkflowDoc, id: string, rerouteTo: string): void {
  doc.stages = doc.stages.filter(s => s.id !== id);
  for (const s of doc.stages) {
    s.outcomes = s.outcomes.map(o => (o.to === id ? { ...o, to: rerouteTo } : o));
    s.asks = (s.asks ?? []).filter(a => a !== id);
    if (s.reject === id) s.reject = null;
  }
}

/** Rename a stage and every reference to it. */
function renameStage(doc: WorkflowDoc, from: string, to: string): void {
  for (const s of doc.stages) {
    s.outcomes = s.outcomes.map(o => (o.to === from ? { ...o, to } : o));
    s.asks = (s.asks ?? []).map(a => (a === from ? to : a));
    if (s.reject === from) s.reject = to;
    if (s.id === from) s.id = to;
  }
  if (doc.entry === from) doc.entry = to;
}

describe('loading', () => {
  it('a project with no saved document gets the built-in pipeline', async () => {
    const { doc, source } = await loadWorkflow(PID);
    expect(source).toBe('default');
    expect(doc.entry).toBe('intake');
    expect(doc.stages).toHaveLength(8);
  });

  it('a corrupt stored document falls back rather than bricking the board', async () => {
    await getStore('tasks').run(`INSERT INTO board_settings (id, data) VALUES (?, ?)`, [workflowKey(PID), '{not json']);
    const { doc, source } = await loadWorkflow(PID);
    expect(source).toBe('default');
    expect(doc.stages).toHaveLength(8);
  });

  it('a stored document round-trips', async () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').caps!.attempts = 7;
    const r = await saveWorkflow(PID, doc, 0);
    expect(r.kind).toBe('saved');

    const back = await loadWorkflow(PID);
    expect(back.source).toBe('stored');
    expect(stage(back.doc, 'build').caps!.attempts).toBe(7);
  });
});

describe('rev', () => {
  it('the first save expects rev 0 and stores rev 1', async () => {
    const r = await saveWorkflow(PID, defaultWorkflow(), 0);
    expect(r.kind === 'saved' && r.doc.rev).toBe(1);
  });

  it('the caller cannot choose its own rev', async () => {
    const doc = defaultWorkflow();
    doc.rev = 99;
    const r = await saveWorkflow(PID, doc, 0);
    expect(r.kind === 'saved' && r.doc.rev).toBe(1);   // ignored; server assigns currentRev + 1
  });

  it('a stale rev is rejected, not merged', async () => {
    await saveWorkflow(PID, defaultWorkflow(), 0);       // now at rev 1
    const stale = await saveWorkflow(PID, defaultWorkflow(), 0);
    expect(stale.kind).not.toBe('saved');
    expect(stale.kind).toBe('conflict');
    expect(stale.kind === 'conflict' && stale.currentRev).toBe(1);
  });

  it('two concurrent saves: exactly one wins', async () => {
    // Whoever loses must reload. Interleaving two people's stage deletions produces a graph
    // neither of them drew.
    const results = await Promise.all([
      saveWorkflow(PID, defaultWorkflow(), 0),
      saveWorkflow(PID, defaultWorkflow(), 0),
    ]);
    expect(results.filter(r => r.kind === 'saved')).toHaveLength(1);
    expect((await loadWorkflow(PID)).doc.rev).toBe(1);
  });
});

describe('validation on write', () => {
  it('a document that strands a stage is refused', async () => {
    const doc = defaultWorkflow();
    stage(doc, 'qa').outcomes = [];
    const r = await saveWorkflow(PID, doc, 0);
    expect(r.kind).not.toBe('saved');
    expect(r.kind).toBe('invalid');
    // and nothing was written
    expect((await loadWorkflow(PID)).source).toBe('default');
  });

  it('a document with no terminal is refused', async () => {
    const doc = defaultWorkflow();
    stage(doc, 'merged').behaviour = 'generic';
    const r = await saveWorkflow(PID, doc, 0);
    expect(r.kind).toBe('invalid');
  });
});

// The check and the write share a transaction, because a task can start on `qa` in the gap
// between "is anyone on qa?" and "store the document".
describe('a live task cannot have the ground pulled from under it', () => {
  const live = async (id: string, stageId: string, status = 'WORKING') =>
    createTask({ id, title: id, status, stage: stageId, projectId: PID });

  it('reports which stages are occupied', async () => {
    await live('t1', 'qa');
    await live('t2', 'build', 'TESTING');
    await live('t3', 'plan', 'DONE');            // finished: not live
    const occupied = await occupiedStagesFor(PID);
    expect(occupied.sort()).toEqual(['build', 'qa']);
  });

  it('refuses to delete a stage a task stands on', async () => {
    await live('t1', 'qa');
    const doc = defaultWorkflow();
    dropStage(doc, 'qa', 'accept');

    const r = await saveWorkflow(PID, doc, 0);
    expect(r.kind).not.toBe('saved');
    expect(r.kind).toBe('occupied');
    expect(r.kind === 'occupied' && r.conflicts[0]).toMatch(/a task is running there/);
  });

  it('refuses to rename a stage a task stands on', async () => {
    await live('t1', 'qa');
    const doc = defaultWorkflow();
    renameStage(doc, 'qa', 'tapora');
    const r = await saveWorkflow(PID, doc, 0);
    expect(r.kind).toBe('occupied');
  });

  it('ALLOWS renaming a stage once its task is gone', async () => {
    await live('t1', 'qa');
    await deleteTask('t1');
    const doc = defaultWorkflow();
    renameStage(doc, 'qa', 'tapora');
    expect((await saveWorkflow(PID, doc, 0)).kind).toBe('saved');
  });

  it('ALLOWS harmless edits while a task runs: caps, layout, hints', async () => {
    await live('t1', 'qa');
    const doc = defaultWorkflow();
    stage(doc, 'qa').caps!.attempts = 9;
    stage(doc, 'qa').ui = { x: 1, y: 2 };
    stage(doc, 'qa').outcomes[0].hint = 'reworded';
    const r = await saveWorkflow(PID, doc, 0);
    expect(r.kind).toBe('saved');
    expect(stage((await loadWorkflow(PID)).doc, 'qa').caps!.attempts).toBe(9);
  });

  it('ALLOWS adding a stage while a task runs', async () => {
    await live('t1', 'build');
    const doc = defaultWorkflow();
    doc.stages.push({
      id: 'security', behaviour: 'generic', agentRef: 'qa', model: 'sonnet',
      caps: { ...stage(doc, 'qa').caps! }, outcomes: [{ when: 'done', to: 'accept' }],
    });
    stage(doc, 'qa').outcomes = stage(doc, 'qa').outcomes.map(o => (o.when === 'pass' ? { ...o, to: 'security' } : o));
    expect((await saveWorkflow(PID, doc, 0)).kind).toBe('saved');
  });

  it('a DONE task does not lock its stage', async () => {
    await createTask({ id: 't1', title: 't1', status: 'DONE', stage: 'qa', projectId: PID });
    const doc = defaultWorkflow();
    dropStage(doc, 'qa', 'accept');
    expect((await saveWorkflow(PID, doc, 0)).kind).toBe('saved');
  });

  it('the occupancy refusal writes nothing', async () => {
    await saveWorkflow(PID, defaultWorkflow(), 0);         // rev 1
    await createTask({ id: 't1', title: 't1', status: 'WORKING', stage: 'qa', projectId: PID });

    const doc = defaultWorkflow();
    dropStage(doc, 'qa', 'accept');
    await saveWorkflow(PID, doc, 1);

    const after = await loadWorkflow(PID);
    expect(after.doc.rev).toBe(1);                          // unchanged
    expect(after.doc.stages.some(s => s.id === 'qa')).toBe(true);
  });
});

describe('reset', () => {
  it('forgets the stored document and falls back to the built-in pipeline', async () => {
    await saveWorkflow(PID, defaultWorkflow(), 0);
    expect((await loadWorkflow(PID)).source).toBe('stored');
    await resetWorkflow(PID);
    expect((await loadWorkflow(PID)).source).toBe('default');
  });
});

describe('projects are independent', () => {
  it('saving one project does not change another', async () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').caps!.attempts = 5;
    await saveWorkflow('proj_a', doc, 0);

    expect((await loadWorkflow('proj_b')).source).toBe('default');
    expect(stage((await loadWorkflow('proj_a')).doc, 'build').caps!.attempts).toBe(5);
    await resetWorkflow('proj_a');
  });

  it('a task in another project does not lock this project\'s stages', async () => {
    await createTask({ id: 't1', title: 't1', status: 'WORKING', stage: 'qa', projectId: 'proj_other' });
    expect(await occupiedStagesFor(PID)).toEqual([]);
    await deleteTask('t1');
  });
});
