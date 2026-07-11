// ─────────────────────────────────────────────────────────────────────────────
// The status bar that rides on the water.
//
// It floats on top of the tank rather than stacking above it, so the label and the
// fish share a top edge. A scrim keeps the type legible without freezing the swarm.
//
// This is the surface that retires the floating bottom-right panel: status line,
// the four counters, and a bell that opens Recent Events as a popover — a scrolling
// feed can't live inside a header row.
//
// The mute here pauses the tank's ambient MOTION — the swim — and nothing else. It never
// hides status, counts, unread events or errors: a toggle that can silence "API unreachable"
// or bury the unread count is a footgun. Reduced-motion at the OS level forces it on.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Bell, WifiOff } from 'lucide-react';
import { API_BASE, getActiveProject, withProject } from '../../apiBase';
import { humanizeStatusMessage } from '../../pages/tasks/statusMessages';

interface Counts { pending: number; working: number; testing: number; done: number }
interface OrchEvent { id?: number; ts: string | number; msg: string; type?: string }

interface Status {
  orchestrator?: { statusLine: string; up: boolean; ageSec: number };
  counts?: Counts;
  events?: OrchEvent[];
  boardCorrupt?: string | null;
}

function ago(ts: string | number): string {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// A monotonic id for an event. The server sends a row id; ts is the fallback for any
// synthetic line that lacks one.
const eventKey = (e: OrchEvent): number => e.id ?? (Date.parse(String(e.ts)) || 0);

// The "seen" marker has to survive remounts and can't be a count: /system-status returns a
// fixed ~15-row window, so events.length is pinned and a count-based unread reads the
// component lifecycle, not the feed. We persist the newest id the user has viewed instead.
// Per-project because the feed is project-scoped (withProject).
const seenKeyFor = () => `piranha.eventsSeen:${getActiveProject()}`;
function readSeen(): number {
  try { return Number(localStorage.getItem(seenKeyFor())) || 0; }
  catch { return 0; }
}
function writeSeen(v: number): void {
  try { localStorage.setItem(seenKeyFor(), String(v)); }
  catch { /* private mode: unread just won't persist */ }
}

export function TankStatusBar({ working, muted, reduced, onToggleMuted }: {
  working: number;
  /** the user's stored preference — pauses the swim, never the information */
  muted: boolean;
  /** OS-level prefers-reduced-motion; forces the pause on and takes the toggle away */
  reduced: boolean;
  onToggleMuted: () => void;
}) {
  const [s, setS] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<number>(() => readSeen());
  const [offline, setOffline] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch(withProject(`${API_BASE}/system-status`));
        const d = await r.json();
        if (alive) { setS(d); setOffline(false); }
      } catch {
        // The floating panel used to carry this. It doesn't exist any more, so the bar does.
        if (alive) setOffline(true);
      }
    };
    pull();
    const iv = setInterval(pull, 4000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // close the popover on an outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const events = s?.events ?? [];
  const unread = events.filter(e => eventKey(e) > seen).length;
  const c = s?.counts;
  const up = s?.orchestrator?.up ?? false;

  // Degrade through what actually exists: live work → the last thing that happened → an
  // invitation for a first-timer, rather than a status report about a system they haven't
  // touched. The orchestrator line is kept only when the board holds tasks but the feed is
  // empty, so we never tell someone with queued work "no tasks yet".
  const recent = events.find(e => e.msg?.trim());
  const total = c ? c.pending + c.working + c.testing + c.done : 0;
  const line = working > 0
    ? `${working} ${working === 1 ? 'agent' : 'agents'} working`
    : recent
      ? `Last: ${humanizeStatusMessage(recent.msg)} · ${ago(recent.ts)}`
      : total === 0
        ? 'No tasks yet — hit + to feed the swarm.'
        : (s?.orchestrator && humanizeStatusMessage(s.orchestrator.statusLine)) || 'Idle — nothing to dispatch';

  // The tank clips its children (overflow-hidden), so the popover is portalled to <body>
  // and positioned against the bell. A bigger z-index alone can't escape a clipping ancestor.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btnRef.current;
      if (!b) return;
      const r = b.getBoundingClientRect();
      setAnchor({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    // A layout keyed on [open] alone freezes the anchor the moment it mounts; the bell moves
    // under it on any resize or scroll. Recompute against the live button rect instead.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const openPop = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      const w = events.reduce((m, e) => Math.max(m, eventKey(e)), 0);
      setSeen(w);
      writeSeen(w);
    }
  };

  const alarm = offline
    ? { icon: <WifiOff size={12} />, text: "Can't reach Piranha's server" }
    : s?.boardCorrupt
      ? { icon: <AlertTriangle size={12} />, text: `${s.boardCorrupt} is corrupted — run scripts/repair-db.ts` }
      : null;

  return (
    <div className="absolute inset-x-0 top-0 z-20">
      {/* the scrim: readable type over moving fish, without stopping the fish */}
      <div className={`flex items-center gap-2 px-2.5 py-1.5 ${
        alarm ? 'bg-rose-50 border-b border-rose-200' : 'bg-gradient-to-b from-white via-white/90 to-transparent'
      }`}>
        {alarm ? (
          <span className="shrink-0 text-rose-600">{alarm.icon}</span>
        ) : (
          <span
            className={`shrink-0 w-1.5 h-1.5 rounded-full ${
              working > 0
                // a pulse is reserved for genuinely active work; a steady "up" reads as anxiety
                ? 'bg-cyan-400 shadow-[0_0_0_3px_rgba(34,211,238,.28)] animate-pulse'
                : up
                  ? 'bg-cyan-400 shadow-[0_0_0_3px_rgba(34,211,238,.28)]'
                  : 'bg-slate-300'
            }`}
          />
        )}
        {/* Wrap to a second line rather than hard-truncating: a status the user can't read
            ("…default, 2 tas…") is worse than a row one line taller. line-clamp-2 keeps it
            bounded, and items-center still centres the counts against the taller block.

            AT: the non-alarm line is rotating voice copy ("No blood yet", "Idle — nothing to
            dispatch") that changes on every 4s poll — read aloud it's noise, and the real state
            is already in the counts below. So hide it from screen readers unless it's carrying a
            genuine alarm (offline / board corrupt), which must always be announced. */}
        <span aria-hidden={!alarm} className={`flex-1 min-w-0 line-clamp-2 leading-snug text-2xs font-semibold ${alarm ? 'text-rose-700' : 'text-slate-700'}`}>
          {alarm ? alarm.text : line}
        </span>

        {c && (
          <div className="shrink-0 flex items-center gap-0.5">
            {([
              ['Pending', c.pending, false],
              ['Working', c.working, true],
              ['Review', c.testing, false],
              ['Done', c.done, false],
            ] as const).map(([label, n, hot]) => (
              <span
                key={label}
                // The counts are the real, announceable status — read them as one unit
                // ("3 Working") instead of letting AT spell out the mono uppercase label.
                aria-label={`${n} ${label}`}
                className={`flex items-baseline gap-1 px-1.5 py-0.5 rounded ${hot ? 'bg-accent-100' : ''}`}
              >
                <b aria-hidden className={`text-2xs font-extrabold tabular-nums ${hot ? 'text-accent-700' : 'text-slate-700'}`}>{n}</b>
                <span aria-hidden className={`text-micro font-mono uppercase tracking-wider ${hot ? 'text-accent-600' : 'text-slate-500'}`}>
                  {label}
                </span>
              </span>
            ))}
          </div>
        )}

        <div className="shrink-0">
          <button
            ref={btnRef}
            onClick={openPop}
            aria-expanded={open}
            aria-label="Recent events"
            data-feature-id="tank-events"
            className={`relative w-6 h-6 flex items-center justify-center rounded-md transition-colors ${
              open ? 'text-accent-600 bg-accent-100' : 'text-slate-400 hover:text-accent-600 hover:bg-accent-50'
            }`}
          >
            <Bell size={13} />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-accent-500 text-white text-[8px] font-mono font-bold leading-[13px] text-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {open && anchor && createPortal(
            <div
              ref={popRef}
              style={{ top: anchor.top, right: anchor.right }}
              className="fixed w-[320px] max-w-[80vw] z-[100] rounded-lg bg-surface-panel text-slate-100 border border-slate-700 shadow-2xl overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/70">
                <span className="flex-1 text-[9px] font-mono uppercase tracking-[0.13em] text-slate-400">Recent events</span>
                {reduced ? (
                  <span className="text-[9px] font-mono uppercase tracking-wider text-slate-500">Motion off · system</span>
                ) : (
                  <button
                    onClick={onToggleMuted}
                    className="text-[9px] font-mono uppercase tracking-wider text-slate-400 hover:text-accent-400 transition-colors"
                  >
                    {muted ? 'Resume motion' : 'Pause motion'}
                  </button>
                )}
              </div>
              <ul className="max-h-56 overflow-y-auto custom-scrollbar py-1">
                {events.length === 0 && (
                  <li className="px-3 py-4 text-center text-[10px] text-slate-500">No swarm activity yet.</li>
                )}
                {events.slice(0, 40).map((e, i) => (
                  <li key={e.id ?? i} className="flex gap-2 px-3 py-1.5">
                    <span className={`mt-1.5 shrink-0 w-1 h-1 rounded-full ${i === 0 ? 'bg-cyan-400' : 'bg-slate-600'}`} />
                    <div className="min-w-0">
                      <div className="text-[11px] leading-snug text-slate-200 break-words">{e.msg}</div>
                      <div className="text-[9px] font-mono text-slate-500">{ago(e.ts)}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="px-3 py-1.5 border-t border-slate-700/70 text-[9px] text-slate-500">
                Pausing only stills the swarm — events and errors always show.
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>
    </div>
  );
}
