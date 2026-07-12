// ─────────────────────────────────────────────────────────────────────────────
// LIVE-PATH sandbox gap (SPEC P0.3) — documenting test.
//
// See docs/sandbox-verification-2026-07.md. The agent worker runs through a
// hand-rolled @anthropic-ai/sdk tool loop in runner.ts, NOT `claude -p`. As a
// result the P0.3 sandbox — writeWorktreeSettings' `.claude/settings.json`,
// buildSandboxSettings' allow/deny lists, sandboxSpawnFlags — is INERT on the
// path real agents execute on: the Messages API never reads those.
//
// These tests are SKIPPED because the guarantees do not hold today. They encode
// the invariants that must be true AFTER enforcement is moved into the runner's
// own tool executor (design in §4 of the verification doc). Unskip them when the
// fix lands; they should then pass.
//
// The assertions are static source checks (dependency-free, deterministic) rather
// than live agent spawns, so they can run in CI without an API key.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const runnerSrc = readFileSync(join(__dirname, '..', 'engine', 'runner.ts'), 'utf-8');

describe.skip('P0.3 live-path enforcement (currently inert — see sandbox-verification-2026-07.md)', () => {
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
  });
});
