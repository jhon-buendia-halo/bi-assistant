import {
  _electron as electron,
  Browser,
  ElectronApplication,
  Page,
  TestInfo,
  test as base,
  expect,
} from '@playwright/test';
import { ChildProcess, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Which app the suite drives. `web` (the default, see the Test target
 * convention in CLAUDE.md) starts the npm CLI and drives it in Chromium;
 * `desktop` launches the real Electron app and runs only when asked for.
 */
export type Target = 'web' | 'desktop';

/** A running app under test, whichever target it is. */
export interface RunningApp {
  readonly target: Target;
  readonly page: Page;
  /** The Electron app; only set on the desktop target. */
  readonly electronApp?: ElectronApplication;
  /**
   * Web only: stops the CLI, starts it again on the same port and data dir,
   * and reloads the page (the browser equivalent of "Restart backend").
   */
  restartCli(): Promise<void>;
  close(): Promise<void>;
  /** Everything the app process wrote, for failure attachments. */
  output(): { stdout: string; stderr: string };
}

type Env = Record<string, string | undefined>;

interface AppFixtures {
  appDataDir: string;
  app: RunningApp;
  page: Page;
  /** Launches another app on `appDataDir`; closed after the test. */
  launchApp: (appDataDir: string, env?: Env) => Promise<RunningApp>;
}

interface WorkerFixtures {
  target: Target;
  /** Chromium for the web target, launched on first use (never on desktop). */
  webBrowser: () => Promise<Browser>;
}

const frontendRoot = path.resolve(__dirname, '../..');
const backendRoot = path.resolve(frontendRoot, '../backend');
const cliPath = path.join(backendRoot, 'dist', 'cli.js');
/** The Electron window's default size, so both targets lay out the same. */
export const WINDOW_SIZE = { width: 1440, height: 900 };

/** Test defaults layered with `env`; a value of `undefined` removes a variable. */
function mergedEnv(env: Env): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries({
    ...process.env,
    NODE_ENV: 'test',
    ...env,
  })) {
    if (value !== undefined) merged[name] = value;
  }
  return merged;
}

/** Waits until the app shell has rendered. */
async function waitForShell(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByLabel('Open system logs')).toBeVisible();
}

/** True when something accepts connections on `port`. */
function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    const unavailable = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once('error', unavailable);
    socket.once('timeout', unavailable);
  });
}

async function launchDesktop(
  appDataDir: string,
  env: Env,
): Promise<RunningApp> {
  // The desktop app's backend always listens on 3000.
  if (await portIsOpen(3000)) {
    throw new Error(
      'Port 3000 is already in use. Close the running Questions to Insights app before running the desktop suite.',
    );
  }
  const stdout: string[] = [];
  const stderr: string[] = [];
  const electronApp = await electron.launch({
    args: [frontendRoot],
    cwd: frontendRoot,
    env: mergedEnv({
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      QUESTIONS_TO_INSIGHTS_USER_DATA_DIR: appDataDir,
      ...env,
    }),
  });
  electronApp.process().stdout?.on('data', (c) => stdout.push(String(c)));
  electronApp.process().stderr?.on('data', (c) => stderr.push(String(c)));
  const page = await electronApp.firstWindow();
  await waitForShell(page);
  return {
    target: 'desktop',
    page,
    electronApp,
    restartCli: () =>
      Promise.reject(
        new Error('restartCli() is web only; click "Restart backend" instead'),
      ),
    close: () => electronApp.close(),
    output: () => ({ stdout: stdout.join(''), stderr: stderr.join('') }),
  };
}

interface CliProcess {
  child: ChildProcess;
  url: string;
  port: number;
}

/** Starts the CLI and resolves once it prints its URL. */
function startCli(
  appDataDir: string,
  env: Env,
  port: number,
  stdout: string[],
  stderr: string[],
): Promise<CliProcess> {
  if (!fs.existsSync(cliPath)) {
    throw new Error(
      `${cliPath} not found. Run "npm run test:e2e" (it builds the backend with the web UI first).`,
    );
  }
  const child = spawn(
    process.execPath,
    [
      cliPath,
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--data-dir',
      appDataDir,
    ],
    {
      cwd: backendRoot,
      env: mergedEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `CLI did not print its URL within 60 s:\n${stdout.join('')}\n${stderr.join('')}`,
        ),
      );
    }, 60_000);
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      stdout.push(text);
      seen += text;
      const match = /URL:\s+(http:\/\/\S+)/.exec(seen);
      if (match) {
        clearTimeout(timer);
        resolve({ child, url: match[1], port: Number(new URL(match[1]).port) });
      }
    });
    child.stderr?.on('data', (chunk) => stderr.push(String(chunk)));
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `CLI exited (${code ?? signal}) before it was ready:\n${stdout.join('')}\n${stderr.join('')}`,
        ),
      );
    });
  });
}

/** Stops the CLI and waits for the process to exit (forced after 10 s). */
async function stopCli(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => resolve()),
  );
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(timer);
}

async function launchWeb(
  browser: Browser,
  appDataDir: string,
  env: Env,
): Promise<RunningApp> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let cli = await startCli(appDataDir, env, 0, stdout, stderr);
  const context = await browser.newContext({ viewport: WINDOW_SIZE });
  const page = await context.newPage();
  await page.goto(cli.url);
  await waitForShell(page);
  return {
    target: 'web',
    page,
    async restartCli() {
      await stopCli(cli.child);
      cli = await startCli(appDataDir, env, cli.port, stdout, stderr);
      await page.reload();
      await waitForShell(page);
    },
    async close() {
      await context.close();
      await stopCli(cli.child);
    },
    output: () => ({ stdout: stdout.join(''), stderr: stderr.join('') }),
  };
}

async function attachOutput(
  app: RunningApp,
  testInfo: TestInfo,
  prefix: string,
) {
  const { stdout, stderr } = app.output();
  await testInfo.attach(`${prefix}-stdout.txt`, {
    body: Buffer.from(stdout.slice(-200_000)),
    contentType: 'text/plain',
  });
  await testInfo.attach(`${prefix}-stderr.txt`, {
    body: Buffer.from(stderr.slice(-200_000)),
    contentType: 'text/plain',
  });
}

export const test = base.extend<AppFixtures, WorkerFixtures>({
  target: ['web', { option: true, scope: 'worker' }],

  webBrowser: [
    async ({ playwright }, use) => {
      let browser: Browser | undefined;
      await use(async () => (browser ??= await playwright.chromium.launch()));
      await browser?.close();
    },
    { scope: 'worker' },
  ],

  appDataDir: async ({}, use, testInfo) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-e2e-'));
    await use(directory);

    if (testInfo.status !== testInfo.expectedStatus) {
      const diagnosticsPath = path.join(directory, 'logs', 'system.ndjson');
      if (fs.existsSync(diagnosticsPath)) {
        await testInfo.attach('system-diagnostics.ndjson', {
          path: diagnosticsPath,
          contentType: 'application/x-ndjson',
        });
      }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  },

  launchApp: async ({ target, webBrowser }, use, testInfo) => {
    const launched: RunningApp[] = [];
    await use(async (appDataDir, env = {}) => {
      const app =
        target === 'desktop'
          ? await launchDesktop(appDataDir, env)
          : await launchWeb(await webBrowser(), appDataDir, env);
      launched.push(app);
      return app;
    });
    for (const [index, app] of launched.entries()) {
      await app.close().catch(() => undefined);
      if (testInfo.status !== testInfo.expectedStatus) {
        await attachOutput(app, testInfo, `${app.target}-${index + 1}`);
      }
    }
  },

  app: async ({ appDataDir, launchApp }, use) => {
    await use(await launchApp(appDataDir));
  },

  page: async ({ app }, use) => {
    await use(app.page);
  },
});

/**
 * Marks the tests in the enclosing `describe` (or file) as needing the
 * desktop shell. The web project skips them with the reason "Desktop only";
 * list them as "desktop not run" in the evidence.
 */
export function desktopOnly(reason: string): void {
  test.skip(({ target }) => target !== 'desktop', `Desktop only: ${reason}`);
}

/** Marks the tests in the enclosing `describe` as browser-only (web project). */
export function webOnly(reason: string): void {
  test.skip(({ target }) => target !== 'web', `Web only: ${reason}`);
}

export { expect };
