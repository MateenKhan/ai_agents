import React, { useEffect, useState } from 'react';
import { GitBranch, FolderPlus, FolderGit2, Cpu, ShieldAlert, ArrowRight } from 'lucide-react';
import { API_BASE, withProject } from '../../../apiBase';
import { useProjects } from '../projectContext';

/** localStorage flag: the first-run setup was completed (or explicitly skipped). */
export const SETUP_DONE_KEY = 'piranha:setup-done';

type Mode = 'clone' | 'new';

/**
 * First-run starting screen. The project source is the root decision every task and agent
 * depends on, so before the board is ever shown the user picks one of:
 *   1. Clone an existing repository  (POST /git/clone — creates + activates a project)
 *   2. Start in a new folder         (POST /git/init-repo — mkdir + git init + project)
 *   3. Use this folder as-is         (the "I launched Piranha inside my repo" escape hatch)
 * Workspace settings (max agents, agent safety) live on the same screen so the essential
 * knobs are owned before the first agent ever runs.
 */
export function StartScreen({ onDone }: { onDone: () => void }) {
  const { refreshProjects, setActiveId } = useProjects();
  const [mode, setMode] = useState<Mode>('clone');

  // Clone form
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  // New-folder form
  const [dir, setDir] = useState('');
  const [name, setName] = useState('');

  // Workspace settings (global agent defaults — same contract as SettingsModal)
  const [maxConc, setMaxConc] = useState('0');
  const [profile, setProfile] = useState<'strict' | 'standard' | 'dangerous'>('standard');
  const [taskCap, setTaskCap] = useState('2');
  const [dailyCap, setDailyCap] = useState('25');
  useEffect(() => {
    fetch(`${API_BASE}/agent-defaults`).then(r => r.json())
      .then(d => {
        setMaxConc(d?.maxConcurrency ? String(d.maxConcurrency) : '0');
        setProfile(d?.permissionProfile || 'standard');
        setTaskCap(d?.taskCapUsd != null ? String(d.taskCapUsd) : '2');
        setDailyCap(d?.dailyCapUsd != null ? String(d.dailyCapUsd) : '25');
      })
      .catch(() => { /* offline — keep defaults */ });
  }, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const saveSettings = async () => {
    try {
      await fetch(`${API_BASE}/agent-defaults`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxConcurrency: Math.max(0, Math.floor(Number(maxConc) || 0)),
          permissionProfile: profile,
          taskCapUsd: Number(taskCap) || 0,
          dailyCapUsd: Number(dailyCap) || 0,
        }),
      });
    } catch { /* best-effort — Settings can fix it later */ }
  };

  const finish = async () => {
    await saveSettings();
    try { localStorage.setItem(SETUP_DONE_KEY, '1'); } catch { /* private mode */ }
    onDone();
  };

  const doClone = async () => {
    const cleanUrl = url.trim();
    if (!cleanUrl || busy) return;
    setBusy(true); setError(null); setLog([]);
    // Poll live git output while the clone runs, same as the Git panel's Clone tab.
    const poll = setInterval(async () => {
      try {
        const p = await fetch(withProject(`${API_BASE}/git/clone-progress`)).then(r => r.json());
        if (Array.isArray(p.lines)) setLog(p.lines);
      } catch { /* transient */ }
    }, 500);
    try {
      // Relative dir resolves server-side into the projects base — derive it from the URL.
      const derivedDir = (cleanUrl.split('/').pop() || 'repo').replace(/\.git$/, '');
      const r = await fetch(withProject(`${API_BASE}/git/clone`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl, dir: derivedDir, branch: branch.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Clone failed');
      await refreshProjects();
      if (d.project?.id) setActiveId(d.project.id);
      // Kick the code index so agents can search the fresh clone. Fire-and-forget.
      fetch(withProject(`${API_BASE}/code-index/root`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: d.dir }),
      }).catch(() => {});
      await finish();
    } catch (e: any) {
      setError(e?.message || 'Clone failed');
    } finally {
      clearInterval(poll);
      setBusy(false);
    }
  };

  const doInit = async () => {
    const cleanDir = dir.trim();
    const cleanName = name.trim() || (cleanDir.replace(/[\\/]+$/, '').split(/[\\/]+/).pop() || '');
    if (!cleanDir || !cleanName || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`${API_BASE}/git/init-repo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: cleanDir, name: cleanName }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Could not create the folder');
      await refreshProjects();
      if (d.project?.id) setActiveId(d.project.id);
      await finish();
    } catch (e: any) {
      setError(e?.message || 'Could not create the folder');
    } finally {
      setBusy(false);
    }
  };

  const modeCard = (m: Mode, icon: React.ReactNode, title: string, caption: string) => (
    <button
      type="button"
      onClick={() => { setMode(m); setError(null); }}
      aria-pressed={mode === m}
      data-feature-id={`start-mode-${m}`}
      className={`flex-1 flex items-start gap-3 text-left px-4 py-3.5 rounded-xl border transition-colors ${
        mode === m ? 'border-accent-500 bg-accent-50/60 shadow-sm' : 'border-slate-200 bg-white sm:hover:border-slate-300 sm:hover:bg-slate-50'
      }`}
    >
      <span className={`mt-0.5 shrink-0 ${mode === m ? 'text-accent-600' : 'text-slate-400'}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-900">{title}</span>
        <span className="block text-2xs text-slate-500 mt-0.5 leading-relaxed">{caption}</span>
      </span>
    </button>
  );

  const input = 'w-full bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-3 text-sm text-slate-900 focus:outline-none focus:border-accent-500 transition-colors';

  return (
    <div className="h-dvh overflow-y-auto bg-slate-100 text-slate-800" data-feature-id="start-screen">
      <div className="max-w-xl mx-auto px-4 py-10 sm:py-14">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-2" aria-hidden="true">🦈</div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Welcome to Piranha</h1>
          <p className="text-sm text-slate-500 mt-1.5">
            Agents plan, build and QA your backlog — nothing merges without your click.
            <br />First: where does the code live?
          </p>
        </div>

        {/* Step 1 — project source */}
        <div className="bg-white border border-slate-300 rounded-xl p-4 sm:p-5 space-y-4">
          <h2 className="eyebrow">1 · Project source</h2>
          <div className="flex flex-col sm:flex-row gap-2.5">
            {modeCard('clone', <GitBranch size={18} />, 'Clone a repository', 'Work on an existing repo from GitHub or any git URL.')}
            {modeCard('new', <FolderPlus size={18} />, 'Start in a new folder', 'A fresh folder — Piranha creates it and runs git init.')}
          </div>

          {mode === 'clone' ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="eyebrow">Repository URL</label>
                <input autoFocus type="text" value={url} onChange={e => setUrl(e.target.value)} disabled={busy}
                  className={input} placeholder="https://github.com/you/your-repo.git" />
              </div>
              <div className="space-y-1.5">
                <label className="eyebrow">Branch <span className="normal-case font-normal text-slate-400">(optional)</span></label>
                <input type="text" value={branch} onChange={e => setBranch(e.target.value)} disabled={busy}
                  className={input} placeholder="default branch" />
              </div>
              <p className="text-micro text-slate-500">
                Private repo? Finish setup with a public one (or the new-folder option) and add a token under
                Git → Tokens — cloning private repos needs it.
              </p>
              {log.length > 0 && (
                <pre className="max-h-36 overflow-y-auto text-2xs font-mono bg-slate-900 text-slate-200 rounded-lg px-3 py-2 whitespace-pre-wrap">{log.join('\n')}</pre>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="eyebrow">Folder path</label>
                <input autoFocus type="text" value={dir} onChange={e => setDir(e.target.value)} disabled={busy}
                  className={`${input} font-mono`} placeholder="C:\code\my-app  ·  or relative: my-app" />
              </div>
              <div className="space-y-1.5">
                <label className="eyebrow">Project name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={busy}
                  className={input} placeholder="My App" />
              </div>
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>
          )}
        </div>

        {/* Step 2 — workspace settings */}
        <div className="bg-white border border-slate-300 rounded-xl p-4 sm:p-5 space-y-3 mt-4">
          <h2 className="eyebrow">2 · Workspace settings</h2>
          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Cpu size={15} className="text-slate-500" /> Max concurrent agents
            </span>
            <span className="flex items-center gap-2">
              <span className={`text-2xs font-semibold ${(Number(maxConc) || 0) === 0 ? 'text-emerald-600' : 'text-transparent select-none'}`}>unlimited</span>
              <input type="text" inputMode="numeric" value={maxConc}
                onChange={e => setMaxConc(e.target.value.replace(/[^\d]/g, ''))}
                className="w-20 px-2 py-1.5 text-sm text-right font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500" />
            </span>
          </label>
          <label className={`flex items-center justify-between gap-3 px-3 py-3 rounded-lg border transition-colors ${profile === 'dangerous' ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
            <span className="flex items-start gap-2.5 min-w-0">
              <ShieldAlert size={16} className={`mt-0.5 shrink-0 ${profile === 'dangerous' ? 'text-rose-600' : 'text-slate-400'}`} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">
                  Permission Profile
                  {profile === 'dangerous' && <span className="ml-2 align-middle text-micro font-bold uppercase tracking-wider text-rose-700">Dangerous</span>}
                </span>
                <span className="block text-2xs text-slate-600 mt-1 leading-relaxed">
                  Controls the sandbox strictness for headless agents.
                </span>
              </span>
            </span>
            <select
              value={profile}
              onChange={e => setProfile(e.target.value as 'strict' | 'standard' | 'dangerous')}
              className="px-2 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500 cursor-pointer"
            >
              <option value="strict">Strict</option>
              <option value="standard">Standard (Default)</option>
              <option value="dangerous">Dangerous</option>
            </select>
          </label>
        </div>

        {/* Actions */}
        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={finish}
            disabled={busy}
            data-feature-id="start-use-this-folder"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-500 sm:hover:text-slate-800 transition-colors disabled:opacity-50"
          >
            <FolderGit2 size={14} /> Skip — use the folder Piranha started in
          </button>
          <button
            type="button"
            onClick={mode === 'clone' ? doClone : doInit}
            disabled={busy || (mode === 'clone' ? !url.trim() : !dir.trim())}
            data-feature-id="start-continue"
            className="flex items-center gap-2 px-6 min-h-control-lg bg-slate-900 active:bg-slate-950 sm:hover:bg-slate-800 text-white text-sm font-bold rounded-xl shadow-lg shadow-accent-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy && <span className="w-3.5 h-3.5 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />}
            {busy ? (mode === 'clone' ? 'Cloning…' : 'Creating…') : 'Continue'}
            {!busy && <ArrowRight size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default StartScreen;
