// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — type contract
//
// This file is the architecture written as code. It is deliberately dependency-
// free so the whole `agentic/` folder can be lifted into its own npm package.
// The runtime OWNS these types; the adopt/borrow layers plug in through the
// seam interfaces at the bottom (CodeIndex, DocStore, Methodology, ControlSurface).
// ─────────────────────────────────────────────────────────────────────────────

/** Board columns a task moves through (human-facing kanban state). */
export type TaskStatus = 'AVAILABLE' | 'WORKING' | 'TESTING' | 'DONE';

/**
 * A stage id. FREE TEXT, on purpose.
 *
 * Stages are defined by the project's workflow document, so a stage may be called `qa` or
 * `tapora`. The engine never reads the name for meaning: every special power (may set a QA
 * verdict, takes the git merge lock, parks for a human) comes from the stage's `behaviour`.
 * See agentic/workflow/types.ts.
 *
 * This used to be a union of the seven built-in names, which is why renaming a stage would
 * silently have disabled the merge lock.
 */
export type Stage = string;

/** An agent's role — a row in the `agents` table. Also free text: users add custom agents. */
export type AgentRole = string;

/** Git isolation for a role's run. plan = detached read-only; create = owns task/<id>;
 *  reuse = attaches to the dev's existing worktree; none = runs in the main repo. */
export type WorktreeMode = 'plan' | 'create' | 'reuse' | 'none';

/** QA outcome — gates whether work advances to merge or bounces back to build. */
export type QaVerdict = 'pass' | 'fail' | null;

/** How a headless agent run ended — feeds the circuit breaker + retry policy.
 *  'limit' = the user's Claude plan usage window is exhausted: not this task's fault and not
 *  a transient outage — every agent would fail identically, so the swarm pauses until reset. */
export type FailureKind = 'network' | 'timeout' | 'stall' | 'crash' | 'limit' | 'none';

/** A single testable acceptance scenario (Gherkin GIVEN/WHEN/THEN).
 *  Replaces the old free-text "Definition of Done" — every task is a set of these. */
export interface Scenario {
  given?: string;
  when?: string;
  then: string;
}

/** The unit of work. Durable in tasks.db; verbose run logs live in logs.db. */
export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus | string;
  priority: number;

  /** Testable acceptance criteria. A task will not dispatch without at least one. */
  scenarios?: Scenario[];
  /** Current pipeline stage. Absent/empty means "start at plan". */
  stage?: Stage | null;
  /** Latest QA result for this task. */
  qaVerdict?: QaVerdict;

  claimedBy?: string | null;
  started?: string | null;
  completed?: string | null;
  dependsOn?: string[];
  files?: string[];
  parentId?: string | null;

  /** MinIO object keys for documents attached as agent context. */
  docs?: string[];

  /** Human reviewer feedback from a rejected review — injected into the retry prompt. */
  reviewNote?: string | null;
  /** The user's ORIGINAL words, captured at creation and never rewritten by an agent.
   *  `description` gets absorbed into the architect's plan; this does not. It is the only
   *  thing "expectations not met" can be judged against. */
  intent?: string | null;
  /** The business owner's feedback when it bounces work back. Kept separate from
   *  `reviewNote` so a human rejection can't silently overwrite the owner's comments —
   *  and so dev/architect can tell whose objection they are reading. */
  ownerNote?: string | null;
  /** How many times the business owner has bounced this task. Capped: on exhaustion the
   *  task goes to the human WITH the notes, never to BLOCKED. */
  ownerBounces?: number;
  /** The word the agent last reported — `pass`, `blocked`, `done`. `stage` says where the task
   *  IS; this says what put it there. Keeping both leaves the evidence on the row. */
  lastOutcome?: string | null;
  /** The stage that routed this task here. Set by the control plane, never by an agent: a
   *  reject returns to the sender, so an agent that could set this could choose where its
   *  own reject lands. */
  handoffFrom?: string | null;
  /** Rejects used, in any direction. At the workflow's hopCap the task goes to a human. */
  hops?: number;
  /** ISO timestamp — while WORKING, the watchdog reclaims the task if this expires. */
  leaseExpiresAt?: string | null;
  /** Absolute path to THIS task's own append-only log file (`<logsDir>/<projectId>/<id>.log`).
   *  Persisted rather than recomputed so the file is still findable after a UI reload or a
   *  db-server crash, and after the agent slot that wrote it has been reused by another task. */
  logPath?: string | null;
  /** How many times this task has been dispatched to an agent. */
  attempts?: number;
  /** ISO timestamp — do not re-dispatch before this (exponential backoff). */
  nextRetryAt?: string | null;
  /** Last failure classification/message, for diagnosis in the UI. */
  lastError?: string | null;
  /** Model used for the last dispatch (analytics). */
  model?: string | null;
  /** Agent-written reviewer summary: what changed + how to verify (required before TESTING). */
  summary?: string | null;
  /** Estimated minutes to complete the current stage, set by the working agent (capped at 30). */
  etcMinutes?: number | null;
  /** ISO timestamp when etcMinutes was last set — the card counts down from here. */
  etcSetAt?: string | null;
  /** Actual agent time per role (role → total ms), accumulated across runs. */
  stageTimings?: Record<string, number> | null;
  /** Which project this task belongs to. NULL/absent is treated as 'default'. */
  projectId?: string | null;
  /** How many times a merge attempt hit conflicts and bounced the task back to the dev
   *  to rebase onto the base branch. Capped so a permanently-conflicting task dead-letters
   *  instead of looping build→qa→merge forever. */
  mergeBounces?: number;
  /** How many times a dev/qa stage exhausted its retries and was escalated to the ARCHITECT
   *  for a re-plan (rescue). Capped so a task that keeps failing even after re-planning
   *  dead-letters to BLOCKED instead of looping rescue→build→rescue forever. */
  rescueCount?: number;
  /** Per-task lifecycle control flag set by the server (a separate process) and enforced
   *  by the orchestrator: null/absent = run normally; 'paused' = hold from dispatch;
   *  'stop' = kill any live agent now and stay out of dispatch until resumed. */
  control?: string | null;
  /** Accumulated US dollar cost for all runs on this task. */
  costUsd?: number;

  // ── consult (agent-to-agent question, mid-task) ──────────────────────────────
  /** Audit trail of every completed consult on this task. Written by the control plane
   *  (the orchestrator) after an advisor answers; agents may never write it directly. */
  consultLog?: ConsultEntry[];
  /** The consult an asking agent requested before it exited, awaiting an advisor run. Set
   *  from the `{"consult":{…}}` PUT verb; cleared once the answer is folded into consultLog. */
  pendingConsult?: PendingConsult | null;
  /** Transient slot a read-only advisor writes its reply into. The orchestrator reads it back,
   *  appends it to consultLog, and clears it before re-dispatching the asking stage. */
  consultAnswer?: string | null;
  /** Distilled reason the LAST run failed: the failure kind plus the tail of the run's output.
   *  Set on every failure, cleared on a successful advance. Injected into the next attempt's
   *  prompt so a retry sees WHY the previous one failed instead of repeating it blind. */
  failureDetail?: string | null;
  /** The architect's PLAN, split from `summary` so the dev's own summary cannot overwrite it.
   *  A plan-behaviour stage's summary is copied here on advance; the dev reads `{{plan}}`. */
  plan?: string | null;
  /** Append-only history of what each stage did — pass, reject (with reason), failure. Feeds
   *  both the next agent's prompt (the trail it inherits) and the human reviewer. Capped. */
  journal?: JournalEntry[];
}

/** One line in a task's stage journal: what a stage did and when. */
export interface JournalEntry {
  ts: string;       // ISO timestamp
  stage: string;    // the stage id that acted
  agent: string;    // the role that ran it
  outcome: string;  // 'pass' | 'reject' | 'blocked' | 'fail:<kind>' | 'conflict' …
  note?: string;    // short context: the reject reason, the failure note, a summary headline
}

/** One completed consult: who asked (their stage), whom they asked, the question and the
 *  answer the advisor returned. */
export interface ConsultEntry {
  /** The stage the asking agent was at — also how per-stage consult caps are counted. */
  from: string;
  /** The consulted target: an entry from the asking stage's `asks` list. */
  to: string;
  question: string;
  answer: string;
  at: string;
}

/** A consult an agent has requested but not yet had answered. */
export interface PendingConsult {
  /** An entry from the asking stage's `asks` list (a stage id whose agent advises). */
  to: string;
  question: string;
}

/** Editable per-role configuration, seeded from defaults and stored in the agents table. */
export interface AgentConfig {
  role: AgentRole;
  label: string;
  enabled: boolean;
  /** Model tier, e.g. 'opus' | 'sonnet' | 'haiku' or a full model string. */
  model: string;
  worktreeMode: WorktreeMode;
  /** Display order in the workflow strip. */
  ord: number;
  /** System roles cannot be deleted from the UI. */
  isSystem: boolean;
  /** Prompt template with {{placeholders}} rendered by the orchestrator. */
  promptTemplate: string;
  /** Architect-only: the template used for the merge stage. */
  mergePromptTemplate?: string;
  /** Architect-only: the template used for the rescue stage — re-planning a task whose
   *  dev/qa stage exhausted its retries. */
  rescuePromptTemplate?: string;
  /** Owner-only: the template used for the accept stage. The base `promptTemplate` is the
   *  intake gate (intent → scenarios); this one judges finished work against that intent. */
  acceptPromptTemplate?: string;
}

/** Result handed to the orchestrator when a headless agent process exits. */
export interface RunResult {
  code: number | null;
  durationMs: number;
  failure: FailureKind;
  outputTail: string;
  /** Only meaningful when failure === 'limit': the ISO time the plan's usage window resets,
   *  parsed from the CLI's message. Null when the message carried no epoch — the orchestrator
   *  then falls back to a default pause. */
  resetAt?: string | null;
  /** US dollar cost accumulated during this run. */
  costUsd?: number;
}

/** One structured action parsed from an agent's stream-json output (for the Logs UI). */
export interface AgentAction {
  at: string;
  kind: 'search' | 'read' | 'edit' | 'write' | 'command' | 'commit' | 'message' | 'result';
  detail: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEAMS — the adopt/borrow layers plug in here. The runtime depends only on
// these interfaces, never on graphify/MinIO/superpowers directly, so any of
// them can be swapped or removed without touching the engine.
// ─────────────────────────────────────────────────────────────────────────────

/** Code-intelligence layer. Back it with graphify, your db:search index, or both. */
export interface CodeIndex {
  /** Locate symbols/files for a query. Cheap, indexed retrieval. */
  search(query: string, taskId?: string): Promise<Array<{ file: string; snippet?: string; score?: number }>>;
  /** BLAST RADIUS — impact analysis over the code graph. Given a symbol/file about
   *  to change, what depends on it: direct callers, transitive dependents, and the
   *  tests that cover them, plus a risk rating. The PLAN stage uses this to scope the
   *  change and lock the right files; the QA stage uses it to know exactly what to
   *  re-test. This is a query over the call/dependency graph, not episodic memory. */
  impact(target: { symbol?: string; file?: string }): Promise<{
    callers: string[];      // functions/files that call or import the target directly
    dependents: string[];   // files affected transitively downstream
    tests: string[];        // tests covering the target or its dependents
    risk: 'low' | 'medium' | 'high';
  }>;
  /** Rebuild/refresh the index (e.g. after a merge). Fire-and-forget allowed. */
  refresh?(onProgress?: (msg: string) => void): void;
  /** Files known to be stale vs the index — the agent reads these directly. */
  staleFiles?(files: string[]): string[];
}

/** Document store for task context. Back it with MinIO (S3-compatible) or local disk. */
export interface DocStore {
  put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  /** A path or short text the agent prompt can reference for this doc. */
  describeForPrompt(key: string): Promise<string>;
}

/** Methodology layer. Points agents at an installed skill system (e.g. superpowers). */
export interface Methodology {
  /** Prompt preamble instructing the agent which skills to use for this role.
   *  Accepts a plain string so CUSTOM roles (not just architect/dev/qa) resolve too. */
  preambleFor(role: AgentRole | string): string;
  /** Custom tools to inject into the agent's context, as JSON schemas. */
  toolsFor?(role: AgentRole | string): Record<string, any>[];
}

/** Control/reach layer (borrowed from hermes): chat notifications + scheduling. */
export interface ControlSurface {
  notify(event: 'review-ready' | 'blocked' | 'merged' | 'down', task?: Task): Promise<void>;
}

/** Shared, persistent EPISODIC memory across agents and sessions — what was tried,
 *  decided, and learned. First-class in v1: the runtime ships a simple file/DB-backed
 *  default so agents stop repeating work and survive compaction. claude-mem or a
 *  vector store can back it instead, without the engine knowing. (Structural "where
 *  is the code" memory lives in CodeIndex — this is the "what have we learned" half.) */
export interface Memory {
  /** Record a durable learning from a task. */
  remember(entry: { taskId?: string; role?: AgentRole; kind: 'learning' | 'decision' | 'gotcha'; text: string }): Promise<void>;
  /** Retrieve memories relevant to a query, most useful first. */
  recall(query: string, limit?: number): Promise<Array<{ text: string; taskId?: string; at: string; score?: number }>>;
  /** Compact, prompt-ready block of the most relevant memories to inject at task start. */
  primeFor(task: Task): Promise<string>;
}

/** Everything injectable — paths, toggles, model tiers, and the seams above.
 *  Constructing this in the app and passing it to startOrchestrator() is the ONLY
 *  coupling between the runtime and its host. */
export interface AgenticConfig {
  paths: {
    tasksDbPath: string;
    logsDbPath: string;
    worktreesDir: string;
    logsDir: string;
  };
  /** Role → model string, overrides AgentConfig.model when set. */
  models?: Partial<Record<AgentRole, string>>;
  toggles?: {
    /** Gates the periodic architect triage pass. It no longer affects ROUTING: a stage leaves
     *  the pipeline by being deleted from the workflow document, not by a switch. */
    enableArchitect?: boolean;
    /** @deprecated Routing is graph-driven; this no longer skips the verify stage. */
    enableQa?: boolean;
    /** Merge automatically when QA passes (before human review) vs on human approval. */
    autoMergeOnQaPass?: boolean;
    maxAttempts?: number;
    taskLeaseMs?: number;
    agentStallMs?: number;
    /** Hard wall-clock cap on one agent run. Read by the orchestrator, but it was never
     *  declared here — `agentic/` is not covered by the root tsconfig, so nothing caught it. */
    maxTaskRunMs?: number;
  };
  codeIndex?: CodeIndex;
  docStore?: DocStore;
  methodology?: Methodology;
  control?: ControlSurface;
  /** Shared episodic memory — first-class in v1 (owned default; claude-mem/vector store pluggable). */
  memory?: Memory;
  /** QA browser verification — first-class in v1. The QA agent drives a real browser
   *  against `testUrl` and vision-checks screenshots for visual scenarios. Tool decided,
   *  not deferred: Playwright by default; browser-use / chrome-mcp are drop-in alternatives. */
  qa?: {
    testUrl?: string;
    browserTool?: 'playwright' | 'browser-use' | 'chrome-mcp';
  };
  /** Project sanity checks. The DEV must pass all of these locally before handoff
   *  (a failing build never advances); QA re-runs them independently before the
   *  browser pass. Project-specific, so they live in config — the package runs in
   *  many repos with different commands. Empty command = skip that check. */
  checks?: {
    typecheck?: string;   // e.g. 'pnpm exec tsc --noEmit'
    build?: string;       // e.g. 'pnpm run build'
    test?: string;        // e.g. 'pnpm test'
    lint?: string;
  };
}

/**
 * Tool schema for triggering Activepieces workflows.
 * Injected by the methodology layer when an agent needs integration capabilities.
 */
export const TRIGGER_ACTIVEPIECES_WEBHOOK_SCHEMA = {
  name: 'trigger_activepieces_webhook',
  description: 'Trigger an Activepieces webhook to run a remote workflow.',
  parameters: {
    type: 'object',
    properties: {
      webhookUrl: {
        type: 'string',
        description: 'The full URL of the Activepieces webhook to call.'
      },
      payload: {
        type: 'object',
        description: 'JSON payload to send to the workflow.'
      }
    },
    required: ['webhookUrl', 'payload']
  }
};