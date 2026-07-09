import React, { useEffect, useState } from 'react';
import {
  X, Edit2, Trash2, Play, Pause, Square, GitBranch, Link as LinkIcon, FileText,
  User, RotateCcw, AlertCircle, CheckCircle2, ChevronDown
} from 'lucide-react';
import { API_BASE } from '../../../apiBase';
import type { Task, TaskControlAction } from '../types';
import { COLUMNS } from '../types';
import { SlideOver } from './SlideOver';

interface TaskDetailProps {
  task: Task;
  onClose: () => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
  onControl?: (id: string, action: TaskControlAction) => void;
  isControlling?: boolean;
  onOpenLogs?: (agent?: string) => void;
}

interface LogRow { id: number; message: string; type: string; timestamp: string }

const typeColor: Record<string, string> = {
  error: 'text-rose-600',
  warning: 'text-amber-700',
  success: 'text-emerald-700',
  info: 'text-slate-600',
};

export default function TaskDetail({ task, onClose, onEdit, onDelete, onTrigger, onControl, isControlling, onOpenLogs }: TaskDetailProps) {
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const col = COLUMNS.find(c => c.id === task.status);
  const rawScenarios = (task as any).scenarios;
  const scenarios: Array<{ given?: string; when?: string; then: string }> = Array.isArray(rawScenarios)
    ? rawScenarios
    : (typeof rawScenarios === 'string' ? (() => { try { return JSON.parse(rawScenarios); } catch { return []; } })() : []);

  const [showPlan, setShowPlan] = useState(false);
  const [showDesc, setShowDesc] = useState(false);
  const isWorking = task.status === 'WORKING';
  const isPaused = task.control === 'paused';
  const isStopping = task.control === 'stop';
  const isFailed = task.status === 'BLOCKED';
  const STAGES = [
    { key: 'plan', label: 'Plan', who: 'Architect' },
    { key: 'build', label: 'Build', who: 'Dev' },
    { key: 'qa', label: 'QA', who: 'QA' },
    { key: 'merge', label: 'Merge', who: 'Architect' },
    { key: 'review', label: 'Review', who: 'You' },
    { key: 'done', label: 'Done', who: '' },
  ];
  const stageIdx = task.status === 'DONE' ? 5 : task.status === 'TESTING' ? 4
    : (({ plan: 0, build: 1, qa: 2, merge: 3, merged: 4 } as Record<string, number>)[(task as any).stage] ?? 0);

  useEffect(() => {
    fetch(`${API_BASE}/task-logs/${encodeURIComponent(task.id)}`)
      .then(r => r.json())
      .then(d => setLogs(d.logs ?? []))
      .catch(() => setLogs([]));
  }, [task.id]);

  const Meta = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{label}</p>
      {children}
    </div>
  );

  return (
    <SlideOver
      onClose={onClose}
      featureId="task-detail"
      z="z-[95]"
      enterFrom={480}
      width="w-full sm:w-[480px]"
      panelClassName="border-l border-slate-200"
    >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3.5 border-b border-slate-200 bg-slate-50 pt-[max(0.875rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: col?.color ?? '#64748b' }}>
                {col?.label ?? task.status}
              </span>
              <span className="text-[10px] font-bold text-slate-600 px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono">{task.id}</span>
              {isPaused && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 px-1.5 py-0.5 bg-amber-50 rounded-full border border-amber-300">
                  <Pause size={9} fill="currentColor" /> Paused
                </span>
              )}
              {isStopping && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-rose-700 px-1.5 py-0.5 bg-rose-50 rounded-full border border-rose-300 animate-pulse">
                  <Square size={9} fill="currentColor" /> Stopping…
                </span>
              )}
            </div>
            <h2 className="text-base font-bold text-slate-900 leading-snug mt-2">{task.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center min-w-[44px] min-h-control-lg -m-2 text-slate-500 active:bg-slate-200 sm:hover:text-slate-900 rounded-lg transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar [-webkit-overflow-scrolling:touch] p-4 space-y-5">
          {/* Pipeline — where this task stands */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Pipeline</p>
            <div className="flex items-center">
              {STAGES.map((s, i) => (
                <React.Fragment key={s.key}>
                  <button
                    onClick={() => onOpenLogs?.(task.claimedBy || undefined)}
                    title="Open this agent's logs"
                    className="flex flex-col items-center gap-1 shrink-0 group focus:outline-none"
                  >
                    <div className={`relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-transform group-hover:scale-110 ${i < stageIdx ? 'bg-emerald-500 text-white' : i === stageIdx ? 'bg-accent-600 text-white ring-4 ring-accent-100' : 'bg-slate-200 text-slate-500'}`}>
                      {i === stageIdx && task.status === 'WORKING' && <span className="absolute -inset-1 rounded-full ring-2 ring-accent-400 animate-ping" />}
                      <span className="relative">{i < stageIdx ? <CheckCircle2 size={13} /> : i + 1}</span>
                    </div>
                    <span className={`text-[9px] font-semibold group-hover:underline ${i === stageIdx ? 'text-accent-700' : i < stageIdx ? 'text-emerald-600' : 'text-slate-500'}`}>{s.label}</span>
                  </button>
                  {i < STAGES.length - 1 && <div className={`flex-1 h-0.5 mx-1 ${i < stageIdx ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
                </React.Fragment>
              ))}
            </div>
            <p className="text-xs text-slate-600 mt-2.5">
              {stageIdx >= 5 ? '✓ Done — merged and approved.'
                : stageIdx === 4 ? 'Waiting on you — review it in Your Review, then approve or reject.'
                  : `Now: ${STAGES[stageIdx].who} is on ${STAGES[stageIdx].label}. Next: ${STAGES[stageIdx + 1].who} · ${STAGES[stageIdx + 1].label}.`}
            </p>
          </div>

          {task.summary && (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <button onClick={() => setShowPlan(v => !v)} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 transition-colors">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600">Summary · what the agent did &amp; how to verify</span>
                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 shrink-0 ${showPlan ? 'rotate-180' : ''}`} />
              </button>
              {showPlan
                ? <div className="px-4 py-4 border-t border-slate-200 min-h-[120px] max-h-[45vh] overflow-y-auto custom-scrollbar text-[13px] text-slate-800 leading-relaxed whitespace-pre-wrap bg-accent-50/40">{task.summary}</div>
                : <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500 italic truncate">{task.summary.split('\n').find(Boolean)?.slice(0, 90)}…</div>}
            </div>
          )}

          {task.description && (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <button onClick={() => setShowDesc(v => !v)} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 transition-colors">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600">Description</span>
                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 shrink-0 ${showDesc ? 'rotate-180' : ''}`} />
              </button>
              {showDesc
                ? <div className="px-4 py-4 border-t border-slate-200 min-h-[120px] max-h-[45vh] overflow-y-auto custom-scrollbar text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{task.description}</div>
                : <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500 italic truncate">{task.description.split('\n').find(Boolean)?.slice(0, 90)}…</div>}
            </div>
          )}

          <Meta label="Acceptance scenarios">
            {scenarios.length > 0 ? (
              <ul className="space-y-2 bg-emerald-50/60 border border-emerald-200 rounded-lg p-3">
                {scenarios.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-800 leading-relaxed">
                    <CheckCircle2 size={13} className="mt-0.5 text-emerald-600/80 shrink-0" />
                    <div>
                      {s.given && <div><span className="font-bold text-emerald-700">GIVEN</span> {s.given}</div>}
                      {s.when && <div><span className="font-bold text-emerald-700">WHEN</span> {s.when}</div>}
                      <div><span className="font-bold text-emerald-700">THEN</span> {s.then}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-amber-600"><AlertCircle size={12} /> No acceptance scenarios yet — the architect will add them, or edit the task to add your own.</p>
            )}
          </Meta>

          {task.reviewNote && (
            <Meta label="Reviewer feedback">
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 leading-relaxed whitespace-pre-wrap">{task.reviewNote}</p>
            </Meta>
          )}

          {task.lastError && (
            <Meta label="Last error">
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 leading-relaxed">{task.lastError}</p>
            </Meta>
          )}

          {/* Facts grid */}
          <div className="grid grid-cols-2 gap-4">
            <Meta label="Priority"><p className="text-sm font-bold text-slate-900">P{task.priority}</p></Meta>
            <Meta label="Attempts"><p className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><RotateCcw size={13} className="text-slate-500" />{task.attempts || 0}</p></Meta>
            {task.claimedBy && <Meta label="Agent"><p className="text-sm font-mono text-amber-700 flex items-center gap-1.5"><User size={13} />{task.claimedBy}</p></Meta>}
            {task.model && <Meta label="Model"><p className="text-xs font-mono text-slate-700">{task.model}</p></Meta>}
            {task.started && <Meta label="Started"><p className="text-xs text-slate-700">{new Date(task.started).toLocaleString()}</p></Meta>}
            {task.completed && <Meta label="Completed"><p className="text-xs text-slate-700">{new Date(task.completed).toLocaleString()}</p></Meta>}
          </div>

          <Meta label="Branch">
            <p className="text-xs font-mono text-accent-700 flex items-center gap-1.5"><GitBranch size={13} />task/{task.id}</p>
          </Meta>

          {task.dependsOn && task.dependsOn.length > 0 && (
            <Meta label="Depends on">
              <div className="flex flex-wrap gap-1.5">
                {task.dependsOn.map(d => (
                  <span key={d} className="flex items-center gap-1 text-[11px] font-bold text-accent-700 px-2 py-1 bg-accent-50 rounded border border-accent-200"><LinkIcon size={10} />{d}</span>
                ))}
              </div>
            </Meta>
          )}

          {task.files && task.files.length > 0 && (
            <Meta label="Files in scope">
              <div className="space-y-1">
                {task.files.map(f => (
                  <p key={f} className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-700"><FileText size={11} />{f}</p>
                ))}
              </div>
            </Meta>
          )}

          {/* History */}
          <Meta label="History">
            {logs === null ? (
              <p className="text-xs text-slate-500">Loading…</p>
            ) : logs.length === 0 ? (
              <p className="text-xs text-slate-500">No log entries for this task yet.</p>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar">
                {logs.map(l => (
                  <p key={l.id} className={`text-[11px] leading-relaxed font-mono ${typeColor[l.type] ?? 'text-slate-600'}`}>
                    <span className="text-slate-500">{l.timestamp.slice(11, 19)}</span> {l.message}
                  </p>
                ))}
              </div>
            )}
          </Meta>
        </div>

        {/* Lifecycle controls — start/pause/resume/stop */}
        {onControl && (isWorking || isPaused || isFailed) && (
          <div className="flex gap-2 px-3 pt-3 bg-slate-50 border-t border-slate-200">
            {isPaused ? (
              <button
                onClick={() => onControl(task.id, 'resume')}
                disabled={isControlling}
                data-feature-id="task-detail-resume"
                className={`flex-1 flex items-center justify-center gap-1.5 min-h-[48px] text-xs font-bold uppercase tracking-wide bg-emerald-600 text-white rounded-xl active:bg-emerald-700 sm:hover:bg-emerald-500 transition-colors ${isControlling ? 'opacity-70 animate-pulse' : ''}`}
              >
                <Play size={14} fill="currentColor" /> Resume
              </button>
            ) : isWorking && !isStopping ? (
              <button
                onClick={() => onControl(task.id, 'pause')}
                disabled={isControlling}
                data-feature-id="task-detail-pause"
                className={`flex-1 flex items-center justify-center gap-1.5 min-h-[48px] text-xs font-bold uppercase tracking-wide bg-amber-500 text-white rounded-xl active:bg-amber-600 sm:hover:bg-amber-400 transition-colors ${isControlling ? 'opacity-70 animate-pulse' : ''}`}
              >
                <Pause size={14} fill="currentColor" /> Pause
              </button>
            ) : null}
            {isFailed && !isPaused && (
              <button
                onClick={() => onControl(task.id, 'start')}
                disabled={isControlling}
                data-feature-id="task-detail-rerun"
                className={`flex-1 flex items-center justify-center gap-1.5 min-h-[48px] text-xs font-bold uppercase tracking-wide bg-slate-900 text-white rounded-xl active:bg-slate-950 sm:hover:bg-slate-800 transition-colors ${isControlling ? 'opacity-70 animate-pulse' : ''}`}
              >
                <RotateCcw size={14} /> Re-run
              </button>
            )}
            {isWorking && !isStopping && (
              <button
                onClick={() => onControl(task.id, 'stop')}
                disabled={isControlling}
                data-feature-id="task-detail-stop"
                className={`flex items-center justify-center gap-1.5 min-w-[48px] min-h-[48px] px-3 text-xs font-bold uppercase tracking-wide text-rose-600 bg-rose-50 border border-rose-300 rounded-xl active:bg-rose-600 active:text-white sm:hover:bg-rose-600 sm:hover:text-white transition-colors ${isControlling ? 'opacity-70 animate-pulse' : ''}`}
                title="Stop — kill the running agent"
              >
                <Square size={14} fill="currentColor" />
              </button>
            )}
          </div>
        )}

        {/* Action footer */}
        <div className="flex gap-2 p-3 border-t border-slate-200 bg-slate-50 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {task.status === 'AVAILABLE' && (
            <button
              onClick={() => { onTrigger(task.id); onClose(); }}
              className="flex-1 flex items-center justify-center gap-1.5 min-h-[48px] text-xs font-bold uppercase tracking-wide bg-cyan-600 text-white rounded-xl active:bg-cyan-700 sm:hover:bg-cyan-500 transition-colors"
            >
              <Play size={14} fill="currentColor" /> Launch
            </button>
          )}
          <button
            onClick={() => { onEdit(task); onClose(); }}
            className="flex-1 flex items-center justify-center gap-1.5 min-h-[48px] text-xs font-bold uppercase tracking-wide bg-slate-900 text-white rounded-xl active:bg-slate-950 sm:hover:bg-slate-800 transition-colors"
          >
            <Edit2 size={14} /> Edit
          </button>
          <button
            onClick={() => { onDelete(task.id); onClose(); }}
            className="flex items-center justify-center min-w-[48px] min-h-[48px] text-rose-600 bg-rose-50 border border-rose-300 rounded-xl active:bg-rose-600 active:text-white sm:hover:bg-rose-600 sm:hover:text-white transition-colors"
            title="Delete"
          >
            <Trash2 size={15} />
          </button>
        </div>
    </SlideOver>
  );
}
