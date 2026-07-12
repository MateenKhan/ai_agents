// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StartScreen } from '../StartScreen';
import { SETUP_DONE_KEY } from '../useSetupGate';

// StartScreen activates the project /git/clone (or /git/init-repo) creates; stub the
// project context so no ProjectProvider (and no /projects poll) is needed in the tree.
const ctx = vi.hoisted(() => ({
  refreshProjects: vi.fn(async () => []),
  setActiveId: vi.fn(),
}));
vi.mock('../../tasks/projectContext', () => ({ useProjects: () => ctx }));

interface RecordedCall { url: string; method: string; body: any }
let fetchCalls: RecordedCall[] = [];

/** Fetch stub covering every endpoint the screen touches; behavior tweaked per test. */
function installFetch(opts: { initRepoStatus?: number; tokens?: Array<{ id: string; label: string }> } = {}) {
  const json = (status: number, payload: any) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as Response;
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    fetchCalls.push({ url, method, body });
    if (url.includes('/agent-defaults') && method === 'GET')
      return json(200, { maxConcurrency: 0, permissionProfile: 'standard', taskCapUsd: 2, dailyCapUsd: 25 });
    if (url.includes('/agent-defaults') && method === 'PUT') return json(200, { ok: true });
    if (url.includes('/git/tokens')) return json(200, { ok: true, tokens: opts.tokens ?? [] });
    if (url.includes('/git/clone-progress')) return json(200, { lines: [], done: false, ok: null });
    if (url.includes('/git/clone'))
      return json(200, { ok: true, dir: 'C:/projects/demo', project: { id: 'p-demo' } });
    if (url.includes('/git/init-repo')) {
      if (opts.initRepoStatus === 404) return json(404, { error: 'not found' });
      return json(200, { ok: true, dir: 'C:/code/my-app', project: { id: 'p-new' } });
    }
    return json(200, { ok: true });
  }));
}

const cloneCall = () =>
  fetchCalls.find(c => c.method === 'POST' && c.url.includes('/git/clone') && !c.url.includes('progress'));

beforeEach(() => {
  fetchCalls = [];
  localStorage.clear();
  ctx.refreshProjects.mockClear();
  ctx.setActiveId.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StartScreen', () => {
  it('renders the three setup paths and the workspace settings', async () => {
    installFetch();
    render(<StartScreen onDone={() => {}} />);
    expect(screen.getByText('Welcome to Piranha')).toBeTruthy();
    expect(screen.getByText('Clone a repository')).toBeTruthy();
    expect(screen.getByText('Start in a new folder')).toBeTruthy();
    expect(screen.getByText(/skip — use the folder piranha started in/i)).toBeTruthy();
    expect(screen.getByLabelText('Max concurrent agents')).toBeTruthy();
    expect(screen.getByLabelText('Permission profile')).toBeTruthy();
    // Prefill lands from GET /agent-defaults without crashing.
    await waitFor(() =>
      expect(fetchCalls.some(c => c.method === 'GET' && c.url.includes('/agent-defaults'))).toBe(true));
  });

  it('clone posts the exact /git/clone body (url + dir + branch + tokenId) then finishes', async () => {
    installFetch({ tokens: [{ id: 'tok1', label: 'My PAT' }] });
    const onDone = vi.fn();
    render(<StartScreen onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/repository url/i), {
      target: { value: 'https://github.com/acme/demo.git' },
    });
    fireEvent.change(screen.getByLabelText(/branch/i), { target: { value: 'develop' } });
    fireEvent.change(screen.getByLabelText(/^folder/i), { target: { value: 'demo-folder' } });
    await screen.findByRole('option', { name: 'My PAT' });
    fireEvent.change(screen.getByLabelText(/access token/i), { target: { value: 'tok1' } });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(cloneCall()!.body).toEqual({
      url: 'https://github.com/acme/demo.git',
      dir: 'demo-folder',
      branch: 'develop',
      tokenId: 'tok1',
    });
    expect(ctx.setActiveId).toHaveBeenCalledWith('p-demo');
    expect(localStorage.getItem(SETUP_DONE_KEY)).toBe('1');
  });

  it('derives the clone folder from the URL and omits empty optionals', async () => {
    installFetch();
    const onDone = vi.fn();
    render(<StartScreen onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/repository url/i), {
      target: { value: 'https://github.com/acme/widgets.git' },
    });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // JSON.stringify drops undefined — branch/tokenId must be absent, dir derived.
    expect(cloneCall()!.body).toEqual({ url: 'https://github.com/acme/widgets.git', dir: 'widgets' });
  });

  it('saves workspace settings via PUT /agent-defaults when skipping', async () => {
    installFetch();
    const onDone = vi.fn();
    render(<StartScreen onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Max concurrent agents'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Permission profile'), { target: { value: 'strict' } });
    fireEvent.click(screen.getByText(/skip — use the folder piranha started in/i));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const put = fetchCalls.find(c => c.method === 'PUT' && c.url.includes('/agent-defaults'));
    expect(put!.body).toEqual({
      maxConcurrency: 3, permissionProfile: 'strict', taskCapUsd: 2, dailyCapUsd: 25,
    });
    expect(localStorage.getItem(SETUP_DONE_KEY)).toBe('1');
  });

  it('new-folder posts { dir, name } to /git/init-repo and finishes', async () => {
    installFetch();
    const onDone = vi.fn();
    render(<StartScreen onDone={onDone} />);
    fireEvent.click(screen.getByText('Start in a new folder'));
    fireEvent.change(screen.getByLabelText(/folder path/i), { target: { value: 'C:/code/my-app' } });
    fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: 'My App' } });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const init = fetchCalls.find(c => c.method === 'POST' && c.url.includes('/git/init-repo'));
    expect(init!.body).toEqual({ dir: 'C:/code/my-app', name: 'My App' });
    expect(ctx.setActiveId).toHaveBeenCalledWith('p-new');
  });

  it('shows "backend update required" when /git/init-repo 404s, and does not finish', async () => {
    installFetch({ initRepoStatus: 404 });
    const onDone = vi.fn();
    render(<StartScreen onDone={onDone} />);
    fireEvent.click(screen.getByText('Start in a new folder'));
    fireEvent.change(screen.getByLabelText(/folder path/i), { target: { value: 'C:/code/my-app' } });
    fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: 'My App' } });
    fireEvent.click(screen.getByText('Continue'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/backend update required/i);
    expect(onDone).not.toHaveBeenCalled();
    expect(localStorage.getItem(SETUP_DONE_KEY)).toBeNull();
  });
});
