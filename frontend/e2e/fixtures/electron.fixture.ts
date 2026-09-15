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
    const application = await electron.launch({
      args: [frontendRoot],
      cwd: frontendRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        QUESTIONS_TO_INSIGHTS_USER_DATA_DIR: appDataDir,
      },
    });

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
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByLabel('Open system logs')).toBeVisible();
    await use(page);
  },
});

export { expect };
