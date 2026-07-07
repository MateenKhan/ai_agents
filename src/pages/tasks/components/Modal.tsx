import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Tailwind max-width class for desktop, e.g. 'sm:max-w-md' */
  maxW?: string;
  featureId?: string;
}

/**
 * Common modal: bottom sheet on mobile, centered card on desktop.
 * Closes on X, Esc, and backdrop click — consistently, everywhere.
 */
export function Modal({ isOpen, onClose, title, subtitle, icon, children, footer, maxW = 'sm:max-w-md', featureId }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/30 backdrop-blur-sm"
      onClick={onClose}
      data-feature-id={featureId ?? 'common-modal'}
    >
      <div
        onClick={e => e.stopPropagation()}
        className={`bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl w-full ${maxW} max-h-[90dvh] flex flex-col shadow-2xl shadow-slate-500/30 overflow-hidden`}
      >
        {/* Grab handle (mobile affordance) */}
        <div className="sm:hidden w-10 h-1 bg-slate-300 rounded-full mx-auto mt-3" />

        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3 min-w-0">
            {icon && <div className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-xl shrink-0">{icon}</div>}
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 leading-tight">{title}</h2>
              {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] -m-2 text-slate-500 active:bg-slate-200 sm:hover:text-slate-900 rounded-lg transition-colors shrink-0"
            title="Close (Esc)"
            aria-label="Close (Esc)"
          >
            <X size={18} />
            <span className="text-[9px] font-semibold uppercase tracking-wider leading-none text-slate-400">esc</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 sm:p-6">
          {children}
        </div>

        {footer && (
          <div className="flex gap-2 px-5 sm:px-6 py-4 border-t border-slate-200 bg-slate-50 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
