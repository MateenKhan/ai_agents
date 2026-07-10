import React, { useState, useRef, useCallback, isValidElement, cloneElement, type ReactNode, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

/**
 * Project-wide custom tooltip. Portal-rendered to <body> so it never clips inside
 * overflow-hidden/scroll containers. Shows on hover + keyboard focus.
 *
 * ACCESSIBILITY: this replaces the native `title` attribute, which is also the
 * accessible name for icon-only buttons. So when the wrapped element has no
 * aria-label/aria-labelledby of its own, we inject the tooltip label as its
 * aria-label — otherwise migrating `title=` -> <Tooltip> would silently strip the
 * name that screen readers announce. An explicit aria-label on the child always wins.
 *
 * PLACEMENT: `side` is a preference, not an instruction. A tooltip that renders above a
 * trigger sitting 34px from the top of the viewport lands off-screen, and portalling to
 * <body> does not save it — nothing clipped it, there was simply nowhere to be. So the
 * side flips when the preferred one does not fit, and the horizontal centre is clamped so
 * a tooltip on the leftmost control cannot run off the edge either.
 *
 * Usage: <Tooltip label="Refresh"><button …/></Tooltip>
 */

/** Enough for one line of `text-2xs` plus padding, plus the 8px gap. Measuring the tooltip
 *  would need it mounted first, which means a frame of it drawn in the wrong place. */
const NEEDED = 34;
const EDGE = 8;

export function Tooltip({
  label,
  children,
  side = 'top',
}: {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
}) {
  const [pos, setPos] = useState<{ x: number; y: number; side: 'top' | 'bottom' } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const fitsAbove = r.top >= NEEDED;
    const fitsBelow = window.innerHeight - r.bottom >= NEEDED;
    // Prefer `side`; fall back to the other only when it actually has room. When neither
    // fits (a control in a viewport shorter than ~70px) keep the preference — clipped is
    // still better than flipping to a side that is equally clipped.
    const place: 'top' | 'bottom' =
      side === 'top' ? (fitsAbove || !fitsBelow ? 'top' : 'bottom')
        : (fitsBelow || !fitsAbove ? 'bottom' : 'top');
    const cx = Math.min(Math.max(r.left + r.width / 2, EDGE), window.innerWidth - EDGE);
    setPos({ x: cx, y: place === 'top' ? r.top : r.bottom, side: place });
  }, [side]);
  const hide = useCallback(() => setPos(null), []);

  // Give the child an accessible name from `label` unless it already has one.
  const labelled = (() => {
    if (!isValidElement(children)) return children;
    const p = (children as ReactElement).props as Record<string, unknown>;
    if (p['aria-label'] || p['aria-labelledby']) return children;
    return cloneElement(children as ReactElement, { 'aria-label': label } as Record<string, unknown>);
  })();

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className="inline-flex"
    >
      {labelled}
      {pos && label && createPortal(
        <div
          data-side={pos.side}
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.side === 'top' ? pos.y - 8 : pos.y + 8,
            transform: pos.side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
          className="z-[200] pointer-events-none px-2 py-1 rounded-md bg-slate-900 text-white text-2xs font-semibold whitespace-nowrap shadow-lg"
          role="tooltip"
        >
          {label}
        </div>,
        document.body,
      )}
    </span>
  );
}

export default Tooltip;
