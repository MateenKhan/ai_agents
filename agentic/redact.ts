// Shared secret redaction — one implementation used by BOTH the orchestrator (scrubbing captured
// agent output before it is stored/prompted/shown) and the db-server (git/curl output). Targeted,
// not exhaustive — GitHub tokens, `Bearer`/`token=`/`password=` pairs, and `user:pass@` embedded in
// URLs. Dependency-free (a pure string function) so either side can import it without pulling in
// anything else.
export function redactSecrets(s: string): string {
  return (s || '')
    // URL credentials FIRST — otherwise the `token:` pattern below greedily eats the rest of the
    // URL (still safe, but it mangles the host). Redacting `user:pass@` here keeps the host visible.
    .replace(/(https?:\/\/)[^@/\s]+@/g, '$1***@')
    .replace(/gh[posur]_[A-Za-z0-9_]{20,}/g, 'gh?_***')
    .replace(/\b(Bearer|token|password|secret|api[_-]?key)\b(\s*[:=]\s*|\s+)\S+/gi, '$1$2***');
}
