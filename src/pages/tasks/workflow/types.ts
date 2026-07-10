// ─────────────────────────────────────────────────────────────────────────────
// Workflow graph — the persisted shape.
//
// Three changes from the design mock's `{v, stages, edges, asks}`:
//
//  1. `caps` is NUMBERS, not the display string 'attempts 3'. The mock rendered a caps
//     editor whose inputs were bound to nothing; the values could never round-trip.
//  2. `hopCap` lives on the GRAPH, not on a stage. It counts rejects across every edge in
//     every direction, so a per-stage copy would get a different value on each node.
//  3. `entry` / `terminal` are named rather than hard-coded to 'intake' / 'merged', so a
//     renamed stage cannot silently make the validator check the wrong thing.
//
// A `human` stage carries no model and no caps. You do not retry a person.
// ─────────────────────────────────────────────────────────────────────────────

export type StageKind = 'agent' | 'human';
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** Per-stage retry + timeout budget. Every field is a real number the engine reads. */
export interface StageCaps {
  /** Dispatches of this stage before it escalates. */
  attempts: number;
  /** Base backoff between attempts. */
  backoffSec: number;
  /** Wall-clock kill for one agent run. */
  hardTimeoutMin: number;
  /** No output for this long → the agent is stuck in a loop; kill it. */
  stallKillSec: number;
  /** Architect re-plans allowed from this stage. */
  rescues: number;
  /** Owner bounces allowed from this stage. */
  bounces: number;
  /** Merge-conflict kickbacks allowed from this stage. */
  conflicts: number;
}

export interface Stage {
  id: string;
  /** 'owner' | 'architect' | 'dev' | 'qa' for agents; the human gate uses 'you'. */
  role: string;
  kind: StageKind;
  /** null for human stages. */
  model: string | null;
  /** null for human stages. */
  caps: StageCaps | null;
  /**
   * Explicit reject target. Absent means the default and correct behaviour: return to
   * whoever handed the task over. An explicit value is validated — it must be a stage that
   * actually has an edge into this one, or `dev.reject = 'merged'` would let a task skip QA
   * by rejecting.
   */
  reject?: string;
  rejSide?: Side;
  rejToSide?: Side;
  /** Layout only. Never read by the engine. */
  x: number;
  y: number;
}

/** Forward routing on success. `[from, to, fromSide?, toSide?]` — sides are layout hints. */
export type Edge = [string, string, Side?, Side?];

/**
 * Who may consult whom, mid-run. NOT routing: an ask does not move the task, and the task
 * keeps its stage. The depth-1 rule (a consultant may not itself consult) and the async
 * spawn are enforced by the orchestrator, not drawn here.
 */
export type Ask = [string, string, Corner?, Corner?];

export interface WorkflowGraph {
  v: 1;
  /** Every reject is one hop, whatever the direction. At this many, the task goes to a human. */
  hopCap: number;
  /** Stage id a new task starts at. */
  entry: string;
  /** Stage id that means "done". Every other stage must be able to reach it. */
  terminal: string;
  stages: Stage[];
  edges: Edge[];
  asks: Ask[];
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

/** Roles the engine knows. A stage may name a custom role; the validator only checks it is set. */
export const AGENT_ROLES = ['owner', 'architect', 'dev', 'qa'] as const;
export const MODELS = ['opus', 'sonnet', 'haiku'] as const;
