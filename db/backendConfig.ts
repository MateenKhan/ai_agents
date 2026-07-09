// ─────────────────────────────────────────────────────────────────────────────
// Datastore backend config — db/backend.json
// Persists the CHOSEN datastore backend and, for Postgres, its connection URL.
// The URL is a credential, so it is stored ENCRYPTED via secretbox (AES-256-GCM)
// and only decrypted in-process to open a connection. It is NEVER returned to the
// UI in plaintext — GET surfaces a masked view (password → ***).
//
// This file is the persisted CHOICE, not the live connection. db-server reads it at
// boot and pushes it into the Store layer via configureBackend(); changing it takes
// effect on restart. agentic-core never imports this — it stays standalone.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { encrypt, decrypt, isEncrypted } from '../agentic/db/secretbox.ts';

export type BackendKind = 'sqlite' | 'postgres';

/** In-memory / decrypted shape. `url` is plaintext here (postgres only). */
export interface BackendConfig {
  kind: BackendKind;
  url?: string;
}

/** Masked, safe-to-return shape. `target` never contains the password. */
export interface MaskedBackendConfig {
  kind: BackendKind;
  target: string;
}

const FILE = process.env.BACKEND_CONFIG_FILE || join(process.cwd(), 'db', 'backend.json');
const DEFAULT: BackendConfig = { kind: 'sqlite' };

/** Replace the password in a Postgres URL with ***; fall back to a redaction if unpar.seable. */
export function maskUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    // Not a parseable URL — redact anything that looks like user:pass@.
    return url.replace(/\/\/([^:/@]+):[^@]+@/, '//$1:***@');
  }
}

/** A short human target summary for the UI (host:port/db), password-free. */
function targetSummary(cfg: BackendConfig): string {
  if (cfg.kind !== 'postgres') return 'Local SQLite (db/*.db)';
  if (!cfg.url) return 'Postgres (not configured)';
  try {
    const u = new URL(cfg.url);
    const dbName = u.pathname.replace(/^\//, '') || '(default)';
    return `${u.hostname}${u.port ? ':' + u.port : ''}/${dbName}`;
  } catch {
    return maskUrl(cfg.url);
  }
}

/** Read + decrypt the persisted config. Returns the SQLite default when absent/corrupt. */
export function getBackendConfig(): BackendConfig {
  try {
    if (!existsSync(FILE)) return { ...DEFAULT };
    const raw = JSON.parse(readFileSync(FILE, 'utf-8')) as { kind?: string; url?: string };
    const kind: BackendKind = raw.kind === 'postgres' ? 'postgres' : 'sqlite';
    const url = raw.url ? (isEncrypted(raw.url) ? decrypt(raw.url) : raw.url) : undefined;
    return kind === 'postgres' ? { kind, url } : { kind: 'sqlite' };
  } catch {
    return { ...DEFAULT };
  }
}

/** Validate + persist. The `url` is encrypted at rest. Returns the masked view. */
export function setBackendConfig(input: BackendConfig): MaskedBackendConfig {
  const kind: BackendKind = input.kind === 'postgres' ? 'postgres' : 'sqlite';
  if (kind === 'postgres') {
    const url = (input.url || '').trim();
    if (!url) throw new Error('Postgres backend requires a connection url');
    if (!/^postgres(ql)?:\/\//i.test(url)) throw new Error('url must be a postgres:// connection string');
    writeFile({ kind, url: encrypt(url) });
  } else {
    writeFile({ kind: 'sqlite' });
  }
  return getMaskedBackendConfig();
}

/** Masked view for GET /backend — never includes the password. */
export function getMaskedBackendConfig(): MaskedBackendConfig {
  const cfg = getBackendConfig();
  return { kind: cfg.kind, target: targetSummary(cfg) };
}

function writeFile(stored: { kind: BackendKind; url?: string }): void {
  try { mkdirSync(dirname(FILE), { recursive: true }); } catch { /* dir exists */ }
  writeFileSync(FILE, JSON.stringify(stored, null, 2), { mode: 0o600 });
}
