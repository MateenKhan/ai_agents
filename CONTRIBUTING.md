# Contributing to AI-Agents

Thanks for helping out. This project is early — good ideas and small PRs move it fast.

## TL;DR

```bash
pnpm install
pnpm run agents      # frontend + db-server + orchestrator
pnpm test            # vitest — run before you push
npx tsc --noEmit     # type-check — must be clean
```

Open **http://localhost:6951**. You need **Node ≥ 22** (built-in `node:sqlite`), **pnpm**, and the `claude` CLI on your PATH.

## Where things live

| Area | Path | What |
| :-- | :-- | :-- |
| Runtime engine | [`agentic/`](./agentic/) | Stage routing, orchestrator, resource gate, memory, context — dependency-free (`node:*` only) |
| API + git control | [`db/server.ts`](./db/server.ts) | Raw-http SQLite API (:6952) |
| Frontend | [`src/`](./src/) | Vite + React Kanban board (:6951) |

Read the code comments — most files open with a header block explaining the *why*.

## Good first issues

Look for the [`good first issue`](https://github.com/airtajal/ai-agents/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) label. Don't see one you like? Open an issue proposing what you want to do before writing a big change.

## Making a change

1. **Fork + branch** off `main` (`feat/…`, `fix/…`, `docs/…`).
2. **Keep it focused** — one concern per PR. Small PRs get merged; giant ones stall.
3. **Match the surrounding style** — comment density, naming, and idiom. No new dependencies without discussion (the core is deliberately `node:*`-only).
4. **Add/adjust tests** — logic changes need a vitest test. Mirror the style in [`agentic/db/__tests__/`](./agentic/db/__tests__/).
5. **Green gate before pushing:** `pnpm test` passes **and** `npx tsc --noEmit` is clean.
6. **Open a PR** using the template. Describe *what* and *why*, link the issue, add a screenshot/GIF for any UI change.

## Commit / PR conventions

- Present-tense, imperative subject: `fix: reconcile context against disk on merge`.
- Reference issues: `Closes #12`.
- UI changes: attach a before/after screenshot or GIF.

## Reporting bugs / ideas

Use the issue templates (Bug report / Feature request). For anything security-related, **do not** open a public issue — follow [SECURITY.md](./SECURITY.md).

By contributing you agree your work is licensed under the project's [MIT License](./LICENSE) and that you'll follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
