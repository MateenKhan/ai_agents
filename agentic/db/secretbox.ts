// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — secretbox: authenticated at-rest encryption for secrets
// AES-256-GCM. Used to encrypt credentials (e.g. the Postgres connection URL)
// before they touch disk. The key comes from SECRETBOX_KEY (hex or base64, 32
// bytes) when set; otherwise a random key is generated once and persisted to a
// gitignored keyfile (db/secretbox.key — matched by the repo's `*.key` ignore).
//
// Ciphertext format (single base64 string):  v1.<iv>.<tag>.<data>  (each base64url)
// decrypt() is a no-op passthrough for values that are not in this format, so
// callers can safely decrypt data that predates encryption.
// ─────────────────────────────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ALGO = 'aes-256-gcm';
const PREFIX = 'v1';

/** Resolve the 32-byte key: env first (hex/base64), else a persisted random keyfile. */
function loadKey(): Buffer {
  const env = process.env.SECRETBOX_KEY;
  if (env && env.trim()) {
    const raw = env.trim();
    // Accept 64-char hex or base64; must decode to exactly 32 bytes.
    const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
    // Fall through to keyfile if malformed rather than crash the server.
    console.warn('[secretbox] SECRETBOX_KEY is not a 32-byte hex/base64 value — using keyfile instead');
  }
  const keyPath = process.env.SECRETBOX_KEYFILE || join(process.cwd(), 'db', 'secretbox.key');
  try {
    if (existsSync(keyPath)) {
      const buf = Buffer.from(readFileSync(keyPath, 'utf-8').trim(), 'hex');
      if (buf.length === 32) return buf;
    }
  } catch { /* regenerate below */ }
  const key = randomBytes(32);
  try {
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
  } catch (e: any) {
    console.warn(`[secretbox] could not persist keyfile at ${keyPath}: ${e?.message} — key is process-local`);
  }
  return key;
}

let KEY: Buffer | null = null;
function key(): Buffer { return (KEY ??= loadKey()); }

const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

/** Encrypt a UTF-8 string → `v1.<iv>.<tag>.<data>`. Empty input returns ''. */
export function encrypt(plaintext: string): string {
  if (plaintext == null || plaintext === '') return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const data = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf-8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}.${b64u(iv)}.${b64u(tag)}.${b64u(data)}`;
}

/** True if `s` looks like a secretbox ciphertext produced by encrypt(). */
export function isEncrypted(s: string): boolean {
  return typeof s === 'string' && s.startsWith(`${PREFIX}.`) && s.split('.').length === 4;
}

/** Decrypt a `v1.<iv>.<tag>.<data>` string. Non-ciphertext passes through unchanged. */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return '';
  if (!isEncrypted(ciphertext)) return ciphertext; // plaintext / legacy value
  const [, ivB, tagB, dataB] = ciphertext.split('.');
  const decipher = createDecipheriv(ALGO, key(), fromB64u(ivB));
  decipher.setAuthTag(fromB64u(tagB));
  const out = Buffer.concat([decipher.update(fromB64u(dataB)), decipher.final()]);
  return out.toString('utf-8');
}
