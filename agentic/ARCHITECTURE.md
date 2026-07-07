# Agentic framework — architecture & design

The design for `agentic-core`: an unattended, crash-proof runtime that orchestrates headless Claude coding agents. You write testable scenarios; it runs them through a multi-stage pipeline on a server, survives outages and reboots, and hands you finished work to approve.

This document is the single source of truth for *what the system is*, *how work flows through it*, and *what we take (or don't) from every tool researched*.

---

## 1. Design principles

1. **Own the runtime, adopt the skills, borrow the patterns.** The one thing nobody else does well — unattended, crash-proof *coding* orchestration — we build. Best-of-breed Claude-native skills (superpowers, graphify) we install. Everything else contributes *ideas*, not code.
2. **Claude-native.** Agents are full Claude Code sessions launched headless via `claude -p`. Same auth, same skills, same tools as an interactive session — nothing reimplemented.
3. **Seams, not glue.** The engine depends only on interfaces (`CodeIndex`, `DocStore`, `Methodology`, `Memory`, `ControlSurface`, QA browser). Any external tool plugs in or out without touching the engine.
4. **Extractable.** The whole `agentic/` folder is dependency-free (only `node:*` builtins) so it can become an npm package reused across projects.

---

## 2. Layered architecture

| Layer | Responsibility | How it's provided |
| :-- | :-- | :-- |
| Control & reach | Create tasks + get notified from a phone/chat | in-app chat (v1); hermes patterns (v2) |
| Human gate & config | Kanban board, "Your Review", agents/workflow config, doc uploads | **owned** |
| **Orchestration runtime** | Durable queue, stage routing, resilience, worktree isolation | **owned — the moat** |
| Memory | Shared episodic learnings across agents/sessions | **owned** default; claude-mem/vector store pluggable |
| Agent methodology | spec → plan → TDD → review | **adopt** superpowers |
| Code intelligence | Cheap indexed code/symbol retrieval | **adopt** graphify (or `db:search`) |
| Document context | Attach/store/delete task documents | **adopt** MinIO (S3) |
| Foundation | Headless agents, per-role model tiering | Claude `claude -p` |

---

## 3. The pipeline flow (the core loop)

A task moves through **stages**; each stage routes to an agent **role** running a specific **model** in a specific **git worktree**. Every stage is primed with memory recall, the code index, and any attached docs.

```
intake → plan → build → qa → merge → review → done
                 ▲       │        (auto on QA pass)
                 └──fail─┘
         ▲                        │
         └──────changes───────────┘   (you reject in review)
```

| Stage | Role · model | Worktree | Does | Advances when |
| :-- | :-- | :-- | :-- | :-- |
| **intake** | — | — | Chat message → `claude -p` decomposes into GIVEN/WHEN/THEN scenario-tasks → created as WORKING | tasks exist |
| **plan** | architect · opus | `plan-<id>` (detached, read-only) | Reads code + memory, writes an execution plan/refined scenarios. No commits. | plan written → `build` |
| **build** | dev · sonnet | `<id>` on branch `task/<id>` | Implements to the scenarios using superpowers (TDD) + graphify + ui-ux skill. Commits. | self-check passes → `qa` |
| **qa** | qa · sonnet | reuses dev's `<id>` worktree | Runs tests; drives a real browser (Playwright + screenshot vision-checks) against the URL to verify visual scenarios | pass → `merge`; fail → `build` |
| **merge** | architect · opus | main repo | Merges `task/<id>`, resolves conflicts, runs `tsc`; deletes worktree + branch | merged → `review` (TESTING) |
| **review** | you | — | You see the diff + reviewer summary + QA evidence | approve → `done`; reject → `plan`/`build` with your notes |
| **done** | — | — | Merged, logs purged, memory updated with learnings | — |

Key decisions baked in:

- **Merge happens on QA pass, before your review** (trunk-based). By the time you look, the code is already integrated; rejection creates fix-forward work on the merged base. (Your call, implemented.)
- **The architect does the merge** (Opus) — not a separate 4th agent — because merge-conflict resolution needs the most capable model and full plan context.
- **QA reuses the dev's worktree** so it tests exactly what was built, then verifies the running app in a browser, not just the diff.

---

## 4. Data model

- **`tasks.db`** (durable, committable): tasks with `scenarios` (JSON GWT), `stage`, `qaVerdict`, `docs` (MinIO keys), attempts/lease/retry bookkeeping. No free-text "DoD".
- **`logs.db`** (gitignored, disposable): verbose per-task run history + per-agent index-usage audit. Keeps the committable DB lean.
- **Memory store**: episodic learnings (`learning` / `decision` / `gotcha`) recorded per task, recalled and injected into future task prompts.
- **`agents` table**: per-role config (model, worktree mode, prompt template, merge template) — editable from the Agents tab, seeded from defaults.

---

## 5. Resilience (why this is the moat)

Everything here is what makes it survive a VPS with no human watching:

- **Circuit breaker** — on API outage, dispatch pauses, probes `api.anthropic.com`, auto-resumes.
- **Watchdog leases** — a task whose agent dies silently is reclaimed after its lease expires.
- **Stall detector** — an agent producing no output for N minutes is killed and retried.
- **Resource gate** — never spawn past what the machine's CPU/RAM can handle.
- **Exponential backoff + dead-letter** — failing tasks retry with growing delays, then park after max attempts.
- **Auto-heal + orphan cleanup** — sweeps reclaim stuck tasks; abandoned worktrees/branches are pruned.
- **Single-writer merge** — only the orchestrator merges; agents never push. (Agents are told: never `git push`.)
- **Reconcile-on-boot** — after a crash/reboot the successor refreshes the index and resumes the queue.

---

## 6. Seams (the plug points)

| Seam | v1 backing | Swappable to |
| :-- | :-- | :-- |
| `CodeIndex` | `db:search` index | graphify |
| `DocStore` | MinIO (S3) | local disk |
| `Methodology` | superpowers preamble | any skill system |
| `Memory` | owned file/DB store | claude-mem, vector DB |
| `ControlSurface` | in-app chat notify | hermes messaging (Telegram/Slack) |
| QA browser | Playwright + screenshots | browser-use, Claude-in-Chrome |

---

## 7. What we take from every tool researched

Full detail lives in [`TOOLING.md`](./TOOLING.md). Summary:

**Adopt (in the stack):** superpowers (methodology), graphify (code index), MinIO (docs), ui-ux-pro-max skill (dev role, quality-vetted).

**Build as owned, with these as pluggable backends:** Memory seam (claude-mem behind it), QA browser (browser-use / Claude-in-Chrome behind Playwright).

**Borrow patterns, not code:** spec-kit (spec/checklist templates → sharper intake scenarios), ComfyUI (live node-graph UI → React Flow), hermes (persistent memory, cron, chat control).

**Skip (wrong layer/paradigm):** langchain (chain SDK — agents are full sessions), langflow & dify (LLM-app builders), open-webui & NextChat (redundant with in-app chat), VibeKanban (building our own board with resilience it lacks), stable-diffusion-webui (image gen), karpathy/autoresearch (ML-training toy, misread).

**Reference only:** prompts.chat, agency-agents, awesome-llm-apps.

---

## 8. Build order (nothing dropped — sequenced by dependency)

**v1 — the running loop + what your app needs to call a task "done":**
runtime (DB scenarios/stages → runner worktrees/models → stage orchestrator → wiring) · Memory seam + owned default · QA browser verification · in-app chat intake · Logs upgrade · dev-role skills (superpowers + graphify + ui-ux).

**v1.x — unblocked once v1 runs:** claude-mem/vector Memory backend · spec-kit templates in intake · ComfyUI-style node-graph workflow view.

**v2 — reach:** hermes-style external messaging + cron · open-webui optional chat workspace.

**Definition of done for v1:** type in the app chat → tasks appear → agents run them (plan → build → qa-with-browser) → land in "Your Review" with evidence → you approve → merged. On your machine.

---

## 9. Extraction to npm

`agentic/` has one entry point (`index.ts`) and no non-builtin deps. To reuse in another project: move the folder to its own repo and change host imports from `./agentic` to `agentic-core`. The seams get wired per project (different repo, index, doc bucket) via `buildConfig()` + attaching adapters.
