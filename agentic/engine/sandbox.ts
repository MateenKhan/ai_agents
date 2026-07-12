// ─────────────────────────────────────────────────────────────────────────────
// agentic-core — per-role agent sandbox profiles (SPEC Release 1 · P0.3)
//
// Replaces the blanket `--dangerously-skip-permissions` with a generated
// `.claude/settings.json` per worktree plus `--permission-mode acceptEdits`,
// so headless agents stay unattended WITHOUT a full permissions bypass.
//
// The settings shape follows the official Claude Code permissions schema
// (https://code.claude.com/docs/en/permissions):
//   { "permissions": { "defaultMode": ..., "allow": [...], "deny": [...] } }
// Rule syntax used here, per those docs:
//   - `Bash(git push:*)`  — `:*` is a trailing wildcard, same as `git push *`.
//   - `Read(.env)`        — gitignore-style; a bare filename matches at ANY
//                           depth under the cwd (equivalent to `Read(**/.env)`).
//   - `Edit(./**)`        — path relative to the cwd, i.e. worktree-scoped.
//   - `WebFetch` / `WebSearch` bare tool names deny the whole tool.
// Precedence is deny → ask → allow; in headless (`-p`) runs, a tool call that
// matches NO rule prompts, and an unattended prompt is a denial — which is what
// makes `strict` (allow only the test/build/typecheck trio) enforceable without
// a "deny everything except X" primitive.
//
// Pure and dependency-free (node:* only): the runner, the db-server's /intake
// route, and tests can all import it without dragging in runtime context.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Agent-safety level. strict = trio-only bash; standard = worktree write +
 *  safe bash (the default); dangerous = the legacy full bypass, opt-in only. */
export type SandboxLevel = 'strict' | 'standard' | 'dangerous';

export interface SandboxProfile {
  /** Claude Code permission mode for the spawn: 'acceptEdits' for
   *  strict/standard, 'bypassPermissions' when the user opted into dangerous
   *  (the runner translates that to the legacy --dangerously-skip-permissions flag). */
  permissionMode: string;
  /** Tools stripped from the agent entirely (--disallowedTools). Read-only
   *  roles lose Edit,Write here as well as in the settings deny list. */
  disallowedTools: string[];
  /** The generated `<worktree>/.claude/settings.json` content. */
  settings: object;
}

// ── role classification ────────────────────────────────────────────────────────
// Mirrors agentic/db/defaults.ts: plan-worktree roles (architect, ui-ux-designer),
// no-worktree business/process roles (owner, product-owner, business-analyst,
// scrum-master, delivery-manager), and the read-only reviewer (security-engineer)
// never write code — their prompts already say so; the sandbox now enforces it.
// qa may fix TEST files (write stays) but must not be able to publish anything.
// Everything else — dev, devops-engineer, sre, data-engineer, tech-writer, and
// any user-defined custom role — gets full worktree write (least surprise: a
// custom role is assumed to be a builder unless it is one of the known readers).

const READ_ONLY_ROLES = new Set([
  'owner', 'architect', 'product-owner', 'business-analyst',
  'scrum-master', 'delivery-manager', 'security-engineer', 'ui-ux-designer',
]);

/** Read-only (plan-type) roles get --disallowedTools Edit,Write. Exported so
 *  call sites and tests agree on the classification. */
export function isReadOnlyRole(role: string): boolean {
  return READ_ONLY_ROLES.has(String(role || '').toLowerCase());
}

// ── rule sets ──────────────────────────────────────────────────────────────────

/** Bash the agent needs to verify its own work. Allowed at EVERY non-dangerous level. */
const VERIFY_BASH = [
  'Bash(pnpm test:*)',
  'Bash(pnpm run build:*)',
  'Bash(pnpm run typecheck:*)',
];

/** Local-only git: inspect + commit to the task branch. Nothing that can reach
 *  a remote (push is denied below; fetch/pull simply are not allowed). */
const LOCAL_GIT_BASH = [
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
];

/** The non-negotiable deny list for strict AND standard: no exfiltration
 *  channels (curl/wget/WebFetch/WebSearch), no publishing (git push), no
 *  secrets or databases. Claude Code evaluates deny before allow, and Bash
 *  rules match each subcommand of a compound command independently — so
 *  `git commit -m x && git push` is still blocked by `Bash(git push:*)`. */
const BASE_DENY = [
  'Bash(curl:*)',
  'Bash(wget:*)',
  'Bash(git push:*)',
  'Read(.env)',
  'Read(**/.secret.key)',
  'Read(**/*.db)',
  'WebFetch',
  'WebSearch',
];

/** qa extra: qa may commit test fixes, but no variation of committing may
 *  publish. Push is already denied for everyone; qa additionally loses every
 *  remote-touching git verb so no chained/hooked commit path can reach a remote. */
const QA_EXTRA_DENY = [
  'Bash(git push:*)',        // explicit even though inherited: qa's contract is "cannot publish"
  'Bash(git pull:*)',
  'Bash(git fetch:*)',
  'Bash(git remote:*)',
];

// ── profile builder ────────────────────────────────────────────────────────────

/** Build the sandbox profile for one role at one safety level: the permission
 *  mode + --disallowedTools for the spawn, and the `.claude/settings.json`
 *  content for the worktree. Pure — same inputs, same output. */
export function buildSandboxSettings(role: string, level: SandboxLevel): SandboxProfile {
  // dangerous = the pre-P0.3 behaviour, verbatim: full bypass, empty deny.
  // Kept for users who explicitly opt in (isolated containers/VMs).
  if (level === 'dangerous') {
    return {
      permissionMode: 'bypassPermissions',
      disallowedTools: [],
      settings: { permissions: { defaultMode: 'bypassPermissions', allow: [], deny: [] } },
    };
  }

  const readOnly = isReadOnlyRole(role);
  const isQa = String(role || '').toLowerCase() === 'qa';

  const allow: string[] = [];
  if (!readOnly) allow.push('Edit(./**)', 'Write(./**)'); // worktree-scoped write
  allow.push(...VERIFY_BASH);
  // strict: bash is the verify trio ONLY — no git, however read-only. Anything
  // not allowed prompts, and headless prompts deny. standard: local git too.
  if (level === 'standard') allow.push(...LOCAL_GIT_BASH);

  const deny: string[] = [...BASE_DENY];
  if (readOnly) deny.push('Edit', 'Write');               // belt (deny) + braces (--disallowedTools)
  if (isQa) for (const d of QA_EXTRA_DENY) if (!deny.includes(d)) deny.push(d);
  if (level === 'strict') {
    // Make "no git, no other bash" explicit rather than relying only on the
    // prompt-denies-by-default behaviour: deny the whole git family. The verify
    // trio stays usable because deny rules match subcommands, not tool-wide.
    if (!deny.includes('Bash(git:*)')) deny.push('Bash(git:*)');
  }

  return {
    permissionMode: 'acceptEdits',
    disallowedTools: readOnly ? ['Edit', 'Write'] : [],
    settings: { permissions: { defaultMode: 'acceptEdits', allow, deny } },
  };
}

// ── live-path Bash enforcement (SPEC P0.3 on the SDK runner) ─────────────────────
// The runner IS the permission engine on the live path (it dispatches tool calls
// itself against the Messages API — `.claude/settings.json` governs only `claude -p`).
// So the same allow/deny policy has to be evaluated here, in code, before execSync.
// These helpers keep that evaluation next to the policy that defines it.

/** Split a compound shell command into its subcommands on `&&`, `||`, `;`, `|`, and
 *  newlines. Deliberately a COARSE split (it ignores quoting), which can only ever
 *  OVER-segment — more pieces to screen against the deny list — so it never lets a
 *  hidden `curl`/`git push` slip through a chain like `x && curl evil`. */
export function splitBashSubcommands(command: string): string[] {
  return String(command || '')
    .split(/(?:&&|\|\||[;\n|])/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Does a Claude-Code Bash rule (`Bash(git push:*)`, `Bash(curl:*)`, bare `Bash`)
 *  match a raw subcommand? `Bash(prefix:*)` and `Bash(prefix)` both mean "the
 *  subcommand is `prefix` or starts with `prefix `". Bare `Bash` matches anything. */
export function bashRuleMatches(rule: string, subcommand: string): boolean {
  if (rule === 'Bash') return true;
  const m = /^Bash\((.+?)(?::\*)?\)$/.exec(rule);
  if (!m) return false;
  const prefix = m[1].replace(/\s+/g, ' ').trim();
  const sub = subcommand.replace(/\s+/g, ' ').trim();
  return sub === prefix || sub.startsWith(prefix + ' ');
}

/** Decide whether a Bash command may run under a role/level PROFILE. Returns null to
 *  allow, or a human-readable reason string to DENY. Deny beats allow; at `strict`
 *  every subcommand must additionally match an allow rule (default-deny), which is how
 *  strict enforces "the verify trio only". The runner turns a non-null return into an
 *  is_error tool_result so the model sees the refusal and continues. */
export function bashDenyReason(command: string, profile: SandboxProfile, level: SandboxLevel): string | null {
  if (level === 'dangerous') return null;
  const perms = (profile.settings as { permissions?: { allow?: string[]; deny?: string[] } }).permissions || {};
  const denyBash = (perms.deny || []).filter(r => r === 'Bash' || r.startsWith('Bash('));
  const allowBash = (perms.allow || []).filter(r => r === 'Bash' || r.startsWith('Bash('));
  const subs = splitBashSubcommands(command);
  if (!subs.length) return level === 'strict' ? 'sandbox: empty command is not in the strict allow-list' : null;
  for (const sub of subs) {
    for (const rule of denyBash) if (bashRuleMatches(rule, sub)) return `sandbox: "${sub}" is blocked by deny rule ${rule}`;
    if (level === 'strict' && !allowBash.some(rule => bashRuleMatches(rule, sub))) {
      return `sandbox: "${sub}" is not in the strict allow-list (${allowBash.join(', ') || 'none'})`;
    }
  }
  return null;
}

/** The CLI flags a spawn site should pass for this role/level. Exists so the
 *  runner and the db-server's /intake route derive flags from ONE place:
 *  dangerous → the legacy skip flag; otherwise --permission-mode acceptEdits
 *  (+ --disallowedTools for read-only roles). */
export function sandboxSpawnFlags(role: string, level: SandboxLevel): string[] {
  const p = buildSandboxSettings(role, level);
  if (level === 'dangerous') return ['--dangerously-skip-permissions'];
  const flags = ['--permission-mode', p.permissionMode];
  if (p.disallowedTools.length) flags.push('--disallowedTools', p.disallowedTools.join(','));
  return flags;
}

/** Write `<worktreeDir>/.claude/settings.json` for a run. Idempotent: the
 *  directory is created if missing and the file is overwritten in full, so a
 *  retry (or a level/role change on the same worktree) converges on the current
 *  profile. Returns the settings file path, or null if the write failed —
 *  callers treat this as best-effort, matching the runner's degrade-gracefully
 *  posture (a failed write must not strand the task; the spawn flags still
 *  apply the permission mode). */
export function writeWorktreeSettings(worktreeDir: string, role: string, level: SandboxLevel): string | null {
  try {
    const dir = join(worktreeDir, '.claude');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'settings.json');
    const { settings } = buildSandboxSettings(role, level);
    writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
    return file;
  } catch {
    return null;
  }
}
