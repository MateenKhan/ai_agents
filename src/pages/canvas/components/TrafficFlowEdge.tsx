import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from '@xyflow/react';

export interface TrafficFlowEdgeData {
  color?: string;
  speed?: 'fast' | 'normal' | 'slow';
  strokeStyle?: 'solid' | 'dashed';
  arrowhead?: 'arrow' | 'none' | 'dot';
  label?: string;
  animatedPackets?: boolean;
  [key: string]: unknown;
}

export const TrafficFlowEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  selected,
}) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const edgeData = (data || {}) as TrafficFlowEdgeData;
  const color = edgeData.color || '#3b82f6';
  const speed = edgeData.speed || 'normal';
  const strokeStyle = edgeData.strokeStyle || 'solid';
  const label = edgeData.label;
  const showPackets = edgeData.animatedPackets !== false;

  const durationMap = {
    fast: '1.5s',
    normal: '3s',
    slow: '5s',
  };
  const duration = durationMap[speed] || '3s';

  const dashArray = strokeStyle === 'dashed' ? '6 5' : undefined;
  const pathId = `edge-path-${id}`;

  return (
    <>
      <svg className="absolute w-0 h-0">
        <defs>
          <path id={pathId} d={edgePath} />
          <filter id={`glow-${id}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
      </svg>

      {/* Background shadow/highlight when selected */}
      {selected && (
        <path
          d={edgePath}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeOpacity={0.25}
          className="transition-all duration-300"
        />
      )}

      {/* Main Edge Path */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: color,
          strokeWidth: selected ? 2.5 : 2,
          strokeDasharray: dashArray,
          transition: 'stroke 0.2s ease, stroke-width 0.2s ease',
        }}
      />

      {/* Animated Data Packets traveling along path */}
      {showPackets && (
        <g>
          {/* Leading packet */}
          <circle r={4.5} fill={color} filter={`url(#glow-${id})`}>
            <animateMotion
              dur={duration}
              repeatCount="indefinite"
              path={edgePath}
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="linear"
            />
          </circle>
          {/* Inner core white highlight */}
          <circle r={2} fill="#ffffff">
            <animateMotion
              dur={duration}
              repeatCount="indefinite"
              path={edgePath}
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="linear"
            />
          </circle>

          {/* Secondary trailing packet offset */}
          <circle r={3} fill={color} opacity={0.65}>
            <animateMotion
              dur={duration}
              begin={`-${parseFloat(duration) * 0.5}s`}
              repeatCount="indefinite"
              path={edgePath}
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="linear"
            />
          </circle>
        </g>
      )}

      {/* Interactive Edge Label */}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <div
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold shadow-sm border transition-all ${
                selected
                  ? 'bg-blue-600 text-white border-blue-700 scale-105 shadow-md'
                  : 'bg-white/95 text-slate-700 border-slate-200 hover:border-slate-300 backdrop-blur-sm'
              }`}
            >
              {label}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
