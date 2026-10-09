import fs from 'node:fs';
import http from 'node:http';
import { AddressInfo, createServer } from 'node:net';
import path from 'node:path';
import { Page } from '@playwright/test';
import { test, expect, desktopOnly, webOnly } from './fixtures/app.fixture';

// Mirrors the "Developer settings" Feature in
// specs/capabilities/developer-settings/spec.md.

async function openDeveloperSettings(page: Page): Promise<void> {
  await page.getByTitle('Settings').click();
  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'Developer' })
    .click();
  await expect(page.getByRole('heading', { name: 'Developer' })).toBeVisible();
}

const observabilitySwitch = (page: Page) =>
  page.getByRole('switch', { name: 'Developer observability' });
const saveButton = (page: Page) =>
  page.getByRole('button', { name: 'Save', exact: true });
const restartNotice = (page: Page) =>
  page.getByTestId('developer-restart-notice');

/** A free local port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test('developer observability is off by default', async ({
  appDataDir,
  page,
}) => {
  await openDeveloperSettings(page);

  await expect(observabilitySwitch(page)).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(
    page.getByLabel('Phoenix endpoint', { exact: true }),
  ).toHaveValue('http://localhost:6006');
  await expect(page.getByLabel('OTLP endpoint', { exact: true })).toHaveValue(
    'http://localhost:4318',
  );
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.getByText('Restart to apply')).toHaveCount(0);
  expect(fs.existsSync(path.join(appDataDir, 'developer-settings.json'))).toBe(
    false,
  );
});

/** Turns observability on, saves, and waits for the restart notice. */
async function saveObservabilityOn(page: Page): Promise<void> {
  await openDeveloperSettings(page);
  await observabilitySwitch(page).click();
  await saveButton(page).click();
  await expect(
    page.getByText('Developer settings saved — restart to apply'),
  ).toBeVisible();
  await expect(restartNotice(page)).toContainText('Restart to apply');
}

test('turning observability on asks for a restart', async ({
  appDataDir,
  page,
}) => {
  await saveObservabilityOn(page);
  await expect(restartNotice(page)).toContainText(
    'The running backend has developer observability off',
  );

  const saved = JSON.parse(
    fs.readFileSync(path.join(appDataDir, 'developer-settings.json'), 'utf8'),
  );
  expect(saved).toMatchObject({
    observabilityEnabled: true,
    phoenixEndpoint: 'http://localhost:6006',
    otlpEndpoint: 'http://localhost:4318',
  });
});

test.describe('desktop app', () => {
  desktopOnly(
    'the "Restart backend" button respawns the Electron-managed backend',
  );

  test('the desktop app offers to restart the backend, and restarting applies it', async ({
    page,
  }) => {
    await saveObservabilityOn(page);
    const restart = restartNotice(page).getByRole('button', {
      name: 'Restart backend',
    });
    await expect(restart).toBeVisible();

    await restart.click();
    await expect(restartNotice(page)).toHaveCount(0, { timeout: 45_000 });
    await expect(observabilitySwitch(page)).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

test.describe('browser', () => {
  webOnly('the CLI hint replaces the "Restart backend" button');

  test('in a browser, the notice asks me to restart the CLI', async ({
    page,
  }) => {
    await saveObservabilityOn(page);
    await expect(restartNotice(page)).toContainText('Restart the CLI to apply');
    await expect(
      page.getByRole('button', { name: 'Restart backend' }),
    ).toHaveCount(0);
  });

  test('restarting the CLI applies the saved setting', async ({
    app,
    page,
  }) => {
    await saveObservabilityOn(page);
    await app.restartCli();
    await openDeveloperSettings(page);
    await expect(observabilitySwitch(page)).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(restartNotice(page)).toHaveCount(0);
  });
});

test('turning it back off before restarting needs no restart', async ({
  page,
}) => {
  await openDeveloperSettings(page);

  await observabilitySwitch(page).click();
  await saveButton(page).click();
  await expect(restartNotice(page)).toBeVisible();

  await observabilitySwitch(page).click();
  await saveButton(page).click();
  await expect(
    page.getByText('Developer settings saved', { exact: true }),
  ).toBeVisible();
  await expect(restartNotice(page)).toHaveCount(0);
});

test('rejects an endpoint that is not a URL', async ({ page }) => {
  await openDeveloperSettings(page);

  await page.getByLabel('OTLP endpoint', { exact: true }).fill('not a url');
  await expect(
    page.getByText('OTLP endpoint must be an http(s) URL'),
  ).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
});

test('tests an endpoint that accepts OTLP traces', async ({ page }) => {
  const receiver = http.createServer((request, response) => {
    request.resume();
    response.statusCode =
      request.method === 'POST' && request.url === '/v1/traces' ? 200 : 404;
    response.end();
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, '127.0.0.1', resolve),
  );
  const { port } = receiver.address() as AddressInfo;

  try {
    await openDeveloperSettings(page);
    await page
      .getByLabel('Phoenix endpoint', { exact: true })
      .fill(`http://127.0.0.1:${port}`);
    await page.getByRole('button', { name: 'Test Phoenix endpoint' }).click();
    const result = page.getByTestId('developer-phoenix-endpoint-result');
    await expect(result).toContainText('Reachable —');
    await expect(result).toHaveClass(/text-on-success-soft/);
  } finally {
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
});

test('tests an endpoint that is not listening', async ({ page }) => {
  const port = await closedPort();
  await openDeveloperSettings(page);

  await page
    .getByLabel('OTLP endpoint', { exact: true })
    .fill(`http://127.0.0.1:${port}`);
  await page.getByRole('button', { name: 'Test OTLP endpoint' }).click();
  const result = page.getByTestId('developer-otlp-endpoint-result');
  await expect(result).toContainText('Unreachable —');
  await expect(result).toHaveClass(/text-on-danger-soft/);

  await page
    .getByLabel('OTLP endpoint', { exact: true })
    .fill(`http://127.0.0.1:${port}/`);
  await expect(result).toHaveCount(0);
});
