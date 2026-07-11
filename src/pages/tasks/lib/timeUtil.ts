// ── When did this happen? — ONE source of truth for date/time rendering ──────
// The app was rendering timestamps three different ways (raw ISO, `toLocaleString`,
// hand-rolled `iso.slice(0,16)`, and a per-file `timeAgo`). Two shapes cover every
// case; both live here, both are dependency-free, both are null-safe (a blank or
// unparseable input returns '' so callers can render them unconditionally).
//
//   timeAgo(iso)    → compact RELATIVE ("2h ago") for dense rows, feeds, commit lists.
//   formatWhen(iso) → compact ABSOLUTE ("Jul 11, 14:30") for tooltips + detail panes.
//
// Pair them: show timeAgo() in the row and formatWhen() in its title/tooltip, so the
// glanceable form is on screen and the exact time is one hover away.

/** Compact relative time. '' for blank/unparseable input. */
export function timeAgo(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

/** Compact absolute local time ("Jul 11, 14:30"). '' for blank input; falls back to
 *  the readable ISO head for odd git date strings the Date parser can't read. */
export function formatWhen(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ');
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
