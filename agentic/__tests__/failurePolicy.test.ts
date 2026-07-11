import { describe, it, expect } from 'vitest';
import { decideFailure, isInfraFailure, failureDetailFrom, withJournal, redactSecrets } from '../engine/orchestrator';
import type { FailureKind, Task } from '../types';

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

// ── failure summary + stage journal (architect-review gaps #1/#2 and #4) ──────
describe('failureDetailFrom', () => {
  it('prefixes the label and keeps the LAST 40 lines of output', () => {
    const many = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n');
    const out = failureDetailFrom('crash', many);
    expect(out.startsWith('crash\n')).toBe(true);
    expect(out).toContain('line99');       // last line kept
    expect(out).not.toContain('line50');   // beyond the 40-line window, dropped
    expect(out.split('\n').length).toBeLessThanOrEqual(41); // label + <=40 lines
  });

  it('is just the label when there is no output', () => {
    expect(failureDetailFrom('timeout', '')).toBe('timeout');
    expect(failureDetailFrom('timeout', '   \n  ')).toBe('timeout'); // whitespace trims away
  });
});

describe('withJournal', () => {
  const t = (over: Partial<Task> = {}): Task => ({ id: 'J', title: 't', status: 'WORKING', priority: 0, ...over } as Task);

  it('appends a timestamped entry to an empty journal', () => {
    const j = withJournal(t(), { stage: 'build', agent: 'dev', outcome: 'pass', note: 'did it' });
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ stage: 'build', agent: 'dev', outcome: 'pass', note: 'did it' });
    expect(typeof j[0].ts).toBe('string');
  });

  it('preserves prior entries and their order', () => {
    const prior = [{ ts: '2020', stage: 'plan', agent: 'architect', outcome: 'done' }];
    const j = withJournal(t({ journal: prior }), { stage: 'build', agent: 'dev', outcome: 'pass' });
    expect(j.map(e => e.stage)).toEqual(['plan', 'build']);
  });

  it('caps at 20 entries, keeping the most recent', () => {
    const prior = Array.from({ length: 25 }, (_, i) => ({ ts: String(i), stage: `s${i}`, agent: 'a', outcome: 'pass' }));
    const j = withJournal(t({ journal: prior }), { stage: 'newest', agent: 'a', outcome: 'pass' });
    expect(j).toHaveLength(20);
    expect(j[j.length - 1].stage).toBe('newest');
    expect(j[0].stage).toBe('s6'); // oldest 6 dropped (25 + 1 - 20)
  });

  it('trims and collapses whitespace in the note, capping length', () => {
    const j = withJournal(t(), { stage: 'x', agent: 'a', outcome: 'pass', note: '  a\n\n  b   c  ' + 'z'.repeat(400) });
    expect(j[0].note!.length).toBeLessThanOrEqual(200);
    expect(j[0].note!.startsWith('a b c')).toBe(true);
  });
});

describe('redactSecrets', () => {
  it('masks GitHub tokens', () => {
    expect(redactSecrets('cloning with ghs_abcdefghijklmnopqrstuvwxyz012345')).not.toContain('ghs_abcdefghijklmnopqrstuvwxyz');
    expect(redactSecrets('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')).toContain('gh?_***');
  });
  it('masks user:pass@ inside urls', () => {
    const out = redactSecrets('fatal: unable to access https://x-access-token:ghs_secretvalue@github.com/o/r.git');
    expect(out).not.toContain('ghs_secretvalue');
    expect(out).toContain('***@github.com');
  });
  it('masks Bearer / token= / password= pairs', () => {
    expect(redactSecrets('Authorization: Bearer sk-supersecretvalue')).not.toContain('sk-supersecretvalue');
    expect(redactSecrets('token=abc123def456')).not.toContain('abc123def456');
  });
  it('leaves ordinary error text intact', () => {
    expect(redactSecrets('TypeError: slugify is not a function')).toBe('TypeError: slugify is not a function');
  });
});

it('failureDetailFrom redacts secrets in the captured tail', () => {
  const out = failureDetailFrom('crash', 'auth failed for https://x-access-token:ghs_leakedleakedleaked@github.com');
  expect(out).not.toContain('ghs_leakedleakedleaked');
});
