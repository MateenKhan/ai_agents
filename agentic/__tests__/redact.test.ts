import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../redact';

// The shared secret-redaction helper, tested directly. The same function is re-exported from the
// orchestrator (see failurePolicy.test.ts) and imported by the db-server for git output.
describe('redactSecrets (shared)', () => {
  it('masks GitHub tokens', () => {
    expect(redactSecrets('cloning with ghs_abcdefghijklmnopqrstuvwxyz012345'))
      .not.toContain('ghs_abcdefghijklmnopqrstuvwxyz');
    expect(redactSecrets('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')).toContain('gh?_***');
  });

  it('masks user:pass@ inside urls, keeping the host visible', () => {
    const out = redactSecrets('fatal: unable to access https://x-access-token:ghs_secretvalue@github.com/o/r.git');
    expect(out).not.toContain('ghs_secretvalue');
    expect(out).toContain('***@github.com');
    expect(out).toContain('github.com/o/r.git'); // host + path preserved
  });

  it('masks Bearer / token= / password= pairs', () => {
    expect(redactSecrets('Authorization: Bearer sk-supersecretvalue')).not.toContain('sk-supersecretvalue');
    expect(redactSecrets('token=abc123def456')).not.toContain('abc123def456');
    expect(redactSecrets('password: hunter2hunter2')).not.toContain('hunter2hunter2');
  });

  it('leaves ordinary error text intact', () => {
    expect(redactSecrets('TypeError: slugify is not a function')).toBe('TypeError: slugify is not a function');
  });

  it('is safe on empty/nullish input', () => {
    expect(redactSecrets('')).toBe('');
    expect(redactSecrets(undefined as unknown as string)).toBe('');
  });
});
