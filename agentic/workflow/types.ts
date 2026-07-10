// ─────────────────────────────────────────────────────────────────────────────
// The workflow document — the shape the engine executes and the editor draws.
//
// Lives in agentic/ rather than src/ so the browser and the db-server run the IDENTICAL
// validator. A client that skipped validation could otherwise store a graph in which nothing
// reaches the terminal, and every task would strand in WORKING forever: never dispatched,
// never dead-lettered, invisible. That is the single failure this whole file exists to stop.
//
// Two ideas carry the design:
//
//  1. A stage's NAME means nothing to the engine. Call it `qa` or `tapora`. What the engine
//     reads is `behaviour`, which says whether the stage may set a QA verdict, whether it
//     takes the git merge lock, whether it parks the task for a human.
//
//  2. An agent reports an OUTCOME — a word describing what happened, like `pass` or
//     `blocked`. It never names a destination. Where an outcome leads is written here, by the
//     person who drew the graph. An agent therefore cannot skip a gate, and cannot orphan a
//     task by inventing a stage the way an architect once did with `stage="blocked"`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a stage is allowed to do. The engine keys every special power off this, never off the
 * stage id — otherwise renaming `merge` would silently disable the merge lock.
 */
export type Behaviour =
  /** Read-only worktree. Plans, does not write code. */
  | 'plan'
  /** Creates and owns `task/<id>`: the branch every later stage reuses. */
  | 'build'
  /** The ONLY behaviour permitted to write `qaVerdict`. */
  | 'verify'
  /** Parks the task and waits for a person. No agent, no model, no retries. */
  | 'human-gate'
  /** Takes the cross-machine merge lock and merges the task branch. */
  | 'merge'
  /** The task is done. No outcomes leave it. */
  | 'terminal'
  /** Runs an agent. No special powers. */
  | 'generic';

export const BEHAVIOURS: readonly Behaviour[] =
  ['plan', 'build', 'verify', 'human-gate', 'merge', 'terminal', 'generic'] as const;

/** Behaviours that run an agent, and therefore need a role, a model and a retry budget. */
export const AGENT_BEHAVIOURS: readonly Behaviour[] = ['plan', 'build', 'verify', 'merge', 'generic'] as const;

/** Behaviours that run no agent. A human gate waits for you; a terminal is the end. */
export const PASSIVE_BEHAVIOURS: readonly Behaviour[] = ['human-gate', 'terminal'] as const;

export const isAgentBehaviour = (b: Behaviour): boolean => AGENT_BEHAVIOURS.includes(b);

/**
 * `reject` is the verb an agent uses to send work back to whoever handed it over. It can never
 * be an outcome word, or `{"outcome":"reject"}` would be ambiguous: a routed exit, or a bounce?
 */
export const RESERVED_OUTCOMES: readonly string[] = ['reject'] as const;

/** Per-stage retry and timeout budget. Every field is a number the engine actually reads. */
export interface StageCaps {
  attempts: number;
  backoffSec: number;
  hardTimeoutMin: number;
  stallKillSec: number;
  /** Architect re-plans allowed from this stage. */
  rescues: number;
  /** Owner bounces allowed from this stage. */
  bounces: number;
  /** Merge-conflict kickbacks allowed from this stage. */
  conflicts: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** Git isolation for a stage's run. `plan` is a detached read-only checkout; `create` owns
 *  `task/<id>`; `reuse` attaches to the branch a `build` stage made; `none` is the main repo. */
export type WorktreeMode = 'plan' | 'create' | 'reuse' | 'none';

/**
 * The worktree a behaviour implies, when a stage does not say otherwise.
 *
 * `generic` gets `none`, because a generic stage usually touches no code. But the owner's
 * acceptance gate is generic AND has to read the dev's diff, so it overrides this with `reuse`.
 * That is why `Stage.worktree` exists.
 */
export const WORKTREE_FOR_BEHAVIOUR: Readonly<Record<Behaviour, WorktreeMode>> = Object.freeze({
  plan: 'plan',
  build: 'create',
  verify: 'reuse',
  merge: 'none',
  terminal: 'none',
  'human-gate': 'none',
  generic: 'none',
});

/**
 * One exit from a stage.
 *
 * An ARRAY, not an object keyed by `when`, for three reasons: an outcome carries more than a
 * destination (the `hint` an agent reads, the `side` a wire leaves from); the order is the
 * order the agent is shown and the order you drew; and objects give no ordering guarantee.
 * The price is that duplicate `when` values become possible, so the validator rejects them.
 */
export interface Outcome {
  /** The word the agent reports. The agent never sees `to`. */
  when: string;
  /** Stage id this outcome routes to. */
  to: string;
  /** Rendered into the agent's prompt: when to choose this outcome. */
  hint?: string;
  /** Layout only. */
  side?: Side;
}

export interface Stage {
  /** Free text. The engine never reads it for meaning. */
  id: string;
  behaviour: Behaviour;
  /** A role in the `agents` table. Null for `human-gate` and `terminal`. */
  agentRef: string | null;
  /** Null means "inherit the role's model from the agents table". */
  model: string | null;
  /** Null for `human-gate` and `terminal`: you do not retry a person. */
  caps: StageCaps | null;
  /** Overrides the worktree the behaviour implies. The owner's accept gate is `generic` but
   *  must read the dev's diff, so it sets `reuse`. */
  worktree?: WorktreeMode;
  /**
   * Which of the agent's prompt templates this stage runs.
   *
   * An agent row carries several: the architect has a planning prompt, a merge prompt and a
   * re-plan prompt; the owner has an intake prompt and an acceptance prompt. The STAGE picks,
   * because the same role appears at more than one stage. Absent means the default template.
   */
  promptRef?: 'default' | 'merge' | 'accept' | 'rescue';
  /** Where a reject goes. Null — the normal case — means back to whoever sent the task here. */
  reject?: string | null;
  /** Stages this one may consult mid-run. A consult does not move the task. */
  asks?: string[];
  /** Exits. Empty only for `terminal`. */
  outcomes: Outcome[];
  /** Layout only. The engine never reads this object. */
  ui?: { x: number; y: number; rejectSide?: Side; askCorner?: Corner };
}

export interface WorkflowDoc {
  v: 1;
  /** Bumped on every write. A PUT carrying a stale rev is rejected, never merged. */
  rev: number;
  /** Every reject is one hop, in any direction. At this many, the task goes to a human. */
  hopCap: number;
  /** Stage id a new task starts at. */
  entry: string;
  stages: Stage[];
}

export const DEFAULT_CAPS: StageCaps = {
  attempts: 3,
  backoffSec: 30,
  hardTimeoutMin: 30,
  stallKillSec: 180,
  rescues: 1,
  bounces: 2,
  conflicts: 3,
};

/** Convenience for the engine: id → stage, built once per document load. */
export function indexStages(doc: WorkflowDoc): ReadonlyMap<string, Stage> {
  return new Map(doc.stages.map(s => [s.id, s]));
}

/** The stage a `terminal` behaviour marks. Undefined for a malformed document. */
export function terminalStage(doc: WorkflowDoc): Stage | undefined {
  return doc.stages.find(s => s.behaviour === 'terminal');
}
