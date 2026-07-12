// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ControlFlowInspector, isControlFlowNodeType } from '../components/ControlFlowInspector';
import type { ControlFlowNodeType } from '../components/ControlFlowInspector';

afterEach(cleanup);

const TARGETS = [
  { id: 'n-fraud', label: 'PaymentFraudAuditService' },
  { id: 'n-instant', label: 'InstantPaymentService' },
];

const renderInspector = (
  nodeType: ControlFlowNodeType,
  nodeData: Record<string, unknown> = { label: 'CF Node' }
) => {
  const onUpdateNode = vi.fn();
  render(
    <ControlFlowInspector
      nodeId="cf-1"
      nodeType={nodeType}
      nodeData={nodeData}
      targetNodes={TARGETS}
      onUpdateNode={onUpdateNode}
    />
  );
  return onUpdateNode;
};

describe('ControlFlowInspector', () => {
  it('recognises exactly the four control-flow node types', () => {
    expect(isControlFlowNodeType('controlFlowGateway')).toBe(true);
    expect(isControlFlowNodeType('sagaOrchestrator')).toBe(true);
    expect(isControlFlowNodeType('resilienceGateway')).toBe(true);
    expect(isControlFlowNodeType('forkJoinGateway')).toBe(true);
    expect(isControlFlowNodeType('springBoot')).toBe(false);
    expect(isControlFlowNodeType(undefined)).toBe(false);
  });

  it('decision gateway: persists the evaluation engine into node data', () => {
    const onUpdateNode = renderInspector('controlFlowGateway');
    fireEvent.change(screen.getByLabelText('Evaluation Engine'), {
      target: { value: 'jsonpath' },
    });
    expect(onUpdateNode).toHaveBeenCalledWith('cf-1', expect.objectContaining({
      routingEngine: 'jsonpath',
    }));
  });

  it('decision gateway: adds an IF routing rule with condition and target selects', () => {
    const onUpdateNode = renderInspector('controlFlowGateway');
    fireEvent.click(screen.getByText('Add Routing Rule'));
    const data = onUpdateNode.mock.calls[0][1] as { routingRules: Array<Record<string, unknown>> };
    expect(data.routingRules).toHaveLength(1);
    expect(data.routingRules[0]).toMatchObject({ kind: 'IF', condition: '', targetNodeId: '' });
  });

  it('decision gateway: routing rule rows offer the other canvas nodes as targets', () => {
    renderInspector('controlFlowGateway', {
      label: 'CF Node',
      routingRules: [{ id: 'r1', kind: 'IF', condition: 'payload.amount > 10000', targetNodeId: '' }],
    });
    const targetSelect = screen.getByLabelText('Target node') as HTMLSelectElement;
    const optionLabels = Array.from(targetSelect.options).map((o) => o.textContent);
    expect(optionLabels).toContain('PaymentFraudAuditService');
    expect(optionLabels).toContain('InstantPaymentService');
  });

  it('saga orchestrator: persists mode and appends compensating actions', () => {
    const onUpdateNode = renderInspector('sagaOrchestrator');
    fireEvent.change(screen.getByLabelText('Saga Pattern Mode'), {
      target: { value: 'choreographed' },
    });
    expect(onUpdateNode).toHaveBeenCalledWith('cf-1', expect.objectContaining({
      sagaMode: 'choreographed',
    }));
    fireEvent.click(screen.getByText('Add Compensating Action'));
    const data = onUpdateNode.mock.calls[1][1] as { compensatingActions: Array<Record<string, unknown>> };
    expect(data.compensatingActions).toHaveLength(1);
    expect(data.compensatingActions[0]).toMatchObject({ method: 'DELETE', endpoint: '' });
  });

  it('circuit breaker: persists all four resilience thresholds', () => {
    const onUpdateNode = renderInspector('resilienceGateway');
    fireEvent.change(screen.getByLabelText('Failure Rate Threshold'), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText('Sliding Window Size'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('Wait Duration in Open State'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Half-Open Probe Calls'), { target: { value: '5' } });
    expect(onUpdateNode).toHaveBeenNthCalledWith(1, 'cf-1', expect.objectContaining({ failureRateThreshold: 75 }));
    expect(onUpdateNode).toHaveBeenNthCalledWith(2, 'cf-1', expect.objectContaining({ slidingWindowSize: 200 }));
    expect(onUpdateNode).toHaveBeenNthCalledWith(3, 'cf-1', expect.objectContaining({ waitDurationSeconds: 30 }));
    expect(onUpdateNode).toHaveBeenNthCalledWith(4, 'cf-1', expect.objectContaining({ halfOpenProbeCalls: 5 }));
  });

  it('fork/join: persists the join strategy and reveals the quorum input for M-of-N', () => {
    const onUpdateNode = renderInspector('forkJoinGateway');
    expect(screen.queryByLabelText('Minimum Successes (M)')).toBeNull();
    fireEvent.change(screen.getByLabelText('Join Strategy'), { target: { value: 'M_OF_N' } });
    expect(onUpdateNode).toHaveBeenCalledWith('cf-1', expect.objectContaining({ joinStrategy: 'M_OF_N' }));
    cleanup();
    // Re-render with the strategy persisted: the M input becomes visible and writable.
    const onUpdate2 = renderInspector('forkJoinGateway', { label: 'CF Node', joinStrategy: 'M_OF_N' });
    fireEvent.change(screen.getByLabelText('Minimum Successes (M)'), { target: { value: '3' } });
    expect(onUpdate2).toHaveBeenCalledWith('cf-1', expect.objectContaining({ joinQuorum: 3 }));
  });
});
