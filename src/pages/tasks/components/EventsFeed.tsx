import React, { useEffect, useMemo, useState } from 'react';
import { Activity, FileText, RefreshCw, Search, X } from 'lucide-react';
import { API_BASE, withProject } from '../../../apiBase';
import { timeAgo, formatWhen } from '../lib/timeUtil';

/**
 * Events feed (SPEC.md Release 1 P0 item 7) — a live table of pipeline events, one row per
 * event, so you can see what every agent is doing at a glance:
 *
 *   | Task | Agent | Action | Link | Time | Attempt |
 *
 * Data comes from GET /events (newest first, project-scoped, capped at 100) and is polled
 * every 5s — the same poll refreshes the relative timestamps, so "30 sec ago" keeps aging
 * without a second timer. Filtering is purely client-side across task title + agent + message.
 * taskTitle/agent/logPath may be null when the task was deleted; those rows fall back to the
 * raw taskId in muted mono so the history stays legible without pretending the task exists.
 */

export interface PipelineEvent {
  id: string | number;
  taskId: string;
  taskTitle: string | null;
  agent: string | null;
  message: string;
  /** Level string: 'info' | 'warning' | 'error' | 'success' (open set — unknowns render untinted). */
  type: string;
  /** ISO timestamp. */
  ts: string;
  attempt: number;
  logPath: string | null;
}

/** "1st", "2nd", "3rd", "4th", … "11th"/"12th"/"13th" (teens are all -th). */
export function ordinal(n: number): string {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(Math.trunc(n));
  const tail = abs % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Capitalise in JS (not CSS `capitalize`) so tests and screen readers see the same text. */
function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Faint per-level row wash — text stays slate; only the background whispers the level.
const ROW_TINT: Record<string, string> = {
  error: 'bg-rose-50',
  warning: 'bg-amber-50',
  success: 'bg-emerald-50',
};

const COLUMNS = ['Task', 'Agent', 'Action', 'Link', 'Time', 'Attempt'] as const;

export function EventsFeed({ onOpenLog }: { onOpenLog?: (taskId: string, agent: string | null) => void }) {
  // null = first load still in flight (skeleton); [] = loaded and genuinely empty.
  const [events, setEvents] = useState<PipelineEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  // Bumped by Retry to re-arm the whole fetch-and-poll effect from scratch.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let stop = false; // guards against setState after unmount (poll may resolve late)
    const load = async () => {
      try {
        const r = await fetch(withProject(`${API_BASE}/events?limit=100`));
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        const d = await r.json();
        if (stop) return;
        // A successful poll always replaces the array, which re-renders every row and
        // thereby refreshes the timeAgo() cells — no separate clock timer needed.
        setEvents(Array.isArray(d?.events) ? d.events : []);
        setError(null);
      } catch (e: any) {
        if (stop) return;
        // Keep already-loaded rows on a failed poll (a blip shouldn't blank the feed);
        // only the very first load surfaces the full error state.
        setError(e?.message || 'Could not load events');
      }
    };
    void load();
    const iv = setInterval(() => { void load(); }, 5000);
    return () => { stop = true; clearInterval(iv); };
  }, [reloadKey]);

  const filtered = useMemo(() => {
    if (!events) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return events;
    return events.filter(e =>
      (e.taskTitle ?? e.taskId ?? '').toLowerCase().includes(q) ||
      (e.agent ?? '').toLowerCase().includes(q) ||
      (e.message ?? '').toLowerCase().includes(q));
  }, [events, filter]);

  const retry = () => { setError(null); setEvents(null); setReloadKey(k => k + 1); };

  return (
    <div className="h-full flex flex-col min-h-0 p-3 sm:p-4 gap-3" data-feature-id="tasks-events-feed">
      {/* Filter bar */}
      <div className="shrink-0 flex items-center gap-2 flex-wrap">
        <p className="eyebrow flex items-center gap-1.5"><Activity size={12} className="text-accent-600" /> Live events</p>
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by task, agent or message…"
            aria-label="Filter events"
            data-feature-id="events-filter"
            className="pl-8 pr-8 min-h-control text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-accent-500 placeholder:text-slate-400 w-64"
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              aria-label="Clear filter"
              data-feature-id="events-filter-clear"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <span className="text-2xs text-slate-500 whitespace-nowrap tabular-nums" data-feature-id="events-count">
          {filtered.length} of {events?.length ?? 0} shown
        </span>
      </div>

      {/* Table — scrolls vertically inside the component (the app shell never scrolls the
          page) and horizontally in the same container when the viewport is narrow. */}
      <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl overflow-auto custom-scrollbar shadow-sm">
        {error && events === null ? (
          <div className="h-full min-h-[40vh] flex items-center justify-center p-6 text-center">
            <div className="flex flex-col items-center gap-2.5 max-w-xs">
              <p className="eyebrow text-rose-500">Could not load events</p>
              <p className="text-2xs text-slate-500">{error}</p>
              <button
                onClick={retry}
                data-feature-id="events-retry"
                className="flex items-center gap-1.5 px-3 min-h-control text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <RefreshCw size={13} /> Retry
              </button>
            </div>
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-100 shadow-[0_1px_0_0_#e2e8f0]">
                {COLUMNS.map(c => (
                  <th key={c} scope="col" className="px-3 py-2.5 text-2xs font-bold uppercase tracking-wide text-slate-600 whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events === null ? (
                // First-load skeleton — holds the table's shape instead of a blank flash.
                Array.from({ length: 8 }).map((_, ri) => (
                  <tr key={`sk-${ri}`} className="border-b border-slate-100" aria-hidden="true">
                    {COLUMNS.map((c, ci) => (
                      <td key={c} className="px-3 py-2.5">
                        <div className="h-3 rounded bg-slate-100 animate-pulse" style={{ width: `${40 + ((ri + ci) % 3) * 20}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center">
                    <p className="eyebrow text-slate-400">No events yet</p>
                    <p className="text-2xs text-slate-500 mt-1">No events yet — dispatch a task and the feed fills up.</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-2xs text-slate-500">
                    No events match “{filter}”.
                  </td>
                </tr>
              ) : filtered.map(e => {
                const deleted = e.taskTitle == null;
                const taskLabel = e.taskTitle ?? e.taskId;
                return (
                  <tr key={e.id} className={`border-b border-slate-100 transition-colors ${ROW_TINT[e.type] ?? 'bg-white'}`}>
                    {/* Task — title, or the raw id muted when the task was deleted */}
                    <td className={`px-3 py-2 text-xs whitespace-nowrap ${deleted ? 'font-mono text-slate-400' : 'font-semibold text-slate-800'}`}>
                      {taskLabel}
                    </td>
                    {/* Agent — capitalised in JS so the DOM text matches what's on screen */}
                    <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                      {e.agent ? capitalise(e.agent) : <span className="text-slate-400">—</span>}
                    </td>
                    {/* Action — one line, full text one hover away */}
                    <td className="px-3 py-2 text-xs text-slate-700 max-w-[26rem]">
                      <span className="block truncate" title={e.message}>{e.message}</span>
                    </td>
                    {/* Link — only when there's a log (or at least an agent) to open */}
                    <td className="px-3 py-2">
                      {(e.logPath || e.agent) ? (
                        <button
                          onClick={() => onOpenLog?.(e.taskId, e.agent)}
                          aria-label={`Open log for ${taskLabel}`}
                          data-feature-id="events-open-log"
                          className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                          <FileText size={13} />
                        </button>
                      ) : null}
                    </td>
                    {/* Time — relative on screen, absolute in the tooltip; refreshed by the poll */}
                    <td className="px-3 py-2 text-2xs text-slate-500 whitespace-nowrap" title={formatWhen(e.ts)}>
                      {timeAgo(e.ts)}
                    </td>
                    {/* Attempt — ordinal; 2nd+ gets a subtle amber tint so retries stand out */}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {e.attempt >= 2 ? (
                        <span className="inline-flex px-1.5 py-0.5 text-micro font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded">
                          {ordinal(e.attempt)}
                        </span>
                      ) : (
                        <span className="text-2xs text-slate-500">{ordinal(e.attempt)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default EventsFeed;
