// ─────────────────────────────────────────────────────────────────────────────
// secretbox — AES-256-GCM encryption for secrets at rest (git tokens, GitHub App
// private keys/client secrets/webhook secrets, and the optional Postgres creds).
//
// Format:  v1:<ivB64>:<tagB64>:<ciphertextB64>   (self-describing, versioned)
//
// Back-compat / lazy migration: decrypt() returns any NON-`v1:` input unchanged, so
// rows still holding plaintext keep working and get re-encrypted on the next write
// (or the boot re-encryption sweep). Reads therefore never break during rollout.
//
// Master key: env AGENTS_SECRET_KEY (base64, 32 bytes). If absent, a key is generated
// ONCE and written to db/.secret.key (chmod 600, gitignored) with a loud one-time log.
// The key never lives in the DB and never leaves the machine. This protects the DB
// file/backups at rest; it does NOT defend a live host that holds the key.
// ─────────────────────────────────────────────────────────────────────────────
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const PREFIX = 'v1:';
let cachedKey: Buffer | null = null;

function keyFilePath(): string {
  return join(process.cwd(), 'db', '.secret.key');
}

/** Resolve the 32-byte master key: env first, else a generated-and-persisted key file. */
export function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const env = process.env.AGENTS_SECRET_KEY;
  if (env) {
    const k = Buffer.from(env, 'base64');
    if (k.length !== 32) throw new Error('AGENTS_SECRET_KEY must be base64 of exactly 32 bytes');
    cachedKey = k;
    return k;
  }
  const path = keyFilePath();
  if (existsSync(path)) {
    const k = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
    if (k.length !== 32) throw new Error(`${path} is not a valid 32-byte base64 key`);
    cachedKey = k;
    return k;
  }
  // First run: mint + persist a key. Loud, once — losing this key makes secrets unrecoverable.
  const k = randomBytes(32);
  try {
    writeFileSync(path, k.toString('base64') + '\n', { mode: 0o600 });
    try { chmodSync(path, 0o600); } catch { /* windows: best-effort */ }
    console.warn(`[secretbox] 🔑 generated a new master key at ${path} (chmod 600). BACK IT UP — ` +
      `without it, encrypted secrets cannot be recovered. Or set AGENTS_SECRET_KEY to control it.`);
  } catch (e: any) {
    console.warn(`[secretbox] could not persist key file (${e?.message}); using an in-memory key ` +
      `for this process only — secrets written now will be unreadable after restart.`);
  }
  cachedKey = k;
  return k;
}

export function isEncrypted(s: unknown): boolean {
  return typeof s === 'string' && s.startsWith(PREFIX);
}

/** Encrypt a UTF-8 string → `v1:iv:tag:ct`. Empty/null passes through untouched. */
export function encrypt(plaintext: string | null | undefined): string {
  if (plaintext == null || plaintext === '') return plaintext ?? '';
  if (isEncrypted(plaintext)) return plaintext; // already encrypted — idempotent
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getMasterKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Decrypt a `v1:` blob. Non-`v1:` input (legacy plaintext) is returned unchanged. */
export function decrypt(value: string | null | undefined): string {
  if (value == null || value === '') return value ?? '';
  if (!isEncrypted(value)) return String(value); // legacy plaintext — lazy migration
  const parts = String(value).slice(PREFIX.length).split(':');
  if (parts.length !== 3) return String(value);
  try {
    const [ivB64, tagB64, ctB64] = parts;
    const decipher = createDecipheriv('aes-256-gcm', getMasterKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (e: any) {
    throw new Error(`secretbox: decryption failed (wrong or missing master key?): ${e?.message}`);
  }
}
