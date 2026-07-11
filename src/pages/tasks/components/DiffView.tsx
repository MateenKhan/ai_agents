import React from 'react';

/**
 * Colorized unified-diff block. The single diff renderer in the app — GitPanel (repo status,
 * history drill-down) and the review-gate Changes panel both use this, so a diff looks the
 * same everywhere and the colour rules live in one place.
 *
 * Transparent by design: it renders on whatever dark surface the caller provides (the git
 * modal's `bg-slate-900`, a Changes panel's console surface). It owns its own horizontal
 * scroll — a long line scrolls inside this box, never the page body.
 */
export function DiffView({ diff, className = '', maxHeight = 'max-h-[40vh]' }: { diff: string; className?: string; maxHeight?: string }) {
  return (
    <pre className={`text-2xs leading-relaxed font-mono p-3 overflow-x-auto custom-scrollbar ${maxHeight} overflow-y-auto ${className}`}>
      {(diff ?? '').split('\n').map((line, i) => {
        let cls = 'text-slate-300';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-emerald-400';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-rose-400';
        else if (line.startsWith('@@')) cls = 'text-cyan-400';
        else if (line.startsWith('commit ')) cls = 'text-amber-400';
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) cls = 'text-slate-500';
        return <div key={i} className={`${cls} whitespace-pre`}>{line || ' '}</div>;
      })}
    </pre>
  );
}

export default DiffView;
