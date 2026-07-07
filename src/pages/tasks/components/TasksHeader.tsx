import React, { useEffect, useState } from 'react';
import { RefreshCw, Settings, Plus, ClipboardCheck, GitBranch, Play, Pause } from 'lucide-react';
import { motion } from 'framer-motion';
import { API_BASE, withProject } from '../../../apiBase';

// Compact global orchestrator pill + pause/start toggle.
// Reads orchestrator state from /system-status (light 4s poll) and posts to /orchestrator/{pause,start}.
function OrchestratorToggle() {
  const [orch, setOrch] = useState<{ agentStatus?: string; up?: boolean } | null>(null);
  const [reachable, setReachable] = useState(true);
  const [busy, setBusy] = useState(false);

  const poll = React.useCallback(async () => {
    try {
      const r = await fetch(withProject(`${API_BASE}/system-status`));
      const d = await r.json();
      setOrch(d.orchestrator ?? null);
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const iv = setInterval(poll, 4000);
    return () => clearInterval(iv);
  }, [poll]);

  const up = reachable && (orch?.up ?? false);
  const paused = (orch?.agentStatus ?? '').toUpperCase() === 'PAUSED';
  const down = !up;

  const state = down
    ? { dot: 'bg-rose-500', text: 'text-rose-700', bg: 'bg-rose-50 border-rose-300', label: 'Orchestrator down' }
    : paused
      ? { dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50 border-amber-300', label: 'Paused' }
      : { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-300', label: 'Running' };

  // When running → pause; otherwise (paused/down) → start.
  const willPause = up && !paused;

  const toggle = async () => {
    setBusy(true);
    try {
      await fetch(withProject(`${API_BASE}/orchestrator/${willPause ? 'pause' : 'start'}`), { method: 'POST' });
      await poll();
    } catch { /* offline — next poll reflects reality */ } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`flex items-center gap-1.5 pl-2 pr-1 min-h-[44px] rounded-lg border ${state.bg}`}
      title={`Orchestrator: ${state.label}`}
      data-feature-id="orchestrator-toggle"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${state.dot} ${up && !paused ? 'animate-pulse' : ''}`} />
      <span className={`hidden sm:inline text-[11px] font-black uppercase tracking-wide ${state.text}`}>{state.label}</span>
      <button
        onClick={toggle}
        disabled={busy}
        aria-label={willPause ? 'Pause orchestrator' : 'Start orchestrator'}
        title={willPause ? 'Pause orchestrator' : 'Start orchestrator'}
        className={`flex items-center justify-center min-w-[36px] min-h-[36px] rounded-md transition-colors ${state.text} active:bg-white/70 sm:hover:bg-white/70 ${busy ? 'opacity-60 animate-pulse' : ''}`}
      >
        {willPause ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
      </button>
    </div>
  );
}

interface TasksHeaderProps {
  onRefresh: () => void;
  onOpenSettings: () => void;
  onAddTask: () => void;
  onOpenTodos: () => void;
  onOpenGit?: () => void;
  todoCount: number;
  isRefreshing: boolean;
}

export function TasksHeader({ onRefresh, onOpenSettings, onAddTask, onOpenTodos, onOpenGit, todoCount, isRefreshing }: TasksHeaderProps) {
  return (
    <div className="flex flex-col gap-2 p-3 sm:p-5 bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-2 shrink-0">
          <OrchestratorToggle />

          <button
            onClick={onOpenTodos}
            data-feature-id="tasks-open-todos"
            className={`relative flex items-center gap-2 px-3 min-h-[44px] rounded-lg text-xs font-black transition-all active:scale-95 ${todoCount > 0
              ? 'bg-amber-50 text-amber-700 border border-amber-300 hover:bg-amber-100'
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
            title="Human Review — merged tasks awaiting your approval"
          >
            <ClipboardCheck size={16} />
            <span className="hidden lg:inline">Human Review</span>
            {todoCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 flex items-center justify-center text-[10px] font-black bg-amber-500 text-white rounded-full">
                {todoCount}
              </span>
            )}
          </button>

          {onOpenGit && (
            <button
              onClick={onOpenGit}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition-all"
              title="Git"
            >
              <GitBranch size={16} />
            </button>
          )}

          <button
            onClick={onRefresh}
            className={`p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition-all ${isRefreshing ? 'animate-spin text-indigo-600' : ''}`}
            title="Refresh Board"
          >
            <RefreshCw size={16} />
          </button>

          <button
            onClick={onOpenSettings}
            data-feature-id="tasks-open-settings"
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition-all"
            title="Settings"
          >
            <Settings size={16} />
          </button>

          <button
            onClick={onAddTask}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-black shadow-lg shadow-indigo-600/20 transition-all hover:scale-105 active:scale-95"
            title="New Task"
          >
            <Plus size={16} strokeWidth={3} />
            <span className="hidden lg:inline">New Task</span>
          </button>
        </div>
      </div>
    </div>
  );
}
