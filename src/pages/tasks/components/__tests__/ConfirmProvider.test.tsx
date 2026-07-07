// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from '../ConfirmProvider';

afterEach(cleanup);

/**
 * Harness: a button opens a confirm dialog; the resolved boolean is written to
 * the page so tests can assert what the promise settled to.
 */
function Harness() {
  const confirm = useConfirm();
  const [result, setResult] = useState<string>('pending');
  return (
    <div>
      <button
        onClick={async () => {
          const ok = await confirm({ title: 'Delete token?', message: 'This is permanent.' });
          setResult(ok ? 'confirmed' : 'cancelled');
        }}
      >
        open
      </button>
      <span data-testid="result">{result}</span>
    </div>
  );
}

function open() {
  render(
    <ConfirmProvider>
      <Harness />
    </ConfirmProvider>,
  );
  fireEvent.click(screen.getByText('open'));
}

describe('ConfirmProvider / useConfirm', () => {
  it('shows the dialog with the given title and message', () => {
    open();
    expect(screen.getByText('Delete token?')).toBeTruthy();
    expect(screen.getByText('This is permanent.')).toBeTruthy();
  });

  it('resolves true when the confirm button is clicked', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('confirmed'));
  });

  it('resolves false when Cancel is clicked', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('cancelled'));
  });

  it('resolves false when Escape is pressed', async () => {
    open();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('cancelled'));
  });
});
