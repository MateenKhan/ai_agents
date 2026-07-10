// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Tooltip } from '../Tooltip';

/**
 * Placement, and the accessible name.
 *
 * The bug this pins: the tooltip always rendered ABOVE its trigger. The brand mark sits
 * ~34px from the top of the viewport, so its tooltip landed off-screen — a black sliver
 * under the browser chrome. Portalling to <body> did not help, because nothing was
 * clipping it; there was simply no room. `side` existed as a prop and no call site ever
 * passed it, so nothing could opt out.
 */

afterEach(cleanup);

/** jsdom gives every element a 0×0 rect at 0,0 — useless for a placement test. */
function atViewport(rect: Partial<DOMRect>) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
    ...rect,
  } as DOMRect);
}

const openTooltip = (label = 'Hint') => {
  render(<Tooltip label={label}><button>go</button></Tooltip>);
  fireEvent.mouseEnter(screen.getByText('go').parentElement!);
  return screen.getByRole('tooltip');
};

describe('Tooltip placement', () => {
  it('flips below when there is no room above', () => {
    window.innerHeight = 800;
    atViewport({ top: 10, bottom: 40, left: 100, right: 140, width: 40 }); // 10px of headroom
    expect(openTooltip().getAttribute('data-side')).toBe('bottom');
  });

  it('stays above when there is room', () => {
    window.innerHeight = 800;
    atViewport({ top: 300, bottom: 330, left: 100, right: 140, width: 40 });
    expect(openTooltip().getAttribute('data-side')).toBe('top');
  });

  it('keeps the preferred side when NEITHER fits, rather than flipping into an equal clip', () => {
    window.innerHeight = 50;
    atViewport({ top: 10, bottom: 40, left: 100, right: 140, width: 40 });
    expect(openTooltip().getAttribute('data-side')).toBe('top');
  });

  it('clamps the horizontal centre inside the viewport', () => {
    window.innerWidth = 1000;
    window.innerHeight = 800;
    // A control hanging off the left edge: its centre is negative.
    atViewport({ top: 300, bottom: 330, left: -40, right: 0, width: 40 });
    expect(openTooltip().style.left).toBe('8px');
  });
});

describe('Tooltip accessible name', () => {
  it('injects the label as aria-label when the child has none', () => {
    window.innerHeight = 800;
    atViewport({ top: 300, bottom: 330, left: 100, right: 140, width: 40 });
    render(<Tooltip label="Refresh board"><button /></Tooltip>);
    expect(screen.getByLabelText('Refresh board')).toBeTruthy();
  });

  it('never overrides an aria-label the child already has', () => {
    window.innerHeight = 800;
    atViewport({ top: 300, bottom: 330, left: 100, right: 140, width: 40 });
    render(<Tooltip label="What Piranha is"><button aria-label="Piranha — what it is" /></Tooltip>);
    // WCAG 2.5.3: the visible name must survive. Clobbering it breaks voice control.
    expect(screen.getByLabelText('Piranha — what it is')).toBeTruthy();
    expect(screen.queryByLabelText('What Piranha is')).toBeNull();
  });
});
