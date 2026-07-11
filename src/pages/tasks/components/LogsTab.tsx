import React, { useEffect, useState } from 'react';
import { Tooltip } from './Tooltip';
import { Terminal } from 'lucide-react';
import { LogConsole } from './LogConsole';
import { useConfirm } from './ConfirmProvider';
import { useToast } from './Toast';

/**
 * Logs tab — streams agent logs straight from .agent_logs/*.log files via the
 * db-server (tail-limited). Never touches SQLite. Lazy-loaded like Analytics.
 *
 * This tab owns only the agent-file SELECTION + polling; all log actions (search,
 * Date/Time, font size, history length, live, tail, copy) live in the shared LogConsole.
 */

interface LogFile { name: string; kind?: string; sizeKB: number; modified: string; now?: string; busy?: boolean }
interface LogLine { id: number; message: string }

import { API_BASE as API, withProject } from '../../../apiBase';

export default function LogsTab({ initialAgent }: { initialAgent?: string | null }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [files, setFiles] = useState<LogFile[] | null>(null);
  const [active, setActive] = useState<string | null>(initialAgent ?? null);
  const [lines, setLines] = useState<string[]>([]);
  const [live, setLive] = useState(true);
  const [tail, setTail] = useState(400);
  // Bare-agent-name → "role · taskId" for agents currently WORKING. The db-server keys its
  // busy map by the FULL claimedBy id ("host:pid:agent-1") but the log file is named by the
  // bare segment ("agent-1"), so its lookup misses and every chip reads "idle". We can't touch
  // the server, so we recompute working state here from /tasks and match on the bare tail.
  const [working, setWorking] = useState<Map<string, string>>(new Map());

  const loadWorking = React.useCallback(() => {
    fetch(withProject(`${API}/tasks`))
      .then(r => r.json())
      .then((tasks: any[]) => {
        const STAGE_ROLE: Record<string, string> = { plan: 'architect', build: 'dev', qa: 'qa', review: 'review', merge: 'merge' };
        const m = new Map<string, string>();
        for (const t of Array.isArray(tasks) ? tasks : []) {
          if (t.status === 'WORKING' && t.claimedBy) {
            const bare = String(t.claimedBy).split(':').pop() || String(t.claimedBy);
            const role = STAGE_ROLE[t.stage as string] || t.stage || 'working';
            m.set(bare, `${role} · ${t.id}`);
          }
        }
        setWorking(m);
      })
      .catch(() => { });
  }, []);

  /** Merge the server's chip data with the locally recomputed working set: a bare-name match
   *  promotes an "idle"-looking agent file to working (item 47). System/synthetic files keep
   *  their server-provided state. */
  const effState = (f: LogFile): { busy: boolean; now?: string } => {
    if (f.kind === 'system') return { busy: !!f.busy, now: f.now };
    if (f.busy) return { busy: true, now: f.now };
    const w = working.get(f.name);
    return w ? { busy: true, now: w } : { busy: false, now: f.now };
  };

  // List available agent log files
  const loadFiles = () => {
    fetch(withProject(`${API}/agent-log-files`))
      .then(r => r.json())
      .then(d => {
        const list: LogFile[] = d.files ?? [];
        setFiles(list);
        // Default selection: requested agent → first agent → first file.
        // `claimedBy` can be a host:pid:agent id (e.g. "Ali:14136:agent-1") while the log file is
        // named by the bare agent segment ("agent-1"), so match the tail too — otherwise a click
        // from the board never resolves to a file and silently lands on the wrong log.
        if (!active && list.length) {
          const bare = initialAgent ? (initialAgent.split(':').pop() || initialAgent) : null;
          const want = initialAgent
            ? (list.find(f => f.name === initialAgent) ?? (bare ? list.find(f => f.name === bare) : undefined))
            : undefined;
          setActive((want?.name) ?? list.find(f => f.kind === 'agent')?.name ?? list[0].name);
        }
      })
      .catch(() => setFiles([]));
  };
  useEffect(() => { loadFiles(); loadWorking(); }, []);

  /** Fetch the active log's contents once. Also used by Refresh (which must refetch the
   *  CONTENT, not just the file list) and after Clear. */
  const fetchLines = React.useCallback(() => {
    if (!active) return Promise.resolve();
    return fetch(withProject(`${API}/agent-logs/${encodeURIComponent(active)}?tail=${tail}`))
      .then(r => r.json())
      .then(d => setLines(Array.isArray(d) ? (d as LogLine[]).map(l => l.message) : []))
      .catch(() => { });
  }, [active, tail]);

  // Poll the active file (only while live and tab visible). Re-runs when the history
  // length (tail) changes so the console can pull more or fewer lines from the server.
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const poll = () => { if (!stop) { void fetchLines(); loadWorking(); } };
    poll();
    const iv = live ? setInterval(poll, 3000) : undefined;
    return () => { stop = true; if (iv) clearInterval(iv); };
  }, [active, live, tail, fetchLines, loadWorking]);

  /** Truncate the log server-side. Disposable by design: durable per-task history lives in
   *  logs.db, so this only clears the tailed .log file. */
  const clearLog = async () => {
    if (!active) return;
    // Capture the size before truncating so the toast can report what was cleared. A true
    // undo isn't possible (the .log is truncated on disk), but the durable per-task history
    // in logs.db is untouched — the toast says so, so a mis-click isn't alarming.
    const clearedKB = files?.find(f => f.name === active)?.sizeKB ?? 0;
    const ok = await confirm({
      title: 'Clear this log?',
      message: `Empties ${active}.log. The durable per-task history in logs.db is untouched.`,
      confirmLabel: 'Clear',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await fetch(withProject(`${API}/agent-logs/${encodeURIComponent(active)}`), { method: 'DELETE' });
      setLines([]);
      await fetchLines();
      loadFiles();
      toast.success(
        'Log cleared',
        clearedKB > 0
          ? `Freed ${clearedKB} KB from ${active}.log — durable history in logs.db is untouched.`
          : `${active}.log was already empty.`,
      );
    } catch (e: any) { toast.error('Could not clear log', e?.message); }
  };

  const chips = files === null ? (
    <span className="text-xs text-slate-500">Loading log files…</span>
  ) : files.length === 0 ? (
    <span className="text-xs text-slate-500">No agent logs yet. They show up here once an agent starts working.</span>
  ) : (
    <div className="flex items-center gap-2 flex-wrap">
      {files.map(f => {
        const s = effState(f);
        return (
        <Tooltip key={f.name} label={s.busy ? `working: ${s.now}` : `idle · ${f.sizeKB} KB · updated ${new Date(f.modified).toLocaleTimeString()}`}><button
          onClick={() => setActive(f.name)}
          data-feature-id="logs-agent-chip"
          className={`flex items-center gap-1.5 px-3 min-h-control text-xs font-bold font-mono rounded-lg border transition-colors ${active === f.name
            ? 'bg-slate-800 text-emerald-300 border-slate-700'
            : f.kind === 'system'
              ? 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              : `bg-white text-slate-700 border-slate-300 hover:bg-slate-50 ${!s.busy && active !== f.name ? 'opacity-50' : ''}`}`}
        >
          {f.kind === 'system'
            ? <Terminal size={12} />
            : <span className={`w-1.5 h-1.5 rounded-full ${s.busy ? 'bg-emerald-500' : 'bg-slate-300'}`} />}
          {f.kind === 'system'
            ? (f.name === '__clone__' ? 'clone' : f.name === '__index__' ? 'index' : 'orchestrator')
            : (s.busy && s.now ? s.now.split(' · ')[0] : f.name)}
          {f.kind === 'system'
            ? ((f.name === '__clone__' || f.name === '__index__')
                ? <span className="text-micro opacity-60 normal-case">{f.now}</span>
                : <span className="text-micro opacity-60">{f.sizeKB}KB</span>)
            : s.busy && s.now
              ? <span className="text-micro font-sans font-semibold text-accent-500 normal-case">{f.name} · {s.now.split(' · ')[1]}</span>
              : <span className="text-micro opacity-60 normal-case">idle</span>}
        </button></Tooltip>
        );
      })}
    </div>
  );

  // A file with bytes on disk but no lines in view means the tail held only non-printable
  // content (blank lines / control chars) — say so with the size, rather than the bare and
  // contradictory "Log is empty" next to a non-zero KB chip (item 48).
  const activeFile = files?.find(f => f.name === active) ?? null;
  const emptyMsg = !active
    ? 'Select an agent log above.'
    : activeFile && activeFile.sizeKB > 0
      ? `No printable lines — ${activeFile.sizeKB} KB on disk.`
      : 'Log is empty.';

  return (
    <div className="p-3 sm:p-4 h-full flex flex-col" data-feature-id="tasks-logs-tab">
      <LogConsole
        lines={active ? lines : []}
        parsed
        fill
        live={live}
        onLiveChange={setLive}
        toolbarLeft={chips}
        searchable
        searchNav
        wrapControl
        jumpToBottom
        timeToggle
        sizeControls
        historyControl
        defaultHistory={tail}
        onHistoryLengthChange={setTail}
        liveControl
        tailControl
        copyable
        controlsKey="agent-logs"
        onRefresh={() => { void fetchLines(); loadFiles(); loadWorking(); }}
        onClear={active ? clearLog : undefined}
        empty={emptyMsg}
        footer={<>Source: .agent_logs/*.log files (last {tail} lines, tailed every 3s while Live) — SQLite is never touched by this tab.</>}
      />
    </div>
  );
}
