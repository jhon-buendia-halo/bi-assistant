import { defineConfig } from '@playwright/test';
import type { Target } from './e2e/fixtures/app.fixture';

const snapshots = '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}';

export default defineConfig<object, { target: Target }>({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    },
  },
  globalSetup: './e2e/global-setup.ts',
  reporter: process.env['CI']
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  retries: process.env['CI'] ? 1 : 0,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // `web` is the default target; `desktop` runs only when asked for (see
  // the Test target convention in CLAUDE.md). Pick one with --project.
  projects: [
    {
      name: 'web',
      use: { target: 'web' },
      snapshotPathTemplate: `${snapshots}-web-{platform}{ext}`,
    },
    {
      name: 'desktop',
      use: { target: 'desktop' },
      snapshotPathTemplate: `${snapshots}-{platform}{ext}`,
    },
  ],
});
