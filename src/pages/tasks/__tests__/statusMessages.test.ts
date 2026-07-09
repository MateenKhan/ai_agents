import { describe, expect, it } from 'vitest';
import { humanizeStatusMessage } from '../statusMessages';

describe('humanizeStatusMessage', () => {
  it('rewrites the "orchestrator started" line with the agent count', () => {
    const raw = '🚀 orchestrator started — up to 32 agents, gated at 80% CPU / 80% RAM, lease 15min, maxRun 30min, autoMerge true';
    expect(humanizeStatusMessage(raw)).toBe('Agents are ready — up to 32 can run at once.');
  });

  it('rewrites the "host repo is not a git repository" warning to plain English', () => {
    const raw = '⚠ host repo is not a git repository — default-project tasks run in-place (no worktree isolation / no merge). Point a project at a cloned git repo for the full plan→build→qa→merge pipeline, or run `git init` here.';
    const out = humanizeStatusMessage(raw);
    expect(out).toContain("isn't set up with Git");
    expect(out).not.toMatch(/worktree|pipeline|git init/i);
  });

  it('rewrites "Paused by user"', () => {
    expect(humanizeStatusMessage('Paused by user')).toBe('Paused — press play to resume.');
  });

  it('rewrites orchestrator offline/running', () => {
    expect(humanizeStatusMessage('Orchestrator offline')).toBe('The swarm is offline.');
    expect(humanizeStatusMessage('Orchestrator running')).toBe('The swarm is running.');
  });

  it('strips a leading emoji/glyph when no rule matches', () => {
    expect(humanizeStatusMessage('✅ merged branch feature/x into main')).toBe('merged branch feature/x into main');
  });

  it('returns empty string for empty input', () => {
    expect(humanizeStatusMessage('')).toBe('');
  });

  it('keeps an already-friendly message intact', () => {
    expect(humanizeStatusMessage('All tasks are up to date')).toBe('All tasks are up to date');
  });
});
