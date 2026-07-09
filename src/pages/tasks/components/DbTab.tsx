import React, { useCallback, useEffect, useState } from 'react';
import { Tooltip } from './Tooltip';
import { Database, Search, Trash2, Edit2, Plus, ChevronLeft, ChevronRight, X, Save, AlertTriangle, ArrowUp, ArrowDown, PencilLine } from 'lucide-react';
import { API_BASE as API } from '../../../apiBase';
import { Modal } from './Modal';
import { btnDangerSm, iconBtnDanger } from '../ui';

/**
 * DB Browser tab — clean paginated view over the allowlisted SQLite tables
 * (tasks, board_settings, agent_logs, agent_db_usage) with search, create,
 * update, delete. Lazy-loaded; talks only to the db-server API.
 */

const PAGE = 25;

interface Col { name: string; type: string; pk: number }
interface TableInfo { name: string; rows: number }

export default function DbTab() {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [active, setActive] = useState<string>('tasks');
  const [cols, setCols] = useState<Col[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  const [editing, setEditing] = useState<any | null>(null); // row being edited ({} = new)
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkEdit, setBulkEdit] = useState<{ col: string; val: string } | null>(null);
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);

  const loadTables = () =>
    fetch(`${API}/db/tables`).then(r => r.json()).then(d => setTables(d.tables ?? [])).catch(() => setTables([]));

  const loadRows = useCallback((table = active, off = offset, query = q) => {
    const s = sort ? `&sort=${encodeURIComponent(sort.col)}&dir=${sort.dir}` : '';
    fetch(`${API}/db/table/${table}?limit=${PAGE}&offset=${off}&q=${encodeURIComponent(query)}${s}`)
      .then(r => r.json())
      .then(d => { setCols(d.columns ?? []); setRows(d.rows ?? []); setTotal(d.total ?? 0); })
      .catch(() => { setRows([]); setTotal(0); });
  }, [active, offset, q, sort]);

  const toggleSort = (col: string) => {
    setOffset(0);
    setSort(prev => prev?.col === col
      ? (prev.dir === 'desc' ? { col, dir: 'asc' } : null) // desc → asc → off
      : { col, dir: 'desc' });
  };

  useEffect(() => { loadTables(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setEditing(null); setBulkEdit(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { loadRows(); }, [loadRows]);

  const switchTable = (t: string) => { setActive(t); setOffset(0); setQ(''); setEditing(null); setSelected(new Set()); setBulkEdit(null); setConfirmBulkDel(false); };

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
    if (v === null || v === undefined) return <span className="text-slate-300 italic">null</span>;
    const s = String(v);
    if (colName === 'status' && STATUS_CLASS[s]) {
      return <span className={`inline-block px-2 py-0.5 text-micro font-black rounded-full border ${STATUS_CLASS[s]}`}>{s}</span>;
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

  return (
    <div className="p-3 sm:p-4 space-y-3" data-feature-id="tasks-db-tab">
      {/* Table chips + search */}
      <div className="flex items-center gap-2 flex-wrap">
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
              value={q}
              onChange={e => { setQ(e.target.value); setOffset(0); }}
              placeholder="Search all text columns…"
              data-feature-id="db-search"
              className="pl-8 pr-3 min-h-control text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500 placeholder:text-slate-400 w-52"
            />
          </div>
          <button
            onClick={() => setEditing({})}
            data-feature-id="db-add-row"
            className="flex items-center gap-1.5 px-3 min-h-control text-xs font-bold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <Plus size={14} /> Row
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 bg-accent-50 border-2 border-accent-200 rounded-xl" data-feature-id="db-bulk-bar">
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
              <button onClick={bulkUpdate} disabled={busy || !bulkEdit.col}
                className="px-3 min-h-control text-xs font-bold bg-slate-900 text-white rounded-lg disabled:opacity-40 hover:bg-slate-800">
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
                  className="px-3 min-h-control text-xs font-black bg-rose-600 text-white rounded-lg">
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
      <div className="bg-white border-2 border-slate-200 rounded-xl overflow-auto custom-scrollbar max-h-[calc(100dvh-330px)] shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gradient-to-b from-slate-200 to-slate-100 shadow-[0_2px_0_0_#94a3b8]">
              <th className="px-3 py-3 w-10 border-r border-slate-300 bg-slate-200/70">
                <input type="checkbox" checked={pageAllSelected} onChange={togglePage}
                  className="w-4 h-4 accent-accent-600" title="Select page" data-feature-id="db-select-page" />
              </th>
              {cols.map(c => (
                <th
                  key={c.name}
                  onClick={() => toggleSort(c.name)}
                  data-feature-id="db-sort-header"
                  className={`px-3 py-3 text-2xs font-black uppercase tracking-wide whitespace-nowrap cursor-pointer select-none border-r border-slate-300 transition-colors ${sort?.col === c.name ? 'text-accent-700 bg-accent-100/70' : 'text-slate-700 hover:bg-slate-200/80'}`}
                  title={`Sort by ${c.name}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.name}{c.pk ? ' 🔑' : ''}
                    {sort?.col === c.name && (sort.dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                  </span>
                </th>
              ))}
              <th className="px-3 py-3 text-2xs font-black uppercase text-slate-700 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={cols.length + 2} className="px-4 py-10 text-center text-sm text-slate-500">No rows{q ? ' match the search' : ''}.</td></tr>
            ) : rows.map((r, ri) => (
              <tr key={r._rowid}
                className={`border-b border-slate-100 transition-colors ${selected.has(r._rowid) ? 'bg-accent-50/70' : ri % 2 ? 'bg-slate-50/50' : 'bg-white'} hover:bg-accent-50/40`}>
                <td className="px-3 py-2 align-top border-r border-slate-100">
                  <input type="checkbox" checked={selected.has(r._rowid)} onChange={() => toggleRow(r._rowid)}
                    className="w-4 h-4 accent-accent-600" data-feature-id="db-select-row" />
                </td>
                {cols.map(c => (
                  <td key={c.name} className="px-3 py-2 text-xs text-slate-800 font-mono max-w-[260px] truncate align-top border-r border-slate-100" title={String(r[c.name] ?? '')}>
                    {cell(c.name, r[c.name])}
                  </td>
                ))}
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
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{total} rows · page {page}/{pages}</p>
        <div className="flex gap-2">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}
            className="flex items-center gap-1 px-3 min-h-control text-xs font-bold bg-white border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50 text-slate-700 transition-colors">
            <ChevronLeft size={14} /> Prev
          </button>
          <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}
            className="flex items-center gap-1 px-3 min-h-control text-xs font-bold bg-white border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50 text-slate-700 transition-colors">
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-2xs text-amber-700">
        <AlertTriangle size={12} /> Direct edits bypass the board's rules (DoD checks, status flow) — prefer the Board UI for task changes; use this for inspection and cleanup.
      </p>

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
              <button onClick={() => setEditing(null)} className="px-4 min-h-[42px] text-xs font-bold text-slate-600 rounded-lg hover:bg-slate-100">Cancel</button>
              <button onClick={save} disabled={busy} className="flex items-center gap-1.5 px-5 min-h-[42px] text-xs font-bold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50">
                <Save size={14} /> {editing._rowid === undefined ? 'Insert' : 'Update'}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            {cols.map(c => (
              <div key={c.name}>
                <label className="text-micro font-bold uppercase text-slate-500 tracking-wide">{c.name} <span className="text-slate-500">({c.type || 'TEXT'})</span></label>
                <textarea
                  rows={String(editing[c.name] ?? '').length > 60 ? 3 : 1}
                  value={editing[c.name] ?? ''}
                  onChange={e => setEditing({ ...editing, [c.name]: e.target.value === '' ? null : e.target.value })}
                  className="w-full mt-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:border-accent-500 resize-y"
                />
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
