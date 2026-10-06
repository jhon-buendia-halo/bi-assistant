import { Page } from '@playwright/test';
import { test, expect } from './fixtures/electron.fixture';
import { createWorldCupWorkspace } from './helpers/app-actions';
import { OtlpReceiver, startOtlpReceiver } from './helpers/otlp-receiver';

// Mirrors the "Developer observability export" Feature in
// specs/capabilities/developer-settings/spec.md.

let otlp: OtlpReceiver;
let phoenix: OtlpReceiver;

// "No model is configured" must mean the agent run fails at the model call,
// not that it reaches a real provider with a developer's own key.
const savedOpenAiKey = process.env['OPENAI_API_KEY'];

test.beforeEach(async () => {
  delete process.env['OPENAI_API_KEY'];
  otlp = await startOtlpReceiver();
  phoenix = await startOtlpReceiver();
});

test.afterEach(async () => {
  if (savedOpenAiKey !== undefined) {
    process.env['OPENAI_API_KEY'] = savedOpenAiKey;
  }
  await otlp.close();
  await phoenix.close();
});

async function openDeveloperSettings(page: Page): Promise<void> {
  await page.getByTitle('Settings').click();
  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'Developer' })
    .click();
  await expect(page.getByRole('heading', { name: 'Developer' })).toBeVisible();
}

/** Points both endpoints at the receivers, saves, and restarts the backend. */
async function saveAndRestart(page: Page, observabilityOn: boolean) {
  await openDeveloperSettings(page);
  await page.getByLabel('OTLP endpoint', { exact: true }).fill(otlp.url);
  await page.getByLabel('Phoenix endpoint', { exact: true }).fill(phoenix.url);
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

function payloadOf(receiver: OtlpReceiver, path: string): string {
  return Buffer.concat(receiver.received(path).map((r) => r.body)).toString(
    'latin1',
  );
}

test('backend traces reach the OTLP endpoint when observability is on', async ({
  page,
}) => {
  await saveAndRestart(page, true);
  await openLlmConfiguration(page);

  await expect
    .poll(() => otlp.received('/v1/traces').length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  expect(otlp.received('/v1/traces')[0].contentType).toContain(
    'application/x-protobuf',
  );
  const payload = payloadOf(otlp, '/v1/traces');
  expect(payload).toContain('questions-to-insights');
  expect(payload).toContain('/llm/settings');
});

test('agent runs reach Phoenix when observability is on', async ({ page }) => {
  const sessionId = await createWorldCupWorkspace(page);
  await saveAndRestart(page, true);

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByTestId(`session-${sessionId}`).click();
  await page.getByPlaceholder(/Ask a/).fill('Who won the 2022 World Cup?');
  await page.getByLabel('Send message').click();

  await expect
    .poll(() => payloadOf(phoenix, '/v1/traces'), { timeout: 30_000 })
    .toContain('assistant');
  expect(phoenix.received('/v1/traces')[0].contentType).toContain(
    'application/x-protobuf',
  );
  expect(payloadOf(phoenix, '/v1/traces')).toContain('questions-to-insights');
});

test('nothing is exported when observability is off', async ({ page }) => {
  await saveAndRestart(page, false);
  await openLlmConfiguration(page);

  // Longer than the trace batch delay (5 s) and the metric interval (10 s).
  await page.waitForTimeout(12_000);
  expect(otlp.requests).toEqual([]);
  expect(phoenix.requests).toEqual([]);
});
