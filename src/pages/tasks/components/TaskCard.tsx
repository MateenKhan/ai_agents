import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, RotateCcw, Edit2, Trash2, Link, FileText, User, ArrowRightLeft, Loader2, Clock, AlertCircle } from 'lucide-react';
import type { Task, Column, TaskControlAction } from '../types';
import { COLUMNS } from '../types';

interface TaskCardProps {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
  onControl?: (id: string, action: TaskControlAction) => void;
  onMove: (taskId: string, newStatus: string) => void;
  onView: (task: Task) => void;
  isTriggering: boolean;
  isControlling?: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onOpenLogs?: (agent?: string) => void;
  isDragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Lanes offered in the move menu. Defaults to the built-in columns. */
  columns?: Column[];
}

export function TaskCard({ task, onEdit, onDelete, onTrigger, onControl, onMove, onView, isTriggering, isControlling, selected, onToggleSelect, onOpenLogs, isDragging, onDragStart, onDragEnd, columns }: TaskCardProps) {
  const moveOptions = columns ?? COLUMNS;
  const pBadge = (p: number) => {
    switch (p) {
      case 0: return { label: 'P0', class: 'bg-rose-50 text-rose-600 border-rose-300' };
      case 1: return { label: 'P1', class: 'bg-amber-50 text-amber-700 border-amber-300' };
      case 2: return { label: 'P2', class: 'bg-accent-50 text-accent-600 border-accent-300' };
      default: return { label: 'P3', class: 'bg-slate-50 text-slate-600 border-slate-300' };
    }
  };

  const pb = pBadge(task.priority);
  const isAvailable = task.status === 'AVAILABLE';
  const isWorking = task.status === 'WORKING';
  const isPaused = task.control === 'paused';
  const isStopping = task.control === 'stop';
  const isFailed = task.status === 'BLOCKED';
  const agentAlive = task.status === 'WORKING' && !!task.claimedBy && !!task.leaseExpiresAt && new Date(task.leaseExpiresAt).getTime() > Date.now();

  // Live 1s tick only while an agent is actively working — drives the ETC countdown.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!agentAlive || !task.etcSetAt || !task.etcMinutes) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [agentAlive, task.etcSetAt, task.etcMinutes]);

  const STAGE_LABEL: Record<string, string> = { plan: 'Planning', build: 'Building', qa: 'Testing', merge: 'Merging', merged: 'Merged' };
  const stageLabel = STAGE_LABEL[task.stage || ''] || 'Working';

  const etc = (() => {
    if (!task.etcSetAt || !task.etcMinutes) return null;
    const dueMs = new Date(task.etcSetAt).getTime() + Math.min(30, task.etcMinutes) * 60000;
    const remainMs = dueMs - nowMs;
    const abs = Math.abs(remainMs);
    const mm = Math.floor(abs / 60000);
    const ss = Math.floor((abs % 60000) / 1000);
    return { text: `${mm}:${String(ss).padStart(2, '0')}`, overdue: remainMs <= 0 };
  })();

  return (
    <div
      draggable="true"
      onDragStart={(e) => {
        e.dataTransfer.setData('taskId', task.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      data-feature-id="task-card"
      onClick={() => onView(task)}
      // While dragging, THIS element is the card left behind in the lane — the browser
      // paints its own drag image for the one following the cursor. So it must recede,
      // not lift: a tilt/scale/ring here reads as "lifted" on the one thing that isn't.
      // Fading it (plus the lane's own drop indicator) already says "this is moving".
      className={`group relative bg-white border rounded-xl p-4 shadow-sm cursor-pointer transition-[transform,box-shadow,opacity,border-color] duration-200 sm:hover:shadow-md sm:hover:-translate-y-0.5 active:bg-slate-50 ${
        isDragging
          ? 'cursor-grabbing opacity-40 border-dashed border-slate-300 shadow-none sm:hover:shadow-none sm:hover:translate-y-0'
          : selected
            ? 'border-accent-500 ring-1 ring-accent-400/60'
            : 'border-slate-300 sm:hover:border-accent-400'
      }`}>
      <div className="space-y-3">
        {/* Title row — checkbox has a 44px hit area via padding */}
        <div className="flex items-start gap-1">
          <label
            className="flex items-center justify-center -m-2 p-2 min-w-[44px] min-h-control-lg cursor-pointer shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              data-feature-id="task-card-select"
              checked={selected}
              onChange={() => onToggleSelect(task.id)}
              draggable={false}
              onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className="w-5 h-5 accent-accent-600 rounded"
              title="Select task"
            />
          </label>
          <h3 className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2 pt-1.5">
            {task.title}
          </h3>
        </div>

        {task.description && (
          <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
            {task.description}
          </p>
        )}

        {task.status === 'BLOCKED' && task.lastError && (
          <div className="flex items-start gap-1.5 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5" title={task.lastError}>
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">{task.lastError}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold text-slate-600 px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono uppercase">
            {task.id.slice(-6)}
          </span>

          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${pb.class}`}>
            {pb.label}
          </span>

          {isPaused && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 px-1.5 py-0.5 bg-amber-50 rounded border border-amber-300" title="Task paused by you">
              <Pause size={9} fill="currentColor" /> Paused
            </span>
          )}

          {isStopping && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-rose-700 px-1.5 py-0.5 bg-rose-50 rounded border border-rose-300 animate-pulse" title="Orchestrator is halting this task">
              <Square size={9} fill="currentColor" /> Stopping…
            </span>
          )}

          {task.dependsOn && task.dependsOn.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-accent-600 px-1.5 py-0.5 bg-accent-50 rounded border border-accent-200" title="Has dependencies">
              <Link size={9} /> {task.dependsOn.length}
            </span>
          )}

          {task.files && task.files.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 px-1.5 py-0.5 bg-emerald-50 rounded border border-emerald-200" title="Associated files">
              <FileText size={9} /> {task.files.length}
            </span>
          )}

          {task.claimedBy && (agentAlive ? (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenLogs?.(task.claimedBy || undefined); }}
              title="Agent working — click for live logs"
              className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 px-1.5 py-0.5 bg-emerald-50 rounded border border-emerald-300 hover:bg-emerald-100 transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {task.claimedBy}
            </button>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 px-1.5 py-0.5 bg-amber-50 rounded border border-amber-200">
              <User size={9} /> {task.claimedBy}
            </span>
          ))}

          {agentAlive && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenLogs?.(task.claimedBy || undefined); }}
              title={`${stageLabel} — click for live logs`}
              className="flex items-center gap-1 text-[10px] font-bold text-accent-700 px-1.5 py-0.5 bg-accent-50 rounded border border-accent-300 hover:bg-accent-100 transition-colors"
            >
              <Loader2 size={10} className="animate-spin" /> {stageLabel}
            </button>
          )}

          {agentAlive && etc && (
            <span
              title="Estimated time to complete — counts down; caps at 30 min"
              className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${etc.overdue ? 'text-rose-700 bg-rose-50 border-rose-300 animate-pulse' : 'text-ai-700 bg-ai-50 border-ai-300'}`}
            >
              <Clock size={9} /> {etc.overdue ? `+${etc.text}` : etc.text}
            </span>
          )}
        </div>

        {/* Action footer — always visible, 44px touch targets */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
          {isAvailable && (
            <button
              onClick={() => onTrigger(task.id)}
              disabled={isTriggering}
              data-feature-id="task-card-trigger"
              className={`flex items-center justify-center min-w-[44px] min-h-[40px] rounded-lg bg-cyan-50 text-cyan-700 border border-cyan-300 active:bg-cyan-600 active:text-white sm:hover:bg-cyan-600 sm:hover:text-white transition-all ${isTriggering ? 'animate-pulse' : ''}`}
              title="Launch Agent"
            >
              <Play size={15} fill="currentColor" />
            </button>
          )}

          {/* Lifecycle controls — pause/resume/stop/re-run, shown per state */}
          {onControl && isFailed && !isPaused && (
            <button
              onClick={() => onControl(task.id, 'start')}
              disabled={isControlling}
              data-feature-id="task-card-rerun"
              className={`flex items-center justify-center min-w-[44px] min-h-[40px] rounded-lg bg-accent-50 text-accent-700 border border-accent-300 active:bg-slate-900 active:text-white sm:hover:bg-slate-900 sm:hover:text-white transition-colors ${isControlling ? 'animate-pulse opacity-70' : ''}`}
              title="Re-run — re-queue this task"
            >
              <RotateCcw size={15} />
            </button>
          )}
          {onControl && isPaused && (
            <button
              onClick={() => onControl(task.id, 'resume')}
              disabled={isControlling}
              data-feature-id="task-card-resume"
              className={`flex items-center justify-center min-w-[44px] min-h-[40px] rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-300 active:bg-emerald-600 active:text-white sm:hover:bg-emerald-600 sm:hover:text-white transition-colors ${isControlling ? 'animate-pulse opacity-70' : ''}`}
              title="Resume task"
            >
              <Play size={15} fill="currentColor" />
            </button>
          )}
          {onControl && isWorking && !isPaused && !isStopping && (
            <button
              onClick={() => onControl(task.id, 'pause')}
              disabled={isControlling}
              data-feature-id="task-card-pause"
              className={`flex items-center justify-center min-w-[44px] min-h-[40px] rounded-lg bg-amber-50 text-amber-700 border border-amber-300 active:bg-amber-600 active:text-white sm:hover:bg-amber-600 sm:hover:text-white transition-colors ${isControlling ? 'animate-pulse opacity-70' : ''}`}
              title="Pause task"
            >
              <Pause size={15} fill="currentColor" />
            </button>
          )}
          {onControl && isWorking && !isStopping && (
            <button
              onClick={() => onControl(task.id, 'stop')}
              disabled={isControlling}
              data-feature-id="task-card-stop"
              className={`flex items-center justify-center min-w-[44px] min-h-[40px] rounded-lg bg-rose-50 text-rose-600 border border-rose-300 active:bg-rose-600 active:text-white sm:hover:bg-rose-600 sm:hover:text-white transition-colors ${isControlling ? 'animate-pulse opacity-70' : ''}`}
              title="Stop — kill the running agent"
            >
              <Square size={15} fill="currentColor" />
            </button>
          )}

          <button
            onClick={() => onEdit(task)}
            data-feature-id="task-card-edit"
            className="flex items-center justify-center min-w-[44px] min-h-[40px] rounded-lg bg-slate-50 text-slate-600 border border-slate-300 active:bg-slate-200 sm:hover:bg-slate-100 sm:hover:text-slate-900 transition-colors"
            title="Edit"
          >
            <Edit2 size={15} />
          </button>
          <button
            onClick={() => onDelete(task.id)}
            data-feature-id="task-card-delete"
            className="flex items-center justify-center min-w-[44px] min-h-[40px] rounded-lg bg-rose-50 text-rose-600 border border-rose-300 active:bg-rose-600 active:text-white sm:hover:bg-rose-600 sm:hover:text-white transition-colors"
            title="Delete"
          >
            <Trash2 size={15} />
          </button>

          {/* Move-to-lane — native select = native iOS picker */}
          <div className="relative flex-1 min-w-0">
            <select
              value={task.status}
              onChange={(e) => onMove(task.id, e.target.value)}
              data-feature-id="task-card-move"
              title="Move to lane"
              className="w-full min-h-[40px] appearance-none pl-8 pr-2 text-[11px] font-bold uppercase tracking-wide bg-slate-50 text-slate-700 border border-slate-300 rounded-lg active:bg-slate-100 sm:hover:bg-slate-100 transition-colors cursor-pointer"
            >
              {/* Keep the current status selectable even if its lane is hidden/removed. */}
              {!moveOptions.some(c => c.id === task.status) && (
                <option value={task.status} className="bg-white text-slate-900">{task.status}</option>
              )}
              {moveOptions.map(c => (
                <option key={c.id} value={c.id} className="bg-white text-slate-900">{c.label}</option>
              ))}
            </select>
            <ArrowRightLeft size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
        </div>
      </div>
    </div>
  );
}
