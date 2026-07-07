import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Info, X, Copy, Check, ChevronDown } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  /** Long-form detail (error stack / command output). Rendered in an expandable,
   *  copyable block. Toasts with details are sticky (no auto-dismiss) so they can be read. */
  details?: string;
}

interface ToastApi {
  /** Fire a notification. Returns the toast id (rarely needed). */
  push: (kind: ToastKind, title: string, message?: string, details?: string) => number;
  success: (title: string, message?: string, details?: string) => number;
  error: (title: string, message?: string, details?: string) => number;
  info: (title: string, message?: string, details?: string) => number;
  /** Fire an error toast from a caught value — pulls message + stack automatically. */
  fromError: (title: string, err: unknown, extra?: string) => number;
  dismiss: (id: number) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

/** Global notification hook. Any component under <ToastProvider> can fire toasts. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

/** Extract a human message + a copyable detail block (stack / output) from any thrown value. */
export function describeError(err: unknown): { message: string; details: string } {
  if (err instanceof Error) {
    return { message: err.message || err.name || 'Error', details: err.stack || `${err.name}: ${err.message}` };
  }
  if (typeof err === 'string') return { message: err, details: err };
  try { const s = JSON.stringify(err, null, 2); return { message: 'Unexpected error', details: s }; }
  catch { return { message: String(err), details: String(err) }; }
}

const KIND_STYLE: Record<ToastKind, { ring: string; icon: React.ReactNode; bar: string }> = {
  success: { ring: 'border-emerald-200', bar: 'bg-emerald-500', icon: <CheckCircle2 size={18} className="text-emerald-600" /> },
  error: { ring: 'border-rose-200', bar: 'bg-rose-500', icon: <AlertTriangle size={18} className="text-rose-600" /> },
  info: { ring: 'border-sky-200', bar: 'bg-sky-500', icon: <Info size={18} className="text-sky-600" /> },
};

const DISMISS_MS = 4200;       // success / info
const DISMISS_MS_ERROR = 9000; // errors & anything with details — longer, so it can be read/copied

/** One toast row: self-managed auto-hide (paused on hover), expand + copy. */
function ToastRow({ t, onDismiss }: { t: Toast; onDismiss: (id: number) => void }) {
  const s = KIND_STYLE[t.kind];
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paused, setPaused] = useState(false);

  // Auto-hide, longer for errors/details; pause while hovered so it can be read/copied.
  useEffect(() => {
    if (paused) return;
    const ms = (t.kind === 'error' || t.details) ? DISMISS_MS_ERROR : DISMISS_MS;
    const id = setTimeout(() => onDismiss(t.id), ms);
    return () => clearTimeout(id);
  }, [paused, t.id, t.kind, t.details, onDismiss]);

  const copy = async () => {
    const text = [t.title, t.message, t.details ? `\n${t.details}` : ''].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); }
    catch { /* fallback for non-secure contexts */ const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* give up */ } ta.remove(); }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80 }}          // slide in from the right → left
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 80 }}              // slide out to the right
      transition={{ type: 'spring', damping: 28, stiffness: 340 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-feature-id="toast"
      className={`pointer-events-auto w-full sm:w-auto sm:min-w-[320px] sm:max-w-md bg-white border ${s.ring} rounded-xl shadow-lg shadow-slate-500/15 overflow-hidden flex`}
    >
      <div className={`w-1 shrink-0 ${s.bar}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="shrink-0 mt-0.5">{s.icon}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 leading-tight">{t.title}</p>
            {t.message && <p className="text-xs text-slate-500 mt-0.5 leading-snug break-words">{t.message}</p>}
            {t.details && (
              <div className="mt-1.5 flex items-center gap-2">
                <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800">
                  <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} /> Details
                </button>
                <button onClick={copy} data-feature-id="toast-copy" title="Copy message + stack trace" className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-indigo-700">
                  {copied ? <><Check size={12} className="text-emerald-600" /> Copied</> : <><Copy size={12} /> Copy</>}
                </button>
              </div>
            )}
          </div>
          <button onClick={() => onDismiss(t.id)} aria-label="Dismiss" className="shrink-0 -m-1 p-1 text-slate-400 hover:text-slate-700 rounded-md transition-colors">
            <X size={15} />
          </button>
        </div>
        {t.details && open && (
          <pre className="mx-4 mb-3 max-h-52 overflow-auto custom-scrollbar rounded-lg bg-slate-900 text-slate-100 text-[10.5px] leading-relaxed font-mono p-2.5 whitespace-pre-wrap break-words">{t.details}</pre>
        )}
      </div>
    </motion.div>
  );
}

const MAX_TOASTS = 5; // keep the newest few; older ones drop off the top

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts(list => list.filter(t => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, title: string, message?: string, details?: string) => {
    const id = ++idRef.current;
    // Append newest last → it renders at the BOTTOM of the bottom-anchored stack; older ones
    // get pushed up (and trimmed to the newest MAX_TOASTS). Auto-hide is per-row.
    setToasts(list => [...list, { id, kind, title, message, details }].slice(-MAX_TOASTS));
    return id;
  }, []);

  const api: ToastApi = {
    push,
    success: (t, m, d) => push('success', t, m, d),
    error: (t, m, d) => push('error', t, m, d),
    info: (t, m, d) => push('info', t, m, d),
    fromError: (t, err, extra) => { const { message, details } = describeError(err); return push('error', t, message, [extra, details].filter(Boolean).join('\n\n')); },
    dismiss,
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {/* Stack: bottom-right. Newest at the bottom; older ones move up as new arrive. */}
      <div className="fixed z-[2000] bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 left-4 sm:left-auto sm:right-6 flex flex-col gap-2 items-stretch sm:items-end pointer-events-none">
        <AnimatePresence initial={false}>
          {toasts.map(t => <ToastRow key={t.id} t={t} onDismiss={dismiss} />)}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
