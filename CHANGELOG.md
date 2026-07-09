# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Context memory now reconciles against disk truth: files deleted/renamed by a merge are
  dropped from agents' working context automatically, plus a manual **Sweep** reconcile.
- Shared `listRepoFiles` helper so the file explorer and context reconcile see the same disk set.
- Contributor scaffolding: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, `ROADMAP.md`.

## [0.1.0]

### Added
- Kanban board driving `claude` CLI agents through **plan → build → qa → merge**.
- Human-review gate before any merge; orchestrator as single merge writer.
- Per-agent git worktree isolation; project-scoped repos, tokens, and boards.
- Per-project code-embedding index with semantic `/search` and auto-heal.
- Chat intake (`/intake`) — decompose a natural-language message into tasks.
- Resilience: circuit breaker, watchdog (stall + runtime cap), lease reclaim, restart-resume.
- Context memory (LRU cache + user pins) with token budget and op log.

[Unreleased]: https://github.com/airtajal/ai-agents/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/airtajal/ai-agents/releases/tag/v0.1.0
