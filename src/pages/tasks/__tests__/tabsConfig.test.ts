import { beforeEach, describe, expect, it } from 'vitest';
import {
  TAB_META,
  CLOSEABLE_TABS,
  loadHiddenTabs,
  saveHiddenTabs,
} from '../tabsConfig';

// Node env has no localStorage; install a fresh Map-backed polyfill per test.
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
});

describe('tab metadata', () => {
  it('Board is first and is NOT closeable; every other tab is closeable', () => {
    expect(TAB_META[0].id).toBe('board');
    expect(TAB_META.find(t => t.id === 'board')!.closeable).toBe(false);
    expect(CLOSEABLE_TABS).toEqual(['context', 'analytics', 'logs', 'db', 'agents']);
  });
});

describe('loadHiddenTabs / saveHiddenTabs', () => {
  it('round-trips closeable ids', () => {
    saveHiddenTabs(['logs', 'agents']);
    expect(loadHiddenTabs().sort()).toEqual(['agents', 'logs']);
  });

  it('returns [] when nothing stored', () => {
    expect(loadHiddenTabs()).toEqual([]);
  });

  it('never persists the non-closeable Board tab', () => {
    saveHiddenTabs(['board' as any, 'logs']);
    expect(loadHiddenTabs()).toEqual(['logs']);
    expect(loadHiddenTabs()).not.toContain('board');
  });

  it('drops unknown/corrupt ids on read', () => {
    localStorage.setItem('mc.hiddenTabs', JSON.stringify(['logs', 'nope', 42]));
    expect(loadHiddenTabs()).toEqual(['logs']);
  });

  it('tolerates malformed JSON without throwing', () => {
    localStorage.setItem('mc.hiddenTabs', '{not json');
    expect(loadHiddenTabs()).toEqual([]);
  });
});
