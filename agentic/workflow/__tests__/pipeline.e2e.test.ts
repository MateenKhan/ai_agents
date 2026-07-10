import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import { buildConfig, setConfig } from '../../index';
import { initTasksSchema, createTask, getTask, updateTask } from '../../db/tasks';
import { getStore, ensureMigrated } from '../../db/getStore';
import { loadWorkflow, saveWorkflow, resetWorkflow } from '../store';
import { defaultWorkflow } from '../defaultWorkflow';
import { placeTask, routeOutcome, routeReject, reconcileVerdict } from '../route';
import type { Task } from '../../types';
import type { WorkflowDoc } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end over the DECISION layer: a real database, a real workflow document, and the same
// routing functions the orchestrator calls — but no `claude -p`. Spawning agents costs money
// and minutes, and none of it would exercise anything these tests do not.
//
// What this covers that the unit tests cannot: the transitions COMPOSE. `handoffFrom` set by
// one step is what the next step's reject reads; `hops` accumulates across steps; a verdict
// written at one stage survives the stages after it.
// ─────────────────────────────────────────────────────────────────────────────

const tempDbPath = join(tmpdir(), `mc-e2e-${randomBytes(6).toString('hex')}.db`);
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

/** The orchestrator's success path, minus the agent. Returns the task after the transition. */
async function reportOutcome(doc: WorkflowDoc, taskId: string, outcome: string, verdict?: 'pass' | 'fail'): Promise<Task> {
  const task = (await getTask(taskId))!;
  const place = placeTask(doc, task.stage);
  if (place.kind !== 'dispatch') throw new Error(`stage "${task.stage}" is ${place.kind}, not dispatchable`);
  const stage = place.stage;

  // Only a verify stage may CHANGE the verdict. Everything else carries it forward.
  const { verdict: kept } = reconcileVerdict(stage, task.qaVerdict, verdict ?? task.qaVerdict);

  const decision = routeOutcome(doc, stage.id, outcome);
  if (decision.kind !== 'advance') throw new Error(`outcome "${outcome}" is not declared by "${stage.id}"`);

  await updateTask(taskId, {
    stage: decision.to,
    handoffFrom: stage.id,          // control plane sets this; agents never can
    lastOutcome: outcome,
    qaVerdict: kept,
    attempts: 0,
  });
  return (await getTask(taskId))!;
}

/** The orchestrator's reject path, minus the agent. */
async function reportReject(doc: WorkflowDoc, taskId: string): Promise<{ task: Task; kind: string }> {
  const task = (await getTask(taskId))!;
  const decision = routeReject(doc, { stageId: task.stage!, handoffFrom: task.handoffFrom, hops: task.hops ?? 0 });
  if (decision.kind === 'return' || decision.kind === 'hop-cap') {
    await updateTask(taskId, {
      stage: decision.kind === 'return' ? decision.to : decision.to!,
      hops: decision.hops, lastOutcome: 'reject', handoffFrom: task.stage, attempts: 0,
    });
  }
  return { task: (await getTask(taskId))!, kind: decision.kind };
}

const seed = async (id: string) => {
  await createTask({ id, title: id, description: 'do the thing', status: 'WORKING', projectId: PID });
  return (await getTask(id))!;
};

describe('the happy path, stage by stage', () => {
  it('walks intake -> plan -> build -> qa -> accept -> review, and parks for a human', async () => {
    const { doc } = await loadWorkflow(PID);
    await seed('t1');

    // A task with no stage starts at the entry.
    expect(placeTask(doc, (await getTask('t1'))!.stage).kind).toBe('dispatch');
    expect((placeTask(doc, null) as any).stage.id).toBe('intake');

    let t = await reportOutcome(doc, 't1', 'done');       // intake
    expect(t.stage).toBe('plan');
    expect(t.handoffFrom).toBe('intake');

    t = await reportOutcome(doc, 't1', 'done');           // plan
    expect(t.stage).toBe('build');

    t = await reportOutcome(doc, 't1', 'done');           // build
    expect(t.stage).toBe('qa');
    expect(t.handoffFrom).toBe('build');

    t = await reportOutcome(doc, 't1', 'pass', 'pass');   // qa (a verify stage)
    expect(t.stage).toBe('accept');
    expect(t.qaVerdict).toBe('pass');

    t = await reportOutcome(doc, 't1', 'accepted');       // accept — inherits the verdict
    expect(t.stage).toBe('review');
    expect(t.qaVerdict).toBe('pass');   // NOT destroyed on the way to the human

    expect(placeTask(doc, t.stage).kind).toBe('human-gate');
    expect(t.hops).toBe(0);
  });

  it('the human approves, the merge stage runs, and the task reaches the terminal', async () => {
    const { doc } = await loadWorkflow(PID);
    await seed('t2');
    await updateTask('t2', { stage: 'review', handoffFrom: 'accept', qaVerdict: 'pass' });

    // Approving is just an outcome the gate declares. It is not a stage name in the server.
    const approved = routeOutcome(doc, 'review', 'approved');
    expect(approved).toEqual({ kind: 'advance', to: 'merge', from: 'review' });
    await updateTask('t2', { stage: 'merge', handoffFrom: 'review', lastOutcome: 'approved' });

    const t = await reportOutcome(doc, 't2', 'done');     // merge
    expect(t.stage).toBe('merged');
    expect(placeTask(doc, t.stage).kind).toBe('terminal');
  });
});

describe('QA fails, the dev fixes it, QA passes', () => {
  it('the verdict flips and the task carries on', async () => {
    const { doc } = await loadWorkflow(PID);
    await seed('t3');
    await updateTask('t3', { stage: 'qa', handoffFrom: 'build' });

    let t = await reportOutcome(doc, 't3', 'fail', 'fail');
    expect(t.stage).toBe('build');
    expect(t.qaVerdict).toBe('fail');
    expect(t.handoffFrom).toBe('qa');      // build's SENDER is now qa, not plan
    expect(t.hops).toBe(0);                // a QA fail is routing, not a reject

    t = await reportOutcome(doc, 't3', 'done');
    expect(t.stage).toBe('qa');

    t = await reportOutcome(doc, 't3', 'pass', 'pass');
    expect(t.stage).toBe('accept');
    expect(t.qaVerdict).toBe('pass');
  });
});

// The case that only works under return-to-sender, and the reason a hop cannot be counted by
// comparing stage positions: build -> qa moves FORWARD.
describe('the dev rejects QA', () => {
  it('goes back to QA, which is forward in the pipeline, and costs one hop', async () => {
    const { doc } = await loadWorkflow(PID);
    await seed('t4');
    await updateTask('t4', { stage: 'build', handoffFrom: 'qa' });   // qa failed it back here

    const { task, kind } = await reportReject(doc, 't4');
    expect(kind).toBe('return');
    expect(task.stage).toBe('qa');          // forward
    expect(task.hops).toBe(1);
    expect(task.handoffFrom).toBe('build');
  });

  it('rejecting from the entry has nowhere to go', async () => {
    const { doc } = await loadWorkflow(PID);
    await seed('t5');
    await updateTask('t5', { stage: 'intake' });
    expect((await reportReject(doc, 't5')).kind).toBe('no-sender');
  });
});

describe('the hop cap', () => {
  it('a task that ping-pongs reaches a human, never BLOCKED', async () => {
    const { doc } = await loadWorkflow(PID);
    await seed('t6');
    await updateTask('t6', { stage: 'build', handoffFrom: 'plan' });

    // plan <-> build, over and over. Every reject is one hop, in either direction.
    for (let i = 1; i <= doc.hopCap; i++) {
      const { task, kind } = await reportReject(doc, 't6');
      expect(kind).toBe('return');
      expect(task.hops).toBe(i);
    }

    const final = await reportReject(doc, 't6');
    expect(final.kind).toBe('hop-cap');
    expect(final.task.stage).toBe('review');                 // a person settles it
    expect(final.task.hops).toBe(doc.hopCap + 1);
    expect(placeTask(doc, final.task.stage).kind).toBe('human-gate');
  });

  it('a lowered cap takes effect on the next reject, without touching the task', async () => {
    const doc = defaultWorkflow();
    doc.hopCap = 2;
    expect((await saveWorkflow(PID, doc, 0)).kind).toBe('saved');
    const { doc: stored } = await loadWorkflow(PID);

    await seed('t7');
    await updateTask('t7', { stage: 'build', handoffFrom: 'plan', hops: 2 });
    expect((await reportReject(stored, 't7')).kind).toBe('hop-cap');
  });
});

// Names carry no meaning. This is the whole redesign, exercised over a full run.
describe('a renamed pipeline behaves identically', () => {
  it('qa -> tapora, and the task still walks to the human gate with its verdict intact', async () => {
    const doc = defaultWorkflow();
    for (const s of doc.stages) {
      s.outcomes = s.outcomes.map(o => (o.to === 'qa' ? { ...o, to: 'tapora' } : o));
      s.asks = (s.asks ?? []).map(a => (a === 'qa' ? 'tapora' : a));
      if (s.id === 'qa') s.id = 'tapora';
    }
    expect((await saveWorkflow(PID, doc, 0)).kind).toBe('saved');
    const { doc: live } = await loadWorkflow(PID);

    await seed('t8');
    await reportOutcome(live, 't8', 'done');            // intake
    await reportOutcome(live, 't8', 'done');            // plan
    let t = await reportOutcome(live, 't8', 'done');    // build
    expect(t.stage).toBe('tapora');

    t = await reportOutcome(live, 't8', 'pass', 'pass');  // tapora still writes the verdict
    expect(t.stage).toBe('accept');
    expect(t.qaVerdict).toBe('pass');

    t = await reportOutcome(live, 't8', 'accepted');
    expect(t.stage).toBe('review');
    expect(t.qaVerdict).toBe('pass');
  });
});

describe('an agent cannot route itself', () => {
  it('an outcome the stage does not declare is refused', async () => {
    const { doc } = await loadWorkflow(PID);
    await seed('t9');
    await updateTask('t9', { stage: 'build' });
    await expect(reportOutcome(doc, 't9', 'shipit')).rejects.toThrow(/not declared/);
    expect((await getTask('t9'))!.stage).toBe('build');   // it did not move
  });

  it('a non-verify stage cannot set a QA verdict', async () => {
    const { doc } = await loadWorkflow(PID);
    await seed('t10');
    await updateTask('t10', { stage: 'build' });
    // The dev tries to pass its own work on the way out.
    const t = await reportOutcome(doc, 't10', 'done', 'pass');
    expect(t.qaVerdict).toBeNull();
    expect(t.stage).toBe('qa');
  });

  it('a stage that vanished from the workflow parks the task instead of guessing', async () => {
    const { doc } = await loadWorkflow(PID);
    await seed('t11');
    await updateTask('t11', { stage: 'a-stage-that-was-deleted' });
    const place = placeTask(doc, (await getTask('t11'))!.stage);
    expect(place).toEqual({ kind: 'unknown-stage', stageId: 'a-stage-that-was-deleted' });
  });
});

describe('the workflow cannot be edited out from under a running task', () => {
  it('a stage a task stands on cannot be deleted, but its caps can be raised', async () => {
    await updateTask((await seed('t12')).id, { stage: 'qa', status: 'WORKING' });

    const remove = defaultWorkflow();
    remove.stages = remove.stages.filter(s => s.id !== 'qa');
    for (const s of remove.stages) {
      s.outcomes = s.outcomes.map(o => (o.to === 'qa' ? { ...o, to: 'accept' } : o));
      s.asks = (s.asks ?? []).filter(a => a !== 'qa');
    }
    expect((await saveWorkflow(PID, remove, 0)).kind).toBe('occupied');

    const tune = defaultWorkflow();
    tune.stages.find(s => s.id === 'qa')!.caps!.attempts = 9;
    expect((await saveWorkflow(PID, tune, 0)).kind).toBe('saved');
    expect((await loadWorkflow(PID)).doc.stages.find(s => s.id === 'qa')!.caps!.attempts).toBe(9);
  });
});
