import React, { useEffect, useState } from 'react';
import { CirclePause } from 'lucide-react';
import { API_BASE } from '../../../apiBase';
import { useProjects } from '../projectContext';

export function BudgetBanner() {
  const { activeId } = useProjects();
  const [status, setStatus] = useState<{ over: boolean, cap: number } | null>(null);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(activeId)}/budget-status`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled && data.over) setStatus({ over: true, cap: data.cap });
        else if (!cancelled) setStatus(null);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    poll();
    const iv = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [activeId]);

  if (!status?.over) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-rose-100 text-rose-900 text-2xs font-bold"
    >
      <CirclePause size={13} aria-hidden="true" />
      <span>Daily project budget (${status.cap}) reached · swarm paused until tomorrow</span>
    </div>
  );
}

export default BudgetBanner;
