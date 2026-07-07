import { COLUMNS, type Column } from './types';
import { DEFAULT_PROJECT } from '../../apiBase';

// Persisted, per-project board configuration. Each project keeps its own set/order/labels/
// colors of swimlanes in localStorage. Users can hide built-in lanes, rename/recolor them,
// and add custom lanes (parked columns the orchestrator ignores).
const keyFor = (projectId: string) => `board.columns:${projectId || DEFAULT_PROJECT}`;
const LEGACY_COLUMNS_KEY = 'board.columns';        // pre-per-project full-column format
const LEGACY_VISIBLE_KEY = 'board.visibleColumns'; // even older show/hide-ids format

/** Fired after saveColumns so open boards can live-refresh. detail = { projectId }. */
export const BOARD_COLUMNS_EVENT = 'board-columns-changed';

// Default board hides BLOCKED and TESTING — most work flows Todo → Available → In Progress → Done.
const DEFAULT_VISIBLE_IDS = ['TODO', 'AVAILABLE', 'WORKING', 'DONE'];

export const DEFAULT_COLUMNS: Column[] = COLUMNS.filter(c => DEFAULT_VISIBLE_IDS.includes(c.id));

// The re-add catalog for built-in lanes not currently on the board.
export const BUILTIN_COLUMNS: Column[] = COLUMNS;

function isColumn(x: any): x is Column {
  return x && typeof x.id === 'string' && typeof x.label === 'string' && typeof x.color === 'string';
}

function parseColumns(raw: string | null): Column[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const cols = parsed.filter(isColumn);
      if (cols.length > 0) return cols;
    }
  } catch { /* ignore */ }
  return null;
}

export function loadColumns(projectId: string): Column[] {
  try {
    const own = parseColumns(localStorage.getItem(keyFor(projectId)));
    if (own) return own;

    // One-time migration of the old un-namespaced formats onto the default project.
    if ((projectId || DEFAULT_PROJECT) === DEFAULT_PROJECT) {
      const legacyFull = parseColumns(localStorage.getItem(LEGACY_COLUMNS_KEY));
      if (legacyFull) return legacyFull;
      const legacyVisible = localStorage.getItem(LEGACY_VISIBLE_KEY);
      if (legacyVisible) {
        try {
          const ids = JSON.parse(legacyVisible);
          if (Array.isArray(ids) && ids.length > 0) {
            const cols = COLUMNS.filter(c => ids.includes(c.id));
            if (cols.length > 0) return cols;
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* fall through to default */ }
  return DEFAULT_COLUMNS;
}

export function saveColumns(projectId: string, cols: Column[]): void {
  try { localStorage.setItem(keyFor(projectId), JSON.stringify(cols)); } catch { /* ignore quota/denied */ }
  try {
    window.dispatchEvent(new CustomEvent(BOARD_COLUMNS_EVENT, { detail: { projectId: projectId || DEFAULT_PROJECT } }));
  } catch { /* non-browser env */ }
}

// Slugify a label into a stable custom status id, e.g. "In Review" → "CUSTOM_IN_REVIEW".
export function makeColumnId(label: string): string {
  const slug = label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `CUSTOM_${slug || Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
