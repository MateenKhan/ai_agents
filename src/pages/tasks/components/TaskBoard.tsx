import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { Task, Column, TaskControlAction } from '../types';
import { COLUMNS } from '../types';
import { TaskCard } from './TaskCard';
import { btnGhostCaps, btnDanger, btnPrimarySm } from '../ui';
import { useConfirm } from './ConfirmProvider';
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
        className="flex items-center justify-center h-14 rounded-xl border-2 border-dashed text-micro font-bold uppercase tracking-widest"
        style={{ borderColor: color, backgroundColor: withAlpha(color, '1a'), color }}
      >
        Drop here
      </div>
    </motion.div>
  );
}

export function TaskBoard({ tasks, onEdit, onDelete, onTrigger, onControl, onAddTask, onMove, onBulkDelete, onView, onOpenLogs, triggeringIds, controllingIds, columns }: TaskBoardProps) {
  const lanes = columns ?? COLUMNS;
  // Whole board empty = no visible lane holds a single card. Drives the ONE centered
  // empty state (with a real "New task" CTA) instead of an identical hint in every lane.
  const boardEmpty = !lanes.some(col => tasks.some(t => t.status === col.id));
  const confirm = useConfirm();
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

  const handleBulkDelete = async () => {
    const n = selected.size;
    // Bulk delete is irreversible and used to fire on a single click. A count-aware confirm
    // is the friction the danger tier promises; the button carries the colour, this carries
    // the stop. Not type-to-confirm — that gate is for deleting a whole project/repo, and
    // demanding typing to clear a few selected tasks would train users to ignore the dialog.
    const ok = await confirm({
      title: `Delete ${n} ${n === 1 ? 'task' : 'tasks'}?`,
      message: `${n === 1 ? 'This task' : `These ${n} tasks`} will be permanently deleted. This cannot be undone.`,
      confirmLabel: `Delete ${n}`,
      tone: 'danger',
    });
    if (!ok) return;
    onBulkDelete([...selected]);
    clearSelection();
  };

  return (
    <div className="relative flex gap-3 sm:gap-4 p-3 sm:p-4 h-full overflow-x-auto overflow-y-hidden custom-scrollbar items-stretch snap-x snap-mandatory sm:snap-none [-webkit-overflow-scrolling:touch]">
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
            className={`flex flex-col h-full min-h-0 min-w-[86vw] max-w-[86vw] sm:min-w-[300px] sm:max-w-[320px] snap-center sm:snap-align-none rounded-2xl overflow-hidden shadow-sm transition-all duration-200 border-2 ${
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
                <label className="flex items-center justify-center -m-1.5 p-1.5 min-w-control-lg min-h-control-lg cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    data-feature-id="tasks-lane-select-all"
                    checked={allInLaneSelected}
                    ref={el => { if (el) el.indeterminate = someInLaneSelected && !allInLaneSelected; }}
                    onChange={() => toggleLane(colTasks)}
                    disabled={colTasks.length === 0}
                    className="w-5 h-5 accent-accent-600 disabled:opacity-20"
                    aria-label={allInLaneSelected ? 'Deselect all in lane' : 'Select all in lane'}
                  />
                </label>
                <div className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: col.color }}></div>
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-900 truncate">
                  {col.label}
                </h2>
                <span className="text-2xs font-semibold px-2 py-0.5 bg-slate-100 rounded-full text-slate-600 shrink-0">
                  {colTasks.length}
                </span>
              </div>
              <button
                onClick={() => onAddTask(col.id)}
                data-feature-id="tasks-lane-add"
                className="flex items-center justify-center min-w-control-lg min-h-control-lg -m-1.5 active:bg-slate-200 sm:hover:bg-slate-100 rounded-md text-slate-500 sm:hover:text-slate-900 transition-all shrink-0"
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
              className="flex-1 min-h-0 flex flex-col gap-3 p-3 overflow-y-auto custom-scrollbar [-webkit-overflow-scrolling:touch]"
            >
              {colTasks.length === 0 && !isDropTarget ? (
                boardEmpty ? (
                  // The whole board is empty — the single centered CTA below owns the
                  // "new task" affordance, so each lane is just a calm, open drop zone.
                  <div className="flex-1" aria-hidden />
                ) : (
                  <div className="flex-1 flex items-center justify-center p-6 text-micro font-semibold uppercase tracking-widest text-slate-400 text-center select-none">
                    Drop here
                  </div>
                )
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

      {/* Empty board — ONE centered CTA over the calm, open lanes (not a hint per lane).
          pointer-events-none lets lane headers/+ stay clickable; only the button catches clicks. */}
      {boardEmpty && (
        <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
          <div className="pointer-events-auto flex flex-col items-center gap-2.5 text-center max-w-xs">
            <p className="eyebrow text-slate-400">No tasks yet</p>
            <p className="text-2xs text-slate-500">Create your first task, or drop one into a lane to get started.</p>
            <button
              onClick={() => onAddTask(lanes[0]?.id ?? COLUMNS[0].id)}
              data-feature-id="tasks-empty-new"
              className={`${btnPrimarySm} mt-1`}
            >
              <Plus size={16} /> New task
            </button>
          </div>
        </div>
      )}

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
              className={`${btnDanger} uppercase tracking-wide text-xs`}
            >
              <Trash2 size={14} /> Delete
            </button>
            <button
              data-feature-id="tasks-bulk-clear"
              onClick={clearSelection}
              className={btnGhostCaps}
            >
              <X size={14} /> Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
