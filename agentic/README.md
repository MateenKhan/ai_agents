# agentic-core

An unattended, crash-proof runtime for orchestrating **headless Claude coding agents**. You write testable scenarios; it runs them through a multi-stage pipeline on a server and survives API outages, stalls, and reboots.

It owns the one layer other tools don't do well — the *runtime* — and lets best-of-breed pieces plug in through seams instead of being rebuilt.

## Layers

| Layer | What it is | How it's provided |
| :-- | :-- | :-- |
| Orchestration runtime | Durable queue, stage router (`architect -> dev -> qa -> merge`), circuit breaker, watchdog + stall detector, resource gate, auto-heal, git-worktree isolation | **Owned** (this package) |
| Agent methodology | Spec -> plan -> TDD -> spec/quality review -> finish | **Adopt** — agents auto-load [superpowers](https://github.com/obra/superpowers) via `Methodology` |
| Code intelligence | Cheap, indexed code/symbol retrieval | **Adopt** — [graphify](https://github.com/safishamsi/graphify) or a local index behind `CodeIndex` |
| Document context | Attach/store/delete task documents | **Adopt** — MinIO (S3-compatible) behind `DocStore` |
| Control & reach | Create tasks + get notified from a phone/chat | **Borrow** — a chat frontend behind `ControlSurface` |

## Seams

The runtime depends only on the interfaces in `types.ts` — never on graphify, MinIO, superpowers, or any chat app directly. Any of them can be swapped or dropped without touching the engine: `CodeIndex`, `DocStore`, `Methodology`, `ControlSurface`.

## Using it from a host app

```ts
import { buildConfig } from './agentic';
// import { startOrchestrator } from './agentic'; // added as the engine lands

const config = buildConfig(process.cwd());
config.codeIndex = myGraphifyAdapter;   // optional
config.docStore  = myMinioAdapter;      // optional
config.methodology = superpowersPreamble; // optional
// startOrchestrator(config);
```

## Extracting to its own npm package

The folder is dependency-free except `node:*` builtins. To publish:

1. Move `agentic/` to its own repo (the `package.json` here is already set up).
2. In host apps, replace `from './agentic'` with `from 'agentic-core'`.
3. Nothing else changes — the barrel `index.ts` is the only entry point.
