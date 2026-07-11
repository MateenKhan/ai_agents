import React, { useState, useEffect } from 'react';
import { Save, FileText, Link, ChevronDown, AlertCircle, ClipboardList, PenLine, Sparkles } from 'lucide-react';
import type { Task } from '../types';
import { COLUMNS } from '../types';
import { useProjects } from '../projectContext';
import { Modal } from './Modal';
import { API_BASE } from '../../../apiBase';

export type TaskCreateMode = 'manual' | 'ai';

const AI_PHASES = [
  'Reading your request…',
  'Splitting it into concrete tasks…',
  'Writing GIVEN / WHEN / THEN scenarios…',
  'Sizing each task for an agent…',
  'Handing off to the orchestrator…',
];

interface AiCreated { id: string; title: string; status: string }

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Partial<Task>, projectId: string) => void;
  editingTask?: Task | null;
  /** Which creation tab opens first. Editing an existing task is always manual (no tabs). */
  initialMode?: TaskCreateMode;
  /** Fired after the AI tab creates tasks server-side, so the board can refresh. */
  onCreated?: () => void;
}

export function TaskModal({ isOpen, onClose, onSave, editingTask, initialMode = 'manual', onCreated }: TaskModalProps) {
  const { projects, activeId } = useProjects();
  // Creation is tabbed: Manual (the full form) | From AI (plain language → /intake splits it
  // into scenario-tasks). The AI path has no title/DoD/priority fields — the model writes those.
  const [mode, setMode] = useState<TaskCreateMode>(initialMode);
  const [aiMessage, setAiMessage] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCreated, setAiCreated] = useState<AiCreated[] | null>(null);
  const [aiPhase, setAiPhase] = useState(0);
  useEffect(() => {
    if (!aiBusy) { setAiPhase(0); return; }
    const iv = setInterval(() => setAiPhase(p => (p + 1) % AI_PHASES.length), 2200);
    return () => clearInterval(iv);
  }, [aiBusy]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dod, setDod] = useState('');
  const [status, setStatus] = useState<string>('TODO');
  const [priority, setPriority] = useState(2);
  const [dependsOn, setDependsOn] = useState<string>(''); // Comma separated IDs
  const [files, setFiles] = useState<string>(''); // Comma separated paths
  const [parentId, setParentId] = useState('');
  const [project, setProject] = useState(activeId);
  const [dodError, setDodError] = useState(false);

  useEffect(() => {
    if (editingTask) {
      setTitle(editingTask.title);
      setDescription(editingTask.description || '');
      setDod(editingTask.dod || '');
      setStatus(editingTask.status);
      setPriority(editingTask.priority);
      setDependsOn(editingTask.dependsOn?.join(', ') || '');
      setFiles(editingTask.files?.join(', ') || '');
      setParentId(editingTask.parentId || '');
    } else {
      setTitle('');
      setDescription('');
      setDod('');
      setStatus('TODO');
      setPriority(2);
      setDependsOn('');
      setFiles('');
      setParentId('');
    }
    // A new task defaults to the active project; editing stays in its current project.
    setProject(activeId);
    setDodError(false);
    // Reset the AI tab per open; editing always lands on the manual form.
    setMode(editingTask ? 'manual' : initialMode);
    setAiMessage('');
    setAiBusy(false);
    setAiError(null);
    setAiCreated(null);
  }, [editingTask, isOpen, activeId, initialMode]);

  const submitAi = async () => {
    if (!aiMessage.trim() || aiBusy) return;
    setAiBusy(true); setAiError(null); setAiCreated(null);
    try {
      const res = await fetch(`${API_BASE}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: aiMessage.trim(), autoStart: true, projectId: project }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Intake failed');
      setAiCreated(data.created || []);
      setAiMessage('');
      onCreated?.();
    } catch (e: any) {
      setAiError(e?.message || 'Failed to create tasks');
    } finally {
      setAiBusy(false);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!dod.trim()) {
      setDodError(true);
      document.querySelector<HTMLTextAreaElement>('[data-feature-id="task-modal-dod"]')?.focus();
      return;
    }
    onSave({
      title,
      description,
      dod: dod.trim(),
      status,
      priority,
      dependsOn: dependsOn.split(',').map(s => s.trim()).filter(Boolean),
      files: files.split(',').map(s => s.trim()).filter(Boolean),
      parentId: parentId || undefined,
    }, project);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingTask ? 'Edit Task' : 'Create New Task'}
      icon={<ClipboardList size={20} className="text-accent-600" />}
      maxW="sm:max-w-2xl"
      featureId="task-modal"
      footer={
        <div className="flex justify-end gap-3 w-full">
          <button
            onClick={onClose}
            className="px-5 min-h-control-lg text-sm font-semibold text-slate-600 rounded-xl active:bg-slate-200 sm:hover:text-slate-900 sm:hover:bg-slate-100 transition-colors"
          >
            {mode === 'ai' && aiCreated ? 'Close' : 'Cancel'}
          </button>
          {mode === 'ai' ? (
            <button
              onClick={submitAi}
              disabled={aiBusy || !aiMessage.trim()}
              className="flex items-center gap-2 px-6 min-h-control-lg bg-slate-900 active:bg-slate-950 sm:hover:bg-slate-800 text-white text-sm font-bold rounded-xl shadow-lg shadow-accent-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {aiBusy && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
              {aiBusy ? 'Breaking it down…' : <><Sparkles size={16} /> Create tasks</>}
            </button>
          ) : (
            <button
              onClick={() => handleSubmit()}
              className="flex items-center gap-2 px-6 min-h-control-lg bg-slate-900 active:bg-slate-950 sm:hover:bg-slate-800 text-white text-sm font-bold rounded-xl shadow-lg shadow-accent-500/20 transition-all active:scale-95"
            >
              <Save size={16} />
              {editingTask ? 'Update task' : 'Create task'}
            </button>
          )}
        </div>
      }
    >
      {/* Creation is tabbed; editing an existing task keeps the plain manual form. */}
      {!editingTask && (
        <div role="tablist" aria-label="How to create tasks" className="flex items-center gap-1 mb-5 p-1 rounded-xl bg-slate-100 border border-slate-200">
          {([
            { id: 'manual' as const, label: 'Manual', icon: PenLine },
            { id: 'ai' as const, label: 'From AI', icon: Sparkles },
          ]).map(t => {
            const active = mode === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-feature-id={`task-modal-tab-${t.id}`}
                onClick={() => setMode(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                  active ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 sm:hover:text-slate-800'
                }`}
              >
                <Icon size={13} className={active ? 'text-accent-600' : ''} /> {t.label}
              </button>
            );
          })}
        </div>
      )}

      {mode === 'ai' && !editingTask ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="eyebrow">Describe the work</label>
            <textarea
              autoFocus
              value={aiMessage}
              onChange={e => setAiMessage(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitAi(); }}
              rows={6}
              disabled={aiBusy}
              data-feature-id="task-modal-ai-message"
              placeholder="e.g. add a keyboard shortcut to toggle the grid, and fix the export button on mobile"
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-3 text-sm text-slate-900 focus:outline-none focus:border-accent-500 transition-colors resize-none disabled:bg-slate-100"
            />
            <p className="text-micro text-slate-500">
              Plain language is fine — it's split into independent tasks with GIVEN/WHEN/THEN scenarios
              and a Definition of Done, and the agents start immediately. No other fields needed.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="eyebrow">Project</label>
            <div className="relative">
              <select
                value={project}
                onChange={e => setProject(e.target.value)}
                disabled={aiBusy}
                className="w-full appearance-none bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-3 text-sm text-slate-900 focus:outline-none focus:border-accent-500 transition-colors disabled:opacity-60"
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-2.5 text-slate-500 pointer-events-none" size={14} />
            </div>
          </div>

          {aiError && (
            <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{aiError}</div>
          )}

          {aiCreated && (
            <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 space-y-1">
              <div className="font-bold text-emerald-700">Created {aiCreated.length} task{aiCreated.length !== 1 ? 's' : ''} — agents starting:</div>
              {aiCreated.map(c => <div key={c.id} className="text-emerald-800">• {c.title}</div>)}
            </div>
          )}

          {aiBusy && (
            <div className="flex items-center gap-2 justify-center text-[12px] text-accent-600 bg-accent-50 border border-accent-100 rounded-lg px-3 py-2">
              <span className="w-3 h-3 border-2 border-accent-400 border-t-transparent rounded-full animate-spin" />
              <span>{AI_PHASES[aiPhase]}</span>
            </div>
          )}
        </div>
      ) : (
      <form
        onSubmit={handleSubmit}
        // Cmd/Ctrl+Enter submits from anywhere in the form — the multi-line DoD/description
        // textareas swallow a bare Enter, so power users need a keyboard commit that works
        // from inside them.
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit(e); }}
        className="space-y-6"
      >
        {/* Basic Info */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="eyebrow">Title</label>
              <span className="text-micro text-slate-400 tabular-nums">{title.length}</span>
            </div>
            <input
              autoFocus
              required
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-3 text-sm text-slate-900 focus:outline-none focus:border-accent-500 transition-colors"
              placeholder="e.g. Add a dark-mode toggle to Settings"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="eyebrow">Description</label>
              <span className="text-micro text-slate-400 tabular-nums">{description.length}</span>
            </div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-3 text-sm text-slate-900 focus:outline-none focus:border-accent-500 transition-colors resize-none"
              placeholder={"Context the agent needs but the title can't hold — the why, links, edge cases.\ne.g. Users can't tell which board is active when two are open. Highlight the active tab in the board switcher; leave inactive ones as-is."}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-micro font-semibold uppercase text-amber-700 tracking-tight">
              Definition of Done — required *
            </label>
            <textarea
              required
              value={dod}
              onChange={e => { setDod(e.target.value); if (dodError) setDodError(false); }}
              rows={7}
              data-feature-id="task-modal-dod"
              aria-invalid={dodError}
              className={`w-full rounded-lg px-3.5 py-3 text-sm text-slate-900 focus:outline-none transition-colors resize-none placeholder:text-slate-400 ${
                dodError
                  ? 'bg-rose-50 border border-rose-400 focus:border-rose-500 ring-1 ring-rose-300'
                  : 'bg-amber-50/50 border border-amber-300 focus:border-amber-500'
              }`}
              placeholder={"One verifiable criterion per line — written so a HUMAN can verify without opening other docs. Include the exact command and expected result, e.g.\n- `pnpm test` passes with 0 failures\n- Drawing a marquee inside an L-shape's hole selects nothing\n- No console errors on page load"}
            />
            {dodError ? (
              <p className="flex items-center gap-1.5 text-2xs font-semibold text-rose-600">
                <AlertCircle size={12} /> Definition of Done is mandatory — every task must have one.
              </p>
            ) : (
              <p className="text-micro text-slate-500">Agents must satisfy every item; you'll verify these at review. Tasks without a DoD are never dispatched. Avoid spec references like "AC1"/"Step 4" — spell them out.</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="eyebrow">Project</label>
          <div className="relative">
            <select
              value={project}
              onChange={e => setProject(e.target.value)}
              disabled={!!editingTask}
              data-feature-id="task-modal-project"
              className="w-full appearance-none bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-3 text-sm text-slate-900 focus:outline-none focus:border-accent-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-2.5 text-slate-500 pointer-events-none" size={14} />
          </div>
          {editingTask && <p className="text-micro text-slate-500">A task can't be moved between projects here.</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="eyebrow">Status</label>
            <div className="relative">
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full appearance-none bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-3 text-sm text-slate-900 focus:outline-none focus:border-accent-500 transition-colors"
              >
                {COLUMNS.map(col => (
                  <option key={col.id} value={col.id}>{col.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-2.5 text-slate-500 pointer-events-none" size={14} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="eyebrow">Priority</label>
            <div className="relative">
              <select
                value={priority}
                onChange={e => setPriority(parseInt(e.target.value))}
                className="w-full appearance-none bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-3 text-sm text-slate-900 focus:outline-none focus:border-accent-500 transition-colors"
              >
                <option value={0}>P0 - Critical</option>
                <option value={1}>P1 - High</option>
                <option value={2}>P2 - Normal</option>
                <option value={3}>P3 - Low</option>
              </select>
              <ChevronDown className="absolute right-3 top-2.5 text-slate-500 pointer-events-none" size={14} />
            </div>
          </div>
        </div>

        {/* Advanced Metadata */}
        <div className="pt-4 border-t border-slate-200 space-y-4">
          <h3 className="text-micro font-bold uppercase text-accent-600 tracking-widest">Advanced</h3>

          <div className="space-y-1.5">
            <label className="eyebrow flex items-center gap-2">
              <Link size={10} /> Depends On
            </label>
            <input
              type="text"
              value={dependsOn}
              onChange={e => setDependsOn(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-3 text-xs text-slate-900 focus:outline-none focus:border-accent-500 transition-colors font-mono"
              placeholder="TASK-ID-1, TASK-ID-2"
            />
          </div>

          <div className="space-y-1.5">
            <label className="eyebrow flex items-center gap-2">
              <FileText size={10} /> Associated Files
            </label>
            <input
              type="text"
              value={files}
              onChange={e => setFiles(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-3 text-xs text-slate-900 focus:outline-none focus:border-accent-500 transition-colors font-mono"
              placeholder="src/main.ts, db/schema.sql"
            />
          </div>

          <div className="space-y-1.5">
            <label className="eyebrow">Parent Task ID</label>
            <input
              type="text"
              value={parentId}
              onChange={e => setParentId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-3 text-xs text-slate-900 focus:outline-none focus:border-accent-500 transition-colors font-mono"
              placeholder="Leave empty if root task"
            />
          </div>
        </div>
        {/* Hidden submit keeps Enter-to-save working inside the form */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
      )}
    </Modal>
  );
}
