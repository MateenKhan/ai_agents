// ─────────────────────────────────────────────────────────────────────────────
// Graph validation — the control that stops the editor producing a graph that strands tasks.
//
// A stage that cannot reach the terminal leaves its tasks in WORKING forever: never
// dispatched, never dead-lettered, invisible on the board. That exact failure has happened
// three times in this system (an agent inventing stage="blocked"; the owner's two
// independent enable switches; a system role that was never backfilled). Each time it was
// silent. So Save is blocked until this returns ok.
//
// Pure: no DOM, no React. Every rule below is a test.
// ─────────────────────────────────────────────────────────────────────────────

import type { WorkflowGraph, Stage } from './types';

export interface StageIssue {
  stageId: string;
  reasons: string[];
}

export interface ValidationResult {
  ok: boolean;
  /** Problems attributable to a stage — the editor highlights these nodes. */
  stageIssues: StageIssue[];
  /** Problems with the graph as a whole (missing entry, bad hop cap). */
  graphErrors: string[];
}

/** Breadth-first reachable set from `start` over adjacency `g`. */
function reach(start: string, g: Record<string, string[]>, known: Set<string>): Set<string> {
  const seen = new Set<string>();
  if (!known.has(start)) return seen;
  const queue = [start];
  seen.add(start);
  while (queue.length) {
    const n = queue.shift()!;
    for (const m of g[n] || []) if (!seen.has(m)) { seen.add(m); queue.push(m); }
  }
  return seen;
}

export function validateGraph(graph: WorkflowGraph): ValidationResult {
  const graphErrors: string[] = [];
  const issues = new Map<string, string[]>();
  const addIssue = (id: string, reason: string) => {
    const list = issues.get(id) ?? [];
    list.push(reason);
    issues.set(id, list);
  };

  const ids = new Set(graph.stages.map(s => s.id));
  const byId = new Map<string, Stage>(graph.stages.map(s => [s.id, s]));

  if (graph.stages.length === 0) graphErrors.push('the workflow has no stages');
  if (!ids.has(graph.entry)) graphErrors.push(`entry stage "${graph.entry}" does not exist`);
  if (!ids.has(graph.terminal)) graphErrors.push(`terminal stage "${graph.terminal}" does not exist`);
  if (!Number.isInteger(graph.hopCap) || graph.hopCap < 1) graphErrors.push('hop cap must be a whole number of at least 1');

  // Duplicate ids would make every lookup ambiguous, and the editor keys nodes by id.
  const seenIds = new Set<string>();
  for (const s of graph.stages) {
    if (seenIds.has(s.id)) graphErrors.push(`duplicate stage id "${s.id}"`);
    seenIds.add(s.id);
  }

  const fwd: Record<string, string[]> = {};
  const rev: Record<string, string[]> = {};
  for (const id of ids) { fwd[id] = []; rev[id] = []; }
  for (const [from, to] of graph.edges) {
    if (!ids.has(from) || !ids.has(to)) {
      graphErrors.push(`edge ${from} → ${to} names a stage that does not exist`);
      continue;
    }
    fwd[from].push(to);
    rev[to].push(from);
  }

  const fromEntry = ids.has(graph.entry) ? reach(graph.entry, fwd, ids) : new Set<string>();
  const toTerminal = ids.has(graph.terminal) ? reach(graph.terminal, rev, ids) : new Set<string>();

  for (const s of graph.stages) {
    // The two that strand tasks.
    if (s.id !== graph.terminal && !toTerminal.has(s.id)) addIssue(s.id, `cannot reach ${graph.terminal}`);
    if (s.id !== graph.entry && !fromEntry.has(s.id)) addIssue(s.id, `unreachable from ${graph.entry}`);

    // One accept target. The engine routes one stage to exactly one successor; two forward
    // edges would silently pick whichever the array happened to hold first.
    const out = fwd[s.id] ?? [];
    if (out.length > 1) addIssue(s.id, `has ${out.length} accept routes — a stage may have at most one`);
    if (s.id !== graph.terminal && out.length === 0) addIssue(s.id, 'has no accept route, so work stops here');

    if (s.kind === 'agent') {
      if (!s.role || s.role === '—') addIssue(s.id, 'no agent assigned');
      if (!s.model) addIssue(s.id, 'no model assigned');
      if (!s.caps) addIssue(s.id, 'no retry budget');
      else {
        if (s.caps.attempts < 1) addIssue(s.id, 'max attempts must be at least 1');
        if (s.caps.hardTimeoutMin < 1) addIssue(s.id, 'hard timeout must be at least 1 minute');
        if (s.caps.backoffSec < 0 || s.caps.stallKillSec < 0) addIssue(s.id, 'backoff and stall kill cannot be negative');
      }
    } else {
      // A human has no model and no retries. Carrying them means the agent node template
      // leaked, and the UI will offer to retry a person.
      if (s.model) addIssue(s.id, 'a human stage cannot have a model');
      if (s.caps) addIssue(s.id, 'a human stage cannot have retries');
    }

    // Reject is return-to-sender. An explicit target is only legitimate if that stage has
    // actually handed work here — otherwise `dev.reject = 'merged'` lets a task skip QA by
    // rejecting, which is a hole an agent will eventually find.
    if (s.reject !== undefined) {
      if (!ids.has(s.reject)) addIssue(s.id, `reject target "${s.reject}" does not exist`);
      else if (s.reject === s.id) addIssue(s.id, 'cannot reject to itself');
      else if (!(rev[s.id] ?? []).includes(s.reject)) {
        addIssue(s.id, `cannot reject to "${s.reject}" — it never hands work to this stage`);
      }
    }
  }

  for (const [from, to] of graph.asks) {
    if (!ids.has(from) || !ids.has(to)) { graphErrors.push(`ask ${from} → ${to} names a stage that does not exist`); continue; }
    if (from === to) addIssue(from, 'cannot consult itself');
    // Only BO reaches the human, and it does so by handing the task to the review gate —
    // never as a consult. An agent blocked on a person holds its pool slot indefinitely.
    if (byId.get(to)?.kind === 'human') addIssue(from, 'cannot consult a human stage — hand the task to the review gate instead');
  }

  const stageIssues: StageIssue[] = [...issues.entries()].map(([stageId, reasons]) => ({ stageId, reasons }));
  return { ok: graphErrors.length === 0 && stageIssues.length === 0, stageIssues, graphErrors };
}
