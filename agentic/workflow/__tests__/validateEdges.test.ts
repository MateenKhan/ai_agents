import { describe, expect, it } from 'vitest';
import { validateWorkflow } from '../validate';
import { defaultWorkflow } from '../defaultWorkflow';
import type { WorkflowDoc } from '../types';

// One triggering case per rejection reason validateWorkflow can return. Constructions are chosen
// to differ from validate.test.ts (different stages, isolated single causes) so each test drives
// its reason on its own, and the worktree rules — which the existing suite never touches — get
// both of their branches covered.
const reasons = (doc: WorkflowDoc, id: string) =>
  validateWorkflow(doc).stageIssues.find(i => i.stageId === id)?.reasons ?? [];
const errors = (doc: WorkflowDoc) => validateWorkflow(doc).docErrors;
const stage = (doc: WorkflowDoc, id: string) => doc.stages.find(s => s.id === id)!;

describe('unreachable stage', () => {
  it('a stage with no inbound edge is unreachable from the entry', () => {
    const doc = defaultWorkflow();
    // qa/pass is the only edge into `accept`; redirect it and accept strands.
    stage(doc, 'qa').outcomes.find(o => o.when === 'pass')!.to = 'review';
    expect(reasons(doc, 'accept').some(r => r.includes('unreachable from the entry stage')))
      .toBe(true);
  });
});

describe('terminal count', () => {
  it('no terminal means no task can ever finish', () => {
    const doc = defaultWorkflow();
    doc.stages = doc.stages.filter(s => s.behaviour !== 'terminal');
    expect(errors(doc)).toContain('no stage has behaviour "terminal", so no task can ever finish');
  });

  it('more than one terminal is rejected', () => {
    const doc = defaultWorkflow();
    stage(doc, 'accept').behaviour = 'terminal';   // now merged + accept are both terminal
    expect(errors(doc).some(e => e.includes('there must be exactly one'))).toBe(true);
  });
});

describe('merge count', () => {
  it('more than one merge stage would fight over the lock', () => {
    const doc = defaultWorkflow();
    stage(doc, 'plan').behaviour = 'merge';   // merge + plan both take the lock
    expect(errors(doc).some(e => e.includes('only one may hold the merge lock'))).toBe(true);
  });
});

describe('reject target', () => {
  it('a reject to a stage that never hands work here is refused', () => {
    const doc = defaultWorkflow();
    // build hands work to qa, not the reverse; so accept never hands work to qa either.
    stage(doc, 'qa').reject = 'accept';
    expect(reasons(doc, 'qa').some(r => r.includes('never hands work to this stage'))).toBe(true);
  });
});

describe('a human stage naming a model', () => {
  it('is rejected — the agent-node template leaked onto a person', () => {
    const doc = defaultWorkflow();
    stage(doc, 'review').model = 'opus';   // isolate the model rule
    expect(reasons(doc, 'review')).toContain('a human-gate stage cannot have a model');
  });
});

describe('worktree-rule violations', () => {
  it('an agent stage with an unknown worktree mode is rejected', () => {
    const doc = defaultWorkflow();
    (stage(doc, 'build') as unknown as { worktree: string }).worktree = 'orbit';
    expect(reasons(doc, 'build')).toContain('unknown worktree mode "orbit"');
  });

  it('a passive stage cannot carry a worktree — it runs no agent', () => {
    const doc = defaultWorkflow();
    stage(doc, 'review').worktree = 'reuse';
    expect(reasons(doc, 'review')).toContain('a human-gate stage runs no agent, so it has no worktree');
  });
});
