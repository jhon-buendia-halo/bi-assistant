import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import type { Target } from './e2e/fixtures/app.fixture';

/**
 * `.env.e2e.local` at the repository root (git-ignored) can point the suite
 * at another World Cup database (`E2E_WORLD_CUP_DB_*`, see
 * e2e/helpers/world-cup-db.ts). Variables already set in the environment win.
 */
const localEnv = path.resolve(__dirname, '../.env.e2e.local');
if (fs.existsSync(localEnv)) {
  for (const line of fs.readFileSync(localEnv, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

const snapshots = '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}';

export default defineConfig<object, { target: Target }>({
  testDir: './e2e',
  outputDir: './test-results',
  // Spec files run in parallel; tests within a file stay in order. Each web
  // test has its own CLI port, data dir and stub servers, and specs that
  // create databases on the shared Postgres name them uniquely (delivery.md
  // 13, roadmap 1.23.32). E2E_WORKERS overrides; CI stays serial.
  fullyParallel: false,
  workers: process.env['E2E_WORKERS']
    ? Number(process.env['E2E_WORKERS'])
    : process.env['CI']
      ? 1
      : 3,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    },
  },
  globalSetup: './e2e/global-setup.ts',
  // scripts/qa.mjs sets QA_REPORT_DIR to collect machine-readable results
  // for the story's tests.md (delivery.md 13).
  reporter: process.env['QA_REPORT_DIR']
    ? [
        ['list'],
        ['json', { outputFile: path.join(process.env['QA_REPORT_DIR'], 'results.json') }],
        ['html', { open: 'never', outputFolder: path.join(process.env['QA_REPORT_DIR'], 'html') }],
      ]
    : process.env['CI']
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
      // The desktop backend always listens on port 3000: one app at a time.
      workers: 1,
      snapshotPathTemplate: `${snapshots}-{platform}{ext}`,
    },
  ],
});
