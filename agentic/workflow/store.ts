// ─────────────────────────────────────────────────────────────────────────────
// Reading and writing the workflow document.
//
// One row per project in `board_settings`, keyed `workflow:<projectId>` — the same shape as
// the existing `code_index:<projectId>` key. That table already exists on both SQLite and
// Postgres, `data` is TEXT, and a whole document saves in one statement, so a reader can never
// see half a workflow.
//
// The write path is where the care goes. Three things must be true at the instant of the write,
// not a moment before it:
//
//   • the caller's `rev` is still current      (nobody else saved while they were editing)
//   • the document is internally valid          (nothing strands a task)
//   • no live task is standing on a stage the new document removes or renames
//
// The third one is a time-of-check-to-time-of-use trap. A task can start on `qa` in the gap
// between "is anyone on qa?" and "write the document". So the check and the write share a
// transaction. That is the same bug that once let five orchestrators hold the merge lock at
// once, and it is worth not repeating.
// ─────────────────────────────────────────────────────────────────────────────

import type { Store } from '../db/store';
import { upsert } from '../db/store';
import { getStore, ensureMigrated } from '../db/getStore';
import { defaultWorkflow } from './defaultWorkflow';
import { occupiedStageConflicts, validateWorkflow } from './validate';
import type { WorkflowDoc } from './types';

export const workflowKey = (projectId: string) => `workflow:${projectId}`;

/** Statuses of a task that is somewhere in the pipeline, and would be stranded by an edit. */
const LIVE_STATUSES = ['WORKING', 'TESTING'] as const;

async function tasksStore(): Promise<Store> {
  await ensureMigrated('tasks');
  return getStore('tasks');
}

export interface LoadedWorkflow {
  doc: WorkflowDoc;
  /** 'stored' when a document was saved for this project; 'default' when it is the built-in. */
  source: 'stored' | 'default';
}

/**
 * The project's workflow, or the built-in pipeline when none has been saved.
 *
 * A stored document that will not parse falls back to the default, because a broken JSON blob
 * must not stop the board from running. A stored document that parses but does not VALIDATE is
 * returned as-is: the caller decides. The orchestrator refuses to dispatch against it and says
 * why, rather than silently routing tasks through a pipeline the user never drew.
 */
export async function loadWorkflow(projectId: string): Promise<LoadedWorkflow> {
  const s = await tasksStore();
  return loadWorkflowWith(s, projectId);
}

async function loadWorkflowWith(s: Store, projectId: string): Promise<LoadedWorkflow> {
  const row = await s.get<{ data: string }>(`SELECT data FROM board_settings WHERE id = ?`, [workflowKey(projectId)]);
  if (!row?.data) return { doc: defaultWorkflow(), source: 'default' };
  try {
    const doc = JSON.parse(row.data) as WorkflowDoc;
    if (!doc || !Array.isArray(doc.stages)) return { doc: defaultWorkflow(), source: 'default' };
    return { doc, source: 'stored' };
  } catch {
    return { doc: defaultWorkflow(), source: 'default' };
  }
}

/** Stage ids that live tasks are standing on, for callers that have no Store of their own. */
export async function occupiedStagesFor(projectId: string): Promise<string[]> {
  return occupiedStages(await tasksStore(), projectId);
}

/** Stage ids that live tasks in this project are currently standing on. */
export async function occupiedStages(s: Store, projectId: string): Promise<string[]> {
  const marks = LIVE_STATUSES.map(() => '?').join(',');
  const rows = await s.all<{ stage: string }>(
    `SELECT DISTINCT stage FROM tasks
      WHERE stage IS NOT NULL AND stage <> ''
        AND status IN (${marks})
        AND (projectId = ? OR (projectId IS NULL AND ? = 'default'))`,
    [...LIVE_STATUSES, projectId, projectId],
  );
  return rows.map(r => r.stage).filter(Boolean);
}

/** `kind` is the single discriminant: one property to switch on, and no way to test `ok` and
 *  then read a field that only exists on the other branch. */
export type SaveResult =
  | { kind: 'saved'; doc: WorkflowDoc }
  /** The caller's rev was stale. Their edit is NOT merged; they must reload and reapply. */
  | { kind: 'conflict'; currentRev: number }
  /** The document is malformed, or would strand a task. */
  | { kind: 'invalid'; docErrors: string[]; stageIssues: Array<{ stageId: string; reasons: string[] }> }
  /** A live task stands on a stage this edit removes, renames, or leaves with no way out. */
  | { kind: 'occupied'; conflicts: string[] };

/**
 * Save a workflow, but only if it is safe to.
 *
 * `expectedRev` is the rev the caller loaded. If someone else has saved since, the write is
 * rejected rather than merged — silently interleaving two people's stage deletions is how you
 * end up with a graph neither of them drew.
 *
 * On success the stored `rev` is `expectedRev + 1`. The caller's own `rev` field is ignored.
 */
export async function saveWorkflow(projectId: string, incoming: WorkflowDoc, expectedRev: number): Promise<SaveResult> {
  const s = await tasksStore();

  return s.tx(async t => {
    const { doc: current, source } = await loadWorkflowWith(t, projectId);
    // A project that has never saved is at rev 0 from the client's point of view: there is
    // nothing to have been stale against.
    const currentRev = source === 'stored' ? current.rev : 0;
    if (expectedRev !== currentRev) return { kind: 'conflict' as const, currentRev };

    const nextDoc: WorkflowDoc = { ...incoming, v: 1, rev: currentRev + 1 };

    // Validate the document the way it will be STORED, rev included — a validator that runs on
    // the caller's copy could pass while the stored copy fails.
    const v = validateWorkflow(nextDoc);
    if (!v.ok) return { kind: 'invalid' as const, docErrors: v.docErrors, stageIssues: v.stageIssues };

    // Inside the transaction, so a task cannot start on a stage between here and the write.
    const occupied = await occupiedStages(t, projectId);
    const conflicts = occupiedStageConflicts(nextDoc, occupied);
    if (conflicts.length) return { kind: 'occupied' as const, conflicts };

    await upsert(t, 'board_settings', { id: workflowKey(projectId), data: JSON.stringify(nextDoc) }, ['id']);
    return { kind: 'saved' as const, doc: nextDoc };
  });
}

/** Forget the stored document; the project falls back to the built-in pipeline. */
export async function resetWorkflow(projectId: string): Promise<void> {
  const s = await tasksStore();
  await s.run(`DELETE FROM board_settings WHERE id = ?`, [workflowKey(projectId)]);
}
