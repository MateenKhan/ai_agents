import React, { useState, useEffect, useRef } from 'react';
import { Tooltip } from './Tooltip';
import { motion } from 'framer-motion';
import {
  GitBranch, Github, Gitlab, KeyRound, X, Eye, EyeOff, RefreshCw, FileDiff,
  Copy, Check, ChevronDown, Trash2, Plus, DownloadCloud, GitCommit,
  Upload, History, FolderGit2, Bot, Database, HeartPulse,
  ExternalLink, Radar, CheckCircle2, Play, Square, Wand2, Save, Pencil, FolderTree,
} from 'lucide-react';
import { API_BASE, withProject } from '../../../apiBase';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmProvider';
import { useProjects } from '../projectContext';
import { LogConsole } from './LogConsole';
import { DiffView } from './DiffView';
import { FileBrowser } from './FileBrowser';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { btnPrimarySm, btnSm, inputSm, iconBtnDanger } from '../ui';

// lucide has no Bitbucket brand glyph — minimal inline SVG matching the icon-size API.
const Bitbucket = ({ size = 16, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M2.65 3a.65.65 0 0 0-.64.76l2.72 16.5a.88.88 0 0 0 .86.74h13.05a.65.65 0 0 0 .64-.55l2.72-16.69a.65.65 0 0 0-.64-.76H2.65Zm11.9 11.62H9.5L8.28 8.25h7.35l-1.08 6.37Z" />
  </svg>
);

// Provider presets for the PAT flow. App-manifest connect stays GitHub-only (see below);
// GitLab/Bitbucket users authenticate git via host + credential, so we just preset the
// host, the git username convention, and swap the token-creation guide.
type ProviderId = 'github' | 'gitlab' | 'bitbucket';
const PROVIDERS: Record<ProviderId, {
  label: string; Icon: React.ComponentType<{ size?: number; className?: string }>;
  host: string; user: string; placeholder: string; tokenUrl: string;
  credName: string; guide: string[];
}> = {
  github: {
    label: 'GitHub', Icon: Github, host: 'github.com', user: '', placeholder: 'ghp_... or github_pat_...',
    tokenUrl: 'https://github.com/settings/tokens', credName: 'Personal access token',
    guide: [
      'GitHub → profile photo → Settings → Developer settings.',
      'Personal access tokens → Fine-grained (recommended) or classic.',
      'Generate new token, name it, set an expiry.',
      'Read-only: Contents Read-only. Push: Contents Read and write (+ Administration for repo create).',
      'Copy immediately — shown only once. Paste above, pick scope, Add.',
    ],
  },
  gitlab: {
    label: 'GitLab', Icon: Gitlab, host: 'gitlab.com', user: 'oauth2', placeholder: 'glpat-...',
    tokenUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens', credName: 'Personal access token',
    guide: [
      'GitLab → avatar → Edit profile → Access tokens.',
      'Add new token, name it, set an expiry.',
      'Read-only: read_repository scope. Push: write_repository scope.',
      'Git username is oauth2 (prefilled); the token is the password.',
      'Create, copy immediately, paste above, pick scope, Add. Self-hosted? change the host.',
    ],
  },
  bitbucket: {
    label: 'Bitbucket', Icon: Bitbucket, host: 'bitbucket.org', user: '', placeholder: 'app password',
    tokenUrl: 'https://bitbucket.org/account/settings/app-passwords/', credName: 'App password',
    guide: [
      'Bitbucket → avatar → Personal settings → App passwords.',
      'Create app password, label it.',
      'Read-only: Repositories Read. Push: Repositories Write.',
      'Git username is your Bitbucket username (fill it in above).',
      'Create, copy immediately, paste above, pick scope, Add.',
    ],
  },
};

// Known default hosts → provider, so switching providers only overwrites an untouched
// (default) host, never a self-hosted one the user typed.
const HOST_TO_PROVIDER: Record<string, ProviderId> = {
  'github.com': 'github', 'gitlab.com': 'gitlab', 'bitbucket.org': 'bitbucket',
};

interface GitPanelProps { isOpen: boolean; onClose: () => void; activeId?: string; }

interface TokenMasked { id: string; label: string; scope: 'readonly' | 'readwrite'; username: string; host: string; createdAt: string; tokenMasked: string; source?: 'pat' | 'github-app'; }
interface GithubApp { id: string; name: string; slug: string; appId: number | null; htmlUrl: string | null; state: 'pending' | 'created' | 'installed'; account: string | null; installed: boolean; createdAt: string; }
interface GitFile { path: string; x: string; y: string; staged: boolean; label: string; }
interface GitStatus { ok: boolean; repo?: string; branch?: string; ahead?: number; behind?: number; clean?: boolean; files?: GitFile[]; error?: string; }
interface Worktree { path: string; name: string; taskId: string; branch: string; isPlan: boolean; head: string; lastCommit: { sha: string; author: string; date: string; subject: string }; merged: boolean; agent: string | null; title: string | null; status: string | null; stage: string | null; }
interface Commit { hash: string; shortHash: string; author: string; email: string; date: string; subject: string; merge: boolean; }

type Tab = 'repo' | 'clone' | 'run' | 'files' | 'tokens' | 'agents' | 'worktrees' | 'history' | 'index';
interface IndexStatus { root: string; glob: string; isDefault: boolean; files: number; nodes: number; embedded: number; coverage: number; healthy: boolean; rebuilding: boolean; }
type Msg = { kind: 'ok' | 'err'; text: string } | null;

function fileColors(f: GitFile): string {
  if (f.staged) return 'bg-emerald-50 border-emerald-200 text-emerald-700';
  const s = `${f.x}${f.y}`.toUpperCase();
  if (s.includes('D')) return 'bg-rose-50 border-rose-200 text-rose-700';
  if (s.includes('?')) return 'bg-slate-50 border-slate-200 text-slate-600';
  return 'bg-amber-50 border-amber-200 text-amber-700';
}

/** Full-width, styled, filterable combobox (replaces the unstyleable native <datalist>). */
function SearchSelect({ value, onChange, options, placeholder, onOpen, loading, allowCustom, disabled, mono }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
  placeholder?: string; onOpen?: () => void; loading?: boolean; allowCustom?: boolean; disabled?: boolean; mono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const selectedLabel = options.find(o => o.value === value)?.label ?? value;
  const filtered = options.filter(o => o.label.toLowerCase().includes((open ? q : '').toLowerCase()));
  const openIt = () => { if (disabled) return; setOpen(true); setQ(''); onOpen?.(); };
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };
  const cls = `w-full min-h-control rounded-lg border border-slate-200 pl-3 pr-8 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent-300 ${mono ? 'font-mono text-xs sm:text-sm' : ''}`;
  return (
    <div ref={ref} className="relative">
      <input
        value={open ? q : selectedLabel}
        disabled={disabled}
        onFocus={openIt}
        onChange={e => { setQ(e.target.value); if (!open) setOpen(true); if (allowCustom) onChange(e.target.value); }}
        placeholder={placeholder}
        className={cls}
      />
      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto custom-scrollbar bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {loading && <div className="px-3 py-2 text-xs text-slate-500">Loading…</div>}
          {!loading && filtered.map(o => (
            <button key={o.value} type="button" onMouseDown={e => { e.preventDefault(); pick(o.value); }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 hover:bg-accent-50 ${o.value === value ? 'bg-accent-50/60 text-accent-700 font-semibold' : 'text-slate-700'}`}>
              <span className={`truncate ${mono ? 'font-mono text-xs' : ''}`}>{o.label}</span>
              {o.hint && <span className="text-micro text-slate-500 shrink-0">{o.hint}</span>}
            </button>
          ))}
          {!loading && filtered.length === 0 && (
            allowCustom && q
              ? <div className="px-3 py-2 text-xs text-slate-500">Use “<span className="font-mono">{q}</span>”</div>
              : <div className="px-3 py-2 text-xs text-slate-500">No matches</div>
          )}
        </div>
      )}
    </div>
  );
}

export function GitPanel({ isOpen, onClose, activeId }: GitPanelProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const { refreshProjects, setActiveId } = useProjects();
  useEscapeKey(onClose, isOpen);
  const [tab, setTab] = useState<Tab>('tokens');

  // ---- tokens ----
  const [tokens, setTokens] = useState<TokenMasked[]>([]);
  const [tLabel, setTLabel] = useState('');
  const [tVal, setTVal] = useState('');
  const [tUser, setTUser] = useState('');
  const [tHost, setTHost] = useState('github.com');
  const [tScope, setTScope] = useState<'readonly' | 'readwrite'>('readonly');
  const [showToken, setShowToken] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tokMsg, setTokMsg] = useState<Msg>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  // Tokens-tab accordions (collapsed by default; saved-tokens header shows the count).
  const [savedTokOpen, setSavedTokOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [addTokOpen, setAddTokOpen] = useState(false);

  // ---- github app (Coolify-style connect) ----
  const [apps, setApps] = useState<GithubApp[]>([]);
  const [appName, setAppName] = useState('');
  const [appOrg, setAppOrg] = useState('');
  const [appScope, setAppScope] = useState<'readonly' | 'readwrite'>('readonly');
  const [provider, setProvider] = useState<ProviderId>('github');
  const [appMsg, setAppMsg] = useState<Msg>(null);
  const [appBusy, setAppBusy] = useState(false);
  const [connectStarted, setConnectStarted] = useState(false);
  const [detectingId, setDetectingId] = useState<string | null>(null);
  // ---- rename (label) an already-connected app ----
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  // ---- manual "connect an existing app" ----
  const [manualOpen, setManualOpen] = useState(false);
  const [manualAppId, setManualAppId] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  // ---- assignments ----
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<{ role: string; label: string }[]>([]);
  const [asgMsg, setAsgMsg] = useState<Msg>(null);

  // ---- repo / changes ----
  const [repoPath, setRepoPath] = useState('');
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // ---- git actions ----
  const [commitMsg, setCommitMsg] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchFrom, setBranchFrom] = useState('');
  const [branches, setBranches] = useState<{ current: string; list: string[] }>({ current: '', list: [] });
  const [pushToken, setPushToken] = useState('');
  const [actMsg, setActMsg] = useState<Msg>(null);
  const [acting, setActing] = useState(false);

  // ---- clone ----
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneDir, setCloneDir] = useState('');
  const [cloneToken, setCloneToken] = useState('');
  const [cloneMsg, setCloneMsg] = useState<Msg>(null);
  const [cloning, setCloning] = useState(false);
  const [cloneBranch, setCloneBranch] = useState('');
  const [cloneLog, setCloneLog] = useState<string[]>([]);
  const [deletingRepo, setDeletingRepo] = useState(false);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [rbBusy, setRbBusy] = useState(false);
  const [indexing, setIndexing] = useState(false);
  // ---- repo picker (populated when a GitHub App token is selected) ----
  const [repoList, setRepoList] = useState<{ full_name: string; clone_url: string; private: boolean }[]>([]);
  const [repoListBusy, setRepoListBusy] = useState(false);
  const [repoListErr, setRepoListErr] = useState<string | null>(null);
  // ---- run config (install/run/build/test) ----
  type RunCfg = { install: string; run: string; build: string; test: string; cwd?: string };
  const [runCfg, setRunCfg] = useState<RunCfg>({ install: '', run: '', build: '', test: '' });
  const [runRepoPath, setRunRepoPath] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detectSource, setDetectSource] = useState<string | null>(null);
  const [savingRun, setSavingRun] = useState(false);
  const [runMsg, setRunMsg] = useState<Msg>(null);
  const [activeRun, setActiveRun] = useState<{ runId: string; which: string } | null>(null);
  const [runLog, setRunLog] = useState('');
  const [runRunning, setRunRunning] = useState(false);
  const [runExit, setRunExit] = useState<number | null>(null);

  // ---- worktrees ----
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [wtLoading, setWtLoading] = useState(false);

  // ---- history ----
  const [histRef, setHistRef] = useState('');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [openCommit, setOpenCommit] = useState<string | null>(null);
  const [showData, setShowData] = useState<any>(null);

  // ---- code index ----
  const [idx, setIdx] = useState<IndexStatus | null>(null);
  const [idxRoot, setIdxRoot] = useState('');
  const [idxMsg, setIdxMsg] = useState<Msg>(null);
  const [idxBusy, setIdxBusy] = useState(false);
  const [indexLog, setIndexLog] = useState<string[]>([]);

  const loadTokens = async () => {
    try { const r = await fetch(withProject(`${API_BASE}/git/tokens`)); const d = await r.json(); setTokens(d.tokens || []); }
    catch { setTokMsg({ kind: 'err', text: 'Could not reach db-server.' }); }
  };
  const loadAssignments = async () => {
    try { const r = await fetch(withProject(`${API_BASE}/git/assignments`)); const d = await r.json(); setAssignments(d.assignments || {}); setAgents(d.agents || []); }
    catch { setAsgMsg({ kind: 'err', text: 'Could not reach db-server.' }); }
  };
  const loadGithubApps = async () => {
    try { const r = await fetch(withProject(`${API_BASE}/git/github-apps`)); const d = await r.json(); setApps(d.apps || []); }
    catch { /* keep prior list; connect flow surfaces its own errors */ }
  };

  // ---- github app CRUD ----
  // Kicks off Coolify-style connect: ask the backend for a signed manifest, then
  // programmatically build+submit an auto-POST form to GitHub's "new app" page in a
  // new tab (GitHub only accepts the manifest as a form POST, not a query param).
  const connectGithubApp = async () => {
    // Open the target tab NOW, inside the user gesture — after an `await` the browser
    // no longer treats a new-tab open as user-initiated and blocks it. We navigate this
    // pre-opened window once we have the manifest. If the popup was blocked, fall back
    // to submitting in the current tab.
    const win = window.open('', '_blank');
    setAppBusy(true); setAppMsg(null);
    try {
      const body: any = {
        // Tell the server which host to redirect back to, so the OAuth callback works over
        // LAN/remote (not just 127.0.0.1). API_BASE already resolves to this host:6952.
        dbPublicUrl: API_BASE,
        appUiUrl: (typeof window !== 'undefined' ? window.location.origin : ''),
      };
      if (appName.trim()) body.name = appName.trim();
      if (appOrg.trim()) body.org = appOrg.trim();
      // Scope the App's permissions. Read-only can clone but never push; read/write
      // adds the perms needed for push, PRs, and workflow files.
      body.permissions = appScope === 'readonly'
        ? { contents: 'read', metadata: 'read', pull_requests: 'read' }
        : { contents: 'write', administration: 'write', metadata: 'read', pull_requests: 'write', workflows: 'write' };
      const r = await fetch(withProject(`${API_BASE}/git/github-app/manifest`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.ok || !d.postUrl || !d.manifest) throw new Error(d.error || 'Could not start GitHub App setup.');

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = d.postUrl;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'manifest';
      input.value = JSON.stringify(d.manifest);
      form.appendChild(input);

      if (win) {
        // Submit into the pre-opened tab.
        win.name = 'gh_connect';
        form.target = 'gh_connect';
      } else {
        // Popup blocked → navigate the current tab (user returns to the app afterward).
        form.target = '_self';
      }
      document.body.appendChild(form);
      form.submit();
      setTimeout(() => { try { document.body.removeChild(form); } catch { /* gone */ } }, 0);

      setConnectStarted(true);
      setAppMsg({ kind: 'ok', text: win ? 'GitHub opened in a new tab — create the app, install it, then click Detect installation.' : 'Opening GitHub — create the app, install it, then return here and click Detect installation.' });
      loadGithubApps();
    } catch (e: any) {
      try { win?.close(); } catch { /* ignore */ }
      setAppMsg({ kind: 'err', text: e?.message || 'Could not reach the db-server. Is it running on this host:6952?' });
    }
    finally { setAppBusy(false); }
  };
  // Connect an app the user already created on GitHub: they paste its App ID + a freshly
  // generated private key (.pem). Backend stores it and auto-detects the installation.
  const connectManualApp = async () => {
    setManualBusy(true); setAppMsg(null);
    try {
      const body: any = { appId: manualAppId.trim(), privateKey: manualKey.trim() };
      if (manualName.trim()) body.name = manualName.trim();
      const r = await fetch(withProject(`${API_BASE}/git/github-app/manual`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Could not connect the app.');
      if (d.installed) setAppMsg({ kind: 'ok', text: `Connected — installed on ${d.account || 'your account'}. Ready in Clone/Push.` });
      else setAppMsg({ kind: 'ok', text: `Saved. ${d.detectError ? 'Could not auto-detect an install — ' + d.detectError + '. ' : 'No installation found — '}Install it on GitHub, then click Detect installation.` });
      setManualAppId(''); setManualKey(''); setManualName(''); setManualOpen(false);
      await loadGithubApps(); await loadTokens();
    } catch (e: any) { setAppMsg({ kind: 'err', text: e?.message || 'Failed to connect the app.' }); }
    finally { setManualBusy(false); }
  };
  const detectInstallation = async (id: string) => {
    setDetectingId(id); setAppMsg(null);
    try {
      const r = await fetch(withProject(`${API_BASE}/git/github-apps/${id}/detect-installation`), { method: 'POST' });
      const d = await r.json();
      if (d.ok && d.installed) { setAppMsg({ kind: 'ok', text: `Installed on ${d.account || 'your account'} — ready to use in Clone/Push.` }); setConnectStarted(false); }
      else setAppMsg({ kind: 'err', text: 'Not installed yet — install the app on GitHub, then try again.' });
      await loadGithubApps(); await loadTokens();
    } catch (e: any) { setAppMsg({ kind: 'err', text: e?.message || 'Failed.' }); }
    finally { setDetectingId(null); }
  };
  const deleteGithubApp = async (id: string) => {
    const ok = await confirm({
      title: 'Disconnect GitHub App?',
      message: 'This removes the installation and any tokens it provided. Clone/Push will lose access until reconnected.',
      confirmLabel: 'Disconnect',
    });
    if (!ok) return;
    setAppMsg(null);
    try {
      const r = await fetch(withProject(`${API_BASE}/git/github-apps/${id}`), { method: 'DELETE' });
      const d = await r.json(); if (!d.ok) throw new Error(d.error || 'Delete failed');
      await loadGithubApps(); await loadTokens();
      toast.success('GitHub App disconnected');
    } catch (e: any) { toast.error('Disconnect failed', e?.message); setAppMsg({ kind: 'err', text: e?.message || 'Failed.' }); }
  };
  const startRename = (id: string, current: string) => { setRenamingId(id); setRenameVal(current); };
  const saveRename = async (id: string) => {
    const name = renameVal.trim();
    if (!name) { setRenamingId(null); return; }
    setRenameBusy(true);
    try {
      const r = await fetch(withProject(`${API_BASE}/git/github-apps/${id}`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      const d = await r.json(); if (!d.ok) throw new Error(d.error || 'Rename failed');
      setRenamingId(null);
      await loadGithubApps(); await loadTokens();
      toast.success('Label updated');
    } catch (e: any) { toast.error('Rename failed', e?.message); }
    finally { setRenameBusy(false); }
  };

  // ---- run config CRUD ----
  const loadRunConfig = async () => {
    try {
      const r = await fetch(withProject(`${API_BASE}/project/run-config`));
      const d = await r.json();
      if (d.ok) { setRunCfg({ install: '', run: '', build: '', test: '', ...d.config }); setRunRepoPath(d.repoPath || ''); }
    } catch { /* surfaced on demand */ }
  };
  const detectRun = async () => {
    setDetecting(true); setRunMsg(null); setDetectSource(null);
    try {
      const r = await fetch(withProject(`${API_BASE}/project/detect-run`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Detection failed.');
      setRunCfg(c => ({ ...c, ...d.config }));
      setDetectSource(d.source || null);
      setRunMsg({ kind: 'ok', text: `Detected via ${d.source}. Review, then Save.` });
    } catch (e: any) { setRunMsg({ kind: 'err', text: e?.message || 'Detection failed.' }); }
    finally { setDetecting(false); }
  };
  const saveRunConfig = async () => {
    setSavingRun(true); setRunMsg(null);
    try {
      const r = await fetch(withProject(`${API_BASE}/project/run-config`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: runCfg }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Save failed.');
      setRunMsg({ kind: 'ok', text: 'Saved.' });
    } catch (e: any) { setRunMsg({ kind: 'err', text: e?.message || 'Save failed.' }); }
    finally { setSavingRun(false); }
  };
  const startRun = async (which: 'install' | 'run' | 'build' | 'test') => {
    setRunMsg(null); setRunLog(''); setRunExit(null);
    try {
      // Persist first so the server runs the current (possibly edited) command.
      await fetch(withProject(`${API_BASE}/project/run-config`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: runCfg }) });
      const r = await fetch(withProject(`${API_BASE}/project/run`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ which }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Could not start.');
      setActiveRun({ runId: d.runId, which }); setRunRunning(true);
    } catch (e: any) { setRunMsg({ kind: 'err', text: e?.message || 'Could not start.' }); }
  };
  const stopRun = async () => {
    if (!activeRun) return;
    try { await fetch(withProject(`${API_BASE}/project/run/stop`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: activeRun.runId }) }); }
    catch { /* ignore */ }
  };

  // Reload project-scoped data when the panel opens OR the active project changes,
  // so tokens/assignments/repo state always reflect the current project.
  useEffect(() => {
    if (!isOpen) return;
    loadTokens();
    loadAssignments();
    loadGithubApps();
    loadRunConfig();
    // Reset repo/index views so stale per-project state isn't shown after a switch.
    setStatus(null); setStatusErr(null); setSelectedFile(null); setDiff(null);
    setWorktrees([]); setCommits([]); setIdx(null); setBranches({ current: '', list: [] });
    // Default the repo path to the ACTIVE PROJECT's repo so its status shows without typing.
    fetch(`${API_BASE}/projects`).then(r => r.json()).then(d => {
      const p = (d.projects || []).find((x: any) => x.id === (activeId || 'default'));
      if (p?.repoPath) { setRepoPath(p.repoPath); loadStatus(p.repoPath); }
    }).catch(() => { /* offline */ });
    if (tab === 'worktrees') loadWorktrees();
    if (tab === 'index') loadIndex();
    /* eslint-disable-next-line */
  }, [isOpen, activeId]);

  // Poll the apps list while a connect is in progress so the state badge flips to
  // 'created'/'installed' without the user manually refreshing.
  useEffect(() => {
    if (!isOpen || !connectStarted) return;
    const t = setInterval(loadGithubApps, 4000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [isOpen, connectStarted]);

  // When a GitHub App token is picked in Clone, fetch the repos that installation can
  // access so the user picks one instead of typing a URL. PAT/blank → clear the list.
  useEffect(() => {
    if (!cloneToken.startsWith('app:')) { setRepoList([]); setRepoListErr(null); return; }
    const recordId = cloneToken.slice(4);
    let cancelled = false;
    setRepoListBusy(true); setRepoListErr(null);
    (async () => {
      try {
        const r = await fetch(withProject(`${API_BASE}/git/github-apps/${recordId}/repos`));
        const d = await r.json();
        if (cancelled) return;
        if (!d.ok) throw new Error(d.error || 'Could not list repos.');
        setRepoList(d.repos || []);
      } catch (e: any) { if (!cancelled) { setRepoList([]); setRepoListErr(e?.message || 'Failed to load repos.'); } }
      finally { if (!cancelled) setRepoListBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [cloneToken]);

  // Poll the live indexing log while the Index tab is open — shows the build output and
  // refreshes counts while it's remembering the repo.
  useEffect(() => {
    if (!isOpen || tab !== 'index') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await fetch(withProject(`${API_BASE}/code-index/progress`)).then(r => r.json());
        if (cancelled) return;
        setIndexLog(d.lines || []);
        if (d.building) loadIndex();
      } catch { /* transient */ }
    };
    tick();
    const iv = setInterval(tick, 1200);
    return () => { cancelled = true; clearInterval(iv); };
    /* eslint-disable-next-line */
  }, [isOpen, tab, activeId]);

  // Poll a live run's log while it's running (and once more after it exits to catch the tail).
  useEffect(() => {
    if (!activeRun) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(withProject(`${API_BASE}/project/run/logs?runId=${activeRun.runId}`));
        const d = await r.json();
        if (cancelled || !d.ok) return;
        setRunLog(d.log || ''); setRunRunning(d.running); setRunExit(d.exitCode);
        if (!d.running) return true; // stop polling
      } catch { /* transient */ }
      return false;
    };
    let timer: any;
    const loop = async () => { const done = await tick(); if (!done && !cancelled) timer = setTimeout(loop, 1000); };
    loop();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeRun]);

  // Reattach to a server-side run on open. The process lives in the db-server (runProcs),
  // NOT in this modal — closing the modal orphans it, still holding its port. Without this,
  // you reopen to a blank Run tab and a second `run` collides on the port (EADDRINUSE).
  // Restoring activeRun makes the poll effect above resume the log + running/exit state, so
  // a live run is visible (and Stoppable) again. Picks the most recent run for the project.
  useEffect(() => {
    if (!isOpen || tab !== 'run' || activeRun) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(withProject(`${API_BASE}/project/runs`));
        const d = await r.json();
        const latest = d.ok && d.runs?.[0];
        if (!cancelled && latest) setActiveRun({ runId: latest.runId, which: latest.which });
      } catch { /* offline — nothing to reattach */ }
    })();
    return () => { cancelled = true; };
  }, [isOpen, tab, activeId, activeRun]);

  if (!isOpen) return null;
  const activeProvider = PROVIDERS[provider];
  const ProviderIcon = activeProvider.Icon;

  // ---- token CRUD ----
  const resetTokenForm = () => { setEditingId(null); setTLabel(''); setTVal(''); setTUser(''); setTHost('github.com'); setTScope('readonly'); };
  // Switch provider: preset host + git-username convention for the PAT form. Only fill
  // host/user if the user hasn't already typed a custom value (don't clobber edits).
  const pickProvider = (id: ProviderId) => {
    setProvider(id);
    const p = PROVIDERS[id];
    setTHost(prev => (!prev || prev in HOST_TO_PROVIDER ? p.host : prev));
    setTUser(prev => (!prev || prev === 'oauth2' ? p.user : prev));
  };
  const saveToken = async () => {
    setTokMsg(null);
    try {
      if (editingId) {
        const body: any = { label: tLabel, username: tUser, host: tHost, scope: tScope };
        if (tVal.trim()) body.token = tVal.trim();
        const r = await fetch(withProject(`${API_BASE}/git/tokens/${editingId}`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json(); if (!d.ok) throw new Error(d.error || 'Update failed');
        setTokMsg({ kind: 'ok', text: 'Token updated.' });
        toast.success('Token updated', tLabel);
      } else {
        if (!tVal.trim()) throw new Error('Paste a token first.');
        const r = await fetch(withProject(`${API_BASE}/git/tokens`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: tLabel || 'token', token: tVal.trim(), username: tUser, host: tHost, scope: tScope }) });
        const d = await r.json(); if (!d.ok) throw new Error(d.error || 'Add failed');
        setTokMsg({ kind: 'ok', text: 'Token added.' });
        toast.success('Token added', tLabel || 'token');
      }
      resetTokenForm(); await loadTokens();
    } catch (e: any) { toast.error('Token save failed', e?.message); setTokMsg({ kind: 'err', text: e?.message || 'Failed.' }); }
  };
  const editToken = (t: TokenMasked) => { setEditingId(t.id); setTLabel(t.label); setTVal(''); setTUser(t.username); setTHost(t.host); setTScope(t.scope); setTab('tokens'); };
  const deleteToken = async (id: string) => {
    const tok = tokens.find(t => t.id === id);
    const ok = await confirm({
      title: 'Delete token?',
      message: `"${tok?.label ?? 'This token'}" will be permanently removed. Agents using it lose access.`,
      confirmLabel: 'Delete token',
    });
    if (!ok) return;
    setTokMsg(null);
    try {
      const r = await fetch(withProject(`${API_BASE}/git/tokens/${id}`), { method: 'DELETE' });
      const d = await r.json(); if (!d.ok) throw new Error(d.error || 'Delete failed');
      await loadTokens(); await loadAssignments();
      toast.success('Token deleted', tok?.label);
    } catch (e: any) { toast.error('Delete failed', e?.message); setTokMsg({ kind: 'err', text: e?.message || 'Failed.' }); }
  };

  const setAssign = async (agent: string, tokenId: string) => {
    setAsgMsg(null);
    setAssignments(a => ({ ...a, [agent]: tokenId }));
    try {
      const r = await fetch(withProject(`${API_BASE}/git/assignments`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent, tokenId: tokenId || null }) });
      const d = await r.json(); if (!d.ok) throw new Error(d.error || 'Failed');
      setAsgMsg({ kind: 'ok', text: 'Assignment saved.' });
    } catch (e: any) { setAsgMsg({ kind: 'err', text: e?.message || 'Failed.' }); await loadAssignments(); }
  };

  // ---- repo status/diff ----
  const loadStatus = async (path = repoPath) => {
    setStatusLoading(true); setStatusErr(null); setSelectedFile(null); setDiff(null);
    try {
      const r = await fetch(withProject(`${API_BASE}/git/status?repo=${encodeURIComponent(path)}`));
      const d: GitStatus = await r.json(); setStatus(d);
      if (!d.ok) setStatusErr(d.error || 'Not a git repository.');
      else loadBranches(path);
    } catch { setStatus(null); setStatusErr('Could not reach db-server.'); }
    finally { setStatusLoading(false); }
  };
  const loadDiff = async (file: string) => {
    if (selectedFile === file) { setSelectedFile(null); setDiff(null); return; }
    setSelectedFile(file); setDiff(null); setDiffLoading(true);
    try {
      const r = await fetch(withProject(`${API_BASE}/git/diff?repo=${encodeURIComponent(repoPath)}&file=${encodeURIComponent(file)}`));
      const d = await r.json(); if (!d.ok) throw new Error(); setDiff(d.diff ?? '');
    } catch { setDiff('(Could not load diff.)'); }
    finally { setDiffLoading(false); }
  };

  // ---- git actions ----
  const doAction = async (fn: () => Promise<void>) => { setActing(true); setActMsg(null); try { await fn(); } finally { setActing(false); } };
  const doCommit = () => doAction(async () => {
    if (!commitMsg.trim()) { setActMsg({ kind: 'err', text: 'Enter a commit message.' }); return; }
    const r = await fetch(withProject(`${API_BASE}/git/commit`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: repoPath, message: commitMsg.trim() }) });
    const d = await r.json();
    setActMsg(d.ok ? { kind: 'ok', text: `Committed ${d.hash}` } : { kind: 'err', text: d.output || d.error || 'Commit failed' });
    if (d.ok) { setCommitMsg(''); loadStatus(); }
  });
  const doPush = () => doAction(async () => {
    const r = await fetch(withProject(`${API_BASE}/git/push`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: repoPath, tokenId: pushToken || undefined }) });
    const d = await r.json();
    setActMsg(d.ok ? { kind: 'ok', text: `Pushed → ${d.branch}` } : { kind: 'err', text: d.output || d.error || 'Push failed' });
    if (d.ok) loadStatus();
  });
  const doBranch = () => doAction(async () => {
    if (!branchName.trim()) { setActMsg({ kind: 'err', text: 'Enter a branch name.' }); return; }
    const r = await fetch(withProject(`${API_BASE}/git/branch`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: repoPath, name: branchName.trim(), from: branchFrom.trim() || undefined }) });
    const d = await r.json();
    setActMsg(d.ok ? { kind: 'ok', text: `Created & checked out ${d.branch}` } : { kind: 'err', text: d.output || d.error || 'Branch failed' });
    if (d.ok) { setBranchName(''); setBranchFrom(''); loadStatus(); loadBranches(); }
  });
  const loadBranches = async (path = repoPath) => {
    try { const d = await fetch(withProject(`${API_BASE}/git/branches?repo=${encodeURIComponent(path)}`)).then(r => r.json()); if (d.ok) setBranches({ current: d.current, list: d.branches || [] }); }
    catch { /* transient */ }
  };
  const doCheckout = (branch: string) => doAction(async () => {
    const r = await fetch(withProject(`${API_BASE}/git/checkout`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: repoPath, branch }) });
    const d = await r.json();
    if (d.ok) { toast.success('Switched branch', branch); loadStatus(); loadBranches(); }
    else { setActMsg({ kind: 'err', text: d.output || d.error || 'Checkout failed' }); toast.error('Checkout failed', d.error, d.output); }
  });
  const doPull = () => doAction(async () => {
    const r = await fetch(withProject(`${API_BASE}/git/pull`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: repoPath, tokenId: pushToken || undefined }) });
    const d = await r.json();
    setActMsg(d.ok ? { kind: 'ok', text: `Pulled ${d.branch}` } : { kind: 'err', text: d.output || d.error || 'Pull failed' });
    if (d.ok) { toast.success('Pulled', d.output?.split('\n')[0] || d.branch); loadStatus(); }
    else toast.error('Pull failed', d.error || 'git pull returned an error', d.output);
  });
  const doClone = () => { setCloning(true); setCloneMsg(null); setCloneLog([]); (async () => {
    // Poll live git output while the clone runs → stream it into the log box.
    const poll = setInterval(async () => {
      try { const p = await fetch(withProject(`${API_BASE}/git/clone-progress`)).then(r => r.json()); if (Array.isArray(p.lines)) setCloneLog(p.lines); } catch { /* transient */ }
    }, 500);
    try {
      const r = await fetch(withProject(`${API_BASE}/git/clone`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: cloneUrl.trim(), dir: cloneDir.trim(), branch: cloneBranch.trim() || undefined, tokenId: cloneToken || undefined }) });
      const d = await r.json();
      if (d.ok) {
        setCloneMsg({ kind: 'ok', text: `Cloned into ${d.dir}` }); setRepoPath(d.dir || cloneDir.trim()); toast.success('Repository cloned', d.dir);
        // Persisted server-side as a project (repo + folder + branch) — refresh the switcher
        // and make it active so it's visible in Repo/Context and never lost.
        try { await refreshProjects(); if (d.project?.id) setActiveId(d.project.id); } catch { /* offline */ }
        if (d.project) setCloneLog(l => [...l, `✓ Saved as project "${d.project.name}" (${d.project.branch || 'default branch'}) — remembered`]);
        // Mandatory: read & index the freshly-cloned repo so agents can search it. No opt-out.
        setIndexing(true); setCloneLog(l => [...l, '⏳ Indexing repo so agents can search it…']);
        try {
          const ir = await fetch(withProject(`${API_BASE}/code-index/root`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: d.dir }) }).then(r => r.json());
          if (ir.ok) { setCloneLog(l => [...l, '✓ Indexing started — the repo will be searchable shortly']); toast.success('Indexing repo', d.dir); }
          else throw new Error(ir.error || 'index build failed');
        } catch (e: any) { setCloneLog(l => [...l, `✗ Indexing failed: ${e?.message || e}`]); toast.error('Indexing failed', e?.message); }
        finally { setIndexing(false); }
      } else {
        const detail = [d.error, d.output].filter(Boolean).join('\n\n');
        // Custom confirm when the folder already exists (git refuses a non-empty dir):
        // offer to delete it and re-clone rather than dumping a raw error.
        if (/already exists and is not an empty directory/i.test(d.output || '')) {
          const target = d.dir || cloneDir.trim();
          const ok = await confirm({ title: 'Folder already exists', message: `“${target}” already exists and isn't empty. Delete it and clone again?`, confirmLabel: 'Delete & re-clone', tone: 'danger' });
          if (ok) {
            try { await deleteRepoDir(cloneDir.trim()); toast.info('Deleted — re-cloning', target); setTimeout(doClone, 0); }
            catch (e: any) { toast.fromError('Delete failed', e); setCloneMsg({ kind: 'err', text: e?.message || 'Delete failed' }); }
            return; // finally still runs (clears poll + cloning); re-clone fires next tick
          }
        }
        setCloneMsg({ kind: 'err', text: d.output || d.error || 'Clone failed' });
        toast.error('Clone failed', d.error || 'git clone returned an error', detail || undefined);
      }
    } catch (e: any) { setCloneMsg({ kind: 'err', text: e?.message || 'Failed.' }); toast.fromError('Clone failed', e); }
    finally { clearInterval(poll); setCloning(false); }
  })(); };

  // List a remote's branches (no clone needed) for the Branch dropdown.
  const loadRemoteBranches = async (url = cloneUrl) => {
    if (!url.trim()) { setRemoteBranches([]); return; }
    setRbBusy(true);
    try {
      const d = await fetch(withProject(`${API_BASE}/git/remote-branches`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), tokenId: cloneToken || undefined }) }).then(r => r.json());
      setRemoteBranches(d.branches || []);
      if (d.default && !cloneBranch.trim()) setCloneBranch(''); // leave blank → clone default
    } catch { setRemoteBranches([]); }
    finally { setRbBusy(false); }
  };

  // Core delete (no prompt) — reused by the button and by the clone "already exists" flow.
  const deleteRepoDir = async (dir: string) => {
    const d = await fetch(withProject(`${API_BASE}/git/delete-repo`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir }) }).then(r => r.json());
    if (d.error) throw new Error(d.error);
    return d;
  };
  const deleteRepo = () => {
    const dir = cloneDir.trim(); if (!dir) return;
    (async () => {
      const ok = await confirm({ title: 'Delete this repo?', message: `Permanently delete “${dir}” from disk and everything for its project — tasks, logs, context memory, and the code index. This cannot be undone.`, confirmLabel: 'Delete', tone: 'danger' });
      if (!ok) return;
      setDeletingRepo(true);
      try {
        const d = await deleteRepoDir(dir);
        setCloneLog([]); setCloneMsg(null); setCloneDir(''); setCloneUrl('');
        if (d.existed) toast.success('Repo deleted', d.deleted || dir);
        else toast.info('Already deleted', `Nothing to remove — “${dir}” was already gone`);
        // Drop the dangling project + refresh the switcher; leave the active project sane.
        try { await refreshProjects(); if (d.removedProject) setActiveId('default'); } catch { /* offline */ }
      } catch (e: any) { toast.fromError('Delete failed', e); }
      finally { setDeletingRepo(false); }
    })();
  };

  // ---- worktrees ----
  const loadWorktrees = async () => {
    setWtLoading(true);
    try { const r = await fetch(withProject(`${API_BASE}/git/worktrees`)); const d = await r.json(); setWorktrees(d.worktrees || []); }
    catch { setWorktrees([]); } finally { setWtLoading(false); }
  };
  const openWorktree = (wt: Worktree) => { setRepoPath(wt.path); setTab('repo'); loadStatus(wt.path); };
  const historyForWorktree = (wt: Worktree) => { setRepoPath(wt.path); setHistRef(''); setTab('history'); loadLog(wt.path, ''); };

  // ---- history ----
  const loadLog = async (repo = repoPath, ref = histRef) => {
    setHistLoading(true); setHistErr(null); setOpenCommit(null); setShowData(null);
    try {
      const q = new URLSearchParams({ repo, limit: '80' }); if (ref) q.set('ref', ref);
      const r = await fetch(withProject(`${API_BASE}/git/log?${q}`)); const d = await r.json();
      if (!d.ok) { setHistErr(d.error || 'Not a git repository.'); setCommits([]); }
      else setCommits(d.commits || []);
    } catch { setHistErr('Could not reach db-server.'); setCommits([]); }
    finally { setHistLoading(false); }
  };
  const openCommitDetail = async (hash: string) => {
    if (openCommit === hash) { setOpenCommit(null); setShowData(null); return; }
    setOpenCommit(hash); setShowData(null);
    try { const r = await fetch(withProject(`${API_BASE}/git/show?repo=${encodeURIComponent(repoPath)}&hash=${hash}`)); setShowData(await r.json()); }
    catch { setShowData({ ok: false }); }
  };

  // ---- code index ----
  const loadIndex = async () => {
    try { const r = await fetch(withProject(`${API_BASE}/code-index/status`)); const d = await r.json(); setIdx(d); setIdxRoot(d.isDefault ? '' : (d.root || '')); }
    catch { setIdxMsg({ kind: 'err', text: 'Could not reach db-server.' }); }
  };
  const rebuildIndex = async () => {
    setIdxBusy(true); setIdxMsg(null);
    try { const r = await fetch(withProject(`${API_BASE}/code-index/rebuild`), { method: 'POST' }); const d = await r.json(); if (!d.ok) throw new Error(d.error); setIdxMsg({ kind: 'ok', text: 'Rebuild started — reading & remembering the repo.' }); setTimeout(loadIndex, 800); }
    catch (e: any) { setIdxMsg({ kind: 'err', text: e?.message || 'Failed.' }); } finally { setIdxBusy(false); }
  };
  const retargetIndex = async (root: string) => {
    setIdxBusy(true); setIdxMsg(null);
    try {
      const r = await fetch(withProject(`${API_BASE}/code-index/root`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root }) });
      const d = await r.json(); if (!d.ok) throw new Error(d.error);
      setIdxMsg({ kind: 'ok', text: root ? `Now indexing ${root}` : 'Reset to host repo. Rebuilding…' });
      setTimeout(loadIndex, 800);
    } catch (e: any) { setIdxMsg({ kind: 'err', text: e?.message || 'Failed.' }); } finally { setIdxBusy(false); }
  };
  const indexClonedRepo = () => { setTab('index'); retargetIndex(cloneDir.trim()); };

  const copyLink = async () => { try { await navigator.clipboard.writeText(PROVIDERS[provider].tokenUrl); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 1500); } catch {} };

  const tokenOptions = (val: string, onChange: (v: string) => void, filter?: (t: TokenMasked) => boolean) => (
    <select value={val} onChange={e => onChange(e.target.value)} className={`${inputSm} w-full appearance-none`}>
      <option value="">— default —</option>
      {tokens.filter(t => !filter || filter(t)).map(t => <option key={t.id} value={t.id}>{t.label} ({t.scope})</option>)}
    </select>
  );

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: 'tokens', label: 'Tokens', icon: KeyRound },
    { id: 'clone', label: 'Clone', icon: DownloadCloud },
    { id: 'repo', label: 'Repo', icon: FileDiff },
    { id: 'run', label: 'Run', icon: Play },
    // Files: browse/edit the repo's working tree + change files by chatting with the model.
    // The same <FileBrowser> the Context tab uses, so file browsing works identically here.
    { id: 'files', label: 'Files', icon: FolderTree },
    // "Agent tokens", not "Agents": this assigns which GIT token each agent authenticates
    // with — a credentials concern, git's own. The top-level Agents tab (model/prompt) is a
    // different thing; the bare "Agents" label made this read as a duplicate of it.
    { id: 'agents', label: 'Agent tokens', icon: KeyRound },
    { id: 'worktrees', label: 'Worktrees', icon: FolderGit2 },
    { id: 'history', label: 'History', icon: History },
    // Index (code embeddings) is not git — it belongs with Context. Left here for now because
    // the Clone flow (clone a repo -> point the index at it) is wired to it; moving it needs
    // that flow decoupled first. Backend (datastore) already moved to the Database tab.
    { id: 'index', label: 'Index', icon: Database },
  ];

  // GitHub Apps are surfaced as pseudo-tokens (source==='github-app') so they show up in the
  // Clone/Push pickers, but in the Saved-credentials list they'd duplicate the app card — so
  // list only real PATs here and render apps from `apps` below.
  const patTokens = tokens.filter(t => t.source !== 'github-app');

  const msgBox = (m: Msg) => m && (
    <div className={`text-xs rounded-lg px-3 py-2 border break-words ${m.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{m.text}</div>
  );

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-4xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 min-w-0">
            <GitBranch className="w-4 h-4 text-accent-600 shrink-0" /> Git Control
          </h2>
          <Tooltip label="Close (Esc)"><button onClick={onClose} aria-label="Close (Esc)" className="flex items-center justify-center p-1.5 min-h-control min-w-control hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 shrink-0">
            <X size={18} />
          </button></Tooltip>
        </div>

        {/* Tab bar (scrollable on mobile) */}
        <div className="flex gap-1 px-2 sm:px-3 pt-1.5 overflow-x-auto custom-scrollbar border-b border-slate-100 shrink-0">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => { setTab(t.id); if (t.id === 'worktrees') loadWorktrees(); if (t.id === 'index') loadIndex(); if (t.id === 'tokens') loadGithubApps(); }}
                className={`shrink-0 min-h-control px-3 text-xs font-bold uppercase tracking-wider rounded-t-lg flex items-center gap-1.5 transition-colors ${tab === t.id ? 'bg-accent-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-3 sm:p-4 overflow-y-auto custom-scrollbar space-y-3 flex-1">

          {/* ===== BACKEND (datastore config) ===== */}

          {/* ===== REPO ===== */}
          {tab === 'repo' && (
            <>
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={repoPath} onChange={e => setRepoPath(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadStatus()}
                  placeholder="repo/worktree path — blank = server cwd" autoComplete="off" className={`${inputSm} font-mono text-xs sm:text-sm`} />
                <button onClick={() => loadStatus()} disabled={statusLoading} className={`${btnSm} shrink-0`}>
                  <RefreshCw size={14} className={statusLoading ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
              {statusErr && <div className="text-xs bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-rose-700">{statusErr}</div>}

              {status?.ok && (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1"><GitBranch size={13} className="text-slate-500" />{status.branch || '(detached)'}</span>
                    {!!status.ahead && <span className="text-2xs font-semibold text-accent-700 bg-accent-50 border border-accent-200 rounded-lg px-2 py-1">↑ {status.ahead}</span>}
                    {!!status.behind && <span className="text-2xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">↓ {status.behind}</span>}
                  </div>

                  {status.clean ? (
                    <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-700 font-bold">Working tree clean ✓</div>
                  ) : (
                    <div className="space-y-1.5">
                      {(status.files || []).map(f => {
                        const active = selectedFile === f.path;
                        return (
                          <div key={f.path}>
                            <button onClick={() => loadDiff(f.path)} className={`w-full min-h-control flex items-center gap-2.5 text-left px-2.5 py-2 rounded-lg border transition-colors ${active ? 'ring-2 ring-accent-300 ' : ''}${fileColors(f)}`}>
                              <span className="text-micro font-bold uppercase tracking-wider shrink-0 rounded px-1.5 py-0.5 bg-white/60 border border-black/10">{f.label}</span>
                              <span className="font-mono text-xs text-slate-700 break-all min-w-0">{f.path}</span>
                            </button>
                            {active && (
                              <div className="mt-1.5 mb-2 rounded-lg border border-slate-200 bg-slate-900 overflow-hidden">
                                {diffLoading ? <div className="px-3 py-4 text-xs text-slate-500">Loading diff…</div> : <DiffView diff={diff ?? ''} />}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* actions — each is one dense row: label · field(s) · button, no stacked labels */}
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    {/* commit */}
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="eyebrow shrink-0 flex items-center gap-1.5"><GitCommit size={13} className="text-accent-600" /> Commit</label>
                      <input value={commitMsg} onChange={e => setCommitMsg(e.target.value)} placeholder="message (stages all changes)" className={`${inputSm} flex-1 min-w-[8rem]`} />
                      <button onClick={doCommit} disabled={acting} className={`${btnPrimarySm} shrink-0`}>Commit</button>
                    </div>
                    {/* switch branch */}
                    {branches.list.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="eyebrow shrink-0 flex items-center gap-1.5"><GitBranch size={13} className="text-accent-600" /> Switch</label>
                        <select value={branches.current} onChange={e => e.target.value !== branches.current && doCheckout(e.target.value)} disabled={acting} data-feature-id="git-switch-branch" className={`${inputSm} flex-1 min-w-[10rem] cursor-pointer`}>
                          {!branches.list.includes(branches.current) && <option value={branches.current}>{branches.current || '(detached)'}</option>}
                          {branches.list.map(b => <option key={b} value={b}>{b}{b === branches.current ? '  (current)' : ''}</option>)}
                        </select>
                      </div>
                    )}
                    {/* new branch */}
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="eyebrow shrink-0 flex items-center gap-1.5"><GitBranch size={13} className="text-accent-600" /> New</label>
                      <input value={branchName} onChange={e => setBranchName(e.target.value)} placeholder="branch name" className={`${inputSm} flex-1 min-w-[8rem]`} />
                      <input value={branchFrom} onChange={e => setBranchFrom(e.target.value)} placeholder="from (optional)" className={`${inputSm} w-32 shrink-0`} />
                      <button onClick={doBranch} disabled={acting} className={`${btnSm} shrink-0`}>Create</button>
                    </div>
                    {/* pull + push */}
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="eyebrow shrink-0 flex items-center gap-1.5"><Upload size={13} className="text-accent-600" /> Sync</label>
                      <div className="flex-1 min-w-[8rem]">{tokenOptions(pushToken, setPushToken, t => t.scope === 'readwrite')}</div>
                      <button onClick={doPull} disabled={acting} className={`${btnSm} shrink-0`}><DownloadCloud size={14} /> Pull</button>
                      <button onClick={doPush} disabled={acting} className={`${btnPrimarySm} shrink-0`}><Upload size={14} /> Push</button>
                    </div>
                    {msgBox(actMsg)}
                  </div>
                </>
              )}
            </>
          )}

          {/* ===== CLONE ===== */}
          {tab === 'clone' && (
            <div className="space-y-3">
              <p className="text-2xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">Pick a token first — for a GitHub App it lists the repos you can clone. Leave token blank only for public repos (then paste the URL).</p>
              {/* 1) token — everything below depends on it */}
              <div className="flex flex-wrap items-center gap-2"><label className="eyebrow shrink-0">Token</label>
                <div className="flex-1 min-w-[10rem]">{tokens.length === 0 ? (
                  <button onClick={() => setTab('tokens')} className={`${btnSm} w-full justify-start`}>
                    <KeyRound size={15} /> No credentials yet — connect GitHub or add a token →
                  </button>
                ) : tokenOptions(cloneToken, setCloneToken)}</div></div>
              {/* 2) repo picker — populated from the GitHub App installation's accessible repos */}
              {cloneToken.startsWith('app:') && (
                <div>
                  <label className="eyebrow block mb-1">
                    Repository {repoListBusy && <span className="text-slate-500 normal-case font-normal">— loading…</span>}
                  </label>
                  {repoListErr ? (
                    <div className="text-2xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{repoListErr}</div>
                  ) : repoList.length === 0 && !repoListBusy ? (
                    <div className="text-2xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">No repos found for this app — install it on the repos you want.</div>
                  ) : (
                    <SearchSelect
                      value={cloneUrl}
                      disabled={repoListBusy}
                      placeholder="Search repos…"
                      options={repoList.map(r => ({ value: r.clone_url, label: r.full_name, hint: r.private ? '🔒 private' : 'public' }))}
                      onChange={url => {
                        setCloneUrl(url);
                        const repo = repoList.find(r => r.clone_url === url);
                        if (repo) { setCloneDir(repo.full_name.split('/').pop() || ''); setCloneBranch(''); setRemoteBranches([]); loadRemoteBranches(url); }
                      }}
                    />
                  )}
                </div>
              )}
              {/* 3) URL — auto-filled by the repo picker; editable for public/manual clones */}
              <div className="flex flex-wrap items-center gap-2"><label className="eyebrow shrink-0">URL</label>
                <input value={cloneUrl} onChange={e => setCloneUrl(e.target.value)} placeholder="https://github.com/owner/repo.git" className={`${inputSm} flex-1 min-w-[10rem] font-mono text-xs sm:text-sm`} /></div>
              {/* 4) target dir — auto-suggested from the repo name */}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="eyebrow block mb-1">Target directory</label>
                  <input value={cloneDir} onChange={e => setCloneDir(e.target.value)} placeholder="C:\code\my-repo" className={`${inputSm} font-mono text-xs sm:text-sm`} /></div>
                <div><label className="eyebrow block mb-1">Branch <span className="text-slate-500 normal-case font-normal tracking-normal">{rbBusy ? '— loading…' : '(searchable)'}</span></label>
                  <SearchSelect
                    value={cloneBranch}
                    onChange={setCloneBranch}
                    placeholder="default branch"
                    mono allowCustom loading={rbBusy}
                    options={remoteBranches.map(b => ({ value: b, label: b }))}
                    onOpen={() => { if (!remoteBranches.length && cloneUrl.trim()) loadRemoteBranches(); }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Tooltip label="Delete the target directory (removes the cloned repo)"><button onClick={deleteRepo} disabled={deletingRepo || cloning || !cloneDir.trim()} className={`${btnSm} text-rose-600 border-rose-200 bg-rose-50 hover:bg-rose-100`}>
                  {deletingRepo ? <span className="w-3 h-3 border-2 border-rose-400 border-t-transparent rounded-full animate-spin" /> : <Trash2 size={15} />} Delete repo
                </button></Tooltip>
                <button onClick={doClone} disabled={cloning || !cloneUrl.trim()} className={btnPrimarySm}>{cloning && <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}<DownloadCloud size={15} /> Clone</button>
              </div>

              {/* Live clone output — streams git progress (Receiving/Resolving %) */}
              {(cloning || cloneLog.length > 0) && (
                <LogConsole title="Clone output" live={cloning} copyable fullscreenable searchable lines={cloneLog} empty="starting…" />
              )}

              {/* Success line — full destination path, horizontally scrollable (never truncated) */}
              {cloneMsg?.kind === 'ok' ? (
                <div className="text-xs rounded-lg px-3 py-2 border bg-emerald-50 border-emerald-200 text-emerald-700 flex items-start gap-2">
                  <Database size={14} className={`shrink-0 mt-0.5 ${indexing ? 'animate-pulse' : ''}`} />
                  <span className="min-w-0 break-all font-mono">{cloneMsg.text}</span>
                </div>
              ) : msgBox(cloneMsg)}
              {indexing && <p className="text-2xs text-slate-500">Indexing the repo so agents can search it… (automatic)</p>}
            </div>
          )}

          {/* ===== RUN ===== */}
          {tab === 'run' && (
            <div className="space-y-3">
              <div className="text-2xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                How to install & run the cloned repo. <strong>Detect</strong> reads the codebase (Node/Python/Java/Go/Rust/…); or edit manually. Runs on the machine in{' '}
                <span className="font-mono break-all">{runRepoPath || 'the project repo'}</span>.
              </div>

              {/* detect + commands */}
              <div className="flex gap-2">
                <button onClick={detectRun} disabled={detecting} className={`${btnSm} flex-1`}>
                  {detecting ? <span className="w-3 h-3 border-2 border-slate-400/60 border-t-transparent rounded-full animate-spin" /> : <Wand2 size={15} />} {detecting ? 'Detecting…' : 'Detect with AI'}
                </button>
                <button onClick={saveRunConfig} disabled={savingRun} className={`${btnSm} shrink-0`}><Save size={15} /> Save</button>
              </div>
              {detectSource && <div className="text-micro text-slate-500">Detected stack: <span className="font-mono">{detectSource}</span></div>}

              {([
                ['install', 'Install', 'pnpm i'],
                ['run', 'Run', 'pnpm run dev'],
                ['build', 'Build', 'pnpm run build'],
                ['test', 'Test', 'pnpm test'],
              ] as const).map(([key, label, ph]) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="eyebrow w-14 shrink-0">{label}</label>
                  <input value={(runCfg as any)[key]} onChange={e => setRunCfg(c => ({ ...c, [key]: e.target.value }))}
                    placeholder={ph} className={`${inputSm} flex-1 min-w-0 font-mono text-xs sm:text-sm`} />
                  <Tooltip label={`Run ${label.toLowerCase()}`}><button onClick={() => startRun(key)} disabled={!(runCfg as any)[key]?.trim() || (runRunning && activeRun?.which === key)}
                    className={`${btnPrimarySm} shrink-0`}>
                    {runRunning && activeRun?.which === key
                      ? <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
                      : <Play size={14} />}
                  </button></Tooltip>
                </div>
              ))}

              <div className="flex items-center gap-2">
                <label className="eyebrow w-14 shrink-0">Dir</label>
                <input value={runCfg.cwd || ''} onChange={e => setRunCfg(c => ({ ...c, cwd: e.target.value }))}
                  placeholder="subdir — blank = repo root" className={`${inputSm} flex-1 min-w-0 font-mono text-xs sm:text-sm`} />
              </div>

              {msgBox(runMsg)}

              {/* Live log — the full LogConsole, not a bare box: search, Date/Time, font size
                  and full screen all come with it. The Stop control + run-state dot ride in
                  the toolbar's left slot so there's a single header, not two stacked ones. */}
              {activeRun && (
                <LogConsole
                  text={runLog}
                  live={runRunning}
                  searchable timeToggle sizeControls copyable fullscreenable
                  maxHeight="max-h-64"
                  controlsKey="git-run"
                  empty="…"
                  toolbarLeft={
                    <span className="flex items-center gap-2 text-2xs font-semibold text-slate-700">
                      <span className={`w-2 h-2 rounded-full ${runRunning ? 'bg-emerald-400' : runExit === 0 ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                      {activeRun.which} {runRunning ? 'running…' : `exited (${runExit})`}
                      {runRunning && <button onClick={stopRun} className="flex items-center gap-1 text-rose-600 hover:text-rose-800 font-bold"><Square size={12} /> Stop</button>}
                    </span>
                  }
                />
              )}
            </div>
          )}

          {/* ===== FILES ===== */}
          {tab === 'files' && (
            <FileBrowser activeId={activeId || 'default'} compact />
          )}

          {/* ===== TOKENS ===== */}
          {tab === 'tokens' && (
            <div className="space-y-3">
              {/* ---- provider picker: presets host + auth convention for the PAT flow ---- */}
              <div>
                <label className="eyebrow block mb-1.5">Where's your code?</label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(PROVIDERS) as ProviderId[]).map(id => {
                    const P = PROVIDERS[id];
                    const active = provider === id;
                    return (
                      <button key={id} type="button" onClick={() => pickProvider(id)}
                        className={`flex flex-row items-center justify-center gap-1.5 py-2 rounded-lg border transition-colors ${active ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
                        <P.Icon size={16} className={active ? 'text-accent-600' : 'text-slate-400'} />
                        <span className="text-2xs font-semibold">{P.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ==== 1) SAVED credentials — collapsed, count in header ==== */}
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <button type="button" onClick={() => setSavedTokOpen(o => !o)} className="w-full px-3 py-2.5 flex items-center gap-2 bg-slate-50 hover:bg-slate-100">
                  <KeyRound size={14} className="text-slate-500 shrink-0" />
                  <span className="text-xs font-bold text-slate-700">Saved credentials</span>
                  <span className="text-micro font-semibold rounded-full px-2 py-0.5 bg-slate-200 text-slate-600">{patTokens.length + apps.length}</span>
                  <ChevronDown size={16} className={`ml-auto text-slate-400 transition-transform ${savedTokOpen ? 'rotate-180' : ''}`} />
                </button>
                {savedTokOpen && (
                  <div className="p-3 space-y-2 border-t border-slate-100">
                    {patTokens.length === 0 && apps.length === 0 && <p className="text-xs text-slate-500">No credentials yet — connect GitHub or add a token below.</p>}
                    {/* PAT rows only — GitHub Apps render as their own card below (the app also
                        appears as a pseudo-token in Clone/Push pickers, but not duplicated here). */}
                    {patTokens.map(t => (
                      <div key={t.id} className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                        <KeyRound size={15} className={t.scope === 'readwrite' ? 'text-rose-500 shrink-0' : 'text-emerald-600 shrink-0'} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-800 truncate">{t.label}</span>
                            <span className={`text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border ${t.scope === 'readwrite' ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>{t.scope}</span>
                          </div>
                          <div className="text-2xs text-slate-500 font-mono break-all">{t.tokenMasked} · {t.host}</div>
                        </div>
                        {/* App pseudo-tokens can't be edited (minted on demand); their delete
                            disconnects the underlying app (removes this row + the app row). */}
                        {t.source !== 'github-app' && (
                          <button onClick={() => { editToken(t); setAddTokOpen(true); }} className="p-2 min-h-control min-w-control flex items-center justify-center text-slate-400 hover:text-accent-600 rounded-lg" aria-label="Edit"><Pencil size={15} /></button>
                        )}
                        <Tooltip label={t.source === 'github-app' ? 'Disconnect the GitHub App' : 'Delete token'}><button
                          onClick={() => t.source === 'github-app' ? deleteGithubApp(t.id.replace(/^app:/, '')) : deleteToken(t.id)}
                          className={iconBtnDanger}
                          aria-label={t.source === 'github-app' ? 'Disconnect app' : 'Delete'}
                        ><Trash2 size={15} /></button></Tooltip>
                      </div>
                    ))}
                    {/* connected GitHub apps (usable + manageable) */}
                    {apps.map(app => {
                      const badge = app.state === 'installed'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : app.state === 'created' ? 'bg-blue-50 border-blue-200 text-blue-700'
                        : 'bg-amber-50 border-amber-200 text-amber-700';
                      const installUrl = app.htmlUrl || (app.slug ? `https://github.com/apps/${app.slug}/installations/new` : null);
                      return (
                        <div key={app.id} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Github size={15} className="text-slate-700 shrink-0" />
                            {renamingId === app.id ? (
                              <>
                                <input
                                  autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') saveRename(app.id); if (e.key === 'Escape') setRenamingId(null); }}
                                  className={`${inputSm} h-8 py-1 text-sm flex-1 min-w-0`} placeholder="Label for this app" />
                                <button onClick={() => saveRename(app.id)} disabled={renameBusy} className="p-2 min-h-control min-w-control flex items-center justify-center text-emerald-600 hover:bg-emerald-50 rounded-lg" aria-label="Save label"><CheckCircle2 size={16} /></button>
                                <button onClick={() => setRenamingId(null)} className="p-2 min-h-control min-w-control flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg" aria-label="Cancel"><X size={16} /></button>
                              </>
                            ) : (
                              <>
                                <span className="text-sm font-bold text-slate-800 truncate">{app.name}</span>
                                <span className={`text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border ${badge}`}>{app.state}</span>
                                <Tooltip label="Rename / label this app"><button onClick={() => startRename(app.id, app.name || '')} className="ml-auto p-2 min-h-control min-w-control flex items-center justify-center text-slate-400 hover:text-accent-600 rounded-lg" aria-label="Rename app"><Pencil size={15} /></button></Tooltip>
                                <button onClick={() => deleteGithubApp(app.id)} className={iconBtnDanger} aria-label="Delete app"><Trash2 size={15} /></button>
                              </>
                            )}
                          </div>
                          <div className="text-2xs text-slate-500 font-mono break-all">
                            {app.slug ? `@${app.slug}` : ''}{app.account ? ` · ${app.account}` : ''}
                          </div>
                          {app.state === 'installed' ? (
                            <div className="text-2xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                              <CheckCircle2 size={13} className="shrink-0" /> Ready — select <strong>GitHub App: {app.name}</strong> as the token in Clone/Push.
                            </div>
                          ) : (
                            <div className="flex flex-col sm:flex-row gap-2">
                              {installUrl && (
                                <a href={installUrl} target="_blank" rel="noopener noreferrer" className={`${btnSm} text-xs px-3 shrink-0`}><ExternalLink size={13} /> Install on GitHub</a>
                              )}
                              <button onClick={() => detectInstallation(app.id)} disabled={detectingId === app.id} className={`${btnSm} text-xs px-3 shrink-0`}>
                                <Radar size={13} className={detectingId === app.id ? 'animate-spin' : ''} /> Detect installation
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ==== 2) CONNECT GitHub (App) — collapsed ==== */}
              {provider === 'github' ? (
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <button type="button" onClick={() => setConnectOpen(o => !o)} className="w-full px-3 py-2.5 bg-slate-900 hover:bg-slate-800 flex items-center gap-2 flex-wrap">
                  <Github size={16} className="text-white shrink-0" />
                  <span className="text-xs font-bold text-white">Connect GitHub (App)</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-white/10 text-slate-200 border border-white/10">recommended</span>
                  <ChevronDown size={16} className={`ml-auto text-slate-300 transition-transform ${connectOpen ? 'rotate-180' : ''}`} />
                </button>
                {connectOpen && (
                <div className="p-3 space-y-3 border-t border-slate-100">
                  <p className="text-2xs text-slate-500">
                    Install a GitHub App on your repos instead of pasting a token — scoped, revocable, and used automatically for Clone/Push. Once installed it appears as <strong>GitHub App: …</strong> in the token pickers.
                  </p>
                  <div className="text-2xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                    <KeyRound size={13} className="text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Sign into GitHub in this browser first.</strong> If you're logged out, GitHub shows a <strong>500 error</strong> instead of the create page.{' '}
                      <a href="https://github.com/login" target="_blank" rel="noopener noreferrer" className="font-bold underline whitespace-nowrap">Open GitHub login →</a>
                    </span>
                  </div>

                  {/* connect form */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="eyebrow block mb-1">App name (optional)</label>
                      <input value={appName} onChange={e => setAppName(e.target.value)} placeholder="ai-agents-git" className={inputSm} />
                    </div>
                    <div>
                      <label className="eyebrow block mb-1">Organization (blank = personal)</label>
                      <input value={appOrg} onChange={e => setAppOrg(e.target.value)} placeholder="my-org" className={inputSm} />
                    </div>
                  </div>
                  <div>
                    <label className="eyebrow block mb-1">Access</label>
                    <select value={appScope} onChange={e => setAppScope(e.target.value as any)} className={`${inputSm} appearance-none`}>
                      <option value="readonly">read (clone/fetch)</option>
                      <option value="readwrite">write (push)</option>
                    </select>
                  </div>
                  <div className="text-2xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <span className="font-bold text-slate-600">Will request:</span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(appScope === 'readonly'
                        ? ['Contents R', 'Metadata R', 'Pull requests R']
                        : ['Contents R/W', 'Administration R/W', 'Metadata R', 'Pull requests R/W', 'Workflows R/W']
                      ).map(p => (
                        <span key={p} className="text-micro font-semibold rounded px-1.5 py-0.5 bg-white border border-slate-200 text-slate-600">{p}</span>
                      ))}
                    </div>
                    {appScope === 'readonly' && (
                      <p className="mt-1.5 text-micro text-slate-500">Read-only can clone/pull but not push.</p>
                    )}
                  </div>
                  <button onClick={connectGithubApp} disabled={appBusy} className={`${btnPrimarySm} w-full`}>
                    {appBusy ? <span className="w-3 h-3 border-2 border-white/60 border-t-transparent rounded-full animate-spin" /> : <Github size={15} />} Connect GitHub
                  </button>

                  {/* instructions (shown once a connect has been started) */}
                  {connectStarted && (
                    <ol className="list-decimal pl-5 space-y-1 text-2xs text-accent-800 bg-accent-50 border border-accent-200 rounded-lg px-3 py-2.5">
                      <li>Saw a <strong>500 error</strong>? You're logged out — sign into GitHub, then click Connect again.</li>
                      <li>In the GitHub tab, click <strong>Create GitHub App</strong>.</li>
                      <li>Then <strong>Install</strong> it on the repos you want.</li>
                      <li>Come back here and click <strong>Detect installation</strong> below.</li>
                    </ol>
                  )}

                  {/* connect an existing app (manifest interrupted, or already have one) */}
                  <div className="border-t border-slate-100 pt-2">
                    <button type="button" onClick={() => setManualOpen(o => !o)} className="w-full flex items-center justify-between gap-2 text-2xs font-bold text-slate-500 hover:text-slate-700">
                      <span className="flex items-center gap-1.5"><KeyRound size={13} /> Already have a GitHub App? Connect it manually</span>
                      <ChevronDown size={14} className={`transition-transform shrink-0 ${manualOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {manualOpen && (
                      <div className="mt-2 space-y-2">
                        <p className="text-2xs text-slate-500">
                          On GitHub open the app → <strong>Settings</strong> → <strong>Generate a private key</strong> (downloads a <code>.pem</code>). Paste its <strong>App ID</strong> and the whole key below.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input value={manualAppId} onChange={e => setManualAppId(e.target.value)} inputMode="numeric" placeholder="App ID e.g. 123456" className={inputSm} />
                          <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="name (optional)" className={inputSm} />
                        </div>
                        <textarea value={manualKey} onChange={e => setManualKey(e.target.value)} rows={4}
                          placeholder={'-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----'}
                          className={`${inputSm} font-mono text-2xs resize-y`} autoComplete="off" spellCheck={false} />
                        <button onClick={connectManualApp} disabled={manualBusy || !manualAppId.trim() || !manualKey.trim()} className={`${btnSm} w-full`}>
                          {manualBusy ? <span className="w-3 h-3 border-2 border-slate-400/60 border-t-transparent rounded-full animate-spin" /> : <Plus size={14} />} Connect existing app
                        </button>
                        <p className="text-micro text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">The private key is a secret — stored locally, same as a PAT. Never shared.</p>
                      </div>
                    )}
                  </div>

                  {appMsg && (
                    <div className={`text-xs rounded-lg px-3 py-2 border break-words ${appMsg.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>{appMsg.text}</div>
                  )}
                </div>
                )}
              </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 flex items-start gap-2">
                  <ProviderIcon size={16} className="text-slate-400 shrink-0 mt-0.5" />
                  <p className="text-2xs text-slate-500">
                    One-click App connect is GitHub-only. For <strong>{activeProvider.label}</strong>, add a {activeProvider.credName.toLowerCase()} below — host and username are prefilled.
                  </p>
                </div>
              )}

              {/* ==== 3) ADD credential — collapsed (auto-opens while editing) ==== */}
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <button type="button" onClick={() => setAddTokOpen(o => !o)} className="w-full px-3 py-2.5 flex items-center gap-2 bg-slate-50 hover:bg-slate-100">
                  <Plus size={14} className="text-slate-500 shrink-0" />
                  <span className="text-xs font-bold text-slate-700">{editingId ? `Edit ${activeProvider.credName.toLowerCase()}` : `Add a ${activeProvider.credName.toLowerCase()}`}</span>
                  <ChevronDown size={16} className={`ml-auto text-slate-400 transition-transform ${(addTokOpen || editingId) ? 'rotate-180' : ''}`} />
                </button>
                {(addTokOpen || editingId) && (
                <div className="p-3 space-y-3 border-t border-slate-100">
                  {editingId && <div className="flex justify-end"><button onClick={resetTokenForm} className="text-2xs font-bold text-slate-500 hover:text-slate-800">+ new instead</button></div>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={tLabel} onChange={e => setTLabel(e.target.value)} placeholder="label e.g. agents-readonly" className={inputSm} />
                  <select value={tScope} onChange={e => setTScope(e.target.value as any)} className={`${inputSm} appearance-none`}>
                    <option value="readonly">readonly (clone/fetch)</option>
                    <option value="readwrite">readwrite (push)</option>
                  </select>
                </div>
                <div className="relative">
                  <input type={showToken ? 'text' : 'password'} value={tVal} onChange={e => setTVal(e.target.value)} placeholder={editingId ? 'paste to replace, blank keeps existing' : activeProvider.placeholder} autoComplete="off" className={`${inputSm} pr-12 font-mono`} />
                  <button type="button" onClick={() => setShowToken(s => !s)} className="absolute right-1 top-1/2 -translate-y-1/2 p-2 min-h-control min-w-control flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg" aria-label="toggle">{showToken ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={tUser} onChange={e => setTUser(e.target.value)} placeholder={activeProvider.user || 'username (optional)'} className={inputSm} />
                  <input value={tHost} onChange={e => setTHost(e.target.value)} placeholder={activeProvider.host} className={inputSm} />
                </div>
                {msgBox(tokMsg)}
                <div className="flex justify-end"><button onClick={saveToken} className={btnPrimarySm}><Plus size={15} /> {editingId ? 'Save' : 'Add token'}</button></div>
                </div>
                )}
              </div>

              {/* guide */}
              <div>
                <button onClick={() => setGuideOpen(o => !o)} className="w-full min-h-control flex items-center justify-between gap-2 text-left px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-2"><KeyRound className="w-4 h-4 text-accent-600" /> How to create a {activeProvider.label} {activeProvider.credName.toLowerCase()}</span>
                  <ChevronDown size={16} className={`text-slate-400 transition-transform shrink-0 ${guideOpen ? 'rotate-180' : ''}`} />
                </button>
                {guideOpen && (
                  <div className="mt-3 px-1 space-y-3 text-sm text-slate-600 leading-relaxed">
                    <ol className="list-decimal pl-5 space-y-2">
                      {activeProvider.guide.map((step, i) => <li key={i}>{step}</li>)}
                    </ol>
                    <div className="flex items-center gap-2 flex-wrap bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      <a href={activeProvider.tokenUrl} target="_blank" rel="noopener noreferrer" className="text-accent-600 font-mono text-xs break-all hover:underline">{activeProvider.tokenUrl}</a>
                      <button type="button" onClick={copyLink} aria-label="Copy" className="p-1.5 min-h-control min-w-control flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg">{copiedLink ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}</button>
                    </div>
                    <p className="text-2xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">A PAT is a password. Give agents a <strong>readonly</strong> token; keep your <strong>readwrite</strong> push token separate. Always set an expiry.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== AGENTS ===== */}
          {tab === 'agents' && (
            <div className="space-y-3">
              <p className="text-2xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">Each agent authenticates git with its assigned token. Set the <strong>Default</strong> to give one token to every agent, or override per agent. Give agents a <strong>readonly</strong> token.</p>
              {/* default (*) */}
              <div className="flex items-center gap-2 p-2.5 rounded-lg border border-accent-200 bg-accent-50/50">
                <Bot size={16} className="text-accent-600 shrink-0" />
                <span className="text-sm font-bold text-slate-800 flex-1 min-w-0">Default — all agents</span>
                <div className="w-[46%] max-w-[220px]">{tokenOptions(assignments['*'] || '', v => setAssign('*', v))}</div>
              </div>
              {agents.map(a => (
                <div key={a.role} className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200">
                  <Bot size={16} className="text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0"><div className="text-sm font-bold text-slate-800 truncate">{a.label || a.role}</div><div className="text-micro text-slate-500 uppercase tracking-wider">{a.role}</div></div>
                  <div className="w-[46%] max-w-[220px]">{tokenOptions(assignments[a.role] || '', v => setAssign(a.role, v))}</div>
                </div>
              ))}
              {agents.length === 0 && <p className="text-xs text-slate-500">No agents found.</p>}
              {msgBox(asgMsg)}
            </div>
          )}

          {/* ===== WORKTREES ===== */}
          {tab === 'worktrees' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-2xs text-slate-500">Isolated worktrees where agents build each task.</span>
                <button onClick={loadWorktrees} disabled={wtLoading} className={btnSm}><RefreshCw size={14} className={wtLoading ? 'animate-spin' : ''} /> Refresh</button>
              </div>
              {worktrees.length === 0 && !wtLoading && <p className="text-xs text-slate-500">No active agent worktrees.</p>}
              {worktrees.map(wt => (
                <div key={wt.path} className="p-3 rounded-lg border border-slate-200 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="eyebrow rounded px-1.5 py-0.5 bg-slate-100 border border-slate-200">{wt.isPlan ? 'PLAN' : 'DEV'}</span>
                    <span className="font-mono text-xs font-bold text-slate-800">{wt.branch || wt.name}</span>
                    {wt.merged ? <span className="text-[9px] font-bold uppercase rounded px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700">merged</span>
                      : <span className="text-[9px] font-bold uppercase rounded px-1.5 py-0.5 bg-amber-50 border border-amber-200 text-amber-700">unmerged</span>}
                  </div>
                  {wt.title && <div className="text-sm text-slate-700 break-words">{wt.title}</div>}
                  <div className="text-2xs text-slate-500 flex items-center gap-2 flex-wrap">
                    {wt.agent && <span className="inline-flex items-center gap-1"><Bot size={12} /> {wt.agent}</span>}
                    {wt.status && <span className="uppercase tracking-wider">{wt.status}{wt.stage ? ` · ${wt.stage}` : ''}</span>}
                  </div>
                  {wt.lastCommit?.subject && (
                    <div className="text-2xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5">
                      <span className="font-mono text-slate-700">{wt.lastCommit.sha}</span> {wt.lastCommit.subject}
                      <span className="text-slate-500"> — {wt.lastCommit.author}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => openWorktree(wt)} className={`${btnSm} text-xs px-3`}><FileDiff size={13} /> Changes</button>
                    <button onClick={() => historyForWorktree(wt)} className={`${btnSm} text-xs px-3`}><History size={13} /> History</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ===== HISTORY ===== */}
          {tab === 'history' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={repoPath} onChange={e => setRepoPath(e.target.value)} placeholder="repo/worktree path — blank = cwd" className={`${inputSm} font-mono text-xs`} />
                <input value={histRef} onChange={e => setHistRef(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadLog()} placeholder="branch/ref (optional)" className={`${inputSm} font-mono text-xs sm:max-w-[38%]`} />
                <button onClick={() => loadLog()} disabled={histLoading} className={`${btnSm} shrink-0`}><RefreshCw size={14} className={histLoading ? 'animate-spin' : ''} /> Log</button>
              </div>
              {histErr && <div className="text-xs bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-rose-700">{histErr}</div>}
              {commits.length === 0 && !histErr && !histLoading && <p className="text-xs text-slate-500">Load a repo to see who committed what.</p>}
              <div className="space-y-1.5">
                {commits.map(c => {
                  const open = openCommit === c.hash;
                  return (
                    <div key={c.hash}>
                      <button onClick={() => openCommitDetail(c.hash)} className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${open ? 'ring-2 ring-accent-300 ' : ''}${c.merge ? 'bg-ai-50 border-ai-200' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-2xs text-accent-600 font-semibold">{c.shortHash}</span>
                          {c.merge && <span className="text-[9px] font-bold uppercase rounded px-1.5 py-0.5 bg-ai-100 border border-ai-200 text-ai-700">merge</span>}
                          <span className="text-sm text-slate-800 break-words min-w-0 flex-1">{c.subject}</span>
                        </div>
                        <div className="text-micro text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 font-bold text-slate-600"><GitCommit size={11} /> {c.author}</span>
                          <span>{(c.date || '').slice(0, 16).replace('T', ' ')}</span>
                        </div>
                      </button>
                      {open && (
                        <div className="mt-1.5 mb-2 rounded-lg border border-slate-200 overflow-hidden">
                          {!showData ? <div className="px-3 py-3 text-xs text-slate-500">Loading…</div>
                            : showData.ok === false ? <div className="px-3 py-3 text-xs text-rose-600">Could not load commit.</div>
                            : (<>
                                <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-2xs text-slate-600">
                                  <span className="font-bold">{showData.author}</span> &lt;{showData.email}&gt; · {(showData.date || '').slice(0, 16).replace('T', ' ')}
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {(showData.files || []).map((f: any, i: number) => (
                                      <span key={i} className="font-mono text-micro rounded px-1.5 py-0.5 bg-white border border-slate-200 text-slate-600">{f.status} {f.path}</span>
                                    ))}
                                  </div>
                                </div>
                                <div className="bg-slate-900"><DiffView diff={showData.diff || ''} /></div>
                              </>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ===== CODE INDEX ===== */}
          {tab === 'index' && (
            <div className="space-y-3">
              <p className="text-2xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                The embedding DB is how agents <strong>read, understand & remember</strong> the codebase. Point it at the repo you're actually working on (e.g. a cloned repo) — not the host app. It self-heals if the DB is corrupted.
              </p>

              {idx && (
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2 flex-wrap">
                    <Database size={15} className="text-accent-600" />
                    <span className="text-xs font-bold text-slate-700">Active repo</span>
                    {idx.isDefault && <span className="text-[9px] font-bold uppercase rounded px-1.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-500">host default</span>}
                    <span className={`ml-auto text-[9px] font-bold uppercase rounded px-1.5 py-0.5 border ${idx.rebuilding ? 'bg-amber-50 border-amber-200 text-amber-700' : idx.healthy ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                      {idx.rebuilding ? 'remembering…' : idx.healthy ? 'healthy' : 'corrupt'}
                    </span>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="font-mono text-2xs text-slate-700 break-all">{idx.root}</div>
                    <div className="flex items-center gap-3 flex-wrap text-2xs text-slate-500">
                      <span><b className="text-slate-700">{idx.files}</b> files</span>
                      <span><b className="text-slate-700">{idx.nodes}</b> symbols</span>
                      <span><b className="text-slate-700">{idx.coverage}%</b> embedded</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={loadIndex} className={btnSm}><RefreshCw size={14} /> Refresh</button>
                <button onClick={rebuildIndex} disabled={idxBusy} className={btnPrimarySm}><HeartPulse size={15} /> Rebuild / Heal now</button>
              </div>

              <div className="p-3 rounded-lg border border-slate-200 space-y-2">
                <label className="eyebrow">Index a different repo</label>
                <input value={idxRoot} onChange={e => setIdxRoot(e.target.value)} placeholder="C:\code\some-cloned-repo — blank = host repo" className={`${inputSm} font-mono text-xs`} />
                <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                  <button onClick={() => retargetIndex('')} disabled={idxBusy} className={btnSm}>Reset to host</button>
                  <button onClick={() => retargetIndex(idxRoot.trim())} disabled={idxBusy} className={btnPrimarySm}><Database size={15} /> Index this repo</button>
                </div>
              </div>

              {/* Live indexing log — streams the db:build output while it reads the repo */}
              {indexLog.length > 0 && (
                <LogConsole title="Indexing" live={!!idx?.rebuilding} copyable fullscreenable searchable lines={indexLog} empty="…" />
              )}
              {msgBox(idxMsg)}
            </div>
          )}

        </div>
      </motion.div>
    </div>
  );
}

export default GitPanel;
