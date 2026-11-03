import { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_SESSION,
  createWorldCupSession,
  openSessions,
} from './helpers/app-actions';
import { seedWorldCupDataset } from './helpers/agents-api';
import {
  AnthropicStub,
  RecordedAnthropicRequest,
  startAnthropicStub,
} from './helpers/anthropic-stub';
import { rejectedKeyMessage } from '../../backend/src/modules/llm/custom-endpoint/messages';

// Mirrors the "Custom endpoint connection" Feature in
// specs/capabilities/llm-settings/spec.md, against local stub servers that
// record each request's path, headers and body.

test.describe('Anthropic-compatible', () => {
  const MODEL = 'claude-sonnet-5-5';
  const KEY = 'sk-anthropic-4c4c';
  const ANSWER = 'The Anthropic-compatible stub answered this question.';
  const ANTHROPIC_HINT =
    'Server root, e.g. http://127.0.0.1:8317; requests use <base URL>/v1/messages.';

  let stub: AnthropicStub;

  test.beforeEach(async () => {
    stub = await startAnthropicStub();
    stub.setModels([MODEL]);
  });

  test.afterEach(async () => {
    await stub.close();
  });

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

  const apiStyleSelect = (page: Page) => page.getByTestId('llm-api-style');
  const baseUrlField = (page: Page) => page.getByLabel('Base URL');
  const apiKeyField = (page: Page) => page.getByLabel('API key (optional)');
  const modelField = (page: Page) => page.getByLabel('Model', { exact: true });
  const loadModelsButton = (page: Page) => page.getByTestId('llm-load-models');
  const modelOptions = (page: Page) => page.getByTestId('llm-model-options');
  const testButton = (page: Page) =>
    page.getByRole('button', { name: 'Test connection' });
  const saveButton = (page: Page) =>
    page.getByRole('button', { name: 'Save connection' });
  const passed = (page: Page) =>
    page.getByText(`Connection successful — custom/${MODEL} replied "ok"`);

  /** Chooses Custom endpoint in the Anthropic style and fills the base URL. */
  async function chooseAnthropicStyle(
    page: Page,
    baseUrl: string,
    apiKey?: string,
  ): Promise<void> {
    await openLlmConfiguration(page);
    await page
      .getByLabel('Provider')
      .selectOption({ label: 'Custom endpoint' });
    await apiStyleSelect(page).selectOption({ label: 'Anthropic-compatible' });
    await expect(page.getByText(ANTHROPIC_HINT)).toBeVisible();
    await baseUrlField(page).fill(baseUrl);
    if (apiKey !== undefined) await apiKeyField(page).fill(apiKey);
  }

  /** The requests that reached `/v1/<what>`, oldest first. */
  const requestsTo = (
    what: 'messages' | 'models',
  ): RecordedAnthropicRequest[] =>
    stub.requests.filter((request) => request.path === `/v1/${what}`);

  const probes = (): RecordedAnthropicRequest[] =>
    requestsTo('messages').filter((request) => request.isProbe);

  /** Every request carries the Anthropic version and the key in its style. */
  function expectAnthropicHeaders(
    requests: RecordedAnthropicRequest[],
    key: string | undefined,
  ): void {
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.headers['anthropic-version']).toBe('2023-06-01');
      expect(request.headers['authorization']).toBeUndefined();
      expect(request.headers['x-api-key']).toBe(key);
    }
  }

  test('configures an Anthropic-compatible endpoint by loading models, testing and saving, then chats on it', async ({
    page,
  }, testInfo) => {
    await seedWorldCupDataset(page);
    await chooseAnthropicStyle(page, stub.baseUrl, KEY);

    await loadModelsButton(page).click();
    await expect(modelOptions(page).getByRole('option')).toHaveText([MODEL]);
    expect(requestsTo('models')).toHaveLength(1);
    expectAnthropicHeaders(requestsTo('models'), KEY);

    await modelOptions(page).getByRole('option', { name: MODEL }).click();
    await expect(modelField(page)).toHaveValue(MODEL);
    await expect(modelOptions(page)).toHaveCount(0);

    await testButton(page).click();
    await expect(passed(page)).toBeVisible();
    expectAnthropicHeaders(probes(), KEY);
    expect(probes()[0].body['model']).toBe(MODEL);
    await page.screenshot({
      path: testInfo.outputPath('llm-custom-anthropic-tested.png'),
    });

    await saveButton(page).click();
    await expect(page.getByText('Configuration saved')).toBeVisible();

    // Reopened, the saved configuration keeps its style and masks the key.
    await page
      .getByRole('navigation', { name: 'Settings navigation' })
      .getByRole('button', { name: 'Datasource Configuration' })
      .click();
    await page
      .getByRole('navigation', { name: 'Settings navigation' })
      .getByRole('button', { name: 'LLM Configuration' })
      .click();
    await expect(page.getByLabel('Provider')).toHaveValue('custom');
    await expect(apiStyleSelect(page)).toHaveValue('anthropic');
    await expect(baseUrlField(page)).toHaveValue(stub.baseUrl);
    await expect(apiKeyField(page)).toHaveValue('');
    await expect(apiKeyField(page)).toHaveAttribute(
      'placeholder',
      '••••••••4c4c',
    );

    // The composer chip names the model and the root's host (R53).
    await openSessions(page);
    await page
      .locator('header')
      .getByRole('button', { name: 'Start New Conversation' })
      .click();
    await expect(
      page.getByText(`${MODEL} · ${new URL(stub.baseUrl).host}`),
    ).toBeVisible();

    // A chat turn goes to <root>/v1/messages with the saved model and key.
    stub.reply(ANSWER);
    await createWorldCupSession(page);
    await expect(
      page.getByRole('heading', { name: WORLD_CUP_SESSION }),
    ).toBeVisible();
    const question = 'How many matches were played in 2022?';
    await page.getByPlaceholder('Ask a follow-up question…').fill(question);
    await page.getByLabel('Send message').click();
    await expect(page.getByText(ANSWER)).toBeVisible();

    const turns = requestsTo('messages').filter((request) => !request.isProbe);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns[0].body['model']).toBe(MODEL);
    expectAnthropicHeaders(turns, KEY);
  });

  test('sends no x-api-key to an endpoint that needs no key', async ({
    page,
  }) => {
    await chooseAnthropicStyle(page, stub.baseUrl);
    await expect(apiKeyField(page)).toHaveValue('');
    await expect(apiKeyField(page)).toHaveAttribute(
      'placeholder',
      'Leave blank if the server needs none',
    );

    await loadModelsButton(page).click();
    await modelOptions(page).getByRole('option', { name: MODEL }).click();
    await testButton(page).click();
    await expect(passed(page)).toBeVisible();

    expectAnthropicHeaders(requestsTo('models'), undefined);
    expectAnthropicHeaders(probes(), undefined);

    await saveButton(page).click();
    await expect(page.getByText('Configuration saved')).toBeVisible();
  });

  test('removes trailing slashes and accepts /v1', async ({ page }) => {
    await chooseAnthropicStyle(page, `${stub.baseUrl}/v1/`, KEY);
    await modelField(page).fill(MODEL);

    await testButton(page).click();
    await expect(passed(page)).toBeVisible();
    expect(probes().length).toBeGreaterThan(0);
    expect(
      stub.requests.filter((request) => request.path.startsWith('/v1/v1')),
    ).toHaveLength(0);
  });

  test('reports a rejected key', async ({ page }) => {
    stub.respondWith(
      401,
      {},
      {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      },
    );
    await chooseAnthropicStyle(page, stub.baseUrl, 'wrong-key');
    await modelField(page).fill(MODEL);

    await testButton(page).click();
    await expect(page.getByText(rejectedKeyMessage(401))).toBeVisible();
    await expect(saveButton(page)).toBeDisabled();
    // The error text never echoes the key the request carried (R54).
    await expect(page.getByText('wrong-key')).toHaveCount(0);
  });
});
