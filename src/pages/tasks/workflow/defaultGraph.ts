import type { WorkflowGraph } from './types';
import { DEFAULT_CAPS } from './types';
import { autoLayout } from './geometry';

/**
 * The shipped pipeline. `accept` (the owner's second gate) and `merged` (the terminal) are
 * both present — the design mock's saved graph had lost them, which is why its validator was
 * reporting six stranded stages.
 *
 * Note what the human stages do NOT have: a model, or a retry budget.
 */
export function defaultGraph(): WorkflowGraph {
  const stages: WorkflowGraph['stages'] = [
    { id: 'intake', role: 'owner', kind: 'agent', model: 'opus', caps: { ...DEFAULT_CAPS }, x: 0, y: 0 },
    { id: 'plan', role: 'architect', kind: 'agent', model: 'opus', caps: { ...DEFAULT_CAPS }, x: 0, y: 0 },
    { id: 'build', role: 'dev', kind: 'agent', model: 'sonnet', caps: { ...DEFAULT_CAPS }, x: 0, y: 0 },
    { id: 'qa', role: 'qa', kind: 'agent', model: 'sonnet', caps: { ...DEFAULT_CAPS }, x: 0, y: 0 },
    { id: 'accept', role: 'owner', kind: 'agent', model: 'opus', caps: { ...DEFAULT_CAPS }, x: 0, y: 0 },
    { id: 'review', role: 'you', kind: 'human', model: null, caps: null, x: 0, y: 0 },
    { id: 'merge', role: 'architect', kind: 'agent', model: 'opus', caps: { ...DEFAULT_CAPS }, x: 0, y: 0 },
    { id: 'merged', role: '—', kind: 'human', model: null, caps: null, x: 0, y: 0 },
  ];

  const edges: WorkflowGraph['edges'] = [
    ['intake', 'plan'],
    ['plan', 'build'],
    ['build', 'qa'],
    ['qa', 'accept'],
    ['accept', 'review'],
    ['review', 'merge'],
    ['merge', 'merged'],
  ];

  const pos = autoLayout(stages.map(s => s.id), edges, 'intake');
  for (const s of stages) Object.assign(s, pos[s.id]);

  return { v: 1, hopCap: 10, entry: 'intake', terminal: 'merged', stages, edges, asks: [] };
}
