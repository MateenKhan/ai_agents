// Turns the orchestrator's raw, jargon-heavy status/log lines into plain English
// for the System Status panel. The backend keeps emitting technical text (logs
// need it); this is a display-only layer so users read something friendly.
//
// Pure + data-driven so it's easy to test and extend: add a rule to RULES.

interface Rule {
  /** Matches the raw message (case-insensitive when a RegExp with /i). */
  match: RegExp;
  /** Friendly replacement, or a builder that can use regex capture groups. */
  to: string | ((m: RegExpMatchArray) => string);
}

// First matching rule wins. Order from most specific to least.
const RULES: Rule[] = [
  {
    match: /orchestrator started.*?up to (\d+)\s*agents/i,
    to: (m) => `Agents are ready — up to ${m[1]} can run at once.`,
  },
  {
    match: /host repo is not a git repository/i,
    to: "This folder isn't set up with Git yet, so tasks run without branches or auto-merge. Connect a Git repo for the full workflow.",
  },
  { match: /orchestrator (?:offline|down|stopped)/i, to: 'The swarm is offline.' },
  { match: /orchestrator (?:running|started)/i, to: 'The swarm is running.' },
  { match: /paused by user/i, to: 'Paused — press play to resume.' },
  { match: /circuit.*open|breaker.*open/i, to: 'Paused automatically after repeated errors. It will retry shortly.' },
  { match: /resource gate|\bcpu\b|\bram\b|memory/i, to: 'Waiting for the computer to free up before starting more work.' },
  { match: /lease (?:expired|lost)/i, to: 'A task timed out and was handed back to the queue.' },
  { match: /watchdog|stall/i, to: 'A stuck task was detected and restarted.' },
  { match: /starting up/i, to: 'Starting up…' },
];

/**
 * Drop the leading status glyph the backend prefixes (⚠ 🚀 ✅ ❌ ℹ •, dashes,
 * whitespace) so the fallback text reads cleanly. Letters/digits are kept.
 * Done in code (not a regex range) to avoid surrogate-pair edge cases.
 */
function stripLeadingGlyphs(s: string): string {
  let i = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    // Stop at the first real word character (ASCII letter/digit or accented letter).
    const isWordChar = (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || (cp >= 0x00C0 && cp <= 0x024F);
    if (isWordChar) break;
    i += ch.length;
  }
  return s.slice(i).trim();
}

/**
 * Convert one raw orchestrator message to user-readable text.
 * Falls back to the original with leading emoji/symbols stripped.
 */
export function humanizeStatusMessage(raw: string): string {
  if (!raw) return '';
  for (const rule of RULES) {
    const m = raw.match(rule.match);
    if (m) return typeof rule.to === 'function' ? rule.to(m) : rule.to;
  }
  const cleaned = stripLeadingGlyphs(raw);
  return cleaned || raw.trim();
}
