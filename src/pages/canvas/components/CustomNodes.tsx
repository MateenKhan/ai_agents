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

export const nodeTypes = {
  gateway: GatewayNode,
  springBoot: SpringBootNode,
  database: DatabaseNode,
};
