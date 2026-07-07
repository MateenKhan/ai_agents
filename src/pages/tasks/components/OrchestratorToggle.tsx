import React, { useEffect, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { API_BASE, withProject } from '../../../apiBase';
import { Tooltip } from './Tooltip';

// Compact global orchestrator pill + pause/start toggle.
// Reads orchestrator state from /system-status (light 4s poll) and posts to /orchestrator/{pause,start}.
export function OrchestratorToggle() {
  const [orch, setOrch] = useState<{ agentStatus?: string; up?: boolean } | null>(null);
  const [reachable, setReachable] = useState(true);
  const [busy, setBusy] = useState(false);

  const poll = React.useCallback(async () => {
    try {
      const r = await fetch(withProject(`${API_BASE}/system-status`));
      const d = await r.json();
      setOrch(d.orchestrator ?? null);
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const iv = setInterval(poll, 4000);
    return () => clearInterval(iv);
  }, [poll]);

  const up = reachable && (orch?.up ?? false);
  const paused = (orch?.agentStatus ?? '').toUpperCase() === 'PAUSED';
  const down = !up;

  const state = down
    ? { dot: 'bg-rose-500', text: 'text-rose-700', bg: 'bg-rose-50 border-rose-300', label: 'Orchestrator down' }
    : paused
      ? { dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50 border-amber-300', label: 'Paused' }
      : { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-300', label: 'Running' };

  // When running → pause; otherwise (paused/down) → start.
  const willPause = up && !paused;

  const toggle = async () => {
    setBusy(true);
    try {
      await fetch(withProject(`${API_BASE}/orchestrator/${willPause ? 'pause' : 'start'}`), { method: 'POST' });
      await poll();
    } catch { /* offline — next poll reflects reality */ } finally {
      setBusy(false);
    }
  };

  return (
    <Tooltip label={`Orchestrator: ${state.label} — ${willPause ? 'click to pause' : 'click to start'}`}>
      <button
        onClick={toggle}
        disabled={busy}
        aria-label={willPause ? 'Pause orchestrator' : 'Start orchestrator'}
        data-feature-id="orchestrator-toggle"
        className={`flex items-center gap-1.5 px-2 min-h-[40px] rounded-lg border transition-colors ${state.bg} ${state.text} ${busy ? 'opacity-60 animate-pulse' : ''}`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${state.dot} ${up && !paused ? 'animate-pulse' : ''}`} />
        {willPause ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </button>
    </Tooltip>
  );
}

export default OrchestratorToggle;
