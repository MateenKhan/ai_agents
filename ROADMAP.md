# Roadmap

Living document — order is intent, not a promise. Ideas and PRs welcome (see [CONTRIBUTING.md](./CONTRIBUTING.md)).

## Now (v0.1.x)

- [x] Plan → build → qa → merge pipeline with human-review merge gate
- [x] Per-agent git worktree isolation + orchestrator as single merge writer
- [x] Resilience: circuit breaker, watchdog, lease reclaim, restart-resume
- [x] Per-project code-embedding index + semantic `/search`
- [x] Context memory (LRU + pins) with disk reconcile on merge
- [ ] **Demo GIF + docs site** — the biggest adoption unlock
- [ ] **One-command run** — Docker Compose / devcontainer so first-run is 30s, not a setup chapter
- [ ] `good first issue` backlog for new contributors

## Next

- [ ] **Gated agent learning** — after each task, roles distill one reusable lesson into a `pending` queue; you approve/reject; approved lessons prime future agents (human-in-the-loop, no silent drift)
- [ ] **Cost meter** — live `$/task` and token spend per stage, budget alerts
- [ ] **Outcome analytics** — hours/$ saved, tasks shipped/week, % merged with no human fix

## Later

- [ ] **Model-agnostic adapter** — pluggable providers (OpenAI / Gemini / local Ollama) behind the runner seam, selectable per role. Removes the current Anthropic-only limitation
- [ ] **Team mode** — multi-user auth, shared boards, seat roles (moves beyond single-user/local)
- [ ] **Optional hosted control plane** — session-/seat-based hosting on a VPS for people who don't want to self-host. Core stays MIT; hosting is convenience, never a paywall on the engine

## Non-goals

- Replacing the model provider's own CLI/IDE — we orchestrate agents and gate merges, we don't rebuild the coding agent itself.
- Adding runtime dependencies to `agentic/` — the core stays `node:*`-only.
