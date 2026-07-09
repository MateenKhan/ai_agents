import React, { useState } from 'react';
import { Plus, Pencil, Trash2, FolderGit2, Columns, ChevronDown, ChevronRight, RotateCcw, GitBranch, FolderSync } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useProjects, type Project } from '../projectContext';
import { API_BASE, DEFAULT_PROJECT, withProject } from '../../../apiBase';
import type { Column } from '../types';
import { loadColumns, saveColumns, DEFAULT_COLUMNS } from '../boardConfig';
import { BoardColumnsEditor } from './BoardColumnsEditor';
import { Modal } from './Modal';
import { useToast } from './Toast';

const inputCls = 'w-full min-h-[44px] rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300';
const btnPrimary = 'min-h-[44px] px-5 text-sm font-bold text-white bg-indigo-600 rounded-xl active:bg-indigo-700 sm:hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-600/20 disabled:opacity-50 flex items-center justify-center gap-2';
const btnGhost = 'min-h-[44px] px-4 text-sm font-bold text-slate-700 bg-white border border-slate-300 rounded-xl active:bg-slate-100 sm:hover:bg-slate-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-2';

type Msg = { kind: 'ok' | 'err'; text: string } | null;

// Derive a project name from a repo path or clone URL: last segment, sans `.git`.
// e.g. "C:\code\my-app" → "my-app"; "git@github.com:acme/web.git" → "web".
function repoNameOf(repo: string): string {
  const s = repo.trim().replace(/[\\/]+$/, '');
  if (!s) return '';
  const seg = s.split(/[\\/:]+/).filter(Boolean).pop() || '';
  return seg.replace(/\.git$/i, '');
}

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const { projects, createProject, updateProject, setActiveId, refreshProjects } = useProjects();
  const [repoPath, setRepoPath] = useState('');
  const [emoji, setEmoji] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  // The repository IS the project: its name drives the tab label AND the local folder,
  // so they can never drift. No separate name field.
  const name = repoNameOf(repoPath);
  const isUrl = /^(https?:\/\/|git@|ssh:\/\/)/i.test(repoPath.trim());
  // First import: only the seeded Default project exists — reuse (rename) that slot to the
  // repo instead of leaving an empty "Default" tab beside the new one.
  const onlyDefault = projects.length === 1 && projects[0]?.id === DEFAULT_PROJECT;

  const submit = async () => {
    if (!name) { setMsg({ kind: 'err', text: 'Enter a git repo path or URL.' }); return; }
    setBusy(true); setMsg(null);
    try {
      if (isUrl) {
        // Server clones into a folder named after the repo, then creates/renames the project.
        setMsg({ kind: 'ok', text: `Cloning ${name}…` });
        const r = await fetch(`${API_BASE}/git/clone-import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: repoPath.trim(), emoji: emoji.trim() || undefined }) }).then(r => r.json());
        if (r.error) throw new Error(r.error);
        await refreshProjects();
        if (r.project?.id) setActiveId(r.project.id);
        onClose();
        return;
      }
      // Local path — point at it directly (no clone).
      if (onlyDefault) {
        await updateProject(DEFAULT_PROJECT, { name, repoPath: repoPath.trim(), emoji: emoji.trim() });
        setActiveId(DEFAULT_PROJECT);
      } else {
        const p = await createProject({ name, repoPath: repoPath.trim() || undefined, emoji: emoji.trim() || undefined });
        setActiveId(p.id);
      }
      onClose();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Failed to import project.' });
    } finally { setBusy(false); }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Import project"
      icon={<FolderGit2 className="w-5 h-5 text-indigo-600" />}
      maxW="sm:max-w-md"
      featureId="project-create"
      footer={
        <div className="flex justify-end gap-2 w-full">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={busy || !name} className={btnPrimary}><Plus size={15} /> {onlyDefault ? 'Import' : 'Add project'}</button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Git repo path or URL</label>
          <input value={repoPath} onChange={e => setRepoPath(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} autoFocus placeholder="C:\code\my-repo  ·  git@github.com:acme/web.git" className={`${inputCls} font-mono text-xs sm:text-sm`} />
          {name && (
            <p className="text-[11px] text-slate-500 mt-1.5">
              {isUrl ? 'Clones into folder ' : 'Project & folder: '}<span className="font-bold text-indigo-600">{name}</span>
              {onlyDefault && <span className="text-slate-400"> · renames the Default tab</span>}
            </p>
          )}
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Emoji (optional)</label>
          <input value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🚀" maxLength={4} className={`${inputCls} sm:max-w-[100px]`} />
        </div>
        {msg && <div className={`text-xs rounded-lg px-3 py-2 border ${msg.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{msg.text}</div>}
      </div>
    </Modal>
  );
}

function EditProjectModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { updateProject, deleteProject, setActiveId, refreshProjects } = useProjects();
  const toast = useToast();
  const [name, setName] = useState(project.name);
  const [repoPath, setRepoPath] = useState(project.repoPath || '');
  const [emoji, setEmoji] = useState(project.emoji || '');
  // '' = inherit the global default; else a number cap (0 = unlimited).
  const [maxConc, setMaxConc] = useState<string>(project.maxConcurrency == null ? '' : String(project.maxConcurrency));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const isDefault = project.id === DEFAULT_PROJECT;

  // Git repository = the project's identity. Top accordion, open by default.
  const [gitOpen, setGitOpen] = useState(true);
  // Board lanes for this project — same editor as the Board tab, persisted live per project.
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [boardCols, setBoardCols] = useState<Column[]>(() => loadColumns(project.id));
  const updateBoardCols = (cols: Column[]) => { setBoardCols(cols); saveColumns(project.id, cols); };

  const save = async () => {
    if (!name.trim()) { setMsg({ kind: 'err', text: 'Enter a project name.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await updateProject(project.id, {
        name: name.trim(),
        repoPath: repoPath.trim(),
        emoji: emoji.trim(),
        maxConcurrency: maxConc.trim() === '' ? null : Math.max(0, Math.floor(Number(maxConc) || 0)),
      });
      onClose();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Failed to update project.' });
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setMsg(null);
    try {
      if (project.repoPath) {
        // Complete delete: folder (only if inside the managed projects/ dir) + tasks + embeddings
        // + project record. A repo living elsewhere on disk keeps its folder (folderKept).
        const d = await fetch(withProject(`${API_BASE}/git/delete-repo`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir: project.repoPath }) }).then(r => r.json());
        if (d.error) throw new Error(d.error);
        await refreshProjects();
        if (d.folderKept) toast.info('Project deleted', 'Tasks & embeddings removed. Repo folder is outside the managed projects directory — left on disk.');
        else toast.success('Repo deleted', 'Folder, tasks & embeddings removed.');
      } else {
        await deleteProject(project.id); // no repo — purge tasks/embeddings/record
        toast.success('Project deleted');
      }
      setActiveId(DEFAULT_PROJECT);
      onClose();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Failed to delete project.' });
    } finally { setBusy(false); }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Edit project"
      icon={<Pencil className="w-4 h-4 text-indigo-600" />}
      maxW="sm:max-w-md"
      featureId="project-edit"
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          {!isDefault ? (
            confirmDelete ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] font-semibold text-rose-600 leading-snug">
                  Permanently deletes {project.repoPath ? <>the repo folder <span className="font-mono text-[10px]">({project.repoPath.split(/[\\/]/).pop()})</span>, </> : ''}all its tasks, and the code index (embeddings). Cannot be undone.
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={remove} disabled={busy} className="min-h-[44px] px-4 text-sm font-bold text-white bg-rose-600 rounded-xl active:bg-rose-700 sm:hover:bg-rose-500 flex items-center gap-2"><Trash2 size={15} /> Delete everything</button>
                  <button onClick={() => setConfirmDelete(false)} className="text-xs font-bold text-slate-500 hover:text-slate-800">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="min-h-[44px] px-4 text-sm font-bold text-rose-600 border border-rose-200 bg-rose-50 rounded-xl hover:bg-rose-100 flex items-center gap-2"><Trash2 size={15} /> Delete</button>
            )
          ) : <span className="text-[11px] text-slate-400">Default project can't be deleted.</span>}
          <div className="flex gap-2">
            <button onClick={onClose} className={btnGhost}>Cancel</button>
            <button onClick={save} disabled={busy} className={btnPrimary}>Save</button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="My project" className={inputCls} />
        </div>
          {/* Git repository accordion — TOP: every git repo is one project. Its repo path
              is what the Context tab and agents work against. */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setGitOpen(o => !o)}
              data-feature-id="project-edit-git-toggle"
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-600">
                <FolderGit2 className="w-4 h-4 text-indigo-600" /> Git repository
                <span className="text-slate-400 font-bold normal-case tracking-normal truncate max-w-[120px]">· {repoPath ? repoPath.split(/[\\/]/).pop() : 'not set'}</span>
              </span>
              {gitOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
            </button>
            {gitOpen && (
              <div className="p-3 border-t border-slate-200 space-y-1.5">
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500">Local repo path</label>
                <input value={repoPath} onChange={e => setRepoPath(e.target.value)} placeholder="C:\code\my-repo" disabled={isDefault} className={`${inputCls} font-mono text-xs sm:text-sm disabled:opacity-50`} />
                <p className="text-[10px] text-slate-400">{isDefault ? 'The Default project is AI-Agents itself — it has no user repo.' : 'This git repo is the project. Its files + context show in the Context tab; agents work inside it.'}</p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Emoji (optional)</label>
            <input value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🚀" maxLength={4} className={`${inputCls} sm:max-w-[100px]`} />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Max concurrent agents</label>
            <input
              value={maxConc}
              onChange={e => setMaxConc(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              placeholder="Inherit default"
              className={`${inputCls} sm:max-w-[160px]`}
            />
            <p className="text-[10px] text-slate-400 mt-1">How many agents may run at once for this project. Blank = use the global default (Settings); 0 = unlimited (capped only by CPU/RAM).</p>
          </div>

          {/* Boards accordion — same swimlane editor as the Board tab, scoped to this project. */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setBoardsOpen(o => !o)}
              data-feature-id="project-edit-boards-toggle"
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-600">
                <Columns className="w-4 h-4 text-indigo-600" /> Boards
                <span className="text-slate-400 font-bold normal-case tracking-normal">· {boardCols.length} lanes</span>
              </span>
              {boardsOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
            </button>
            {boardsOpen && (
              <div className="p-3 border-t border-slate-200 space-y-3">
                <BoardColumnsEditor columns={boardCols} onChange={updateBoardCols} />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => updateBoardCols(DEFAULT_COLUMNS)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-900 transition-all"
                    title="Reset to default lanes"
                  >
                    <RotateCcw size={13} /> Reset lanes
                  </button>
                </div>
                <p className="text-[10px] text-slate-400">Board changes save automatically for this project.</p>
              </div>
            )}
          </div>

          {msg && <div className={`text-xs rounded-lg px-3 py-2 border ${msg.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{msg.text}</div>}
      </div>
    </Modal>
  );
}

export function ProjectBar({ onOpenGit }: { onOpenGit?: () => void }) {
  const { projects, activeId, setActiveId, updateProject } = useProjects();

  // Rename a tab to match its repo folder — fixes drift when the label and folder differ.
  const syncName = async (p: Project) => {
    const folder = repoNameOf(p.repoPath || '');
    if (folder && folder !== p.name) { try { await updateProject(p.id, { name: folder }); } catch { /* surfaced elsewhere */ } }
  };
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  // Collapsed by default — the project switcher is an accordion.
  const [open, setOpen] = useState(false);
  // Long-press support (mobile) — hold a tab ~500ms to open its edit modal.
  const pressTimer = React.useRef<any>(null);

  const startPress = (p: Project) => {
    pressTimer.current = setTimeout(() => setEditing(p), 500);
  };
  const cancelPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

  const activeProject = projects.find(p => p.id === activeId);

  return (
    <div className="bg-white border-b border-slate-200">
      <div className="px-2 sm:px-3 py-2">
        <div className="flex items-center gap-3">
          {/* Brand — first item on the page, same row as the Projects/active-project toggle. */}
          <div className="shrink-0 flex flex-col justify-center pr-3 border-r border-slate-200">
            <div className="flex items-center gap-1.5">
              <h1 className="text-[10px] sm:text-xs font-black text-slate-900 tracking-[0.1em] sm:tracking-[0.2em] uppercase whitespace-nowrap">ai-agents</h1>
              <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981] shrink-0" />
            </div>
            <p className="text-[9px] sm:text-[10px] text-slate-500 font-bold uppercase tracking-wider whitespace-nowrap">Task Orchestrator</p>
          </div>
          {/* Accordion header — minimized by default; shows the active project. */}
          <button
            onClick={() => setOpen(o => !o)}
            data-feature-id="projects-accordion-toggle"
            className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg sm:hover:bg-slate-50 transition-colors"
          >
          <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-600 min-w-0">
            <FolderGit2 className="w-4 h-4 text-indigo-600 shrink-0" /> Projects
            <span className="flex items-center gap-1 text-slate-400 font-bold normal-case tracking-normal truncate">
              · <span>{activeProject?.emoji || '📁'}</span> {activeProject?.name ?? 'Default'}
            </span>
          </span>
          {open ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
          </button>

          {/* Git — top-right. A project IS a git repo, so its Git panel lives on the project bar. */}
          {onOpenGit && (
            <button
              onClick={onOpenGit}
              data-feature-id="tasks-open-git"
              title="Git — repos, branches & tokens"
              className="shrink-0 flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg text-slate-500 sm:hover:bg-slate-100 sm:hover:text-slate-900 transition-colors"
            >
              <GitBranch size={17} />
            </button>
          )}
        </div>

        {open && (
          <div className="mt-2 flex items-center gap-2 overflow-x-auto custom-scrollbar" data-feature-id="project-bar">
            {/* Bordered tab strip — same visual language as the Board/Analytics tabs. */}
            <div className="relative inline-flex items-stretch rounded-xl border border-slate-300 bg-white shadow-sm">
              {projects.map((p, i) => {
                const active = p.id === activeId;
                const isFirst = i === 0;
                const isLast = i === projects.length - 1;
                return (
                  <button
                    key={p.id}
                    onClick={() => setActiveId(p.id)}
                    onTouchStart={() => startPress(p)}
                    onTouchEnd={cancelPress}
                    onTouchMove={cancelPress}
                    title={p.name}
                    data-feature-id={`project-tab-${p.id}`}
                    className={`relative flex items-center gap-1.5 px-4 min-h-[42px] text-sm font-bold whitespace-nowrap transition-colors ${isFirst ? 'rounded-l-xl' : 'border-l border-slate-200'} ${isLast ? 'rounded-r-xl' : ''} ${active
                      ? 'text-indigo-700 bg-gradient-to-b from-white to-indigo-50/70'
                      : 'text-slate-500 sm:hover:text-slate-900 sm:hover:bg-slate-50'}`}
                  >
                    <span className="text-base leading-none">{p.emoji || '📁'}</span>
                    <span className="max-w-[160px] truncate">{p.name}</span>
                    {(() => {
                      // Skip the pristine Default (its repo is the host itself, not a user project).
                      if (p.id === DEFAULT_PROJECT && p.name === 'Default') return null;
                      const folder = repoNameOf(p.repoPath || '');
                      return folder && folder !== p.name ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); syncName(p); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); syncName(p); } }}
                          aria-label={`Sync name to folder "${folder}"`}
                          title={`Name differs from repo folder — sync to "${folder}"`}
                          data-feature-id={`project-sync-${p.id}`}
                          className="flex items-center justify-center -mr-0.5 ml-0.5 p-0.5 rounded text-amber-500 sm:hover:text-amber-700 sm:hover:bg-amber-100 transition-colors cursor-pointer"
                        >
                          <FolderSync size={13} />
                        </span>
                      ) : null;
                    })()}
                    {active && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setEditing(p); } }}
                        aria-label={`Edit ${p.name}`}
                        title="Edit project"
                        className="flex items-center justify-center -mr-1.5 ml-0.5 p-0.5 rounded text-indigo-400 sm:hover:text-indigo-700 sm:hover:bg-indigo-100 transition-colors cursor-pointer"
                      >
                        <Pencil size={13} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setCreateOpen(true)}
              aria-label="New project"
              title="New project"
              data-feature-id="project-add"
              className="shrink-0 min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl text-slate-500 bg-slate-50 border border-slate-300 border-dashed active:bg-slate-100 sm:hover:bg-white sm:hover:text-indigo-600 transition-colors"
            >
              <Plus size={18} strokeWidth={3} />
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {createOpen && <CreateProjectModal onClose={() => setCreateOpen(false)} />}
        {editing && <EditProjectModal project={editing} onClose={() => setEditing(null)} />}
      </AnimatePresence>
    </div>
  );
}

export default ProjectBar;
