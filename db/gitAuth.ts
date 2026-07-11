// Git URL credential injection — kept in its own module (not inline in server.ts) so it is
// unit-testable without booting the HTTP server, and reused by every git fetch/push/ls-remote.

/** Inject a `user:token@` credential into an https git URL for a one-shot fetch/push.
 *  Strips ANY credential already in the URL first — a remote cloned with the token baked in
 *  (`https://x-access-token:ghs_…@github.com/…`) would otherwise get a SECOND credential
 *  prepended, and the resulting double `user:token@user:token@host` makes git/curl read the
 *  second colon as a port ("URL rejected: Port number was not a decimal number"). */
export function authenticateGitUrl(url: string, token?: string, username?: string): string {
  if (!token || !url.startsWith('https://')) return url;
  const clean = url.replace(/^https:\/\/[^@/]*@/, 'https://'); // drop existing userinfo, if any
  return clean.replace('https://', `https://${encodeURIComponent(username || 'x-access-token')}:${encodeURIComponent(token)}@`);
}
