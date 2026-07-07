import React, { useState, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Project-wide custom tooltip. Portal-rendered to <body> so it never clips inside
 * overflow-hidden/scroll containers. Shows on hover + keyboard focus. Label-only.
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

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className="inline-flex"
    >
      {children}
      {pos && label && createPortal(
        <div
          style={{
            position: 'fixed',
            left: pos.x,
            top: side === 'top' ? pos.y - 8 : pos.y + 8,
            transform: side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
          className="z-[200] pointer-events-none px-2 py-1 rounded-md bg-slate-900 text-white text-[11px] font-bold whitespace-nowrap shadow-lg"
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
