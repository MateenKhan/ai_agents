// ─────────────────────────────────────────────────────────────────────────────
// Shared UI class tokens — ONE source of truth for the primitives that were
// previously copy-pasted into GitPanel / ProjectBar / DbBackendTab / etc.
// The actual styles live in `src/index.css` (@layer components); these are just the
// class names so JSX reads `className={btnPrimary}` and composition still works:
//   className={`${inputCls} font-mono`}
// ─────────────────────────────────────────────────────────────────────────────

// ── DANGER HIERARCHY (see the spec block in src/index.css) ──
//   1 IDENTITY   accent red — logo / active tab / links. Never a routine action button.
//   2 ROUTINE    btnPrimary (ink) — New Task / Save / Apply / Ask.
//   3 DESTRUCTIVE btnDanger (rose + ring + bold) — Delete / Stop / Reject / skip-perms.
// Tier 3 MUST out-shout tier 2, and must pair with a warning icon + a confirm step.

/** Tier 2 — routine primary. Neutral ink. NOT red: routine actions are not the danger. */
export const btnPrimary = 'btn-primary';
export const btnGhost = 'btn-ghost';
/** Tier 3 — destructive. Use for anything irreversible: delete, stop, reject, skip-perms. */
export const btnDanger = 'btn-danger';
/** Tier 3, compact — destructive action in a dense row/toolbar. */
export const btnDangerSm = 'btn-danger-sm';
/** Compact PRIMARY button for small inline CTAs (Add/Apply/Custom). Tier 2 → ink. */
export const btnPrimarySm = 'btn-primary-sm';
/** Compact secondary button for toolbars/dense rows. */
export const btnSm = 'btn-sm';
/** Square icon-only button — ONE geometry for the header cluster and toolbars.
 *  Semantic controls layer colour on top: `${iconBtn} bg-emerald-50 text-emerald-700 …` */
export const iconBtn = 'icon-btn';
/** Larger icon button for primary affordances (the collapse chevron). */
export const iconBtnLg = 'icon-btn-lg';
/** Neutral icon button on a white panel surface (not the header bar). */
export const iconBtnPlain = 'icon-btn-plain';
export const inputCls = 'input';
/** Native <select> — text-field look with room for the caret. */
export const selectCls = 'input-select';
/** <textarea> — text-field look, taller, vertically resizable. */
export const textareaCls = 'input-textarea';
/** Compact field for toolbars/dense rows (matches btnSm height). */
export const inputSm = 'input-sm';
/** Compact <select> for toolbars. */
export const selectSm = 'input-select-sm';
/** Tiny uppercase section label (text-micro font-black uppercase tracking-widest). */
export const eyebrow = 'eyebrow';
