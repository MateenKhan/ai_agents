import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from './Tooltip';
import { RefreshCw, Pause, Play, Copy, Check, ArrowDownToLine, ArrowDown, Clock, Trash2, SlidersHorizontal, Maximize2, Minimize2, WrapText, ChevronUp, ChevronDown } from 'lucide-react';

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
  /** Upgrade the search box from filter-out to find-in-place: highlight matches, show a
   *  running "3/12" count, and step through them with prev/next. Opt-in so the compact
   *  filter callers (git run/clone/index) keep their existing filter-only behavior. */
  searchNav?: boolean;
  /** Offer a line-wrap toggle. Default view still wraps (unchanged for existing callers);
   *  toggling off switches long lines to horizontal scroll. */
  wrapControl?: boolean;
  /** Show a floating "jump to latest" button when the stream is live and the user has
   *  scrolled up off the tail. Opt-in; independent of the persistent tail toggle. */
  jumpToBottom?: boolean;
  timeToggle?: boolean;
  sizeControls?: boolean;
  historyControl?: boolean;
  liveControl?: boolean;
  tailControl?: boolean;
  copyable?: boolean;
  onRefresh?: () => void;
  /** Truncate the underlying log. Destructive but reversible-by-time: agents rewrite it. */
  onClear?: () => void;
  /** Enable the per-control "hide" menu, persisted under this localStorage key. Omit on
   *  compact consoles (git clone/index boxes) that only ever show one or two controls. */
  controlsKey?: string;

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
  /** Offer a full-screen button in the toolbar. A cramped max-h-64 log in a modal is where
   *  this earns its place; a full-tab console (`fill`) already has the room. */
  fullscreenable?: boolean;
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

/** Toolbar controls that can be hidden. `on` says whether the caller enabled it at all —
 *  a console that never passes `copyable` should not offer to hide Copy. */
const TOOLBAR_CONTROLS: Array<{ id: string; label: string; on: (p: Record<string, unknown>) => boolean }> = [
  { id: 'search',  label: 'Search',     on: p => !!p.searchable },
  { id: 'history', label: 'History',    on: p => !!p.historyControl },
  { id: 'live',    label: 'Live',       on: p => !!p.liveControl },
  { id: 'tail',    label: 'Tail',       on: p => !!p.tailControl },
  { id: 'time',    label: 'Date/Time',  on: p => !!p.timeToggle },
  { id: 'wrap',    label: 'Line wrap',  on: p => !!p.wrapControl },
  { id: 'size',    label: 'Font size',  on: p => !!p.sizeControls },
  { id: 'copy',    label: 'Copy',       on: p => !!p.copyable },
  { id: 'clear',   label: 'Clear',      on: p => !!p.onClear },
  { id: 'refresh', label: 'Refresh',    on: p => !!p.onRefresh },
];

/** One geometry for every square toolbar button. Colour is layered on per control, so a
 *  toggle can carry its state without any two buttons differing in size or radius. */
const toolbarBtn = 'flex items-center justify-center min-w-control min-h-control rounded-lg border transition-all active:scale-[0.97]';

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
  lines, text, title, live, footer, toolbarLeft, fullscreenable,
  searchable, searchNav, wrapControl, jumpToBottom, timeToggle, sizeControls, historyControl, liveControl, tailControl, copyable, onRefresh, onClear, controlsKey,
  onLiveChange, historyOptions = [200, 400, 1000, 5000], defaultHistory = 400, onHistoryLengthChange,
  parsed = false, bare, fill, maxHeight = 'max-h-52', empty = '…', className = '',
}: LogConsoleProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // Esc leaves fullscreen; a log you maximised to read shouldn't trap you.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);
  // In fullscreen the body must fill height regardless of the caller's `fill`/`maxHeight`.
  const ff = fill || fullscreen;
  const [filter, setFilter] = useState('');
  const [showTime, setShowTime] = useState(false);
  const [fontSize, setFontSize] = useState(13);
  const [internalLive, setInternalLive] = useState(true);
  const [autoScroll, setAutoScroll] = useState(false);
  const autoScrollRef = useRef(false);
  const [history, setHistory] = useState(defaultHistory);
  const [openGroups, setOpenGroups] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  // Line wrap defaults ON so callers that don't opt into the toggle keep today's look.
  const [wrap, setWrap] = useState(true);
  // Whether the body is scrolled to (near) the tail — drives the jump-to-latest button.
  const [atBottom, setAtBottom] = useState(true);
  // Which search match is "current" for the find-in-place next/prev stepper.
  const [matchIdx, setMatchIdx] = useState(0);

  // Per-control visibility, same idea as hiding a tab: the toolbar is dense and not every
  // console needs every control. Persisted so the choice survives a reload.
  const lsKey = controlsKey ? `piranha.logconsole.hidden.${controlsKey}` : null;
  const [hidden, setHidden] = useState<Set<string>>(() => {
    if (!lsKey) return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(lsKey) || '[]')); } catch { return new Set(); }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const show = (id: string) => !hidden.has(id);
  const toggleControl = (id: string) => setHidden(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    if (lsKey) { try { localStorage.setItem(lsKey, JSON.stringify([...next])); } catch { /* quota */ } }
    return next;
  });

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
  // Two search modes: legacy filter (hide non-matches) vs find-in-place (keep every line,
  // highlight matches, step through them). searchNav opts into the latter, so filtering
  // stays the behavior for the compact git run/clone/index consoles.
  const legacyFilter = searchable && !searchNav;
  const shown = filter && legacyFilter ? capped.filter(l => l.toLowerCase().includes(filter.toLowerCase())) : capped;

  // Find-in-place matches: line indices (into `shown`) containing the query.
  const matchSet = useMemo(() => {
    const s = new Set<number>();
    if (searchNav && filter) { const q = filter.toLowerCase(); shown.forEach((l, i) => { if (l.toLowerCase().includes(q)) s.add(i); }); }
    return s;
  }, [searchNav, filter, shown]);
  const matches = useMemo(() => [...matchSet].sort((a, b) => a - b), [matchSet]);
  // Reset the cursor to the first match whenever the query changes.
  useEffect(() => { setMatchIdx(0); }, [filter]);
  // Keep the cursor in range as matches come and go (a live tail changes the set).
  useEffect(() => { setMatchIdx(i => (matches.length ? Math.min(i, matches.length - 1) : 0)); }, [matches.length]);
  const stepMatch = (d: number) => { if (matches.length) setMatchIdx(i => (i + d + matches.length) % matches.length); };
  // Scroll the current match into view when the cursor moves.
  useEffect(() => {
    if (!searchNav || !matches.length) return;
    const el = bodyRef.current?.querySelector(`[data-line-index="${matches[matchIdx]}"]`);
    el?.scrollIntoView({ block: 'center' });
  }, [matchIdx, matches, searchNav]);

  const ws = wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre';
  const rowHL = (i: number): string => {
    if (!searchNav || matchSet.size === 0) return '';
    if (i === matches[matchIdx]) return 'bg-amber-400/25 rounded';
    if (matchSet.has(i)) return 'bg-amber-400/10 rounded';
    return '';
  };
  const scrollToBottom = () => { const el = bodyRef.current; if (el) { el.scrollTop = el.scrollHeight; setAtBottom(true); } };
  const onBodyScroll = () => { const el = bodyRef.current; if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60); };

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
    const i = typeof key === 'number' ? key : -1;
    if (p.type === 'divider') return <div key={key} data-line-index={i} className="mt-2 mb-1 border-t border-slate-700/70 pt-1 text-[0.8em] text-slate-500 uppercase tracking-widest">{p.text}</div>;
    return (
      <div key={key} data-line-index={i} className={`flex gap-2 ${ws} py-0.5 ${p.type === 'msg' ? 'italic' : ''} ${rowHL(i)}`}>
        {showTime && p.time && <span className="shrink-0 text-[0.75em] text-slate-600 pt-0.5 font-mono tabular-nums select-none">{p.date ? `${p.date} ${p.time}` : p.time}</span>}
        {p.tag && <span className={`shrink-0 font-bold uppercase text-[0.8em] w-9 pt-0.5 ${p.color}`}>{p.tag}</span>}
        <span className={p.color}>{p.text}</span>
      </div>
    );
  };

  const bodyInner = shown.length === 0
    ? <span className="text-slate-500">{filter && legacyFilter ? 'No lines match the filter.' : empty}</span>
    : !parsed
      // text-slate-300 to match parsed lines: without a colour these inherit the app's dark
      // body text and render invisibly on the dark terminal surface (Run/Clone/Index logs).
      ? shown.map((l, i) => <div key={i} data-line-index={i} className={`${ws} text-slate-300 ${rowHL(i)}`}>{l}</div>)
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
            // Force the group open when find-in-place has a match inside it — otherwise
            // the stepper would scroll to a line hidden in a collapsed fold.
            ? (() => {
              const grpOpen = openGroups.has(b.g[0].i) || (searchNav && b.g.some(x => matchSet.has(x.i)));
              return <div key={`g${b.g[0].i}`}>
                <button onClick={() => toggleGroup(b.g[0].i)} className="text-slate-500 hover:text-slate-300 flex items-center gap-1.5 py-0.5 italic">
                  <span className="w-3">{grpOpen ? '▾' : '▸'}</span> {b.g.length} context reads &amp; searches
                </button>
                {grpOpen && <div className="pl-3 border-l border-slate-800 ml-1.5">{b.g.map(x => renderRow(x.raw, x.i))}</div>}
              </div>;
            })()
            : renderRow(b.g[0].raw, b.g[0].i))
          : renderRow(b.l.raw, b.l.i));
      })();

  const body = (
    <div
      ref={bodyRef}
      onScroll={onBodyScroll}
      className={`${ff ? 'flex-1 min-h-0' : maxHeight} overflow-y-auto ${wrap ? '' : 'overflow-x-auto'} custom-scrollbar font-mono leading-relaxed ${bare ? 'p-2.5' : 'p-4'} ${bare && !ff ? className : ''}`}
      style={{ fontSize }}
    >
      {bodyInner}
    </div>
  );

  const hasToolbar = searchable || timeToggle || sizeControls || historyControl || liveControl || tailControl || copyable || onRefresh || onClear || toolbarLeft || title || fullscreenable || wrapControl;

  const toolbar = hasToolbar && (
    <div className="flex items-center gap-2 flex-wrap">
      {title && (
        <span className="flex items-center gap-2 text-micro font-bold uppercase tracking-widest text-slate-300">
          {live && <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />}
          {title}
        </span>
      )}
      {toolbarLeft}
      <div className="flex items-center gap-2 ml-auto">
        {searchable && show('search') && (
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search lines…"
            data-feature-id="logs-filter"
            className="px-3 min-h-control text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500 placeholder:text-slate-400 w-40"
          />
        )}
        {/* Find-in-place: a running match count and prev/next stepper. Only meaningful with a
            query, so the whole cluster is hidden until the user types. */}
        {searchable && searchNav && show('search') && filter && (
          <div className="flex items-center gap-1" data-feature-id="logs-search-nav">
            <span className="text-2xs font-mono text-slate-500 tabular-nums select-none min-w-[3.5ch] text-center">
              {matches.length ? `${matchIdx + 1}/${matches.length}` : '0/0'}
            </span>
            <Tooltip label="Previous match"><button
              onClick={() => stepMatch(-1)}
              disabled={!matches.length}
              aria-label="Previous match"
              data-feature-id="logs-search-prev"
              className={`${toolbarBtn} bg-white border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white`}
            ><ChevronUp size={15} /></button></Tooltip>
            <Tooltip label="Next match"><button
              onClick={() => stepMatch(1)}
              disabled={!matches.length}
              aria-label="Next match"
              data-feature-id="logs-search-next"
              className={`${toolbarBtn} bg-white border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white`}
            ><ChevronDown size={15} /></button></Tooltip>
          </div>
        )}
        {historyControl && show('history') && (
          <select
            value={history}
            onChange={e => { const n = Number(e.target.value); setHistory(n); onHistoryLengthChange?.(n); }}
            data-feature-id="logs-history"
            aria-label="How many recent lines to keep"
            className="px-2 min-h-control text-xs font-bold bg-white border border-slate-300 rounded-lg text-slate-600 focus:outline-none focus:border-accent-500"
          >
            {historyOptions.map(n => <option key={n} value={n}>{n >= 1000 ? `${n / 1000}k` : n} lines</option>)}
          </select>
        )}
        {/* Toggles are icon-only. Their LABEL was carrying the name and the COLOUR was carrying
            the state, which meant the label never changed and read as decoration. Now the icon
            names the action (pause when live, play when paused) and the fill carries the state.
            The accessible name comes from Tooltip, which injects aria-label — so these stay
            reachable by voice control and screen readers despite having no visible text. */}
        {liveControl && show('live') && (
          <Tooltip label={liveOn ? 'Pause live tail' : 'Resume live tail'}><button
            onClick={() => setLive(!liveOn)}
            aria-pressed={liveOn}
            data-feature-id="logs-live-toggle"
            className={`${toolbarBtn} ${liveOn ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-white text-slate-600 border-slate-300'}`}
          >
            {liveOn ? <Pause size={15} /> : <Play size={15} />}
          </button></Tooltip>
        )}
        {tailControl && show('tail') && (
          <Tooltip label={autoScroll ? 'Auto-scroll on — following the tail' : 'Auto-scroll off'}><button
            onClick={toggleTail}
            aria-pressed={autoScroll}
            data-feature-id="logs-tail-toggle"
            className={`${toolbarBtn} ${autoScroll ? 'bg-accent-50 text-accent-700 border-accent-300' : 'bg-white text-slate-600 border-slate-300'}`}
          >
            <ArrowDownToLine size={15} />
          </button></Tooltip>
        )}
        {timeToggle && show('time') && (
          <Tooltip label={showTime ? 'Hide per-line date + time' : 'Show per-line date + time'}><button
            onClick={() => setShowTime(v => !v)}
            aria-pressed={showTime}
            data-feature-id="logs-time-toggle"
            className={`${toolbarBtn} ${showTime ? 'bg-accent-50 text-accent-700 border-accent-300' : 'bg-white text-slate-600 border-slate-300'}`}
          >
            <Clock size={15} />
          </button></Tooltip>
        )}
        {wrapControl && show('wrap') && (
          <Tooltip label={wrap ? 'Wrapping long lines — switch to horizontal scroll' : 'Not wrapping — switch to wrap'}><button
            onClick={() => setWrap(v => !v)}
            aria-pressed={wrap}
            data-feature-id="logs-wrap-toggle"
            className={`${toolbarBtn} ${wrap ? 'bg-accent-50 text-accent-700 border-accent-300' : 'bg-white text-slate-600 border-slate-300'}`}
          >
            <WrapText size={15} />
          </button></Tooltip>
        )}
        {/* A− / A+ ARE the icons. The number between them is live state, not a label, so it
            stays: without it the stepper gives no feedback that anything happened. */}
        {sizeControls && show('size') && (
          <div className="flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
            <Tooltip label="Smaller text"><button onClick={() => setFontSize(s => Math.max(10, s - 1))} aria-label="Smaller text" className="px-2.5 min-h-control text-sm font-bold text-slate-600 hover:bg-slate-50">A−</button></Tooltip>
            <span className="px-1 text-micro text-slate-500 font-mono select-none" aria-hidden="true">{fontSize}</span>
            <Tooltip label="Larger text"><button onClick={() => setFontSize(s => Math.min(22, s + 1))} aria-label="Larger text" className="px-2.5 min-h-control text-base font-bold text-slate-600 hover:bg-slate-50">A+</button></Tooltip>
          </div>
        )}
        {copyable && show('copy') && (
          <Tooltip label={copied ? 'Copied' : 'Copy the visible log to clipboard'}><button
            onClick={copy}
            data-feature-id="logs-copy"
            className={`${toolbarBtn} bg-white border-slate-300 hover:bg-slate-50 ${copied ? 'text-emerald-600' : 'text-slate-600'}`}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button></Tooltip>
        )}
        {fullscreenable && (
          <Tooltip label={fullscreen ? 'Exit full screen' : 'Full screen'}><button
            onClick={() => setFullscreen(v => !v)}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            data-feature-id="logs-fullscreen"
            className={`${toolbarBtn} text-slate-600 bg-white border-slate-300 hover:bg-slate-50`}
          >
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button></Tooltip>
        )}
        {onClear && show('clear') && (
          <Tooltip label="Clear this log"><button
            onClick={onClear}
            data-feature-id="logs-clear"
            className={`${toolbarBtn} text-rose-600 bg-white border-slate-300 hover:bg-rose-50 hover:border-rose-300`}
          >
            <Trash2 size={14} />
          </button></Tooltip>
        )}
        {onRefresh && show('refresh') && (
          <Tooltip label="Refresh"><button
            onClick={onRefresh}
            data-feature-id="logs-refresh"
            className={`${toolbarBtn} text-slate-600 bg-white border-slate-300 hover:bg-slate-50`}
          >
            <RefreshCw size={14} />
          </button></Tooltip>
        )}

        {/* Per-control visibility — the toolbar is dense, and not every console needs every
            control. Same mental model as hiding a tab; the choice is persisted. */}
        {lsKey && (
          <div className="relative">
            <Tooltip label="Toolbar options"><button
              onClick={() => setMenuOpen(o => !o)}
              aria-expanded={menuOpen}
              data-feature-id="logs-toolbar-options"
              className={`${toolbarBtn} text-slate-600 bg-white border-slate-300 hover:bg-slate-50`}
            >
              <SlidersHorizontal size={14} />
            </button></Tooltip>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-[70]" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-[75] w-48 p-1.5 rounded-xl border border-slate-200 bg-white shadow-xl">
                  <p className="eyebrow px-2 py-1">Show controls</p>
                  {TOOLBAR_CONTROLS.filter(c => c.on({ searchable, historyControl, liveControl, tailControl, timeToggle, wrapControl, sizeControls, copyable, onClear, onRefresh }))
                    .map(c => (
                      <label key={c.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                        {c.label}
                        <input
                          type="checkbox"
                          checked={show(c.id)}
                          onChange={() => toggleControl(c.id)}
                          className="w-4 h-4 accent-slate-900"
                        />
                      </label>
                    ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // Bare mode: just the scrolling body (for slotting into a panel with its own chrome).
  if (bare && !hasToolbar) return body;

  const content = (
    <div className={`${ff ? 'flex flex-col h-full min-h-0' : ''} space-y-2 ${!bare && !ff ? className : ''}`}>
      {toolbar}
      <div className={`relative ${ff ? 'flex-1 min-h-0 flex flex-col' : ''} bg-surface-terminal border border-slate-300 rounded-xl overflow-hidden`}>
        {body}
        {jumpToBottom && liveOn && !atBottom && (
          <Tooltip label="Jump to the latest lines"><button
            onClick={scrollToBottom}
            data-feature-id="logs-jump-bottom"
            className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-3 min-h-control rounded-lg bg-slate-800 text-emerald-300 border border-slate-700 shadow-lg text-2xs font-bold uppercase tracking-wide hover:bg-slate-700 active:scale-[0.97] transition-all"
          >
            <ArrowDown size={14} /> Latest
          </button></Tooltip>
        )}
      </div>
      {footer && <div className="text-2xs text-slate-500 shrink-0">{footer}</div>}
    </div>
  );

  // Portalled to <body> so the overlay escapes any clipping/transformed ancestor (the Git
  // modal, a slide-over). Padded so the console keeps its rounded frame against the edges.
  if (fullscreen) {
    return createPortal(
      <div className="fixed inset-0 z-[1200] bg-slate-900/70 backdrop-blur-sm p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Log — full screen" data-feature-id="logs-fullscreen-overlay">
        <div className="w-full h-full flex flex-col">{content}</div>
      </div>,
      document.body,
    );
  }

  return content;
}

export default LogConsole;
