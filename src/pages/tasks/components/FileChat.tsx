import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, Send, Loader2, Check, X, FileCode, Plus, MessageSquareText, Settings2,
  Trash2, Paperclip, ChevronDown, Search, Upload, MessagesSquare, Pencil, ArrowDown,
} from 'lucide-react';
import { API_BASE as API, withProject } from '../../../apiBase';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmProvider';
import { DiffView } from './DiffView';
import { Tooltip } from './Tooltip';
import { iconBtn, btnSm, selectSm } from '../ui';

/**
 * FileChat — the AI "change my files by chatting" surface, factored out of FileBrowser so it
 * can live as a side pane (in the Files view) AND as its own full Chat tab, sharing ONE store.
 *
 * Design goals the UI must honour:
 *  - Each chat is its OWN thread with its OWN context — switching threads never bleeds. A
 *    thread carries its tagged repo files, its uploads, and a backend `sessionId` for model
 *    continuity (see docs/api-reference.md).
 *  - Tag a repo file by dragging it from the tree, by the file picker, OR upload an external
 *    file. Uploads are read-only reference; the model only proposes edits to repo files.
 *  - Long user messages collapse behind a "show more" accordion so the transcript stays scannable.
 *  - Opening/switching a thread scrolls to the latest message.
 *  - Nothing writes until you Approve a proposed diff.
 *
 * The store is a small context so the tree's drop-to-tag (in FileBrowser) and the chat pane
 * touch the same threads. Threads persist per-project in localStorage (minus transient diffs).
 */

// ── types ────────────────────────────────────────────────────────────────────
export interface Upload { name: string; content: string; size?: number; }
export interface Proposal { path: string; oldContent: string; newContent: string; diff: string; }
export interface ChatMetrics {
  responseMs: number; responseSec: number; ttftMs: number | null;
  outputTokens: number; inputTokens: number; tps: number; costUsd: number;
}
export interface ChatMsg { id: number; role: 'user' | 'assistant'; text: string; proposals?: Proposal[]; metrics?: ChatMetrics; }
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMsg[];
  tagged: string[];       // repo-relative paths
  uploads: Upload[];      // external files, reference-only
  sessionId?: string;     // backend continuity token for this thread
  settings: ChatSettings; // model + effort are PER-THREAD — each chat carries its own
  createdAt: number;
}
export interface ChatSettings { model: 'haiku' | 'sonnet' | 'opus'; effort: 'low' | 'medium' | 'high'; }

const DEFAULT_SETTINGS: ChatSettings = { model: 'sonnet', effort: 'medium' };
const SUGGESTIONS = ['Change the port to 4000', 'Add error handling', 'Write a test for this file', 'Add JSDoc comments'];
// ~6 rows of the text-2xs composer before it stops growing and scrolls (item 14).
const COMPOSER_MAX_H = 132;
// Human-readable file size for upload chips (item 17).
const fmtSize = (n?: number) => (n == null ? '' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 102400 ? 1 : 0)} KB`);

// ── store (context) ──────────────────────────────────────────────────────────
interface Store {
  sessions: ChatSession[];
  activeId: string;
  active: ChatSession;
  settings: ChatSettings;
  setSettings: (s: ChatSettings) => void;
  newSession: () => void;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  patchActive: (fn: (s: ChatSession) => ChatSession) => void;
  tag: (path: string) => void;
}
const ChatCtx = createContext<Store | null>(null);
export function useChatStore(): Store {
  const ctx = useContext(ChatCtx);
  if (!ctx) throw new Error('useChatStore must be used within <ChatStoreProvider>');
  return ctx;
}

const sessKey = (p: string) => `fb.chats:${p || 'default'}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const freshSession = (): ChatSession => ({ id: uid(), title: 'New chat', messages: [], tagged: [], uploads: [], settings: { ...DEFAULT_SETTINGS }, createdAt: Date.now() });
// Threads persisted before per-thread settings existed lack `settings` — backfill the default.
const normalize = (arr: ChatSession[]): ChatSession[] => arr.map(s => ({ ...s, settings: s.settings ?? { ...DEFAULT_SETTINGS } }));

// Persist light: keep the conversation + tags, drop transient proposal diffs and upload bodies
// (they can be huge and are re-fetched/re-tagged on demand). Model context lives server-side.
function slim(sessions: ChatSession[]): ChatSession[] {
  return sessions.map(s => ({
    ...s,
    messages: s.messages.map(m => ({ id: m.id, role: m.role, text: m.text, metrics: m.metrics })),
    uploads: s.uploads.map(u => ({ name: u.name, content: '', size: u.size })),
  }));
}

export function ChatStoreProvider({ activeId, children }: { activeId: string; children: React.ReactNode }) {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try { const raw = localStorage.getItem(sessKey(activeId)); const arr = raw ? JSON.parse(raw) as ChatSession[] : []; return normalize(arr.length ? arr : [freshSession()]); }
    catch { return [freshSession()]; }
  });
  const [curId, setCurId] = useState<string>(() => sessions[0]?.id ?? '');

  // Reload threads when the project changes.
  useEffect(() => {
    try { const raw = localStorage.getItem(sessKey(activeId)); const arr = raw ? JSON.parse(raw) as ChatSession[] : []; const next = normalize(arr.length ? arr : [freshSession()]); setSessions(next); setCurId(next[0].id); }
    catch { const f = freshSession(); setSessions([f]); setCurId(f.id); }
  }, [activeId]);

  useEffect(() => { try { localStorage.setItem(sessKey(activeId), JSON.stringify(slim(sessions))); } catch { /* quota */ } }, [sessions, activeId]);

  const active = useMemo(() => sessions.find(s => s.id === curId) ?? sessions[0], [sessions, curId]);

  const patchActive = useCallback((fn: (s: ChatSession) => ChatSession) => {
    setSessions(prev => prev.map(s => (s.id === curId ? fn(s) : s)));
  }, [curId]);

  const newSession = useCallback(() => { const f = freshSession(); setSessions(prev => [f, ...prev]); setCurId(f.id); }, []);
  const selectSession = useCallback((id: string) => setCurId(id), []);
  const deleteSession = useCallback((id: string) => {
    setSessions(prev => { const next = prev.filter(s => s.id !== id); if (!next.length) { const f = freshSession(); setCurId(f.id); return [f]; } if (id === curId) setCurId(next[0].id); return next; });
  }, [curId]);
  const renameSession = useCallback((id: string, title: string) => {
    const t = title.trim();
    setSessions(prev => prev.map(s => (s.id === id ? { ...s, title: t || 'New chat' } : s)));
  }, []);
  const tag = useCallback((path: string) => { setSessions(prev => prev.map(s => (s.id === curId ? { ...s, tagged: s.tagged.includes(path) ? s.tagged : [...s.tagged, path] } : s))); }, [curId]);

  // Settings are per-thread: they read off the active thread and write back to it.
  const settings = active?.settings ?? DEFAULT_SETTINGS;
  const setSettings = useCallback((s: ChatSettings) => patchActive(sess => ({ ...sess, settings: s })), [patchActive]);

  const store: Store = { sessions, activeId: curId, active, settings, setSettings, newSession, selectSession, deleteSession, renameSession, patchActive, tag };
  return <ChatCtx.Provider value={store}>{children}</ChatCtx.Provider>;
}

// ── long-message accordion ───────────────────────────────────────────────────
function UserBubble({ text }: { text: string }) {
  const long = text.length > 260 || text.split('\n').length > 6;
  const [openMsg, setOpenMsg] = useState(false);
  const shown = long && !openMsg ? text.slice(0, 240).replace(/\s+\S*$/, '') + '…' : text;
  return (
    <div className="max-w-[92%] rounded-lg px-2.5 py-1.5 bg-slate-900 text-white text-2xs leading-relaxed">
      <p className="whitespace-pre-wrap break-words">{shown}</p>
      {long && (
        <button onClick={() => setOpenMsg(o => !o)} className="mt-1 flex items-center gap-1 text-micro font-bold text-slate-300 hover:text-white">
          <ChevronDown size={11} className={openMsg ? 'rotate-180 transition-transform' : 'transition-transform'} /> {openMsg ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// ── per-reply telemetry: tps · time · size at a glance, the rest on hover ────
function MetricsLine({ m }: { m?: ChatMetrics }) {
  // Thin/empty replies (0 output) or a metrics-less response: show nothing, not "0 tok/s".
  if (!m || !m.outputTokens || !m.tps) return null;
  const detail = [
    m.ttftMs != null ? `first token ${(m.ttftMs / 1000).toFixed(1)}s` : null,
    `${m.inputTokens} in · ${m.outputTokens} out`,
    m.costUsd ? `$${m.costUsd.toFixed(4)}` : null,
  ].filter(Boolean).join('  ·  ');
  return (
    <div className="mt-1 text-micro text-slate-400 tabular-nums cursor-default" title={detail} data-feature-id="fb-chat-metrics">
      {m.tps.toFixed(1)} tok/s · {m.responseSec.toFixed(2)}s · {m.outputTokens} tokens
    </div>
  );
}

// ── repo file picker (tag without dragging) ──────────────────────────────────
function FilePicker({ activeId, onPick }: { activeId: string; onPick: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open || files.length) return;
    fetch(withProject(`${API}/files`)).then(r => r.json()).then(d => setFiles(d.files ?? [])).catch(() => setFiles([]));
  }, [open, files.length]);
  const hits = useMemo(() => (q.trim() ? files.filter(f => f.toLowerCase().includes(q.toLowerCase())).slice(0, 40) : files.slice(0, 40)), [files, q]);
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className={btnSm} data-feature-id="fb-chat-pick"><FileCode size={13} /> Repo file</button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-72 max-w-[80vw] rounded-xl border border-slate-200 bg-white shadow-xl z-20">
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-slate-200">
            <Search size={13} className="text-slate-400" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find file to tag…" className="flex-1 min-w-0 text-xs bg-transparent focus:outline-none" />
            <button onClick={() => setOpen(false)}><X size={14} className="text-slate-400 hover:text-slate-700" /></button>
          </div>
          <div className="max-h-56 overflow-y-auto custom-scrollbar p-1">
            {hits.length ? hits.map(f => (
              <button key={f} onClick={() => { onPick(f); setOpen(false); setQ(''); }} className="flex items-center gap-1.5 w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-100 text-2xs">
                <FileCode size={12} className="text-slate-400 shrink-0" /><span className="font-mono truncate">{f}</span>
              </button>
            )) : <p className="p-3 text-center text-2xs text-slate-500">No match.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── settings panel ───────────────────────────────────────────────────────────
function ChatSettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, setSettings, sessions } = useChatStore();
  return (
    <div className="p-3 space-y-4" data-feature-id="fb-chat-settings">
      <div className="flex items-center gap-2">
        <Settings2 size={14} className="text-slate-500" />
        <span className="eyebrow flex-1">Chat settings</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={15} /></button>
      </div>
      <label className="block space-y-1">
        <span className="text-2xs font-bold text-slate-600">Model</span>
        <select value={settings.model} onChange={e => setSettings({ ...settings, model: e.target.value as ChatSettings['model'] })} className={`${selectSm} w-full`}>
          <option value="haiku">Haiku — fast/cheap</option>
          <option value="sonnet">Sonnet — balanced</option>
          <option value="opus">Opus — deepest</option>
        </select>
        <span className="text-micro text-slate-500">Which model drafts the file changes in this chat.</span>
      </label>
      <label className="block space-y-1">
        <span className="text-2xs font-bold text-slate-600">Reasoning effort</span>
        <select value={settings.effort} onChange={e => setSettings({ ...settings, effort: e.target.value as ChatSettings['effort'] })} className={`${selectSm} w-full`}>
          <option value="low">Low — fastest, small edits</option>
          <option value="medium">Medium — balanced</option>
          <option value="high">High — hardest changes, slowest</option>
        </select>
        <span className="text-micro text-slate-500">How hard the model thinks before proposing a diff.</span>
      </label>
      <div className="text-2xs text-slate-500 border-t border-slate-100 pt-3">
        These apply to <strong>this chat only</strong> — each of your {sessions.length} thread{sessions.length === 1 ? '' : 's'} keeps its own model, effort, tagged files, and context. New chats start from the defaults.
      </div>
    </div>
  );
}

// ── the chat panel ───────────────────────────────────────────────────────────
export function FileChat({ activeId, className = '', onApplied }: {
  activeId: string;
  className?: string;
  /** Called after a proposal is written, so a host (the editor) can refresh the file. */
  onApplied?: (path: string, content: string) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const { sessions, activeId: curId, active, settings, newSession, selectSession, deleteSession, renameSession, patchActive, tag } = useChatStore();

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const msgId = useRef(0);

  // Always land on the latest message: when the thread opens/switches and when it grows.
  useEffect(() => { scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight }); setAtBottom(true); }, [curId, active?.messages.length, sending]);

  // Item 16: track distance from the bottom so a "scroll to bottom" button can appear when the
  // user has scrolled up in a long thread. 40px of slack absorbs sub-pixel/rounding jitter.
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);
  const scrollToBottom = useCallback(() => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, []);

  // Item 14: auto-grow the composer to fit its content, capped at ~6 rows (then it scrolls).
  useEffect(() => {
    const el = taRef.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_H)}px`;
  }, [input]);

  const startRename = (s: ChatSession) => { setRenamingId(s.id); setRenameText(s.title); };
  const commitRename = () => { if (renamingId) renameSession(renamingId, renameText); setRenamingId(null); };

  const untag = (path: string) => patchActive(s => ({ ...s, tagged: s.tagged.filter(p => p !== path) }));
  const removeUpload = (name: string) => patchActive(s => ({ ...s, uploads: s.uploads.filter(u => u.name !== name) }));

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const read = await Promise.all(Array.from(files).slice(0, 8).map(f => f.text().then(content => ({ name: f.name, content: content.slice(0, 512 * 1024), size: f.size })).catch(() => null)));
    const ups = read.filter(Boolean) as Upload[];
    if (ups.length) patchActive(s => ({ ...s, uploads: [...s.uploads.filter(u => !ups.some(n => n.name === u.name)), ...ups] }));
  };

  const send = async () => {
    const instruction = input.trim();
    if (!instruction || sending) return;
    if (!active.tagged.length && !active.uploads.length) { toast.info('Tag a file first', 'Drag a file in, pick a repo file, or upload one — then describe the change.'); return; }
    // Auto-title from the first message, but never clobber a title the user set by hand (item 18).
    const hasCustomTitle = active.title && active.title !== 'New chat';
    const title = active.messages.length || hasCustomTitle ? active.title : instruction.slice(0, 40);
    patchActive(s => ({ ...s, title, messages: [...s.messages, { id: ++msgId.current, role: 'user', text: instruction }] }));
    setInput(''); setSending(true);
    try {
      const r = await fetch(withProject(`${API}/file/ai-edit`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, files: active.tagged.map(path => ({ path })), uploads: active.uploads, sessionId: active.sessionId, model: settings.model, effort: settings.effort }),
      }).then(r => r.json());
      if (r.error) throw new Error(r.error);
      patchActive(s => ({ ...s, sessionId: r.sessionId ?? s.sessionId, messages: [...s.messages, { id: ++msgId.current, role: 'assistant', text: r.answer || 'Proposed changes:', proposals: r.proposals ?? [], metrics: r.metrics }] }));
    } catch (e: any) {
      patchActive(s => ({ ...s, messages: [...s.messages, { id: ++msgId.current, role: 'assistant', text: `Couldn't produce a change: ${e?.message || 'request failed'}` }] }));
    } finally { setSending(false); }
  };

  const applyProposal = async (msgIdx: number, p: Proposal) => {
    try {
      const r = await fetch(withProject(`${API}/file`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p.path, content: p.newContent }) }).then(r => r.json());
      if (r.error) throw new Error(r.error);
      toast.success('Applied', p.path);
      patchActive(s => ({ ...s, messages: s.messages.map((m, i) => (i === msgIdx && m.proposals ? { ...m, proposals: m.proposals.filter(x => x !== p) } : m)) }));
      onApplied?.(p.path, p.newContent);
    } catch (e: any) { toast.error('Apply failed', e?.message); }
  };

  // Item 15: drop a single proposal from a message without writing it — the reject to Apply's approve.
  const dismissProposal = (msgIdx: number, p: Proposal) => {
    patchActive(s => ({ ...s, messages: s.messages.map((m, i) => (i === msgIdx && m.proposals ? { ...m, proposals: m.proposals.filter(x => x !== p) } : m)) }));
  };

  // Item 22: an empty thread has nothing to lose, so its confirm says so plainly — a populated one
  // warns about the messages and context it is about to destroy.
  const confirmDelete = async (s: ChatSession) => {
    const count = s.messages.filter(m => m.role === 'user').length;
    const ok = count === 0
      ? await confirm({ title: 'Delete this empty chat?', message: 'It has no messages yet, so nothing is lost.', confirmLabel: 'Delete', tone: 'danger' })
      : await confirm({ title: 'Delete this chat?', message: `This removes ${count} message${count === 1 ? '' : 's'} and the thread's context. This cannot be undone.`, confirmLabel: 'Delete', tone: 'danger' });
    if (ok) deleteSession(s.id);
  };

  return (
    <div
      className={`flex flex-col ${className}`}
      data-feature-id="fb-chat"
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); const p = e.dataTransfer.getData('text/plain'); if (p) tag(p); }}
    >
      {/* header: thread switcher · new · settings */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-200 shrink-0">
        <Sparkles size={14} className="text-ai-600 shrink-0" />
        <div className="relative flex-1 min-w-0">
          <button onClick={() => { setShowSessions(o => !o); setShowSettings(false); }} className="flex items-center gap-1 max-w-full text-xs font-bold text-slate-800 hover:text-slate-950" data-feature-id="fb-chat-threads">
            <span className="truncate">{active.title}</span>
            <ChevronDown size={13} className={`shrink-0 text-slate-400 transition-transform ${showSessions ? 'rotate-180' : ''}`} />
          </button>
          {showSessions && (
            <div className="absolute top-full left-0 mt-1 w-64 max-w-[80vw] rounded-xl border border-slate-200 bg-white shadow-xl z-20 p-1">
              {sessions.map(s => (
                <div key={s.id} className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md ${s.id === curId ? 'bg-accent-50' : 'hover:bg-slate-100'}`}>
                  <MessagesSquare size={12} className={s.id === curId ? 'text-accent-600 shrink-0' : 'text-slate-400 shrink-0'} />
                  {renamingId === s.id ? (
                    <input
                      autoFocus value={renameText}
                      onChange={e => setRenameText(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitRename(); } else if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null); } }}
                      className="flex-1 min-w-0 text-2xs bg-white border border-slate-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-ai-300"
                      aria-label="Rename chat"
                    />
                  ) : (
                    <button onClick={() => { selectSession(s.id); setShowSessions(false); }} onDoubleClick={() => startRename(s)} className="flex-1 min-w-0 text-left text-2xs truncate">{s.title || 'New chat'}</button>
                  )}
                  {renamingId !== s.id && <span className="text-micro text-slate-400 shrink-0">{s.messages.filter(m => m.role === 'user').length}</span>}
                  {renamingId !== s.id && (
                    <Tooltip label="Rename">
                      <button onClick={() => startRename(s)} className="shrink-0 text-slate-400 hover:text-slate-700 sm:opacity-0 sm:group-hover:opacity-100"><Pencil size={11} /></button>
                    </Tooltip>
                  )}
                  <button onClick={() => confirmDelete(s)} aria-label="Delete chat" className="shrink-0 text-slate-400 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={newSession} className={iconBtn} aria-label="New chat" data-feature-id="fb-chat-new"><Plus size={15} /></button>
        <button onClick={() => { setShowSettings(o => !o); setShowSessions(false); }} className={iconBtn} aria-label="Chat settings" aria-pressed={showSettings}><Settings2 size={15} /></button>
        <button onClick={() => confirmDelete(active)} className={`${iconBtn} text-slate-400 hover:text-rose-600`} aria-label="Delete chat"><Trash2 size={14} /></button>
      </div>

      {showSettings ? (
        <ChatSettingsPanel onClose={() => setShowSettings(false)} />
      ) : (
        <>
          {/* messages */}
          <div className="relative flex-1 min-h-0">
          <div ref={scrollRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto custom-scrollbar p-2 space-y-2">
            {!active.messages.length ? (
              <div className="p-4 text-center text-2xs text-slate-500 leading-relaxed">
                <MessageSquareText size={20} className="mx-auto mb-2 text-slate-300" />
                Tag a file (drag it from the tree, pick a repo file, or upload one), then say what to change. You approve the diff before anything is written.
                <div className="mt-3 flex flex-wrap gap-1.5 justify-center">
                  {SUGGESTIONS.map(s => <button key={s} onClick={() => setInput(s)} className="text-micro text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full px-2 py-1">{s}</button>)}
                </div>
              </div>
            ) : active.messages.map((m, idx) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
                {m.role === 'user' ? <UserBubble text={m.text} /> : (
                  <div className="max-w-[92%] rounded-lg px-2.5 py-1.5 bg-slate-50 border border-slate-200 text-slate-700 text-2xs leading-relaxed">
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    {m.proposals?.map((p, i) => (
                      <div key={i} className="mt-2 rounded-lg overflow-hidden bg-surface-console border border-surface-border">
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-surface-border">
                          <FileCode size={11} className="text-slate-400" />
                          <span className="flex-1 min-w-0 font-mono text-micro text-slate-300 truncate">{p.path}</span>
                          <button onClick={() => applyProposal(idx, p)} className="flex items-center gap-1 text-micro font-bold text-emerald-300 hover:text-emerald-200" data-feature-id="fb-apply"><Check size={11} /> Apply</button>
                          <Tooltip label="Dismiss this change">
                            <button onClick={() => dismissProposal(idx, p)} aria-label="Dismiss this change" className="flex items-center gap-1 text-micro font-bold text-slate-400 hover:text-rose-300" data-feature-id="fb-dismiss"><X size={11} /> Dismiss</button>
                          </Tooltip>
                        </div>
                        <DiffView diff={p.diff} maxHeight="max-h-[30vh]" />
                      </div>
                    ))}
                    <MetricsLine m={m.metrics} />
                  </div>
                )}
              </div>
            ))}
            {sending && <div className="flex items-center gap-2 text-2xs text-slate-500 px-1"><Loader2 size={13} className="animate-spin" /> Thinking…</div>}
          </div>
            {/* Item 16: only when the user has scrolled up in a non-empty thread. */}
            {!atBottom && active.messages.length > 0 && (
              <Tooltip label="Scroll to latest">
                <button
                  onClick={scrollToBottom}
                  aria-label="Scroll to latest"
                  className={`${iconBtn} absolute bottom-2 right-2 bg-white/95 border border-slate-200 text-slate-600 shadow-md hover:text-slate-900`}
                  data-feature-id="fb-chat-scroll-bottom"
                >
                  <ArrowDown size={15} />
                </button>
              </Tooltip>
            )}
          </div>

          {/* composer */}
          <div className={`border-t p-2 space-y-2 shrink-0 ${dragOver ? 'border-ai-400 bg-ai-50/60' : 'border-slate-200'}`}>
            {(active.tagged.length > 0 || active.uploads.length > 0) ? (
              <div className="flex flex-wrap gap-1">
                {active.tagged.map(p => (
                  <span key={p} className="inline-flex items-center gap-1 max-w-full text-micro font-mono text-ai-800 bg-ai-50 border border-ai-200 rounded px-1.5 py-0.5">
                    <FileCode size={10} className="shrink-0" /><span className="truncate">{p.split('/').pop()}</span>
                    <button onClick={() => untag(p)} className="shrink-0 hover:text-rose-600"><X size={10} /></button>
                  </span>
                ))}
                {active.uploads.map(u => (
                  <span key={u.name} className="inline-flex items-center gap-1 max-w-full text-micro font-mono text-violet-800 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">
                    <Upload size={10} className="shrink-0" /><span className="truncate">{u.name}</span>
                    {u.size != null && <span className="shrink-0 text-violet-500 tabular-nums">{fmtSize(u.size)}</span>}
                    <button onClick={() => removeUpload(u.name)} className="shrink-0 hover:text-rose-600"><X size={10} /></button>
                  </span>
                ))}
              </div>
            ) : (
              <p className={`text-micro text-center py-1 ${dragOver ? 'text-ai-700 font-bold' : 'text-slate-400'}`}>{dragOver ? 'Drop to tag this file' : 'Drag files here, or use the buttons below'}</p>
            )}

            <div className="flex items-center gap-1.5">
              <FilePicker activeId={activeId} onPick={tag} />
              <button onClick={() => fileInput.current?.click()} className={btnSm} data-feature-id="fb-chat-upload"><Paperclip size={13} /> Upload</button>
              <input ref={fileInput} type="file" multiple hidden onChange={e => { onFiles(e.target.files); e.target.value = ''; }} />
            </div>

            <div className="flex items-end gap-1.5">
              <textarea
                ref={taRef}
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                rows={1} placeholder="Describe the change…" data-feature-id="fb-chat-input"
                style={{ maxHeight: COMPOSER_MAX_H }}
                className="flex-1 min-w-0 resize-none overflow-y-auto text-2xs text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ai-200 placeholder:text-slate-400"
              />
              <button onClick={send} disabled={sending || !input.trim()} className={`${iconBtn} bg-ai-600 text-white hover:bg-ai-700 disabled:opacity-40`} aria-label="Send" data-feature-id="fb-chat-send">
                {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default FileChat;
