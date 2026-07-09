import React, { useState, useEffect, useCallback } from 'react';
import { Search, Sparkles, Loader2, FileCode2, CornerDownLeft, AlertTriangle, BookOpen, RefreshCw, ChevronDown } from 'lucide-react';
import { API_BASE, withProject } from '../../../apiBase';
import { useProjects } from '../projectContext';

/**
 * Code Search — queries the per-project semantic code index via the db-server.
 *  • "Search" mode → POST /search returns ranked code nodes (retrieval only).
 *  • "Ask" mode    → POST /ask runs RAG: retrieves snippets, then a headless Claude
 *                    call answers the question grounded in them.
 * The project dropdown lets you query ANY project's index, not just the active one.
 */

interface Hit { score: number; name: string; type: string; path: string; line: number; signature: string }

const typeColor: Record<string, string> = {
  function: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  class: 'text-violet-600 bg-violet-50 border-violet-200',
  method: 'text-sky-600 bg-sky-50 border-sky-200',
  interface: 'text-amber-600 bg-amber-50 border-amber-200',
  type: 'text-amber-600 bg-amber-50 border-amber-200',
  const: 'text-slate-600 bg-slate-50 border-slate-200',
};

// Minimal, safe markdown: fenced code blocks + inline code + paragraphs. No HTML injection.
function renderAnswer(md: string): React.ReactNode {
  const parts = md.split(/```/);
  return parts.map((seg, i) => {
    if (i % 2 === 1) {
      const body = seg.replace(/^[a-zA-Z0-9]*\n/, '');
      return (
        <pre key={i} className="my-2 p-3 rounded-lg bg-slate-900 text-slate-100 text-[12px] font-mono overflow-x-auto custom-scrollbar">
          <code>{body}</code>
        </pre>
      );
    }
    return seg.split('\n').map((line, j) => {
      const bits = line.split(/(`[^`]+`)/g).map((b, k) =>
        b.startsWith('`') && b.endsWith('`')
          ? <code key={k} className="px-1 py-0.5 rounded bg-slate-100 text-accent-700 font-mono text-[12px]">{b.slice(1, -1)}</code>
          : <React.Fragment key={k}>{b}</React.Fragment>);
      return <p key={`${i}-${j}`} className="leading-relaxed">{bits}</p>;
    });
  });
}

export default function CodeSearchTab() {
  const { projects, activeId } = useProjects();
  const [project, setProject] = useState(activeId);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'search' | 'ask'>('search');
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Cached project brief (the "context brain" agents also read).
  const [brief, setBrief] = useState<{ brief: string | null; generatedAt: string | null; model: string | null } | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefBusy, setBriefBusy] = useState(false);

  const loadBrief = useCallback(async (pid: string) => {
    try {
      const r = await fetch(withProject(`${API_BASE}/project-context`, pid));
      setBrief(await r.json());
    } catch { setBrief(null); }
  }, []);

  useEffect(() => { loadBrief(project); }, [project, loadBrief]);

  const rebuildBrief = async () => {
    if (briefBusy) return;
    setBriefBusy(true);
    try {
      await fetch(withProject(`${API_BASE}/project-context/rebuild`, project), { method: 'POST' });
      // Poll for the fresh brief — the LLM pass runs server-side (~15–120s).
      const before = brief?.generatedAt || '';
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const res = await fetch(withProject(`${API_BASE}/project-context`, project));
        const d = await res.json();
        if (d?.brief && d.generatedAt !== before) { setBrief(d); break; }
      }
    } catch { /* leave prior brief */ }
    finally { setBriefBusy(false); }
  };

  const run = async () => {
    const query = q.trim();
    if (!query || loading) return;
    setLoading(true); setError(null); setAnswer(null); setHits(null); setSources([]);
    try {
      const path = mode === 'search' ? '/search' : '/ask';
      const topK = mode === 'search' ? 15 : 8;
      const r = await fetch(withProject(`${API_BASE}${path}`, project), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK, projectId: project }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `${mode} failed`);
      if (mode === 'search') setHits(d.results || []);
      else { setAnswer(d.answer || ''); setSources(d.sources || []); }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const HitRow = ({ h }: { h: Hit }) => (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors">
      <FileCode2 size={16} className="mt-0.5 text-slate-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-slate-800 truncate">{h.name}</span>
          <span className={`text-[9px] font-black uppercase tracking-wider rounded px-1.5 py-0.5 border ${typeColor[h.type] || typeColor.const}`}>{h.type}</span>
          <span className="text-[10px] font-mono text-slate-400">{(h.score * 100).toFixed(0)}%</span>
        </div>
        <div className="text-[11px] text-slate-500 font-mono break-all">{h.path}:{h.line}</div>
        {h.signature && <div className="mt-1 text-[11px] text-slate-600 font-mono break-all line-clamp-2">{h.signature}</div>}
      </div>
    </div>
  );

  return (
    <div className="p-3 sm:p-5 space-y-4" data-feature-id="tasks-code-search-tab">
      {/* Query bar */}
      <div className="flex flex-col sm:flex-row items-stretch gap-2">
        <div className="relative shrink-0">
          <select
            value={project}
            onChange={e => setProject(e.target.value)}
            data-feature-id="code-search-project"
            className="h-11 pl-3 pr-8 rounded-lg border border-slate-300 bg-white text-sm font-bold text-slate-700 focus:outline-none focus:border-accent-500 appearance-none cursor-pointer"
            title="Which project's code index to query"
          >
            {projects.length === 0 && <option value={project}>{project}</option>}
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.emoji ? `${p.emoji} ` : ''}{p.name}</option>
            ))}
          </select>
        </div>

        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') run(); }}
            placeholder={mode === 'search' ? 'Search code — e.g. "where are git tokens stored"' : 'Ask a question about the codebase…'}
            data-feature-id="code-search-input"
            className="w-full h-11 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:border-accent-500 placeholder:text-slate-400"
          />
        </div>

        {/* Mode toggle */}
        <div className="flex items-center rounded-lg border border-slate-300 bg-slate-100 p-0.5 shrink-0">
          <button
            onClick={() => setMode('search')}
            className={`flex items-center gap-1.5 px-3 h-10 rounded-md text-xs font-bold transition-colors ${mode === 'search' ? 'bg-white text-accent-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Search size={14} /> Search
          </button>
          <button
            onClick={() => setMode('ask')}
            className={`flex items-center gap-1.5 px-3 h-10 rounded-md text-xs font-bold transition-colors ${mode === 'ask' ? 'bg-white text-accent-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Sparkles size={14} /> Ask
          </button>
        </div>

        <button
          onClick={run}
          disabled={loading || !q.trim()}
          data-feature-id="code-search-run"
          className="flex items-center justify-center gap-2 px-4 h-11 rounded-lg bg-accent-600 text-white text-sm font-black shadow-lg shadow-accent-600/20 hover:bg-accent-500 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shrink-0"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <CornerDownLeft size={16} />}
          {loading ? (mode === 'ask' ? 'Thinking…' : 'Searching…') : (mode === 'ask' ? 'Ask' : 'Search')}
        </button>
      </div>

      {mode === 'ask' && (
        <p className="text-[11px] text-slate-400">
          Ask mode runs a Claude agent grounded in the retrieved code (RAG). First call can take ~10–120s.
        </p>
      )}

      {/* Project brief — the cached "context brain" agents read for free */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <button onClick={() => setBriefOpen(o => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
            <BookOpen size={15} className="text-accent-500 shrink-0" />
            <span className="text-xs font-bold text-slate-700">Project context brief</span>
            {brief?.generatedAt
              ? <span className="text-[10px] text-slate-400">· {new Date(brief.generatedAt).toLocaleString()}</span>
              : <span className="text-[10px] text-slate-400">· not generated yet</span>}
            <ChevronDown size={14} className={`ml-auto text-slate-400 transition-transform ${briefOpen ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={rebuildBrief}
            disabled={briefBusy}
            className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-60 transition-colors shrink-0"
            title="Regenerate the brief via Claude (~15–120s)"
          >
            <RefreshCw size={12} className={briefBusy ? 'animate-spin' : ''} /> {briefBusy ? 'Generating…' : 'Rebuild'}
          </button>
        </div>
        {briefOpen && (
          <div className="px-4 pb-3 pt-1 border-t border-slate-100 text-sm text-slate-800 space-y-1.5">
            {brief?.brief
              ? renderAnswer(brief.brief)
              : <p className="text-xs text-slate-400 py-2">No brief yet. Click <span className="font-bold">Rebuild</span> to generate one — it's cached in the index and injected into every agent's prompt.</p>}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* RAG answer */}
      {answer != null && (
        <div className="space-y-3">
          <div className="p-4 rounded-xl border border-accent-200 bg-accent-50/50">
            <div className="flex items-center gap-1.5 mb-2 text-[10px] font-black uppercase tracking-wider text-accent-500">
              <Sparkles size={12} /> Answer
            </div>
            <div className="text-sm text-slate-800 space-y-1.5">{renderAnswer(answer)}</div>
          </div>
          {sources.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sources ({sources.length})</div>
              {sources.map((h, i) => <HitRow key={i} h={h} />)}
            </div>
          )}
        </div>
      )}

      {/* Search results */}
      {hits != null && (
        hits.length === 0
          ? <div className="p-8 text-center text-xs text-slate-400">No matches. Try rephrasing, or rebuild the index if this project was just cloned.</div>
          : (
            <div className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{hits.length} results</div>
              {hits.map((h, i) => <HitRow key={i} h={h} />)}
            </div>
          )
      )}

      {hits == null && answer == null && !loading && !error && (
        <div className="p-10 text-center text-xs text-slate-400">
          Pick a project, type a query, and hit <span className="font-bold">Search</span> for code matches or <span className="font-bold">Ask</span> for an AI answer.
        </div>
      )}
    </div>
  );
}
