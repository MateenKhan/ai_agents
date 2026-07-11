import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, GitBranch, FileCode2, AlertTriangle, CheckCircle2, XCircle, CircleDashed, Loader2, Maximize2, X } from 'lucide-react';
import { API_BASE, getActiveProject } from '../../../apiBase';
import { DiffView } from './DiffView';

/**
 * The review artifact for a NON-VISUAL task. The review gate assumes a running preview to
 * look at, which is empty for a backend/library change ("add slugify()"). What you actually
 * verify there is the diff + QA's verdict + the dev's summary. This fetches that from the
 * already-built `GET /tasks/:id/changes` and renders it, so a human can approve on the real
 * artifact instead of an empty preview.
 *
 * One component, mounted in both the review gate (HumanTodos) and the task detail. The diff
 * itself is the shared <DiffView> — this owns only the header/verdict/file-list around it.
 */

interface FileChange { path: string; status: string; additions: number | null; deletions: number | null }
interface Commit { sha: string; subject: string }
interface Changes {
  ok: boolean;
  exists: boolean;
  base: string;
  branch: string;
  commits: Commit[];
  files: FileChange[];
  diff: string;
  truncated: boolean;
  qaVerdict: 'pass' | 'fail' | null;
  summary: string | null;
}

// Git status letter → colour + label. Matches the app's status hierarchy (added=emerald,
// modified=amber, deleted=rose, renamed=sky) so a file's fate reads by colour alone.
const STATUS: Record<string, { cls: string; label: string }> = {
  A: { cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: 'A' },
  M: { cls: 'text-amber-700 bg-amber-50 border-amber-200', label: 'M' },
  D: { cls: 'text-rose-700 bg-rose-50 border-rose-200', label: 'D' },
  R: { cls: 'text-sky-700 bg-sky-50 border-sky-200', label: 'R' },
};
const statusOf = (s: string) => STATUS[s[0]] ?? { cls: 'text-slate-600 bg-slate-50 border-slate-200', label: s || '?' };

function Verdict({ v }: { v: Changes['qaVerdict'] }) {
  if (v === 'pass') return <span className="inline-flex items-center gap-1 text-2xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><CheckCircle2 size={12} /> QA passed</span>;
  if (v === 'fail') return <span className="inline-flex items-center gap-1 text-2xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5"><XCircle size={12} /> QA failed</span>;
  return <span className="inline-flex items-center gap-1 text-2xs font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5"><CircleDashed size={12} /> not verified</span>;
}

export function ChangesPanel({ taskId }: { taskId: string }) {
  const [data, setData] = useState<Changes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Esc leaves fullscreen. A diff you opened to read big shouldn't trap you in it.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/changes?project=${encodeURIComponent(getActiveProject())}`);
      if (!r.ok) throw new Error(`changes endpoint returned ${r.status}`);
      setData(await r.json());
    } catch (e: any) {
      setError(e?.message || 'Could not load changes');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-slate-500" data-feature-id="changes-loading">
        <Loader2 size={14} className="animate-spin" /> Loading changes…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-rose-50 border border-rose-200" data-feature-id="changes-error">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-rose-700"><AlertTriangle size={14} /> {error}</span>
        <button onClick={load} className="text-2xs font-bold text-rose-700 underline underline-offset-2 hover:text-rose-900">Retry</button>
      </div>
    );
  }

  // No branch yet is a STATE, not an error — the agent hasn't built anything.
  if (!data || !data.exists) {
    return (
      <div className="p-4 text-center text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg" data-feature-id="changes-empty">
        No branch yet — nothing has been built for this task.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-feature-id="changes-panel">
      {/* Header: branch/base, verdict, refresh */}
      <div className="flex items-center gap-2 flex-wrap">
        <GitBranch size={14} className="text-accent-600 shrink-0" />
        <span className="font-mono text-2xs text-slate-700 break-all">{data.branch}</span>
        <span className="text-2xs text-slate-400">→ {data.base}</span>
        <Verdict v={data.qaVerdict} />
        <button onClick={load} aria-label="Refresh changes" className="ml-auto flex items-center gap-1 text-2xs font-bold text-slate-600 hover:text-slate-900">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* The dev's own summary of what it did — its case for approval. */}
      {data.summary && (
        <p className="text-2xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">{data.summary}</p>
      )}

      {/* Commits — usually one. */}
      {data.commits.length > 0 && (
        <div className="space-y-1">
          {data.commits.map(c => (
            <div key={c.sha} className="flex items-baseline gap-2 text-2xs">
              <span className="font-mono text-slate-500 shrink-0">{c.sha}</span>
              <span className="text-slate-700 break-words">{c.subject}</span>
            </div>
          ))}
        </div>
      )}

      {/* File list — status chip, path, +/-. */}
      {data.files.length > 0 && (
        <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
          {data.files.map(f => {
            const st = statusOf(f.status);
            return (
              <div key={f.path} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className={`text-micro font-bold font-mono rounded border px-1 ${st.cls}`}>{st.label}</span>
                <span className="font-mono text-2xs text-slate-700 truncate flex-1 min-w-0">{f.path}</span>
                {f.additions === null && f.deletions === null ? (
                  <span className="text-micro text-slate-400 shrink-0">binary</span>
                ) : (
                  <span className="text-micro font-mono shrink-0 tabular-nums">
                    {f.additions ? <span className="text-emerald-600">+{f.additions}</span> : null}
                    {f.additions && f.deletions ? ' ' : null}
                    {f.deletions ? <span className="text-rose-600">-{f.deletions}</span> : null}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* The diff itself — shared renderer on a dark console surface. Owns its own scroll. */}
      {data.diff && (
        <div className="rounded-lg overflow-hidden bg-surface-console border border-surface-border">
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-surface-border text-micro font-bold uppercase tracking-widest text-slate-400">
            <FileCode2 size={12} /> Diff
            <button onClick={() => setFullscreen(true)} aria-label="Expand diff to full screen" data-feature-id="changes-fullscreen" className="ml-auto flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors">
              <Maximize2 size={12} /> Full screen
            </button>
          </div>
          <DiffView diff={data.diff} />
          {data.truncated && (
            <div className="px-3 py-2 text-micro text-slate-500 border-t border-surface-border">diff truncated — open the branch to see the rest.</div>
          )}
        </div>
      )}

      {/* Full-screen reader. Portalled to <body> so it escapes the review slide-over / task
          detail panel it's nested in — a fixed element inside a transformed/overflow ancestor
          is otherwise clipped to it. The diff fills the height; the file list stays as a
          scannable index above it. */}
      {fullscreen && data.diff && createPortal(
        <div className="fixed inset-0 z-[1200] flex flex-col bg-surface-console" role="dialog" aria-modal="true" aria-label="Diff — full screen" data-feature-id="changes-fullscreen-overlay">
          <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-surface-border">
            <GitBranch size={14} className="text-accent-400 shrink-0" />
            <span className="font-mono text-2xs text-slate-300 break-all">{data.branch}</span>
            <span className="text-2xs text-slate-500">→ {data.base}</span>
            <Verdict v={data.qaVerdict} />
            <button onClick={() => setFullscreen(false)} aria-label="Exit full screen" className="ml-auto flex items-center gap-1 text-2xs font-bold text-slate-400 hover:text-slate-200">
              <X size={16} /> Close <kbd className="ml-1 text-micro font-mono text-slate-500">Esc</kbd>
            </button>
          </div>
          <div className="shrink-0 max-h-[28vh] overflow-y-auto custom-scrollbar border-b border-surface-border divide-y divide-white/5">
            {data.files.map(f => {
              const st = statusOf(f.status);
              return (
                <div key={f.path} className="flex items-center gap-2 px-4 py-1.5">
                  <span className={`text-micro font-bold font-mono rounded border px-1 ${st.cls}`}>{st.label}</span>
                  <span className="font-mono text-2xs text-slate-300 truncate flex-1 min-w-0">{f.path}</span>
                  {f.additions === null && f.deletions === null ? (
                    <span className="text-micro text-slate-500 shrink-0">binary</span>
                  ) : (
                    <span className="text-micro font-mono shrink-0 tabular-nums">
                      {f.additions ? <span className="text-emerald-400">+{f.additions}</span> : null}
                      {f.additions && f.deletions ? ' ' : null}
                      {f.deletions ? <span className="text-rose-400">-{f.deletions}</span> : null}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <DiffView diff={data.diff} className="flex-1 min-h-0" maxHeight="" />
          {data.truncated && (
            <div className="shrink-0 px-4 py-2 text-micro text-slate-500 border-t border-surface-border">diff truncated — open the branch to see the rest.</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

export default ChangesPanel;
