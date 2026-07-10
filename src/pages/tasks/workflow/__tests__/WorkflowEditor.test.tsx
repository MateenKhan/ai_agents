// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import WorkflowEditor from '../WorkflowEditor';
import { defaultWorkflow } from '../../../../../agentic/workflow/defaultWorkflow';
import { DEFAULT_CAPS } from '../workflowApi';

afterEach(cleanup);

// The original component injected a <script> whose top-level `const STAGES` landed in the
// GLOBAL lexical environment. Unmounting could not un-declare it, so the second mount threw
// `Identifier 'STAGES' has already been declared`. React StrictMode mounts → unmounts →
// mounts in dev, so it died on first load. These four tests pin the fix.
describe('mounting', () => {
  it('survives StrictMode double-invoke', () => {
    expect(() => render(<StrictMode><WorkflowEditor /></StrictMode>)).not.toThrow();
    expect(screen.getByLabelText('Workflow graph')).toBeTruthy();
  });

  it('survives unmount and remount', () => {
    const first = render(<WorkflowEditor />);
    first.unmount();
    expect(() => render(<WorkflowEditor />)).not.toThrow();
  });

  it('two editors can coexist without clobbering each other', () => {
    render(<><WorkflowEditor /><WorkflowEditor /></>);
    expect(screen.getAllByLabelText('Workflow graph')).toHaveLength(2);
  });

  it('claims no global ids the host app could collide with', () => {
    render(<WorkflowEditor />);
    for (const id of ['canvas', 'world', 'nodes', 'edges', 'inspector', 'saveBtn', 'validator', 'popover', 'scrim', 'sheet']) {
      expect(document.getElementById(id)).toBeNull();
    }
  });
});

describe('seeding', () => {
  it('renders every stage of the shipped pipeline', () => {
    render(<WorkflowEditor />);
    for (const id of ['intake', 'plan', 'build', 'qa', 'accept', 'review', 'merge', 'merged']) {
      expect(screen.getByLabelText(new RegExp(`^Stage ${id},`))).toBeTruthy();
    }
  });

  it('the doc prop is reactive — it does not read a seed once and then ignore it', () => {
    const d = defaultWorkflow();
    const { rerender } = render(<WorkflowEditor doc={d} />);
    expect(screen.queryByLabelText(/^Stage extra,/)).toBeNull();

    const d2 = structuredClone(d);
    d2.stages.push({ id: 'extra', behaviour: 'generic', agentRef: 'dev', model: 'sonnet', caps: { ...DEFAULT_CAPS }, asks: [], outcomes: [], ui: { x: 0, y: 0 } });
    rerender(<WorkflowEditor doc={d2} />);
    expect(screen.getByLabelText(/^Stage extra,/)).toBeTruthy();
  });

  it('does not fire onChange for the initial render', () => {
    const onChange = vi.fn();
    render(<WorkflowEditor onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the validator gates Save', () => {
  it('Save is enabled for the shipped pipeline', () => {
    render(<WorkflowEditor />);
    expect(screen.getByRole('button', { name: 'Save workflow' })).not.toHaveProperty('disabled', true);
    expect(screen.getByText(/Workflow valid/)).toBeTruthy();
  });

  it('Save is disabled, and never calls onSave, when a stage would strand tasks', () => {
    const onSave = vi.fn();
    const d = defaultWorkflow();
    d.stages.find(s => s.id === 'qa')!.outcomes = [];   // qa now leads nowhere
    render(<WorkflowEditor doc={d} onSave={onSave} />);

    const save = screen.getByRole('button', { name: 'Save workflow' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/Save blocked/)).toBeTruthy();

    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('names the offending stages as buttons that focus them', () => {
    const d = defaultWorkflow();
    d.stages.find(s => s.id === 'qa')!.outcomes = [];
    render(<WorkflowEditor doc={d} />);
    expect(screen.getByRole('button', { name: 'qa ↗' })).toBeTruthy();
  });

  it('Save hands the caller the document, not a downloaded file', () => {
    const onSave = vi.fn();
    render(<WorkflowEditor onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save workflow' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].stages.length).toBe(8);
  });
});

describe('passive stages have no model and no retries', () => {
  it('the review card shows its behaviour, not a model', () => {
    render(<WorkflowEditor />);
    const review = screen.getByLabelText(/^Stage review, human/);
    expect(review.textContent).not.toContain('sonnet');
    expect(review.textContent).toContain('human-gate');
  });

  it('the inspector hides Model and the caps grid for a passive stage', () => {
    render(<WorkflowEditor />);
    fireEvent.pointerDown(screen.getByLabelText(/^Stage review, human/));
    expect(screen.queryByText('Model')).toBeNull();
    expect(screen.queryByText('Max attempts')).toBeNull();
  });

  it('switching an agent behaviour to human-gate strips its model and caps', () => {
    const onChange = vi.fn();
    render(<WorkflowEditor onChange={onChange} />);
    fireEvent.pointerDown(screen.getByLabelText(/^Stage build, dev/));
    fireEvent.change(screen.getByLabelText(/Behaviour/), { target: { value: 'human-gate' } });

    const d = onChange.mock.calls.at(-1)![0];
    const build = d.stages.find((s: { id: string }) => s.id === 'build');
    expect(build.model).toBeNull();
    expect(build.caps).toBeNull();
    expect(build.agentRef).toBeNull();
  });
});

// The mock rendered a caps editor whose inputs were bound to nothing: `value="3"` with no
// handler. Nothing could round-trip. This is the fix.
describe('caps are real numbers that round-trip', () => {
  it('editing max attempts updates the document', () => {
    const onChange = vi.fn();
    render(<WorkflowEditor onChange={onChange} />);
    fireEvent.pointerDown(screen.getByLabelText(/^Stage build, dev/));

    fireEvent.change(screen.getByLabelText('Max attempts'), { target: { value: '7' } });

    const d = onChange.mock.calls.at(-1)![0];
    expect(d.stages.find((s: { id: string }) => s.id === 'build').caps.attempts).toBe(7);
  });

  it('the hop cap lives on the document, not on a stage', () => {
    const onChange = vi.fn();
    render(<WorkflowEditor onChange={onChange} />);
    fireEvent.pointerDown(screen.getByLabelText(/^Stage build, dev/));

    fireEvent.change(screen.getByLabelText(/Global hop cap/), { target: { value: '4' } });
    const d = onChange.mock.calls.at(-1)![0];
    expect(d.hopCap).toBe(4);
    expect(d.stages.every((s: { caps?: Record<string, unknown> | null }) => !s.caps || !('hopCap' in s.caps))).toBe(true);
  });
});

describe('editing outcomes', () => {
  it('editing an outcome word updates the document', () => {
    const onChange = vi.fn();
    render(<WorkflowEditor onChange={onChange} />);
    fireEvent.pointerDown(screen.getByLabelText(/^Stage build, dev/));

    // build's first outcome is `done → qa`.
    const whenInput = screen.getByDisplayValue('done');
    fireEvent.change(whenInput, { target: { value: 'shipped' } });

    const d = onChange.mock.calls.at(-1)![0];
    const build = d.stages.find((s: { id: string }) => s.id === 'build');
    expect(build.outcomes[0].when).toBe('shipped');
  });

  it('removing an outcome that strands a stage blocks Save', () => {
    render(<WorkflowEditor />);
    fireEvent.pointerDown(screen.getByLabelText(/^Stage qa, /));

    // qa reaches the terminal only through its outcomes. Remove them all.
    for (const btn of screen.queryAllByRole('button', { name: /Remove outcome/ })) {
      fireEvent.click(btn);
    }
    expect((screen.getByRole('button', { name: 'Save workflow' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Save blocked/)).toBeTruthy();
  });
});

describe('renaming a stage rewrites every reference to it', () => {
  it('outcomes that pointed to the old id now point to the new one', () => {
    const onChange = vi.fn();
    render(<WorkflowEditor onChange={onChange} />);
    fireEvent.pointerDown(screen.getByLabelText(/^Stage qa, /));

    // Rename qa → checks. build (done→qa) and others route to qa.
    fireEvent.blur(screen.getByLabelText('Stage name'), { target: { value: 'checks' } });

    const d = onChange.mock.calls.at(-1)![0];
    const build = d.stages.find((s: { id: string }) => s.id === 'build');
    expect(build.outcomes.some((o: { to: string }) => o.to === 'checks')).toBe(true);
    expect(build.outcomes.some((o: { to: string }) => o.to === 'qa')).toBe(false);
    expect(d.stages.some((s: { id: string }) => s.id === 'checks')).toBe(true);
  });
});

describe('reject targets offered in the inspector', () => {
  it('only offers stages that actually hand work to this one', () => {
    render(<WorkflowEditor />);
    fireEvent.pointerDown(screen.getByLabelText(/^Stage build, dev/));

    // The reject <select> is the one whose first option is the return-to-sender default.
    const rejectSelect = Array.from(document.querySelectorAll('select'))
      .find(sel => sel.querySelector('option')?.textContent?.startsWith('↩'));
    const options = Array.from(rejectSelect!.querySelectorAll('option')).map(o => o.textContent);
    // `plan → build` exists, so plan is offerable. `merged` never hands to build.
    expect(options).toContain('plan');
    expect(options).not.toContain('merged');
  });
});

// "View only" must actually be view-only. A popup that quietly lets you drag a stage, or shows
// a Save button, is worse than not having one.
describe('readOnly', () => {
  const run = { taskId: 'T-1', hops: 2, stages: { qa: { state: 'running' as const } } };

  it('hides Save, Add stage and the inspector', () => {
    render(<WorkflowEditor readOnly run={run} />);
    expect(screen.queryByRole('button', { name: 'Save workflow' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add stage' })).toBeNull();
    expect(document.querySelector('.pwf-inspector')).toBeNull();
  });

  it('hides the validator bar — a viewer cannot fix the graph', () => {
    render(<WorkflowEditor readOnly run={run} />);
    expect(screen.queryByText(/Workflow valid/)).toBeNull();
    expect(screen.queryByText(/Save blocked/)).toBeNull();
  });

  it('renders no drag ports', () => {
    render(<WorkflowEditor readOnly run={run} />);
    expect(document.querySelectorAll('.pwf-port')).toHaveLength(0);
  });

  it('never mutates the graph — clicking a node emits no change', () => {
    const onChange = vi.fn();
    render(<WorkflowEditor readOnly run={run} onChange={onChange} />);
    fireEvent.pointerDown(screen.getByLabelText(/^Stage build, dev/));
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Stage build, dev/)).toBeTruthy();  // still there
  });

  it('opens straight into run mode when a run is supplied', () => {
    render(<WorkflowEditor readOnly run={run} />);
    expect(screen.getByText('T-1')).toBeTruthy();   // the run bar
  });

  // Without a `run`, readOnly stays in EDIT mode — so these cases are the only ones that
  // actually exercise the readOnly guards.
  describe('readOnly without a run — edit mode, but locked', () => {
    it('still hides Save, Add stage, the inspector and the ports', () => {
      render(<WorkflowEditor readOnly />);
      expect(screen.queryByRole('button', { name: 'Save workflow' })).toBeNull();
      expect(screen.queryByRole('button', { name: '+ Add stage' })).toBeNull();
      expect(document.querySelector('.pwf-inspector')).toBeNull();
      expect(document.querySelectorAll('.pwf-port')).toHaveLength(0);
    });

    it('Delete does not remove a stage', () => {
      const onChange = vi.fn();
      render(<WorkflowEditor readOnly onChange={onChange} />);
      fireEvent.pointerDown(screen.getByLabelText(/^Stage build, dev/));
      fireEvent.keyDown(window, { key: 'Delete' });
      expect(screen.getByLabelText(/^Stage build, dev/)).toBeTruthy();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('dragging a node does not move it', () => {
      const onChange = vi.fn();
      render(<WorkflowEditor readOnly onChange={onChange} />);
      const node = screen.getByLabelText(/^Stage build, dev/);
      const before = (node as HTMLElement).style.left;
      fireEvent.pointerDown(node, { clientX: 10, clientY: 10 });
      fireEvent.pointerMove(document.querySelector('.pwf-canvas')!, { clientX: 200, clientY: 120 });
      fireEvent.pointerUp(document.querySelector('.pwf-canvas')!);
      expect((node as HTMLElement).style.left).toBe(before);
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});

describe('run mode', () => {
  it('is only offered when a run snapshot is supplied', () => {
    render(<WorkflowEditor />);
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });

  it('shows the hop counter against the graph cap', () => {
    render(<WorkflowEditor run={{ taskId: 'T-1', hops: 3, stages: { qa: { state: 'running' } } }} />);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Run' })); });
    expect(screen.getByText('T-1')).toBeTruthy();
    expect(screen.getByText(/hops/).textContent).toContain('3');
    expect(screen.getByText(/hops/).textContent).toContain('10');
  });
});
