import { useEffect } from 'react';

/**
 * Close-on-Escape for popups that aren't built on the shared <Modal>
 * (side drawers, the Git panel). Keeps Esc behaviour identical everywhere.
 *
 * @param onEscape  called when Escape is pressed
 * @param active    only listen while true (default true)
 */
export function useEscapeKey(onEscape: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onEscape(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape, active]);
}
