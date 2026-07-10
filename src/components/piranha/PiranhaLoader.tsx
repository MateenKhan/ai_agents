// ─────────────────────────────────────────────────────────────────────────────
// The loader — the teeth mark, chewing.
//
// Replaces the generic border-spin. Teeth are the memorable part of the brand at
// small size (same reason they're the favicon), so the loader is the bite: two rows
// close, a cyan spark flashes on contact, they open again. Pure SVG/CSS.
//
// `size` in px. `label` sits beneath it, optional.
// ─────────────────────────────────────────────────────────────────────────────

import './loader.css';

export function PiranhaLoader({ size = 48, label }: { size?: number; label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="pz-load">
        {/* upper teeth — bite downward */}
        <g className="pz-load-up" fill="#FF3B1D">
          <path d="M18 26 L28 52 L38 26 Z" />
          <path d="M36 26 L46 52 L56 26 Z" />
          <path d="M54 26 L64 52 L74 26 Z" />
        </g>
        {/* lower teeth — bite upward, offset */}
        <g className="pz-load-lo" fill="#FF3B1D">
          <path d="M27 74 L37 48 L47 74 Z" />
          <path d="M45 74 L55 48 L65 74 Z" />
          <path d="M63 74 L73 48 L83 74 Z" />
        </g>
        {/* the spark on contact */}
        <circle className="pz-load-spark" cx="50" cy="50" r="4" fill="#22D3EE" />
      </svg>
      {label && (
        <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-slate-500">{label}</p>
      )}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
