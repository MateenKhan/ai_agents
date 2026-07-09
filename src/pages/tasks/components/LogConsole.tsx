import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tooltip } from './Tooltip';
import { RefreshCw, Pause, Play, Copy, Check, ArrowDownToLine, Clock, Trash2 } from 'lucide-react';

/**
 * LogConsole — the ONE log/terminal component used everywhere in the app.
 *
 * A single dark, monospace, auto-scrolling console with an opt-in toolbar of log
 * actions: search, Date/Time toggle, font size, history length, live pause/resume,
 * tail (auto-scroll), and copy. Rich rendering (severity colors, action tags, and
 * collapsible "context reads & searches" noise groups) is applied when `parsed`.
 *
 * Callers pass raw log content as `lines` (preferred) or `text`; the console owns all
 * VIEW state (filter/time/size/tail/history). Data-fetching stays with the parent —
 * for server-backed history, pass `onHistoryLengthChange` and refetch with the new N.
 *
 * Replaces the former LogView + the bespoke viewers in LogsTab / TerminalMonitor so
 * every log surface looks and behaves identically.
 */

export interface LogConsoleProps {
  // ── data (one of) ──
  lines?: string[];
  text?: string;

  // ── header ──
  title?: string;
  /** Green dot in the header (a stream is live). Still, not pulsing: steady state, no motion. */
  live?: boolean;
  /** Optional note rendered under the console body (e.g. the log source line). */
  footer?: React.ReactNode;
  /** Extra controls slotted at the LEFT of the toolbar (e.g. agent-file chips). */
  toolbarLeft?: React.ReactNode;

  // ── toolbar features (opt-in; compact callers omit them) ──
  searchable?: boolean;
  timeToggle?: boolean;
  sizeControls?: boolean;
  historyControl?: boolean;
  liveControl?: boolean;
  tailControl?: boolean;
  copyable?: boolean;
  onRefresh?: () => void;
  /** Truncate the underlying log. Destructive but reversible-by-time: agents rewrite it. */
  onClear?: () => void;

  // ── live (controlled when onLiveChange given, else internal) ──
  onLiveChange?: (v: boolean) => void;

  // ── history length ──
  historyOptions?: number[];
  defaultHistory?: number;
  /** Called when the user picks a new history length — refetch server-side if backed by a tail. */
  onHistoryLengthChange?: (n: number) => void;

  // ── behavior / layout ──
  parsed?: boolean;
  bare?: boolean;
  /** Fill the parent (flex-1) instead of a fixed max-height (for full-tab consoles). */
  fill?: boolean;
  maxHeight?: string;
  empty?: string;
  className?: string;
}

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

interface Parsed { type: 'divider' | 'line' | 'msg'; tag: string; color: string; text: string; noise: boolean; time: string; date: string }

/** Turn one raw log line into a typed, colorized row. Peels an optional [ISO]/[HH:MM:SS] stamp. */
function parseLine(msg: string): Parsed {
  // Accepts bare [HH:MM:SS] and full ISO [2026-07-08T16:18:52.987Z] — captures date (when
  // present) and HH:MM:SS separately so the toggle can show date+time or just time.
  const tm = msg.match(/^\[(?:(\d{4}-\d{2}-\d{2})T)?(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?\]\s*/);
  const date = tm ? (tm[1] || '') : '';
  const time = tm ? tm[2] : '';
  // Strip leading emoji/pictographs — severity is already conveyed by color + tag, so the
  // raw ⛔/✅/🚀 read as unpolished. Keeps logs looking like infra, not a hobby project.
  const s = (tm ? msg.slice(tm[0].length) : msg)
    .replace(/^(?:[←-➿⬀-⯿️‍⃣\u{1F000}-\u{1FAFF}]+\s*)+/u, '');
  if (/^──/.test(s)) return { type: 'divider', tag: '', color: 'text-slate-500', text: s.replace(/─+/g, '').trim(), noise: false, time, date };
  if (/error|failed|fatal|❌|🚨/i.test(s)) return { type: 'line', tag: '!', color: 'text-rose-400', text: s, noise: false, time, date };
  if (s.startsWith('$')) return { type: 'line', tag: '$', color: 'text-ai-400', text: s.replace(/^\$:?\s*/, ''), noise: false, time, date };
  if (s.startsWith('·') || s.startsWith('—')) return { type: 'msg', tag: 'ai', color: 'text-ai-300', text: s.replace(/^[·—]\s*/, ''), noise: false, time, date };
  const m = s.match(/^(\w+):\s*(.*)/);
  if (m && PREFIX[m[1].toLowerCase()]) { const p = PREFIX[m[1].toLowerCase()]; return { type: 'line', tag: p.tag, color: p.color, text: m[2], noise: !!p.noise, time, date }; }
  return { type: 'line', tag: '', color: 'text-slate-300', text: s, noise: false, time, date };
}

export function LogConsole({
  lines, text, title, live, footer, toolbarLeft,
  searchable, timeToggle, sizeControls, historyControl, liveControl, tailControl, copyable, onRefresh, onClear,
  onLiveChange, historyOptions = [200, 400, 1000, 5000], defaultHistory = 400, onHistoryLengthChange,
  parsed = false, bare, fill, maxHeight = 'max-h-52', empty = '…', className = '',
}: LogConsoleProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState('');
  const [showTime, setShowTime] = useState(false);
  const [fontSize, setFontSize] = useState(13);
  const [internalLive, setInternalLive] = useState(true);
  const [autoScroll, setAutoScroll] = useState(false);
  const autoScrollRef = useRef(false);
  const [history, setHistory] = useState(defaultHistory);
  const [openGroups, setOpenGroups] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const liveOn = onLiveChange ? !!live : internalLive;
  const setLive = (v: boolean) => { onLiveChange ? onLiveChange(v) : setInternalLive(v); };
  const toggleGroup = (id: number) => setOpenGroups(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleTail = () => {
    const v = !autoScroll; setAutoScroll(v); autoScrollRef.current = v;
    if (v && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  };

  const rawArr = useMemo(() => lines ?? (text != null ? text.split('\n') : []), [lines, text]);
  // Client-side history cap (server-backed callers also raise their fetch tail via callback).
  const capped = historyControl && history > 0 ? rawArr.slice(-history) : rawArr;
  const shown = filter ? capped.filter(l => l.toLowerCase().includes(filter.toLowerCase())) : capped;

  // Stick to the bottom on update when tailing (or, for compact boxes without a tail
  // control, whenever the user is already near the bottom).
  useEffect(() => {
    const el = bodyRef.current; if (!el) return;
    if (tailControl) { if (autoScrollRef.current) el.scrollTop = el.scrollHeight; return; }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [shown.length, tailControl]);

  const copy = () => {
    const text2 = shown.join('\n');
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text2; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta); done();
      } catch { /* give up */ }
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text2).then(done).catch(fallback);
    else fallback();
  };

  const renderRow = (raw: string, key: React.Key) => {
    const p = parseLine(raw);
    if (p.type === 'divider') return <div key={key} className="mt-2 mb-1 border-t border-slate-700/70 pt-1 text-[0.8em] text-slate-500 uppercase tracking-widest">{p.text}</div>;
    return (
      <div key={key} className={`flex gap-2 whitespace-pre-wrap break-words py-0.5 ${p.type === 'msg' ? 'italic' : ''}`}>
        {showTime && p.time && <span className="shrink-0 text-[0.75em] text-slate-600 pt-0.5 font-mono tabular-nums select-none">{p.date ? `${p.date} ${p.time}` : p.time}</span>}
        {p.tag && <span className={`shrink-0 font-bold uppercase text-[0.8em] w-9 pt-0.5 ${p.color}`}>{p.tag}</span>}
        <span className={p.color}>{p.text}</span>
      </div>
    );
  };

  const bodyInner = shown.length === 0
    ? <span className="text-slate-500">{filter ? 'No lines match the filter.' : empty}</span>
    : !parsed
      ? shown.map((l, i) => <div key={i} className="whitespace-pre-wrap break-words">{l}</div>)
      : (() => {
        // Collapse consecutive "noise" lines (reads/searches) into a foldable group.
        const blocks: Array<{ g: Array<{ raw: string; i: number }> } | { l: { raw: string; i: number } }> = [];
        let grp: Array<{ raw: string; i: number }> = [];
        shown.forEach((raw, i) => {
          if (parseLine(raw).noise) grp.push({ raw, i });
          else { if (grp.length) { blocks.push({ g: grp }); grp = []; } blocks.push({ l: { raw, i } }); }
        });
        if (grp.length) blocks.push({ g: grp });
        return blocks.map(b => 'g' in b
          ? (b.g.length > 1
            ? <div key={`g${b.g[0].i}`}>
                <button onClick={() => toggleGroup(b.g[0].i)} className="text-slate-500 hover:text-slate-300 flex items-center gap-1.5 py-0.5 italic">
                  <span className="w-3">{openGroups.has(b.g[0].i) ? '▾' : '▸'}</span> {b.g.length} context reads &amp; searches
                </button>
                {openGroups.has(b.g[0].i) && <div className="pl-3 border-l border-slate-800 ml-1.5">{b.g.map(x => renderRow(x.raw, x.i))}</div>}
              </div>
            : renderRow(b.g[0].raw, b.g[0].i))
          : renderRow(b.l.raw, b.l.i));
      })();

  const body = (
    <div
      ref={bodyRef}
      className={`${fill ? 'flex-1' : maxHeight} overflow-y-auto custom-scrollbar font-mono leading-relaxed ${bare ? 'p-2.5' : 'p-4'} ${bare && !fill ? className : ''}`}
      style={{ fontSize }}
    >
      {bodyInner}
    </div>
  );

  const hasToolbar = searchable || timeToggle || sizeControls || historyControl || liveControl || tailControl || copyable || onRefresh || onClear || toolbarLeft || title;

  const toolbar = hasToolbar && (
    <div className="flex items-center gap-2 flex-wrap">
      {title && (
        <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-300">
          {live && <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />}
          {title}
        </span>
      )}
      {toolbarLeft}
      <div className="flex items-center gap-2 ml-auto">
        {searchable && (
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search lines…"
            data-feature-id="logs-filter"
            className="px-3 min-h-control text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500 placeholder:text-slate-400 w-40"
          />
        )}
        {historyControl && (
          <select
            value={history}
            onChange={e => { const n = Number(e.target.value); setHistory(n); onHistoryLengthChange?.(n); }}
            data-feature-id="logs-history"
            title="How many recent lines to keep"
            className="px-2 min-h-control text-xs font-bold bg-white border border-slate-300 rounded-lg text-slate-600 focus:outline-none focus:border-accent-500"
          >
            {historyOptions.map(n => <option key={n} value={n}>{n >= 1000 ? `${n / 1000}k` : n} lines</option>)}
          </select>
        )}
        {liveControl && (
          <button
            onClick={() => setLive(!liveOn)}
            data-feature-id="logs-live-toggle"
            className={`flex items-center gap-1.5 px-3 min-h-control text-xs font-bold rounded-lg border transition-colors ${liveOn ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-white text-slate-600 border-slate-300'}`}
            title={liveOn ? 'Live tail on' : 'Paused'}
          >
            {liveOn ? <><Pause size={14} /> Live</> : <><Play size={14} /> Paused</>}
          </button>
        )}
        {tailControl && (
          <button
            onClick={toggleTail}
            data-feature-id="logs-tail-toggle"
            className={`flex items-center gap-1.5 px-3 min-h-control text-xs font-bold rounded-lg border transition-colors ${autoScroll ? 'bg-accent-50 text-accent-700 border-accent-300' : 'bg-white text-slate-600 border-slate-300'}`}
            title={autoScroll ? 'Auto-scroll ON — following the tail' : 'Auto-scroll OFF'}
          >
            <ArrowDownToLine size={14} /> Tail
          </button>
        )}
        {timeToggle && (
          <button
            onClick={() => setShowTime(v => !v)}
            data-feature-id="logs-time-toggle"
            className={`flex items-center gap-1.5 px-3 min-h-control text-xs font-bold rounded-lg border transition-colors ${showTime ? 'bg-accent-50 text-accent-700 border-accent-300' : 'bg-white text-slate-600 border-slate-300'}`}
            title={showTime ? 'Per-line date + time shown' : 'Per-line date + time hidden'}
          >
            <Clock size={14} /> Date/Time
          </button>
        )}
        {sizeControls && (
          <div className="flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden" title="Font size">
            <button onClick={() => setFontSize(s => Math.max(10, s - 1))} className="px-2.5 min-h-control text-sm font-bold text-slate-600 hover:bg-slate-50">A−</button>
            <span className="px-1 text-[10px] text-slate-400 font-mono select-none">{fontSize}</span>
            <button onClick={() => setFontSize(s => Math.min(22, s + 1))} className="px-2.5 min-h-control text-base font-bold text-slate-600 hover:bg-slate-50">A+</button>
          </div>
        )}
        {copyable && (
          <Tooltip label="Copy the visible log to clipboard"><button
            onClick={copy}
            className="flex items-center gap-1.5 px-3 min-h-control text-xs font-bold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            {copied ? <><Check size={14} className="text-emerald-600" /> Copied</> : <><Copy size={14} /> Copy</>}
          </button></Tooltip>
        )}
        {onClear && (
          <Tooltip label="Clear this log"><button
            onClick={onClear}
            data-feature-id="logs-clear"
            className="flex items-center justify-center min-w-[34px] min-h-control text-rose-600 bg-white border border-slate-300 rounded-lg hover:bg-rose-50 hover:border-rose-300 active:scale-[0.97] transition-all"
          >
            <Trash2 size={14} />
          </button></Tooltip>
        )}
        {onRefresh && (
          <Tooltip label="Refresh"><button
            onClick={onRefresh}
            data-feature-id="logs-refresh"
            className="flex items-center justify-center min-w-[34px] min-h-control text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 active:scale-[0.97] transition-all"
          >
            <RefreshCw size={14} />
          </button></Tooltip>
        )}
      </div>
    </div>
  );

  // Bare mode: just the scrolling body (for slotting into a panel with its own chrome).
  if (bare && !hasToolbar) return body;

  return (
    <div className={`${fill ? 'flex flex-col h-full min-h-0' : ''} space-y-2 ${!bare && !fill ? className : ''}`}>
      {toolbar}
      <div className={`${fill ? 'flex-1 min-h-0 flex flex-col' : ''} bg-surface-terminal border border-slate-300 rounded-xl overflow-hidden`}>
        {body}
      </div>
      {footer && <div className="text-[11px] text-slate-500 shrink-0">{footer}</div>}
    </div>
  );
}

export default LogConsole;
