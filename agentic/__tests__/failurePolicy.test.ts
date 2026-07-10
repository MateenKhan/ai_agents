import { describe, it, expect } from 'vitest';
import { decideFailure, isInfraFailure } from '../engine/orchestrator';
import type { FailureKind, Stage } from '../types';

/** Defaults matching the shipped config: maxAttempts 3, one architect rescue. */
const base = {
  stage: 'build' as Stage,
  attempts: 0,
  maxAttempts: 3,
  rescueCount: 0,
  maxRescue: 1,
  architectEnabled: true,
};
const decide = (over: Partial<Parameters<typeof decideFailure>[0]> & { failure: FailureKind }) =>
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
// breakerFailure() opens the circuit on the 3rd consecutive network failure, and maxAttempts
// is also 3 — so an Anthropic outage exhausted a task's budget on the very tick the breaker
// tripped. The orchestrator then woke an opus ARCHITECT to re-plan a task whose plan was never
// the problem; that run failed for the same reason, and the task dead-lettered to BLOCKED.
// An API blip must never bury a task, and must never bill a re-plan.
describe('an infrastructure outage never costs the task anything', () => {
  it('waits instead of escalating, even with the retry budget fully spent', () => {
    expect(decide({ failure: 'network', attempts: 3 })).toBe('infra-wait');
  });

  it('waits at every stage — the architect cannot fix "Anthropic is down"', () => {
    const stages: Stage[] = ['intake', 'plan', 'build', 'qa', 'accept', 'merge'];
    for (const stage of stages) {
      expect(decide({ failure: 'network', stage, attempts: 99 })).toBe('infra-wait');
    }
  });

  it('waits even when the rescue budget is exhausted (would otherwise dead-letter)', () => {
    expect(decide({ failure: 'network', attempts: 3, rescueCount: 5, maxRescue: 1 })).toBe('infra-wait');
  });

  it('never dead-letters and never rescues on network, whatever the counters say', () => {
    for (const attempts of [0, 1, 3, 50]) {
      for (const rescueCount of [0, 1, 9]) {
        expect(decide({ failure: 'network', attempts, rescueCount })).toBe('infra-wait');
      }
    }
  });
});

// A permanently bad API key surfaces as a `crash`, not a `network` failure (classify() matches
// connection/rate-limit strings, not 401s). So "infra-wait retries forever" cannot wedge a task
// on a misconfiguration — that path still dead-letters normally.
describe('task-specific failures still consume the budget', () => {
  it('retries while attempts remain', () => {
    expect(decide({ failure: 'crash', attempts: 0 })).toBe('retry');
    expect(decide({ failure: 'crash', attempts: 2 })).toBe('retry');
  });

  it('escalates to the architect once the budget is spent at build or qa', () => {
    expect(decide({ failure: 'crash', attempts: 3, stage: 'build' })).toBe('rescue');
    expect(decide({ failure: 'crash', attempts: 3, stage: 'qa' })).toBe('rescue');
  });

  it('dead-letters when the rescue budget is also spent', () => {
    expect(decide({ failure: 'crash', attempts: 3, rescueCount: 1, maxRescue: 1 })).toBe('dead-letter');
  });

  it('dead-letters at architect-owned stages — nobody upstream to appeal to', () => {
    for (const stage of ['plan', 'rescue', 'merge'] as Stage[]) {
      expect(decide({ failure: 'crash', attempts: 3, stage })).toBe('dead-letter');
    }
  });

  it('dead-letters at build when no architect is enabled', () => {
    expect(decide({ failure: 'crash', attempts: 3, architectEnabled: false })).toBe('dead-letter');
  });

  it('timeout and stall are task-specific, not outages', () => {
    // An agent looping for 30 minutes is a fact about the task, and must burn the budget.
    expect(decide({ failure: 'timeout', attempts: 3 })).toBe('rescue');
    expect(decide({ failure: 'stall', attempts: 3, rescueCount: 1 })).toBe('dead-letter');
  });
});

describe('the owner accept gate is advisory', () => {
  it('a broken reviewer hands QA-approved work to the human, never to BLOCKED', () => {
    expect(decide({ failure: 'crash', attempts: 3, stage: 'accept' })).toBe('human-review');
    expect(decide({ failure: 'crash', attempts: 3, stage: 'accept', rescueCount: 9 })).toBe('human-review');
  });

  it('but a still-retrying accept run just retries', () => {
    expect(decide({ failure: 'crash', attempts: 1, stage: 'accept' })).toBe('retry');
  });
});

describe('ordering of the policy', () => {
  it('infra beats everything, including the accept gate', () => {
    expect(decide({ failure: 'network', attempts: 3, stage: 'accept' })).toBe('infra-wait');
  });

  it('retry beats rescue while the budget holds', () => {
    expect(decide({ failure: 'crash', attempts: 2, maxAttempts: 3 })).toBe('retry');
    expect(decide({ failure: 'crash', attempts: 3, maxAttempts: 3 })).toBe('rescue');
  });

  it('maxAttempts of 0 goes straight past retry', () => {
    expect(decide({ failure: 'crash', attempts: 0, maxAttempts: 0 })).toBe('rescue');
  });
});
