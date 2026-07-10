import { describe, expect, it } from 'vitest';
import { occupiedStageConflicts, validateWorkflow } from '../validate';
import { defaultWorkflow } from '../defaultWorkflow';
import { DEFAULT_CAPS, indexStages, terminalStage, type Stage, type WorkflowDoc } from '../types';

const reasons = (doc: WorkflowDoc, id: string) =>
  validateWorkflow(doc).stageIssues.find(i => i.stageId === id)?.reasons ?? [];
const errors = (doc: WorkflowDoc) => validateWorkflow(doc).docErrors;
const stage = (doc: WorkflowDoc, id: string) => doc.stages.find(s => s.id === id)!;

describe('the shipped pipeline', () => {
  it('is valid', () => {
    const r = validateWorkflow(defaultWorkflow());
    expect(r.docErrors).toEqual([]);
    expect(r.stageIssues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('routes every stage to the terminal', () => {
    const doc = defaultWorkflow();
    expect(terminalStage(doc)!.id).toBe('merged');
    expect(indexStages(doc).size).toBe(8);
  });
});

// The entire point of the redesign: names carry no meaning, `behaviour` does.
describe('names are free text', () => {
  it('renaming every stage to nonsense leaves the workflow valid', () => {
    const doc = defaultWorkflow();
    const rename: Record<string, string> = {
      intake: 'aaa', plan: 'bbb', build: 'ccc', qa: 'tapora',
      accept: 'eee', review: 'fff', merge: 'ggg', merged: 'hhh',
    };
    for (const s of doc.stages) {
      s.outcomes = s.outcomes.map(o => ({ ...o, to: rename[o.to] ?? o.to }));
      s.asks = (s.asks ?? []).map(a => rename[a] ?? a);
      s.id = rename[s.id];
    }
    doc.entry = 'aaa';

    expect(validateWorkflow(doc).ok).toBe(true);
    // `tapora` still holds the QA powers, because behaviour travelled with it.
    expect(stage(doc, 'tapora').behaviour).toBe('verify');
    expect(stage(doc, 'ggg').behaviour).toBe('merge');
  });
});

describe('stranded stages', () => {
  it('flags a stage that cannot reach the terminal', () => {
    const doc = defaultWorkflow();
    stage(doc, 'qa').outcomes = [];
    expect(reasons(doc, 'qa')).toContain('has no outcomes, so work stops here');
    expect(reasons(doc, 'build')).toContain('cannot reach the terminal stage "merged"');
    expect(validateWorkflow(doc).ok).toBe(false);
  });

  it('flags a stage unreachable from the entry', () => {
    const doc = defaultWorkflow();
    doc.stages.push({
      id: 'orphan', behaviour: 'generic', agentRef: 'dev', model: 'sonnet', caps: { ...DEFAULT_CAPS },
      outcomes: [{ when: 'done', to: 'merged' }],
    } as Stage);
    expect(reasons(doc, 'orphan')).toContain('unreachable from the entry stage "intake"');
  });

  it('an outcome pointing at a stage that does not exist is rejected', () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').outcomes[0].to = 'ghost';
    expect(reasons(doc, 'build')).toContain('outcome "done" routes to "ghost", which does not exist');
  });

  it('a self-routing outcome would spin forever', () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').outcomes[0].to = 'build';
    expect(reasons(doc, 'build')).toContain('outcome "done" routes to itself, which would spin forever');
  });
});

describe('terminal and merge', () => {
  it('a workflow with no terminal cannot finish', () => {
    const doc = defaultWorkflow();
    stage(doc, 'merged').behaviour = 'generic';
    expect(errors(doc)).toContain('no stage has behaviour "terminal", so no task can ever finish');
  });

  it('two terminals are rejected', () => {
    const doc = defaultWorkflow();
    stage(doc, 'review').behaviour = 'terminal';
    expect(errors(doc).some(e => e.includes('there must be exactly one'))).toBe(true);
  });

  it('two merge stages would both take the merge lock', () => {
    const doc = defaultWorkflow();
    stage(doc, 'accept').behaviour = 'merge';
    expect(errors(doc).some(e => e.includes('only one may hold the merge lock'))).toBe(true);
  });

  it('a terminal cannot route anywhere', () => {
    const doc = defaultWorkflow();
    stage(doc, 'merged').outcomes = [{ when: 'again', to: 'intake' }];
    expect(reasons(doc, 'merged')).toContain('a terminal stage cannot route anywhere');
  });

  it('a merge with no build before it has nothing to merge', () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').behaviour = 'generic';   // no stage creates the branch any more
    expect(reasons(doc, 'merge')).toContain('nothing to merge — no "build" stage runs before it');
  });

  it('the entry cannot also be the terminal', () => {
    const doc: WorkflowDoc = { v: 1, rev: 1, hopCap: 10, entry: 'only', stages: [
      { id: 'only', behaviour: 'terminal', agentRef: null, model: null, caps: null, outcomes: [] },
    ] };
    expect(errors(doc)).toContain('the entry stage cannot also be the terminal');
  });
});

describe('outcomes', () => {
  it('a duplicate outcome name is rejected — the array cannot enforce it, so the validator does', () => {
    const doc = defaultWorkflow();
    stage(doc, 'qa').outcomes.push({ when: 'pass', to: 'build' });
    expect(reasons(doc, 'qa')).toContain('outcome "pass" is declared twice');
  });

  it('"reject" is reserved: it is the verb for bouncing to the sender', () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').outcomes.push({ when: 'reject', to: 'qa' });
    expect(reasons(doc, 'build')).toContain('"reject" is a reserved word and cannot be an outcome');
  });

  it('an unnamed outcome is rejected', () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').outcomes.push({ when: '  ', to: 'qa' });
    expect(reasons(doc, 'build')).toContain('an outcome has no name');
  });

  it('several outcomes from one stage are fine — that is conditional routing', () => {
    expect(stage(defaultWorkflow(), 'qa').outcomes).toHaveLength(3);
    expect(validateWorkflow(defaultWorkflow()).ok).toBe(true);
  });

  it('several stages routing into one are fine — that is fan-in', () => {
    const doc = defaultWorkflow();
    // qa/fail, accept/rework, review/rejected and merge/conflict all point at build already.
    const intoBuild = doc.stages.filter(s => s.outcomes.some(o => o.to === 'build'));
    expect(intoBuild.length).toBeGreaterThan(1);
    expect(validateWorkflow(doc).ok).toBe(true);
  });
});

describe('agent stages versus passive stages', () => {
  it('a human gate carries no agent, model or retries — you do not retry a person', () => {
    const doc = defaultWorkflow();
    const review = stage(doc, 'review');
    review.agentRef = 'qa';
    review.model = 'sonnet';
    review.caps = { ...DEFAULT_CAPS };
    const r = reasons(doc, 'review');
    expect(r).toContain('a human-gate stage cannot have an agent');
    expect(r).toContain('a human-gate stage cannot have a model');
    expect(r).toContain('a human-gate stage cannot have retries');
  });

  it('an agent stage needs an agent, a model and a budget', () => {
    const doc = defaultWorkflow();
    const build = stage(doc, 'build');
    build.agentRef = null;
    build.model = null;
    build.caps = null;
    const r = reasons(doc, 'build');
    expect(r).toContain('no agent assigned');
    expect(r).toContain('no model assigned');
    expect(r).toContain('no retry budget');
  });

  it('nonsense caps are rejected', () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').caps = { ...DEFAULT_CAPS, attempts: 0, hardTimeoutMin: 0, backoffSec: -1, rescues: -2 };
    const r = reasons(doc, 'build');
    expect(r).toContain('max attempts must be at least 1');
    expect(r).toContain('hard timeout must be at least 1 minute');
    expect(r).toContain('backoff and stall kill cannot be negative');
    expect(r).toContain('caps cannot be negative');
  });

  it('an unknown behaviour is rejected', () => {
    const doc = defaultWorkflow();
    (stage(doc, 'build') as unknown as { behaviour: string }).behaviour = 'teleport';
    expect(reasons(doc, 'build')).toContain('unknown behaviour "teleport"');
  });
});

// `build.reject = 'merged'` would let a task skip QA by rejecting. Reject is return-to-sender.
describe('reject targets', () => {
  it('null means return to sender, and is always valid', () => {
    expect(validateWorkflow(defaultWorkflow()).ok).toBe(true);
  });

  it('an explicit target that really hands work here is allowed', () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').reject = 'plan';        // plan → build exists
    expect(reasons(doc, 'build')).toEqual([]);
  });

  it('a target that never hands work here is refused', () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').reject = 'merged';
    expect(reasons(doc, 'build')).toContain('cannot reject to "merged" — it never hands work to this stage');
  });

  it('self-rejection and unknown targets are refused', () => {
    const a = defaultWorkflow(); stage(a, 'build').reject = 'build';
    expect(reasons(a, 'build')).toContain('cannot reject to itself');
    const b = defaultWorkflow(); stage(b, 'build').reject = 'ghost';
    expect(reasons(b, 'build')).toContain('reject target "ghost" does not exist');
  });
});

describe('consults', () => {
  it('an agent may not consult a human gate — it would hold its pool slot waiting on a person', () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').asks = ['review'];
    expect(reasons(doc, 'build')).toContain('cannot consult "review" — it is a human-gate stage, not an agent');
  });

  it('an agent may not consult itself, nor a stage that does not exist', () => {
    const a = defaultWorkflow(); stage(a, 'build').asks = ['build'];
    expect(reasons(a, 'build')).toContain('cannot consult itself');
    const b = defaultWorkflow(); stage(b, 'build').asks = ['ghost'];
    expect(reasons(b, 'build')).toContain('consults "ghost", which does not exist');
  });

  it('agent-to-agent consults are fine in any direction, including forward', () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').asks = ['qa'];     // qa has not run yet; still legal
    expect(validateWorkflow(doc).ok).toBe(true);
  });
});

describe('document-level rules', () => {
  it('rev and hopCap must be whole numbers of at least 1', () => {
    const doc = defaultWorkflow();
    doc.hopCap = 0; doc.rev = 0;
    expect(errors(doc)).toContain('hop cap must be a whole number of at least 1');
    expect(errors(doc)).toContain('rev must be a whole number of at least 1');
    doc.hopCap = 2.5;
    expect(errors(doc)).toContain('hop cap must be a whole number of at least 1');
  });

  it('a duplicate stage id is rejected', () => {
    const doc = defaultWorkflow();
    doc.stages.push({ ...stage(doc, 'build') });
    expect(errors(doc)).toContain('duplicate stage id "build"');
  });

  it('an entry that does not exist is rejected', () => {
    const doc = defaultWorkflow();
    doc.entry = 'nope';
    expect(errors(doc)).toContain('entry stage "nope" does not exist');
  });

  it('an empty workflow is not valid', () => {
    expect(validateWorkflow({ v: 1, rev: 1, hopCap: 10, entry: 'a', stages: [] }).ok).toBe(false);
  });
});

// The validator cannot catch this: the document is internally perfect, and the task is already
// standing on `qa` when you delete `qa`.
describe('occupiedStageConflicts', () => {
  it('allows every harmless edit while the board is running', () => {
    const doc = defaultWorkflow();
    stage(doc, 'build').caps!.attempts = 9;       // raise a cap
    stage(doc, 'build').ui = { x: 5, y: 5 };      // move a node
    stage(doc, 'qa').outcomes[0].hint = 'reworded';
    expect(occupiedStageConflicts(doc, ['build', 'qa'])).toEqual([]);
  });

  it('refuses to delete a stage a task is standing on', () => {
    const doc = defaultWorkflow();
    doc.stages = doc.stages.filter(s => s.id !== 'qa');
    expect(occupiedStageConflicts(doc, ['qa']))
      .toContain('stage "qa" cannot be removed or renamed: a task is running there');
  });

  it('refuses to rename a stage a task is standing on', () => {
    const doc = defaultWorkflow();
    stage(doc, 'qa').id = 'tapora';
    expect(occupiedStageConflicts(doc, ['qa']))
      .toContain('stage "qa" cannot be removed or renamed: a task is running there');
  });

  it('refuses to strip the outcomes of a stage a task is standing on', () => {
    const doc = defaultWorkflow();
    stage(doc, 'qa').outcomes = [];
    expect(occupiedStageConflicts(doc, ['qa']))
      .toContain('stage "qa" cannot lose its outcomes: a task is running there and would have nowhere to go');
  });

  it('says nothing about stages no task occupies', () => {
    const doc = defaultWorkflow();
    doc.stages = doc.stages.filter(s => s.id !== 'accept');
    expect(occupiedStageConflicts(doc, ['build'])).toEqual([]);
  });

  it('a terminal stage may keep no outcomes even while occupied', () => {
    expect(occupiedStageConflicts(defaultWorkflow(), ['merged'])).toEqual([]);
  });
});
