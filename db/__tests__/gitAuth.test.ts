import { describe, it, expect } from 'vitest';
import { authenticateGitUrl } from '../gitAuth';

// The bug this fixes: a remote whose URL already carries a token gets a SECOND token prepended,
// producing `user:tok@user:tok@host`, which curl rejects with "Port number was not a decimal
// number". Stripping the existing credential first keeps exactly one `user:token@`.
describe('authenticateGitUrl', () => {
  const clean = 'https://github.com/Owner/repo.git';

  it('injects a single credential into a clean https url', () => {
    const out = authenticateGitUrl(clean, 'ghs_NEW');
    expect(out).toBe('https://x-access-token:ghs_NEW@github.com/Owner/repo.git');
    expect((out.match(/@/g) || []).length).toBe(1);
  });

  it('strips an EXISTING baked-in credential before injecting (the double-@ bug)', () => {
    const dirty = 'https://x-access-token:ghs_OLD@github.com/Owner/repo.git';
    const out = authenticateGitUrl(dirty, 'ghs_NEW');
    expect(out).toBe('https://x-access-token:ghs_NEW@github.com/Owner/repo.git');
    expect((out.match(/@/g) || []).length).toBe(1); // exactly one — no double
    expect(out).not.toContain('ghs_OLD');
  });

  it('honours a custom username', () => {
    expect(authenticateGitUrl(clean, 'tok', 'alice')).toBe('https://alice:tok@github.com/Owner/repo.git');
  });

  it('url-encodes a token with special characters', () => {
    const out = authenticateGitUrl(clean, 'a/b+c=d');
    expect(out).toContain(encodeURIComponent('a/b+c=d'));
    expect(out).not.toContain('a/b+c=d'); // raw form must not leak
  });

  it('returns the url unchanged when there is no token', () => {
    expect(authenticateGitUrl(clean, undefined)).toBe(clean);
    expect(authenticateGitUrl(clean, '')).toBe(clean);
  });

  it('leaves non-https urls alone (ssh/scp form)', () => {
    const ssh = 'git@github.com:Owner/repo.git';
    expect(authenticateGitUrl(ssh, 'tok')).toBe(ssh);
  });
});
