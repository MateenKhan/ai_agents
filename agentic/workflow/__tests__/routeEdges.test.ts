import { describe, expect, it } from 'vitest';
import {
  mayWriteVerdict, nearestHumanGate, routeOutcome, routeReject, stageById,
} from '../route';
import { defaultWorkflow } from '../defaultWorkflow';
import type { WorkflowDoc } from '../types';

// Edge cases that route.test.ts does not already exercise. Each test drives a branch the
// existing suite leaves untouched: the empty-gate graph, the undefined sender, the stale reject
// target, the hop cap short-circuiting the sender logic, and the passive-behaviour verdict lock.
const doc = defaultWorkflow();
const s = (d: WorkflowDoc, id: string) => stageById(d, id)!;

// Convert the shipped `review` human-gate into an agent stage, leaving the graph with no gate at
// all. Its outcomes stay valid, so routing is otherwise untouched.
function withoutHumanGate(): WorkflowDoc {
  const d = defaultWorkflow();
  const review = s(d, 'review');
  review.behaviour = 'generic';
  review.agentRef = 'architect';
  review.model = 'opus';
  review.caps = { ...s(d, 'build').caps! };
  return d;
}

describe('nearestHumanGate — no gate at all', () => {
  it('returns null when the graph contains no human gate', () => {
    const d = withoutHumanGate();
    // From an upstream stage the BFS walks the whole graph and finds nothing.
    expect(nearestHumanGate(d, 'build')).toBeNull();
    expect(nearestHumanGate(d, 'intake')).toBeNull();
  });

  it('returns null even when asked from the former gate, now an agent stage', () => {
    const d = withoutHumanGate();
    // The `from` itself is no longer a gate, so the self-is-a-gate fallback must not fire.
    expect(nearestHumanGate(d, 'review')).toBeNull();
  });
});

describe('routeReject — the no-sender branch', () => {
  it('an undefined handoffFrom with no explicit reject has nowhere to return to', () => {
    // route.test covers handoffFrom: null; this drives the `?? null` on undefined.
    expect(routeReject(doc, { stageId: 'qa', handoffFrom: undefined, hops: 0 }))
      .toEqual({ kind: 'no-sender' });
  });

  it('an explicit reject target that no longer exists falls through to no-sender', () => {
    const d = defaultWorkflow();
    s(d, 'build').reject = 'plan';
    d.stages = d.stages.filter(st => st.id !== 'plan');   // the named target is gone
    // target resolves to 'plan', but stageById cannot find it, so the guard trips.
    expect(routeReject(d, { stageId: 'build', handoffFrom: 'qa', hops: 0 }))
      .toEqual({ kind: 'no-sender' });
  });
});

describe('routeReject — the hop cap', () => {
  it('at the cap it goes to the human gate, ignoring an explicit reject target', () => {
    const d = defaultWorkflow();
    s(d, 'build').reject = 'plan';   // would normally return to plan
    // The cap short-circuits before the sender/reject logic runs at all.
    expect(routeReject(d, { stageId: 'build', handoffFrom: 'qa', hops: d.hopCap }))
      .toEqual({ kind: 'hop-cap', to: 'review', hops: d.hopCap + 1 });
  });

  it('at the cap with no gate in the graph it dead-letters, still counting the hop', () => {
    const d = withoutHumanGate();
    expect(routeReject(d, { stageId: 'build', handoffFrom: 'plan', hops: d.hopCap }))
      .toEqual({ kind: 'hop-cap', to: null, hops: d.hopCap + 1 });
  });
});

describe('routeOutcome — an outcome the stage never declares', () => {
  it('the reserved word "reject" is not routable as an outcome', () => {
    // routeOutcome does not special-case reject; the stage simply never declares it.
    const r = routeOutcome(doc, 'build', 'reject');
    expect(r.kind).not.toBe('advance');
    expect(r).toEqual({ kind: 'unknown-outcome', outcome: 'reject', allowed: ['done', 'blocked'] });
  });

  it('a word a single-outcome stage does not list is parked, not advanced', () => {
    // `plan` declares only `done`. Reporting anything else must not take the lone exit.
    const r = routeOutcome(doc, 'plan', 'blocked');
    expect(r.kind).not.toBe('advance');
    expect(r).toEqual({ kind: 'unknown-outcome', outcome: 'blocked', allowed: ['done'] });
  });
});

describe('mayWriteVerdict — true only for a verify stage', () => {
  it('the passive behaviours a human gate and a terminal cannot write a verdict', () => {
    expect(mayWriteVerdict(s(doc, 'review'))).toBe(false);   // human-gate
    expect(mayWriteVerdict(s(doc, 'merged'))).toBe(false);   // terminal
  });

  it('the power follows the behaviour, not the name — flip a stage to verify and it may write', () => {
    const d = defaultWorkflow();
    expect(mayWriteVerdict(s(d, 'accept'))).toBe(false);     // generic today
    s(d, 'accept').behaviour = 'verify';
    expect(mayWriteVerdict(s(d, 'accept'))).toBe(true);
  });
});
