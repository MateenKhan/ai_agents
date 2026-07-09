import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, HelpCircle } from 'lucide-react';

export type ConfirmTone = 'danger' | 'default';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /**
   * IRREVERSIBLE ops only (delete a repo/project). The user must type this exact string
   * before Confirm unlocks, and Enter no longer fires.
   *
   * Colour cannot make an action dangerous — friction can. A red dialog that costs one
   * click trains people to click through red. Reserve this for things that cannot be undone;
   * putting it on reversible actions (pause, reject) just teaches people to ignore it.
   */
  requireType?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Touch-first confirm dialog. Renders as a bottom sheet on phones
 * (thumb-reachable, respects iOS safe area) and a centered modal on desktop.
 * Closes on backdrop click and Esc; confirms on Enter.
 */
export function ConfirmDialog({ isOpen, title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', tone = 'danger', requireType, onConfirm, onCancel }: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const locked = !!requireType && typed.trim() !== requireType;

  useEffect(() => { if (isOpen) setTyped(''); }, [isOpen, requireType]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      // Enter must NOT fire an irreversible action — typing the name is the whole point.
      else if (e.key === 'Enter' && !requireType) { e.preventDefault(); onConfirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel, onConfirm, requireType]);

  if (!isOpen) return null;

  const danger = tone === 'danger';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      data-feature-id="tasks-confirm-dialog"
      className="fixed inset-0 z-[1500] flex items-end sm:items-center justify-center bg-slate-900/30 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ y: 80, opacity: 0.5 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 350 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:w-auto sm:min-w-[360px] sm:max-w-sm bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-6 shadow-2xl shadow-slate-500/30"
      >
        {/* Grab handle (mobile affordance) */}
        <div className="sm:hidden w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />

        <div className="flex items-start gap-3.5">
          <div className={`p-2.5 rounded-xl shrink-0 border ${danger ? 'bg-rose-50 border-rose-200' : 'bg-sky-50 border-sky-200'}`}>
            {danger
              ? <AlertTriangle size={20} className="text-rose-600" />
              : <HelpCircle size={20} className="text-sky-600" />}
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 leading-tight">{title}</h3>
            <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{message}</p>
          </div>
        </div>

        {requireType && (
          <div className="mt-5">
            <label htmlFor="confirm-type" className="block text-xs text-slate-600">
              Type <span className="font-mono font-bold text-slate-900 select-all">{requireType}</span> to confirm
            </label>
            <input
              id="confirm-type"
              autoFocus
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              data-feature-id="tasks-confirm-type"
              className="mt-1.5 w-full min-h-control-lg rounded-xl border border-rose-300 px-3 py-2 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-400"
              placeholder={requireType}
            />
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            data-feature-id="tasks-confirm-cancel"
            onClick={onCancel}
            className="flex-1 min-h-control-lg px-4 text-sm font-bold text-slate-700 bg-white border border-slate-300 rounded-xl active:bg-slate-100 sm:hover:bg-slate-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            data-feature-id="tasks-confirm-accept"
            onClick={onConfirm}
            disabled={locked}
            autoFocus={!requireType}
            className={`flex-1 min-h-control-lg px-4 text-sm font-bold text-white rounded-xl transition-colors shadow-lg disabled:opacity-40 disabled:cursor-not-allowed ${danger
              ? 'bg-rose-600 active:bg-rose-700 sm:hover:bg-rose-500 shadow-rose-600/25'
              : 'bg-sky-600 active:bg-sky-700 sm:hover:bg-sky-500 shadow-sky-600/25'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
