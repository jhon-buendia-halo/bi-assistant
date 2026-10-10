import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_SESSION,
  createWorldCupSession,
} from './helpers/app-actions';
import { seedWorldCupDataset } from './helpers/agents-api';
import { LlmStub, startLlmStub, turnRequests } from './helpers/llm-stub';

// Mirrors the "LLM settings" Feature in specs/capabilities/llm-settings/spec.md
// (the scenarios that need no real provider), against a local stub of the
// LenAI gateway.

const DEPLOYMENT = 'stub-deployment';
// The fixed secret the backend fell back to before it persisted its own.
const FORMER_DEVELOPMENT_SECRET = 'insecure-dev-secret';
const KEY_UNREADABLE_NOTICE =
  "Your saved API key can't be read because the app secret changed. Enter the key again, test and save.";

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
const effortSelect = (page: Page) => page.getByLabel('Reasoning effort');
const keyUnreadableNotice = (page: Page) =>
  page.getByTestId('llm-key-unreadable-notice');

async function testConnection(
  page: Page,
  deployment = DEPLOYMENT,
): Promise<void> {
  await testButton(page).click();
  await expect(
    page.getByText(`Connection successful — lenai/${deployment} replied "ok"`),
  ).toBeVisible();
}

/** Fills a LenAI configuration pointing at the stub, without testing it. */
async function fillLenaiConfiguration(
  page: Page,
  deployment: string,
): Promise<void> {
  await openLlmConfiguration(page);
  await providerSelect(page).selectOption('lenai');
  await deploymentField(page).fill(deployment);
  await baseUrlField(page).fill(stub.baseUrl);
  await apiKeyField(page).fill('sk-effort-0e0e');
}

/** Fills a LenAI configuration pointing at the stub, tests and saves it. */
async function saveLenaiConfiguration(
  page: Page,
  stub: LlmStub,
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

let stub: LlmStub;

test.beforeEach(async () => {
  stub = await startLlmStub();
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

test('offers the effort levels of the chosen model', async ({ page }) => {
  await fillLenaiConfiguration(page, 'gpt-5');

  await expect(effortSelect(page).locator('option')).toHaveText([
    'Minimal',
    'Low',
    'Medium',
    'High',
  ]);
  await expect(effortSelect(page)).toHaveValue('high');

  await deploymentField(page).fill('gpt-4.1');
  await expect(effortSelect(page)).toHaveCount(0);

  await deploymentField(page).fill('my-deployment');
  await expect(effortSelect(page).locator('option')).toHaveText([
    'Low',
    'Medium',
    'High',
  ]);
});

test('tests a reasoning model at its lowest effort', async ({ page }) => {
  await fillLenaiConfiguration(page, 'gpt-5');
  await effortSelect(page).selectOption('medium');

  await testConnection(page, 'gpt-5');
  expect(stub.probes.at(-1)?.reasoningEffort).toBe('minimal');

  // The probe doesn't use the chosen effort, so changing it keeps the test.
  await effortSelect(page).selectOption('low');
  await expect(saveButton(page)).toBeEnabled();
});

test('saves the chosen effort and uses it on the next turn', async ({
  page,
}, testInfo) => {
  await seedWorldCupDataset(page);
  await fillLenaiConfiguration(page, 'gpt-5');
  await testConnection(page, 'gpt-5');
  await effortSelect(page).selectOption('medium');
  await saveButton(page).click();
  await expect(page.getByText('Configuration saved')).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'Datasource Configuration' })
    .click();
  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'LLM Configuration' })
    .click();
  await expect(effortSelect(page)).toHaveValue('medium');
  await page.screenshot({
    path: testInfo.outputPath('llm-effort-picker-gpt-5.png'),
  });

  await createWorldCupSession(page);
  await expect(
    page.getByRole('heading', { name: WORLD_CUP_SESSION }),
  ).toBeVisible();
  const question = 'How many matches were played in 2022?';
  await page.getByPlaceholder('Ask a follow-up question…').fill(question);
  await page.getByLabel('Send message').click();
  await expect.poll(() => turnRequests(stub, question).length).toBeGreaterThan(0);
  expect(turnRequests(stub, question)[0].reasoningEffort).toBe('medium');
});
