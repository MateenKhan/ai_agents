// Built-in statuses the orchestrator understands. Users may add custom lanes on top
// of these (parked columns the agents ignore), so a task's status is a built-in OR any string.
export type TaskStatus = 'TODO' | 'AVAILABLE' | 'WORKING' | 'BLOCKED' | 'TESTING' | 'DONE';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus | (string & {});
  priority: number; // 0: P0, 1: P1, 2: P2, 3: P3
  dependsOn?: string[]; // Array of Task IDs
  files?: string[]; // Array of file paths
  parentId?: string; // For hierarchy
  createdBy?: string;
  claimedBy?: string;
  createdAt: string;
  updatedAt: string;
  /** ISO time the task started working (set when it enters the pipeline) */
  started?: string | null;
  /** ISO time the task completed (set on DONE) */
  completed?: string | null;
  /** Definition of Done — mandatory; the orchestrator won't dispatch without it */
  dod?: string | null;
  /** Human reviewer feedback from a rejected review */
  reviewNote?: string | null;
  /** Dispatch attempt count (retry/backoff bookkeeping) */
  attempts?: number;
  /** Next allowed dispatch time (exponential backoff) */
  nextRetryAt?: string | null;
  /** Last failure classification/message */
  lastError?: string | null;
  leaseExpiresAt?: string | null;
  /** Model used for the last dispatch */
  model?: string | null;
  /** Agent-written reviewer summary: what changed + how to verify */
  summary?: string | null;
  /** Pipeline stage: plan | build | qa | review | merge | merged */
  stage?: string | null;
  /** QA verdict for the current attempt: 'pass' | 'fail' */
  qaVerdict?: string | null;
  /** Estimated minutes for the current stage (agent-set, capped at 30) */
  etcMinutes?: number | null;
  /** ISO time when etcMinutes was set — the card counts down from here */
  etcSetAt?: string | null;
  /** Actual agent time per role (role → total ms) */
  stageTimings?: Record<string, number> | null;
  /** Lifecycle control: null = running/normal, 'paused' = user-paused, 'stop' = stopping */
  control?: 'paused' | 'stop' | null;
}

/** Per-task lifecycle actions wired to POST /tasks/:id/<action> */
export type TaskControlAction = 'start' | 'pause' | 'resume' | 'stop';

export interface Column {
  id: string;
  label: string;
  color: string;
  /** True for the 6 orchestrator-managed lanes; custom user lanes are false/undefined. */
  builtin?: boolean;
}

// Full catalog of built-in lanes. The board's actual columns are configurable and
// persisted (see boardConfig.ts) — this is the default/seed set and the re-add catalog.
export const COLUMNS: Column[] = [
  { id: 'TODO',      label: 'Todo',        color: '#d946ef', builtin: true },
  { id: 'AVAILABLE', label: 'Available',   color: '#06b6d4', builtin: true },
  { id: 'WORKING',   label: 'In Progress', color: '#6366f1', builtin: true },
  { id: 'BLOCKED',   label: 'Blocked',     color: '#f43f5e', builtin: true },
  { id: 'TESTING',   label: 'Review',      color: '#f59e0b', builtin: true },
  { id: 'DONE',      label: 'Done',        color: '#10b981', builtin: true },
];
