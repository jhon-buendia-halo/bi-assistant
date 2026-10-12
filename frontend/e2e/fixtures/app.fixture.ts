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
import {
  LOCAL_SESSION_KEY,
  LOCAL_USERS,
  localUserSelect,
  signInLocally,
} from '../helpers/local-auth';

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
  /**
   * Local mode: signs in as the persona `userId` through the API (admin
   * R71), stores the token where the app keeps it, reloads and waits for
   * the shell. Replaces whoever was signed in.
   */
  signInAs(userId: string): Promise<void>;
  /** Signs out through the account menu and waits for the sign-in page. */
  signOut(): Promise<void>;
  close(): Promise<void>;
  /** Everything the app process wrote, for failure attachments. */
  output(): { stdout: string; stderr: string };
}

export type Env = Record<string, string | undefined>;

/** Extra launch options for `launchApp`. */
export interface LaunchOptions {
  /** Web only: extra npm CLI arguments, kept across `restartCli()`. */
  cliArgs?: string[];
}

/** How `launchApp` signs in (local mode, admin R70-R71). */
export interface SignInOptions {
  /** Sign in before the test starts; default true. */
  autoSignIn: boolean;
  /** The persona to sign in as; default Demo User (`local`). */
  autoSignInAs: string;
}

interface AppFixtures extends SignInOptions {
  appDataDir: string;
  app: RunningApp;
  page: Page;
  /** Launches another app on `appDataDir`; closed after the test. */
  launchApp: (
    appDataDir: string,
    env?: Env,
    options?: LaunchOptions,
  ) => Promise<RunningApp>;
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
    // A developer's shell may export it for dev runs (CLAUDE.md, Observed dev
    // runs); tests keep observability off unless they turn it on themselves.
    QTI_DEV_OBSERVABILITY: undefined,
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

/** Waits until the app shows the shell or the local sign-in page. */
async function waitForShellOrSignIn(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(
    page.getByLabel('Open system logs').or(localUserSelect(page)),
  ).toBeVisible();
}

/** Stores `token` as the app's local auth session and reloads. */
async function storeTokenAndReload(page: Page, token: string): Promise<void> {
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [LOCAL_SESSION_KEY, token] as const,
  );
  await page.reload();
  await waitForShell(page);
}

/** Signs out through the account menu (admin R10, R71). */
async function signOutThroughMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(localUserSelect(page)).toBeVisible();
}

/** Resolves once the desktop backend on port 3000 answers `GET /me`. */
async function waitForDesktopBackend(): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://localhost:3000/me');
      if (res.status === 200 || res.status === 401) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The desktop backend did not answer GET /me within 90 s');
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
  signIn: SignInOptions,
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
  const signInAs = async (userId: string) => {
    await waitForDesktopBackend();
    const token = await signInLocally('http://localhost:3000', userId);
    await storeTokenAndReload(page, token);
  };
  await waitForShellOrSignIn(page);
  if (signIn.autoSignIn) await signInAs(signIn.autoSignInAs);
  return {
    target: 'desktop',
    page,
    electronApp,
    restartCli: () =>
      Promise.reject(
        new Error('restartCli() is web only; click "Restart backend" instead'),
      ),
    signInAs,
    signOut: () => signOutThroughMenu(page),
    close: () => electronApp.close(),
    output: () => ({ stdout: stdout.join(''), stderr: stderr.join('') }),
  };
}

export interface CliProcess {
  child: ChildProcess;
  url: string;
  port: number;
}

/** Starts the CLI and resolves once it prints its URL. */
export function startCli(
  appDataDir: string,
  env: Env,
  port: number,
  stdout: string[],
  stderr: string[],
  cliArgs: string[] = [],
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
      ...cliArgs,
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
export async function stopCli(child: ChildProcess): Promise<void> {
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
  signIn: SignInOptions,
  cliArgs: string[] = [],
): Promise<RunningApp> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let cli = await startCli(appDataDir, env, 0, stdout, stderr, cliArgs);
  const context = await browser.newContext({ viewport: WINDOW_SIZE });
  if (signIn.autoSignIn) {
    const token = await signInLocally(cli.url, signIn.autoSignInAs);
    // Stored before the app's first load, once per tab: a later sign-out or
    // sign-in in the test is not undone by a reload.
    await context.addInitScript(
      ({ key, value, origin }) => {
        try {
          if (window.location.origin !== origin) return;
          if (sessionStorage.getItem('e2e:local-session-seeded')) return;
          localStorage.setItem(key, value);
          sessionStorage.setItem('e2e:local-session-seeded', '1');
        } catch {
          // No storage on this document (about:blank).
        }
      },
      { key: LOCAL_SESSION_KEY, value: token, origin: new URL(cli.url).origin },
    );
  }
  const page = await context.newPage();
  await page.goto(cli.url);
  if (signIn.autoSignIn) await waitForShell(page);
  else await waitForShellOrSignIn(page);
  return {
    target: 'web',
    page,
    async restartCli() {
      await stopCli(cli.child);
      cli = await startCli(appDataDir, env, cli.port, stdout, stderr, cliArgs);
      await page.reload();
      await waitForShellOrSignIn(page);
    },
    async signInAs(userId) {
      await storeTokenAndReload(page, await signInLocally(cli.url, userId));
    },
    signOut: () => signOutThroughMenu(page),
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
  autoSignIn: [true, { option: true }],
  autoSignInAs: [LOCAL_USERS.demo, { option: true }],

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

  launchApp: async (
    { target, webBrowser, autoSignIn, autoSignInAs },
    use,
    testInfo,
  ) => {
    const launched: RunningApp[] = [];
    const signIn: SignInOptions = { autoSignIn, autoSignInAs };
    await use(async (appDataDir, env = {}, options = {}) => {
      if (target === 'desktop' && options.cliArgs?.length) {
        throw new Error('cliArgs are web only (the desktop app has no CLI)');
      }
      const app =
        target === 'desktop'
          ? await launchDesktop(appDataDir, env, signIn)
          : await launchWeb(
              await webBrowser(),
              appDataDir,
              env,
              signIn,
              options.cliArgs,
            );
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
