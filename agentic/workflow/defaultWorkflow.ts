// ─────────────────────────────────────────────────────────────────────────────
// The shipped pipeline, written in the workflow document's own language.
//
// This is what a fresh install gets, and what the engine falls back to when no document has
// been saved. Read it as the reference for how outcomes map onto today's hard-coded routing.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_CAPS, type Stage, type WorkflowDoc } from './types';

const caps = () => ({ ...DEFAULT_CAPS });

/**
 * intake → plan → build → qa → accept → review → merge → merged
 *
 * The names are conventional, not load-bearing. Every special power comes from `behaviour`:
 * `merge` takes the merge lock because it says `behaviour: 'merge'`, not because it is called
 * "merge". Rename it to `ship` and nothing changes.
 */
export function defaultWorkflow(): WorkflowDoc {
  const stages: Stage[] = [
    {
      id: 'intake',
      behaviour: 'generic',          // the owner turns your ask into scenarios; touches no code
      agentRef: 'owner',
      model: 'opus',
      caps: caps(),
      outcomes: [
        { when: 'done', to: 'plan', hint: 'the acceptance scenarios are written and unambiguous' },
        { when: 'needs-input', to: 'review', hint: 'the ask is under-specified; a person must choose' },
      ],
      asks: [],
      ui: { x: 40, y: 40 },
    },
    {
      id: 'plan',
      behaviour: 'plan',             // read-only worktree
      agentRef: 'architect',
      model: 'opus',
      caps: caps(),
      outcomes: [{ when: 'done', to: 'build', hint: 'the dev brief and the QA brief are written' }],
      asks: ['intake'],
      ui: { x: 360, y: 40 },
    },
    {
      id: 'build',
      behaviour: 'build',            // creates and owns task/<id>
      agentRef: 'dev',
      model: 'sonnet',
      caps: caps(),
      outcomes: [
        { when: 'done', to: 'qa', hint: 'the work is committed and the sanity checks pass' },
        { when: 'blocked', to: 'plan', hint: 'the brief is impossible or contradictory; it needs re-planning' },
      ],
      asks: ['plan', 'intake'],
      ui: { x: 680, y: 40 },
    },
    {
      id: 'qa',
      behaviour: 'verify',           // the ONLY stage that may write qaVerdict
      agentRef: 'qa',
      model: 'sonnet',
      caps: caps(),
      outcomes: [
        { when: 'pass', to: 'accept', hint: 'every scenario has passing evidence' },
        { when: 'fail', to: 'build', hint: 'the code is wrong or incomplete' },
        { when: 'blocked', to: 'plan', hint: 'the scenarios are untestable; it cannot be verified as briefed' },
      ],
      asks: ['build', 'plan'],
      ui: { x: 1000, y: 40 },
    },
    {
      id: 'accept',
      behaviour: 'generic',          // the owner judges the diff against the original ask
      agentRef: 'owner',
      model: 'opus',
      caps: caps(),
      // Generic implies `none`, but this gate has to READ the dev's diff, so it attaches to
      // the branch the build stage made. This is why Stage.worktree exists.
      worktree: 'reuse',
      promptRef: 'accept',      // the owner's SECOND template, not its intake one
      outcomes: [
        { when: 'accepted', to: 'review', hint: 'it delivers what the user asked for' },
        { when: 'rework', to: 'build', hint: 'the plan was right; the implementation missed something' },
        { when: 'replan', to: 'plan', hint: 'the plan itself answered the wrong question' },
      ],
      asks: ['qa', 'build'],
      ui: { x: 1320, y: 40 },
    },
    {
      id: 'review',
      behaviour: 'human-gate',       // parks for you. no agent, no model, no retries.
      agentRef: null,
      model: null,
      caps: null,
      outcomes: [
        { when: 'approved', to: 'merge', hint: 'you approved the work' },
        { when: 'rejected', to: 'build', hint: 'you sent it back with a note' },
      ],
      ui: { x: 1640, y: 40 },
    },
    {
      id: 'merge',
      behaviour: 'merge',            // takes the cross-machine merge lock
      agentRef: 'architect',
      model: 'opus',
      caps: caps(),
      promptRef: 'merge',            // the architect's merge template, not its planning one
      outcomes: [
        { when: 'done', to: 'merged', hint: 'the branch merged cleanly and the checks pass' },
        { when: 'conflict', to: 'build', hint: 'the branch conflicts; the dev must rebase and re-verify' },
      ],
      asks: [],
      ui: { x: 1960, y: 40 },
    },
    {
      id: 'merged',
      behaviour: 'terminal',
      agentRef: null,
      model: null,
      caps: null,
      outcomes: [],
      ui: { x: 2280, y: 40 },
    },
  ];

  return { v: 1, rev: 1, hopCap: 10, entry: 'intake', stages };
}
