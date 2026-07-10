// ─────────────────────────────────────────────────────────────────────────────
// Project a task onto the workflow document.
//
// Pure, so the read-only "where is my task" view can be tested without a DOM. The rules are
// small but easy to get subtly wrong, and a wrong answer here means the popup confidently
// shows a task at the wrong stage.
//
// The graph is now the engine's `WorkflowDoc`: routing lives in each stage's `outcomes`, not in
// a separate `edges` array. The happy path is the chain of FIRST outcomes from the entry — the
// same order the pipeline runs when nothing rejects.
// ─────────────────────────────────────────────────────────────────────────────

import type { WorkflowDoc } from './workflowApi';
import type { RunSnapshot, RunState } from './WorkflowEditor';

/** Minimal shape needed from a board task. Kept structural so this file imports no UI types. */
export interface TaskLike {
  id: string;
  status: string;
  stage?: string | null;
  qaVerdict?: string | null;
  lastError?: string | null;
  /** Not yet a real column — reject/consult is unbuilt. Reads as 0 until it exists. */
  hops?: number;
  logPath?: string | null;
}

/**
 * The stage order, walked forward from `entry` along each stage's FIRST outcome (its happy
 * path). A malformed document can branch or loop; the walk follows one successor per stage and
 * is guarded against a cycle so it can never hang the browser.
 */
export function stageOrder(doc: WorkflowDoc): string[] {
  const next = new Map<string, string>();
  for (const s of doc.stages) {
    const first = (s.outcomes ?? [])[0];
    if (first && !next.has(s.id)) next.set(s.id, first.to);
  }

  const order: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = doc.entry;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    order.push(cur);
    cur = next.get(cur);
  }
  return order;
}

/**
 * Map a task's status + stage onto per-stage run states.
 *
 * DONE means every stage succeeded, whatever `stage` says — a completed task that still
 * carries `stage: 'merge'` must not render as though it were mid-merge.
 * BLOCKED marks the current stage as failed rather than running, because nothing is running.
 */
export function runSnapshotForTask(doc: WorkflowDoc, task: TaskLike): RunSnapshot {
  const order = stageOrder(doc);
  const stages: Record<string, { state: RunState; note?: string }> = {};

  const idx = task.stage ? order.indexOf(task.stage) : -1;
  const done = task.status === 'DONE';

  order.forEach((id, i) => {
    if (done) { stages[id] = { state: 'done' }; return; }
    if (idx < 0) { stages[id] = { state: 'pending' }; return; }   // never dispatched, or unknown stage
    if (i < idx) { stages[id] = { state: 'done' }; return; }
    if (i > idx) { stages[id] = { state: 'pending' }; return; }

    // The current stage.
    if (task.status === 'BLOCKED') {
      stages[id] = { state: 'timeout', note: task.lastError ?? 'blocked — needs a human' };
    } else if (task.qaVerdict === 'fail') {
      stages[id] = { state: 'rejected', note: 'QA failed — back to the developer' };
    } else if (task.status === 'WORKING') {
      stages[id] = { state: 'running' };
    } else {
      // TESTING (parked at the human gate), TODO, AVAILABLE — reached, not executing.
      stages[id] = { state: 'pending' };
    }
  });

  return {
    taskId: task.id,
    hops: task.hops ?? 0,
    stages,
    logHref: task.logPath ?? undefined,
  };
}

/**
 * Edge state, for the animated wires. An edge (a stage → one of its outcomes) is `traversed`
 * when work has already flowed along it, and `current` when it leads into the stage running
 * right now.
 */
export function edgeState(
  run: RunSnapshot,
  from: string,
  to: string,
): 'traversed' | 'current' | 'idle' {
  const a = run.stages[from]?.state;
  const b = run.stages[to]?.state;
  if (a === 'done' && b === 'running') return 'current';
  if (a === 'done' && (b === 'done' || b === 'rejected' || b === 'timeout')) return 'traversed';
  return 'idle';
}
