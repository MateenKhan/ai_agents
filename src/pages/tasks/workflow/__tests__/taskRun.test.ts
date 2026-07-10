import { describe, expect, it } from 'vitest';
import { edgeState, runSnapshotForTask, stageOrder, type TaskLike } from '../taskRun';
import { defaultWorkflow } from '../../../../../agentic/workflow/defaultWorkflow';

const doc = defaultWorkflow();
const task = (over: Partial<TaskLike>): TaskLike => ({ id: 'T-1', status: 'WORKING', ...over });

describe('stageOrder', () => {
  it('walks the pipeline forward from the entry along each stage\'s first outcome', () => {
    expect(stageOrder(doc)).toEqual(['intake', 'plan', 'build', 'qa', 'accept', 'review', 'merge', 'merged']);
  });

  it('terminates on a cycle rather than hanging the browser', () => {
    const g = defaultWorkflow();
    // A malformed document, saved by hand: merge's happy path loops back to the entry.
    g.stages.find(s => s.id === 'merge')!.outcomes[0].to = 'intake';
    expect(() => stageOrder(g)).not.toThrow();
    expect(stageOrder(g)).toEqual(['intake', 'plan', 'build', 'qa', 'accept', 'review', 'merge']);
  });

  it('stops where the chain breaks', () => {
    const g = defaultWorkflow();
    g.stages.find(s => s.id === 'build')!.outcomes = [];
    expect(stageOrder(g)).toEqual(['intake', 'plan', 'build']);
  });
});

describe('runSnapshotForTask', () => {
  it('marks earlier stages done, the current one running, later ones pending', () => {
    const r = runSnapshotForTask(doc, task({ stage: 'qa', status: 'WORKING' }));
    expect(r.stages.intake.state).toBe('done');
    expect(r.stages.build.state).toBe('done');
    expect(r.stages.qa.state).toBe('running');
    expect(r.stages.accept.state).toBe('pending');
    expect(r.stages.merged.state).toBe('pending');
  });

  it('a DONE task shows every stage succeeded, whatever `stage` still says', () => {
    // A completed task often still carries stage:'merge'. It must not render mid-merge.
    const r = runSnapshotForTask(doc, task({ stage: 'merge', status: 'DONE' }));
    expect(Object.values(r.stages).every(s => s.state === 'done')).toBe(true);
  });

  it('BLOCKED marks the current stage failed, not running — nothing is running', () => {
    const r = runSnapshotForTask(doc, task({ stage: 'build', status: 'BLOCKED', lastError: 'attempts exhausted' }));
    expect(r.stages.build.state).toBe('timeout');
    expect(r.stages.build.note).toBe('attempts exhausted');
  });

  it('a failed QA verdict renders as rejected', () => {
    const r = runSnapshotForTask(doc, task({ stage: 'qa', status: 'WORKING', qaVerdict: 'fail' }));
    expect(r.stages.qa.state).toBe('rejected');
  });

  it('a task parked at the human gate is not "running"', () => {
    const r = runSnapshotForTask(doc, task({ stage: 'review', status: 'TESTING' }));
    expect(r.stages.review.state).toBe('pending');
    expect(r.stages.qa.state).toBe('done');
  });

  it('a task with no stage has nothing done and nothing running', () => {
    const r = runSnapshotForTask(doc, task({ stage: null, status: 'TODO' }));
    expect(Object.values(r.stages).every(s => s.state === 'pending')).toBe(true);
  });

  it('a stage the graph does not contain does not fabricate progress', () => {
    // The architect once invented stage="blocked". The view must not guess where that is.
    const r = runSnapshotForTask(doc, task({ stage: 'blocked', status: 'WORKING' }));
    expect(Object.values(r.stages).every(s => s.state === 'pending')).toBe(true);
  });

  it('carries the task log path through, so the popup can link to it', () => {
    const r = runSnapshotForTask(doc, task({ stage: 'qa', logPath: 'C:/logs/default/T-1.log' }));
    expect(r.logHref).toBe('C:/logs/default/T-1.log');
    expect(r.hops).toBe(0);   // reject/consult is unbuilt; reads as 0 rather than undefined
  });
});

describe('edgeState', () => {
  const run = runSnapshotForTask(doc, task({ stage: 'qa', status: 'WORKING' }));

  it('an edge into the running stage is `current`', () => {
    expect(edgeState(run, 'build', 'qa')).toBe('current');
  });

  it('an edge between two completed stages is `traversed`', () => {
    expect(edgeState(run, 'intake', 'plan')).toBe('traversed');
  });

  it('an edge into an untouched stage is idle', () => {
    expect(edgeState(run, 'qa', 'accept')).toBe('idle');
    expect(edgeState(run, 'merge', 'merged')).toBe('idle');
  });

  it('an edge into a failed stage counts as traversed — work did flow there', () => {
    const blocked = runSnapshotForTask(doc, task({ stage: 'build', status: 'BLOCKED' }));
    expect(edgeState(blocked, 'plan', 'build')).toBe('traversed');
  });
});
