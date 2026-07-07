import { defineConfig } from 'vitest/config';

// Unit tests default to a plain Node env (the backend uses node:sqlite /
// node:child_process; most frontend units under test are pure functions).
// Component/hook tests that need a DOM opt into jsdom per-file with a docblock:
//   // @vitest-environment jsdom
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.{ts,tsx}', '**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', '.worktrees', '.agent_logs'],
  },
});
