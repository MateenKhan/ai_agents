import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  RefreshCw, Pin, PinOff, X, Plus, FileCode, Folder, FolderOpen, ChevronRight,
  BrainCircuit, Search, PanelLeftClose, PanelLeftOpen, Cpu, AlertTriangle, Trash2, Clock, FolderGit2,
} from 'lucide-react';
import { API_BASE as API, withProject } from '../../../apiBase';
import { useToast } from './Toast';

// Model context ceilings (facts). Haiku dies past 200K; Sonnet/Opus reach 1M.
const MODEL_CEILING: Record<string, number> = { haiku: 200_000, sonnet: 1_000_000, opus: 1_000_000 };
const BUDGETS = [100_000, 200_000, 500_000, 1_000_000];
const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
const capKey = (p: string) => `mc.contextCap:${p || 'default'}`;

interface CFile { path: string; tokens: number; pinned: 0 | 1; addedBy: string | null; useCount: number; lastUsedAt: string; }
interface Stats { totalTokens: number; fileCount: number; pinnedCount: number; cap: number; pct: number; }
interface Op { id: number; path: string | null; op: string; actor: string | null; tokens: number | null; durationMs: number | null; reason: string | null; ts: string; }

// ── file tree from flat repo-relative paths ──────────────────────────────────
interface TreeNode { name: string; path: string; dir: boolean; children: TreeNode[]; }
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      let child = node.children.find(c => c.name === part && c.dir === !isFile);
      if (!child) { child = { name: part, path: parts.slice(0, i + 1).join('/'), dir: !isFile, children: [] }; node.children.push(child); }
      node = child;
    });
  }
  const sort = (n: TreeNode) => { n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1)); n.children.forEach(sort); };
  sort(root);
  return root.children;
}

const OP_STYLE: Record<string, string> = {
  keep: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  read: 'text-sky-700 bg-sky-50 border-sky-200',
  evict: 'text-rose-700 bg-rose-50 border-rose-200',
  pin: 'text-accent-700 bg-accent-50 border-accent-200',
  unpin: 'text-slate-600 bg-slate-50 border-slate-200',
  sweep: 'text-amber-700 bg-amber-50 border-amber-200',
  refresh: 'text-violet-700 bg-violet-50 border-violet-200',
};

export default function ContextTab({ activeId }: { activeId: string }) {
  const toast = useToast();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [files, setFiles] = useState<CFile[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ path: string; content: string; tokens: number; truncated: boolean } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [opsOpen, setOpsOpen] = useState(true);
  const [cap, setCap] = useState<number>(() => Number(localStorage.getItem(capKey(activeId))) || 200_000);
  const [isHost, setIsHost] = useState(false);

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

  const loadFiles = useCallback(async () => {
    try { const d = await fetch(withProject(`${API}/files`)).then(r => r.json()); setTree(buildTree(d.files ?? [])); setIsHost(!!d.isHost); }
    catch { setTree([]); setIsHost(false); }
  }, [activeId]);

  const refresh = useCallback(async () => { setBusy(true); await Promise.all([loadFiles(), loadContext()]); setBusy(false); }, [loadFiles, loadContext]);
  useEffect(() => { refresh(); }, [activeId]);
  useEffect(() => { loadContext(); }, [cap]);
  useEffect(() => { localStorage.setItem(capKey(activeId), String(cap)); }, [cap, activeId]);

  const openPreview = async (path: string) => {
    try { const d = await fetch(withProject(`${API}/file?path=${encodeURIComponent(path)}`)).then(r => r.json()); setPreview(d); setPreviewOpen(true); }
    catch (e: any) { toast.error('Preview failed', e?.message); }
  };

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

  const renderNode = (n: TreeNode, depth = 0): React.ReactNode => {
    if (n.dir) {
      const open = expanded.has(n.path);
      return (
        <div key={n.path}>
          <button
            onClick={() => setExpanded(prev => { const s = new Set(prev); s.has(n.path) ? s.delete(n.path) : s.add(n.path); return s; })}
            className="flex items-center gap-1.5 w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-100 text-xs font-semibold text-slate-700"
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
            {open ? <FolderOpen size={13} className="text-amber-500 shrink-0" /> : <Folder size={13} className="text-amber-500 shrink-0" />}
            <span className="truncate">{n.name}</span>
          </button>
          {open && n.children.map(c => renderNode(c, depth + 1))}
        </div>
      );
    }
    const added = inContext.has(n.path);
    return (
      <div key={n.path} className="group flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-slate-100" style={{ paddingLeft: 8 + depth * 12 }}>
        <FileCode size={13} className="text-slate-400 shrink-0" />
        <button onClick={() => openPreview(n.path)} className="flex-1 min-w-0 text-left text-xs text-slate-700 truncate hover:text-accent-700" title={n.path}>{n.name}</button>
        <button
          onClick={() => addToContext(n.path)}
          disabled={added}
          data-feature-id="context-add-file"
          title={added ? 'Already in context' : 'Add to context'}
          className={`shrink-0 flex items-center justify-center w-6 h-6 rounded-md transition-colors ${added ? 'text-emerald-500' : 'text-slate-400 hover:text-accent-600 hover:bg-accent-50 sm:opacity-0 sm:group-hover:opacity-100'}`}
        >
          {added ? <Pin size={12} /> : <Plus size={13} />}
        </button>
      </div>
    );
  };

  const filteredTree = useMemo(() => {
    if (!q.trim()) return tree;
    const ql = q.toLowerCase();
    const filter = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap(n => {
      if (n.dir) { const ch = filter(n.children); return ch.length ? [{ ...n, children: ch }] : []; }
      return n.path.toLowerCase().includes(ql) ? [n] : [];
    });
    return filter(tree);
  }, [tree, q]);
  // Auto-expand all when searching.
  useEffect(() => { if (q.trim()) { const all = new Set<string>(); const walk = (ns: TreeNode[]) => ns.forEach(n => { if (n.dir) { all.add(n.path); walk(n.children); } }); walk(tree); setExpanded(all); } }, [q, tree]);

  return (
    <div className="p-3 sm:p-4" data-feature-id="tasks-context-tab">
      {/* Header: title · refresh · budget · gauge */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <BrainCircuit size={18} className="text-accent-600" />
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">Context Memory</h2>
        </div>
        <button onClick={refresh} data-feature-id="context-refresh" className="flex items-center gap-1.5 px-3 min-h-control text-xs font-bold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">
          <RefreshCw size={13} className={busy ? 'animate-spin text-accent-600' : ''} /> Refresh
        </button>
        <button onClick={sweep} data-feature-id="context-sweep" title="Garbage-collect: age out stale + evict over budget" className="flex items-center gap-1.5 px-3 min-h-control text-xs font-bold text-amber-700 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100">
          <Trash2 size={13} /> Sweep
        </button>

        {/* Budget selector */}
        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
          Budget
          <select value={cap} onChange={e => setCap(Number(e.target.value))} data-feature-id="context-budget" className="bg-slate-50 border border-slate-300 rounded-md px-2 py-1.5 text-xs font-semibold text-slate-800 cursor-pointer">
            {BUDGETS.map(b => <option key={b} value={b}>{fmt(b)} tok</option>)}
          </select>
        </label>

        {/* Token gauge — what's IN memory vs budget */}
        {stats && (
          <div className="flex items-center gap-2 min-w-[180px] flex-1 max-w-xs">
            <div className="flex-1 h-2.5 rounded-full bg-slate-200 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${over ? 'bg-rose-500' : gaugePct > 80 ? 'bg-amber-500' : 'bg-accent-500'}`} style={{ width: `${gaugePct}%` }} />
            </div>
            <span className={`text-[11px] font-black tabular-nums ${over ? 'text-rose-600' : 'text-slate-600'}`}>{fmt(stats.totalTokens)}/{fmt(cap)}</span>
          </div>
        )}
      </div>

      {/* Model advisory: Haiku unavailable past 200K */}
      {!haikuOk && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg">
          <AlertTriangle size={13} className="shrink-0" /> Budget over 200K — Haiku can't hold this context. Use Sonnet or Opus (both 1M).
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] gap-3">
        {/* ── Left: project explorer ── */}
        <div className="border border-slate-200 rounded-xl bg-white flex flex-col max-h-[calc(100dvh-260px)]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200">
            <Search size={13} className="text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find file…" className="flex-1 min-w-0 text-xs bg-transparent focus:outline-none text-slate-800 placeholder:text-slate-400" />
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
            {isHost ? (
              <div className="p-6 text-center space-y-2">
                <FolderGit2 size={22} className="mx-auto text-slate-300" />
                <p className="text-[12px] font-bold text-slate-600">No project loaded</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">This is AI-Agents' own repo. Each git repository is one project — open the <span className="font-bold text-accent-600">Projects</span> switcher (top-left) and add/point a project at your git repo to manage its context here.</p>
              </div>
            ) : filteredTree.length ? filteredTree.map(n => renderNode(n)) : (
              <p className="p-4 text-center text-[11px] text-slate-400">No files found in this project's repo.</p>
            )}
          </div>
        </div>

        {/* ── Center: preview (minimizable) ── */}
        <div className={`border border-slate-200 rounded-xl bg-white flex flex-col ${previewOpen ? 'max-h-[calc(100dvh-260px)]' : ''}`}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200">
            <button onClick={() => setPreviewOpen(o => !o)} data-feature-id="context-preview-toggle" className="text-slate-500 hover:text-slate-900" title={previewOpen ? 'Minimize' : 'Expand'}>
              {previewOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            </button>
            <FileCode size={13} className="text-slate-400 shrink-0" />
            <span className="flex-1 min-w-0 text-xs font-mono text-slate-600 truncate">{preview?.path || 'Select a file to preview'}</span>
            {preview && <span className="text-[10px] font-bold text-violet-700 px-1.5 py-0.5 bg-violet-50 rounded border border-violet-200 shrink-0">{fmt(preview.tokens)} tok</span>}
            {preview && !inContext.has(preview.path) && (
              <button onClick={() => addToContext(preview.path)} className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-white bg-accent-600 hover:bg-accent-500 px-2 py-1 rounded-md"><Plus size={11} /> Add</button>
            )}
          </div>
          {previewOpen && (
            <div className="flex-1 overflow-auto custom-scrollbar">
              {preview ? (
                preview.truncated
                  ? <p className="p-4 text-[11px] text-slate-400">File too large to preview ({fmt(preview.tokens)} tokens).</p>
                  : <pre className="p-3 text-[11px] leading-relaxed font-mono text-slate-700 whitespace-pre">{preview.content}</pre>
              ) : <p className="p-4 text-center text-[11px] text-slate-400">Tap a file on the left, then Add it to context.</p>}
            </div>
          )}
        </div>

        {/* ── Right: what's IN memory + model + ops log ── */}
        <div className="flex flex-col gap-3">
          <div className="border border-slate-200 rounded-xl bg-white flex flex-col max-h-[calc(100dvh-260px)]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">In Memory {stats ? `· ${stats.fileCount}` : ''}</span>
              <span className="text-[10px] text-slate-400">{stats?.pinnedCount ?? 0} pinned</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-1">
              {files.length ? files.map(f => (
                <div key={f.path} data-feature-id="context-memory-item" className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-lg border ${f.pinned ? 'border-accent-200 bg-accent-50/40' : 'border-slate-200 bg-slate-50/60'}`}>
                  <FileCode size={12} className="text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-slate-800 truncate" title={f.path}>{f.path}</div>
                    <div className="text-[9px] text-slate-400">{fmt(f.tokens)} tok · used {f.useCount}× · {f.addedBy || 'agent'}</div>
                  </div>
                  <button onClick={() => togglePin(f)} title={f.pinned ? 'Unpin (allow auto-evict)' : 'Pin (never auto-evict)'} className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-md ${f.pinned ? 'text-accent-600' : 'text-slate-400 hover:text-accent-600'}`}>
                    {f.pinned ? <Pin size={12} /> : <PinOff size={12} />}
                  </button>
                  <button onClick={() => remove(f.path)} title="Remove from context" className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600"><X size={12} /></button>
                </div>
              )) : <p className="p-4 text-center text-[11px] text-slate-400">Nothing in context. Add files from the explorer, or agents will populate it as they search.</p>}
            </div>
            {/* Model tier for this budget */}
            <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-200">
              <Cpu size={13} className="text-accent-500 shrink-0" />
              <select value={applyModel} onChange={e => setApplyModel(e.target.value)} data-feature-id="context-model" className="flex-1 bg-slate-50 border border-slate-300 rounded-md px-2 py-1.5 text-xs font-semibold text-slate-800 cursor-pointer">
                <option value="haiku" disabled={!haikuOk}>Haiku{!haikuOk ? ' — max 200K' : ' — fast/cheap'}</option>
                <option value="sonnet">Sonnet — 1M, balanced</option>
                <option value="opus">Opus — 1M, deepest</option>
              </select>
              <button onClick={applyToAgents} className="shrink-0 text-[10px] font-bold text-white bg-accent-600 hover:bg-accent-500 px-2.5 py-1.5 rounded-md">Apply all</button>
            </div>
          </div>

          {/* Ops log — high-quality memory-op timeline (keep/read/evict + timings) */}
          <div className="border border-slate-200 rounded-xl bg-white">
            <button onClick={() => setOpsOpen(o => !o)} className="flex items-center gap-2 w-full px-3 py-2 text-left">
              <Clock size={13} className="text-slate-400" />
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex-1">Memory Log</span>
              <ChevronRight size={14} className={`text-slate-400 transition-transform ${opsOpen ? 'rotate-90' : ''}`} />
            </button>
            {opsOpen && (
              <div className="max-h-64 overflow-y-auto custom-scrollbar px-2 pb-2 space-y-1">
                {ops.length ? ops.map(o => (
                  <div key={o.id} className="flex items-center gap-1.5 text-[10px]">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded border font-bold uppercase ${OP_STYLE[o.op] || 'text-slate-600 bg-slate-50 border-slate-200'}`}>{o.op}</span>
                    <span className="flex-1 min-w-0 truncate font-mono text-slate-600" title={o.reason || ''}>{o.path || o.reason}</span>
                    {o.durationMs != null && <span className="shrink-0 text-slate-400 tabular-nums">{o.durationMs}ms</span>}
                    <span className="shrink-0 text-slate-300">{o.actor}</span>
                  </div>
                )) : <p className="p-3 text-center text-[11px] text-slate-400">No memory operations yet.</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
