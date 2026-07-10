import { describe, it, expect } from 'vitest';
import { decideFailure, isInfraFailure } from '../engine/orchestrator';
import type { FailureKind } from '../types';

/** A `build` stage in the shipped workflow: three attempts, one escalation, `blocked` declared. */
const base = {
  attempts: 0,
  maxAttempts: 3,
  rescuesUsed: 0,
  maxRescues: 1,
  hasBlockedOutcome: true,
  hasHumanGate: true,
  qaPassed: false,
};
const decide = (over: Partial<typeof base> & { failure: FailureKind }) =>
  decideFailure({ ...base, ...over });

describe('isInfraFailure', () => {
  it('only a network failure is infrastructure', () => {
    expect(isInfraFailure('network')).toBe(true);
    // These mean the agent RAN and misbehaved — they are facts about the task.
    for (const k of ['crash', 'timeout', 'stall', 'none'] as FailureKind[]) {
      expect(isInfraFailure(k)).toBe(false);
    }
  });
});

// THE BUG THIS FUNCTION EXISTS TO PREVENT.
// breakerFailure() opens the circuit on the 3rd consecutive network failure, and maxAttempts is
// also 3 — so an Anthropic outage exhausted a task's budget on the very tick the breaker
// tripped. The orchestrator then woke an opus architect to "re-plan" a task whose plan was
// never the problem; that run failed for the same reason, and the task dead-lettered.
describe('an infrastructure outage never costs the task anything', () => {
  it('waits instead of escalating, even with the retry budget fully spent', () => {
    expect(decide({ failure: 'network', attempts: 3 })).toBe('infra-wait');
  });

  it('waits even when the escalation budget is exhausted (would otherwise dead-letter)', () => {
    expect(decide({ failure: 'network', attempts: 9, rescuesUsed: 9, maxRescues: 1 })).toBe('infra-wait');
  });

  it('waits whatever the stage declares — nobody can fix "Anthropic is down"', () => {
    expect(decide({ failure: 'network', attempts: 9, hasBlockedOutcome: false, hasHumanGate: false })).toBe('infra-wait');
  });

  it('never escalates and never dead-letters on network, whatever the counters say', () => {
    for (const attempts of [0, 1, 3, 50]) {
      for (const rescuesUsed of [0, 1, 9]) {
        expect(decide({ failure: 'network', attempts, rescuesUsed })).toBe('infra-wait');
      }
    }
  });
});

// A permanently bad API key surfaces as a `crash`, not a `network` failure (classify() matches
// connection and rate-limit strings, not 401s). So "infra-wait retries forever" cannot wedge a
// task on a misconfiguration — that path still dead-letters normally.
describe('task-specific failures consume the budget', () => {
  it('retries while attempts remain', () => {
    expect(decide({ failure: 'crash', attempts: 0 })).toBe('retry');
    expect(decide({ failure: 'crash', attempts: 2 })).toBe('retry');
  });

  it('the budget is the STAGE\'s, not a global constant', () => {
    expect(decide({ failure: 'crash', attempts: 4, maxAttempts: 9 })).toBe('retry');
    expect(decide({ failure: 'crash', attempts: 9, maxAttempts: 9 })).toBe('escalate');
  });

  it('timeout and stall are task-specific, not outages', () => {
    // An agent looping for 30 minutes is a fact about the task, and must burn the budget.
    expect(decide({ failure: 'timeout', attempts: 3 })).toBe('escalate');
    expect(decide({ failure: 'stall', attempts: 3, rescuesUsed: 1 })).toBe('dead-letter');
  });
});

// The graph's replacement for the old hard-coded rescue: a stage escalates only if it declares
// a `blocked` outcome, and where that outcome leads is drawn, not baked in.
describe('escalation is declared, not assumed', () => {
  it('a stage that declares `blocked` escalates once its retries are spent', () => {
    expect(decide({ failure: 'crash', attempts: 3 })).toBe('escalate');
  });

  it('a stage that declares no `blocked` outcome cannot escalate', () => {
    expect(decide({ failure: 'crash', attempts: 3, hasBlockedOutcome: false })).toBe('dead-letter');
  });

  it('the escalation budget is finite: build → plan → build cannot loop forever', () => {
    expect(decide({ failure: 'crash', attempts: 3, rescuesUsed: 0, maxRescues: 1 })).toBe('escalate');
    expect(decide({ failure: 'crash', attempts: 3, rescuesUsed: 1, maxRescues: 1 })).toBe('dead-letter');
  });

  it('a stage may be given more escalations', () => {
    expect(decide({ failure: 'crash', attempts: 3, rescuesUsed: 2, maxRescues: 5 })).toBe('escalate');
  });
});

// A stage running AFTER a passing verdict is advisory: the work is already proven, and a broken
// reviewer must not condemn it. This is the acceptance gate, expressed without naming it.
describe('verified work is never buried by a later stage', () => {
  it('goes to a human once its retries and escalations are spent', () => {
    expect(decide({ failure: 'crash', attempts: 3, qaPassed: true, hasBlockedOutcome: false })).toBe('human-review');
    expect(decide({ failure: 'crash', attempts: 3, qaPassed: true, rescuesUsed: 1 })).toBe('human-review');
  });

  it('but escalation still comes first when the stage declares it', () => {
    expect(decide({ failure: 'crash', attempts: 3, qaPassed: true })).toBe('escalate');
  });

  it('unverified work with nowhere to go dead-letters', () => {
    expect(decide({ failure: 'crash', attempts: 3, qaPassed: false, hasBlockedOutcome: false })).toBe('dead-letter');
  });

  it('verified work with no human gate in the graph dead-letters', () => {
    expect(decide({ failure: 'crash', attempts: 3, qaPassed: true, hasBlockedOutcome: false, hasHumanGate: false })).toBe('dead-letter');
  });
});

describe('ordering of the policy', () => {
  it('infra beats everything', () => {
    expect(decide({ failure: 'network', attempts: 3, qaPassed: true })).toBe('infra-wait');
  });

  it('retry beats escalation while the budget holds', () => {
    expect(decide({ failure: 'crash', attempts: 2, maxAttempts: 3 })).toBe('retry');
    expect(decide({ failure: 'crash', attempts: 3, maxAttempts: 3 })).toBe('escalate');
  });

  it('escalation beats human review', () => {
    expect(decide({ failure: 'crash', attempts: 3, qaPassed: true, hasBlockedOutcome: true })).toBe('escalate');
  });

  it('maxAttempts of 0 goes straight past retry', () => {
    expect(decide({ failure: 'crash', attempts: 0, maxAttempts: 0 })).toBe('escalate');
  });
});
