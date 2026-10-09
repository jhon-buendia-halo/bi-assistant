import {
  _electron as electron,
  ElectronApplication,
  Page,
  test as base,
  expect,
} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface ElectronFixtures {
  appDataDir: string;
  electronApp: ElectronApplication;
  page: Page;
}

const frontendRoot = path.resolve(__dirname, '../..');

/**
 * Port the app's backend listens on during the suite. Set `E2E_BACKEND_PORT`
 * to run beside a desktop app that already holds 3000.
 */
export const E2E_BACKEND_PORT = process.env['E2E_BACKEND_PORT'] ?? '3000';

/**
 * Launches the desktop app on `appDataDir`. `env` is layered over the test
 * defaults; a value of `undefined` removes an inherited variable.
 */
export async function launchElectronApp(
  appDataDir: string,
  env: Record<string, string | undefined> = {},
): Promise<ElectronApplication> {
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries({
    ...process.env,
    NODE_ENV: 'test',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    QUESTIONS_TO_INSIGHTS_USER_DATA_DIR: appDataDir,
    BACKEND_PORT: E2E_BACKEND_PORT,
    ...env,
  })) {
    if (value !== undefined) merged[name] = value;
  }
  const application = await electron.launch({
    args: [frontendRoot],
    cwd: frontendRoot,
    env: merged,
  });
  const port = merged['BACKEND_PORT'];
  if (port !== '3000') {
    // Under file:// the renderer always calls localhost:3000 (BA-109). The
    // window opens only once the backend is ready, so this route is in place
    // before the renderer's first request.
    await application.context().route(/^http:\/\/localhost:3000\//, (route) =>
      route.continue({
        url: route
          .request()
          .url()
          .replace('http://localhost:3000/', `http://localhost:${port}/`),
      }),
    );
  }
  return application;
}

/** The main window, once the app shell has rendered. */
export async function readyWindow(
  application: ElectronApplication,
): Promise<Page> {
  const page = await application.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByLabel('Open system logs')).toBeVisible();
  return page;
}

export const test = base.extend<ElectronFixtures>({
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

  electronApp: async ({ appDataDir }, use, testInfo) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const application = await launchElectronApp(appDataDir);

    application
      .process()
      .stdout?.on('data', (chunk) => stdout.push(String(chunk)));
    application
      .process()
      .stderr?.on('data', (chunk) => stderr.push(String(chunk)));

    await use(application);
    await application.close();

    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('electron-stdout.txt', {
        body: Buffer.from(stdout.join('').slice(-200_000)),
        contentType: 'text/plain',
      });
      await testInfo.attach('electron-stderr.txt', {
        body: Buffer.from(stderr.join('').slice(-200_000)),
        contentType: 'text/plain',
      });
    }
  },

  page: async ({ electronApp }, use) => {
    await use(await readyWindow(electronApp));
  },
});

export { expect };
