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
 * Usage: <Tooltip label="Refresh"><button …/></Tooltip>
 */
export function Tooltip({
  label,
  children,
  side = 'top',
}: {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: r.left + r.width / 2, y: side === 'top' ? r.top : r.bottom });
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
          style={{
            position: 'fixed',
            left: pos.x,
            top: side === 'top' ? pos.y - 8 : pos.y + 8,
            transform: side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
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
