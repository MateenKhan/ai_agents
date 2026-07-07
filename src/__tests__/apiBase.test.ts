import { beforeEach, describe, expect, it } from 'vitest';
import {
  API_BASE,
  ACTIVE_PROJECT_KEY,
  DEFAULT_PROJECT,
  getActiveProject,
  setActiveProject,
  withProject,
  taskItemUrl,
} from '../apiBase';

// The vitest env is `node`, which has no `localStorage`. apiBase reads/writes it
// lazily inside the functions, so a minimal in-memory polyfill installed here is
// enough. We reinstall a fresh Map-backed store before every test for isolation.
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string): string | null =>
      store.has(key) ? (store.get(key) as string) : null,
    setItem: (key: string, value: string): void => {
      store.set(key, String(value));
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    clear: (): void => {
      store.clear();
    },
  };
});

describe('getActiveProject', () => {
  it("returns DEFAULT_PROJECT ('default') when nothing is stored", () => {
    expect(DEFAULT_PROJECT).toBe('default');
    expect(getActiveProject()).toBe(DEFAULT_PROJECT);
    expect(getActiveProject()).toBe('default');
  });
});

describe('setActiveProject', () => {
  it('persists the id under the storage key and getActiveProject reads it back', () => {
    setActiveProject('proj_x');
    expect(getActiveProject()).toBe('proj_x');
    // Persisted under the documented storage key.
    expect(localStorage.getItem(ACTIVE_PROJECT_KEY)).toBe('proj_x');
  });

  it('falls back to DEFAULT_PROJECT when given an empty id', () => {
    setActiveProject('');
    expect(getActiveProject()).toBe('default');
    expect(localStorage.getItem(ACTIVE_PROJECT_KEY)).toBe('default');
  });
});

describe('withProject', () => {
  it('appends ?project=<active> when the path has no existing query', () => {
    // active project is the default here
    expect(withProject('/tasks')).toBe('/tasks?project=default');
    expect(withProject('/tasks').endsWith('?project=default')).toBe(true);
  });

  it('appends &project=<active> (not a second ?) when a query already exists', () => {
    const result = withProject('/git/status?repo=/x');
    expect(result).toBe('/git/status?repo=/x&project=default');
    // Only one `?` in the whole string.
    expect(result.split('?').length - 1).toBe(1);
    expect(result.includes('&project=default')).toBe(true);
  });

  it('reflects the CURRENT active project', () => {
    expect(withProject('/tasks')).toBe('/tasks?project=default');
    setActiveProject('proj_a');
    expect(withProject('/tasks')).toBe('/tasks?project=proj_a');
    setActiveProject('proj_b');
    expect(withProject('/tasks')).toBe('/tasks?project=proj_b');
  });

  it('honours an explicit projectId argument over the active one', () => {
    setActiveProject('proj_active');
    expect(withProject('/tasks', 'proj_explicit')).toBe(
      '/tasks?project=proj_explicit',
    );
  });

  it('url-encodes the project id', () => {
    setActiveProject('a b/c');
    expect(withProject('/tasks')).toBe('/tasks?project=a%20b%2Fc');
  });

  it('handles a full URL (host is untouched, query appended to the query part)', () => {
    // withProject only looks for `?` to choose the separator; it does not parse
    // or care about the host. A full URL with no query gets `?project=...`.
    expect(withProject('http://host:6952/tasks')).toBe(
      'http://host:6952/tasks?project=default',
    );
    // A full URL that already has a query gets `&project=...`.
    expect(withProject('http://host:6952/git/status?repo=/x')).toBe(
      'http://host:6952/git/status?repo=/x&project=default',
    );
    // And it composes correctly with the real API_BASE prefix used in the app.
    const full = withProject(`${API_BASE}/tasks`);
    expect(full).toBe(`${API_BASE}/tasks?project=default`);
    expect(full.split('?').length - 1).toBe(1);
  });
});

describe('taskItemUrl (id-terminal PUT/DELETE routes)', () => {
  // Regression guard: the db-server folds a trailing `?project=…` INTO the :id
  // path param, 500ing "Task not found: NEW-XYZ?project=default". So id-terminal
  // task routes must NOT carry the project query. See taskItemUrl's comment.
  it('addresses /tasks/:id under API_BASE without any query string', () => {
    expect(taskItemUrl('NEW-KJFRQI')).toBe(`${API_BASE}/tasks/NEW-KJFRQI`);
  });

  it('never appends ?project — even with an active project set', () => {
    setActiveProject('proj_a');
    const url = taskItemUrl('SMOKE-1');
    expect(url).toBe(`${API_BASE}/tasks/SMOKE-1`);
    expect(url.includes('?')).toBe(false);
    expect(url.includes('project=')).toBe(false);
  });

  it('url-encodes ids that contain reserved characters', () => {
    expect(taskItemUrl('a/b?c')).toBe(`${API_BASE}/tasks/a%2Fb%3Fc`);
  });
});

describe('API_BASE', () => {
  it('is a non-empty string (defaults to the local db-server)', () => {
    expect(typeof API_BASE).toBe('string');
    expect(API_BASE.length).toBeGreaterThan(0);
  });
});
