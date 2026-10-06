import { Page } from '@playwright/test';
import { test, expect } from './fixtures/electron.fixture';
import { OtlpReceiver, startOtlpReceiver } from './helpers/otlp-receiver';

// Mirrors the "Developer observability export" Feature in
// specs/capabilities/developer-settings/spec.md.

let receiver: OtlpReceiver;

test.beforeEach(async () => {
  receiver = await startOtlpReceiver();
});

test.afterEach(async () => {
  await receiver.close();
});

async function openDeveloperSettings(page: Page): Promise<void> {
  await page.getByTitle('Settings').click();
  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'Developer' })
    .click();
  await expect(page.getByRole('heading', { name: 'Developer' })).toBeVisible();
}

/** Points the OTLP endpoint at the receiver, saves, and restarts the backend. */
async function saveAndRestart(page: Page, observabilityOn: boolean) {
  await openDeveloperSettings(page);
  await page.getByLabel('OTLP endpoint', { exact: true }).fill(receiver.url);
  if (observabilityOn) {
    await page.getByRole('switch', { name: 'Developer observability' }).click();
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const notice = page.getByTestId('developer-restart-notice');
  await notice.getByRole('button', { name: 'Restart backend' }).click();
  await expect(notice).toHaveCount(0, { timeout: 45_000 });
}

async function openLlmConfiguration(page: Page) {
  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'LLM Configuration' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'LLM Configuration' }),
  ).toBeVisible();
}

test('backend traces reach the OTLP endpoint when observability is on', async ({
  page,
}) => {
  await saveAndRestart(page, true);
  await openLlmConfiguration(page);

  await expect
    .poll(() => receiver.received('/v1/traces').length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const traces = receiver.received('/v1/traces');
  expect(traces[0].contentType).toContain('application/x-protobuf');
  const payload = Buffer.concat(traces.map((t) => t.body)).toString('latin1');
  expect(payload).toContain('questions-to-insights');
  expect(payload).toContain('/llm/settings');
});

test('nothing is exported when observability is off', async ({ page }) => {
  await saveAndRestart(page, false);
  await openLlmConfiguration(page);

  // Longer than the trace batch delay (5 s) and the metric interval (10 s).
  await page.waitForTimeout(12_000);
  expect(receiver.requests).toEqual([]);
});
