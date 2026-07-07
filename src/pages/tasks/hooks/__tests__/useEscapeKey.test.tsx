// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { useEscapeKey } from '../useEscapeKey';

/** Dispatch a real keydown on window (that's where the hook listens). */
function pressKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  });
}

afterEach(cleanup);

describe('useEscapeKey', () => {
  it('calls the handler when Escape is pressed', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));

    pressKey('Escape');

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('ignores keys other than Escape', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));

    pressKey('Enter');
    pressKey('a');
    pressKey('Tab');

    expect(onEscape).not.toHaveBeenCalled();
  });

  it('does not listen while inactive (active = false)', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape, false));

    pressKey('Escape');

    expect(onEscape).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount (no calls after cleanup)', () => {
    const onEscape = vi.fn();
    const { unmount } = renderHook(() => useEscapeKey(onEscape));

    unmount();
    pressKey('Escape');

    expect(onEscape).not.toHaveBeenCalled();
  });
});
