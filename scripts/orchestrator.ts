// ─────────────────────────────────────────────────────────────────────────────
// Headless orchestrator entry point.
// The brain now lives in agentic-core; this file just builds the config, attaches
// the owned memory (and, later, graphify / MinIO adapters), and starts the engine.
// Run via: npx tsx --watch scripts/orchestrator.ts
// ─────────────────────────────────────────────────────────────────────────────

import { startOrchestrator, buildConfig, setConfig, createOwnedMemory, superpowersMethodology } from '../agentic/index.ts';

const config = buildConfig(process.cwd());

// Shared episodic memory — the owned default (claude-mem/vector store can replace it).
config.memory = createOwnedMemory();

// Methodology — inject the superpowers skill preamble ahead of every role's prompt.
// Requires obra/superpowers installed in the agent runtime (~/.claude) to auto-load;
// this seam is what tells each role WHICH skills to lead with. Swap for any skill system.
config.methodology = superpowersMethodology;

// Attach when available (both optional — the engine tolerates their absence):
//   config.codeIndex = makeGraphifyIndex();   // or a db:search adapter
//   config.docStore  = makeMinioStore();

setConfig(config);
startOrchestrator(config);
