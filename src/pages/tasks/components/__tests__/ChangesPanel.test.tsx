// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ChangesPanel } from '../ChangesPanel';

/**
 * The Changes panel is how a human approves a NON-VISUAL task — there is no preview to look
 * at, so the diff + QA verdict is the artifact. These pin the plan's acceptance criteria
 * against a mocked `/changes` response (no live branch or db-server needed).
 */

const CHANGES = {
  ok: true,
  exists: true,
  base: 'vps-dev',
  branch: 'task/WF-SLUG-1783720669',
  commits: [{ sha: '823bf16', subject: 'Add slugify(text) utility with unit tests' }],
  files: [
    { path: 'src/utils/index.ts', status: 'M', additions: 2, deletions: 0 },
    { path: 'src/utils/slugify.ts', status: 'A', additions: 7, deletions: 0 },
    { path: 'src/utils/slugify.test.ts', status: 'A', additions: 42, deletions: 0 },
  ],
  diff: 'diff --git a/src/utils/slugify.ts b/src/utils/slugify.ts\n@@ -0,0 +1,7 @@\n+export function slugify(s: string) {\n-const dead = true;\n',
  truncated: false,
  qaVerdict: 'pass' as const,
  summary: 'Accepted. Commit 823bf16 adds a pure slugify().',
};

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body } as Response);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { vi.stubGlobal('fetch', mockFetch(CHANGES)); });

describe('ChangesPanel', () => {
  it('lists the files with status + counts and renders added vs removed lines distinctly', async () => {
    render(<ChangesPanel taskId="T1" />);
    await screen.findByText('src/utils/slugify.ts');
    expect(screen.getByText('src/utils/index.ts')).toBeTruthy();
    expect(screen.getByText('src/utils/slugify.test.ts')).toBeTruthy();
    // added vs removed lines carry different colour classes (emerald vs rose)
    const added = screen.getByText('+export function slugify(s: string) {');
    const removed = screen.getByText('-const dead = true;');
    expect(added.className).toContain('emerald');
    expect(removed.className).toContain('rose');
    expect(added.className).not.toEqual(removed.className);
  });

  it('shows QA passed / failed / not verified per verdict', async () => {
    render(<ChangesPanel taskId="T1" />);
    expect(await screen.findByText('QA passed')).toBeTruthy();
    cleanup();

    vi.stubGlobal('fetch', mockFetch({ ...CHANGES, qaVerdict: 'fail' }));
    render(<ChangesPanel taskId="T2" />);
    expect(await screen.findByText('QA failed')).toBeTruthy();
    cleanup();

    vi.stubGlobal('fetch', mockFetch({ ...CHANGES, qaVerdict: null }));
    render(<ChangesPanel taskId="T3" />);
    expect(await screen.findByText('not verified')).toBeTruthy();
  });

  it('shows an empty state (not an error) when the task has no branch', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: true, exists: false, base: '', branch: '', commits: [], files: [], diff: '', truncated: false, qaVerdict: null, summary: null }));
    render(<ChangesPanel taskId="T1" />);
    expect(await screen.findByText(/nothing has been built/i)).toBeTruthy();
    expect(screen.queryByText(/could not load/i)).toBeNull();
  });

  it('shows the truncation note when the diff was cut', async () => {
    vi.stubGlobal('fetch', mockFetch({ ...CHANGES, truncated: true }));
    render(<ChangesPanel taskId="T1" />);
    expect(await screen.findByText(/diff truncated/i)).toBeTruthy();
  });

  it('the diff container owns its own horizontal scroll (page body cannot scroll sideways)', async () => {
    render(<ChangesPanel taskId="T1" />);
    const added = await screen.findByText('+export function slugify(s: string) {');
    const pre = added.closest('pre')!;
    expect(pre.className).toContain('overflow-x-auto');
  });

  it('opens a full-screen overlay from the diff and closes it with Esc', async () => {
    render(<ChangesPanel taskId="T1" />);
    await screen.findByText('src/utils/slugify.ts');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /expand diff to full screen/i }));
    const overlay = await screen.findByRole('dialog');
    expect(overlay.getAttribute('aria-modal')).toBe('true');
    // the diff renders inside the overlay, not just the inline panel
    expect(overlay.textContent).toContain('+export function slugify(s: string) {');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows an inline error with a Retry that re-fetches on a failed response', async () => {
    const fail = mockFetch({}, false, 500);
    vi.stubGlobal('fetch', fail);
    render(<ChangesPanel taskId="T1" />);
    expect(await screen.findByText(/returned 500/i)).toBeTruthy();

    // Retry with a now-good response swaps the error for the panel.
    vi.stubGlobal('fetch', mockFetch(CHANGES));
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('src/utils/slugify.ts')).toBeTruthy());
  });
});
