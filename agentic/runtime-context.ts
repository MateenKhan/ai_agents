// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — runtime context
// Holds the active AgenticConfig so any module (db, engine) can read paths and
// seams without threading config through every call. The host sets it once at
// startup; if unset, it lazily defaults to buildConfig().
// ─────────────────────────────────────────────────────────────────────────────

import type { AgenticConfig } from './types';
import { buildConfig } from './config';

let active: AgenticConfig | null = null;

/** Inject paths + seams once, at startup. */
export function setConfig(config: AgenticConfig): void {
  active = config;
}

/** Read the active config; defaults to buildConfig() if the host never set one. */
export function getConfig(): AgenticConfig {
  if (!active) active = buildConfig();
  return active;
}
