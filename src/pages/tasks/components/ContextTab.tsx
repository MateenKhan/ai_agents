import React, { useEffect, useMemo, useState, useCallback, lazy, Suspense } from 'react';
import { Tooltip } from './Tooltip';
import {
  RefreshCw, Pin, PinOff, X, Plus, FileCode, Folder, FolderOpen, ChevronRight,
  BrainCircuit, Search, PanelLeftClose, PanelLeftOpen, Cpu, AlertTriangle, Trash2, Clock, FolderGit2,
  type LucideIcon,
} from 'lucide-react';
import { API_BASE as API, withProject } from '../../../apiBase';
import { useToast } from './Toast';
import { btnSm } from '../ui';
import { FileBrowser } from './FileBrowser';

// Model context ceilings (facts). Haiku dies past 200K; Sonnet/Opus reach 1M.
const MODEL_CEILING: Record<string, number> = { haiku: 200_000, sonnet: 1_000_000, opus: 1_000_000 };
const BUDGETS = [100_000, 200_000, 500_000, 1_000_000];
const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
const capKey = (p: string) => `mc.contextCap:${p || 'default'}`;

interface CFile { path: string; tokens: number; pinned: 0 | 1; addedBy: string | null; useCount: number; lastUsedAt: string; }
interface Stats { totalTokens: number; fileCount: number; pinnedCount: number; cap: number; pct: number; }
interface Op { id: number; path: string | null; op: string; actor: string | null; tokens: number | null; durationMs: number | null; reason: string | null; ts: string; }

const OP_STYLE: Record<string, string> = {
  keep: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  read: 'text-sky-700 bg-sky-50 border-sky-200',
  evict: 'text-rose-700 bg-rose-50 border-rose-200',
  pin: 'text-accent-700 bg-accent-50 border-accent-200',
  unpin: 'text-slate-600 bg-slate-50 border-slate-200',
  sweep: 'text-amber-700 bg-amber-50 border-amber-200',
  refresh: 'text-ai-700 bg-ai-50 border-ai-200',
};

/** The Memory view: what the swarm currently holds in context, and the ops that put it there. */
function ContextMemory({ activeId, switcher }: { activeId: string; switcher: React.ReactNode }) {
  const toast = useToast();
  const [files, setFiles] = useState<CFile[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [busy, setBusy] = useState(false);
  const [opsOpen, setOpsOpen] = useState(true);
  const [cap, setCap] = useState<number>(() => Number(localStorage.getItem(capKey(activeId))) || 200_000);

  const inContext = useMemo(() => new Set(files.map(f => f.path)), [files]);

  const loadContext = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([
        fetch(withProject(`${API}/context?cap=${cap}`)).then(r => r.json()),
        fetch(withProject(`${API}/context/ops?limit=80`)).then(r => r.json()),
      ]);
      setFiles(c.files ?? []); setStats(c.stats ?? null); setOps(o.ops ?? []);
    } catch { /* offline */ }
  }, [activeId, cap]);

  const refresh = useCallback(async () => { setBusy(true); await loadContext(); setBusy(false); }, [loadContext]);
  useEffect(() => { loadContext(); }, [activeId, cap]);
  useEffect(() => { localStorage.setItem(capKey(activeId), String(cap)); }, [cap, activeId]);

  const addToContext = async (path: string, pinned = true) => {
    try {
      const r = await fetch(withProject(`${API}/context?cap=${cap}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, addedBy: 'user', pinned }) }).then(r => r.json());
      if (r.error) throw new Error(r.error);
      if (r.evicted?.length) toast.info('Evicted (over budget)', r.evicted.map((f: CFile) => f.path).join(', '));
      toast.success('Added to context', path);
      loadContext();
    } catch (e: any) { toast.error('Add failed', e?.message); }
  };
  const remove = async (path: string) => { await fetch(withProject(`${API}/context?path=${encodeURIComponent(path)}`), { method: 'DELETE' }); loadContext(); };
  const togglePin = async (f: CFile) => { await fetch(withProject(`${API}/context/pin`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: f.path, pinned: !f.pinned }) }); loadContext(); };
  const sweep = async () => { const r = await fetch(withProject(`${API}/context/sweep?cap=${cap}`), { method: 'POST' }).then(r => r.json()); toast.info('Swept', `freed ${r.result?.freedTokens ?? 0} tok`); loadContext(); };

  // Apply a model tier to every agent (the "big context → change all agents" lever).
  const [applyModel, setApplyModel] = useState('sonnet');
  const applyToAgents = async () => {
    try {
      const { agents } = await fetch(`${API}/agents`).then(r => r.json());
      await Promise.all((agents ?? []).map((a: any) => fetch(`${API}/agents`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...a, model: applyModel }) })));
      toast.success('All agents updated', `→ ${applyModel}`);
    } catch (e: any) { toast.error('Apply failed', e?.message); }
  };

  const over = stats ? stats.totalTokens > cap : false;
  const gaugePct = stats ? Math.min(100, Math.round((stats.totalTokens / cap) * 100)) : 0;
  const haikuOk = cap <= MODEL_CEILING.haiku;

  return (
    <div className="p-3 sm:p-4 pt-0" data-feature-id="tasks-context-tab">
      {/* Model advisory: Haiku unavailable past 200K */}
      {!haikuOk && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 text-2xs font-semibold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg">
          <AlertTriangle size={13} className="shrink-0" /> Budget over 200K — Haiku can't hold this context. Use Sonnet or Opus (both 1M).
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-3">
        {/* ── Left: the shared file browser (browse · view · edit · CRUD · AI chat). The same
             <FileBrowser> the Git modal uses. "Add to context" is wired via onAddToContext, and
             the memory controls (Sweep · Budget · gauge) ride in its ONE toolbar row via
             toolbarExtra — no separate context toolbar stacked above. Its Refresh also reloads
             memory (onRefresh), so there's a single Refresh, not two. ── */}
        <FileBrowser
          activeId={activeId}
          onAddToContext={(p) => addToContext(p)}
          inContext={inContext}
          onRefresh={loadContext}
          toolbarLeading={switcher}
          toolbarExtra={
            <>
              <Tooltip label="Garbage-collect: age out stale + evict over budget"><button onClick={sweep} data-feature-id="context-sweep" className="flex items-center gap-1.5 px-2.5 min-h-control text-xs font-bold text-amber-700 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100">
                <Trash2 size={13} /> Sweep
              </button></Tooltip>
              <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">Budget
                <select value={cap} onChange={e => setCap(Number(e.target.value))} data-feature-id="context-budget" className="bg-slate-50 border border-slate-300 rounded-md px-2 py-1.5 text-xs font-semibold text-slate-800 cursor-pointer">
                  {BUDGETS.map(b => <option key={b} value={b}>{fmt(b)} tok</option>)}
                </select>
              </label>
              {stats && (
                <div className="flex items-center gap-2 w-40">
                  <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${over ? 'bg-rose-500' : gaugePct > 80 ? 'bg-amber-500' : 'bg-accent-500'}`} style={{ width: `${gaugePct}%` }} />
                  </div>
                  <span className={`text-2xs font-bold tabular-nums ${over ? 'text-rose-600' : 'text-slate-600'}`}>{fmt(stats.totalTokens)}/{fmt(cap)}</span>
                </div>
              )}
            </>
          }
        />

        {/* ── Right: what's IN memory + model + ops log ── */}
        <div className="flex flex-col gap-3">
          <div className="border border-slate-200 rounded-xl bg-white flex flex-col max-h-[calc(100dvh-260px)]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
              <span className="eyebrow">In Memory {stats ? `· ${stats.fileCount}` : ''}</span>
              <span className="text-micro text-slate-500">{stats?.pinnedCount ?? 0} pinned</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-1">
              {files.length ? files.map(f => (
                <div key={f.path} data-feature-id="context-memory-item" className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-lg border ${f.pinned ? 'border-accent-200 bg-accent-50/40' : 'border-slate-200 bg-slate-50/60'}`}>
                  <FileCode size={12} className="text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-2xs font-semibold text-slate-800 truncate" title={f.path}>{f.path}</div>
                    <div className="text-[9px] text-slate-500">{fmt(f.tokens)} tok · used {f.useCount}× · {f.addedBy || 'agent'}</div>
                  </div>
                  <Tooltip label={f.pinned ? 'Unpin (allow auto-evict)' : 'Pin (never auto-evict)'}><button onClick={() => togglePin(f)} className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-md ${f.pinned ? 'text-accent-600' : 'text-slate-500 hover:text-accent-600'}`}>
                    {f.pinned ? <Pin size={12} /> : <PinOff size={12} />}
                  </button></Tooltip>
                  <Tooltip label="Remove from context"><button onClick={() => remove(f.path)} className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600"><X size={12} /></button></Tooltip>
                </div>
              )) : <p className="p-4 text-center text-2xs text-slate-500">Nothing in context. Add files from the explorer, or agents will populate it as they search.</p>}
            </div>
            {/* Model tier for this budget */}
            <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-200">
              <Cpu size={13} className="text-accent-500 shrink-0" />
              <select value={applyModel} onChange={e => setApplyModel(e.target.value)} data-feature-id="context-model" className="flex-1 bg-slate-50 border border-slate-300 rounded-md px-2 py-1.5 text-xs font-semibold text-slate-800 cursor-pointer">
                <option value="haiku" disabled={!haikuOk}>Haiku{!haikuOk ? ' — max 200K' : ' — fast/cheap'}</option>
                <option value="sonnet">Sonnet — 1M, balanced</option>
                <option value="opus">Opus — 1M, deepest</option>
              </select>
              <button onClick={applyToAgents} className="shrink-0 text-micro font-bold text-white bg-slate-900 hover:bg-slate-800 px-2.5 py-1.5 rounded-md">Apply all</button>
            </div>
          </div>

          {/* Ops log — high-quality memory-op timeline (keep/read/evict + timings) */}
          <div className="border border-slate-200 rounded-xl bg-white">
            <button onClick={() => setOpsOpen(o => !o)} className="flex items-center gap-2 w-full px-3 py-2 text-left">
              <Clock size={13} className="text-slate-400" />
              <span className="eyebrow flex-1">Memory Log</span>
              <ChevronRight size={14} className={`text-slate-400 transition-transform ${opsOpen ? 'rotate-90' : ''}`} />
            </button>
            {opsOpen && (
              <div className="max-h-64 overflow-y-auto custom-scrollbar px-2 pb-2 space-y-1">
                {ops.length ? ops.map(o => (
                  <div key={o.id} className="flex items-center gap-1.5 text-micro">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded border font-bold uppercase ${OP_STYLE[o.op] || 'text-slate-600 bg-slate-50 border-slate-200'}`}>{o.op}</span>
                    <span className="flex-1 min-w-0 truncate font-mono text-slate-600" title={o.reason || ''}>{o.path || o.reason}</span>
                    {o.durationMs != null && <span className="shrink-0 text-slate-500 tabular-nums">{o.durationMs}ms</span>}
                    <span className="shrink-0 text-slate-500">{o.actor}</span>
                  </div>
                )) : <p className="p-3 text-center text-2xs text-slate-500">No memory operations yet.</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Context tab shell ────────────────────────────────────────────────────────
// Memory and Search are two questions about the same thing: the per-project code index.
// Memory says what the swarm is holding right now; Search asks that index anything. They
// were separate top-level tabs, which made the index look like two unrelated features.
//
// The view is URL state, not component state: /tasks/context and /tasks/search each name
// one, so the old Search deep link keeps working and both are refresh- and back-safe.

const CodeSearchTab = lazy(() => import('./CodeSearchTab'));

export type ContextView = 'memory' | 'search';

const VIEWS: Array<{ id: ContextView; label: string; icon: LucideIcon; hint: string }> = [
  { id: 'memory', label: 'Memory', icon: BrainCircuit, hint: 'What the swarm is holding in context right now' },
  { id: 'search', label: 'Search', icon: Search, hint: 'Ask the code index a question' },
];

export default function ContextTab({ activeId, view, onViewChange }: {
  activeId: string;
  view: ContextView;
  onViewChange: (v: ContextView) => void;
}) {
  // The Memory/Search switcher. In the Memory view it rides INSIDE the file browser's toolbar
  // row (no separate half-empty bar above it); in Search it sits atop the search panel.
  const switcher = (
    <div role="tablist" aria-label="Context view" className="inline-flex p-0.5 gap-0.5 rounded-lg bg-slate-100 border border-slate-200 shrink-0">
      {VIEWS.map(v => {
        const active = view === v.id;
        return (
          <Tooltip key={v.id} label={v.hint}>
            <button
              role="tab"
              aria-selected={active}
              aria-controls="context-panel"
              onClick={() => onViewChange(v.id)}
              data-feature-id={`context-view-${v.id}`}
              className={`flex items-center gap-1.5 px-3 min-h-control text-xs font-bold rounded-md transition-colors ${
                active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 sm:hover:text-slate-900'
              }`}
            >
              <v.icon size={14} className={active ? 'text-accent-600' : ''} />
              {v.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );

  return (
    <div className="h-full flex flex-col" data-feature-id="tasks-context-shell">
      <div id="context-panel" role="tabpanel" className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {view === 'search' ? (
          <div className="p-3 sm:p-4">
            <div className="mb-3">{switcher}</div>
            <Suspense fallback={<div className="p-8 text-center text-xs font-semibold uppercase tracking-widest text-slate-500">Loading search…</div>}>
              <CodeSearchTab />
            </Suspense>
          </div>
        ) : (
          <ContextMemory activeId={activeId} switcher={switcher} />
        )}
      </div>
    </div>
  );
}
