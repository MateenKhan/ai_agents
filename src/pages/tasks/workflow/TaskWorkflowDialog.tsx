import { useMemo } from 'react';
import { Modal } from '../components/Modal';
import WorkflowEditor from './WorkflowEditor';
import { loadGraph } from './graphStore';
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
 * simpler diagram here would let the two drift, and the one users check when something has
 * gone wrong is this one.
 */
export default function TaskWorkflowDialog({ isOpen, onClose, task }: Props) {
  // Read the graph when the dialog opens, not on every render of the board behind it.
  const graph = useMemo(() => (isOpen ? loadGraph() : null), [isOpen]);
  const run = useMemo(() => (graph ? runSnapshotForTask(graph, task) : null), [graph, task]);

  if (!isOpen || !graph || !run) return null;

  const order = stageOrder(graph);
  const current = order.find(id => run.stages[id]?.state === 'running');
  const unknownStage = task.stage && !order.includes(task.stage);

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
        {/* A stage the graph does not contain means the agent invented one, or the graph was
            edited under a running task. Say so — silently showing "nothing running" is how a
            stranded task stays invisible. */}
        {unknownStage && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-2xs font-bold text-amber-800">
            This task is at stage <code className="font-mono">{task.stage}</code>, which is not in the workflow.
            It cannot be routed until that is fixed.
          </p>
        )}

        <p className="text-2xs text-slate-500">
          {current
            ? <>Currently running <code className="font-mono font-bold text-slate-700">{current}</code>.</>
            : task.status === 'DONE'
              ? <>Complete — every stage succeeded.</>
              : <>Nothing is running. The task is parked at <code className="font-mono font-bold text-slate-700">{task.stage ?? 'no stage'}</code>.</>}
          {' '}Read-only: edit the pipeline from the Agents tab.
        </p>

        <div className="h-[60vh] min-h-[320px] overflow-hidden rounded-xl border border-slate-200">
          <WorkflowEditor graph={graph} run={run} readOnly />
        </div>
      </div>
    </Modal>
  );
}
