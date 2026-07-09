import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ConfirmDialog, ConfirmTone } from './ConfirmDialog';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Irreversible ops only: user must type this exact string to unlock Confirm. */
  requireType?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn | null>(null);

/**
 * Promise-based confirmation. `const confirm = useConfirm();`
 * then `if (await confirm({ title, message })) { ...destructive... }`.
 * Works from any component under <ConfirmProvider> — no prop drilling.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
}

interface State extends ConfirmOptions { open: boolean; }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ open: false, title: '', message: '' });
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setState({ ...opts, open: true });
    return new Promise<boolean>(resolve => { resolver.current = resolve; });
  }, []);

  const settle = (result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setState(s => ({ ...s, open: false }));
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {state.open && (
          <ConfirmDialog
            isOpen={state.open}
            title={state.title}
            message={state.message}
            confirmLabel={state.confirmLabel}
            requireType={state.requireType}
            cancelLabel={state.cancelLabel}
            tone={state.tone}
            onConfirm={() => settle(true)}
            onCancel={() => settle(false)}
          />
        )}
      </AnimatePresence>
    </ConfirmCtx.Provider>
  );
}
