import React, { useState } from 'react';
import { MoreHorizontal, RefreshCw, HeartPulse, MessageSquarePlus, Settings } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { iconBtn } from '../ui';

/**
 * Overflow menu for the board's low-frequency actions.
 *
 * Four icons used to sit loose in the action cluster. Three of them belong here, and the
 * fourth does not — the distinction is worth stating because "they look similar" is not a
 * grouping rule:
 *
 *  - Refresh board — the board already polls every 10s (useTasks.ts). A permanent icon for a
 *    thing that happens on its own is a permanent icon nobody needs.
 *  - Unstick — despite the adjacent circular arrow, this is not a refresh. It WRITES: resets
 *    stuck tasks, clears their leases, prunes orphan worktrees. Sitting one pixel from
 *    Refresh with a near-identical glyph, it was a mis-click waiting to happen. Here it gets
 *    a sentence saying what it does before you commit to it.
 *  - Chat intake — a second way to create a task. Real, but not the common one.
 *  - Settings — configuration, by definition not an action.
 *
 * Your Review stays OUT of this menu. It carries an unread count; a notification badge inside
 * a collapsed menu is a notification you will not see, which is the only job it has.
 */
export interface BoardMenuProps {
  onChat: () => void;
  onRefresh: () => void;
  onHeal: () => void;
  onSettings: () => void;
  refreshing?: boolean;
  healing?: boolean;
}

interface Item {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  busy?: boolean;
  featureId: string;
}

export function BoardMenu({ onChat, onRefresh, onHeal, onSettings, refreshing, healing }: BoardMenuProps) {
  const [open, setOpen] = useState(false);
  const run = (fn: () => void) => () => { setOpen(false); fn(); };

  const items: Item[] = [
    { icon: <MessageSquarePlus size={14} />, label: 'Describe work, get tasks', hint: 'Paste a message; intake splits it into scenarios.', onClick: run(onChat), featureId: 'tasks-chat-create' },
    { icon: <RefreshCw size={14} className={refreshing ? 'animate-spin text-accent-600' : ''} />, label: 'Refresh board', hint: 'Refetch now. The board also polls every 10s.', onClick: run(onRefresh), busy: refreshing, featureId: 'tasks-refresh' },
    { icon: <HeartPulse size={14} className={healing ? 'animate-pulse' : ''} />, label: 'Unstick stalled tasks', hint: 'Resets tasks whose agent died, and prunes orphan worktrees.', onClick: run(onHeal), busy: healing, featureId: 'tasks-heal' },
    { icon: <Settings size={14} />, label: 'Settings', hint: 'Agents, lanes, visible tabs, datastore.', onClick: run(onSettings), featureId: 'tasks-open-settings' },
  ];

  return (
    <div className="relative">
      <Tooltip label="More board actions">
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="More board actions"
          data-feature-id="tasks-board-menu"
          className={iconBtn}
        >
          <MoreHorizontal size={14} />
        </button>
      </Tooltip>

      {open && (
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 top-full mt-1.5 z-[75] w-64 p-1.5 rounded-xl border border-slate-200 bg-white shadow-xl">
            {items.map(it => (
              <button
                key={it.label}
                role="menuitem"
                onClick={it.onClick}
                disabled={it.busy}
                data-feature-id={it.featureId}
                className="w-full flex items-start gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                <span className="mt-0.5 shrink-0 text-slate-500">{it.icon}</span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-slate-800">{it.label}</span>
                  <span className="block text-2xs text-slate-500 leading-snug">{it.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
