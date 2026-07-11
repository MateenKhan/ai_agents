import React, { useState } from 'react';
import { Tooltip } from './Tooltip';
import { Plus, Trash2, ArrowUp, ArrowDown, EyeOff, Check } from 'lucide-react';
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
  // Which lane's colour palette is open (only one at a time).
  const [openColor, setOpenColor] = useState<string | null>(null);

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
    <div className="space-y-3">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="eyebrow">Swimlanes ({columns.length})</h3>
          <button
            onClick={addCustom}
            data-feature-id="board-editor-add-column"
            className="flex items-center gap-1.5 px-3 py-1.5 text-2xs font-bold uppercase tracking-wide bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <Plus size={14} /> Add Lane
          </button>
        </div>

        <div className="space-y-1.5">
          {columns.map((lane, i) => (
            <div key={lane.id} className="flex items-center gap-2 p-2 rounded-lg border bg-slate-50 border-slate-200">
              <div className="flex flex-col shrink-0">
                <Tooltip label="Move up"><button onClick={() => move(lane.id, -1)} disabled={i === 0} className="text-slate-500 hover:text-slate-800 disabled:text-slate-300 disabled:hover:text-slate-300 disabled:cursor-not-allowed transition-colors"><ArrowUp size={13} /></button></Tooltip>
                <Tooltip label="Move down"><button onClick={() => move(lane.id, 1)} disabled={i === columns.length - 1} className="text-slate-500 hover:text-slate-800 disabled:text-slate-300 disabled:hover:text-slate-300 disabled:cursor-not-allowed transition-colors"><ArrowDown size={13} /></button></Tooltip>
              </div>

              {/* Swatch palette instead of the OS-ugly native picker. The trigger shows the
                  current colour; the popover offers the shared SWATCHES plus a native input
                  as a custom-colour escape hatch. */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setOpenColor(openColor === lane.id ? null : lane.id)}
                  aria-label="Lane color"
                  className="w-7 h-7 rounded-md border border-slate-300 cursor-pointer shrink-0 hover:ring-2 hover:ring-slate-300 transition-shadow"
                  style={{ backgroundColor: lane.color }}
                />
                {openColor === lane.id && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpenColor(null)} />
                    <div className="absolute z-20 top-9 left-0 w-40 p-2 bg-white border border-slate-200 rounded-lg shadow-xl shadow-slate-500/20">
                      <div className="flex flex-wrap gap-1">
                        {SWATCHES.map(sw => (
                          <button
                            key={sw}
                            type="button"
                            onClick={() => { patch(lane.id, { color: sw }); setOpenColor(null); }}
                            aria-label={`Set color ${sw}`}
                            className="w-6 h-6 rounded-md border border-slate-200 flex items-center justify-center hover:scale-110 transition-transform"
                            style={{ backgroundColor: sw }}
                          >
                            {lane.color.toLowerCase() === sw && <Check size={13} className="text-white drop-shadow" />}
                          </button>
                        ))}
                      </div>
                      <label className="mt-2 flex items-center justify-between gap-2 text-micro font-semibold text-slate-500">
                        Custom
                        <input
                          type="color"
                          value={lane.color}
                          onChange={e => patch(lane.id, { color: e.target.value })}
                          className="w-7 h-6 rounded border border-slate-300 bg-white cursor-pointer p-0.5"
                          aria-label="Custom lane color"
                        />
                      </label>
                    </div>
                  </>
                )}
              </div>

              <input
                type="text"
                value={lane.label}
                onChange={e => patch(lane.id, { label: e.target.value })}
                className="flex-1 min-w-0 bg-white border border-slate-300 rounded-md px-2.5 py-1 text-xs font-bold text-slate-800 focus:outline-none focus:border-accent-400"
              />

              {/* Fixed-width status column so every input lines up (a short label like DONE no
                  longer lets its row's input grow wider than the others). */}
              <span className="hidden sm:block w-16 shrink-0 text-right text-[9px] font-bold text-slate-500 uppercase tracking-tighter truncate">
                {lane.builtin ? lane.id : 'custom'}
              </span>

              {/* Built-in lanes are re-addable (below), so removing one only HIDES it — an EyeOff,
                  not a destructive trash. Custom lanes are a real delete. Matches the danger tiers. */}
              {lane.builtin ? (
                <Tooltip label="Hide from board — re-add below anytime"><button
                  onClick={() => remove(lane.id)}
                  aria-label="Hide lane"
                  className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-colors shrink-0"
                ><EyeOff size={15} /></button></Tooltip>
              ) : (
                <Tooltip label="Delete lane"><button
                  onClick={() => remove(lane.id)}
                  aria-label="Delete lane"
                  className="p-1.5 rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors shrink-0"
                ><Trash2 size={15} /></button></Tooltip>
              )}
            </div>
          ))}
          {columns.length === 0 && (
            <p className="text-2xs text-amber-700 font-medium p-3 bg-amber-50 border border-amber-200 rounded-lg">Add at least one lane.</p>
          )}
        </div>
      </section>

      {missingBuiltins.length > 0 && (
        <section>
          <h3 className="eyebrow mb-2.5">Re-add built-in lanes</h3>
          <div className="flex flex-wrap gap-2">
            {missingBuiltins.map(b => (
              <button
                key={b.id}
                onClick={() => addBuiltin(b)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-2xs font-bold bg-white border border-slate-300 rounded-lg hover:border-accent-400 hover:bg-slate-50 transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                {b.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
        <p className="text-micro text-slate-500 leading-relaxed">
          <span className="eyebrow block mb-1">Note</span>
          Only the built-in lanes (Todo, Available, In Progress, Blocked, Testing, Done) are driven by the orchestrator. Custom lanes are for organizing — a task moved into one is parked until you move it back to a built-in lane.
        </p>
      </div>
    </div>
  );
}
