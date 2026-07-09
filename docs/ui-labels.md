# UI labels — audit & suggestions

Every user-visible string in the app, judged against the Piranha voice: *short, punchy, a little
dangerous. Never corporate.* See [`assets/brand.md`](./assets/brand.md).

**Nothing here has been applied.** This is a proposal list, ranked by impact.

## Rules used

1. Buttons say exactly what happens ("Publish", not "Submit"). Verb-first.
2. Name things by what a person recognises, not how the system is built.
3. Empty states teach the next action — never just "No items".
4. Errors explain what broke *and* how to fix it. No apologies, no vagueness.
5. Toasts confirm in the same words as the action ("Approve" → "Approved").
6. Specific beats clever. Predator flavour belongs in empty states, headings, and idle lines —
   **never** in destructive confirmations or error messages.
7. One concept, one name, everywhere.

---

## 1. `PromptModal.tsx` — wrong, not just bland

**This modal describes a different product.** It tells users to paste the prompt "into the
Antigravity chat (Ctrl+L)" and watch "the Terminal Monitor tab at the bottom". Neither exists —
Piranha launches agents autonomously, and the terminal monitor is a floating window. Stale
pre-rebrand copy on the highest-traffic action path. Fix this first.

| Line | Current | Suggested |
| :-- | :-- | :-- |
| 19 | `Agent Command Ready` | `Prompt ready` |
| 34–36 | `Copy this prompt into the Antigravity chat (Ctrl+L) to begin execution. The agent will automatically update the task status when finished.` | `Copy this into your agent chat to kick it off. It updates the task status itself when it's done.` |
| 62–64 | `PRO TIP: You can monitor agent progress in real-time via the Terminal Monitor tab at the bottom.` | `Watch it live in the Terminal Monitor window that just opened.` |
| 28 | `I've pasted the prompt, let's go!` | `Done` |

## 2. Wrong product name on the first screen anyone sees

| File · line | Current | Suggested | Why |
| :-- | :-- | :-- | :-- |
| `TasksPage.tsx:253` | `Initializing AI-Agents...` | `Waking the swarm…` | The old product name, on the boot screen. |
| `ProjectBar.tsx:320` | `Task Orchestrator` (subtitle under "Piranha") | `Throw a task in. Watch the swarm.` | The one branded header surfaces an internal term instead of the tagline. |

## 3. The machinery is leaking

Users are reading your service names and internal mechanisms.

| File · line | Current | Suggested |
| :-- | :-- | :-- |
| `SystemStatus.tsx:116` | `db-server offline` | `Can't reach Piranha's server` |
| `SystemStatus.tsx:128–130` | `The task board file looks damaged — a repair may be needed.` | `The task board file is corrupted. Run Heal, or restart the server, to rebuild it.` |
| `statusMessages.ts:24–25` | `The task runner is offline.` / `…is up and running.` | `The swarm is offline.` / `The swarm is running.` |
| `TasksPage.tsx:508` | `Orchestrator set to STARTED — reset tasks re-dispatch within a few seconds.` | `Swarm restarted — the tasks it reset pick back up in a few seconds.` |
| `TasksPage.tsx:379` | `Retry Sync` | `Try again` |
| `TasksPage.tsx:354` | tooltip `Chat → Tasks` | `Describe work, get tasks` |
| `TasksPage.tsx:349` | tooltip `Heal — reset stuck in-progress tasks` | `Unstick — restart stalled tasks` |
| `LogsTab.tsx:90` | `No agent log files yet — they appear in .agent_logs/ when headless agents run.` | `No agent logs yet. They show up here once an agent starts working.` |
| `TaskModal.tsx:210` | `Advanced Metadata` | `Advanced` (or `Dependencies & files`) |
| `TerminalMonitor.tsx:107` | `Buffers: Syncing` | `Streaming live` — or cut it. It means nothing. |
| `SettingsModal.tsx:46` | `…configure board swimlanes` | `…edit board lanes` |

## 4. Two real correctness problems

| File · line | Current | Suggested | Why |
| :-- | :-- | :-- | :-- |
| `DbTab.tsx:288` | delete-confirm button `SURE?` | `Delete?` | A destructive confirmation must be a clear verb, not shouty ambiguity. |
| `TaskModal.tsx:111` | **Title** field placeholder `Task summary...` | `e.g. Add a dark-mode toggle to Settings` | The field is "Title"; "summary" is a *different* concept the agent produces. |
| `TaskModal.tsx:94` | button `Save Task` in new-task mode | `Create task` | The dialog says "Create New Task"; the button should use the same verb. |

## 5. Voice slots being wasted

Empty states cost nothing and land hardest.

| File · line | Current | Suggested |
| :-- | :-- | :-- |
| `TaskBoard.tsx:187` | `No tasks here` | `Empty lane. Drop a task in, or hit + to feed one.` |
| `SystemStatus.tsx:215` | `No recent orchestrator events.` | `No swarm activity yet.` |

## 6. Same action, two names

| File · line | Current | Suggested |
| :-- | :-- | :-- |
| `TaskCard.tsx:200` | tooltip `Launch Agent` | `Launch` — match the `TaskDetail` button |
| `TaskDetail.tsx:141` | `Plan · what the agent did & how to verify` | `Summary · what the agent did & how to verify` — the content is the *build* summary, and "Plan" collides with the pipeline stage |

---

## Terminology inconsistencies

| Concept | Names currently in use | Standardise on |
| :-- | :-- | :-- |
| Start work on a task | `Launch` (TaskDetail), `Launch Agent` (TaskCard), `trigger` (handlers) | **Launch** |
| The background engine | `Orchestrator`, `task runner`, `swarm` | **Swarm** user-facing; keep `orchestrator` in logs |
| Board columns | `lanes`, `columns`, `swimlanes`, `Boards` | **Lanes** |
| Product name | `Piranha`, `AI-Agents`, `Task Orchestrator` | **Piranha** |
| Recover stuck tasks | `Heal`, `Healing sweep`, `Auto-heal` | **Heal** |
| WORKING status | `In Progress` (column), `Working` (TaskCard) | pick one |
| "Testing" | the `TESTING` lane means *awaiting human review*; `TaskCard` also labels the QA stage "Testing" | disambiguate — two different things share one word |

---

## Leave these alone — they already work

- `HumanTodos` empty state + "Steps to verify" — clear, teaches, on-voice.
- `ChatIntake` phases: `Breaking it down…` → `Create tasks` — punchy, verb-first, action-matched.
- `TaskModal` definition-of-done copy — specific and instructive.
- The board's `Delete task?` → `Task deleted` pairing — action and confirmation share a word.
- **"Your Review"** — the only concept named identically in the header, tooltip, and panel.
  Use it as the model for everything above.