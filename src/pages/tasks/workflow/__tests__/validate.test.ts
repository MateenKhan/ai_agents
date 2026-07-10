import { describe, expect, it } from 'vitest';
import { validateGraph } from '../validate';
import { defaultGraph } from '../defaultGraph';
import { DEFAULT_CAPS, type WorkflowGraph } from '../types';

const reasonsFor = (g: WorkflowGraph, id: string) =>
  validateGraph(g).stageIssues.find(i => i.stageId === id)?.reasons ?? [];

describe('the shipped pipeline', () => {
  it('is valid', () => {
    const r = validateGraph(defaultGraph());
    expect(r.graphErrors).toEqual([]);
    expect(r.stageIssues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('includes the owner accept gate and the merged terminal', () => {
    // The mock's saved graph had lost both, which is why it reported six stranded stages.
    const ids = defaultGraph().stages.map(s => s.id);
    expect(ids).toContain('accept');
    expect(ids).toContain('merged');
  });
});

// The failure this validator exists to prevent: a stage that cannot reach the terminal leaves
// its tasks in WORKING forever — never dispatched, never dead-lettered, invisible.
describe('stranded stages', () => {
  it('flags a stage that cannot reach the terminal', () => {
    const g = defaultGraph();
    g.edges = g.edges.filter(e => !(e[0] === 'qa'));   // qa now leads nowhere
    expect(reasonsFor(g, 'qa')).toContain('has no accept route, so work stops here');
    expect(reasonsFor(g, 'build')).toContain('cannot reach merged');
    expect(validateGraph(g).ok).toBe(false);
  });

  it('flags a stage unreachable from the entry', () => {
    const g = defaultGraph();
    g.stages.push({ id: 'orphan', role: 'dev', kind: 'agent', model: 'sonnet', caps: { ...DEFAULT_CAPS }, x: 0, y: 0 });
    g.edges.push(['orphan', 'merged']);
    expect(reasonsFor(g, 'orphan')).toContain('unreachable from intake');
  });

  it('deleting the terminal invalidates the whole graph', () => {
    const g = defaultGraph();
    g.stages = g.stages.filter(s => s.id !== 'merged');
    expect(validateGraph(g).graphErrors).toContain('terminal stage "merged" does not exist');
  });

  it('names entry and terminal rather than hard-coding them', () => {
    const g = defaultGraph();
    g.entry = 'nope';
    expect(validateGraph(g).graphErrors).toContain('entry stage "nope" does not exist');
  });
});

describe('one accept route per stage', () => {
  it('rejects branching — the engine routes a stage to exactly one successor', () => {
    const g = defaultGraph();
    g.edges.push(['build', 'merge']);   // build now forks to qa AND merge
    expect(reasonsFor(g, 'build')).toContain('has 2 accept routes — a stage may have at most one');
  });
});

// `dev.reject = 'merged'` would let a task skip QA by rejecting. Reject is return-to-sender,
// so an explicit target is only legitimate if that stage actually hands work here.
describe('reject targets', () => {
  it('allows an explicit target that is a real sender', () => {
    const g = defaultGraph();
    const build = g.stages.find(s => s.id === 'build')!;
    build.reject = 'plan';   // plan → build exists
    expect(reasonsFor(g, 'build')).toEqual([]);
  });

  it('refuses a target that never hands work to this stage', () => {
    const g = defaultGraph();
    const build = g.stages.find(s => s.id === 'build')!;
    build.reject = 'merged';
    expect(reasonsFor(g, 'build')).toContain('cannot reject to "merged" — it never hands work to this stage');
  });

  it('refuses self-rejection and unknown stages', () => {
    const g = defaultGraph();
    g.stages.find(s => s.id === 'build')!.reject = 'build';
    expect(reasonsFor(g, 'build')).toContain('cannot reject to itself');

    const g2 = defaultGraph();
    g2.stages.find(s => s.id === 'build')!.reject = 'ghost';
    expect(reasonsFor(g2, 'build')).toContain('reject target "ghost" does not exist');
  });

  it('an absent reject target means return-to-sender and is always valid', () => {
    expect(validateGraph(defaultGraph()).ok).toBe(true);
  });
});

describe('human stages', () => {
  it('cannot carry a model or a retry budget — you do not retry a person', () => {
    const g = defaultGraph();
    const review = g.stages.find(s => s.id === 'review')!;
    review.model = 'sonnet';
    review.caps = { ...DEFAULT_CAPS };
    const reasons = reasonsFor(g, 'review');
    expect(reasons).toContain('a human stage cannot have a model');
    expect(reasons).toContain('a human stage cannot have retries');
  });
});

describe('agent stages need a real budget', () => {
  it('flags a missing model or role', () => {
    const g = defaultGraph();
    const build = g.stages.find(s => s.id === 'build')!;
    build.model = null;
    build.role = '—';
    const reasons = reasonsFor(g, 'build');
    expect(reasons).toContain('no model assigned');
    expect(reasons).toContain('no agent assigned');
  });

  it('flags nonsense caps', () => {
    const g = defaultGraph();
    const build = g.stages.find(s => s.id === 'build')!;
    build.caps = { ...DEFAULT_CAPS, attempts: 0, hardTimeoutMin: 0, backoffSec: -1 };
    const reasons = reasonsFor(g, 'build');
    expect(reasons).toContain('max attempts must be at least 1');
    expect(reasons).toContain('hard timeout must be at least 1 minute');
    expect(reasons).toContain('backoff and stall kill cannot be negative');
  });
});

describe('consults', () => {
  it('an agent may not consult a human — it would hold its pool slot waiting on a person', () => {
    const g = defaultGraph();
    g.asks.push(['build', 'review']);
    expect(reasonsFor(g, 'build')).toContain('cannot consult a human stage — hand the task to the review gate instead');
  });

  it('an agent may not consult itself', () => {
    const g = defaultGraph();
    g.asks.push(['build', 'build']);
    expect(reasonsFor(g, 'build')).toContain('cannot consult itself');
  });

  it('agent-to-agent consults are fine in any direction, including forward', () => {
    const g = defaultGraph();
    g.asks.push(['build', 'qa'], ['qa', 'intake']);
    expect(validateGraph(g).ok).toBe(true);
  });
});

describe('graph-level rules', () => {
  it('the hop cap must be a whole number of at least 1', () => {
    const g = defaultGraph();
    g.hopCap = 0;
    expect(validateGraph(g).graphErrors).toContain('hop cap must be a whole number of at least 1');
    g.hopCap = 2.5;
    expect(validateGraph(g).graphErrors).toContain('hop cap must be a whole number of at least 1');
  });

  it('duplicate stage ids are rejected', () => {
    const g = defaultGraph();
    g.stages.push({ ...g.stages[0] });
    expect(validateGraph(g).graphErrors).toContain('duplicate stage id "intake"');
  });

  it('an edge naming a missing stage is rejected', () => {
    const g = defaultGraph();
    g.edges.push(['build', 'ghost']);
    expect(validateGraph(g).graphErrors).toContain('edge build → ghost names a stage that does not exist');
  });

  it('an empty workflow is not valid', () => {
    expect(validateGraph({ v: 1, hopCap: 10, entry: 'a', terminal: 'b', stages: [], edges: [], asks: [] }).ok).toBe(false);
  });
});
