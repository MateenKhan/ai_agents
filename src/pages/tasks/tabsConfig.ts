import { LayoutGrid, BarChart3, ScrollText, Database, Bot, BrainCircuit, Activity, type LucideIcon } from 'lucide-react';

// The main nav tabs. `closeable` tabs show an X that HIDES them (they're restored
// from Settings → Visible Tabs, never deleted). Board is the home view and can
// never be hidden, so it has no close affordance.
//
// Search is NOT a tab. It lives inside Context as a segmented view: both read the same
// per-project code index, and "what does the swarm know about this repo" is one question,
// not two. The /tasks/search deep link still works — it opens Context on the Search view.
export type TabId = 'board' | 'context' | 'analytics' | 'events' | 'logs' | 'db' | 'agents';

export interface TabMeta {
  id: TabId;
  label: string;
  icon: LucideIcon;
  closeable: boolean;
}

export const TAB_META: TabMeta[] = [
  { id: 'board',     label: 'Board',     icon: LayoutGrid,   closeable: false },
  { id: 'context',   label: 'Context',   icon: BrainCircuit, closeable: true },
  { id: 'analytics', label: 'Analytics', icon: BarChart3,    closeable: true },
  { id: 'events',    label: 'Events',    icon: Activity,   closeable: true },
  { id: 'logs',      label: 'Logs',      icon: ScrollText, closeable: true },
  { id: 'db',        label: 'Database',  icon: Database,   closeable: true },
  { id: 'agents',    label: 'Agents',    icon: Bot,        closeable: true },
];

export const CLOSEABLE_TABS: TabId[] = TAB_META.filter(t => t.closeable).map(t => t.id);

const KEY = 'mc.hiddenTabs';

// Only closeable ids are ever persisted — this guarantees Board (and any unknown
// legacy id) can never end up hidden even if storage is hand-edited or corrupted.
export function loadHiddenTabs(): TabId[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.filter((x): x is TabId => CLOSEABLE_TABS.includes(x));
  } catch { /* ignore parse/storage errors */ }
  return [];
}

export function saveHiddenTabs(ids: TabId[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.filter(id => CLOSEABLE_TABS.includes(id))));
  } catch { /* ignore quota/denied */ }
}
