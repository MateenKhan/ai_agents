// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ChangesPanel } from '../ChangesPanel';

/**
 * Complements ChangesPanel.test.tsx with the states it does not cover: the in-flight loading
 * state before the fetch settles, and the error/retry path when the fetch itself THROWS (the
 * sibling test covers a non-ok RESPONSE; this covers the catch branch). Same fetch-mock pattern.
 */

const CHANGES = {
  ok: true,
  exists: true,
  base: 'vps-dev',
  branch: 'task/WF-SLUG-1783720669',
  commits: [{ sha: '823bf16', subject: 'Add slugify(text) utility with unit tests' }],
  files: [{ path: 'src/utils/slugify.ts', status: 'A', additions: 7, deletions: 0 }],
  diff: 'diff --git a/src/utils/slugify.ts b/src/utils/slugify.ts\n@@ -0,0 +1,7 @@\n+export function slugify(s: string) {\n',
  truncated: false,
  qaVerdict: 'pass' as const,
  summary: null,
  journal: [],
};

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body } as Response);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ChangesPanel states', () => {
  it('shows the loading state while the fetch is still in flight', async () => {
    // A fetch that never settles keeps the component in its loading branch.
    let resolveFetch!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => pending));

    render(<ChangesPanel taskId="T1" />);
    expect(screen.getByText(/loading changes/i)).toBeTruthy();
    // neither the loaded panel nor an error is shown yet
    expect(screen.queryByText('src/utils/slugify.ts')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();

    // Settle so the component reaches its resolved state (avoids an act warning on unmount).
    resolveFetch({ ok: true, status: 200, json: async () => CHANGES } as Response);
    await screen.findByText('src/utils/slugify.ts');
  });

  it('a thrown fetch shows an error with a Retry, and Retry re-fetches successfully', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    render(<ChangesPanel taskId="T1" />);

    // the thrown message surfaces, and a retry affordance is offered
    expect(await screen.findByText(/network down/i)).toBeTruthy();
    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeTruthy();

    // clicking Retry against a now-healthy endpoint swaps the error for the loaded panel
    vi.stubGlobal('fetch', mockFetch(CHANGES));
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText('src/utils/slugify.ts')).toBeTruthy());
    expect(screen.queryByText(/network down/i)).toBeNull();
  });

  it('a Retry that fails again keeps the error state and its Retry affordance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('still offline'); }));
    render(<ChangesPanel taskId="T1" />);
    await screen.findByText(/still offline/i);

    vi.stubGlobal('fetch', mockFetch({}, false, 500));
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    // a non-ok response is thrown by the panel and re-shown as an error with Retry still present
    await waitFor(() => expect(screen.getByText(/returned 500/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });
});
