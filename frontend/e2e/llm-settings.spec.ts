import fs from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';

// Mirrors the "LLM settings" Feature in specs/capabilities/llm-settings/spec.md
// (the scenarios that need no real provider), against a local stub of the
// LenAI gateway.

const DEPLOYMENT = 'stub-deployment';
// The fixed secret the backend fell back to before it persisted its own.
const FORMER_DEVELOPMENT_SECRET = 'insecure-dev-secret';
const KEY_UNREADABLE_NOTICE =
  "Your saved API key can't be read because the app secret changed. Enter the key again, test and save.";

interface LenaiStub {
  baseUrl: string;
  /** `X-Api-Key` of every chat-completion request, oldest first. */
  apiKeys: string[];
  close(): Promise<void>;
}

/** An OpenAI-compatible gateway that answers the connection probe with `ok`. */
async function startLenaiStub(): Promise<LenaiStub> {
  const apiKeys: string[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      apiKeys.push(String(req.headers['x-api-key'] ?? ''));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: '{"status":"ok"}' },
            },
          ],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    apiKeys,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function openLlmConfiguration(page: Page): Promise<void> {
  await page.getByTitle('Settings').click();
  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'LLM Configuration' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'LLM Configuration' }),
  ).toBeVisible();
}

const providerSelect = (page: Page) => page.getByLabel('Provider');
const deploymentField = (page: Page) => page.getByLabel('Deployment name');
const baseUrlField = (page: Page) => page.getByLabel('Base URL');
const apiKeyField = (page: Page) => page.getByLabel('API key');
const testButton = (page: Page) =>
  page.getByRole('button', { name: 'Test connection' });
const saveButton = (page: Page) =>
  page.getByRole('button', { name: 'Save connection' });
const keyUnreadableNotice = (page: Page) =>
  page.getByTestId('llm-key-unreadable-notice');

async function testConnection(page: Page): Promise<void> {
  await testButton(page).click();
  await expect(
    page.getByText(`Connection successful — lenai/${DEPLOYMENT} replied "ok"`),
  ).toBeVisible();
}

/** Fills a LenAI configuration pointing at the stub, tests and saves it. */
async function saveLenaiConfiguration(
  page: Page,
  stub: LenaiStub,
  apiKey: string,
): Promise<void> {
  await openLlmConfiguration(page);
  await providerSelect(page).selectOption('lenai');
  await deploymentField(page).fill(DEPLOYMENT);
  await baseUrlField(page).fill(stub.baseUrl);
  await apiKeyField(page).fill(apiKey);
  await testConnection(page);
  await saveButton(page).click();
  await expect(page.getByText('Configuration saved')).toBeVisible();
}

let stub: LenaiStub;

test.beforeEach(async () => {
  stub = await startLenaiStub();
});

test.afterEach(async () => {
  await stub.close();
});

test('LenAI needs a deployment name and a base URL', async ({ page }) => {
  await openLlmConfiguration(page);
  await providerSelect(page).selectOption('lenai');

  await expect(deploymentField(page)).toBeVisible();
  await expect(baseUrlField(page)).toBeVisible();
  await expect(testButton(page)).toBeDisabled();
  await deploymentField(page).fill(DEPLOYMENT);
  await expect(testButton(page)).toBeDisabled();
  await baseUrlField(page).fill(stub.baseUrl);
  await expect(testButton(page)).toBeEnabled();
});

test('never shows the stored key', async ({ page }) => {
  await saveLenaiConfiguration(page, stub, 'sk-stored-9f3a');

  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'Datasource Configuration' })
    .click();
  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'LLM Configuration' })
    .click();

  await expect(apiKeyField(page)).toHaveValue('');
  await expect(apiKeyField(page)).toHaveAttribute(
    'placeholder',
    '••••••••9f3a',
  );
});

test('keeps a key saved under the former development secret', async ({
  appDataDir,
  launchApp,
}, testInfo) => {
  // An app that ran before the secret was persisted encrypted with the fixed
  // development secret.
  const before = await launchApp(appDataDir, {
    APP_SECRET: FORMER_DEVELOPMENT_SECRET,
  });
  await saveLenaiConfiguration(before.page, stub, 'sk-legacy-1a2b');
  await before.close();
  expect(fs.existsSync(path.join(appDataDir, '.app-secret'))).toBe(false);

  const after = await launchApp(appDataDir, { APP_SECRET: undefined });
  expect(fs.existsSync(path.join(appDataDir, '.app-secret'))).toBe(true);
  await openLlmConfiguration(after.page);

  await expect(keyUnreadableNotice(after.page)).toHaveCount(0);
  await expect(apiKeyField(after.page)).toHaveAttribute(
    'placeholder',
    '••••••••1a2b',
  );
  await testConnection(after.page);
  expect(stub.apiKeys.at(-1)).toBe('sk-legacy-1a2b');
  await after.page.screenshot({
    path: testInfo.outputPath('llm-key-kept-after-secret-migration.png'),
  });
});

test('asks for the key again when the app secret changed', async ({
  appDataDir,
  launchApp,
}, testInfo) => {
  const before = await launchApp(appDataDir, { APP_SECRET: undefined });
  await saveLenaiConfiguration(before.page, stub, 'sk-first-7c7c');
  await before.close();

  // A different install secret: the saved key can no longer be decrypted.
  fs.writeFileSync(path.join(appDataDir, '.app-secret'), 'f'.repeat(64), {
    mode: 0o600,
  });

  const after = await launchApp(appDataDir, { APP_SECRET: undefined });
  await openLlmConfiguration(after.page);

  await expect(keyUnreadableNotice(after.page)).toHaveText(
    KEY_UNREADABLE_NOTICE,
  );
  await expect(providerSelect(after.page)).toHaveValue('lenai');
  await expect(deploymentField(after.page)).toHaveValue(DEPLOYMENT);
  await expect(baseUrlField(after.page)).toHaveValue(stub.baseUrl);
  await expect(apiKeyField(after.page)).toHaveAttribute('placeholder', 'sk-…');
  await after.page.screenshot({
    path: testInfo.outputPath('llm-key-unreadable-notice.png'),
  });

  await apiKeyField(after.page).fill('sk-second-8d8d');
  await testConnection(after.page);
  await saveButton(after.page).click();
  await expect(after.page.getByText('Configuration saved')).toBeVisible();
  await expect(keyUnreadableNotice(after.page)).toHaveCount(0);
  expect(stub.apiKeys.at(-1)).toBe('sk-second-8d8d');
});
