import React, { useCallback, useEffect, useState } from 'react';
import { Tooltip } from './Tooltip';
import { Database, Search, Trash2, Edit2, Plus, ChevronLeft, ChevronRight, ChevronDown, X, Save, AlertTriangle, ArrowUp, ArrowDown, PencilLine, Server, Table2, RotateCcw, CheckCircle2, Loader2 } from 'lucide-react';
import { API_BASE as API } from '../../../apiBase';
import { Modal } from './Modal';
import DbBackendTab from './DbBackendTab';
import { btnDangerSm, btnPrimarySm, btnSm, iconBtnDanger } from '../ui';

/**
 * DB Browser tab — clean paginated view over the allowlisted SQLite tables
 * (tasks, board_settings, agent_logs, agent_db_usage) with search, create,
 * update, delete. Lazy-loaded; talks only to the db-server API.
 */

const PAGE = 25;

interface Col { name: string; type: string; pk: number }
interface TableInfo { name: string; rows: number }

type RestoreMode = 'overwrite' | 'delete';
// What GET /db/restore-defaults?mode= returns — a dry run so the user sees the blast radius
// (custom agents are only removed by `delete`) before committing.
interface RestorePreview {
  mode: RestoreMode;
  customAgentsRemoved: string[];
  builtInAgentsReverted: string[];
  settingsReverted: string[];
  logsCleared: string[];
  untouched: string[];
}
// What POST /db/restore-defaults returns.
interface RestoreResult {
  mode: string;
  agents: { deleted: number; written: number };
  boardSettings: { deleted: number; written: number };
  logs: { deleted: number; error?: string };
}

export default function DbTab() {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [active, setActive] = useState<string>('tasks');
  const [cols, setCols] = useState<Col[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true); // first-load / re-fetch guard for the skeleton (item 88)
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');          // debounced query that actually drives the fetch
  const [qInput, setQInput] = useState(''); // live text-field value (debounced into `q`)
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // `${rowid}:${col}` cells shown in full
  const [editing, setEditing] = useState<any | null>(null); // row being edited ({} = new)
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkEdit, setBulkEdit] = useState<{ col: string; val: string } | null>(null);
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);

  // Restore-to-defaults: reseed the built-in agents + settings. `overwrite` keeps custom
  // agents; `delete` is a factory reset that removes them. projects/tasks are never touched.
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('overwrite');
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [restoreErr, setRestoreErr] = useState<string | null>(null);

  const loadTables = () =>
    fetch(`${API}/db/tables`).then(r => r.json()).then(d => setTables(d.tables ?? [])).catch(() => setTables([]));

  const loadRows = useCallback((table = active, off = offset, query = q) => {
    setLoading(true);
    const s = sort ? `&sort=${encodeURIComponent(sort.col)}&dir=${sort.dir}` : '';
    fetch(`${API}/db/table/${table}?limit=${PAGE}&offset=${off}&q=${encodeURIComponent(query)}${s}`)
      .then(r => r.json())
      .then(d => { setCols(d.columns ?? []); setRows(d.rows ?? []); setTotal(d.total ?? 0); })
      .catch(() => { setRows([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [active, offset, q, sort]);

  const toggleSort = (col: string) => {
    setOffset(0);
    setSort(prev => prev?.col === col
      ? (prev.dir === 'desc' ? { col, dir: 'asc' } : null) // desc → asc → off
      : { col, dir: 'desc' });
  };

  // Debounce the search box so we fetch once the user pauses, not per keystroke.
  useEffect(() => {
    if (qInput === q) return;
    const id = setTimeout(() => { setQ(qInput); setOffset(0); }, 300);
    return () => clearTimeout(id);
  }, [qInput, q]);
  const searching = qInput !== q; // a fetch is pending behind the current keystrokes

  useEffect(() => { loadTables(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setEditing(null); setBulkEdit(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { loadRows(); }, [loadRows]);

  const switchTable = (t: string) => { setActive(t); setOffset(0); setQ(''); setQInput(''); setEditing(null); setSelected(new Set()); setExpanded(new Set()); setBulkEdit(null); setConfirmBulkDel(false); };

  // Cell expand/collapse for wide values (JSON blobs like `scenarios`, long text).
  const isExpandable = (v: any) => {
    if (v === null || v === undefined) return false;
    const s = String(v);
    return /^\s*[[{]/.test(s) || s.length > 80;
  };
  const pretty = (v: any) => {
    const s = String(v);
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
  };
  const toggleExpand = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // Per-column hint for the raw insert form — derived from name + declared type only.
  const schemaHint = (c: Col): string => {
    if (c.pk) return 'primary key — leave blank to auto-assign';
    const t = (c.type || '').toUpperCase();
    const n = c.name.toLowerCase();
    if (/scenario|json|meta|payload|config|settings|\bdata\b/.test(n)) return 'JSON — e.g. {"key": "value"}';
    if (t.includes('INT')) return 'integer — e.g. 42';
    if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB') || t.includes('NUM')) return 'number — e.g. 3.14';
    if (t.includes('BOOL')) return '0 or 1';
    if (/_at$|date|time/.test(n)) return 'ISO 8601 — e.g. 2026-07-11T09:30:00Z';
    return 'text — leave blank for null';
  };

  const toggleRow = (rowid: number) => setSelected(prev => {
    const next = new Set(prev);
    next.has(rowid) ? next.delete(rowid) : next.add(rowid);
    return next;
  });

  const pageAllSelected = rows.length > 0 && rows.every(r => selected.has(r._rowid));
  const togglePage = () => setSelected(prev => {
    const next = new Set(prev);
    for (const r of rows) pageAllSelected ? next.delete(r._rowid) : next.add(r._rowid);
    return next;
  });

  const bulkDelete = async () => {
    setBusy(true);
    try {
      await fetch(`${API}/db/table/${active}/bulk-delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowids: [...selected] }),
      });
      setSelected(new Set()); setConfirmBulkDel(false);
      loadRows(); loadTables();
    } finally { setBusy(false); }
  };

  const bulkUpdate = async () => {
    if (!bulkEdit?.col) return;
    setBusy(true);
    try {
      await fetch(`${API}/db/table/${active}/bulk-update`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowids: [...selected], set: { [bulkEdit.col]: bulkEdit.val === '' ? null : bulkEdit.val } }),
      });
      setSelected(new Set()); setBulkEdit(null);
      loadRows(); loadTables();
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const isNew = editing._rowid === undefined;
    const payload = { ...editing };
    delete payload._rowid;
    try {
      await fetch(isNew ? `${API}/db/table/${active}` : `${API}/db/table/${active}/${editing._rowid}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setEditing(null);
      loadRows(); loadTables();
    } finally { setBusy(false); }
  };

  // Load the dry-run preview whenever the modal opens or the mode changes.
  useEffect(() => {
    if (!restoreOpen || restoreResult) return;
    setRestorePreview(null); setRestoreErr(null);
    fetch(`${API}/db/restore-defaults?mode=${restoreMode}`)
      .then(r => r.json())
      .then(d => d.error ? setRestoreErr(d.error) : setRestorePreview(d))
      .catch(e => setRestoreErr(String(e?.message || e)));
  }, [restoreOpen, restoreMode, restoreResult]);

  const runRestore = async () => {
    setBusy(true); setRestoreErr(null);
    try {
      const r = await fetch(`${API}/db/restore-defaults`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: restoreMode }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setRestoreErr(d.error || `HTTP ${r.status}`); return; }
      setRestoreResult(d);
      loadTables(); loadRows();
    } catch (e: any) { setRestoreErr(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const closeRestore = () => {
    setRestoreOpen(false); setRestoreResult(null); setRestorePreview(null);
    setRestoreErr(null); setRestoreMode('overwrite');
  };

  const del = async (rowid: number) => {
    setBusy(true);
    try {
      await fetch(`${API}/db/table/${active}/${rowid}`, { method: 'DELETE' });
      setConfirmDel(null);
      loadRows(); loadTables();
    } finally { setBusy(false); }
  };

  const STATUS_CLASS: Record<string, string> = {
    TODO: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
    AVAILABLE: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    WORKING: 'bg-accent-50 text-accent-700 border-accent-200',
    BLOCKED: 'bg-rose-50 text-rose-700 border-rose-200',
    TESTING: 'bg-amber-50 text-amber-700 border-amber-200',
    DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };

  const cell = (colName: string, v: any) => {
    if (v === null || v === undefined) return <span className="text-slate-500 italic">null</span>;
    const s = String(v);
    if (colName === 'status' && STATUS_CLASS[s]) {
      return <span className={`inline-block px-2 py-0.5 text-micro font-bold rounded-full border ${STATUS_CLASS[s]}`}>{s}</span>;
    }
    if (colName === 'type' && ['error', 'warning', 'success', 'info'].includes(s)) {
      const c = s === 'error' ? 'text-rose-600' : s === 'warning' ? 'text-amber-600' : s === 'success' ? 'text-emerald-600' : 'text-slate-500';
      return <span className={`font-bold ${c}`}>{s}</span>;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      return <span className="text-slate-600">{s.slice(0, 10)} <span className="text-slate-500">{s.slice(11, 19)}</span></span>;
    }
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  };

  const page = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  // Datastore config (SQLite vs Postgres) moved here from the Git modal — it is a database
  // concern, not a git one. Browse = the row viewer; Backend = which datastore is live.
  const [section, setSection] = useState<'browse' | 'backend'>('browse');

  return (
    <div className="h-full flex flex-col min-h-0 p-3 sm:p-4 gap-3" data-feature-id="tasks-db-tab">
      <div role="tablist" aria-label="Database view" className="shrink-0 inline-flex p-0.5 gap-0.5 rounded-lg bg-slate-100 border border-slate-200">
        {([['browse', 'Browse', Table2], ['backend', 'Backend', Server]] as const).map(([id, label, Icon]) => {
          const on = section === id;
          return (
            <button key={id} role="tab" aria-selected={on} onClick={() => setSection(id)}
              data-feature-id={`db-section-${id}`}
              className={`flex items-center gap-1.5 px-3 min-h-control text-xs font-bold rounded-md transition-colors ${on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 sm:hover:text-slate-900'}`}>
              <Icon size={14} className={on ? 'text-accent-600' : ''} /> {label}
            </button>
          );
        })}
      </div>

      {section === 'backend' ? (
        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
          <DbBackendTab />
        </div>
      ) : (<>
      {/* Table chips + search */}
      <div className="shrink-0 flex items-center gap-2 flex-wrap">
        {tables === null && Array.from({ length: 4 }).map((_, i) => (
          <div key={`sk-chip-${i}`} className="min-h-control w-24 rounded-lg bg-slate-100 border border-slate-200 animate-pulse" aria-hidden="true" />
        ))}
        {(tables ?? []).map(t => (
          <button
            key={t.name}
            onClick={() => switchTable(t.name)}
            data-feature-id="db-table-chip"
            className={`flex items-center gap-1.5 px-3 min-h-control text-xs font-bold font-mono rounded-lg border transition-colors ${active === t.name
              ? 'bg-accent-600 text-white border-accent-600'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
          >
            <Database size={12} /> {t.name} <span className="text-micro opacity-70">{t.rows}</span>
          </button>
        ))}
        <div className="flex items-center gap-2 ml-auto">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={qInput}
              onChange={e => setQInput(e.target.value)}
              placeholder="Search all text columns…"
              data-feature-id="db-search"
              className="pl-8 pr-14 min-h-control text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500 placeholder:text-slate-400 w-52"
            />
            {searching && (
              <Loader2 size={13} className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" aria-label="Searching" />
            )}
            {qInput && (
              <Tooltip label="Clear search">
                <button
                  onClick={() => setQInput('')}
                  data-feature-id="db-search-clear"
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <X size={13} />
                </button>
              </Tooltip>
            )}
          </div>
          <button
            onClick={() => setEditing({})}
            data-feature-id="db-add-row"
            className={btnPrimarySm}
          >
            <Plus size={14} /> Row
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="shrink-0 flex items-center gap-3 flex-wrap px-4 py-2.5 bg-accent-50 border-2 border-accent-200 rounded-xl" data-feature-id="db-bulk-bar">
          <span className="text-sm font-bold text-accent-900">{selected.size} selected</span>
          <div className="w-px h-5 bg-accent-200" />
          {bulkEdit ? (
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={bulkEdit.col}
                onChange={e => setBulkEdit({ ...bulkEdit, col: e.target.value })}
                className="px-2 min-h-control text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900"
              >
                <option value="">column…</option>
                {cols.filter(c => !c.pk).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              <input
                value={bulkEdit.val}
                onChange={e => setBulkEdit({ ...bulkEdit, val: e.target.value })}
                placeholder="new value (empty = null)"
                className="px-3 min-h-control text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 w-44"
              />
              <button onClick={bulkUpdate} disabled={busy || !bulkEdit.col} className={btnPrimarySm}>
                Apply to {selected.size}
              </button>
              <button onClick={() => setBulkEdit(null)} className="px-2 min-h-control text-xs font-bold text-slate-600 hover:text-slate-900">Cancel</button>
            </div>
          ) : (
            <>
              <button onClick={() => setBulkEdit({ col: '', val: '' })} data-feature-id="db-bulk-update"
                className="flex items-center gap-1.5 px-3 min-h-control text-xs font-bold bg-white text-accent-700 border border-accent-300 rounded-lg hover:bg-accent-100">
                <PencilLine size={13} /> Set column…
              </button>
              {confirmBulkDel ? (
                <button onClick={bulkDelete} disabled={busy} data-feature-id="db-bulk-delete-confirm"
                  className="px-3 min-h-control text-xs font-bold bg-rose-600 text-white rounded-lg">
                  Delete {selected.size} rows
                </button>
              ) : (
                <button onClick={() => setConfirmBulkDel(true)} data-feature-id="db-bulk-delete"
                  className="flex items-center gap-1.5 px-3 min-h-control text-xs font-bold bg-white text-rose-600 border border-rose-300 rounded-lg hover:bg-rose-50">
                  <Trash2 size={13} /> Delete
                </button>
              )}
            </>
          )}
          <button onClick={() => { setSelected(new Set()); setConfirmBulkDel(false); setBulkEdit(null); }}
            className="ml-auto flex items-center gap-1 px-2 min-h-control text-xs font-bold text-slate-500 hover:text-slate-900">
            <X size={13} /> Clear
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 min-h-0 bg-white border-2 border-slate-200 rounded-xl overflow-auto custom-scrollbar shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gradient-to-b from-slate-200 to-slate-100 shadow-[0_2px_0_0_#94a3b8]">
              <th className="px-3 py-3 w-10 border-r border-slate-300 bg-slate-200/70">
                <input type="checkbox" checked={pageAllSelected} onChange={togglePage}
                  className="w-4 h-4 accent-accent-600" aria-label="Select all rows on this page" data-feature-id="db-select-page" />
              </th>
              {cols.map(c => (
                <th
                  key={c.name}
                  onClick={() => toggleSort(c.name)}
                  data-feature-id="db-sort-header"
                  className={`px-3 py-3 text-2xs font-bold uppercase tracking-wide whitespace-nowrap cursor-pointer select-none border-r border-slate-300 transition-colors ${sort?.col === c.name ? 'text-accent-700 bg-accent-100/70' : 'text-slate-700 hover:bg-slate-200/80'}`}
                  title={`Sort by ${c.name}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.name}{c.pk ? ' 🔑' : ''}
                    {sort?.col === c.name && (sort.dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                  </span>
                </th>
              ))}
              <th className="px-3 py-3 text-2xs font-bold uppercase text-slate-700 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              // Skeleton while the first page fetches — holds the grid's shape instead of a
              // blank flash then a pop-in (item 88). Column count is a guess until cols land.
              Array.from({ length: 8 }).map((_, ri) => (
                <tr key={`sk-${ri}`} className="border-b border-slate-100">
                  <td className="px-3 py-3 border-r border-slate-100"><div className="h-4 w-4 rounded bg-slate-200 animate-pulse" /></td>
                  {Array.from({ length: cols.length || 5 }).map((_, ci) => (
                    <td key={ci} className="px-3 py-3 border-r border-slate-100"><div className="h-3 rounded bg-slate-200 animate-pulse" style={{ width: `${55 + ((ri + ci) % 4) * 10}%` }} /></td>
                  ))}
                  <td className="px-3 py-3"><div className="h-3 w-10 rounded bg-slate-200 animate-pulse ml-auto" /></td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length + 2} className="px-4 py-10 text-center text-sm text-slate-500">No rows{q ? ' match the search' : ''}.</td></tr>
            ) : rows.map((r, ri) => (
              <tr key={r._rowid}
                className={`border-b border-slate-100 transition-colors ${selected.has(r._rowid) ? 'bg-accent-50/70' : ri % 2 ? 'bg-slate-50/50' : 'bg-white'} hover:bg-accent-50/40`}>
                <td className="px-3 py-2 align-top border-r border-slate-100">
                  <input type="checkbox" checked={selected.has(r._rowid)} onChange={() => toggleRow(r._rowid)}
                    className="w-4 h-4 accent-accent-600" data-feature-id="db-select-row" />
                </td>
                {cols.map(c => {
                  const raw = r[c.name];
                  const key = `${r._rowid}:${c.name}`;
                  const canExpand = isExpandable(raw);
                  const open = expanded.has(key);
                  return (
                    <td
                      key={c.name}
                      className={`px-3 py-2 text-xs text-slate-800 font-mono border-r border-slate-100 align-top ${open ? 'max-w-[460px]' : 'max-w-[260px]'} ${canExpand ? '' : 'truncate'}`}
                      title={open ? undefined : String(raw ?? '')}
                    >
                      {canExpand ? (
                        <div className="flex flex-col items-start gap-1">
                          {open ? (
                            <pre className="whitespace-pre-wrap break-words text-2xs leading-relaxed max-h-64 overflow-auto custom-scrollbar bg-slate-50 border border-slate-200 rounded-md p-2 w-full">{pretty(raw)}</pre>
                          ) : (
                            <span className="block max-w-full truncate">{cell(c.name, raw)}</span>
                          )}
                          <button
                            onClick={() => toggleExpand(key)}
                            data-feature-id="db-cell-expand"
                            className="inline-flex items-center gap-0.5 text-micro font-bold text-accent-600 hover:text-accent-700"
                          >
                            <ChevronDown size={11} className={open ? 'rotate-180' : ''} /> {open ? 'Collapse' : 'Expand'}
                          </button>
                        </div>
                      ) : cell(c.name, raw)}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right whitespace-nowrap align-top">
                  <Tooltip label="Edit"><button onClick={() => setEditing({ ...r })} className="p-1.5 text-slate-500 hover:text-accent-600 transition-colors"><Edit2 size={14} /></button></Tooltip>
                  {confirmDel === r._rowid ? (
                    <Tooltip label="Confirm delete"><button onClick={() => del(r._rowid)} disabled={busy} className={btnDangerSm}>Delete</button></Tooltip>
                  ) : (
                    <Tooltip label="Delete"><button onClick={() => setConfirmDel(r._rowid)} className={iconBtnDanger}><Trash2 size={14} /></button></Tooltip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="shrink-0 flex items-center justify-between">
        <p className="text-xs text-slate-500">{total} rows · page {page}/{pages}</p>
        <div className="flex gap-2">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className={btnSm}>
            <ChevronLeft size={14} /> Prev
          </button>
          <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} className={btnSm}>
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <p className="flex items-center gap-1.5 text-2xs text-amber-700">
          <AlertTriangle size={12} /> Direct edits bypass the board's rules (DoD checks, status flow) — prefer the Board UI for task changes; use this for inspection and cleanup.
        </p>
        <button onClick={() => setRestoreOpen(true)} data-feature-id="db-restore-defaults" className={btnSm}>
          <RotateCcw size={13} /> Restore defaults…
        </button>
      </div>

      {/* Edit/Create modal */}
      {editing && (
        <Modal
          isOpen
          onClose={() => setEditing(null)}
          title={editing._rowid === undefined ? `New row in ${active}` : `Edit ${active} #${editing._rowid}`}
          icon={<Database size={18} className="text-accent-600" />}
          maxW="sm:max-w-xl"
          featureId="db-row-edit"
          footer={
            <div className="flex justify-end gap-2 w-full">
              <button onClick={() => setEditing(null)} className="px-4 min-h-control-lg text-xs font-bold text-slate-600 rounded-lg hover:bg-slate-100">Cancel</button>
              <button onClick={save} disabled={busy} className="flex items-center gap-1.5 px-5 min-h-control-lg text-xs font-bold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50">
                <Save size={14} /> {editing._rowid === undefined ? 'Insert' : 'Update'}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            {cols.map(c => {
              const hint = schemaHint(c);
              const isNewRow = editing._rowid === undefined;
              return (
                <div key={c.name}>
                  <label className="flex items-center gap-1.5 eyebrow">
                    {c.name}
                    <span className="text-slate-400 normal-case tracking-normal font-mono font-semibold">{c.type || 'TEXT'}</span>
                    {c.pk ? <span className="px-1 rounded bg-amber-100 text-amber-700 normal-case tracking-normal">PK</span> : null}
                  </label>
                  <textarea
                    rows={String(editing[c.name] ?? '').length > 60 ? 3 : 1}
                    value={editing[c.name] ?? ''}
                    onChange={e => setEditing({ ...editing, [c.name]: e.target.value === '' ? null : e.target.value })}
                    placeholder={hint}
                    className="w-full mt-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-accent-500 resize-y"
                  />
                  {isNewRow && <p className="mt-1 text-micro text-slate-500">{hint}</p>}
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {/* Restore-to-defaults */}
      {restoreOpen && (
        <Modal
          isOpen
          onClose={closeRestore}
          title="Restore defaults"
          icon={<RotateCcw size={18} className="text-accent-600" />}
          maxW="sm:max-w-xl"
          featureId="db-restore-modal"
          footer={
            restoreResult ? (
              <div className="flex justify-end w-full">
                <button onClick={closeRestore} className={btnPrimarySm}>Done</button>
              </div>
            ) : (
              <div className="flex justify-end gap-2 w-full">
                <button onClick={closeRestore} className="px-4 min-h-control-lg text-xs font-bold text-slate-600 rounded-lg hover:bg-slate-100">Cancel</button>
                <button onClick={runRestore} disabled={busy || !restorePreview} className={restoreMode === 'delete' ? btnDangerSm : btnPrimarySm}>
                  {restoreMode === 'delete' ? 'Delete all & restore' : 'Restore defaults'}
                </button>
              </div>
            )
          }
        >
          {restoreResult ? (
            <div className="space-y-2 text-xs">
              <p className="flex items-center gap-2 text-emerald-700 font-bold"><CheckCircle2 size={16} /> Defaults restored ({restoreResult.mode}).</p>
              <p className="text-slate-700">Agents: {restoreResult.agents.written} written{restoreResult.agents.deleted ? `, ${restoreResult.agents.deleted} deleted` : ''}.</p>
              <p className="text-slate-700">Settings: {restoreResult.boardSettings.written} written{restoreResult.boardSettings.deleted ? `, ${restoreResult.boardSettings.deleted} deleted` : ''}.</p>
              {restoreResult.logs.deleted > 0 && <p className="text-slate-700">Logs: {restoreResult.logs.deleted} orphaned rows cleared (live-task history kept).</p>}
              {restoreResult.logs.error && <p className="text-amber-700">Logs were left in place — logs.db was busy: {restoreResult.logs.error}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Mode picker — two radio-style cards. */}
              <div className="space-y-2">
                {([
                  ['overwrite', 'Restore built-in defaults', 'Revert the built-in agents and settings to their shipped defaults. Any custom agents you added are kept.'],
                  ['delete', 'Delete all & restore (factory reset)', 'Delete every agent row, then reseed the built-in agents. Custom agents are removed, in-scope settings reset, and orphaned logs cleared — logs for tasks still on the board are kept.'],
                ] as const).map(([m, title, desc]) => {
                  const on = restoreMode === m;
                  const danger = m === 'delete';
                  return (
                    <button key={m} onClick={() => setRestoreMode(m)} data-feature-id={`db-restore-mode-${m}`}
                      className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${on ? (danger ? 'border-rose-400 bg-rose-50' : 'border-accent-400 bg-accent-50') : 'border-slate-200 hover:border-slate-300'}`}>
                      <div className="flex items-center gap-2">
                        <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${on ? (danger ? 'border-rose-500 bg-rose-500' : 'border-accent-500 bg-accent-500') : 'border-slate-300'}`} />
                        <span className="text-xs font-bold text-slate-900">{title}</span>
                      </div>
                      <p className="mt-1 ml-6 text-2xs text-slate-600">{desc}</p>
                    </button>
                  );
                })}
              </div>

              {/* Dry-run preview of the blast radius. */}
              {restoreErr ? (
                <p className="text-xs text-rose-600">Could not load preview: {restoreErr}</p>
              ) : !restorePreview ? (
                <p className="text-xs text-slate-500">Loading preview…</p>
              ) : (
                <div className="space-y-1.5 text-2xs bg-slate-50 border border-slate-200 rounded-lg p-3">
                  {restoreMode === 'delete' && restorePreview.customAgentsRemoved.length > 0 && (
                    <p className="text-rose-700"><span className="font-bold">{restorePreview.customAgentsRemoved.length} custom agent(s) removed:</span> {restorePreview.customAgentsRemoved.join(', ')}</p>
                  )}
                  {restoreMode === 'delete' && restorePreview.logsCleared.length > 0 && (
                    <p className="text-rose-700"><span className="font-bold">Orphaned logs cleared:</span> {restorePreview.logsCleared.join(', ')} <span className="text-slate-500">(live-task logs kept)</span></p>
                  )}
                  <p className="text-slate-700"><span className="font-bold">Agents reverted:</span> {restorePreview.builtInAgentsReverted.join(', ')}</p>
                  <p className="text-slate-700"><span className="font-bold">Settings reverted:</span> {restorePreview.settingsReverted.join(', ') || '—'}</p>
                  <p className="text-slate-500"><span className="font-bold">Never touched:</span> {restorePreview.untouched.join(', ')}</p>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
      </>)}
    </div>
  );
}
