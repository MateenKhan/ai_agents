import { useCallback, useEffect, useState } from 'react';
import WorkflowEditor from './tasks/workflow/WorkflowEditor';
import {
  loadWorkflow, saveWorkflow, resetWorkflow,
  type StageIssue, type WorkflowDoc,
} from './tasks/workflow/workflowApi';

/**
 * Standalone page for the workflow editor, at /workflow.
 *
 * This talks to the db-server's /workflow endpoint in the ENGINE's schema. The graph you draw
 * here is the graph the orchestrator runs — there is no local copy and no localStorage. Saving
 * PUTs the document with the rev you loaded; the server rejects a stale write rather than
 * merging it, so two editors cannot silently interleave.
 */

type Banner =
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'invalid'; docErrors: string[]; stageIssues: StageIssue[] };

export default function WorkflowPage() {
  const [doc, setDoc] = useState<WorkflowDoc | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [occupied, setOccupied] = useState<string[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => { document.title = 'Piranha — Workflow'; }, []);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const r = await loadWorkflow();
      setDoc(r.doc);
      setOccupied(r.occupied);
      setLoadState('ready');
    } catch (e: any) {
      setLoadError(e?.message ?? 'failed to load the workflow');
      setLoadState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSave = useCallback(async (next: WorkflowDoc) => {
    const r = await saveWorkflow(next, next.rev);
    if (r.ok) {
      setDoc(r.doc);          // the server-stored doc carries the bumped rev
      setSavedAt(new Date().toLocaleTimeString());
      setBanner({ kind: 'ok', text: `Saved — now at rev ${r.doc.rev}.` });
      return;
    }
    // Inline guards (not an early-return switch): this repo's tsconfig runs `strict: false`,
    // which does not narrow a discriminated union across a prior `return`.
    if (r.ok === false && r.kind === 'conflict') {
      setBanner({ kind: 'error', text: `Reload — someone else saved (their rev is ${r.currentRev}). Your edits were not written.` });
    } else if (r.ok === false && r.kind === 'occupied') {
      setBanner({ kind: 'error', text: `Cannot save: a live task is running on ${r.conflicts.join(', ')}. That stage cannot be removed, renamed or stranded while occupied.` });
    } else if (r.ok === false && r.kind === 'invalid') {
      setBanner({ kind: 'invalid', docErrors: r.docErrors, stageIssues: r.stageIssues });
    } else if (r.ok === false && r.kind === 'error') {
      setBanner({ kind: 'error', text: `Save failed: ${r.message}` });
    }
  }, []);

  const reset = useCallback(async () => {
    try {
      const d = await resetWorkflow();
      setDoc(d);
      setOccupied([]);
      setSavedAt(null);
      setBanner({ kind: 'ok', text: 'Reset to the built-in pipeline.' });
    } catch (e: any) {
      setBanner({ kind: 'error', text: `Reset failed: ${e?.message ?? 'unknown error'}` });
    }
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <a href="/tasks" className="text-sm font-bold text-accent-600 hover:underline">← Board</a>
        <span className="text-2xs text-slate-500">
          Saving here writes the workflow the engine runs.
        </span>
        <span className="flex-1" />
        {savedAt && <span className="text-2xs text-slate-500">saved {savedAt}</span>}
        <button type="button" className="btn-sm" onClick={() => void reset()}>Reset to default</button>
      </div>

      {banner && (
        <div
          className={
            banner.kind === 'ok'
              ? 'border-b border-emerald-300 bg-emerald-50 px-4 py-1 text-2xs font-bold text-emerald-700'
              : 'border-b border-rose-300 bg-rose-100 px-4 py-1 text-2xs font-bold text-rose-700'
          }
          role="status"
        >
          {banner.kind === 'invalid'
            ? <>Rejected by the server: {[...banner.docErrors, ...banner.stageIssues.map(i => `${i.stageId}: ${i.reasons.join(', ')}`)].join(' · ')}</>
            : banner.text}
          <button type="button" className="ml-2 underline" onClick={() => setBanner(null)}>dismiss</button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {loadState === 'loading' && <p className="p-6 text-sm text-slate-500">Loading the workflow…</p>}
        {loadState === 'error' && (
          <div className="p-6 text-sm text-rose-600">
            Could not load the workflow: {loadError}
            <button type="button" className="btn-sm ml-3" onClick={() => void load()}>Retry</button>
          </div>
        )}
        {loadState === 'ready' && doc && (
          <WorkflowEditor doc={doc} occupied={occupied} onSave={handleSave} />
        )}
      </div>
    </div>
  );
}
