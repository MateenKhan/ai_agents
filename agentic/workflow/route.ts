// ─────────────────────────────────────────────────────────────────────────────
// Routing decisions, as pure functions.
//
// The orchestrator used to decide where a task went with a chain of `if` statements keyed on
// stage names, spread across a thousand lines. Those names are now free text, so the logic has
// to move somewhere it can be read and tested on its own. Nothing here touches the database,
// the filesystem, or a clock.
//
// The one rule that shapes every function below: an agent reports an OUTCOME, never a
// destination. Where an outcome leads is written in the document by whoever drew it. So an
// agent cannot skip a human gate, and cannot orphan a task by naming a stage that does not
// exist — the worst it can do is report a word we do not recognise, and we park the task and
// say which word it was.
// ─────────────────────────────────────────────────────────────────────────────

import {
  WORKTREE_FOR_BEHAVIOUR, isAgentBehaviour,
  type Stage, type StageCaps, type WorkflowDoc, type WorktreeMode,
} from './types';

// ── looking a stage up ────────────────────────────────────────────────────────

export function stageById(doc: WorkflowDoc, stageId: string | null | undefined): Stage | null {
  if (!stageId) return null;
  return doc.stages.find(s => s.id === stageId) ?? null;
}

/** The stage a brand-new task starts at. */
export function entryStage(doc: WorkflowDoc): Stage | null {
  return stageById(doc, doc.entry);
}

/** What the orchestrator should do with a task sitting at `stageId`. */
export type Placement =
  /** Run `stage.agentRef` here. */
  | { kind: 'dispatch'; stage: Stage }
  /** Park the task; a person must act. */
  | { kind: 'human-gate'; stage: Stage }
  /** The task is finished. */
  | { kind: 'terminal'; stage: Stage }
  /**
   * The task stands on a stage the document no longer contains. The save path refuses to
   * remove an occupied stage, but a document can be restored from a backup, or edited by hand,
   * or the task can carry a stage from an older revision. Park it loudly — this is the
   * `stage="blocked"` orphan class, and it must never be silent.
   */
  | { kind: 'unknown-stage'; stageId: string };

export function placeTask(doc: WorkflowDoc, stageId: string | null | undefined): Placement {
  // A task with no stage yet starts at the entry.
  const id = stageId || doc.entry;
  const stage = stageById(doc, id);
  if (!stage) return { kind: 'unknown-stage', stageId: id };
  if (stage.behaviour === 'terminal') return { kind: 'terminal', stage };
  if (stage.behaviour === 'human-gate') return { kind: 'human-gate', stage };
  return { kind: 'dispatch', stage };
}

// ── what an outcome means ─────────────────────────────────────────────────────

export type OutcomeDecision =
  | { kind: 'advance'; to: string; from: string }
  /** The agent reported a word this stage does not declare. Park; do not guess. */
  | { kind: 'unknown-outcome'; outcome: string; allowed: string[] }
  | { kind: 'unknown-stage'; stageId: string };

/**
 * Where does `outcome`, reported at `stageId`, send the task?
 *
 * Note there is no fallback. An unrecognised outcome does NOT quietly take the first exit: the
 * whole reason an agent cannot name a stage is so that it cannot route itself, and a lenient
 * default here would hand that power straight back.
 */
export function routeOutcome(doc: WorkflowDoc, stageId: string, outcome: string): OutcomeDecision {
  const stage = stageById(doc, stageId);
  if (!stage) return { kind: 'unknown-stage', stageId };

  const hit = stage.outcomes.find(o => o.when === outcome);
  if (!hit) return { kind: 'unknown-outcome', outcome, allowed: stage.outcomes.map(o => o.when) };
  return { kind: 'advance', to: hit.to, from: stageId };
}

/** The outcome words an agent at this stage may report, for rendering into its prompt. */
export function allowedOutcomes(doc: WorkflowDoc, stageId: string): Array<{ when: string; hint?: string }> {
  const stage = stageById(doc, stageId);
  if (!stage) return [];
  return stage.outcomes.map(o => ({ when: o.when, hint: o.hint }));
}

// ── reject: return to sender, and the hop cap ─────────────────────────────────

export type RejectDecision =
  /** Send it back. `hops` is the new count, already incremented. */
  | { kind: 'return'; to: string; hops: number }
  /**
   * The hop cap is spent. A task nobody can agree on is a person's problem, so it goes to a
   * human gate — never to BLOCKED. `to` is the gate; null means the graph has none, and the
   * caller must dead-letter instead.
   */
  | { kind: 'hop-cap'; to: string | null; hops: number }
  /** Nothing handed this task over, so there is nowhere to return it to. */
  | { kind: 'no-sender' }
  | { kind: 'unknown-stage'; stageId: string };

export interface RejectInput {
  stageId: string;
  /** The stage that routed the task here. The control plane records it; agents never set it. */
  handoffFrom: string | null | undefined;
  /** Hops used so far. */
  hops: number;
}

/**
 * A reject goes back to whoever handed the task over — not "the previous stage in the
 * pipeline". Those differ: when QA fails a task back to the dev, the dev's sender is QA, so
 * the dev's reject returns it to QA. That move goes FORWARD in stage order, which is exactly
 * why a hop cannot be counted by comparing positions. Every reject is one hop, in any
 * direction.
 */
export function routeReject(doc: WorkflowDoc, input: RejectInput): RejectDecision {
  const stage = stageById(doc, input.stageId);
  if (!stage) return { kind: 'unknown-stage', stageId: input.stageId };

  const hops = input.hops + 1;
  if (hops > doc.hopCap) return { kind: 'hop-cap', to: nearestHumanGate(doc, input.stageId), hops };

  // An explicit target is validated at save time: it must be a real sender of this stage.
  const target = stage.reject ?? input.handoffFrom ?? null;
  if (!target || !stageById(doc, target)) return { kind: 'no-sender' };
  return { kind: 'return', to: target, hops };
}

/** The closest human gate reachable from `from`, breadth-first. Null when the graph has none. */
export function nearestHumanGate(doc: WorkflowDoc, from: string): string | null {
  const next = new Map<string, string[]>();
  for (const s of doc.stages) next.set(s.id, s.outcomes.map(o => o.to));

  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    const s = stageById(doc, id);
    if (s && s.behaviour === 'human-gate' && id !== from) return id;
    for (const m of next.get(id) ?? []) if (!seen.has(m)) { seen.add(m); queue.push(m); }
  }
  // `from` itself may be the gate (a human rejecting from the gate).
  return stageById(doc, from)?.behaviour === 'human-gate' ? from : null;
}

// ── consult: an agent asks another agent, mid-task ────────────────────────────
//
// A consult does NOT move the task. The asking agent reports a question and exits, freeing its
// slot; a read-only advisor answers; the asking stage re-runs with the answer injected. Two
// hard rules keep it from becoming a back channel that routes work around the graph:
//   • PERMISSION — the target must be in this stage's `asks` list. The graph grants it.
//   • CAPS — at most two consults at any one stage, five across the whole task, so a task can
//     never loop consulting forever instead of finishing.
// (DEPTH-1 — an advisor may not itself consult — is enforced by the orchestrator, which never
// offers a consult to an advisor run; it is not a routing decision, so it is not modelled here.)

/** At most this many consults may be spent at a single stage. */
export const MAX_CONSULTS_PER_STAGE = 2;
/** At most this many consults may be spent across a whole task. */
export const MAX_CONSULTS_PER_TASK = 5;

export type ConsultDecision =
  /** Permitted — run the advisor. */
  | { kind: 'ok' }
  /** `to` is not in this stage's `asks`. The graph did not grant this consult. */
  | { kind: 'not-permitted'; allowed: string[] }
  /** This stage has already spent its consults. */
  | { kind: 'stage-cap'; cap: number }
  /** The task has spent its consults across every stage. */
  | { kind: 'task-cap'; cap: number };

/**
 * May the agent at `stage` consult `to`, given how many consults have already been spent at
 * this stage and across the task? Pure — the orchestrator supplies the counts.
 */
export function canConsult(
  stage: Stage,
  to: string,
  consultsUsedThisStage: number,
  consultsUsedThisTask: number,
): ConsultDecision {
  const allowed = stage.asks ?? [];
  if (!allowed.includes(to)) return { kind: 'not-permitted', allowed };
  if (consultsUsedThisTask >= MAX_CONSULTS_PER_TASK) return { kind: 'task-cap', cap: MAX_CONSULTS_PER_TASK };
  if (consultsUsedThisStage >= MAX_CONSULTS_PER_STAGE) return { kind: 'stage-cap', cap: MAX_CONSULTS_PER_STAGE };
  return { kind: 'ok' };
}

/** Consults already spent, from the task's consult log: per the given stage, and in total.
 *  Per-stage is counted off each entry's `from` (the stage the asking agent was at). */
export function consultsUsed(
  consultLog: ReadonlyArray<{ from: string }> | null | undefined,
  stageId: string,
): { stage: number; task: number } {
  const log = consultLog ?? [];
  return { stage: log.filter(e => e.from === stageId).length, task: log.length };
}

// ── what a stage is allowed to do ─────────────────────────────────────────────

/** Only a `verify` stage may write `qaVerdict`. Two verify stages would overwrite each other. */
export const mayWriteVerdict = (stage: Stage): boolean => stage.behaviour === 'verify';

/**
 * What `qaVerdict` should be after a stage has run.
 *
 * `qaVerdict` lives on the TASK, not on a stage, so every later stage sees the verdict a verify
 * stage wrote. Guarding on "does this stage have a verdict?" therefore destroys a legitimate
 * one: the owner's acceptance gate runs after QA, inherits `pass`, and would have it wiped.
 *
 * The rule is about CHANGE, not presence. A stage that is not a verify stage may not alter the
 * verdict — it may certainly carry one forward.
 */
export function reconcileVerdict<T extends string | null | undefined>(
  stage: Stage,
  before: T,
  after: T,
): { verdict: NonNullable<T> | null; rejected: boolean } {
  const b = (before ?? null) as NonNullable<T> | null;
  const a = (after ?? null) as NonNullable<T> | null;
  if (a === b) return { verdict: b, rejected: false };
  if (mayWriteVerdict(stage)) return { verdict: a, rejected: false };
  return { verdict: b, rejected: true };
}

/** Only a `merge` stage takes the cross-machine merge lock and runs `git merge`. */
export const takesMergeLock = (stage: Stage): boolean => stage.behaviour === 'merge';

/** A `build` stage creates `task/<id>`; everything after it reuses that branch. */
export const ownsBranch = (stage: Stage): boolean => stage.behaviour === 'build';

export const isHumanGate = (stage: Stage): boolean => stage.behaviour === 'human-gate';

/** The stage's worktree: its own override, else the one its behaviour implies. */
export function worktreeFor(stage: Stage): WorktreeMode {
  return stage.worktree ?? WORKTREE_FOR_BEHAVIOUR[stage.behaviour];
}

/**
 * The model this stage runs on. The stage wins; the agents table is the default.
 *
 * That ordering is what lets one role appear at two stages with different models — the owner on
 * opus at intake and haiku at accept — which a table keyed by role cannot express.
 */
export function modelFor(stage: Stage, roleDefaultModel: string | undefined): string | null {
  return stage.model ?? roleDefaultModel ?? null;
}

/** The retry budget for this stage, or null for a stage that runs no agent. */
export function capsFor(stage: Stage): StageCaps | null {
  return isAgentBehaviour(stage.behaviour) ? stage.caps : null;
}
