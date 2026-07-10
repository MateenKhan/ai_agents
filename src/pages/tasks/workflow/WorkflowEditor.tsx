// ─────────────────────────────────────────────────────────────────────────────
// WorkflowEditor — a real React component.
//
// The design mock injected a <script> carrying the whole app as top-level `const`s and
// relied on global ids (#canvas, #nodes) and global functions for inline onclick. That
// cannot live in this app:
//
//   • Top-level `const STAGES` lands in the global lexical environment. Unmounting cannot
//     un-declare it, so the SECOND mount threw `Identifier 'STAGES' has already been
//     declared`. React StrictMode mounts → unmounts → mounts in dev, so it died on load.
//   • `#canvas`, `#nodes`, `#saveBtn` are unscoped ids that collide with the host app.
//   • The caps inputs were bound to nothing and could never round-trip.
//   • Boot wrote localStorage before the seeded graph was read back, so localStorage always
//     beat `initialGraph` and the database became decorative.
//
// Everything below is refs + state. Two instances can coexist. Mounting twice is a no-op.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { Ask, Corner, Edge, Side, Stage, StageCaps, WorkflowGraph } from './types';
import { AGENT_ROLES, DEFAULT_CAPS, MODELS } from './types';
import { validateGraph } from './validate';
import { defaultGraph } from './defaultGraph';
import {
  NODE_W, autoLayout, autoSides, backOff, bezier, cornerAnchor, midpoint,
  nearestCorner, nearestSide, sideAnchor, clamp, type Anchor, type Box,
} from './geometry';
import { edgeState } from './taskRun';
import './workflow.css';

/** Per-stage run state, for Run mode. Supplied by the caller; the editor never invents it. */
export type RunState = 'pending' | 'running' | 'done' | 'rejected' | 'timeout';
export interface RunSnapshot {
  taskId: string;
  hops: number;
  stages: Record<string, { state: RunState; note?: string }>;
  /** Absolute path of the task's own log file, as persisted on the task row. */
  logHref?: string;
}

export interface WorkflowEditorProps {
  /** Seed graph, normally from the database. Reactive: changing it reloads the canvas. */
  graph?: WorkflowGraph;
  /** Fired on every edit. Debounced by the caller if it wants to autosave. */
  onChange?: (graph: WorkflowGraph) => void;
  /** Fired when Save is pressed. Only ever called with a graph that passes validation. */
  onSave?: (graph: WorkflowGraph) => void | Promise<void>;
  /** Present ⇒ Run mode is offered. Absent ⇒ edit only. */
  run?: RunSnapshot;
  /** View-only: no ports, no dragging, no inspector, no Save. Pan and zoom still work. */
  readOnly?: boolean;
  className?: string;
  style?: CSSProperties;
}

type Mode = 'edit' | 'run';
type DragKind = 'node' | 'pan' | 'edge' | 'reject' | 'ask';

interface Drag {
  kind: DragKind;
  from?: string;
  fromSide?: Side;
  fromCorner?: Corner;
  id?: string;
  ox?: number;
  oy?: number;
  sx?: number;
  sy?: number;
  /** Live endpoint in world coords, for the rubber-band path. */
  tip?: { x: number; y: number };
  dropTarget?: string;
}

type Selection =
  | { kind: 'stage'; id: string }
  | { kind: 'edge'; index: number }
  | { kind: 'ask'; index: number }
  | { kind: 'reject'; stageId: string }
  | null;

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];
/** Node height is uniform; measuring every card per frame was the mock's real cost. */
const NODE_H = 92;

const RUN_BADGE: Record<RunState, string> = {
  pending: 'pending',
  running: '▶ running',
  done: '✓ succeeded',
  rejected: '↩ rejected',
  timeout: '⏱ timed out',
};

export default function WorkflowEditor({ graph: graphProp, onChange, onSave, run, readOnly = false, className, style }: WorkflowEditorProps) {
  const [graph, setGraph] = useState<WorkflowGraph>(() => graphProp ?? defaultGraph());
  const [mode, setMode] = useState<Mode>(readOnly && run ? 'run' : 'edit');
  const [sel, setSel] = useState<Selection>({ kind: 'stage', id: 'build' });
  const [showRejects, setShowRejects] = useState(false);
  const [showAsks, setShowAsks] = useState(false);
  const [view, setView] = useState({ px: 40, py: 36, s: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeSeq = useRef(1);

  // Reactive seed. The mock read its seed once, off a global, and then let localStorage win.
  useEffect(() => { if (graphProp) setGraph(graphProp); }, [graphProp]);

  // onChange must not fire during render, and must not fire for the initial state.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    onChange?.(graph);
  }, [graph, onChange]);

  const validation = useMemo(() => validateGraph(graph), [graph]);
  const offenders = useMemo(() => new Set(validation.stageIssues.map(i => i.stageId)), [validation]);

  const byId = useCallback((id: string) => graph.stages.find(s => s.id === id), [graph.stages]);
  const boxOf = useCallback((id: string): Box | null => {
    const s = byId(id);
    return s ? { x: s.x, y: s.y, h: NODE_H } : null;
  }, [byId]);

  const mutate = useCallback((fn: (g: WorkflowGraph) => WorkflowGraph) => setGraph(g => fn(structuredClone(g))), []);

  // ── stage editing ──────────────────────────────────────────────────────────
  const patchStage = useCallback((id: string, patch: Partial<Stage>) => {
    mutate(g => {
      const s = g.stages.find(x => x.id === id);
      if (s) Object.assign(s, patch);
      return g;
    });
  }, [mutate]);

  const patchCaps = useCallback((id: string, key: keyof StageCaps, value: number) => {
    mutate(g => {
      const s = g.stages.find(x => x.id === id);
      if (s?.caps) s.caps[key] = value;
      return g;
    });
  }, [mutate]);

  /** Switching kind must add or strip the model and caps — a human has neither. */
  const setKind = useCallback((id: string, kind: Stage['kind']) => {
    mutate(g => {
      const s = g.stages.find(x => x.id === id);
      if (!s) return g;
      s.kind = kind;
      if (kind === 'human') { s.model = null; s.caps = null; }
      else { s.model = s.model ?? 'sonnet'; s.caps = s.caps ?? { ...DEFAULT_CAPS }; }
      return g;
    });
  }, [mutate]);

  const renameStage = useCallback((oldId: string, raw: string) => {
    const newId = raw.trim();
    if (!newId || newId === oldId) return;
    if (graph.stages.some(s => s.id === newId)) return; // validator would flag it; refuse quietly
    mutate(g => {
      const s = g.stages.find(x => x.id === oldId);
      if (s) s.id = newId;
      g.edges = g.edges.map(e => [e[0] === oldId ? newId : e[0], e[1] === oldId ? newId : e[1], e[2], e[3]] as Edge);
      g.asks = g.asks.map(a => [a[0] === oldId ? newId : a[0], a[1] === oldId ? newId : a[1], a[2], a[3]] as Ask);
      for (const x of g.stages) if (x.reject === oldId) x.reject = newId;
      if (g.entry === oldId) g.entry = newId;
      if (g.terminal === oldId) g.terminal = newId;
      return g;
    });
    setSel({ kind: 'stage', id: newId });
  }, [graph.stages, mutate]);

  const addStage = useCallback(() => {
    const id = `stage-${nodeSeq.current++}`;
    mutate(g => {
      g.stages.push({ id, role: 'dev', kind: 'agent', model: 'sonnet', caps: { ...DEFAULT_CAPS }, x: (-view.px + 320) / view.s, y: (-view.py + 140) / view.s });
      return g;
    });
    setSel({ kind: 'stage', id }); // arrives disconnected; the validator lights it up
  }, [mutate, view]);

  const removeStage = useCallback((id: string) => {
    mutate(g => {
      g.stages = g.stages.filter(s => s.id !== id);
      g.edges = g.edges.filter(e => e[0] !== id && e[1] !== id);
      g.asks = g.asks.filter(a => a[0] !== id && a[1] !== id);
      for (const s of g.stages) if (s.reject === id) delete s.reject;
      return g;
    });
    setSel(null);
  }, [mutate]);

  const addEdge = useCallback((from: string, to: string, fromSide?: Side, toSide?: Side) => {
    mutate(g => {
      if (!g.edges.some(e => e[0] === from && e[1] === to)) g.edges.push([from, to, fromSide, toSide]);
      return g;
    });
  }, [mutate]);

  const addAsk = useCallback((from: string, to: string, fc?: Corner, tc?: Corner) => {
    mutate(g => {
      if (!g.asks.some(a => a[0] === from && a[1] === to)) g.asks.push([from, to, fc ?? 'tr', tc ?? 'tl']);
      return g;
    });
    setShowAsks(true);
  }, [mutate]);

  const deleteSelection = useCallback(() => {
    if (!sel) return;
    if (sel.kind === 'edge') mutate(g => { g.edges.splice(sel.index, 1); return g; });
    else if (sel.kind === 'ask') mutate(g => { g.asks.splice(sel.index, 1); return g; });
    else if (sel.kind === 'reject') mutate(g => {
      const s = g.stages.find(x => x.id === sel.stageId);
      if (s) { delete s.reject; delete s.rejSide; delete s.rejToSide; }
      return g;
    });
    else if (sel.kind === 'stage') removeStage(sel.id);
    if (sel.kind !== 'stage') setSel(null);
  }, [sel, mutate, removeStage]);

  const arrange = useCallback(() => {
    mutate(g => {
      const pos = autoLayout(g.stages.map(s => s.id), g.edges, g.entry);
      for (const s of g.stages) Object.assign(s, pos[s.id]);
      return g;
    });
  }, [mutate]);

  // ── pointer: pan / drag node / draw a route ────────────────────────────────
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (clientX - r.left - view.px) / view.s, y: (clientY - r.top - view.py) / view.s };
  }, [view]);

  /** Pointer capture is optional: jsdom has no implementation, and neither do some embedded
   *  webviews. Losing it only means a drag can escape the canvas — never a crash. */
  const capture = (el: Element | null | undefined, pointerId: number) => {
    try { (el as HTMLElement | null)?.setPointerCapture?.(pointerId); } catch { /* not supported */ }
  };

  const onPointerDownCanvas = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('.pwf-node,.pwf-route')) return;
    setSel(null);
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.px, oy: view.py });
    capture(e.currentTarget, e.pointerId);
  };

  const onPointerDownNode = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (readOnly || mode !== 'edit') { setSel({ kind: 'stage', id }); return; }
    e.stopPropagation();
    const s = byId(id);
    if (!s) return;
    setSel({ kind: 'stage', id });
    setDrag({ kind: 'node', id, ox: s.x, oy: s.y, sx: e.clientX, sy: e.clientY });
    capture(canvasRef.current, e.pointerId);
  };

  const onPointerDownPort = (e: ReactPointerEvent<HTMLSpanElement>, id: string, kind: DragKind, side?: Side, corner?: Corner) => {
    e.stopPropagation();
    e.preventDefault();
    setDrag({ kind, from: id, fromSide: side, fromCorner: corner, tip: toWorld(e.clientX, e.clientY) });
    capture(canvasRef.current, e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      setView(v => ({ ...v, px: (drag.ox ?? 0) + (e.clientX - (drag.sx ?? 0)), py: (drag.oy ?? 0) + (e.clientY - (drag.sy ?? 0)) }));
      return;
    }
    if (drag.kind === 'node' && drag.id) {
      const dx = (e.clientX - (drag.sx ?? 0)) / view.s;
      const dy = (e.clientY - (drag.sy ?? 0)) / view.s;
      patchStage(drag.id, { x: (drag.ox ?? 0) + dx, y: (drag.oy ?? 0) + dy });
      return;
    }
    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const targetId = under?.closest<HTMLElement>('.pwf-node')?.dataset.id;
    setDrag(d => (d ? { ...d, tip: toWorld(e.clientX, e.clientY), dropTarget: targetId && targetId !== d.from ? targetId : undefined } : d));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const { kind, from, fromSide, fromCorner, dropTarget } = drag;
    if (from && dropTarget && (kind === 'edge' || kind === 'reject' || kind === 'ask')) {
      const w = toWorld(e.clientX, e.clientY);
      const tb = boxOf(dropTarget);
      if (tb) {
        if (kind === 'ask') addAsk(from, dropTarget, fromCorner, nearestCorner(tb, w.x, w.y));
        else if (kind === 'edge') addEdge(from, dropTarget, fromSide, nearestSide(tb, w.x, w.y));
        else {
          patchStage(from, { reject: dropTarget, rejSide: fromSide, rejToSide: nearestSide(tb, w.x, w.y) });
          setShowRejects(true);
        }
      }
    }
    setDrag(null);
  };

  const zoomBy = (d: number) => setView(v => {
    const el = canvasRef.current;
    const cx = (el?.clientWidth ?? 0) / 2;
    const cy = (el?.clientHeight ?? 0) / 2;
    const ns = clamp(v.s + d, 0.4, 1.6);
    return { px: cx - (cx - v.px) * (ns / v.s), py: cy - (cy - v.py) * (ns / v.s), s: ns };
  });

  const fitView = useCallback(() => {
    const el = canvasRef.current;
    if (!el || !graph.stages.length) return;
    const xs = graph.stages.map(s => s.x);
    const ys = graph.stages.map(s => s.y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs) + NODE_W;
    const minY = Math.min(...ys); const maxY = Math.max(...ys) + NODE_H;
    const pad = 60;
    const s = clamp(Math.min(el.clientWidth / (maxX - minX + pad * 2), el.clientHeight / (maxY - minY + pad * 2)), 0.4, 1.2);
    setView({
      s,
      px: (el.clientWidth - (maxX - minX) * s) / 2 - (minX - pad / 2) * s,
      py: (el.clientHeight - (maxY - minY) * s) / 2 - (minY - pad / 2) * s,
    });
  }, [graph.stages]);

  // Frame the graph once, as soon as the canvas actually has a size. On first paint inside a
  // flex parent its clientWidth is still 0, so fitView would divide by zero and clamp to the
  // minimum zoom — which is exactly what showed a 40% view of a clipped graph. Refit only
  // until it succeeds; after that the viewport belongs to the user's pan and zoom.
  const fitted = useRef(false);
  useEffect(() => {
    const el = canvasRef.current;
    if (fitted.current || !el) return;
    const tryFit = () => {
      if (fitted.current || !el.clientWidth || !el.clientHeight) return;
      fitted.current = true;
      fitView();
    };
    tryFit();
    if (fitted.current || typeof ResizeObserver === 'undefined') return; // jsdom has none
    const ro = new ResizeObserver(tryFit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView]);

  // Keyboard: Delete removes the selection unless a form field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (e.key === 'Escape') { setSel(null); return; }
      if (readOnly || mode !== 'edit') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|SELECT|TEXTAREA/.test(tag)) {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, readOnly, deleteSelection]);

  // ── geometry for rendering ─────────────────────────────────────────────────
  const edgePath = (from: string, to: string, fs?: Side, ts?: Side, type: 'acc' | 'rej' = 'acc') => {
    const a = boxOf(from); const b = boxOf(to);
    if (!a || !b) return null;
    const [dfs, dts] = autoSides(a, b);
    const p1 = sideAnchor(a, fs ?? dfs, type);
    const p2 = backOff(sideAnchor(b, ts ?? dts, type));
    return { d: bezier(p1, p2), p1, mid: midpoint(p1, p2) };
  };

  const askPath = (from: string, to: string, fc?: Corner, tc?: Corner) => {
    const a = boxOf(from); const b = boxOf(to);
    if (!a || !b) return null;
    const p1 = cornerAnchor(a, fc ?? 'tr');
    const p2 = backOff(cornerAnchor(b, tc ?? 'tl'), 10);
    return { d: bezier(p1, p2), p1, mid: midpoint(p1, p2) };
  };

  const rubberBand = (): string | null => {
    if (!drag?.from || !drag.tip || drag.kind === 'node' || drag.kind === 'pan') return null;
    const a = boxOf(drag.from);
    if (!a) return null;
    const p1: Anchor = drag.kind === 'ask'
      ? cornerAnchor(a, drag.fromCorner ?? 'tr')
      : sideAnchor(a, drag.fromSide ?? 'right', drag.kind === 'reject' ? 'rej' : 'acc');
    return bezier(p1, { ...drag.tip, nx: 0, ny: 0 });
  };

  const selectedStage = sel?.kind === 'stage' ? byId(sel.id) : undefined;

  const handleSave = () => { if (validation.ok) void onSave?.(graph); };

  return (
    <div className={`pwf${className ? ` ${className}` : ''}`} data-mode={mode} style={style}>
      <header className="pwf-header">
        <span className="pwf-logo"><span className="pwf-dot">P</span> Piranha</span>
        <span className="pwf-xs2 pwf-muted">Workflow</span>
        {run && (
          <div className="pwf-seg" role="group" aria-label="Mode">
            <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>Edit</button>
            <button type="button" aria-pressed={mode === 'run'} onClick={() => setMode('run')}>Run</button>
          </div>
        )}
        <span className="pwf-spacer" />
        {mode === 'edit' && !readOnly && (
          <>
            <button type="button" className="pwf-btn-sm" onClick={addStage}>+ Add stage</button>
            <button type="button" className="pwf-btn-sm" onClick={arrange}>Auto-arrange</button>
            <button type="button" className="pwf-btn-sm" aria-pressed={showRejects} onClick={() => setShowRejects(v => !v)}>↩ Reject routes</button>
            <button type="button" className="pwf-btn-sm" aria-pressed={showAsks} onClick={() => setShowAsks(v => !v)}>? Ask routes</button>
            <button type="button" className="pwf-btn-primary" disabled={!validation.ok} onClick={handleSave}>Save workflow</button>
          </>
        )}
      </header>

      {/* The control that stops a graph stranding tasks. Save is disabled until it is green.
          Hidden when read-only: a viewer cannot fix the graph, so the bar would only be noise. */}
      {!readOnly && (
      <div className={`pwf-validator ${validation.ok ? 'ok' : 'bad'}`} aria-live="polite">
        {validation.ok ? (
          <><span className="pwf-okmark">✓</span><span>Graph valid — every stage reachable, and <code>{graph.terminal}</code> reachable from <code>{graph.entry}</code>.</span></>
        ) : (
          <>
            <span className="pwf-badmark">!</span>
            <span>Save blocked — {validation.stageIssues.length || validation.graphErrors.length} problem{(validation.stageIssues.length || validation.graphErrors.length) > 1 ? 's' : ''} would strand tasks.</span>
            {validation.stageIssues.map(i => (
              <button key={i.stageId} type="button" className="pwf-offender" title={i.reasons.join(' · ')} onClick={() => setSel({ kind: 'stage', id: i.stageId })}>
                {i.stageId} ↗
              </button>
            ))}
            {validation.graphErrors.map(e => <span key={e} className="pwf-xs2">{e}</span>)}
          </>
        )}
      </div>
      )}

      {run && mode === 'run' && (
        <div className="pwf-runbar">
          <span className="pwf-eyebrow">Task</span>
          <span className="pwf-mono">{run.taskId}</span>
          <span className="pwf-hops">hops <b>{run.hops}</b> / {graph.hopCap}</span>
          <span className="pwf-spacer" />
          {run.logHref && <a href={run.logHref}>open task log ↗</a>}
        </div>
      )}

      <main className="pwf-main">
        <section
          ref={canvasRef}
          className="pwf-canvas"
          aria-label="Workflow graph"
          onPointerDown={onPointerDownCanvas}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          onWheel={e => {
            const r = canvasRef.current?.getBoundingClientRect();
            if (!r) return;
            const mx = e.clientX - r.left; const my = e.clientY - r.top;
            setView(v => {
              const ns = clamp(v.s * (1 - e.deltaY * 0.0012), 0.4, 1.6);
              return { px: mx - (mx - v.px) * (ns / v.s), py: my - (my - v.py) * (ns / v.s), s: ns };
            });
          }}
        >
          <div className="pwf-world" style={{ transform: `translate(${view.px}px,${view.py}px) scale(${view.s})` }}>
            <svg className="pwf-edges" aria-hidden="true">
              <defs>
                <marker id="pwf-ah" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9 z" fill="#4bc48c" /></marker>
                <marker id="pwf-ahr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--pwf-rose-500)" /></marker>
                <marker id="pwf-aha" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--pwf-ai-500)" /></marker>
              </defs>

              {graph.edges.map((e, i) => {
                const g = edgePath(e[0], e[1], e[2], e[3], 'acc');
                if (!g) return null;
                const isSel = sel?.kind === 'edge' && sel.index === i;
                // In run mode the wire tells the story: emerald where work has flowed, an
                // animated dash into the stage running right now.
                const flow = mode === 'run' && run ? edgeState(run, e[0], e[1]) : 'idle';
                return (
                  <g key={`e${i}`} className={`pwf-route pwf-eg ${flow}${isSel ? ' sel' : ''}`} onPointerDown={ev => { ev.stopPropagation(); if (!readOnly) setSel({ kind: 'edge', index: i }); }}>
                    <path className="pwf-hit" d={g.d} />
                    <path className="pwf-wire" d={g.d} markerEnd="url(#pwf-ah)" />
                  </g>
                );
              })}

              {mode === 'edit' && showRejects && graph.stages.map(s => {
                const target = s.reject ?? graph.edges.find(e => e[1] === s.id)?.[0];
                if (!target || target === s.id) return null;
                const g = edgePath(s.id, target, s.rejSide, s.rejToSide, 'rej');
                if (!g) return null;
                const isSel = sel?.kind === 'reject' && sel.stageId === s.id;
                return (
                  <g key={`r${s.id}`} className={`pwf-route pwf-rej${isSel ? ' sel' : ''}`} onPointerDown={ev => { ev.stopPropagation(); setSel({ kind: 'reject', stageId: s.id }); }}>
                    <path className="pwf-hit" d={g.d} />
                    <path className="pwf-wire" d={g.d} markerEnd="url(#pwf-ahr)" />
                  </g>
                );
              })}

              {mode === 'edit' && showAsks && graph.asks.map((a, i) => {
                const g = askPath(a[0], a[1], a[2], a[3]);
                if (!g) return null;
                const isSel = sel?.kind === 'ask' && sel.index === i;
                return (
                  <g key={`a${i}`} className={`pwf-route pwf-ask${isSel ? ' sel' : ''}`} onPointerDown={ev => { ev.stopPropagation(); setSel({ kind: 'ask', index: i }); }}>
                    <path className="pwf-hit" d={g.d} />
                    <path className="pwf-wire" d={g.d} markerEnd="url(#pwf-aha)" />
                  </g>
                );
              })}

              {rubberBand() && <path className={`pwf-tmp pwf-tmp-${drag?.kind}`} d={rubberBand()!} />}
            </svg>

            {graph.stages.map(s => {
              const rs = run?.stages[s.id]?.state;
              return (
                <div
                  key={s.id}
                  className="pwf-node"
                  data-id={s.id}
                  data-human={s.kind === 'human'}
                  data-selected={sel?.kind === 'stage' && sel.id === s.id}
                  data-offender={offenders.has(s.id)}
                  data-drop={drag?.dropTarget === s.id ? drag.kind : undefined}
                  data-run={mode === 'run' ? rs : undefined}
                  style={{ left: s.x, top: s.y }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Stage ${s.id}, ${s.kind === 'human' ? 'human' : s.role}`}
                  onPointerDown={e => onPointerDownNode(e, s.id)}
                >
                  {mode === 'edit' && !readOnly && SIDES.map(side => (
                    <span key={`p${side}`}>
                      <span className={`pwf-port acc s-${side}`} title="drag: accept route" onPointerDown={e => onPointerDownPort(e, s.id, 'edge', side)} />
                      <span className={`pwf-port rej s-${side}`} title="drag: reject route" onPointerDown={e => onPointerDownPort(e, s.id, 'reject', side)} />
                    </span>
                  ))}
                  {mode === 'edit' && !readOnly && s.kind !== 'human' && CORNERS.map(c => (
                    <span key={`c${c}`} className={`pwf-port ask c-${c}`} title="drag: consult another agent" onPointerDown={e => onPointerDownPort(e, s.id, 'ask', undefined, c)} />
                  ))}

                  {mode === 'run' && rs === 'running' && <span className="pwf-pulse" aria-hidden="true" />}
                  {mode === 'run' && rs && <span className="pwf-runbadge">{RUN_BADGE[rs]}</span>}
                  <div className="pwf-node-head">
                    <span className={`pwf-role ${s.kind}`}>{s.kind === 'human' ? 'human' : s.role}</span>
                  </div>
                  <h3 className="pwf-mono">{s.id}</h3>
                  {/* A human has no model and no retries. Nothing to show. */}
                  {s.kind === 'agent' && <div className="pwf-micro pwf-muted">{s.model}</div>}
                  <div className="pwf-meta">
                    {s.kind === 'agent' && s.caps
                      ? <span className="pwf-chip">attempts {s.caps.attempts}</span>
                      : <span className="pwf-chip">no timeout</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pwf-canvas-ctl" role="group" aria-label="Zoom">
            <button type="button" onClick={() => zoomBy(-0.15)} aria-label="Zoom out">−</button>
            <span className="pwf-zval">{Math.round(view.s * 100)}%</span>
            <button type="button" onClick={() => zoomBy(0.15)} aria-label="Zoom in">+</button>
            <button type="button" onClick={fitView} aria-label="Fit graph" title="Fit">⤢</button>
          </div>
        </section>

        {mode === 'edit' && !readOnly && (
          <aside className="pwf-inspector">
            {!selectedStage ? (
              <p className="pwf-empty">Select a stage to edit its agent, routes and caps.<br /><br />Every stage must stay on a path from <code>{graph.entry}</code> to <code>{graph.terminal}</code>.</p>
            ) : (
              <StageForm
                key={selectedStage.id}
                stage={selectedStage}
                graph={graph}
                issues={validation.stageIssues.find(i => i.stageId === selectedStage.id)?.reasons ?? []}
                onRename={renameStage}
                onPatch={patchStage}
                onPatchCaps={patchCaps}
                onSetKind={setKind}
                onAddEdge={addEdge}
                onRemoveEdge={(to) => mutate(g => { g.edges = g.edges.filter(e => !(e[0] === selectedStage.id && e[1] === to)); return g; })}
                onAddAsk={(to) => addAsk(selectedStage.id, to)}
                onRemoveAsk={(to) => mutate(g => { g.asks = g.asks.filter(a => !(a[0] === selectedStage.id && a[1] === to)); return g; })}
                onHopCap={(n) => mutate(g => { g.hopCap = n; return g; })}
                onRemove={() => removeStage(selectedStage.id)}
              />
            )}
          </aside>
        )}
      </main>
    </div>
  );
}

// ─── inspector ───────────────────────────────────────────────────────────────

interface StageFormProps {
  stage: Stage;
  graph: WorkflowGraph;
  issues: string[];
  onRename: (oldId: string, newId: string) => void;
  onPatch: (id: string, patch: Partial<Stage>) => void;
  onPatchCaps: (id: string, key: keyof StageCaps, value: number) => void;
  onSetKind: (id: string, kind: Stage['kind']) => void;
  onAddEdge: (from: string, to: string) => void;
  onRemoveEdge: (to: string) => void;
  onAddAsk: (to: string) => void;
  onRemoveAsk: (to: string) => void;
  onHopCap: (n: number) => void;
  onRemove: () => void;
}

const CAP_FIELDS: Array<[keyof StageCaps, string]> = [
  ['attempts', 'Max attempts'],
  ['backoffSec', 'Backoff (s)'],
  ['hardTimeoutMin', 'Hard timeout (min)'],
  ['stallKillSec', 'Stall kill (s)'],
  ['rescues', 'Rescues'],
  ['bounces', 'Owner bounces'],
];

function StageForm({ stage, graph, issues, onRename, onPatch, onPatchCaps, onSetKind, onAddEdge, onRemoveEdge, onAddAsk, onRemoveAsk, onHopCap, onRemove }: StageFormProps) {
  const s = stage;
  const senders = graph.edges.filter(e => e[1] === s.id).map(e => e[0]);
  const accepts = graph.edges.filter(e => e[0] === s.id).map(e => e[1]);
  const asks = graph.asks.filter(a => a[0] === s.id).map(a => a[1]);
  const others = graph.stages.filter(x => x.id !== s.id);

  return (
    <div>
      <div className="pwf-eyebrow">Stage</div>

      {issues.length > 0 && (
        <ul className="pwf-issues">{issues.map(r => <li key={r}>{r}</li>)}</ul>
      )}

      <label className="pwf-field">
        <span>Stage name</span>
        <input className="pwf-mono" defaultValue={s.id} onBlur={e => onRename(s.id, e.target.value)} />
      </label>

      <label className="pwf-field">
        <span>Kind</span>
        <select value={s.kind} onChange={e => onSetKind(s.id, e.target.value as Stage['kind'])}>
          <option value="agent">agent</option>
          <option value="human">human</option>
        </select>
      </label>

      <label className="pwf-field">
        <span>Agent</span>
        <select value={s.role} onChange={e => onPatch(s.id, { role: e.target.value })}>
          {[...AGENT_ROLES, 'you', '—'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>

      {/* A human gate has no model and no retry budget. Do not offer to retry a person. */}
      {s.kind === 'agent' && (
        <label className="pwf-field">
          <span>Model</span>
          <select value={s.model ?? ''} onChange={e => onPatch(s.id, { model: e.target.value })}>
            {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      )}

      <hr />
      <div className="pwf-eyebrow">Accept route → on success</div>
      <div className="pwf-chips">
        {accepts.length === 0
          ? <span className="pwf-xs2 pwf-muted">none — terminal stage</span>
          : accepts.map(t => (
            <span key={t} className="pwf-chip acc">→ {t}
              <button type="button" aria-label={`Remove accept route to ${t}`} onClick={() => onRemoveEdge(t)}>×</button>
            </span>
          ))}
      </div>
      {accepts.length === 0 && (
        <select className="pwf-mini" value="" onChange={e => e.target.value && onAddEdge(s.id, e.target.value)}>
          <option value="">+ add accept target…</option>
          {others.map(x => <option key={x.id} value={x.id}>{x.id}</option>)}
        </select>
      )}

      <hr />
      <div className="pwf-eyebrow">Reject route ↩ return to sender</div>
      <select className="pwf-mini" value={s.reject ?? ''} onChange={e => onPatch(s.id, { reject: e.target.value || undefined })}>
        <option value="">↩ sender{senders.length ? ` (${senders.join(', ')})` : ''}</option>
        {/* Only real senders. Anything else would let a task skip a stage by rejecting. */}
        {senders.map(x => <option key={x} value={x}>{x}</option>)}
      </select>
      <p className="pwf-xs2 pwf-muted">One hop, not a routing edge. Every reject counts toward the hop cap, in any direction.</p>

      {s.kind === 'agent' && (
        <>
          <hr />
          <div className="pwf-eyebrow">Ask / consult</div>
          <div className="pwf-chips">
            {asks.length === 0
              ? <span className="pwf-xs2 pwf-muted">none</span>
              : asks.map(t => (
                <span key={t} className="pwf-chip ask">? {t}
                  <button type="button" aria-label={`Remove consult to ${t}`} onClick={() => onRemoveAsk(t)}>×</button>
                </span>
              ))}
          </div>
          <select className="pwf-mini" value="" onChange={e => e.target.value && onAddAsk(e.target.value)}>
            <option value="">+ ask another agent…</option>
            {others.filter(x => x.kind !== 'human' && !asks.includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.id}</option>)}
          </select>
        </>
      )}

      {s.kind === 'agent' && s.caps && (
        <>
          <hr />
          <div className="pwf-eyebrow">Retries &amp; caps</div>
          <div className="pwf-row2">
            {CAP_FIELDS.map(([key, label]) => (
              <label key={key} className="pwf-field">
                <span>{label}</span>
                <input
                  type="number"
                  min={0}
                  value={s.caps![key]}
                  onChange={e => onPatchCaps(s.id, key, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
        </>
      )}

      <hr />
      {/* Global, not per-stage: one reject anywhere is one hop. */}
      <label className="pwf-field">
        <span>Global hop cap <span className="pwf-xs2 pwf-muted">— applies to the whole workflow</span></span>
        <input type="number" min={1} value={graph.hopCap} onChange={e => onHopCap(Number(e.target.value))} />
      </label>

      <hr />
      <button type="button" className="pwf-btn-danger" onClick={onRemove}>Remove stage</button>
    </div>
  );
}
