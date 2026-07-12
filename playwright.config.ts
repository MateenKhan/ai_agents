import { defineConfig, devices } from '@playwright/test';

// Behaviour tests for the workflow editor. These drive the real app in a browser and assert
// what a user would see — nodes rendered, a node moved, the PUT body a Save produces — rather
// than pixels. The db-server is NOT started: each test route-intercepts /workflow, so the tests
// are hermetic and prove the editor speaks the engine's schema without any backend running.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : [['list']],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:6951',
    trace: 'on-first-retry',
    navigationTimeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // The dev server the tests point their browser at. `pnpm exec vite` serves on 6951
  // (strictPort in vite.config.ts). Reuse an already-running dev server locally.
  webServer: {
    command: 'pnpm exec vite',
    url: 'http://localhost:6951',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
