import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';

export interface LogViewProps {
  /** Log content — pass an array of lines OR a single string (lines wins if both). */
  lines?: string[];
  text?: string;
  /** Optional header bar. Omit for a bare log body. */
  title?: string;
  /** Pulsing green dot in the header (a stream is live). */
  live?: boolean;
  /** Show a copy-to-clipboard button in the header. */
  copyable?: boolean;
  /** Wrap long lines (default) so nothing is hidden, or scroll horizontally. */
  wrap?: boolean;
  /** Auto-scroll to the bottom as new content arrives (default true). */
  autoScroll?: boolean;
  /** Placeholder when there's no content. */
  empty?: string;
  /** Tailwind max-height class for the body (default `max-h-52`). */
  maxHeight?: string;
  /** Per-line renderer for colorized logs (e.g. severity). Receives the raw line. */
  renderLine?: (line: string, i: number) => React.ReactNode;
  /** Render only the scrolling body (no outer box/header) — for slotting into a panel
   *  that already has its own header/border. */
  bare?: boolean;
  className?: string;
}

/** Shared terminal-style log panel: dark, monospace, auto-scrolling, copyable.
 *  Replaces the many ad-hoc `<pre className="bg-slate-900 …">` boxes across the app. */
export function LogView({
  lines, text, title, live, copyable, wrap = true, autoScroll = true,
  empty = '…', maxHeight = 'max-h-52', renderLine, bare, className = '',
}: LogViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const arr = lines ?? (text != null ? text.split('\n') : []);
  const full = lines ? lines.join('\n') : (text ?? '');

  // Stick to the bottom on update, but only if the user is already near the bottom
  // (so scrolling up to read history isn't yanked back down).
  useEffect(() => {
    if (!autoScroll) return;
    const el = bodyRef.current; if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [full, autoScroll]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(full); }
    catch { const ta = document.createElement('textarea'); ta.value = full; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* give up */ } ta.remove(); }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const wrapCls = wrap ? 'whitespace-pre-wrap break-all overflow-x-hidden' : 'whitespace-pre overflow-x-auto';

  const body = (
    <div ref={bodyRef} className={`${maxHeight} overflow-y-auto custom-scrollbar p-2.5 text-[10.5px] leading-relaxed font-mono text-slate-100 ${wrapCls} ${bare ? className : ''}`}>
      {arr.length === 0
        ? <span className="text-slate-500">{empty}</span>
        : renderLine
          ? arr.map((l, i) => <div key={i}>{renderLine(l, i)}</div>)
          : arr.join('\n')}
    </div>
  );
  if (bare) return body;

  return (
    <div className={`rounded-lg border border-slate-700 bg-slate-900 overflow-hidden ${className}`} data-feature-id="log-view">
      {(title || copyable) && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-700">
          {live && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />}
          {title && <span className="text-[10px] font-black uppercase tracking-widest text-slate-300 flex-1 truncate">{title}</span>}
          {copyable && (
            <button onClick={copy} title="Copy log" className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-slate-100 transition-colors">
              {copied ? <><Check size={11} className="text-emerald-400" /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
          )}
        </div>
      )}
      {body}
    </div>
  );
}
