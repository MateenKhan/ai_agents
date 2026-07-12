import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ClipboardList, Network, Palette, Code2 } from 'lucide-react';
import { API_BASE, withProject } from '../../apiBase';
import { useProjects } from '../../pages/tasks/projectContext';

// ─────────────────────────────────────────────────────────────────────────────
// StudioNavbar — the universal top app bar shared by the four persona studios.
//
//   left   : Piranha brand mark + the active project badge
//   center : one tab per studio — Swarm Board /tasks, Architecture Canvas /canvas,
//            Visual React Studio /designer, Code IDE /ide
//   right  : live backend health dot
//
// Navigation is react-router <NavLink>s, so the active tab carries
// aria-current="page" for free and every tab is a real anchor — natively
// keyboard-reachable, middle-clickable, bookmarkable.
//
// Health reuses the SAME source the status widgets already poll —
// GET {API_BASE}/system-status via withProject() (see OrchestratorToggle /
// TankStatusBar) on the same light 4-second cadence. No new fetch layer:
// "up" means the db-server answered, exactly like the rest of the app.
// ─────────────────────────────────────────────────────────────────────────────

const STUDIOS = [
  { to: '/tasks', label: 'Swarm Board', icon: ClipboardList },
  { to: '/canvas', label: 'Architecture Canvas', icon: Network },
  { to: '/designer', label: 'Visual React Studio', icon: Palette },
  { to: '/ide', label: 'Code IDE', icon: Code2 },
] as const;

// The API host shown beside the dot (e.g. "127.0.0.1:6952") — derived from the one
// configured base, so the label can never disagree with where the poll actually goes.
const API_HOST = API_BASE.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

/** null = first poll still in flight; then true/false tracks reachability. */
function useBackendHealth(): boolean | null {
  const [up, setUp] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const r = await fetch(withProject(`${API_BASE}/system-status`));
        if (alive) setUp(r.ok);
      } catch {
        if (alive) setUp(false);
      }
    };
    ping();
    const iv = setInterval(ping, 4000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  return up;
}

function HealthDot() {
  const up = useBackendHealth();
  const state = up === null
    ? { dot: 'bg-slate-300', text: 'text-slate-400', label: 'checking…' }
    : up
      ? { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'UP' }
      : { dot: 'bg-rose-500', text: 'text-rose-700', label: 'DOWN' };
  return (
    <span
      data-feature-id="studio-health"
      role="status"
      aria-label={`Backend ${API_HOST} API: ${state.label}`}
      title={`db-server at ${API_HOST}`}
      className={`flex items-center gap-1.5 text-micro font-bold whitespace-nowrap ${state.text}`}
    >
      <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${state.dot}`} />
      <span className="hidden md:inline font-mono font-normal text-slate-500">{API_HOST}</span>
      <span>API: {state.label}</span>
    </span>
  );
}

export function StudioNavbar() {
  const { projects, activeId } = useProjects();
  const activeProject = projects.find(p => p.id === activeId);

  return (
    <nav
      aria-label="Studios"
      data-feature-id="studio-navbar"
      className="shrink-0 flex items-center gap-3 px-2 sm:px-3 min-h-control bg-white border-b border-slate-200"
    >
      {/* Brand + active project. Same teeth mark as the board header — tier-1 identity,
          the only accent red on this bar besides the active tab's ink. */}
      <div className="shrink-0 flex items-center gap-2 pr-3 border-r border-slate-200">
        <svg viewBox="0 0 100 100" aria-hidden="true" className="w-5 h-5 rounded shrink-0">
          <rect width="100" height="100" rx="22" fill="#0A0E14" />
          <g fill="#FF3B1D">
            <path d="M18 28 L28 54 L38 28 Z" /><path d="M36 28 L46 54 L56 28 Z" /><path d="M54 28 L64 54 L74 28 Z" />
            <path d="M27 74 L37 48 L47 74 Z" /><path d="M45 74 L55 48 L65 74 Z" /><path d="M63 74 L73 48 L83 74 Z" />
          </g>
        </svg>
        <span className="text-xs font-bold text-slate-900 tracking-tight whitespace-nowrap">Piranha</span>
        {activeProject && (
          <span
            data-feature-id="studio-project-badge"
            title={activeProject.name}
            className="hidden sm:flex items-center gap-1 max-w-[160px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-micro font-bold text-slate-600"
          >
            {activeProject.emoji && <span aria-hidden="true">{activeProject.emoji}</span>}
            <span className="truncate">{activeProject.name}</span>
          </span>
        )}
      </div>

      {/* Studio tabs. NavLink stamps aria-current="page" on the active one; /tasks
          deliberately has no `end`, so /tasks/analytics etc. keep the board tab lit. */}
      <div className="flex-1 min-w-0 flex items-center justify-start lg:justify-center gap-1 overflow-x-auto">
        {STUDIOS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            data-feature-id={`studio-tab-${to.slice(1)}`}
            className={({ isActive }) =>
              `shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-micro font-bold uppercase tracking-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 ${
                isActive
                  ? 'bg-accent-50 border-accent-200 text-accent-700'
                  : 'border-transparent text-slate-500 sm:hover:text-slate-900 sm:hover:bg-slate-50'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={14} aria-hidden="true" className={isActive ? 'text-accent-600' : ''} />
                <span className="whitespace-nowrap">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>

      <div className="shrink-0 pl-3 border-l border-slate-200">
        <HealthDot />
      </div>
    </nav>
  );
}

export default StudioNavbar;
