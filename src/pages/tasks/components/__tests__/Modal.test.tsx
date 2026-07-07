// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Modal } from '../Modal';

afterEach(cleanup);

/** Minimal open modal with a title and some body text, for reuse across cases. */
function renderModal(onClose = vi.fn(), open = true) {
  render(
    <Modal isOpen={open} onClose={onClose} title="My Dialog">
      <p>Body content</p>
    </Modal>,
  );
  return onClose;
}

describe('Modal', () => {
  it('renders nothing when closed', () => {
    renderModal(vi.fn(), false);
    expect(screen.queryByText('My Dialog')).toBeNull();
  });

  it('renders the title and body when open', () => {
    renderModal();
    expect(screen.getByText('My Dialog')).toBeTruthy();
    expect(screen.getByText('Body content')).toBeTruthy();
  });

  it('shows the "esc" hint under the close button', () => {
    renderModal();
    expect(screen.getByText('esc')).toBeTruthy();
  });

  it('closes when the Escape key is pressed', () => {
    const onClose = renderModal();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked', () => {
    const onClose = renderModal();
    // The backdrop carries the default feature id; it's the outermost overlay.
    const backdrop = document.querySelector('[data-feature-id="common-modal"]')!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when clicking inside the dialog body', () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByText('Body content'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when the X (Close) button is clicked', () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
