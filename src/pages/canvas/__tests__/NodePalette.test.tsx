// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NodePalette, PALETTE_CATEGORIES } from '../components/NodePalette';

afterEach(cleanup);

const searchFor = (query: string) => {
  fireEvent.change(screen.getByPlaceholderText('Search AWS, Azure, K8s, AI...'), {
    target: { value: query },
  });
};

describe('NodePalette control flow category', () => {
  it('defines the Control Flow / Sagas category with the four gateway nodes', () => {
    const category = PALETTE_CATEGORIES.find((c) => c.name === 'Control Flow / Sagas');
    expect(category).toBeTruthy();
    expect(category!.items.map((i) => i.type)).toEqual([
      'controlFlowGateway',
      'sagaOrchestrator',
      'resilienceGateway',
      'forkJoinGateway',
    ]);
  });

  it('renders the four control-flow nodes open by default', () => {
    render(<NodePalette />);
    expect(screen.getByText('Control Flow / Sagas')).toBeTruthy();
    expect(screen.getByText('Decision Gateway')).toBeTruthy();
    expect(screen.getByText('Saga Orchestrator')).toBeTruthy();
    expect(screen.getByText('Circuit Breaker')).toBeTruthy();
    expect(screen.getByText('Fork / Join')).toBeTruthy();
  });

  it("searching 'control' finds the Control Flow / Sagas category", () => {
    render(<NodePalette />);
    searchFor('control');
    expect(screen.getByText('Control Flow / Sagas')).toBeTruthy();
    expect(screen.getByText('Decision Gateway')).toBeTruthy();
    // Unrelated categories drop out of the filtered list.
    expect(screen.queryByText('AWS')).toBeNull();
  });

  it("the user's exact partial query 'contro' also matches", () => {
    render(<NodePalette />);
    searchFor('contro');
    expect(screen.getByText('Control Flow / Sagas')).toBeTruthy();
    expect(screen.getByText('Saga Orchestrator')).toBeTruthy();
  });

  it('clicking a control-flow item adds it via onAddNode with its node type', () => {
    const onAddNode = vi.fn();
    render(<NodePalette onAddNode={onAddNode} />);
    fireEvent.click(screen.getByText('Decision Gateway'));
    expect(onAddNode).toHaveBeenCalledTimes(1);
    expect(onAddNode.mock.calls[0][0]).toMatchObject({
      type: 'controlFlowGateway',
      category: 'Control Flow / Sagas',
    });
  });
});
