// The workflow editor's link to the engine.
//
// Before this, the editor saved to localStorage in its OWN schema — so the graph you drew in
// the browser and the graph the orchestrator executed were two different documents. This talks
// to the db-server's /workflow endpoint in the ENGINE's schema, so there is exactly one graph.
//
// The schema (WorkflowDoc, Stage, Outcome, validateWorkflow) is imported straight from
// agentic/workflow — the same code the server validates with. A browser copy would drift; there
// is deliberately no browser copy. Only `store.ts` in that folder touches node, and this file
// never imports it.

import { API_BASE, getActiveProject } from '../../../apiBase';
import type { StageIssue } from '../../../../agentic/workflow/validate';
import type { WorkflowDoc } from '../../../../agentic/workflow/types';

// The ONE schema. Imported from the engine, never copied — a browser copy is exactly the drift
// this file exists to remove.
export type { WorkflowDoc, Stage, Outcome, Behaviour, StageCaps, Side, Corner } from '../../../../agentic/workflow/types';
export { DEFAULT_CAPS, BEHAVIOURS, AGENT_BEHAVIOURS, isAgentBehaviour } from '../../../../agentic/workflow/types';
export { validateWorkflow, type StageIssue, type ValidationResult } from '../../../../agentic/workflow/validate';

const url = (project: string) => `${API_BASE}/workflow?project=${encodeURIComponent(project)}`;

export interface LoadedWorkflow {
  doc: WorkflowDoc;
  /** 'stored' when a document was saved for this project; 'default' is the built-in pipeline. */
  source: 'stored' | 'default';
  valid: boolean;
  docErrors: string[];
  stageIssues: StageIssue[];
  /** Stage ids that live tasks are standing on — the editor locks these nodes. */
  occupied: string[];
}

/** Load the project's workflow. Throws only on a network/parse failure the caller should show. */
export async function loadWorkflow(project = getActiveProject()): Promise<LoadedWorkflow> {
  const r = await fetch(url(project));
  if (!r.ok) throw new Error(`workflow load failed: HTTP ${r.status}`);
  const body = await r.json();
  return {
    doc: body.doc,
    source: body.source,
    valid: !!body.valid,
    docErrors: body.docErrors ?? [],
    stageIssues: body.stageIssues ?? [],
    occupied: body.occupied ?? [],
  };
}

export type SaveOutcome =
  | { ok: true; doc: WorkflowDoc }
  /** Someone else saved while you were editing. Reload before reapplying. */
  | { ok: false; kind: 'conflict'; currentRev: number }
  /** The document is malformed or would strand a task. */
  | { ok: false; kind: 'invalid'; docErrors: string[]; stageIssues: StageIssue[] }
  /** A live task stands on a stage this edit removes, renames, or strands. */
  | { ok: false; kind: 'occupied'; conflicts: string[] }
  | { ok: false; kind: 'error'; message: string };

/**
 * Save the document. `expectedRev` is the rev you loaded; the server rejects a stale write
 * rather than merging it, so two editors cannot silently interleave.
 */
export async function saveWorkflow(doc: WorkflowDoc, expectedRev: number, project = getActiveProject()): Promise<SaveOutcome> {
  let r: Response;
  try {
    r = await fetch(url(project), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc, expectedRev }),
    });
  } catch (e: any) {
    return { ok: false, kind: 'error', message: e?.message ?? 'network error' };
  }

  if (r.ok) return { ok: true, doc: (await r.json()).doc };

  const body = await r.json().catch(() => ({}));
  if (r.status === 409 && typeof body.currentRev === 'number') return { ok: false, kind: 'conflict', currentRev: body.currentRev };
  if (r.status === 409) return { ok: false, kind: 'occupied', conflicts: body.conflicts ?? [] };
  if (r.status === 422) return { ok: false, kind: 'invalid', docErrors: body.docErrors ?? [], stageIssues: body.stageIssues ?? [] };
  return { ok: false, kind: 'error', message: body.error ?? `HTTP ${r.status}` };
}

/** Forget the stored document; the project falls back to the built-in pipeline. */
export async function resetWorkflow(project = getActiveProject()): Promise<WorkflowDoc> {
  const r = await fetch(url(project), { method: 'DELETE' });
  if (!r.ok) throw new Error(`workflow reset failed: HTTP ${r.status}`);
  return (await r.json()).doc;
}
