// The workflow document: its shape, its rules, its storage, and the built-in pipeline.
//
// The browser imports `types`, `validate` and `defaultWorkflow` from here so that the editor
// and the db-server run the identical validator. `store` reaches the database, so the browser
// never imports it.

export type {
  Behaviour, Outcome, Side, Corner, Stage, StageCaps, WorkflowDoc, WorktreeMode,
} from './types';
export {
  BEHAVIOURS, AGENT_BEHAVIOURS, PASSIVE_BEHAVIOURS, RESERVED_OUTCOMES, DEFAULT_CAPS,
  WORKTREE_FOR_BEHAVIOUR, isAgentBehaviour, indexStages, terminalStage,
} from './types';

// Routing — pure. What runs next, what an outcome means, where a reject returns to.
export type { Placement, OutcomeDecision, RejectDecision, RejectInput } from './route';
export {
  placeTask, entryStage, stageById, routeOutcome, allowedOutcomes, routeReject, nearestHumanGate,
  mayWriteVerdict, reconcileVerdict, takesMergeLock, ownsBranch, isHumanGate, worktreeFor, modelFor, capsFor,
} from './route';

export type { StageIssue, ValidationResult } from './validate';
export { validateWorkflow, occupiedStageConflicts } from './validate';

export { defaultWorkflow } from './defaultWorkflow';

// Database-backed. Node only.
export type { LoadedWorkflow, SaveResult } from './store';
export { loadWorkflow, saveWorkflow, resetWorkflow, occupiedStages, occupiedStagesFor, workflowKey } from './store';
