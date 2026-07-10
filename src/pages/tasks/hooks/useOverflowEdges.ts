import { useEffect, useRef, useState } from 'react';

/**
 * Reports whether a horizontally-scrolling element has content hidden off its left or right
 * edge, so a caller can fade that edge and say "there is more this way".
 *
 * This exists because CSS cannot answer the question. A static edge fade would sit on the
 * last tab even when everything fits; `:has()` and container queries don't expose overflow.
 * So we measure.
 *
 * Three things invalidate the measurement, and all three are watched:
 *   - scroll      the user moves within the strip
 *   - resize      the window narrows, or a sibling (the action cluster) expands and steals width
 *   - childList   a tab is hidden or restored
 *
 * The 1px slack absorbs sub-pixel layout, where `scrollLeft + clientWidth` lands a fraction
 * short of `scrollWidth` forever and the right edge never stops fading.
 */
export function useOverflowEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setEdges({
        left: scrollLeft > 1,
        right: scrollLeft + clientWidth < scrollWidth - 1,
      });
    };

    update();
    el.addEventListener('scroll', update, { passive: true });

    // The cluster expanding is a resize of THIS element, not a window resize — observe the
    // element itself, not `window`.
    const ro = new ResizeObserver(update);
    ro.observe(el);

    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true });

    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return { ref, edges };
}
