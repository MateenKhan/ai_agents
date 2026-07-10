import { useCallback, useEffect, useState } from 'react';
import WorkflowEditor from './tasks/workflow/WorkflowEditor';
import { defaultGraph } from './tasks/workflow/defaultGraph';
import { validateGraph } from './tasks/workflow/validate';
import { clearGraph, loadGraph, saveGraph } from './tasks/workflow/graphStore';
import type { WorkflowGraph } from './tasks/workflow/types';

/**
 * Standalone page for the workflow editor, at /workflow.
 *
 * Persistence is DELIBERATELY localStorage for now (see graphStore.ts). There is no
 * `/workflow` endpoint on the db-server yet, and the engine does not read a stored graph —
 * the pipeline is still the hard-coded one in agentic/engine/orchestrator.ts. Saving here
 * changes what you see, not what the agents do. That stays true until the backend lands.
 */
export default function WorkflowPage() {
  const [graph, setGraph] = useState<WorkflowGraph>(() => loadGraph());
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const handleSave = useCallback((g: WorkflowGraph) => {
    if (saveGraph(g)) setSavedAt(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => { document.title = 'Piranha — Workflow'; }, []);

  const reset = () => {
    clearGraph();
    setGraph(defaultGraph());
    setSavedAt(null);
  };

  const validation = validateGraph(graph);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <a href="/tasks" className="text-sm font-bold text-accent-600 hover:underline">← Board</a>
        <span className="text-2xs text-slate-500">
          Preview only — the engine still runs the built-in pipeline. Saving here does not change what the agents do.
        </span>
        <span className="flex-1" />
        {savedAt && <span className="text-2xs text-slate-500">saved {savedAt}</span>}
        <button type="button" className="btn-sm" onClick={reset}>Reset to default</button>
      </div>

      <div className="min-h-0 flex-1">
        <WorkflowEditor graph={graph} onSave={handleSave} onChange={setGraph} />
      </div>

      {!validation.ok && (
        <div className="border-t border-rose-300 bg-rose-100 px-4 py-1 text-2xs font-bold text-rose-700">
          {validation.graphErrors.join(' · ')}
        </div>
      )}
    </div>
  );
}
