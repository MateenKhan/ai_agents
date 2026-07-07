import React from 'react';
import { motion } from 'framer-motion';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface SlideOverProps {
  /** Called on backdrop click, close button, or Escape. */
  onClose: () => void;
  /** Panel content — provide your own header / body / footer. */
  children: React.ReactNode;
  /** Panel width classes. e.g. 'w-full sm:w-[480px]' (narrow) or 'w-full lg:w-[65vw] xl:w-[60vw] lg:max-w-[1200px]' (wide). */
  width: string;
  /** Stacking class, so drawers can sit above one another. Default z-[90]. */
  z?: string;
  /** Slide-in distance. Number = px, string = e.g. '100%'. Default '100%'. */
  enterFrom?: number | string;
  /** Extra classes for the sliding panel (e.g. border colour). */
  panelClassName?: string;
  /** data-feature-id passed through to the backdrop for analytics/tours. */
  featureId?: string;
}

/**
 * Right-hand slide-over drawer shell shared by TaskDetail (narrow) and
 * HumanTodos (wide). Owns the backdrop, the spring slide-in/out, Escape and
 * backdrop-click close, and click isolation. Everything inside — header, body,
 * footer — is supplied as children, so each drawer keeps its own layout.
 *
 * Render inside the parent's <AnimatePresence> so the exit animation runs.
 */
export function SlideOver({ onClose, children, width, z = 'z-[90]', enterFrom = '100%', panelClassName = '', featureId }: SlideOverProps) {
  useEscapeKey(onClose);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      data-feature-id={featureId}
      className={`fixed inset-0 ${z} flex justify-end bg-slate-900/30 backdrop-blur-sm`}
      onClick={onClose}
    >
      <motion.div
        initial={{ x: enterFrom }}
        animate={{ x: 0 }}
        exit={{ x: enterFrom }}
        transition={{ type: 'spring', damping: 32, stiffness: 320 }}
        onClick={(e) => e.stopPropagation()}
        className={`${width} h-full bg-white flex flex-col shadow-2xl ${panelClassName}`}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
