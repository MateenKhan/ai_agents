import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { Task, Column, TaskControlAction } from '../types';
import { COLUMNS } from '../types';
import { TaskCard } from './TaskCard';
import { Plus, Trash2, X } from 'lucide-react';

interface DragState {
  id: string;
  fromStatus: string;
  overLane: string | null;
  /** Insertion index within the hovered lane's card list. */
  index: number | null;
}

interface TaskBoardProps {
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
  onControl?: (id: string, action: TaskControlAction) => void;
  onAddTask: (status: string) => void;
  onMove: (taskId: string, newStatus: string) => void;
  onBulkDelete: (ids: string[]) => void;
  onView: (task: Task) => void;
  onOpenLogs?: (agent?: string) => void;
  triggeringIds: Set<string>;
  controllingIds?: Set<string>;
  /** Configured lanes to render, in order. Defaults to all built-in columns when omitted. */
  columns?: Column[];
}

/** Append an 8-digit alpha to a 6-digit hex. Custom lanes may carry any CSS colour
 *  string, so anything that isn't `#rrggbb` passes through untouched. */
const withAlpha = (color: string, alpha: string): string =>
  /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color;

/** Animated "card lands here" slot shown in the hovered lane during a drag.
 *  Wears the LANE's colour, not the brand accent — the drop target should tell you
 *  which lane you're dropping into. */
function DropIndicator({ color }: { color: string }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0, scaleY: 0.6 }}
      animate={{ opacity: 1, height: 'auto', scaleY: 1 }}
      exit={{ opacity: 0, height: 0, scaleY: 0.6 }}
      transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.6 }}
      className="origin-top"
    >
      <div
        className="flex items-center justify-center h-14 rounded-xl border-2 border-dashed text-[10px] font-black uppercase tracking-widest"
        style={{ borderColor: color, backgroundColor: withAlpha(color, '1a'), color }}
      >
        Drop here
      </div>
    </motion.div>
  );
}

export function TaskBoard({ tasks, onEdit, onDelete, onTrigger, onControl, onAddTask, onMove, onBulkDelete, onView, onOpenLogs, triggeringIds, controllingIds, columns }: TaskBoardProps) {
  const lanes = columns ?? COLUMNS;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);

  // Compute insertion index from the cursor's Y position over a lane's card list.
  const indexFromPointer = (container: HTMLElement, clientY: number) => {
    const cards = [...container.querySelectorAll<HTMLElement>('[data-card-wrapper]')];
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return cards.length;
  };

  const handleLaneDragOver = (e: React.DragEvent<HTMLElement>, laneId: string, cardsEl: HTMLElement | null) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const index = cardsEl ? indexFromPointer(cardsEl, e.clientY) : 0;
    setDrag(prev => (prev && (prev.overLane !== laneId || prev.index !== index)
      ? { ...prev, overLane: laneId, index }
      : prev));
  };

  const endDrag = () => setDrag(null);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleLane = (laneTasks: Task[]) => {
    const allSelected = laneTasks.length > 0 && laneTasks.every(t => selected.has(t.id));
    setSelected(prev => {
      const next = new Set(prev);
      for (const t of laneTasks) allSelected ? next.delete(t.id) : next.add(t.id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const handleBulkDelete = () => {
    onBulkDelete([...selected]);
    clearSelection();
  };

  return (
    <div className="flex gap-3 sm:gap-4 p-3 sm:p-4 h-[calc(100dvh-170px)] overflow-x-auto overflow-y-hidden custom-scrollbar items-start snap-x snap-mandatory sm:snap-none [-webkit-overflow-scrolling:touch]">
      {lanes.map(col => {
        const colTasks = tasks.filter(t => t.status === col.id)
          .sort((a, b) => a.priority - b.priority);
        const allInLaneSelected = colTasks.length > 0 && colTasks.every(t => selected.has(t.id));
        const someInLaneSelected = colTasks.some(t => selected.has(t.id));

        const isDropTarget = drag?.overLane === col.id;

        return (
          <div
            key={col.id}
            data-feature-id={`tasks-lane-${col.id.toLowerCase()}`}
            className={`flex flex-col max-h-full min-w-[86vw] max-w-[86vw] sm:min-w-[300px] sm:max-w-[320px] snap-center sm:snap-align-none rounded-2xl overflow-hidden shadow-sm transition-all duration-200 border-2 ${
              isDropTarget ? 'shadow-lg' : 'bg-slate-50 sm:hover:border-[color:var(--lane)]'
            }`}
            // Each lane is identified by its OWN colour: a tinted border at rest, and the
            // full colour + ring when it's the active drop target. `--lane` also drives the
            // hover border, which a static class cannot express for a runtime colour.
            style={{
              ['--lane' as string]: col.color,
              borderColor: isDropTarget ? col.color : withAlpha(col.color, '59'),
              ...(isDropTarget && {
                backgroundColor: withAlpha(col.color, '14'),
                boxShadow: `0 0 0 3px ${withAlpha(col.color, '40')}`,
              }),
            }}
          >
            {/* Column Header */}
            <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 border-b-2 bg-white" style={{ borderBottomColor: withAlpha(col.color, '4d') }}>
              <div className="flex items-center gap-2 min-w-0">
                <label className="flex items-center justify-center -m-1.5 p-1.5 min-w-[40px] min-h-[40px] cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    data-feature-id="tasks-lane-select-all"
                    checked={allInLaneSelected}
                    ref={el => { if (el) el.indeterminate = someInLaneSelected && !allInLaneSelected; }}
                    onChange={() => toggleLane(colTasks)}
                    disabled={colTasks.length === 0}
                    className="w-5 h-5 accent-accent-600 disabled:opacity-20"
                    title={allInLaneSelected ? 'Deselect all in lane' : 'Select all in lane'}
                  />
                </label>
                <div className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: col.color }}></div>
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-900 truncate">
                  {col.label}
                </h2>
                <span className="text-[11px] font-black px-2 py-0.5 bg-slate-100 rounded-full text-slate-600 shrink-0">
                  {colTasks.length}
                </span>
              </div>
              <button
                onClick={() => onAddTask(col.id)}
                data-feature-id="tasks-lane-add"
                className="flex items-center justify-center min-w-[44px] min-h-control-lg -m-1.5 active:bg-slate-200 sm:hover:bg-slate-100 rounded-md text-slate-500 sm:hover:text-slate-900 transition-all shrink-0"
              >
                <Plus size={18} />
              </button>
            </div>

            {/* Cards Area */}
            <div
              onDragOver={(e) => handleLaneDragOver(e, col.id, e.currentTarget)}
              onDrop={(e) => {
                e.preventDefault();
                const taskId = e.dataTransfer.getData('taskId');
                if (taskId) onMove(taskId, col.id);
                endDrag();
              }}
              className="flex-1 flex flex-col gap-3 p-3 overflow-y-auto custom-scrollbar [-webkit-overflow-scrolling:touch]"
            >
              {colTasks.length === 0 && !isDropTarget ? (
                <div className="flex-1 flex items-center justify-center p-8 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-[11px] uppercase font-bold tracking-tight text-center">
                  Empty lane. Drop a task in, or hit + to feed one.
                </div>
              ) : (
                <>
                  {colTasks.map((task, i) => (
                    <React.Fragment key={task.id}>
                      {isDropTarget && drag?.index === i && <DropIndicator color={col.color} />}
                      <motion.div
                        layout
                        data-card-wrapper
                        transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.6 }}
                      >
                        <TaskCard
                          task={task}
                          onEdit={onEdit}
                          onDelete={onDelete}
                          onTrigger={onTrigger}
                          onControl={onControl}
                          onMove={onMove}
                          onView={onView}
                          onOpenLogs={onOpenLogs}
                          isTriggering={triggeringIds.has(task.id)}
                          isControlling={controllingIds?.has(task.id)}
                          selected={selected.has(task.id)}
                          onToggleSelect={toggleSelect}
                          isDragging={drag?.id === task.id}
                          onDragStart={() => setDrag({ id: task.id, fromStatus: col.id, overLane: col.id, index: i })}
                          onDragEnd={endDrag}
                          columns={lanes}
                        />
                      </motion.div>
                    </React.Fragment>
                  ))}
                  {isDropTarget && (drag?.index ?? colTasks.length) >= colTasks.length && <DropIndicator color={col.color} />}
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* Bulk Action Bar — floats above iOS home indicator */}
      {selected.size > 0 && (
        <div
          data-feature-id="tasks-bulk-action-bar"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 sm:gap-3 px-4 sm:px-5 py-2.5 w-[calc(100vw-1.5rem)] sm:w-auto justify-between sm:justify-start bg-white border border-accent-300 rounded-2xl shadow-2xl shadow-slate-400/40"
        >
          <span className="text-sm font-bold text-slate-900 whitespace-nowrap">{selected.size} selected</span>
          <div className="hidden sm:block w-px h-5 bg-slate-200" />
          <div className="flex items-center gap-2.5">
            <button
              data-feature-id="tasks-bulk-delete"
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-4 min-h-control-lg text-xs font-bold uppercase tracking-wide bg-rose-50 text-rose-600 border border-rose-300 rounded-xl active:bg-rose-600 active:text-white sm:hover:bg-rose-600 sm:hover:text-white transition-colors"
            >
              <Trash2 size={14} /> Delete
            </button>
            <button
              data-feature-id="tasks-bulk-clear"
              onClick={clearSelection}
              className="flex items-center gap-1.5 px-4 min-h-control-lg text-xs font-bold uppercase tracking-wide bg-white text-slate-700 border border-slate-300 rounded-xl active:bg-slate-100 sm:hover:bg-slate-50 transition-colors"
            >
              <X size={14} /> Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
