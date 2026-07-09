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

/** Pipeline stage inside the runtime — routes which agent role runs next.
 *  `intake` and `accept` are the business owner's two gates: it turns the user's raw intent
 *  into acceptance scenarios before the architect plans, and re-checks the finished work
 *  against that intent before it reaches the human. */
export type Stage = 'intake' | 'plan' | 'build' | 'qa' | 'accept' | 'review' | 'merge' | 'merged' | 'rescue';

/** Which agent handles a stage. `merge` is done by the architect (Opus), not a separate role. */
export type AgentRole = 'owner' | 'architect' | 'dev' | 'qa';

/** Git isolation for a role's run. plan = detached read-only; create = owns task/<id>;
 *  reuse = attaches to the dev's existing worktree; none = runs in the main repo. */
export type WorktreeMode = 'plan' | 'create' | 'reuse' | 'none';

/** QA outcome — gates whether work advances to merge or bounces back to build. */
export type QaVerdict = 'pass' | 'fail' | null;

/** How a headless agent run ended — feeds the circuit breaker + retry policy. */
export type FailureKind = 'network' | 'timeout' | 'stall' | 'crash' | 'none';

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
    enableArchitect?: boolean;
    enableQa?: boolean;
    /** Business owner gates (intake + accept). On by default; turn off for pipelines where
     *  the intent is already precise (a backend refactor) and the extra opus pass is waste. */
    enableOwner?: boolean;
    /** Max times the owner may bounce one task before it goes to the human regardless. */
    maxOwnerBounces?: number;
    /** Merge automatically when QA passes (before human review) vs on human approval. */
    autoMergeOnQaPass?: boolean;
    maxAttempts?: number;
    taskLeaseMs?: number;
    agentStallMs?: number;
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
