import { describe, expect, it } from 'vitest';
import {
  allowedOutcomes, capsFor, entryStage, isHumanGate, mayWriteVerdict, modelFor,
  nearestHumanGate, ownsBranch, placeTask, reconcileVerdict, routeOutcome, routeReject, stageById,
  takesMergeLock, worktreeFor,
} from '../route';
import { defaultWorkflow } from '../defaultWorkflow';
import type { WorkflowDoc } from '../types';

const doc = defaultWorkflow();
const s = (d: WorkflowDoc, id: string) => stageById(d, id)!;

describe('placing a task', () => {
  it('a task with no stage starts at the entry', () => {
    const p = placeTask(doc, null);
    expect(p.kind).toBe('dispatch');
    expect(p.kind === 'dispatch' && p.stage.id).toBe('intake');
    expect(entryStage(doc)!.id).toBe('intake');
  });

  it('an agent stage dispatches', () => {
    expect(placeTask(doc, 'build').kind).toBe('dispatch');
  });

  it('a human gate parks', () => {
    expect(placeTask(doc, 'review').kind).toBe('human-gate');
  });

  it('a terminal is finished', () => {
    expect(placeTask(doc, 'merged').kind).toBe('terminal');
  });

  // A save cannot remove an occupied stage, but a restored backup or a hand-edit can. This is
  // the `stage="blocked"` orphan class: a task in WORKING forever, never dispatched, invisible.
  it('a stage the document does not contain is reported, never guessed at', () => {
    const p = placeTask(doc, 'blocked');
    expect(p).toEqual({ kind: 'unknown-stage', stageId: 'blocked' });
  });
});

describe('routing an outcome', () => {
  it('sends the task where the document says', () => {
    expect(routeOutcome(doc, 'qa', 'pass')).toEqual({ kind: 'advance', to: 'accept', from: 'qa' });
    expect(routeOutcome(doc, 'qa', 'fail')).toEqual({ kind: 'advance', to: 'build', from: 'qa' });
    expect(routeOutcome(doc, 'build', 'done')).toEqual({ kind: 'advance', to: 'qa', from: 'build' });
  });

  it('an unrecognised outcome parks the task and names the words that were allowed', () => {
    // No fallback. An agent that cannot name a stage must not be able to route itself by
    // reporting nonsense and taking the first exit.
    const r = routeOutcome(doc, 'qa', 'shipit');
    expect(r.kind).toBe('unknown-outcome');
    expect(r.kind === 'unknown-outcome' && r.outcome).toBe('shipit');
    expect(r.kind === 'unknown-outcome' && r.allowed).toEqual(['pass', 'fail', 'blocked']);
  });

  it('an outcome reported at a stage that no longer exists is reported', () => {
    expect(routeOutcome(doc, 'ghost', 'done')).toEqual({ kind: 'unknown-stage', stageId: 'ghost' });
  });

  it('the allowed words are what gets rendered into the prompt', () => {
    const words = allowedOutcomes(doc, 'build');
    expect(words.map(w => w.when)).toEqual(['done', 'blocked']);
    expect(words[0].hint).toMatch(/committed/);
  });

  it('renaming every stage changes nothing about routing', () => {
    const d = defaultWorkflow();
    const map: Record<string, string> = { qa: 'tapora', accept: 'zzz' };
    for (const st of d.stages) {
      st.outcomes = st.outcomes.map(o => ({ ...o, to: map[o.to] ?? o.to }));
      st.asks = (st.asks ?? []).map(a => map[a] ?? a);
      st.id = map[st.id] ?? st.id;
    }
    expect(routeOutcome(d, 'tapora', 'pass')).toEqual({ kind: 'advance', to: 'zzz', from: 'tapora' });
    expect(mayWriteVerdict(s(d, 'tapora'))).toBe(true);   // the power travelled with `behaviour`
  });
});

// A reject returns to whoever handed the task over, which is not the same as "the earlier
// stage". When QA fails a task back to the dev, the dev's sender is QA — so the dev's reject
// goes FORWARD to QA. That is why a hop cannot be counted by comparing stage positions.
describe('rejecting', () => {
  it('returns to the sender', () => {
    expect(routeReject(doc, { stageId: 'build', handoffFrom: 'plan', hops: 0 }))
      .toEqual({ kind: 'return', to: 'plan', hops: 1 });
  });

  it('the dev can reject QA, which moves forward in the pipeline', () => {
    // QA failed the task back to build, so build's sender is qa.
    expect(routeReject(doc, { stageId: 'build', handoffFrom: 'qa', hops: 2 }))
      .toEqual({ kind: 'return', to: 'qa', hops: 3 });
  });

  it('an explicit reject target overrides the sender', () => {
    const d = defaultWorkflow();
    s(d, 'build').reject = 'plan';
    expect(routeReject(d, { stageId: 'build', handoffFrom: 'qa', hops: 0 }))
      .toEqual({ kind: 'return', to: 'plan', hops: 1 });
  });

  it('nothing handed it over, so there is nowhere to return it', () => {
    expect(routeReject(doc, { stageId: 'intake', handoffFrom: null, hops: 0 }))
      .toEqual({ kind: 'no-sender' });
  });

  it('every reject counts one hop, in any direction', () => {
    const r = routeReject(doc, { stageId: 'build', handoffFrom: 'plan', hops: 4 });
    expect(r.kind).toBe('return');
    expect(r.kind === 'return' && r.hops).toBe(5);
  });

  it('at the hop cap the task goes to a human, never to BLOCKED', () => {
    const r = routeReject(doc, { stageId: 'build', handoffFrom: 'plan', hops: doc.hopCap });
    expect(r.kind).toBe('hop-cap');
    expect(r.kind === 'hop-cap' && r.to).toBe('review');
    expect(r.kind === 'hop-cap' && r.hops).toBe(doc.hopCap + 1);
  });

  it('the hop cap is a strict ceiling: the last permitted hop still returns', () => {
    const r = routeReject(doc, { stageId: 'build', handoffFrom: 'plan', hops: doc.hopCap - 1 });
    expect(r.kind).toBe('return');
    expect(r.kind === 'return' && r.hops).toBe(doc.hopCap);
  });

  it('a graph with no human gate reports null, so the caller can dead-letter', () => {
    const d = defaultWorkflow();
    s(d, 'review').behaviour = 'generic';
    s(d, 'review').agentRef = 'architect';
    s(d, 'review').model = 'opus';
    s(d, 'review').caps = { ...s(d, 'build').caps! };
    const r = routeReject(d, { stageId: 'build', handoffFrom: 'plan', hops: d.hopCap });
    expect(r.kind === 'hop-cap' && r.to).toBeNull();
  });

  it('a reject at a stage that no longer exists is reported', () => {
    expect(routeReject(doc, { stageId: 'ghost', handoffFrom: 'plan', hops: 0 }))
      .toEqual({ kind: 'unknown-stage', stageId: 'ghost' });
  });
});

describe('nearestHumanGate', () => {
  it('finds the gate downstream of a stage', () => {
    expect(nearestHumanGate(doc, 'build')).toBe('review');
    expect(nearestHumanGate(doc, 'qa')).toBe('review');
  });

  it('a gate finds itself, so a human rejecting from the gate has somewhere to land', () => {
    expect(nearestHumanGate(doc, 'review')).toBe('review');
  });

  it('terminates on a cycle', () => {
    const d = defaultWorkflow();
    s(d, 'merged').behaviour = 'generic';
    s(d, 'merged').agentRef = 'dev';
    s(d, 'merged').model = 'sonnet';
    s(d, 'merged').caps = { ...s(d, 'build').caps! };
    s(d, 'merged').outcomes = [{ when: 'again', to: 'intake' }];
    expect(() => nearestHumanGate(d, 'intake')).not.toThrow();
  });
});

// Every special power is keyed off `behaviour`. Rename `merge` to `ship` and it still takes the
// merge lock, because the power travelled with the behaviour and not with the name.
describe('what a stage may do', () => {
  it('only a verify stage writes a QA verdict', () => {
    expect(mayWriteVerdict(s(doc, 'qa'))).toBe(true);
    for (const id of ['intake', 'plan', 'build', 'accept', 'merge']) {
      expect(mayWriteVerdict(s(doc, id))).toBe(false);
    }
  });

  it('only a merge stage takes the merge lock', () => {
    expect(takesMergeLock(s(doc, 'merge'))).toBe(true);
    expect(takesMergeLock(s(doc, 'plan'))).toBe(false);
  });

  it('only a build stage owns the branch', () => {
    expect(ownsBranch(s(doc, 'build'))).toBe(true);
    expect(ownsBranch(s(doc, 'qa'))).toBe(false);
  });

  it('only a human-gate parks', () => {
    expect(isHumanGate(s(doc, 'review'))).toBe(true);
    expect(isHumanGate(s(doc, 'accept'))).toBe(false);
  });
});

// Found by a live run, not by a unit test. `qaVerdict` lives on the TASK, so every stage after
// a verify stage inherits it. Guarding on "does this stage have a verdict?" wiped the verdict
// QA had legitimately written, the moment the owner's acceptance gate ran.
describe('reconcileVerdict — a later stage carries a verdict, it does not set one', () => {
  const qa = () => s(defaultWorkflow(), 'qa');          // behaviour: verify
  const accept = () => s(defaultWorkflow(), 'accept');  // behaviour: generic, runs AFTER qa

  it('a verify stage may write a verdict', () => {
    expect(reconcileVerdict(qa(), null, 'pass')).toEqual({ verdict: 'pass', rejected: false });
    expect(reconcileVerdict(qa(), 'pass', 'fail')).toEqual({ verdict: 'fail', rejected: false });
  });

  it('a non-verify stage that INHERITS a verdict keeps it', () => {
    // The bug: accept runs with qaVerdict already 'pass', changes nothing, and used to have it
    // discarded — so the human review screen lost "QA passed".
    expect(reconcileVerdict(accept(), 'pass', 'pass')).toEqual({ verdict: 'pass', rejected: false });
  });

  it('a non-verify stage that CHANGES the verdict is reverted', () => {
    expect(reconcileVerdict(accept(), 'pass', 'fail')).toEqual({ verdict: 'pass', rejected: true });
    expect(reconcileVerdict(accept(), null, 'pass')).toEqual({ verdict: null, rejected: true });
  });

  it('a non-verify stage that CLEARS the verdict is reverted', () => {
    expect(reconcileVerdict(accept(), 'pass', null)).toEqual({ verdict: 'pass', rejected: true });
  });

  it('no verdict anywhere is not a violation', () => {
    expect(reconcileVerdict(accept(), null, null)).toEqual({ verdict: null, rejected: false });
    expect(reconcileVerdict(accept(), undefined, undefined)).toEqual({ verdict: null, rejected: false });
  });

  it('a dev cannot pass its own work', () => {
    expect(reconcileVerdict(s(defaultWorkflow(), 'build'), null, 'pass')).toEqual({ verdict: null, rejected: true });
  });
});

describe('worktree', () => {
  it('comes from the behaviour by default', () => {
    expect(worktreeFor(s(doc, 'plan'))).toBe('plan');
    expect(worktreeFor(s(doc, 'build'))).toBe('create');
    expect(worktreeFor(s(doc, 'qa'))).toBe('reuse');
    expect(worktreeFor(s(doc, 'merge'))).toBe('none');
    expect(worktreeFor(s(doc, 'intake'))).toBe('none');
  });

  it('a stage may override it — the owner\'s accept gate is generic but reads the dev\'s diff', () => {
    const d = defaultWorkflow();
    s(d, 'accept').worktree = 'reuse';
    expect(worktreeFor(s(d, 'accept'))).toBe('reuse');
  });
});

describe('model resolution', () => {
  it('the stage wins over the agents table', () => {
    expect(modelFor(s(doc, 'build'), 'haiku')).toBe('sonnet');
  });

  it('the agents table is the default when the stage names none', () => {
    const d = defaultWorkflow();
    s(d, 'build').model = null;
    expect(modelFor(s(d, 'build'), 'haiku')).toBe('haiku');
  });

  it('one role, two stages, two models — which a table keyed by role cannot express', () => {
    const d = defaultWorkflow();
    s(d, 'intake').model = 'opus';
    s(d, 'accept').model = 'haiku';
    expect(s(d, 'intake').agentRef).toBe('owner');
    expect(s(d, 'accept').agentRef).toBe('owner');
    expect(modelFor(s(d, 'intake'), 'opus')).toBe('opus');
    expect(modelFor(s(d, 'accept'), 'opus')).toBe('haiku');
  });

  it('null when neither the stage nor the table has one', () => {
    const d = defaultWorkflow();
    s(d, 'build').model = null;
    expect(modelFor(s(d, 'build'), undefined)).toBeNull();
  });
});

describe('caps', () => {
  it('an agent stage has a budget', () => {
    expect(capsFor(s(doc, 'build'))!.attempts).toBe(3);
  });

  it('a human gate has none — you do not retry a person', () => {
    expect(capsFor(s(doc, 'review'))).toBeNull();
    expect(capsFor(s(doc, 'merged'))).toBeNull();
  });
});
