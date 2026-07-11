import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, FileCode, Folder, FolderOpen, ChevronRight, Search, FilePlus, Trash2,
  Save, Pencil, X, Loader2, RotateCcw, Plus, GripVertical, FolderTree, Sparkles,
} from 'lucide-react';
import { API_BASE as API, withProject } from '../../../apiBase';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmProvider';
import { Tooltip } from './Tooltip';
import { btnSm, btnPrimarySm, iconBtn } from '../ui';
import { ChatStoreProvider, FileChat, useChatStore } from './FileChat';

/**
 * FileBrowser — the ONE reusable code-file component: browse a project's repo, view a file,
 * edit + save it, create/delete files, and change files by chatting with the model. Mounted in
 * both the Context tab and the Git modal.
 *
 * Two tabs: FILES (tree + viewer/editor + CRUD) and CHAT (the AI threads — <FileChat>). They
 * share one chat store (<ChatStoreProvider>) so dragging a file from the tree onto the Chat tab
 * tags it in the active thread. Read routes (`GET /files`, `GET /file`) exist; write + AI routes
 * (`PUT/POST/DELETE /file`, `POST /file/ai-edit`) are specced in docs/plans/file-browser-backend.md.
 */

interface TreeNode { name: string; path: string; dir: boolean; children: TreeNode[]; }
function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      let child = node.children.find(c => c.name === part && c.dir === !isFile);
      if (!child) { child = { name: part, path: parts.slice(0, i + 1).join('/'), dir: !isFile, children: [] }; node.children.push(child); }
      node = child;
    });
  }
  const sort = (n: TreeNode) => { n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1)); n.children.forEach(sort); };
  sort(root);
  return root.children;
}

interface OpenFile { path: string; content: string; bytes: number; tokens: number; truncated: boolean; }

export interface FileBrowserProps {
  activeId: string;
  className?: string;
  enableChat?: boolean;
  enableEdit?: boolean;
  enableCrud?: boolean;
  onAddToContext?: (path: string) => void;
  inContext?: Set<string>;
  compact?: boolean;
  /** Host-supplied controls, rendered right-aligned in the ONE chrome row (no extra toolbar). */
  toolbarExtra?: React.ReactNode;
  /** Host-supplied controls, rendered at the START of the chrome row (before the Files/Chat tabs). */
  toolbarLeading?: React.ReactNode;
  /** Called after the tree reloads, so a host can refresh its own data on the same Refresh click. */
  onRefresh?: () => void;
}

export function FileBrowser(props: FileBrowserProps) {
  return (
    <ChatStoreProvider activeId={props.activeId}>
      <FileBrowserInner {...props} />
    </ChatStoreProvider>
  );
}

function FileBrowserInner({
  activeId, className = '', enableChat = true, enableEdit = true, enableCrud = true,
  onAddToContext, inContext, compact = false, toolbarExtra, toolbarLeading, onRefresh,
}: FileBrowserProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const { tag } = useChatStore();

  const [pane, setPane] = useState<'files' | 'chat'>('files');
  const [chatDrop, setChatDrop] = useState(false);

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState<OpenFile | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState('');

  const dirty = open != null && editing && draft !== open.content;

  const loadTree = useCallback(async () => {
    setBusy(true);
    try {
      const d = await fetch(withProject(`${API}/files`)).then(r => r.json());
      setTree(buildTree(d.files ?? [])); setIsHost(!!d.isHost);
    } catch { setTree([]); setIsHost(false); }
    finally { setBusy(false); onRefresh?.(); }
  }, [activeId, onRefresh]);
  useEffect(() => { loadTree(); }, [loadTree]);

  const openFile = useCallback(async (path: string) => {
    if (dirty && !(await confirm({ title: 'Discard changes?', message: `You have unsaved edits to ${open?.path}. Open ${path} anyway?`, confirmLabel: 'Discard', tone: 'danger' }))) return;
    try {
      const d = await fetch(withProject(`${API}/file?path=${encodeURIComponent(path)}`)).then(r => r.json());
      if (d.error) throw new Error(d.error);
      setOpen(d); setDraft(d.content ?? ''); setEditing(false);
    } catch (e: any) { toast.error('Open failed', e?.message); }
  }, [dirty, open, confirm, toast]);

  const save = async () => {
    if (!open) return;
    setSaving(true);
    try {
      const r = await fetch(withProject(`${API}/file`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: open.path, content: draft }) }).then(r => r.json());
      if (r.error) throw new Error(r.error);
      setOpen({ ...open, content: draft, bytes: r.bytes ?? open.bytes });
      setEditing(false);
      toast.success('Saved', open.path);
    } catch (e: any) { toast.error('Save failed', e?.message); }
    finally { setSaving(false); }
  };

  const createFile = async () => {
    const path = newPath.trim();
    if (!path) return;
    try {
      const r = await fetch(withProject(`${API}/file`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content: '' }) }).then(r => r.json());
      if (r.error) throw new Error(r.error);
      toast.success('File created', path);
      setCreating(false); setNewPath('');
      await loadTree();
      setOpen({ path, content: '', bytes: 0, tokens: 0, truncated: false }); setDraft(''); setEditing(true);
    } catch (e: any) { toast.error('Create failed', e?.message); }
  };

  const deleteFile = async (path: string) => {
    if (!(await confirm({ title: 'Delete file?', message: `Permanently delete ${path} from the repo? This can't be undone here.`, confirmLabel: 'Delete', requireType: path.split('/').pop(), tone: 'danger' }))) return;
    try {
      const r = await fetch(withProject(`${API}/file?path=${encodeURIComponent(path)}`), { method: 'DELETE' }).then(r => r.json());
      if (r.error) throw new Error(r.error);
      toast.success('Deleted', path);
      if (open?.path === path) { setOpen(null); setEditing(false); }
      loadTree();
    } catch (e: any) { toast.error('Delete failed', e?.message); }
  };

  // A proposal applied in chat to the file we're viewing → reflect it live.
  const onApplied = useCallback((path: string, content: string) => {
    setOpen(o => (o && o.path === path ? { ...o, content } : o));
    setDraft(d => (open?.path === path ? content : d));
  }, [open]);

  const filteredTree = useMemo(() => {
    if (!q.trim()) return tree;
    const ql = q.toLowerCase();
    const filter = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap(n => {
      if (n.dir) { const ch = filter(n.children); return ch.length ? [{ ...n, children: ch }] : []; }
      return n.path.toLowerCase().includes(ql) ? [n] : [];
    });
    return filter(tree);
  }, [tree, q]);
  useEffect(() => { if (q.trim()) { const all = new Set<string>(); const walk = (ns: TreeNode[]) => ns.forEach(n => { if (n.dir) { all.add(n.path); walk(n.children); } }); walk(tree); setExpanded(all); } }, [q, tree]);

  const renderNode = (n: TreeNode, depth = 0): React.ReactNode => {
    if (n.dir) {
      const isOpen = expanded.has(n.path);
      return (
        <div key={n.path}>
          <button
            onClick={() => setExpanded(prev => { const s = new Set(prev); s.has(n.path) ? s.delete(n.path) : s.add(n.path); return s; })}
            className="flex items-center gap-1.5 w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-100 text-xs font-semibold text-slate-700"
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <ChevronRight size={12} className={`shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            {isOpen ? <FolderOpen size={13} className="text-amber-500 shrink-0" /> : <Folder size={13} className="text-amber-500 shrink-0" />}
            <span className="truncate">{n.name}</span>
          </button>
          {isOpen && n.children.map(c => renderNode(c, depth + 1))}
        </div>
      );
    }
    const active = open?.path === n.path;
    const added = inContext?.has(n.path);
    return (
      <div
        key={n.path}
        draggable={enableChat}
        onDragStart={e => { e.dataTransfer.setData('text/plain', n.path); e.dataTransfer.effectAllowed = 'copy'; }}
        className={`group flex items-center gap-1.5 px-2 py-1 rounded-md ${active ? 'bg-accent-50' : 'hover:bg-slate-100'}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {enableChat && <GripVertical size={11} className="text-slate-300 shrink-0 cursor-grab sm:opacity-0 sm:group-hover:opacity-100" />}
        <FileCode size={13} className={`shrink-0 ${active ? 'text-accent-600' : 'text-slate-400'}`} />
        <Tooltip label={n.path}><button onClick={() => openFile(n.path)} className={`flex-1 min-w-0 text-left text-xs truncate ${active ? 'text-accent-700 font-semibold' : 'text-slate-700 hover:text-accent-700'}`}>{n.name}</button></Tooltip>
        {onAddToContext && (
          <Tooltip label={added ? 'In context' : 'Add to context'}><button onClick={() => onAddToContext(n.path)} disabled={added} className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-md ${added ? 'text-emerald-500' : 'text-slate-500 hover:text-accent-600 sm:opacity-0 sm:group-hover:opacity-100'}`}><Plus size={13} /></button></Tooltip>
        )}
        {enableCrud && (
          <Tooltip label="Delete file"><button onClick={() => deleteFile(n.path)} className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100"><Trash2 size={12} /></button></Tooltip>
        )}
      </div>
    );
  };

  const paneH = compact ? 'h-[56vh]' : 'h-[calc(100dvh-260px)]';

  return (
    <div className={`flex flex-col ${className}`} data-feature-id="file-browser">
      {/* ONE chrome row: tabs + Files-pane actions together. No stacked toolbars.
          The Chat tab is a drop target — drag a file onto it to tag it. */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
      {toolbarLeading}
      <div role="tablist" aria-label="File browser view" className="inline-flex p-0.5 gap-0.5 rounded-lg bg-slate-100 border border-slate-200">
        <button role="tab" aria-selected={pane === 'files'} onClick={() => setPane('files')} className={`flex items-center gap-1.5 px-3 min-h-control text-xs font-bold rounded-md transition-colors ${pane === 'files' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
          <FolderTree size={14} className={pane === 'files' ? 'text-accent-600' : ''} /> Files
        </button>
        {enableChat && (
          <button
            role="tab" aria-selected={pane === 'chat'} data-feature-id="fb-tab-chat"
            onClick={() => setPane('chat')}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setChatDrop(true); }}
            onDragLeave={() => setChatDrop(false)}
            onDrop={e => { e.preventDefault(); setChatDrop(false); const p = e.dataTransfer.getData('text/plain'); if (p) { tag(p); setPane('chat'); } }}
            className={`flex items-center gap-1.5 px-3 min-h-control text-xs font-bold rounded-md transition-colors ${pane === 'chat' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'} ${chatDrop ? 'ring-2 ring-ai-400' : ''}`}
          >
            <Sparkles size={14} className={pane === 'chat' ? 'text-ai-600' : ''} /> Chat
          </button>
        )}
        </div>
        {/* Files-pane actions ride on the SAME row as the tabs. */}
        {pane === 'files' && (
          <>
            <button onClick={loadTree} className={btnSm} data-feature-id="fb-refresh"><RefreshCw size={13} className={busy ? 'animate-spin text-accent-600' : ''} /> Refresh</button>
            {enableCrud && <button onClick={() => { setCreating(c => !c); setNewPath(''); }} className={btnSm} data-feature-id="fb-new-file"><FilePlus size={13} /> New file</button>}
          </>
        )}
        {toolbarExtra && <div className="ml-auto flex items-center gap-2 flex-wrap justify-end min-w-0">{toolbarExtra}</div>}
      </div>

      {pane === 'chat' && enableChat ? (
        <div className={`border border-slate-200 rounded-xl bg-white ${paneH}`}>
          <FileChat activeId={activeId} className="h-full" onApplied={onApplied} />
        </div>
      ) : (
        <>
          {creating && (
            <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg border border-accent-200 bg-accent-50/50">
              <FilePlus size={13} className="text-accent-600 shrink-0" />
              <input autoFocus value={newPath} onChange={e => setNewPath(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createFile(); if (e.key === 'Escape') { setCreating(false); setNewPath(''); } }}
                placeholder="path/to/new-file.ts" className="flex-1 min-w-0 text-xs font-mono bg-transparent focus:outline-none text-slate-800 placeholder:text-slate-400" />
              <button onClick={createFile} className={btnPrimarySm}>Create</button>
              <button onClick={() => { setCreating(false); setNewPath(''); }} className="text-slate-400 hover:text-slate-700"><X size={15} /></button>
            </div>
          )}

          <div className={`grid gap-3 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] ${paneH}`}>
            {/* explorer */}
            <div className="border border-slate-200 rounded-xl bg-white flex flex-col min-h-0">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200">
                <Search size={13} className="text-slate-400" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find file…" className="flex-1 min-w-0 text-xs bg-transparent focus:outline-none text-slate-800 placeholder:text-slate-400" />
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
                {isHost ? (
                  <p className="p-4 text-center text-2xs text-slate-500 leading-relaxed">This is Piranha's own repo — open a project (top-left switcher) to browse its files.</p>
                ) : filteredTree.length ? filteredTree.map(n => renderNode(n)) : (
                  <p className="p-4 text-center text-2xs text-slate-500">No files found in this project's repo.</p>
                )}
              </div>
            </div>

            {/* viewer / editor */}
            <div className="border border-slate-200 rounded-xl bg-white flex flex-col min-h-0">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200">
                <FileCode size={13} className="text-slate-400 shrink-0" />
                <span className="flex-1 min-w-0 text-xs font-mono text-slate-600 truncate">{open?.path || 'Select a file'}</span>
                {open && dirty && <span className="text-micro font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">unsaved</span>}
                {open && enableEdit && !editing && !open.truncated && (
                  <button onClick={() => { setEditing(true); setDraft(open.content); }} className={btnSm} data-feature-id="fb-edit"><Pencil size={12} /> Edit</button>
                )}
                {open && enableEdit && editing && (
                  <>
                    <button onClick={() => { setEditing(false); setDraft(open.content); }} className={btnSm}><RotateCcw size={12} /> Cancel</button>
                    <button onClick={save} disabled={saving || !dirty} className={btnPrimarySm} data-feature-id="fb-save">{saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save</button>
                  </>
                )}
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar min-h-0">
                {!open ? (
                  <p className="p-6 text-center text-2xs text-slate-500">Tap a file on the left to view it{enableEdit ? ', then Edit to change it' : ''}.</p>
                ) : open.truncated ? (
                  <p className="p-4 text-2xs text-slate-500">File too large to open ({open.tokens.toLocaleString()} tokens).</p>
                ) : editing ? (
                  <textarea value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false} data-feature-id="fb-editor"
                    className="w-full h-full min-h-[280px] p-3 text-2xs leading-relaxed font-mono text-slate-800 bg-white resize-none focus:outline-none" />
                ) : (
                  <pre className="p-3 text-2xs leading-relaxed font-mono text-slate-700 whitespace-pre">{open.content}</pre>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default FileBrowser;
