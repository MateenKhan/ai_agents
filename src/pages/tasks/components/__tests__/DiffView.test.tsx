// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DiffView } from '../DiffView';

/**
 * DiffView is the single unified-diff renderer in the app (GitPanel + the review-gate Changes
 * panel share it). These pin its colour rules — added/removed/hunk/file-header lines each get a
 * distinct class — and the invariant that the diff owns its own horizontal scroll so a long line
 * never scrolls the page body.
 */

const LONG_MARKER = 'LONGLINEMARKER';
const longLine = ` ${LONG_MARKER}${'x'.repeat(400)}`;

const DIFF = [
  'diff --git a/file.txt b/file.txt',
  'index 1111111..2222222 100644',
  '--- a/file.txt',
  '+++ b/file.txt',
  '@@ -1,2 +1,2 @@',
  '+foo',
  '-bar',
  longLine,
].join('\n');

afterEach(() => cleanup());

describe('DiffView colourisation', () => {
  it('renders an added line with the added (emerald) style', () => {
    render(<DiffView diff={DIFF} />);
    const added = screen.getByText('+foo');
    expect(added.className).toContain('emerald');
  });

  it('renders a removed line with the removed (rose) style', () => {
    render(<DiffView diff={DIFF} />);
    const removed = screen.getByText('-bar');
    expect(removed.className).toContain('rose');
  });

  it('gives the added and removed lines visibly different styles', () => {
    render(<DiffView diff={DIFF} />);
    const added = screen.getByText('+foo');
    const removed = screen.getByText('-bar');
    expect(added.className).not.toEqual(removed.className);
  });

  it('renders the hunk header (@@) with its own distinct style', () => {
    render(<DiffView diff={DIFF} />);
    const hunk = screen.getByText('@@ -1,2 +1,2 @@');
    expect(hunk.className).toContain('cyan');
    // distinct from both the added and removed styles
    expect(hunk.className).not.toContain('emerald');
    expect(hunk.className).not.toContain('rose');
  });

  it('treats file-header lines (diff --git / +++ / ---) as metadata, not add/remove', () => {
    render(<DiffView diff={DIFF} />);
    const fileHeader = screen.getByText('diff --git a/file.txt b/file.txt');
    const plus = screen.getByText('+++ b/file.txt');
    const minus = screen.getByText('--- a/file.txt');
    // all three carry the muted metadata colour, NOT the added/removed colours,
    // even though +++/--- begin with + / -.
    expect(fileHeader.className).toContain('slate-500');
    expect(plus.className).toContain('slate-500');
    expect(plus.className).not.toContain('emerald');
    expect(minus.className).toContain('slate-500');
    expect(minus.className).not.toContain('rose');
  });

  it('owns its own horizontal scroll so a long line scrolls inside the diff, not the page body', () => {
    render(<DiffView diff={DIFF} />);
    const long = screen.getByText(new RegExp(LONG_MARKER));
    const container = long.closest('pre');
    expect(container).not.toBeNull();
    expect(container!.className).toContain('overflow-x-auto');
  });
});
