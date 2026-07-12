// ─────────────────────────────────────────────────────────────────────────────
// LIVE-PATH sandbox enforcement (SPEC P0.3) — regression test.
//
// See docs/sandbox-verification-2026-07.md. The agent worker runs through a
// hand-rolled @anthropic-ai/sdk tool loop in runner.ts, NOT `claude -p`. So the
// P0.3 policy (buildSandboxSettings' allow/deny lists, isReadOnlyRole) MUST be
// enforced inside the runner's own tool executor — a `.claude/settings.json` on
// disk is invisible to the Messages API.
//
// These tests were skipped while the runner was inert; the enforcement now lives
// in the tool executor (bashDenyReason before execSync, realpath worktree
// confinement on Read/Write/Edit, isReadOnlyRole tool-surface gate + belt), so
// they are unskipped and must pass. The behavioural half (curl denied, strict
// default-deny, prefix matching) is exercised directly against bashDenyReason in
// sandbox.test.ts.
//
// The assertions here are static source checks (dependency-free, deterministic)
// rather than live agent spawns, so they run in CI without an API key.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const runnerSrc = readFileSync(join(__dirname, '..', 'engine', 'runner.ts'), 'utf-8');

describe('P0.3 live-path enforcement (runner tool executor)', () => {
  it('gates the tool surface by role classification, not the never-matching string "plan"', () => {
    // BUG: runner.ts:328 does `if (opts.role !== 'plan')`. No agent role is named
    // 'plan' (that is a workflow stage id / WorktreeMode), so the guard is always
    // true and every role — including read-only ones — receives Bash/Edit/Write.
    // After the fix the runner must classify via isReadOnlyRole (from sandbox.ts).
    expect(runnerSrc).not.toMatch(/opts\.role\s*!==\s*['"]plan['"]/);
    expect(runnerSrc).toMatch(/isReadOnlyRole\s*\(/);
  });

  it('consults the sandbox profile (allow/deny) inside the runner', () => {
    // The SDK loop is the permission engine on the live path, so it must import
    // and use buildSandboxSettings — a `.claude/settings.json` on disk does nothing
    // for anthropic.messages.create.
    expect(runnerSrc).toMatch(/buildSandboxSettings\s*\(/);
  });

  it('enforces a worktree boundary on Read/Write/Edit paths', () => {
    // Today: writeFileSync(join(cwd, input.path)) with no boundary check — `../` or
    // an absolute path escapes the worktree. The fix must resolve and confirm the
    // target stays within cwd before any read/write.
    expect(runnerSrc).toMatch(/resolve\s*\(\s*cwd/);
    // Some explicit containment check (startsWith cwd / relative-not-'..').
    expect(runnerSrc).toMatch(/startsWith\s*\(\s*cwd|\.\.\.?['"]|relative\s*\(/);
  });

  it('screens Bash commands against the deny list before execSync', () => {
    // Today: execSync(input.command, …) runs anything — curl/wget/git push all work,
    // so BASE_DENY and the strict git deny never bite. The fix must reject a command
    // whose subcommands match a deny rule (or, at strict, fall outside allow) and
    // return an is_error tool_result instead of executing.
    // Heuristic: the executor should reference a deny check near the Bash branch.
    const bashBranch = runnerSrc.slice(runnerSrc.indexOf("toolName === 'Bash'"));
    expect(bashBranch).toMatch(/deny|isAllowed|denied|matchRule|sandbox/i);
    // Specifically: it calls the shared policy screen before running the command.
    expect(bashBranch).toMatch(/bashDenyReason\s*\(/);
  });

  it('refuses write/shell tools for a read-only role even if a tool_use arrives (belt)', () => {
    // The tool surface omits Bash/Edit/Write for read-only roles; this is the belt behind
    // that — a resumed transcript replaying a Write must still be rejected, not executed.
    expect(runnerSrc).toMatch(/readOnly\s*&&/);
  });
});
