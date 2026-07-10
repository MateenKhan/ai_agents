// One place that knows where the workflow graph lives.
//
// Today that is localStorage, because the db-server has no `/workflow` endpoint yet and the
// orchestrator still runs its built-in pipeline. When the backend lands, only this file
// changes: the editor page and the read-only task popup both go through it, so they cannot
// disagree about which graph is current.

import type { WorkflowGraph } from './types';
import { defaultGraph } from './defaultGraph';

export const WORKFLOW_STORAGE_KEY = 'piranha.workflow.v1';

/** The stored graph, or the shipped default. Never throws: a corrupt value falls back. */
export function loadGraph(): WorkflowGraph {
  try {
    const raw = localStorage.getItem(WORKFLOW_STORAGE_KEY);
    if (!raw) return defaultGraph();
    const parsed = JSON.parse(raw) as WorkflowGraph;
    // A graph from an older shape, or a hand-edit, must not brick the page.
    if (!parsed || !Array.isArray(parsed.stages) || parsed.stages.length === 0) return defaultGraph();
    if (!Array.isArray(parsed.edges)) return defaultGraph();
    return { ...parsed, asks: Array.isArray(parsed.asks) ? parsed.asks : [] };
  } catch {
    return defaultGraph();
  }
}

/** Returns false when persistence is unavailable (private mode, quota) rather than throwing. */
export function saveGraph(graph: WorkflowGraph): boolean {
  try {
    localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(graph, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function clearGraph(): void {
  try { localStorage.removeItem(WORKFLOW_STORAGE_KEY); } catch { /* ignore */ }
}
