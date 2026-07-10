// ─────────────────────────────────────────────────────────────────────────────
// WorkflowEditor — a real React component, now drawing the ENGINE's document.
//
// The data model IS `WorkflowDoc` from agentic/workflow (imported via workflowApi). There is no
// browser copy of the schema: the graph you draw here is the graph the orchestrator runs.
//
//   • A node is a `Stage`. Its powers come from `behaviour`, never from its id.
//   • An edge is an `Outcome`: the stage routes to `outcome.to`, and the wire is labelled with
//     `outcome.when` — the word the agent reports. A stage may have several (branching).
//   • Reject is return-to-sender (one hop), drawn as an overlay. Asks are a permission list of
//     other agent stages this one may consult, drawn as a second overlay.
//
// Everything below is refs + state; two instances can coexist and mounting twice is a no-op.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { Behaviour, Corner, Outcome, Side, Stage, StageCaps, WorkflowDoc } from './workflowApi';
import { BEHAVIOURS, DEFAULT_CAPS, isAgentBehaviour, validateWorkflow } from './workflowApi';
import { defaultWorkflow } from '../../../../agentic/workflow/defaultWorkflow';
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
  /** Seed document, normally from the server. Reactive: changing it reloads the canvas. */
  doc?: WorkflowDoc;
  /** Fired on every edit. Debounced by the caller if it wants to autosave. */
  onChange?: (doc: WorkflowDoc) => void;
  /** Fired when Save is pressed. Only ever called with a document that passes validation. */
  onSave?: (doc: WorkflowDoc) => void | Promise<void>;
  /** Present ⇒ Run mode is offered. Absent ⇒ edit only. */
  run?: RunSnapshot;
  /** Stage ids a live task is standing on. Shown as locked; the caller enforces the rule. */
  occupied?: string[];
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
  | { kind: 'outcome'; stageId: string; index: number }
  | { kind: 'reject'; stageId: string }
  | null;

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];
/** Node height is uniform; measuring every card per frame was the mock's real cost. */
const NODE_H = 92;
/** UI convenience list. `model` is a free string in the schema, so this only seeds the picker. */
const MODELS = ['opus', 'sonnet', 'haiku'] as const;

const RUN_BADGE: Record<RunState, string> = {
  pending: 'pending',
  running: '▶ running',
  done: '✓ succeeded',
  rejected: '↩ rejected',
  timeout: '⏱ timed out',
};

/** The layout coords for a stage, tolerant of a document whose stages carry no `ui`. */
function posOf(s: Stage): { x: number; y: number } {
  return { x: s.ui?.x ?? 0, y: s.ui?.y ?? 0 };
}

const isPassive = (b: Behaviour) => !isAgentBehaviour(b);

export default function WorkflowEditor({ doc: docProp, onChange, onSave, run, occupied = [], readOnly = false, className, style }: WorkflowEditorProps) {
  const [doc, setDoc] = useState<WorkflowDoc>(() => docProp ?? defaultWorkflow());
  const [mode, setMode] = useState<Mode>(readOnly && run ? 'run' : 'edit');
  const [sel, setSel] = useState<Selection>({ kind: 'stage', id: 'build' });
  const [showRejects, setShowRejects] = useState(false);
  const [showAsks, setShowAsks] = useState(false);
  const [view, setView] = useState({ px: 40, py: 36, s: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeSeq = useRef(1);
  const occupiedSet = useMemo(() => new Set(occupied), [occupied]);

  // Reactive seed. The mock read its seed once, off a global, and then let localStorage win.
  useEffect(() => { if (docProp) setDoc(docProp); }, [docProp]);

  // onChange must not fire during render, and must not fire for the initial state.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    onChange?.(doc);
  }, [doc, onChange]);

  const validation = useMemo(() => validateWorkflow(doc), [doc]);
  const offenders = useMemo(() => new Set(validation.stageIssues.map(i => i.stageId)), [validation]);
  const terminalId = useMemo(() => doc.stages.find(s => s.behaviour === 'terminal')?.id, [doc.stages]);

  const byId = useCallback((id: string) => doc.stages.find(s => s.id === id), [doc.stages]);
  const boxOf = useCallback((id: string): Box | null => {
    const s = byId(id);
    return s ? { ...posOf(s), h: NODE_H } : null;
  }, [byId]);

  const mutate = useCallback((fn: (d: WorkflowDoc) => WorkflowDoc) => setDoc(d => fn(structuredClone(d))), []);

  // ── stage editing ──────────────────────────────────────────────────────────
  const patchStage = useCallback((id: string, patch: Partial<Stage>) => {
    mutate(d => {
      const s = d.stages.find(x => x.id === id);
      if (s) Object.assign(s, patch);
      return d;
    });
  }, [mutate]);

  const moveStage = useCallback((id: string, x: number, y: number) => {
    mutate(d => {
      const s = d.stages.find(x => x.id === id);
      if (s) s.ui = { ...(s.ui ?? {}), x, y };
      return d;
    });
  }, [mutate]);

  const patchCaps = useCallback((id: string, key: keyof StageCaps, value: number) => {
    mutate(d => {
      const s = d.stages.find(x => x.id === id);
      if (s?.caps) s.caps[key] = value;
      return d;
    });
  }, [mutate]);

  /** Switching behaviour must add or strip the agent, model and caps a passive stage has none of. */
  const setBehaviour = useCallback((id: string, behaviour: Behaviour) => {
    mutate(d => {
      const s = d.stages.find(x => x.id === id);
      if (!s) return d;
      s.behaviour = behaviour;
      if (isPassive(behaviour)) {
        // You do not retry a person, and a terminal is the end.
        s.agentRef = null;
        s.model = null;
        s.caps = null;
        delete s.worktree;
        if (behaviour === 'terminal') s.outcomes = [];
      } else {
        s.agentRef = s.agentRef ?? 'dev';
        s.model = s.model ?? 'sonnet';
        s.caps = s.caps ?? { ...DEFAULT_CAPS };
      }
      return d;
    });
  }, [mutate]);

  const renameStage = useCallback((oldId: string, raw: string) => {
    const newId = raw.trim();
    if (!newId || newId === oldId) return;
    if (doc.stages.some(s => s.id === newId)) return; // validator would flag it; refuse quietly
    mutate(d => {
      for (const s of d.stages) {
        if (s.id === oldId) s.id = newId;
        for (const o of s.outcomes ?? []) if (o.to === oldId) o.to = newId;
        if (s.reject === oldId) s.reject = newId;
        if (Array.isArray(s.asks)) s.asks = s.asks.map(a => (a === oldId ? newId : a));
      }
      if (d.entry === oldId) d.entry = newId;
      return d;
    });
    setSel({ kind: 'stage', id: newId });
  }, [doc.stages, mutate]);

  const addStage = useCallback(() => {
    const id = `stage-${nodeSeq.current++}`;
    mutate(d => {
      d.stages.push({
        id, behaviour: 'generic', agentRef: 'dev', model: 'sonnet', caps: { ...DEFAULT_CAPS },
        asks: [], outcomes: [],
        ui: { x: (-view.px + 320) / view.s, y: (-view.py + 140) / view.s },
      });
      return d;
    });
    setSel({ kind: 'stage', id }); // arrives disconnected; the validator lights it up
  }, [mutate, view]);

  const removeStage = useCallback((id: string) => {
    mutate(d => {
      d.stages = d.stages.filter(s => s.id !== id);
      for (const s of d.stages) {
        s.outcomes = (s.outcomes ?? []).filter(o => o.to !== id);
        if (s.reject === id) s.reject = null;
        if (Array.isArray(s.asks)) s.asks = s.asks.filter(a => a !== id);
      }
      return d;
    });
    setSel(null);
  }, [mutate]);

  const addOutcome = useCallback((from: string, to: string, side?: Side) => {
    mutate(d => {
      const s = d.stages.find(x => x.id === from);
      if (!s || from === to) return d;
      s.outcomes = s.outcomes ?? [];
      if (s.outcomes.some(o => o.to === to)) return d; // a duplicate destination adds no route
      // A fresh outcome needs a word; the validator flags a blank one, so seed a unique default.
      const base = 'out';
      let when = base;
      let n = 1;
      while (s.outcomes.some(o => o.when === when)) when = `${base}-${++n}`;
      s.outcomes.push({ when, to, side });
      return d;
    });
  }, [mutate]);

  const patchOutcome = useCallback((stageId: string, index: number, patch: Partial<Outcome>) => {
    mutate(d => {
      const s = d.stages.find(x => x.id === stageId);
      const o = s?.outcomes?.[index];
      if (o) Object.assign(o, patch);
      return d;
    });
  }, [mutate]);

  const removeOutcome = useCallback((stageId: string, index: number) => {
    mutate(d => {
      const s = d.stages.find(x => x.id === stageId);
      if (s?.outcomes) s.outcomes.splice(index, 1);
      return d;
    });
  }, [mutate]);

  const addAsk = useCallback((from: string, to: string) => {
    mutate(d => {
      const s = d.stages.find(x => x.id === from);
      if (!s || from === to) return d;
      s.asks = s.asks ?? [];
      if (!s.asks.includes(to)) s.asks.push(to);
      return d;
    });
    setShowAsks(true);
  }, [mutate]);

  const removeAsk = useCallback((from: string, to: string) => {
    mutate(d => {
      const s = d.stages.find(x => x.id === from);
      if (s?.asks) s.asks = s.asks.filter(a => a !== to);
      return d;
    });
  }, [mutate]);

  const deleteSelection = useCallback(() => {
    if (!sel) return;
    if (sel.kind === 'outcome') { removeOutcome(sel.stageId, sel.index); setSel(null); }
    else if (sel.kind === 'reject') { patchStage(sel.stageId, { reject: null }); setSel(null); }
    else if (sel.kind === 'stage') removeStage(sel.id);
  }, [sel, removeOutcome, patchStage, removeStage]);

  const arrange = useCallback(() => {
    mutate(d => {
      const edges = d.stages.flatMap(s => (s.outcomes ?? []).map(o => [s.id, o.to] as [string, string]));
      const pos = autoLayout(d.stages.map(s => s.id), edges, d.entry);
      for (const s of d.stages) s.ui = { ...(s.ui ?? {}), ...pos[s.id] };
      return d;
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
    const p = posOf(s);
    setSel({ kind: 'stage', id });
    setDrag({ kind: 'node', id, ox: p.x, oy: p.y, sx: e.clientX, sy: e.clientY });
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
      moveStage(drag.id, (drag.ox ?? 0) + dx, (drag.oy ?? 0) + dy);
      return;
    }
    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const targetId = under?.closest<HTMLElement>('.pwf-node')?.dataset.id;
    setDrag(d => (d ? { ...d, tip: toWorld(e.clientX, e.clientY), dropTarget: targetId && targetId !== d.from ? targetId : undefined } : d));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const { kind, from, fromSide, dropTarget } = drag;
    if (from && dropTarget && (kind === 'edge' || kind === 'reject' || kind === 'ask')) {
      const w = toWorld(e.clientX, e.clientY);
      const tb = boxOf(dropTarget);
      if (tb) {
        if (kind === 'ask') addAsk(from, dropTarget);
        else if (kind === 'edge') addOutcome(from, dropTarget, fromSide);
        else {
          patchStage(from, { reject: dropTarget });
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
    if (!el || !doc.stages.length) return;
    const pts = doc.stages.map(posOf);
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs) + NODE_W;
    const minY = Math.min(...ys); const maxY = Math.max(...ys) + NODE_H;
    const pad = 60;
    const s = clamp(Math.min(el.clientWidth / (maxX - minX + pad * 2), el.clientHeight / (maxY - minY + pad * 2)), 0.4, 1.2);
    setView({
      s,
      px: (el.clientWidth - (maxX - minX) * s) / 2 - (minX - pad / 2) * s,
      py: (el.clientHeight - (maxY - minY) * s) / 2 - (minY - pad / 2) * s,
    });
  }, [doc.stages]);

  // Frame the graph once, as soon as the canvas actually has a size. On first paint inside a
  // flex parent its clientWidth is still 0, so fitView would divide by zero and clamp to the
  // minimum zoom. Refit only until it succeeds; after that the viewport belongs to the user.
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

  const askPath = (from: string, to: string, fc?: Corner) => {
    const a = boxOf(from); const b = boxOf(to);
    if (!a || !b) return null;
    const p1 = cornerAnchor(a, fc ?? 'tr');
    const p2 = backOff(cornerAnchor(b, 'tl'), 10);
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

  const handleSave = () => { if (validation.ok) void onSave?.(doc); };

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

      {/* The control that stops a document stranding tasks. Save is disabled until it is green.
          Hidden when read-only: a viewer cannot fix the graph, so the bar would only be noise. */}
      {!readOnly && (
      <div className={`pwf-validator ${validation.ok ? 'ok' : 'bad'}`} aria-live="polite">
        {validation.ok ? (
          <><span className="pwf-okmark">✓</span><span>Workflow valid — every stage reachable, and <code>{terminalId}</code> reachable from <code>{doc.entry}</code>.</span></>
        ) : (
          <>
            <span className="pwf-badmark">!</span>
            <span>Save blocked — {validation.stageIssues.length || validation.docErrors.length} problem{(validation.stageIssues.length || validation.docErrors.length) > 1 ? 's' : ''} would strand tasks.</span>
            {validation.stageIssues.map(i => (
              <button key={i.stageId} type="button" className="pwf-offender" title={i.reasons.join(' · ')} onClick={() => setSel({ kind: 'stage', id: i.stageId })}>
                {i.stageId} ↗
              </button>
            ))}
            {validation.docErrors.map(e => <span key={e} className="pwf-xs2">{e}</span>)}
          </>
        )}
      </div>
      )}

      {run && mode === 'run' && (
        <div className="pwf-runbar">
          <span className="pwf-eyebrow">Task</span>
          <span className="pwf-mono">{run.taskId}</span>
          <span className="pwf-hops">hops <b>{run.hops}</b> / {doc.hopCap}</span>
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

              {/* Every outcome is one wire: this stage → outcome.to, labelled with the word the
                  agent reports. A stage may have several. */}
              {doc.stages.flatMap(s => (s.outcomes ?? []).map((o, i) => {
                const g = edgePath(s.id, o.to, o.side, undefined, 'acc');
                if (!g) return null;
                const isSel = sel?.kind === 'outcome' && sel.stageId === s.id && sel.index === i;
                const flow = mode === 'run' && run ? edgeState(run, s.id, o.to) : 'idle';
                return (
                  <g key={`e${s.id}-${i}`} className={`pwf-route pwf-eg ${flow}${isSel ? ' sel' : ''}`} onPointerDown={ev => { ev.stopPropagation(); if (!readOnly) setSel({ kind: 'outcome', stageId: s.id, index: i }); }}>
                    <path className="pwf-hit" d={g.d} />
                    <path className="pwf-wire" d={g.d} markerEnd="url(#pwf-ah)" />
                    {mode === 'edit' && <text className="pwf-elabel" x={g.mid.x} y={g.mid.y} textAnchor="middle">{o.when}</text>}
                  </g>
                );
              }))}

              {mode === 'edit' && showRejects && doc.stages.map(s => {
                // Draw an explicit reject target, or the implicit return-to-sender (any stage
                // whose outcome routes here).
                const sender = doc.stages.find(x => (x.outcomes ?? []).some(o => o.to === s.id))?.id;
                const target = s.reject ?? sender;
                if (!target || target === s.id) return null;
                const g = edgePath(s.id, target, s.ui?.rejectSide, undefined, 'rej');
                if (!g) return null;
                const isSel = sel?.kind === 'reject' && sel.stageId === s.id;
                return (
                  <g key={`r${s.id}`} className={`pwf-route pwf-rej${isSel ? ' sel' : ''}`} onPointerDown={ev => { ev.stopPropagation(); setSel({ kind: 'reject', stageId: s.id }); }}>
                    <path className="pwf-hit" d={g.d} />
                    <path className="pwf-wire" d={g.d} markerEnd="url(#pwf-ahr)" />
                  </g>
                );
              })}

              {mode === 'edit' && showAsks && doc.stages.flatMap(s => (s.asks ?? []).map((to, i) => {
                const g = askPath(s.id, to, s.ui?.askCorner);
                if (!g) return null;
                return (
                  <g key={`a${s.id}-${i}`} className="pwf-route pwf-ask">
                    <path className="pwf-hit" d={g.d} />
                    <path className="pwf-wire" d={g.d} markerEnd="url(#pwf-aha)" />
                  </g>
                );
              }))}

              {rubberBand() && <path className={`pwf-tmp pwf-tmp-${drag?.kind}`} d={rubberBand()!} />}
            </svg>

            {doc.stages.map(s => {
              const rs = run?.stages[s.id]?.state;
              const agent = isAgentBehaviour(s.behaviour);
              const p = posOf(s);
              return (
                <div
                  key={s.id}
                  className="pwf-node"
                  data-id={s.id}
                  data-human={!agent}
                  data-selected={sel?.kind === 'stage' && sel.id === s.id}
                  data-offender={offenders.has(s.id)}
                  data-occupied={occupiedSet.has(s.id) || undefined}
                  data-drop={drag?.dropTarget === s.id ? drag.kind : undefined}
                  data-run={mode === 'run' ? rs : undefined}
                  style={{ left: p.x, top: p.y }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Stage ${s.id}, ${agent ? s.agentRef ?? 'agent' : s.behaviour}`}
                  onPointerDown={e => onPointerDownNode(e, s.id)}
                >
                  {mode === 'edit' && !readOnly && SIDES.map(side => (
                    <span key={`p${side}`}>
                      <span className={`pwf-port acc s-${side}`} title="drag: outcome route" onPointerDown={e => onPointerDownPort(e, s.id, 'edge', side)} />
                      <span className={`pwf-port rej s-${side}`} title="drag: reject route" onPointerDown={e => onPointerDownPort(e, s.id, 'reject', side)} />
                    </span>
                  ))}
                  {mode === 'edit' && !readOnly && agent && CORNERS.map(c => (
                    <span key={`c${c}`} className={`pwf-port ask c-${c}`} title="drag: consult another agent" onPointerDown={e => onPointerDownPort(e, s.id, 'ask', undefined, c)} />
                  ))}

                  {mode === 'run' && rs === 'running' && <span className="pwf-pulse" aria-hidden="true" />}
                  {mode === 'run' && rs && <span className="pwf-runbadge">{RUN_BADGE[rs]}</span>}
                  <div className="pwf-node-head">
                    <span className={`pwf-role ${agent ? 'agent' : 'human'}`}>{agent ? s.agentRef ?? 'agent' : s.behaviour}</span>
                  </div>
                  <h3 className="pwf-mono">{s.id}</h3>
                  {/* A passive stage has no model and no retries. Nothing to show. */}
                  {agent && <div className="pwf-micro pwf-muted">{s.model}</div>}
                  <div className="pwf-meta">
                    {agent && s.caps
                      ? <span className="pwf-chip">attempts {s.caps.attempts}</span>
                      : <span className="pwf-chip">{s.behaviour}</span>}
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
              <p className="pwf-empty">Select a stage to edit its behaviour, agent, outcomes and caps.<br /><br />Every stage must stay on a path from <code>{doc.entry}</code> to <code>{terminalId ?? '—'}</code>.</p>
            ) : (
              <StageForm
                key={selectedStage.id}
                stage={selectedStage}
                doc={doc}
                issues={validation.stageIssues.find(i => i.stageId === selectedStage.id)?.reasons ?? []}
                onRename={renameStage}
                onPatch={patchStage}
                onPatchCaps={patchCaps}
                onSetBehaviour={setBehaviour}
                onAddOutcome={(to) => addOutcome(selectedStage.id, to)}
                onPatchOutcome={(index, patch) => patchOutcome(selectedStage.id, index, patch)}
                onRemoveOutcome={(index) => removeOutcome(selectedStage.id, index)}
                onAddAsk={(to) => addAsk(selectedStage.id, to)}
                onRemoveAsk={(to) => removeAsk(selectedStage.id, to)}
                onHopCap={(n) => mutate(d => { d.hopCap = n; return d; })}
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
  doc: WorkflowDoc;
  issues: string[];
  onRename: (oldId: string, newId: string) => void;
  onPatch: (id: string, patch: Partial<Stage>) => void;
  onPatchCaps: (id: string, key: keyof StageCaps, value: number) => void;
  onSetBehaviour: (id: string, behaviour: Behaviour) => void;
  onAddOutcome: (to: string) => void;
  onPatchOutcome: (index: number, patch: Partial<Outcome>) => void;
  onRemoveOutcome: (index: number) => void;
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
  ['conflicts', 'Merge conflicts'],
];

function StageForm({ stage, doc, issues, onRename, onPatch, onPatchCaps, onSetBehaviour, onAddOutcome, onPatchOutcome, onRemoveOutcome, onAddAsk, onRemoveAsk, onHopCap, onRemove }: StageFormProps) {
  const s = stage;
  const agent = isAgentBehaviour(s.behaviour);
  const outcomes = s.outcomes ?? [];
  const asks = s.asks ?? [];
  const senders = doc.stages.filter(x => (x.outcomes ?? []).some(o => o.to === s.id)).map(x => x.id);
  const others = doc.stages.filter(x => x.id !== s.id);
  const outcomeTargets = others.filter(x => !outcomes.some(o => o.to === x.id));

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
        <span>Behaviour <span className="pwf-xs2 pwf-muted">— decides the stage's powers, not its name</span></span>
        <select value={s.behaviour} onChange={e => onSetBehaviour(s.id, e.target.value as Behaviour)}>
          {BEHAVIOURS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>

      {/* A passive stage (human-gate, terminal) runs no agent: no role, no model, no retries. */}
      {agent && (
        <>
          <label className="pwf-field">
            <span>Agent</span>
            <input value={s.agentRef ?? ''} onChange={e => onPatch(s.id, { agentRef: e.target.value })} placeholder="role in the agents table" />
          </label>

          <label className="pwf-field">
            <span>Model</span>
            <select value={s.model ?? ''} onChange={e => onPatch(s.id, { model: e.target.value })}>
              {[...MODELS, ...(s.model && !MODELS.includes(s.model as typeof MODELS[number]) ? [s.model] : [])].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </>
      )}

      <hr />
      <div className="pwf-eyebrow">Outcomes — the words this stage may report</div>
      {s.behaviour === 'terminal' ? (
        <p className="pwf-xs2 pwf-muted">A terminal stage is the end. It routes nowhere.</p>
      ) : (
        <>
          {outcomes.length === 0 && <p className="pwf-xs2 pwf-muted">none — work stops here until you add one</p>}
          {outcomes.map((o, i) => (
            <div key={i} className="pwf-outcome">
              <div className="pwf-row2">
                <label className="pwf-field">
                  <span>when</span>
                  <input className="pwf-mono" value={o.when} onChange={e => onPatchOutcome(i, { when: e.target.value })} />
                </label>
                <label className="pwf-field">
                  <span>→ to</span>
                  <select value={o.to} onChange={e => onPatchOutcome(i, { to: e.target.value })}>
                    <option value="">— pick —</option>
                    {others.map(x => <option key={x.id} value={x.id}>{x.id}</option>)}
                  </select>
                </label>
              </div>
              <label className="pwf-field">
                <span>hint <span className="pwf-xs2 pwf-muted">— shown in the agent's prompt</span></span>
                <input value={o.hint ?? ''} onChange={e => onPatchOutcome(i, { hint: e.target.value || undefined })} />
              </label>
              <button type="button" className="pwf-btn-sm" aria-label={`Remove outcome ${o.when}`} onClick={() => onRemoveOutcome(i)}>Remove outcome</button>
              <hr />
            </div>
          ))}
          {outcomeTargets.length > 0 && (
            <select className="pwf-mini" value="" onChange={e => e.target.value && onAddOutcome(e.target.value)}>
              <option value="">+ add outcome to…</option>
              {outcomeTargets.map(x => <option key={x.id} value={x.id}>{x.id}</option>)}
            </select>
          )}
        </>
      )}

      <hr />
      <div className="pwf-eyebrow">Reject route ↩ return to sender</div>
      <select className="pwf-mini" value={s.reject ?? ''} onChange={e => onPatch(s.id, { reject: e.target.value || null })}>
        <option value="">↩ sender{senders.length ? ` (${senders.join(', ')})` : ''}</option>
        {/* Only real senders. Anything else would let a task skip a stage by rejecting. */}
        {senders.map(x => <option key={x} value={x}>{x}</option>)}
      </select>
      <p className="pwf-xs2 pwf-muted">One hop, not a routing edge. Every reject counts toward the hop cap, in any direction.</p>

      {agent && (
        <>
          <hr />
          <div className="pwf-eyebrow">Ask / consult <span className="pwf-xs2 pwf-muted">— agents this stage may consult mid-run</span></div>
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
            {others.filter(x => isAgentBehaviour(x.behaviour) && !asks.includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.id}</option>)}
          </select>
        </>
      )}

      {agent && s.caps && (
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
        <input type="number" min={1} value={doc.hopCap} onChange={e => onHopCap(Number(e.target.value))} />
      </label>

      <hr />
      <button type="button" className="pwf-btn-danger" onClick={onRemove}>Remove stage</button>
    </div>
  );
}
