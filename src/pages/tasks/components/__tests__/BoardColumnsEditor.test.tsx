// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { BoardColumnsEditor } from '../BoardColumnsEditor';
import { DEFAULT_COLUMNS } from '../../boardConfig';
import type { Column } from '../../types';

afterEach(cleanup);

// The editor is controlled; this harness owns the state so interactions flow through.
function Harness({ initial }: { initial: Column[] }) {
  const [cols, setCols] = useState<Column[]>(initial);
  return (
    <div>
      <BoardColumnsEditor columns={cols} onChange={setCols} />
      <output data-testid="labels">{cols.map(c => c.label).join('|')}</output>
      <output data-testid="ids">{cols.map(c => c.id).join('|')}</output>
    </div>
  );
}

const labels = () => screen.getByTestId('labels').textContent;
const textInputs = () => screen.getAllByRole('textbox') as HTMLInputElement[];

describe('BoardColumnsEditor', () => {
  it('renders one label input per column, in order', () => {
    render(<Harness initial={DEFAULT_COLUMNS} />);
    expect(textInputs().map(i => i.value)).toEqual(['Todo', 'Available', 'In Progress', 'Done']);
    expect(screen.getByText('Swimlanes (4)')).toBeTruthy();
  });

  it('Add Lane appends a custom "New Lane"', () => {
    render(<Harness initial={DEFAULT_COLUMNS} />);
    fireEvent.click(screen.getByText('Add Lane'));
    expect(labels()).toBe('Todo|Available|In Progress|Done|New Lane');
    expect(screen.getByText('Swimlanes (5)')).toBeTruthy();
    expect(screen.getByTestId('ids').textContent).toContain('CUSTOM_NEW_LANE');
  });

  it('renaming a lane updates its label', () => {
    render(<Harness initial={DEFAULT_COLUMNS} />);
    fireEvent.change(textInputs()[0], { target: { value: 'Backlog' } });
    expect(labels()).toBe('Backlog|Available|In Progress|Done');
  });

  it('changing a color swatch updates the lane color', () => {
    render(<Harness initial={DEFAULT_COLUMNS} />);
    const colorInput = screen.getAllByLabelText('Lane color')[0] as HTMLInputElement;
    fireEvent.change(colorInput, { target: { value: '#000000' } });
    expect(colorInput.value).toBe('#000000');
  });

  it('Move up reorders a lane before its predecessor', () => {
    render(<Harness initial={DEFAULT_COLUMNS} />);
    fireEvent.click(screen.getAllByLabelText('Move up')[1]); // Available up
    expect(labels()).toBe('Available|Todo|In Progress|Done');
  });

  it('Move down reorders a lane after its successor', () => {
    render(<Harness initial={DEFAULT_COLUMNS} />);
    fireEvent.click(screen.getAllByLabelText('Move down')[0]); // Todo down
    expect(labels()).toBe('Available|Todo|In Progress|Done');
  });

  it('first lane cannot move up; last cannot move down', () => {
    render(<Harness initial={DEFAULT_COLUMNS} />);
    expect((screen.getAllByLabelText('Move up')[0] as HTMLButtonElement).disabled).toBe(true);
    const downs = screen.getAllByLabelText('Move down');
    expect((downs[downs.length - 1] as HTMLButtonElement).disabled).toBe(true);
  });

  it('Remove deletes a lane', () => {
    render(<Harness initial={DEFAULT_COLUMNS} />);
    // Built-in lanes are re-addable, so their remove is a "Hide lane" (EyeOff); custom lanes get "Delete lane".
    fireEvent.click(screen.getAllByLabelText('Hide lane')[0]); // remove Todo
    expect(labels()).toBe('Available|In Progress|Done');
    expect(screen.getByText('Swimlanes (3)')).toBeTruthy();
  });

  it('shows the empty-state message when all lanes are removed', () => {
    render(<Harness initial={[DEFAULT_COLUMNS[0]]} />);
    fireEvent.click(screen.getByLabelText('Hide lane'));
    expect(screen.getByText('Add at least one lane.')).toBeTruthy();
  });

  it('offers only the missing built-in lanes for re-adding, and re-adds them', () => {
    render(<Harness initial={DEFAULT_COLUMNS} />); // missing BLOCKED, TESTING
    const readd = screen.getByText('Re-add built-in lanes').parentElement!;
    expect(within(readd).getByText('Blocked')).toBeTruthy();
    expect(within(readd).getByText('Review')).toBeTruthy();
    fireEvent.click(within(readd).getByText('Blocked'));
    expect(labels()).toBe('Todo|Available|In Progress|Done|Blocked');
  });

  it('hides the re-add section once all built-ins are present', () => {
    // Full 6-lane catalog → nothing missing.
    const all = DEFAULT_COLUMNS.concat(
      { id: 'BLOCKED', label: 'Blocked', color: '#f43f5e', builtin: true },
      { id: 'TESTING', label: 'Review', color: '#f59e0b', builtin: true },
    );
    render(<Harness initial={all} />);
    expect(screen.queryByText('Re-add built-in lanes')).toBeNull();
  });
});
