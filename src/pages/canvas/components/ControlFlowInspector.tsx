import React from 'react';
import {
  GitBranch, GitFork, Plus, Repeat, ShieldAlert, Trash2, X,
} from 'lucide-react';

// Bespoke configuration forms for the four control-flow / saga node types
// (docs/canvas-control-flow-pending.md section 3). Everything typed here is
// persisted straight into the node's data object via the same onUpdateNode
// mechanism the other inspectors use.

export const CONTROL_FLOW_NODE_TYPES = [
  'controlFlowGateway',
  'sagaOrchestrator',
  'resilienceGateway',
  'forkJoinGateway',
] as const;

export type ControlFlowNodeType = (typeof CONTROL_FLOW_NODE_TYPES)[number];

export const isControlFlowNodeType = (nodeType: string | undefined): nodeType is ControlFlowNodeType =>
  !!nodeType && (CONTROL_FLOW_NODE_TYPES as readonly string[]).includes(nodeType);

export type RoutingEngine = 'spel' | 'jsonpath' | 'javascript' | 'header-regex';

export interface RoutingRule {
  id: string;
  kind: 'IF' | 'ELSE_IF' | 'ELSE';
  condition: string;
  targetNodeId: string;
}

export interface CompensatingAction {
  id: string;
  method: 'DELETE' | 'POST' | 'PUT' | 'PATCH';
  endpoint: string;
}

const ROUTING_ENGINES: { value: RoutingEngine; label: string }[] = [
  { value: 'spel', label: 'SpEL (Spring Expression Language)' },
  { value: 'jsonpath', label: 'JSONPath Predicate' },
  { value: 'javascript', label: 'JavaScript Expression' },
  { value: 'header-regex', label: 'Header Regex Match' },
];

const HTTP_METHODS: CompensatingAction['method'][] = ['DELETE', 'POST', 'PUT', 'PATCH'];

const newId = () => `cf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

interface TargetNodeOption {
  id: string;
  label: string;
}

interface ControlFlowInspectorProps {
  nodeId: string;
  nodeType: ControlFlowNodeType;
  nodeData: Record<string, unknown>;
  /** Other nodes on the canvas, selectable as routing targets. */
  targetNodes: TargetNodeOption[];
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
  onClose?: () => void;
}

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
    {children}
  </label>
);

const inputClass =
  'w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 placeholder:text-slate-400 bg-white';

const HEADER_META: Record<ControlFlowNodeType, { title: string; icon: React.ReactNode }> = {
  controlFlowGateway: { title: 'Decision Gateway', icon: <GitBranch size={14} /> },
  sagaOrchestrator: { title: 'Saga Orchestrator', icon: <Repeat size={14} /> },
  resilienceGateway: { title: 'Circuit Breaker & Retry', icon: <ShieldAlert size={14} /> },
  forkJoinGateway: { title: 'Fork / Join Fan-Out', icon: <GitFork size={14} /> },
};

export const ControlFlowInspector: React.FC<ControlFlowInspectorProps> = ({
  nodeId, nodeType, nodeData, targetNodes, onUpdateNode, onClose,
}) => {
  const setData = (patch: Record<string, unknown>) => {
    onUpdateNode(nodeId, { ...nodeData, ...patch });
  };

  const meta = HEADER_META[nodeType];

  // ----- Decision gateway state -----
  const routingEngine = (nodeData.routingEngine as RoutingEngine) || 'spel';
  const routingRules: RoutingRule[] = Array.isArray(nodeData.routingRules)
    ? (nodeData.routingRules as RoutingRule[])
    : [];

  const updateRule = (ruleId: string, patch: Partial<RoutingRule>) => {
    setData({
      routingRules: routingRules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...patch } : rule
      ),
    });
  };

  const addRule = () => {
    const kind: RoutingRule['kind'] = routingRules.length === 0 ? 'IF' : 'ELSE_IF';
    setData({
      routingRules: [
        ...routingRules,
        { id: newId(), kind, condition: '', targetNodeId: '' },
      ],
    });
  };

  const removeRule = (ruleId: string) => {
    setData({ routingRules: routingRules.filter((rule) => rule.id !== ruleId) });
  };

  // ----- Saga state -----
  const sagaMode = (nodeData.sagaMode as string) || 'orchestrated';
  const compensatingActions: CompensatingAction[] = Array.isArray(nodeData.compensatingActions)
    ? (nodeData.compensatingActions as CompensatingAction[])
    : [];

  const updateAction = (actionId: string, patch: Partial<CompensatingAction>) => {
    setData({
      compensatingActions: compensatingActions.map((action) =>
        action.id === actionId ? { ...action, ...patch } : action
      ),
    });
  };

  const addAction = () => {
    setData({
      compensatingActions: [
        ...compensatingActions,
        { id: newId(), method: 'DELETE', endpoint: '' },
      ],
    });
  };

  const removeAction = (actionId: string) => {
    setData({
      compensatingActions: compensatingActions.filter((action) => action.id !== actionId),
    });
  };

  // ----- Circuit breaker state -----
  const failureRateThreshold = (nodeData.failureRateThreshold as number) ?? 50;
  const slidingWindowSize = (nodeData.slidingWindowSize as number) ?? 100;
  const waitDurationSeconds = (nodeData.waitDurationSeconds as number) ?? 60;
  const halfOpenProbeCalls = (nodeData.halfOpenProbeCalls as number) ?? 10;

  // ----- Fork/join state -----
  const joinStrategy = (nodeData.joinStrategy as string) || 'ALL';
  const joinQuorum = (nodeData.joinQuorum as number) ?? 2;

  const numberField = (
    label: string,
    key: string,
    value: number,
    props: { min?: number; max?: number; suffix?: string }
  ) => (
    <div key={key}>
      <SectionLabel>{label}</SectionLabel>
      <div className="flex items-center gap-2">
        <input
          type="number"
          aria-label={label}
          min={props.min}
          max={props.max}
          value={value}
          onChange={(e) => setData({ [key]: Number(e.target.value) })}
          className={inputClass}
        />
        {props.suffix && (
          <span className="text-[10px] text-slate-500 font-semibold shrink-0">{props.suffix}</span>
        )}
      </div>
    </div>
  );

  return (
    <div
      data-testid="control-flow-inspector"
      className="w-80 bg-white border-r border-slate-200 flex flex-col h-full shrink-0 select-none shadow-sm overflow-y-auto"
    >
      <div className="p-3.5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-orange-100 text-orange-600 flex items-center justify-center">
            {meta.icon}
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800">{meta.title}</h3>
            <p className="text-[10px] text-slate-500 truncate">
              {(nodeData.label as string) || nodeId}
            </p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close control flow inspector"
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="p-4 space-y-5 flex-1">
        {nodeType === 'controlFlowGateway' && (
          <>
            <div>
              <SectionLabel>Evaluation Engine</SectionLabel>
              <select
                aria-label="Evaluation Engine"
                value={routingEngine}
                onChange={(e) => setData({ routingEngine: e.target.value as RoutingEngine })}
                className={inputClass}
              >
                {ROUTING_ENGINES.map((engine) => (
                  <option key={engine.value} value={engine.value}>
                    {engine.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <SectionLabel>Routing Rules</SectionLabel>
              <div className="space-y-2">
                {routingRules.length === 0 && (
                  <p className="text-[10px] text-slate-400">
                    No rules yet. Add an IF rule to route conditionally.
                  </p>
                )}
                {routingRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="border border-slate-200 rounded-md p-2 space-y-1.5 bg-slate-50/50"
                  >
                    <div className="flex items-center gap-1.5">
                      <select
                        aria-label="Rule kind"
                        value={rule.kind}
                        onChange={(e) =>
                          updateRule(rule.id, { kind: e.target.value as RoutingRule['kind'] })
                        }
                        className="px-1.5 py-1 text-[10px] font-bold border border-slate-200 rounded bg-white text-slate-700"
                      >
                        <option value="IF">IF</option>
                        <option value="ELSE_IF">ELSE IF</option>
                        <option value="ELSE">ELSE</option>
                      </select>
                      <select
                        aria-label="Target node"
                        value={rule.targetNodeId}
                        onChange={(e) => updateRule(rule.id, { targetNodeId: e.target.value })}
                        className="flex-1 px-1.5 py-1 text-[10px] border border-slate-200 rounded bg-white text-slate-700 min-w-0"
                      >
                        <option value="">Select target node...</option>
                        {targetNodes.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeRule(rule.id)}
                        aria-label="Remove rule"
                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {rule.kind !== 'ELSE' && (
                      <input
                        type="text"
                        aria-label="Rule condition"
                        placeholder="e.g. payload.amount > 10000"
                        value={rule.condition}
                        onChange={(e) => updateRule(rule.id, { condition: e.target.value })}
                        className={inputClass}
                      />
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addRule}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-slate-300 text-slate-600 text-xs font-bold hover:border-blue-400 hover:text-blue-600 transition-colors"
                >
                  <Plus size={13} /> Add Routing Rule
                </button>
              </div>
            </div>
          </>
        )}

        {nodeType === 'sagaOrchestrator' && (
          <>
            <div>
              <SectionLabel>Saga Pattern Mode</SectionLabel>
              <select
                aria-label="Saga Pattern Mode"
                value={sagaMode}
                onChange={(e) => setData({ sagaMode: e.target.value })}
                className={inputClass}
              >
                <option value="orchestrated">Orchestrated Saga (Central Coordinator)</option>
                <option value="choreographed">Choreographed Saga (Event Pub/Sub)</option>
              </select>
            </div>
            <div>
              <SectionLabel>Compensating Actions</SectionLabel>
              <div className="space-y-2">
                {compensatingActions.length === 0 && (
                  <p className="text-[10px] text-slate-400">
                    Rollback endpoints executed automatically when a downstream step fails.
                  </p>
                )}
                {compensatingActions.map((action) => (
                  <div key={action.id} className="flex items-center gap-1.5">
                    <select
                      aria-label="Compensation method"
                      value={action.method}
                      onChange={(e) =>
                        updateAction(action.id, {
                          method: e.target.value as CompensatingAction['method'],
                        })
                      }
                      className="px-1.5 py-1 text-[10px] font-bold border border-slate-200 rounded bg-white text-slate-700 shrink-0"
                    >
                      {HTTP_METHODS.map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      aria-label="Compensation endpoint"
                      placeholder="/order/{id}"
                      value={action.endpoint}
                      onChange={(e) => updateAction(action.id, { endpoint: e.target.value })}
                      className={`${inputClass} font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => removeAction(action.id)}
                      aria-label="Remove compensating action"
                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addAction}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-slate-300 text-slate-600 text-xs font-bold hover:border-blue-400 hover:text-blue-600 transition-colors"
                >
                  <Plus size={13} /> Add Compensating Action
                </button>
              </div>
            </div>
          </>
        )}

        {nodeType === 'resilienceGateway' && (
          <>
            {numberField('Failure Rate Threshold', 'failureRateThreshold', failureRateThreshold, {
              min: 1, max: 100, suffix: '%',
            })}
            {numberField('Sliding Window Size', 'slidingWindowSize', slidingWindowSize, {
              min: 1, suffix: 'requests',
            })}
            {numberField('Wait Duration in Open State', 'waitDurationSeconds', waitDurationSeconds, {
              min: 1, suffix: 'seconds',
            })}
            {numberField('Half-Open Probe Calls', 'halfOpenProbeCalls', halfOpenProbeCalls, {
              min: 1, suffix: 'requests',
            })}
          </>
        )}

        {nodeType === 'forkJoinGateway' && (
          <>
            <div>
              <SectionLabel>Join Strategy</SectionLabel>
              <select
                aria-label="Join Strategy"
                value={joinStrategy}
                onChange={(e) => setData({ joinStrategy: e.target.value })}
                className={inputClass}
              >
                <option value="ALL">Wait for ALL (Promise.all / allOf)</option>
                <option value="ANY">Wait for ANY first response (Race)</option>
                <option value="M_OF_N">Partial tolerance (M of N succeed)</option>
              </select>
            </div>
            {joinStrategy === 'M_OF_N' &&
              numberField('Minimum Successes (M)', 'joinQuorum', joinQuorum, {
                min: 1, suffix: 'of N branches',
              })}
          </>
        )}
      </div>

      <div className="p-2.5 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 text-center font-medium">
        Control-flow configuration is stored on the node
      </div>
    </div>
  );
};
