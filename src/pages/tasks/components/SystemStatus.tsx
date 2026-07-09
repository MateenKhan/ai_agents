import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { DownloadCloud, Database, Bot, CheckCircle2, AlertTriangle, Activity, WifiOff, ChevronUp, ChevronDown, X, Trash2, ScrollText } from 'lucide-react';
import { API_BASE, withProject } from '../../../apiBase';
import { humanizeStatusMessage } from '../statusMessages';

interface OrchestratorInfo {
  agentStatus: string;
  statusLine: string;
  lastBeatAt: string;
  ageSec: number;
  up: boolean;
}
interface Counts { pending: number; working: number; testing: number; done: number }
interface OrchEvent { id?: number; ts: string | number; taskId?: string; msg: string; type?: string }

interface Status {
  activity: { kind: string; label: string; detail?: string; since: number };
  indexRebuilding?: boolean;
  boardCorrupt?: string | null;
  activeAgents?: string[];
  orchestrator?: OrchestratorInfo;
  counts?: Counts;
  events?: OrchEvent[];
}

// Icon + accent per activity kind. Anything long-running gets a pulsing dot.
function look(kind: string) {
  switch (kind) {
    case 'cloning': return { Icon: DownloadCloud, ring: 'text-sky-300', busy: true };
    case 'indexing': return { Icon: Database, ring: 'text-ai-300', busy: true };
    case 'agents': return { Icon: Bot, ring: 'text-emerald-300', busy: true };
    case 'idle': return { Icon: CheckCircle2, ring: 'text-slate-400', busy: false };
    default: return { Icon: Activity, ring: 'text-accent-300', busy: true };
  }
}

// Human-readable relative time, e.g. "12s ago", "3m ago", "2h ago".
function relTime(ts: string | number): string {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!t || Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// Subtle text color per event type.
function eventColor(type?: string): string {
  switch ((type || 'info').toLowerCase()) {
    case 'success': return 'text-emerald-300';
    case 'warning': return 'text-amber-300';
    case 'error': return 'text-rose-300';
    default: return 'text-slate-300';
  }
}
function eventDot(type?: string): string {
  switch ((type || 'info').toLowerCase()) {
    case 'success': return 'bg-emerald-400';
    case 'warning': return 'bg-amber-400';
    case 'error': return 'bg-rose-400';
    default: return 'bg-slate-400';
  }
}

export function SystemStatus({ activeId }: { activeId?: string }) {
  const navigate = useNavigate();
  const [s, setS] = useState<Status | null>(null);
  const [reachable, setReachable] = useState(true);
  const [open, setOpen] = useState(false);
  // Re-render every second so relative times stay fresh while the panel is open.
  const [, setTick] = useState(0);
  // Optimistically hide rows the moment they're deleted, before the next poll lands.
  const [removed, setRemoved] = useState<Set<number>>(new Set());

  const deleteEvent = async (id: number) => {
    setRemoved(prev => new Set(prev).add(id));
    try { await fetch(withProject(`${API_BASE}/system-status/events/${id}`), { method: 'DELETE' }); }
    catch { setRemoved(prev => { const n = new Set(prev); n.delete(id); return n; }); }
  };
  const clearEvents = async () => {
    try { await fetch(withProject(`${API_BASE}/system-status/events`), { method: 'DELETE' }); }
    catch { /* next poll reflects reality */ }
  };

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(withProject(`${API_BASE}/system-status`));
        const d = await r.json();
        if (alive) { setS(d); setReachable(true); }
      } catch { if (alive) setReachable(false); }
    };
    poll();
    const iv = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(iv); };
    // Re-poll against the new project when the active project changes.
  }, [activeId]);

  useEffect(() => {
    if (!open) return;
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, [open]);

  // db-server entirely unreachable — the network is down, not just the orchestrator.
  if (!reachable) {
    return (
      <div className="fixed bottom-3 right-3 z-[80] flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-600 text-white shadow-lg text-xs font-bold max-w-[90vw]">
        <WifiOff size={14} className="shrink-0" /> db-server offline
      </div>
    );
  }
  if (!s) return null;

  const corrupt = !!s.boardCorrupt;
  const act = s.activity || { kind: 'idle', label: 'Idle', since: Date.now() };
  const orch = s.orchestrator;
  const orchDown = !!orch && !orch.up;
  const activityActive = act.kind !== 'idle';

  // Primary line: live activity when something's happening, else the orchestrator's human status line.
  const primary = corrupt
    ? 'The task board file looks damaged — a repair may be needed.'
    : activityActive
      ? act.label
      : humanizeStatusMessage(orch?.statusLine || act.label);

  const { Icon, ring, busy } = corrupt
    ? { Icon: AlertTriangle, ring: 'text-rose-300', busy: true }
    : orchDown && !activityActive
      ? { Icon: WifiOff, ring: 'text-rose-300', busy: false }
      : look(act.kind);

  const shellClass = corrupt
    ? 'bg-rose-950/90 border-rose-700 text-rose-100'
    : orchDown && !activityActive
      ? 'bg-rose-950/90 border-rose-700 text-rose-100'
      : 'bg-slate-900/90 border-slate-700 text-slate-100';

  const counts = s.counts;
  const events = (s.events || []).filter(e => e.id == null || !removed.has(e.id)).slice(0, 10);

  return (
    <div className="fixed bottom-3 right-3 z-[80] w-[min(92vw,340px)]">
      {/* Expandable panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className="mb-2 rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur shadow-2xl overflow-hidden text-slate-100"
          >
            {/* Orchestrator heartbeat line */}
            {orch && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/70">
                <span className={`w-2 h-2 rounded-full shrink-0 ${orch.up ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                <span className="text-[11px] font-bold truncate flex-1">
                  {orch.up ? humanizeStatusMessage(orch.statusLine) || 'The task runner is up and running.' : 'The task runner is offline.'}
                </span>
                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                  {orch.agentStatus}{typeof orch.ageSec === 'number' ? ` · ${orch.ageSec}s` : ''}
                </span>
              </div>
            )}

            {/* Counts */}
            {counts && (
              <div className="grid grid-cols-4 gap-px bg-slate-700/60 border-b border-slate-700/70">
                {([
                  ['Pending', counts.pending, 'text-slate-300'],
                  ['Working', counts.working, 'text-accent-300'],
                  ['Testing', counts.testing, 'text-amber-300'],
                  ['Done', counts.done, 'text-emerald-300'],
                ] as const).map(([label, val, cls]) => (
                  <div key={label} className="flex flex-col items-center py-2 bg-slate-900/95">
                    <span className={`text-sm font-black leading-none ${cls}`}>{val ?? 0}</span>
                    <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold mt-1">{label}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Events feed header — jump to full logs + clear the DB-backed feed */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-700/70">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Recent events</span>
              <button
                onClick={() => { setOpen(false); navigate('/tasks/logs'); }}
                className="ml-auto flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-slate-100 transition-colors"
                title="Open the Logs tab"
              >
                <ScrollText size={12} /> Logs
              </button>
              {events.length > 0 && (
                <button
                  onClick={clearEvents}
                  className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-rose-300 transition-colors"
                  title="Delete all events from the feed (logs.db)"
                >
                  <Trash2 size={12} /> Clear
                </button>
              )}
            </div>

            {/* Events feed */}
            <div className="max-h-[42vh] sm:max-h-64 overflow-y-auto custom-scrollbar">
              {events.length === 0 ? (
                <div className="px-3 py-6 text-center text-[11px] text-slate-500">No recent orchestrator events.</div>
              ) : (
                <ul className="divide-y divide-slate-800">
                  {events.map((e, i) => (
                    <li key={e.id ?? i} className="group flex items-start gap-2 px-3 py-2">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${eventDot(e.type)}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-[11px] leading-snug ${eventColor(e.type)}`}>
                          {e.taskId && <span className="font-mono text-slate-500 mr-1">{String(e.taskId).slice(-6)}</span>}
                          {humanizeStatusMessage(e.msg)}
                        </p>
                        <span className="text-[9px] text-slate-500">{relTime(e.ts)}</span>
                      </div>
                      {e.id != null && (
                        <button
                          onClick={() => deleteEvent(e.id!)}
                          className="shrink-0 -mr-1 p-1 rounded text-slate-600 hover:text-rose-300 hover:bg-slate-800 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                          aria-label="Delete event"
                          title="Delete this event"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Always-on pill */}
      <button
        onClick={() => setOpen(o => !o)}
        data-feature-id="system-status-pill"
        aria-expanded={open}
        className={`w-full flex items-center gap-2.5 pl-2.5 pr-3 py-2 rounded-xl shadow-lg border backdrop-blur text-left transition-colors ${shellClass}`}
      >
        <span className="relative flex items-center justify-center w-6 h-6 shrink-0">
          {busy && <span className={`absolute inline-flex h-full w-full rounded-full opacity-30 animate-ping ${corrupt || orchDown ? 'bg-rose-400' : 'bg-accent-400'}`} />}
          <Icon size={16} className={ring} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold leading-tight truncate">{primary}</div>
          {activityActive && act.detail && !corrupt && (
            <div className="text-[10px] text-slate-400 font-mono truncate">{act.detail}</div>
          )}
          {!activityActive && orch && !corrupt && (
            <div className={`text-[10px] truncate ${orchDown ? 'text-rose-300' : 'text-slate-400'}`}>
              {orchDown ? `No response for ${orch.ageSec}s` : `Updated ${orch.ageSec}s ago`}
            </div>
          )}
        </div>
        {open ? <ChevronDown size={15} className="text-slate-400 shrink-0" /> : <ChevronUp size={15} className="text-slate-400 shrink-0" />}
      </button>
    </div>
  );
}

export default SystemStatus;
