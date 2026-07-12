import React, { useEffect, useState } from 'react';
import { CirclePause } from 'lucide-react';
import { API_BASE } from '../../../apiBase';

// ── Release 1 P0 item 8 (UI): plan-limit pause banner ──
// When the Claude plan usage limit is hit, the orchestrator pauses the swarm and persists
// the resume time; GET /agent-status surfaces it as `limitPausedUntil` (ISO timestamp;
// null or past = not paused). This banner is the page-wide signal for that state, visually
// parallel to the offline banner in TasksPage but AMBER: it means "paused, will resume",
// never "broken". It must NEVER false-alarm — a missing field, an unparseable value, a
// non-ok response, or a failed fetch all render nothing.
//
// Two clocks, deliberately separate:
//  • a 10-second poll owns the SERVER truth (is the swarm paused, and until when);
//  • a 1-second tick owns only the countdown text — it never refetches.
//
// The 1-second updates must not spam screen readers: the container is a polite live region
// whose accessible name (aria-label) carries only the stable resume time, and the visible
// countdown lives in an aria-hidden span, so it repaints silently.

/** Compact remaining-time string: >= 2 min → "32 min", under 2 min → "90 sec". */
function compactRemaining(ms: number): string {
  if (ms >= 120_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.ceil(ms / 1000)} sec`;
}

export function LimitBanner() {
  // Epoch ms of the resume time, or null when not paused (which is also every error path).
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  // Re-render clock for the countdown text; only ticks while paused.
  const [now, setNow] = useState(() => Date.now());

  // Poll the server truth every 10 s. Guard against setState after unmount.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/agent-status`);
        if (!res.ok) throw new Error(`agent-status ${res.status}`);
        const data = await res.json();
        const ts = typeof data?.limitPausedUntil === 'string' ? Date.parse(data.limitPausedUntil) : NaN;
        // Only a well-formed FUTURE timestamp pauses the banner into view; a past value from
        // the server means the pause is over even if the field hasn't been cleared yet.
        if (!cancelled) setPausedUntil(Number.isFinite(ts) && ts > Date.now() ? ts : null);
      } catch {
        if (!cancelled) setPausedUntil(null);
      }
    };
    poll();
    const iv = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Tick the countdown once per second — but only while a pause is showing.
  useEffect(() => {
    if (pausedUntil === null) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [pausedUntil]);

  if (pausedUntil === null) return null;

  const resumeAt = new Date(pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const remainingMs = pausedUntil - now;
  // If the deadline passes while mounted, hold "resuming…" until the next poll observes the
  // server clearing (or having outdated) the value — the banner then unmounts itself.
  const countdown = remainingMs > 0 ? `(in ${compactRemaining(remainingMs)})` : 'resuming…';

  return (
    <div
      role="status"
      aria-live="polite"
      // Stable accessible name: announce once, with the resume time only. The per-second
      // countdown lives in the aria-hidden span below so it never re-announces.
      aria-label={`Plan limit reached — swarm resumes ${resumeAt}`}
      data-feature-id="limit-banner"
      // amber-100/amber-900 rather than amber-500/white: the dark-on-light pair clears
      // WCAG AA contrast at this tiny size; white on amber-500 does not.
      className="shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-amber-100 text-amber-900 text-2xs font-bold"
    >
      <CirclePause size={13} aria-hidden="true" />
      <span>Plan limit reached · swarm resumes {resumeAt}</span>
      <span aria-hidden="true">{countdown}</span>
    </div>
  );
}

export default LimitBanner;
