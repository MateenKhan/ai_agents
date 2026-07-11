// ─────────────────────────────────────────────────────────────────────────────
// Pure prompt-block builders (gap 46).
//
// `consultBlock` is the exported, store-free builder that turns a stage's `asks`
// (the peers it may consult) plus any already-answered consults into the prompt
// section an agent reads. It touches no database and no config, so it is unit-tested
// directly here — a level below promptOutcomes.test.ts, which exercises the same
// block indirectly through renderPrompt(). No temp DB is needed because nothing this
// file calls reads or writes a store.
//
// `outcomesBlock` is NOT exported from engine/prompts.ts (it is a module-private
// helper), so it is intentionally left to promptOutcomes.test.ts, which covers it via
// renderPrompt. We do not widen the export surface just to test it.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';

import { consultBlock } from '../engine/prompts';
import type { PromptAsk } from '../engine/prompts';
import type { ConsultEntry } from '../types';

const TASK_ID = 'T-42';
const answered = (over: Partial<ConsultEntry> = {}): ConsultEntry => ({
  from: 'build', to: 'plan', question: 'which file owns slugify?', answer: 'edit src/slug.ts', at: '2020-01-01T00:00:00Z', ...over,
});

describe('consultBlock — no asks', () => {
  it('renders nothing when the stage grants no peers', () => {
    expect(consultBlock(TASK_ID, [])).toBe('');
  });

  it('renders nothing even if an answered consult exists but no peers are granted', () => {
    // asks gates the block: without a granted peer the agent may not consult at all,
    // so there is nothing to show — not even prior answers.
    expect(consultBlock(TASK_ID, [], [answered()])).toBe('');
  });
});

describe('consultBlock — with asks', () => {
  const asks: PromptAsk[] = [
    { to: 'plan', agent: 'architect', hint: 'design questions' },
    { to: 'intake', agent: 'owner' },
  ];

  it('names each granted peer, with its human label and hint', () => {
    const out = consultBlock(TASK_ID, asks);
    expect(out).toContain('- "plan" — the architect (design questions)');
    expect(out).toContain('- "intake" — the owner');
  });

  it('teaches the consult verb and that it is NOT a handoff', () => {
    const out = consultBlock(TASK_ID, asks);
    expect(out).toContain('CONSULT');
    expect(out).toContain('"consult"');
    expect(out).toMatch(/NOT a handoff/);
    // the report verb is wired to THIS task's id
    expect(out).toContain(`/tasks/${TASK_ID}`);
  });

  it('lists ONLY the granted peers — a role the stage never asked for cannot appear', () => {
    const out = consultBlock(TASK_ID, [{ to: 'plan', agent: 'architect' }]);
    expect(out).toContain('- "plan"');
    expect(out).not.toContain('- "intake"');
    expect(out).not.toContain('- "qa"');
  });
});

describe('consultBlock — prior answers are rendered back', () => {
  const asks: PromptAsk[] = [{ to: 'plan', agent: 'architect' }];

  it('renders an already-answered consult so a re-dispatched agent sees the advice', () => {
    const out = consultBlock(TASK_ID, asks, [answered()]);
    expect(out).toContain('ANSWERS TO YOUR EARLIER CONSULTS');
    expect(out).toContain('which file owns slugify?');
    expect(out).toContain('edit src/slug.ts');
  });

  it('shows only ANSWERED consults — a pending (unanswered) request is not echoed', () => {
    const out = consultBlock(TASK_ID, asks, [
      answered({ question: 'answered one', answer: 'here it is' }),
      answered({ question: 'still pending', answer: '' }), // no answer yet
    ]);
    expect(out).toContain('answered one');
    expect(out).toContain('here it is');
    expect(out).not.toContain('still pending');
  });

  it('omits the answers section entirely when nothing has been answered yet', () => {
    const out = consultBlock(TASK_ID, asks, [answered({ answer: '' })]);
    expect(out).toContain('CONSULT');                        // the invitation is still there
    expect(out).not.toContain('ANSWERS TO YOUR EARLIER CONSULTS');
  });
});
