// ─────────────────────────────────────────────────────────────────────────────
// Workflow validation.
//
// Runs in the browser to disable the Save button, and AGAIN on the server before the document
// is written. The server's copy is the one that matters: a client can be skipped with `curl`,
// and a workflow in which some stage cannot reach the terminal strands every task that reaches
// it — in WORKING forever, never dispatched, never dead-lettered, invisible on the board.
//
// That exact class of bug has bitten this system three times: an architect inventing
// `stage="blocked"`; the business owner's two independent enable switches disagreeing; a system
// role that was never backfilled into the agents table. Each time it was silent. Hence: pure
// function, no DOM, no db, every rule a test.
// ─────────────────────────────────────────────────────────────────────────────

import {
  isAgentBehaviour, BEHAVIOURS, RESERVED_OUTCOMES,
  type Stage, type WorkflowDoc, type WorktreeMode,
} from './types';

const WORKTREES: readonly WorktreeMode[] = ['plan', 'create', 'reuse', 'none'];

export interface StageIssue {
  stageId: string;
  reasons: string[];
}

export interface ValidationResult {
  ok: boolean;
  /** Attributable to a stage. The editor highlights these nodes and links to them. */
  stageIssues: StageIssue[];
  /** Problems with the document as a whole. */
  docErrors: string[];
}

/** Breadth-first reachable set from `start` over adjacency `g`. */
function reach(start: string, g: ReadonlyMap<string, string[]>, known: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>();
  if (!known.has(start)) return seen;
  const queue: string[] = [start];
  seen.add(start);
  while (queue.length) {
    const n = queue.shift()!;
    for (const m of g.get(n) ?? []) if (!seen.has(m)) { seen.add(m); queue.push(m); }
  }
  return seen;
}

export function validateWorkflow(doc: WorkflowDoc): ValidationResult {
  const docErrors: string[] = [];
  const issues = new Map<string, string[]>();
  const add = (id: string, reason: string) => {
    const list = issues.get(id) ?? [];
    list.push(reason);
    issues.set(id, list);
  };

  const stages: Stage[] = Array.isArray(doc?.stages) ? doc.stages : [];
  if (stages.length === 0) docErrors.push('the workflow has no stages');
  if (!Number.isInteger(doc?.rev) || doc.rev < 1) docErrors.push('rev must be a whole number of at least 1');
  if (!Number.isInteger(doc?.hopCap) || doc.hopCap < 1) docErrors.push('hop cap must be a whole number of at least 1');

  const ids = new Set<string>();
  for (const s of stages) {
    if (ids.has(s.id)) docErrors.push(`duplicate stage id "${s.id}"`);
    ids.add(s.id);
    if (!s.id || !s.id.trim()) docErrors.push('a stage has an empty id');
    if (!BEHAVIOURS.includes(s.behaviour)) add(s.id, `unknown behaviour "${s.behaviour}"`);
  }

  if (!ids.has(doc?.entry)) docErrors.push(`entry stage "${doc?.entry}" does not exist`);

  // ── exactly one terminal, at most one merge ────────────────────────────────
  const terminals = stages.filter(s => s.behaviour === 'terminal');
  if (terminals.length === 0) docErrors.push('no stage has behaviour "terminal", so no task can ever finish');
  if (terminals.length > 1) docErrors.push(`${terminals.length} stages have behaviour "terminal"; there must be exactly one`);
  const terminalId = terminals[0]?.id;

  const merges = stages.filter(s => s.behaviour === 'merge');
  if (merges.length > 1) docErrors.push(`${merges.length} stages have behaviour "merge"; only one may hold the merge lock`);

  if (terminalId && doc.entry === terminalId) docErrors.push('the entry stage cannot also be the terminal');

  // ── adjacency, built from outcomes ─────────────────────────────────────────
  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  for (const id of ids) { fwd.set(id, []); rev.set(id, []); }

  for (const s of stages) {
    const outcomes = Array.isArray(s.outcomes) ? s.outcomes : [];
    const seenWhen = new Set<string>();

    for (const o of outcomes) {
      if (!o.when || !o.when.trim()) { add(s.id, 'an outcome has no name'); continue; }
      if (seenWhen.has(o.when)) add(s.id, `outcome "${o.when}" is declared twice`);
      seenWhen.add(o.when);

      // `{"outcome":"reject"}` would be ambiguous: a routed exit, or a bounce to the sender?
      if (RESERVED_OUTCOMES.includes(o.when)) add(s.id, `"${o.when}" is a reserved word and cannot be an outcome`);

      if (!ids.has(o.to)) { add(s.id, `outcome "${o.when}" routes to "${o.to}", which does not exist`); continue; }
      if (o.to === s.id) { add(s.id, `outcome "${o.when}" routes to itself, which would spin forever`); continue; }

      fwd.get(s.id)!.push(o.to);
      rev.get(o.to)!.push(s.id);
    }

    if (s.behaviour === 'terminal') {
      if (outcomes.length) add(s.id, 'a terminal stage cannot route anywhere');
    } else if (outcomes.length === 0) {
      add(s.id, 'has no outcomes, so work stops here');
    }
  }

  const fromEntry = ids.has(doc?.entry) ? reach(doc.entry, fwd, ids) : new Set<string>();
  const toTerminal = terminalId ? reach(terminalId, rev, ids) : new Set<string>();

  for (const s of stages) {
    // The two rules that stop a task stranding.
    if (s.behaviour !== 'terminal' && !toTerminal.has(s.id)) add(s.id, `cannot reach the terminal stage${terminalId ? ` "${terminalId}"` : ''}`);
    if (s.id !== doc?.entry && !fromEntry.has(s.id)) add(s.id, `unreachable from the entry stage "${doc?.entry}"`);

    if (isAgentBehaviour(s.behaviour)) {
      if (!s.agentRef) add(s.id, 'no agent assigned');
      if (!s.model) add(s.id, 'no model assigned');
      if (!s.caps) add(s.id, 'no retry budget');
      else {
        const c = s.caps;
        if (!Number.isFinite(c.attempts) || c.attempts < 1) add(s.id, 'max attempts must be at least 1');
        if (!Number.isFinite(c.hardTimeoutMin) || c.hardTimeoutMin < 1) add(s.id, 'hard timeout must be at least 1 minute');
        if (c.backoffSec < 0 || c.stallKillSec < 0) add(s.id, 'backoff and stall kill cannot be negative');
        if (c.rescues < 0 || c.bounces < 0 || c.conflicts < 0) add(s.id, 'caps cannot be negative');
      }
      if (s.worktree && !WORKTREES.includes(s.worktree)) add(s.id, `unknown worktree mode "${s.worktree}"`);
    } else {
      // A human gate carrying a model means the agent node template leaked, and the UI will
      // cheerfully offer to retry a person.
      if (s.agentRef) add(s.id, `a ${s.behaviour} stage cannot have an agent`);
      if (s.model) add(s.id, `a ${s.behaviour} stage cannot have a model`);
      if (s.caps) add(s.id, `a ${s.behaviour} stage cannot have retries`);
      if (s.worktree) add(s.id, `a ${s.behaviour} stage runs no agent, so it has no worktree`);
    }

    // Reject is return-to-sender. An explicit target is only legitimate if that stage really
    // hands work here; otherwise `build.reject = terminal` lets a task skip QA by rejecting.
    if (s.reject != null) {
      if (!ids.has(s.reject)) add(s.id, `reject target "${s.reject}" does not exist`);
      else if (s.reject === s.id) add(s.id, 'cannot reject to itself');
      else if (!(rev.get(s.id) ?? []).includes(s.reject)) add(s.id, `cannot reject to "${s.reject}" — it never hands work to this stage`);
    }

    for (const target of s.asks ?? []) {
      if (!ids.has(target)) { add(s.id, `consults "${target}", which does not exist`); continue; }
      if (target === s.id) { add(s.id, 'cannot consult itself'); continue; }
      const t = stages.find(x => x.id === target)!;
      // An agent blocked on a person holds its pool slot indefinitely. Only the pipeline
      // reaches a human, by handing the task to a human-gate stage.
      if (!isAgentBehaviour(t.behaviour)) add(s.id, `cannot consult "${target}" — it is a ${t.behaviour} stage, not an agent`);
    }
  }

  // A merge with nothing to merge: the branch is created by a `build` stage.
  if (merges.length === 1) {
    const mergeId = merges[0].id;
    const ancestorsOfMerge = reach(mergeId, rev, ids);
    const hasBuildBefore = stages.some(s => s.behaviour === 'build' && ancestorsOfMerge.has(s.id));
    if (!hasBuildBefore) add(mergeId, 'nothing to merge — no "build" stage runs before it');
  }

  const stageIssues: StageIssue[] = [...issues.entries()].map(([stageId, reasons]) => ({ stageId, reasons }));
  return { ok: docErrors.length === 0 && stageIssues.length === 0, stageIssues, docErrors };
}

/**
 * Refuse an edit that would pull the ground from under a task that is standing on it.
 *
 * The validator above cannot catch this: the document is internally perfect, and the task is
 * already sitting at `qa` when you delete `qa`. Called by the PUT handler with the stage ids of
 * every live (non-terminal, non-blocked) task, inside the same transaction as the write.
 *
 * Deliberately narrow. Moving a node, renaming a caption, raising `attempts` from 3 to 5 — all
 * of that stays legal while the board runs. Only removing a live task's ground is refused.
 */
export function occupiedStageConflicts(next: WorkflowDoc, occupiedStageIds: readonly string[]): string[] {
  const nextIds = new Set(next.stages.map(s => s.id));
  const errors: string[] = [];
  for (const id of new Set(occupiedStageIds)) {
    if (!nextIds.has(id)) {
      errors.push(`stage "${id}" cannot be removed or renamed: a task is running there`);
      continue;
    }
    const s = next.stages.find(x => x.id === id)!;
    if (s.behaviour !== 'terminal' && (!Array.isArray(s.outcomes) || s.outcomes.length === 0)) {
      errors.push(`stage "${id}" cannot lose its outcomes: a task is running there and would have nowhere to go`);
    }
  }
  return errors;
}
