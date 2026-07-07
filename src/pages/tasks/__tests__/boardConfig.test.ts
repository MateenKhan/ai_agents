import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadColumns,
  saveColumns,
  makeColumnId,
  DEFAULT_COLUMNS,
  BUILTIN_COLUMNS,
  BOARD_COLUMNS_EVENT,
} from '../boardConfig';
import type { Column } from '../types';

// vitest env is `node` — no localStorage and no DOM. boardConfig reads localStorage
// lazily and guards window access in try/catch, so minimal in-memory polyfills suffice.
// Fresh store + a tiny window event bus are reinstalled before every test for isolation.
let store: Map<string, string>;
let listeners: Record<string, ((e: any) => void)[]>;

beforeEach(() => {
  store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };

  listeners = {};
  (globalThis as any).CustomEvent = class {
    type: string; detail: any;
    constructor(type: string, init?: { detail?: any }) { this.type = type; this.detail = init?.detail; }
  };
  (globalThis as any).window = {
    addEventListener: (t: string, cb: (e: any) => void) => { (listeners[t] ||= []).push(cb); },
    removeEventListener: (t: string, cb: (e: any) => void) => { listeners[t] = (listeners[t] || []).filter(f => f !== cb); },
    dispatchEvent: (e: any) => { (listeners[e.type] || []).forEach(cb => cb(e)); return true; },
  };
});

const KEY = (pid: string) => `board.columns:${pid}`;
const custom = (label: string): Column => ({ id: `CUSTOM_${label.toUpperCase()}`, label, color: '#123456' });

describe('DEFAULT_COLUMNS', () => {
  it('is the 4 default lanes in canonical order, hiding BLOCKED and TESTING', () => {
    expect(DEFAULT_COLUMNS.map(c => c.id)).toEqual(['TODO', 'AVAILABLE', 'WORKING', 'DONE']);
    expect(DEFAULT_COLUMNS.every(c => c.builtin)).toBe(true);
  });
});

describe('BUILTIN_COLUMNS', () => {
  it('is the full 6-lane catalog', () => {
    expect(BUILTIN_COLUMNS.map(c => c.id)).toEqual(['TODO', 'AVAILABLE', 'WORKING', 'BLOCKED', 'TESTING', 'DONE']);
  });
});

describe('loadColumns', () => {
  it('returns DEFAULT_COLUMNS when nothing is stored', () => {
    expect(loadColumns('default')).toEqual(DEFAULT_COLUMNS);
    expect(loadColumns('proj_x')).toEqual(DEFAULT_COLUMNS);
  });

  it('round-trips a saved config for the same project', () => {
    const cols = [...DEFAULT_COLUMNS, custom('Parked')];
    saveColumns('proj_a', cols);
    expect(loadColumns('proj_a')).toEqual(cols);
  });

  it('keeps each project isolated', () => {
    const a = [DEFAULT_COLUMNS[0]];
    const b = [DEFAULT_COLUMNS[1], custom('B')];
    saveColumns('proj_a', a);
    saveColumns('proj_b', b);
    expect(loadColumns('proj_a')).toEqual(a);
    expect(loadColumns('proj_b')).toEqual(b);
    expect(loadColumns('proj_c')).toEqual(DEFAULT_COLUMNS); // untouched project
  });

  it('treats empty/whitespace projectId as the default project', () => {
    saveColumns('', [custom('Empty')]);
    expect(store.has(KEY('default'))).toBe(true);
    expect(loadColumns('default')).toEqual([custom('Empty')]);
  });

  it('falls back to default when stored JSON is corrupt', () => {
    store.set(KEY('proj_a'), '{not json');
    expect(loadColumns('proj_a')).toEqual(DEFAULT_COLUMNS);
  });

  it('falls back to default when stored array has no valid columns', () => {
    store.set(KEY('proj_a'), JSON.stringify([{ nope: 1 }, 'garbage']));
    expect(loadColumns('proj_a')).toEqual(DEFAULT_COLUMNS);
  });

  it('drops malformed entries but keeps valid columns', () => {
    const good = custom('Good');
    store.set(KEY('proj_a'), JSON.stringify([good, { id: 'x' /* missing label/color */ }]));
    expect(loadColumns('proj_a')).toEqual([good]);
  });
});

describe('legacy migration (default project only)', () => {
  it('migrates the old un-namespaced full-column format', () => {
    const legacy = [DEFAULT_COLUMNS[0], custom('Legacy')];
    store.set('board.columns', JSON.stringify(legacy));
    expect(loadColumns('default')).toEqual(legacy);
  });

  it('migrates the older visible-ids format into columns', () => {
    store.set('board.visibleColumns', JSON.stringify(['WORKING', 'DONE']));
    expect(loadColumns('default').map(c => c.id)).toEqual(['WORKING', 'DONE']);
  });

  it('prefers the newer full-column legacy over the visible-ids legacy', () => {
    store.set('board.columns', JSON.stringify([custom('Full')]));
    store.set('board.visibleColumns', JSON.stringify(['TODO']));
    expect(loadColumns('default')).toEqual([custom('Full')]);
  });

  it('does NOT apply legacy formats to a non-default project', () => {
    store.set('board.columns', JSON.stringify([custom('Legacy')]));
    store.set('board.visibleColumns', JSON.stringify(['TODO']));
    expect(loadColumns('proj_a')).toEqual(DEFAULT_COLUMNS);
  });

  it('a project-specific save wins over any legacy value', () => {
    store.set('board.columns', JSON.stringify([custom('Legacy')]));
    const own = [custom('Own')];
    saveColumns('default', own);
    expect(loadColumns('default')).toEqual(own);
  });
});

describe('saveColumns', () => {
  it('persists under the per-project key', () => {
    saveColumns('proj_a', DEFAULT_COLUMNS);
    expect(store.get(KEY('proj_a'))).toBe(JSON.stringify(DEFAULT_COLUMNS));
  });

  it('dispatches BOARD_COLUMNS_EVENT with the projectId', () => {
    const seen: string[] = [];
    (globalThis as any).window.addEventListener(BOARD_COLUMNS_EVENT, (e: any) => seen.push(e.detail.projectId));
    saveColumns('proj_a', DEFAULT_COLUMNS);
    saveColumns('', DEFAULT_COLUMNS); // empty → default
    expect(seen).toEqual(['proj_a', 'default']);
  });
});

describe('makeColumnId', () => {
  it('slugifies a label into a CUSTOM_ id', () => {
    expect(makeColumnId('In Review')).toBe('CUSTOM_IN_REVIEW');
    expect(makeColumnId('  needs   QA!! ')).toBe('CUSTOM_NEEDS_QA');
  });

  it('produces a non-empty id for label with no alphanumerics', () => {
    const id = makeColumnId('!!!');
    expect(id.startsWith('CUSTOM_')).toBe(true);
    expect(id.length).toBeGreaterThan('CUSTOM_'.length);
  });
});
