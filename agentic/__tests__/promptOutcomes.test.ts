import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { buildConfig, setConfig } from '../index';
import { renderPrompt } from '../engine/prompts';
import { DEFAULT_AGENTS } from '../db/defaults';
import { defaultWorkflow } from '../workflow/defaultWorkflow';
import { allowedOutcomes } from '../workflow/route';
import type { AgentConfig, Task } from '../types';

beforeAll(() => {
  const cfg = buildConfig();
  cfg.paths.tasksDbPath = join(tmpdir(), `mc-prompt-${randomBytes(6).toString('hex')}.db`);
  setConfig(cfg);
});

const doc = defaultWorkflow();
const agent = (role: string): AgentConfig => DEFAULT_AGENTS.find(a => a.role === role)!;
const task = (over: Partial<Task> = {}): Task => ({
  id: 'T-1', title: 'Add a tagline', status: 'WORKING', priority: 0, ...over,
} as Task);

const render = (role: string, stageId: string, t: Task = task()) => {
  const stage = doc.stages.find(s => s.id === stageId)!;
  return renderPrompt(agent(role), t, stageId, {
    promptRef: stage.promptRef,
    outcomes: allowedOutcomes(doc, stageId),
  });
};

// THE POINT OF THE WHOLE CHANGE. Twelve `"stage":"qa"` strings used to live in these templates.
// Rename `qa` to `tapora` and every one of them pointed at nothing.
describe('no prompt names a stage', () => {
  it('the shipped templates contain no hard-coded stage', () => {
    for (const a of DEFAULT_AGENTS) {
      for (const tpl of [a.promptTemplate, a.mergePromptTemplate, a.acceptPromptTemplate, a.rescuePromptTemplate]) {
        if (!tpl) continue;
        expect(tpl).not.toMatch(/"stage"\s*:/);
      }
    }
  });

  it('a rendered dev prompt never mentions the stage it routes to', async () => {
    const out = await render('dev', 'build');
    expect(out).not.toContain('"stage"');
    // It is told the WORDS, not the destinations.
    expect(out).toContain('"outcome"');
    expect(out).toContain('"done"');
    expect(out).toContain('"blocked"');
    // `qa` is where `done` leads. The dev must never be told that.
    expect(out).not.toMatch(/"outcome"\s*:\s*"qa"/);
  });
});

describe('the outcomes block', () => {
  it('lists exactly the words this stage declares, with their hints', async () => {
    const out = await render('qa', 'qa');
    expect(out).toContain('- "pass"');
    expect(out).toContain('- "fail"');
    expect(out).toContain('- "blocked"');
    expect(out).toContain('every scenario has passing evidence');
    expect(out).not.toContain('- "accepted"');   // that is the owner's word, at another stage
  });

  it('teaches the reject verb, and warns it is budgeted', async () => {
    const out = await render('dev', 'build');
    expect(out).toContain('"reject"');
    expect(out).toMatch(/returns the task to whoever handed it over/);
    expect(out).toMatch(/never because the work is merely hard/);
  });

  it('warns that an unlisted word parks the task', async () => {
    const out = await render('dev', 'build');
    expect(out).toMatch(/not on this list will park the task/);
  });

  it('is appended even to a template that never mentions {{outcomes}}', async () => {
    // A custom agent, or a stale row, would otherwise leave its agent with no way to finish —
    // and the orchestrator would fail it for reporting nothing.
    const custom: AgentConfig = {
      role: 'custom', label: 'Custom', enabled: true, model: 'sonnet',
      worktreeMode: 'none', ord: 9, isSystem: false,
      promptTemplate: 'Do the thing for {{taskId}}. No placeholder here.',
    };
    const out = await renderPrompt(custom, task(), 'build', { outcomes: allowedOutcomes(doc, 'build') });
    expect(out).toContain('HOW TO FINISH');
    expect(out).toContain('- "done"');
  });

  it('a stage with no outcomes renders no block, rather than an empty heading', async () => {
    const out = await renderPrompt(agent('dev'), task(), 'merged', { outcomes: [] });
    expect(out).not.toContain('HOW TO FINISH');
  });
});

// A consult lets an agent ask a peer mid-task — but only a peer the stage's `asks` names.
describe('the consult block', () => {
  it('lists ONLY the agents passed as asks, with the consult curl', async () => {
    const out = await renderPrompt(agent('dev'), task(), 'build', {
      outcomes: allowedOutcomes(doc, 'build'),
      asks: [{ to: 'plan', agent: 'architect' }, { to: 'intake', agent: 'owner' }],
    });
    expect(out).toContain('CONSULT');
    expect(out).toContain('- "plan"');
    expect(out).toContain('- "intake"');
    expect(out).toContain('"consult"');
    // a peer NOT granted must never appear — inverting the gate would leak it
    expect(out).not.toContain('- "qa"');
  });

  it('lists only the single granted peer when asks has one entry', async () => {
    const out = await renderPrompt(agent('dev'), task(), 'build', {
      outcomes: allowedOutcomes(doc, 'build'),
      asks: [{ to: 'plan', agent: 'architect' }],
    });
    expect(out).toContain('- "plan"');
    expect(out).not.toContain('- "intake"');
  });

  it('is absent entirely when the stage grants no asks', async () => {
    const out = await renderPrompt(agent('dev'), task(), 'build', {
      outcomes: allowedOutcomes(doc, 'build'),
      asks: [],
    });
    expect(out).not.toContain('CONSULT');
    expect(out).not.toContain('"consult"');
  });

  it('renders a stored answer back into the re-dispatched prompt', async () => {
    const t = task({ consultLog: [{ from: 'build', to: 'plan', question: 'which file?', answer: 'edit foo.ts', at: '2020' }] });
    const out = await renderPrompt(agent('dev'), t, 'build', {
      outcomes: allowedOutcomes(doc, 'build'),
      asks: [{ to: 'plan', agent: 'architect' }],
    });
    expect(out).toContain('ANSWERS TO YOUR EARLIER CONSULTS');
    expect(out).toContain('which file?');
    expect(out).toContain('edit foo.ts');
  });
});

// One role, several stages. The STAGE picks the template, because the name no longer can.
describe('promptRef picks the template', () => {
  it('the owner gets its intake template at intake and its accept template at accept', async () => {
    const intake = await render('owner', 'intake');
    const accept = await render('owner', 'accept');
    expect(intake).toContain('turn the user\'s ask into acceptance scenarios');
    expect(accept).toContain('DOES THIS DELIVER WHAT THE USER ASKED FOR');
    expect(intake).not.toBe(accept);
  });

  it('the architect gets its merge template at the merge stage', async () => {
    const plan = await render('architect', 'plan');
    const merge = await render('architect', 'merge');
    expect(merge).toContain('git merge --no-ff');
    expect(plan).not.toContain('git merge --no-ff');
  });

  it('a task escalated by `blocked` gets the architect\'s re-plan template', async () => {
    const cold = await render('architect', 'plan');
    const escalated = await render('architect', 'plan', task({ lastOutcome: 'blocked' }));
    expect(escalated).toContain('rescue stage');
    expect(cold).not.toContain('rescue stage');
  });
});

// Rename every stage to nonsense. Not one prompt changes.
describe('renaming a stage touches no prompt', () => {
  it('the dev prompt is byte-identical after `qa` becomes `tapora`', async () => {
    const before = await render('dev', 'build');

    const renamed = defaultWorkflow();
    for (const s of renamed.stages) {
      s.outcomes = s.outcomes.map(o => (o.to === 'qa' ? { ...o, to: 'tapora' } : o));
      s.asks = (s.asks ?? []).map(a => (a === 'qa' ? 'tapora' : a));
      if (s.id === 'qa') s.id = 'tapora';
    }
    const stage = renamed.stages.find(s => s.id === 'build')!;
    const after = await renderPrompt(agent('dev'), task(), 'build', {
      promptRef: stage.promptRef,
      outcomes: allowedOutcomes(renamed, 'build'),
    });

    expect(after).toBe(before);
    expect(after).not.toContain('tapora');   // the dev is never told where `done` leads
  });
});

// The retry no longer runs blind: a failed attempt's distilled reason is prepended so the
// re-dispatched agent reads WHAT went wrong (architect-review gap #1/#2).
describe('failureDetail injection', () => {
  it('prepends "PREVIOUS ATTEMPT FAILED" with the detail when failureDetail is set', async () => {
    const out = await render('dev', 'build', task({ failureDetail: 'crash\nTypeError: slugify is not a function' }));
    expect(out).toContain('PREVIOUS ATTEMPT FAILED');
    expect(out).toContain('TypeError: slugify is not a function');
  });

  it('says nothing about a previous failure on a clean first run', async () => {
    const out = await render('dev', 'build');
    expect(out).not.toContain('PREVIOUS ATTEMPT FAILED');
  });
});

// The stage journal gives a re-dispatched or downstream agent the trail, not just the latest
// summary (architect-review gap #4).
describe('stage journal injection', () => {
  it('renders STAGE HISTORY from the journal, most-recent-last', async () => {
    const out = await render('dev', 'build', task({ journal: [
      { ts: '2020-01-01T00:00:00Z', stage: 'plan', agent: 'architect', outcome: 'done', note: 'the plan' },
      { ts: '2020-01-01T00:05:00Z', stage: 'qa', agent: 'qa', outcome: 'reject', note: 'test missing' },
    ] }));
    expect(out).toContain('STAGE HISTORY');
    expect(out).toContain('plan (architect) → done');
    expect(out).toContain('qa (qa) → reject: test missing');
  });

  it('renders nothing when the journal is empty', async () => {
    const out = await render('dev', 'build', task({ journal: [] }));
    expect(out).not.toContain('STAGE HISTORY');
  });
});
