import React, { useState, useEffect } from 'react';
import { Save, FileText, Link, ChevronDown, AlertCircle, ClipboardList } from 'lucide-react';
import type { Task } from '../types';
import { COLUMNS } from '../types';
import { useProjects } from '../projectContext';
import { Modal } from './Modal';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Partial<Task>, projectId: string) => void;
  editingTask?: Task | null;
}

export function TaskModal({ isOpen, onClose, onSave, editingTask }: TaskModalProps) {
  const { projects, activeId } = useProjects();
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
  }, [editingTask, isOpen, activeId]);

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
            Cancel
          </button>
          <button
            onClick={() => handleSubmit()}
            className="flex items-center gap-2 px-6 min-h-control-lg bg-slate-900 active:bg-slate-950 sm:hover:bg-slate-800 text-white text-sm font-bold rounded-xl shadow-lg shadow-accent-500/20 transition-all active:scale-95"
          >
            <Save size={16} />
            {editingTask ? 'Update task' : 'Create task'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-2xs font-bold uppercase text-slate-600 tracking-wide">Title</label>
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
            <label className="text-2xs font-bold uppercase text-slate-600 tracking-wide">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-3 text-sm text-slate-900 focus:outline-none focus:border-accent-500 transition-colors resize-none"
              placeholder="Add more details..."
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-micro font-bold uppercase text-amber-700 tracking-tight">
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
          <label className="text-2xs font-bold uppercase text-slate-600 tracking-wide">Project</label>
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
            <label className="text-2xs font-bold uppercase text-slate-600 tracking-wide">Status</label>
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
            <label className="text-2xs font-bold uppercase text-slate-600 tracking-wide">Priority</label>
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
          <h3 className="text-micro font-black uppercase text-accent-600 tracking-widest">Advanced</h3>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-2xs font-bold uppercase text-slate-600 tracking-wide">
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
            <label className="flex items-center gap-2 text-2xs font-bold uppercase text-slate-600 tracking-wide">
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
            <label className="text-2xs font-bold uppercase text-slate-600 tracking-wide">Parent Task ID</label>
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
    </Modal>
  );
}
