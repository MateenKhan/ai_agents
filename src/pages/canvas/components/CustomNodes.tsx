import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';

const nodeStyle = {
  padding: 10,
  borderRadius: 5,
  border: '1px solid #ddd',
  backgroundColor: '#fff',
  minWidth: 150,
};

export const GatewayNode = ({ data }: NodeProps) => {
  return (
    <div style={{ ...nodeStyle, borderColor: '#3b82f6' }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: 'bold', borderBottom: '1px solid #ddd', paddingBottom: 5, marginBottom: 5 }}>
        API Gateway
      </div>
      <div style={{ fontSize: '12px' }}>{data.label as string}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};

export const SpringBootNode = ({ data }: NodeProps) => {
  return (
    <div style={{ ...nodeStyle, borderColor: '#10b981', minHeight: 100 }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: 'bold', borderBottom: '1px solid #ddd', paddingBottom: 5, marginBottom: 5 }}>
        Spring Boot
      </div>
      <div style={{ fontSize: '12px' }}>{data.label as string}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
};

export const DatabaseNode = ({ data }: NodeProps) => {
  return (
    <div style={{ ...nodeStyle, borderColor: '#f59e0b', borderRadius: '50%' }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: 'bold', textAlign: 'center', paddingTop: 20 }}>
        Database
      </div>
      <div style={{ fontSize: '12px', textAlign: 'center', paddingBottom: 20 }}>{data.label as string}</div>
    </div>
  );
};

/** Shared frame for the four control-flow / saga gateway node types. */
const makeControlFlowNode = (title: string, borderColor: string) => {
  const ControlFlowNode = ({ data }: NodeProps) => {
    return (
      <div style={{ ...nodeStyle, borderColor, borderStyle: 'dashed' }}>
        <Handle type="target" position={Position.Top} />
        <div style={{ fontWeight: 'bold', borderBottom: '1px solid #ddd', paddingBottom: 5, marginBottom: 5, color: borderColor }}>
          {title}
        </div>
        <div style={{ fontSize: '12px' }}>{data.label as string}</div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  };
  ControlFlowNode.displayName = `${title.replace(/[^a-zA-Z]/g, '')}Node`;
  return ControlFlowNode;
};

export const ControlFlowGatewayNode = makeControlFlowNode('Decision Gateway', '#f97316');
export const SagaOrchestratorNode = makeControlFlowNode('Saga Orchestrator', '#8b5cf6');
export const ResilienceGatewayNode = makeControlFlowNode('Circuit Breaker', '#ef4444');
export const ForkJoinGatewayNode = makeControlFlowNode('Fork / Join', '#06b6d4');

export const nodeTypes = {
  gateway: GatewayNode,
  springBoot: SpringBootNode,
  database: DatabaseNode,
  controlFlowGateway: ControlFlowGatewayNode,
  sagaOrchestrator: SagaOrchestratorNode,
  resilienceGateway: ResilienceGatewayNode,
  forkJoinGateway: ForkJoinGatewayNode,
};
