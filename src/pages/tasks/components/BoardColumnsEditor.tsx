import React from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { Column } from '../types';
import { BUILTIN_COLUMNS, makeColumnId } from '../boardConfig';

// Shared swimlane editor — used both by the Board tab's Settings modal and the
// project Edit popup's "Boards" accordion. Controlled: parent owns the columns array.
interface BoardColumnsEditorProps {
  columns: Column[];
  onChange: (columns: Column[]) => void;
}

const SWATCHES = ['#d946ef', '#06b6d4', '#6366f1', '#f43f5e', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#64748b', '#0ea5e9'];

export function BoardColumnsEditor({ columns, onChange }: BoardColumnsEditorProps) {
  const patch = (id: string, changes: Partial<Column>) =>
    onChange(columns.map(c => (c.id === id ? { ...c, ...changes } : c)));

  const remove = (id: string) => onChange(columns.filter(c => c.id !== id));

  const move = (id: string, dir: -1 | 1) => {
    const i = columns.findIndex(c => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const addCustom = () => {
    let id = makeColumnId('New Lane');
    if (columns.some(c => c.id === id)) id = `${id}_${columns.length}`;
    onChange([...columns, { id, label: 'New Lane', color: SWATCHES[columns.length % SWATCHES.length] }]);
  };

  const missingBuiltins = BUILTIN_COLUMNS.filter(b => !columns.some(c => c.id === b.id));
  const addBuiltin = (b: Column) => onChange([...columns, b]);

  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Swimlanes ({columns.length})</h3>
          <button
            onClick={addCustom}
            data-feature-id="board-editor-add-column"
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <Plus size={14} /> Add Lane
          </button>
        </div>

        <div className="space-y-2.5">
          {columns.map((lane, i) => (
            <div key={lane.id} className="flex items-center gap-3 p-3 rounded-xl border bg-slate-50 border-slate-200">
              <div className="flex flex-col gap-0.5 shrink-0">
                <button onClick={() => move(lane.id, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-20" title="Move up"><ArrowUp size={14} /></button>
                <button onClick={() => move(lane.id, 1)} disabled={i === columns.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-20" title="Move down"><ArrowDown size={14} /></button>
              </div>

              <input
                type="color"
                value={lane.color}
                onChange={e => patch(lane.id, { color: e.target.value })}
                className="w-8 h-8 rounded-lg border border-slate-300 bg-white cursor-pointer shrink-0 p-0.5"
                title="Lane color"
              />

              <input
                type="text"
                value={lane.label}
                onChange={e => patch(lane.id, { label: e.target.value })}
                className="flex-1 min-w-0 bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-800 focus:outline-none focus:border-accent-400"
              />

              <span className="hidden sm:inline text-[9px] font-bold text-slate-400 uppercase tracking-tighter shrink-0">
                {lane.builtin ? lane.id : 'custom'}
              </span>

              <button
                onClick={() => remove(lane.id)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors shrink-0"
                title="Remove lane"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {columns.length === 0 && (
            <p className="text-[11px] text-amber-700 font-medium p-3 bg-amber-50 border border-amber-200 rounded-xl">Add at least one lane.</p>
          )}
        </div>
      </section>

      {missingBuiltins.length > 0 && (
        <section>
          <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2.5">Re-add built-in lanes</h3>
          <div className="flex flex-wrap gap-2">
            {missingBuiltins.map(b => (
              <button
                key={b.id}
                onClick={() => addBuiltin(b)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-white border border-slate-300 rounded-lg hover:border-accent-400 hover:bg-slate-50 transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                {b.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
        <p className="text-[10px] text-slate-500 leading-relaxed">
          <span className="font-black uppercase tracking-widest block mb-1 text-slate-600">Note</span>
          Only the built-in lanes (Todo, Available, In Progress, Blocked, Testing, Done) are driven by the orchestrator. Custom lanes are for organizing — a task moved into one is parked until you move it back to a built-in lane.
        </p>
      </div>
    </div>
  );
}
