// Base URL for the task-orchestrator API (the db-server on :6952).
// Configurable for remote / VPS deploys via VITE_API_BASE (set at build or serve time);
// defaults to localhost for local dev so nothing changes there.
//   e.g. on the VPS:  VITE_API_BASE=http://72.60.100.239:6952  (or your https domain)
// Default: talk to the db-server on port 6952 of the SAME host the page was served from.
// This makes LAN/remote access work out of the box (e.g. http://192.168.1.12:6951 →
// http://192.168.1.12:6952) without a hardcoded 127.0.0.1 that only works on the host box.
// Override explicitly with VITE_API_BASE for split-host / HTTPS / custom-port deploys.
function defaultApiBase(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:6952`;
  }
  return 'http://127.0.0.1:6952';
}
export const API_BASE: string = (import.meta as any).env?.VITE_API_BASE || defaultApiBase();

// ---- Active project plumbing -------------------------------------------------
// Every project-scoped API call carries `?project=<id>`. The active project id is
// persisted in localStorage so a fetch fired from anywhere (hooks, panels, polls)
// resolves the same project without prop-drilling the id into every call site.
export const ACTIVE_PROJECT_KEY = 'mc.activeProject';
export const DEFAULT_PROJECT = 'default';

export function getActiveProject(): string {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT;
  } catch {
    return DEFAULT_PROJECT;
  }
}

export function setActiveProject(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id || DEFAULT_PROJECT);
  } catch {
    /* ignore storage failures (private mode etc.) */
  }
}

// Appends `project=<active>` to a path/URL, preserving any existing query string.
// Accepts a full URL or a bare path; only the query is touched.
export function withProject(path: string, projectId: string = getActiveProject()): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}project=${encodeURIComponent(projectId)}`;
}

// URL for an id-terminal task route (PUT/DELETE /tasks/:id). Deliberately NOT
// project-scoped: the db-server folds a trailing `?project=…` INTO the `:id`
// path param (it looks up `NEW-XYZ?project=default` and 500s "Task not found").
// Task ids are globally unique, so the bare, encoded id addresses the row safely.
// Do not wrap this in withProject().
export function taskItemUrl(id: string): string {
  return `${API_BASE}/tasks/${encodeURIComponent(id)}`;
}
