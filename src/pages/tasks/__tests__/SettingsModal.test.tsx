// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsModal } from '../components/SettingsModal';
import { DEFAULT_COLUMNS } from '../boardConfig';
import type { TabId } from '../tabsConfig';
import type { Column } from '../types';

afterEach(cleanup);

const custom = (label: string): Column => ({ id: `CUSTOM_${label.toUpperCase()}`, label, color: '#123456' });
// Tab-visibility props are orthogonal to these board-config tests; supply inert defaults.
const tabProps = { hiddenTabs: new Set<TabId>(), onSetTabHidden: () => {} };

describe('SettingsModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <SettingsModal isOpen={false} onClose={() => {}} columns={DEFAULT_COLUMNS} onSave={() => {}} {...tabProps} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('Save Changes calls onSave with the current columns, then onClose', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SettingsModal isOpen onClose={onClose} columns={DEFAULT_COLUMNS} onSave={onSave} {...tabProps} />);
    fireEvent.click(screen.getByText('Save Changes'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].map((c: Column) => c.id)).toEqual(['TODO', 'AVAILABLE', 'WORKING', 'DONE']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('editing then saving passes the edited columns', () => {
    const onSave = vi.fn();
    render(<SettingsModal isOpen onClose={() => {}} columns={[custom('One')]} onSave={onSave} {...tabProps} />);
    fireEvent.click(screen.getByText('Add Lane'));
    fireEvent.click(screen.getByText('Save Changes'));
    expect(onSave.mock.calls[0][0]).toHaveLength(2);
  });

  it('Reset restores default lanes (then Save emits them)', () => {
    const onSave = vi.fn();
    render(<SettingsModal isOpen onClose={() => {}} columns={[custom('A'), custom('B')]} onSave={onSave} {...tabProps} />);
    fireEvent.click(screen.getByText('Reset'));
    fireEvent.click(screen.getByText('Save Changes'));
    expect(onSave.mock.calls[0][0].map((c: Column) => c.id)).toEqual(['TODO', 'AVAILABLE', 'WORKING', 'DONE']);
  });

  it('Cancel closes without saving', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SettingsModal isOpen onClose={onClose} columns={DEFAULT_COLUMNS} onSave={onSave} {...tabProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('disables Save when there are no lanes', () => {
    render(<SettingsModal isOpen onClose={() => {}} columns={[custom('Only')]} onSave={() => {}} {...tabProps} />);
    fireEvent.click(screen.getByLabelText('Remove lane'));
    expect((screen.getByText('Save Changes') as HTMLButtonElement).disabled).toBe(true);
  });

  const toggleBox = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-feature-id="settings-tab-toggle-${id}"] input`) as HTMLInputElement | null;

  it('shows a visibility toggle for each closeable tab (not Board), checked when shown', () => {
    const { container } = render(<SettingsModal isOpen onClose={() => {}} columns={DEFAULT_COLUMNS} onSave={() => {}} {...tabProps} />);
    expect(toggleBox(container, 'analytics')).toBeTruthy();
    expect(toggleBox(container, 'logs')).toBeTruthy();
    expect(toggleBox(container, 'board')).toBeNull();
    // Nothing hidden → box checked.
    expect(toggleBox(container, 'analytics')!.checked).toBe(true);
  });

  it('unchecking a shown tab calls onSetTabHidden(id, true)', () => {
    const onSetTabHidden = vi.fn();
    const { container } = render(<SettingsModal isOpen onClose={() => {}} columns={DEFAULT_COLUMNS} onSave={() => {}} hiddenTabs={new Set()} onSetTabHidden={onSetTabHidden} />);
    fireEvent.click(toggleBox(container, 'logs')!);
    expect(onSetTabHidden).toHaveBeenCalledWith('logs', true);
  });

  it('checking a hidden tab calls onSetTabHidden(id, false)', () => {
    const onSetTabHidden = vi.fn();
    const { container } = render(<SettingsModal isOpen onClose={() => {}} columns={DEFAULT_COLUMNS} onSave={() => {}} hiddenTabs={new Set(['agents'] as const)} onSetTabHidden={onSetTabHidden} />);
    expect(toggleBox(container, 'agents')!.checked).toBe(false);
    fireEvent.click(toggleBox(container, 'agents')!);
    expect(onSetTabHidden).toHaveBeenCalledWith('agents', false);
  });
});
