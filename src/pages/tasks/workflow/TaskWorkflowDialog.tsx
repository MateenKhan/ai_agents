import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/Modal';
import WorkflowEditor from './WorkflowEditor';
import { loadWorkflow, type WorkflowDoc } from './workflowApi';
import { runSnapshotForTask, stageOrder, type TaskLike } from './taskRun';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  task: TaskLike & { title?: string };
}

/**
 * Read-only view of where a task sits in the workflow.
 *
 * Deliberately the SAME component as the editor, in `readOnly` mode. Rendering a second,
 * simpler diagram here would let the two drift, and the one users check when something has gone
 * wrong is this one. The document is loaded from the server — the identical graph the engine
 * runs — not a local copy.
 */
export default function TaskWorkflowDialog({ isOpen, onClose, task }: Props) {
  const [doc, setDoc] = useState<WorkflowDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the workflow when the dialog opens, not on every render of the board behind it.
  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    setDoc(null);
    setError(null);
    loadWorkflow()
      .then(r => { if (live) setDoc(r.doc); })
      .catch(e => { if (live) setError(e?.message ?? 'failed to load the workflow'); });
    return () => { live = false; };
  }, [isOpen]);

  const run = useMemo(() => (doc ? runSnapshotForTask(doc, task) : null), [doc, task]);

  if (!isOpen) return null;

  const order = doc ? stageOrder(doc) : [];
  const current = run ? order.find(id => run.stages[id]?.state === 'running') : undefined;
  const unknownStage = doc && task.stage && !order.includes(task.stage);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Workflow"
      subtitle={task.title ?? task.id}
      maxW="sm:max-w-5xl"
      featureId="task-workflow-dialog"
    >
      <div className="space-y-2">
        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-2xs font-bold text-rose-800">
            Could not load the workflow: {error}
          </p>
        )}

        {/* A stage the graph does not contain means the agent invented one, or the graph was
            edited under a running task. Say so — silently showing "nothing running" is how a
            stranded task stays invisible. */}
        {unknownStage && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-2xs font-bold text-amber-800">
            This task is at stage <code className="font-mono">{task.stage}</code>, which is not in the workflow.
            It cannot be routed until that is fixed.
          </p>
        )}

        {doc && run ? (
          <>
            <p className="text-2xs text-slate-500">
              {current
                ? <>Currently running <code className="font-mono font-bold text-slate-700">{current}</code>.</>
                : task.status === 'DONE'
                  ? <>Complete — every stage succeeded.</>
                  : <>Nothing is running. The task is parked at <code className="font-mono font-bold text-slate-700">{task.stage ?? 'no stage'}</code>.</>}
              {' '}Read-only: edit the pipeline from the Workflow tab.
            </p>

            <div className="h-[60vh] min-h-[320px] overflow-hidden rounded-xl border border-slate-200">
              <WorkflowEditor doc={doc} run={run} readOnly />
            </div>
          </>
        ) : (
          !error && <p className="text-2xs text-slate-500">Loading the workflow…</p>
        )}
      </div>
    </Modal>
  );
}
