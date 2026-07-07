import React, { useEffect, useRef, useState } from 'react';
import { Terminal, RefreshCw, Pause, Play, FileText, Copy, Check, ArrowDownToLine, Clock } from 'lucide-react';

/**
 * Logs tab — streams agent logs straight from .agent_logs/*.log files via the
 * db-server (tail-limited). Never touches SQLite. Lazy-loaded like Analytics.
 */

interface LogFile { name: string; kind?: string; sizeKB: number; modified: string; now?: string; busy?: boolean }
interface LogLine { id: number; message: string }

import { API_BASE as API } from '../../../apiBase';
const TAIL = 400;

export default function LogsTab({ initialAgent }: { initialAgent?: string | null }) {
  const [files, setFiles] = useState<LogFile[] | null>(null);
  const [active, setActive] = useState<string | null>(initialAgent ?? null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(13);
  const [showTime, setShowTime] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<number>>(new Set());
  const toggleGroup = (id: number) => setOpenGroups(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false); // no tailing by default
  const autoScrollRef = useRef(false);
  const toggleTail = () => {
    const v = !autoScroll; setAutoScroll(v); autoScrollRef.current = v;
    if (v && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  };

  // List available agent log files
  const loadFiles = () => {
    fetch(`${API}/agent-log-files`)
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

  // Poll the active file (only while live and tab visible)
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const poll = () => {
      fetch(`${API}/agent-logs/${encodeURIComponent(active)}?tail=${TAIL}`)
        .then(r => r.json())
        .then(d => {
          if (stop) return;
          setLines(Array.isArray(d) ? d : []);
          if (autoScrollRef.current) requestAnimationFrame(() => {
            if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
          });
        })
        .catch(() => { });
    };
    poll();
    const iv = live ? setInterval(poll, 3000) : undefined;
    return () => { stop = true; if (iv) clearInterval(iv); };
  }, [active, live]);

  const shown = filter
    ? lines.filter(l => l.message.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  const PREFIX: Record<string, { tag: string; color: string; noise?: boolean }> = {
    search: { tag: 'srch', color: 'text-sky-400', noise: true },
    read: { tag: 'read', color: 'text-slate-400', noise: true },
    toolsearch: { tag: 'tool', color: 'text-slate-400', noise: true },
    write: { tag: 'edit', color: 'text-emerald-400' },
    edit: { tag: 'edit', color: 'text-emerald-400' },
    subagent: { tag: 'sub', color: 'text-fuchsia-400' },
    fetch: { tag: 'net', color: 'text-sky-400' },
    spawned: { tag: 'run', color: 'text-slate-500' },
  };
  const parse = (msg: string) => {
    // Peel off the per-line [HH:MM:SS] stamp so the action parsing below is unaffected.
    const tm = msg.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/);
    const time = tm ? tm[1] : '';
    const s = tm ? msg.slice(tm[0].length) : msg;
    if (/^──/.test(s)) return { type: 'divider' as const, tag: '', color: 'text-slate-500', text: s.replace(/─+/g, '').trim(), noise: false, time };
    if (/error|failed|fatal|❌|🚨/i.test(s)) return { type: 'line' as const, tag: '!', color: 'text-rose-400', text: s, noise: false, time };
    if (s.startsWith('$')) return { type: 'line' as const, tag: '$', color: 'text-violet-400', text: s.replace(/^\$:?\s*/, ''), noise: false, time };
    if (s.startsWith('·') || s.startsWith('—')) return { type: 'msg' as const, tag: 'ai', color: 'text-indigo-300', text: s.replace(/^[·—]\s*/, ''), noise: false, time };
    const m = s.match(/^(\w+):\s*(.*)/);
    if (m && PREFIX[m[1].toLowerCase()]) { const p = PREFIX[m[1].toLowerCase()]; return { type: 'line' as const, tag: p.tag, color: p.color, text: m[2], noise: !!p.noise, time }; }
    return { type: 'line' as const, tag: '', color: 'text-slate-300', text: s, noise: false, time };
  };
  const renderRow = (l: LogLine) => {
    const p = parse(l.message);
    if (p.type === 'divider') return <div key={l.id} className="mt-2 mb-1 border-t border-slate-700/70 pt-1 text-[0.8em] text-slate-500 uppercase tracking-widest">{p.text}</div>;
    return (
      <div key={l.id} className={`flex gap-2 whitespace-pre-wrap break-words py-0.5 ${p.type === 'msg' ? 'italic' : ''}`}>
        {showTime && p.time && <span className="shrink-0 text-[0.75em] text-slate-600 pt-0.5 font-mono tabular-nums select-none">{p.time}</span>}
        {p.tag && <span className={`shrink-0 font-bold uppercase text-[0.8em] w-9 pt-0.5 ${p.color}`}>{p.tag}</span>}
        <span className={p.color}>{p.text}</span>
      </div>
    );
  };

  return (
    <div className="p-3 sm:p-4 space-y-3 h-[calc(100dvh-170px)] flex flex-col" data-feature-id="tasks-logs-tab">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {files === null ? (
          <span className="text-xs text-slate-500">Loading log files…</span>
        ) : files.length === 0 ? (
          <span className="text-xs text-slate-500">No agent log files yet — they appear in .agent_logs/ when headless agents run.</span>
        ) : (
          files.map(f => (
            <button
              key={f.name}
              onClick={() => setActive(f.name)}
              data-feature-id="logs-agent-chip"
              className={`flex items-center gap-1.5 px-3 min-h-[38px] text-xs font-bold font-mono rounded-lg border transition-colors ${active === f.name
                ? 'bg-slate-800 text-emerald-300 border-slate-700'
                : f.kind === 'system'
                  ? 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  : `bg-white text-slate-700 border-slate-300 hover:bg-slate-50 ${!f.busy && active !== f.name ? 'opacity-50' : ''}`}`}
              title={f.busy ? `working: ${f.now}` : `idle · ${f.sizeKB} KB · updated ${new Date(f.modified).toLocaleTimeString()}`}
            >
              {f.kind === 'system'
                ? <Terminal size={12} />
                : <span className={`w-1.5 h-1.5 rounded-full ${f.busy ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />}
              {f.kind === 'system'
                ? 'orchestrator'
                : (f.busy && f.now ? f.now.split(' · ')[0] : f.name)}
              {f.kind === 'system'
                ? <span className="text-[10px] opacity-60">{f.sizeKB}KB</span>
                : f.busy && f.now
                  ? <span className="text-[10px] font-sans font-semibold text-indigo-500 normal-case">{f.name} · {f.now.split(' · ')[1]}</span>
                  : <span className="text-[10px] opacity-60 normal-case">idle</span>}
            </button>
          ))
        )}

        <div className="flex items-center gap-2 ml-auto">
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter lines…"
            data-feature-id="logs-filter"
            className="px-3 min-h-[38px] text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-indigo-500 placeholder:text-slate-400 w-40"
          />
          <button
            onClick={() => setLive(v => !v)}
            data-feature-id="logs-live-toggle"
            className={`flex items-center gap-1.5 px-3 min-h-[38px] text-xs font-bold rounded-lg border transition-colors ${live
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
              : 'bg-white text-slate-600 border-slate-300'}`}
            title={live ? 'Live tail on (3s)' : 'Paused'}
          >
            {live ? <><Pause size={12} /> Live</> : <><Play size={12} /> Paused</>}
          </button>
          <button
            onClick={toggleTail}
            data-feature-id="logs-tail-toggle"
            className={`flex items-center gap-1.5 px-3 min-h-[38px] text-xs font-bold rounded-lg border transition-colors ${autoScroll ? 'bg-indigo-50 text-indigo-700 border-indigo-300' : 'bg-white text-slate-600 border-slate-300'}`}
            title={autoScroll ? 'Auto-scroll ON — following the tail' : 'Auto-scroll OFF — scroll stays where you are'}
          >
            <ArrowDownToLine size={13} /> Tail
          </button>
          <button
            onClick={() => setShowTime(v => !v)}
            data-feature-id="logs-time-toggle"
            className={`flex items-center gap-1.5 px-3 min-h-[38px] text-xs font-bold rounded-lg border transition-colors ${showTime ? 'bg-indigo-50 text-indigo-700 border-indigo-300' : 'bg-white text-slate-600 border-slate-300'}`}
            title={showTime ? 'Per-line timestamps shown' : 'Per-line timestamps hidden'}
          >
            <Clock size={13} /> Time
          </button>
          <div className="flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden" title="Font size">
            <button onClick={() => setFontSize(s => Math.max(10, s - 1))} className="px-2.5 min-h-[38px] text-sm font-bold text-slate-600 hover:bg-slate-50">A−</button>
            <span className="px-1 text-[10px] text-slate-400 font-mono select-none">{fontSize}</span>
            <button onClick={() => setFontSize(s => Math.min(22, s + 1))} className="px-2.5 min-h-[38px] text-base font-bold text-slate-600 hover:bg-slate-50">A+</button>
          </div>
          <button
            onClick={() => {
              const text = shown.map(l => l.message).join('\n');
              const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
              // navigator.clipboard needs a secure context (HTTPS/localhost). Over plain
              // HTTP (a bare-IP VPS) it's undefined, so fall back to the execCommand hack.
              const fallback = () => {
                try {
                  const ta = document.createElement('textarea');
                  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                  document.body.appendChild(ta); ta.focus(); ta.select();
                  document.execCommand('copy'); document.body.removeChild(ta); done();
                } catch { /* give up */ }
              };
              if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback);
              else fallback();
            }}
            className="flex items-center gap-1.5 px-3 min-h-[38px] text-xs font-bold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            title="Copy the visible log to clipboard"
          >
            {copied ? <><Check size={13} className="text-emerald-600" /> Copied</> : <><Copy size={13} /> Copy</>}
          </button>
          <button
            onClick={loadFiles}
            className="flex items-center justify-center min-w-[38px] min-h-[38px] text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            title="Refresh file list"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Terminal viewport — dark on purpose; it's a terminal */}
      <div
        ref={bodyRef}
        className="flex-1 bg-[#0d1117] border border-slate-300 rounded-xl p-4 overflow-y-auto custom-scrollbar font-mono leading-relaxed"
        style={{ fontSize }}
      >
        {!active ? (
          <p className="text-slate-500 flex items-center gap-2"><Terminal size={14} /> Select an agent log above.</p>
        ) : shown.length === 0 ? (
          <p className="text-slate-500">{filter ? 'No lines match the filter.' : 'Log is empty.'}</p>
        ) : (() => {
          const blocks: Array<{ g: LogLine[] } | { l: LogLine }> = [];
          let grp: LogLine[] = [];
          for (const l of shown) {
            if (parse(l.message).noise) grp.push(l);
            else { if (grp.length) { blocks.push({ g: grp }); grp = []; } blocks.push({ l }); }
          }
          if (grp.length) blocks.push({ g: grp });
          return blocks.map(b => 'g' in b
            ? (b.g.length > 1
              ? <div key={`g${b.g[0].id}`}>
                  <button onClick={() => toggleGroup(b.g[0].id)} className="text-slate-500 hover:text-slate-300 flex items-center gap-1.5 py-0.5 italic">
                    <span className="w-3">{openGroups.has(b.g[0].id) ? '▾' : '▸'}</span> {b.g.length} context reads &amp; searches
                  </button>
                  {openGroups.has(b.g[0].id) && <div className="pl-3 border-l border-slate-800 ml-1.5">{b.g.map(renderRow)}</div>}
                </div>
              : renderRow(b.g[0]))
            : renderRow(b.l));
        })()}
      </div>
      <p className="text-[11px] text-slate-500 shrink-0">
        Source: .agent_logs/*.log files (last {TAIL} lines, tailed every 3s while Live) — SQLite is never touched by this tab.
      </p>
    </div>
  );
}
