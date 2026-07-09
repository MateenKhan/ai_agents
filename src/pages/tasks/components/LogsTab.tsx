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

  // List available agent log files
  const loadFiles = () => {
    fetch(withProject(`${API}/agent-log-files`))
      .then(r => r.json())
      .then(d => {
        const list: LogFile[] = d.files ?? [];
        setFiles(list);
        // Default selection: requested agent → first agent → first file
        if (!active && list.length) {
          const want = initialAgent && list.find(f => f.name === initialAgent);
          setActive((want?.name) ?? list.find(f => f.kind === 'agent')?.name ?? list[0].name);
        }
      })
      .catch(() => setFiles([]));
  };
  useEffect(loadFiles, []);

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
    const poll = () => { if (!stop) void fetchLines(); };
    poll();
    const iv = live ? setInterval(poll, 3000) : undefined;
    return () => { stop = true; if (iv) clearInterval(iv); };
  }, [active, live, tail, fetchLines]);

  /** Truncate the log server-side. Disposable by design: durable per-task history lives in
   *  logs.db, so this only clears the tailed .log file. */
  const clearLog = async () => {
    if (!active) return;
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
      toast.success('Log cleared', `${active}.log`);
    } catch (e: any) { toast.error('Could not clear log', e?.message); }
  };

  const chips = files === null ? (
    <span className="text-xs text-slate-500">Loading log files…</span>
  ) : files.length === 0 ? (
    <span className="text-xs text-slate-500">No agent logs yet. They show up here once an agent starts working.</span>
  ) : (
    <div className="flex items-center gap-2 flex-wrap">
      {files.map(f => (
        <Tooltip label={f.busy ? `working: ${f.now}` : `idle · ${f.sizeKB} KB · updated ${new Date(f.modified).toLocaleTimeString()}`}><button
          key={f.name}
          onClick={() => setActive(f.name)}
          data-feature-id="logs-agent-chip"
          className={`flex items-center gap-1.5 px-3 min-h-control text-xs font-bold font-mono rounded-lg border transition-colors ${active === f.name
            ? 'bg-slate-800 text-emerald-300 border-slate-700'
            : f.kind === 'system'
              ? 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              : `bg-white text-slate-700 border-slate-300 hover:bg-slate-50 ${!f.busy && active !== f.name ? 'opacity-50' : ''}`}`}
        >
          {f.kind === 'system'
            ? <Terminal size={12} />
            : <span className={`w-1.5 h-1.5 rounded-full ${f.busy ? 'bg-emerald-500' : 'bg-slate-300'}`} />}
          {f.kind === 'system'
            ? (f.name === '__clone__' ? 'clone' : f.name === '__index__' ? 'index' : 'orchestrator')
            : (f.busy && f.now ? f.now.split(' · ')[0] : f.name)}
          {f.kind === 'system'
            ? ((f.name === '__clone__' || f.name === '__index__')
                ? <span className="text-[10px] opacity-60 normal-case">{f.now}</span>
                : <span className="text-[10px] opacity-60">{f.sizeKB}KB</span>)
            : f.busy && f.now
              ? <span className="text-[10px] font-sans font-semibold text-accent-500 normal-case">{f.name} · {f.now.split(' · ')[1]}</span>
              : <span className="text-[10px] opacity-60 normal-case">idle</span>}
        </button></Tooltip>
      ))}
    </div>
  );

  return (
    <div className="p-3 sm:p-4 h-[calc(100dvh-170px)] flex flex-col" data-feature-id="tasks-logs-tab">
      <LogConsole
        lines={active ? lines : []}
        parsed
        fill
        live={live}
        onLiveChange={setLive}
        toolbarLeft={chips}
        searchable
        timeToggle
        sizeControls
        historyControl
        defaultHistory={tail}
        onHistoryLengthChange={setTail}
        liveControl
        tailControl
        copyable
        controlsKey="agent-logs"
        onRefresh={() => { void fetchLines(); loadFiles(); }}
        onClear={active ? clearLog : undefined}
        empty={active ? 'Log is empty.' : 'Select an agent log above.'}
        footer={<>Source: .agent_logs/*.log files (last {tail} lines, tailed every 3s while Live) — SQLite is never touched by this tab.</>}
      />
    </div>
  );
}
