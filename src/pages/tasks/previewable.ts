// Can a task produce a VISUAL preview? A preview builds and serves the branch, which is only
// meaningful when the change actually renders something in a browser. A backend/library task
// (add a `slugify()` util, a migration, an API handler) has nothing to look at — for those the
// review artifact is the diff, not a screenshot, so the Build Preview button is hidden.
//
// This is a heuristic over the changed file paths (the method chosen for this feature). It errs
// toward SHOWING the button when unsure: an unknown or empty file list returns `true`, because
// wrongly hiding a preview that was actually possible is worse than showing one that renders the
// unchanged app.

// Extensions the browser renders directly.
const VISUAL_EXT = /\.(tsx|jsx|vue|svelte|astro|html?|css|scss|sass|less|mdx)$/i;

// Clearly front-end directories — a plain .ts/.js here still drives the UI. Deliberately
// conservative: ambiguous names like `app`, `routes`, `services` are left out because they are
// as often backend as front-end, and the extension check already catches real UI files.
const VISUAL_DIR = /(^|\/)(components?|pages?|views?|layouts?|screens?|widgets?|public|static|assets|styles?|templates?|ui)(\/)/i;

// A test/story/type-decl file never counts as visual even under a UI folder.
const NON_VISUAL = /(\.(test|spec|stories)\.|(^|\/)__tests__\/|\.d\.ts$)/i;

/** Does this single file path drive something a browser renders? */
export function isVisualFile(path: string): boolean {
  if (!path) return false;
  if (NON_VISUAL.test(path)) return false;
  return VISUAL_EXT.test(path) || VISUAL_DIR.test(path);
}

/** Given the files a task changed, can it have a visual preview?
 *  Unknown/empty ⇒ true (fail open — never hide a preview that might exist). */
export function inferPreviewable(files: ReadonlyArray<{ path: string }> | null | undefined): boolean {
  if (!files || files.length === 0) return true;
  return files.some(f => isVisualFile(f.path));
}
