import http from 'node:http';
import { AddressInfo } from 'node:net';
import { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { apiBase, seedWorldCupDataset } from './helpers/agents-api';
import { runAssistantOk } from './helpers/runs-api';
import {
  LlmStub,
  STUB_ANSWER,
  startLlmStub,
  turnRequests,
} from './helpers/llm-stub';
import {
  AnthropicStub,
  RecordedAnthropicRequest,
  startAnthropicStub,
} from './helpers/anthropic-stub';
import {
  notFoundMessage,
  rejectedKeyMessage,
  unreachableMessage,
} from '../../backend/src/modules/llm/custom-endpoint/messages';

/*
 * Mirrors the "Custom endpoint connection" Feature in
 * specs/capabilities/llm-settings/spec.md (BA-281), against local stub
 * servers that record each request's path, headers and body: the OpenAI
 * style against helpers/llm-stub.ts (served under /v1), the Anthropic style
 * against helpers/anthropic-stub.ts. The message texts are imported from the
 * backend's messages.ts, so a reworded message cannot drift from the test.
 */

const MODEL = 'qwen3-8b';
const MODELS = ['qwen3-8b', 'llama3.1:8b'];
const OPENAI_HINT =
  'Include the version path, e.g. http://127.0.0.1:8317/v1; requests use <base URL>/chat/completions.';

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

/** Leaves LLM Configuration and comes back, so the form reloads. */
async function reopenLlmConfiguration(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Settings navigation' });
  await nav.getByRole('button', { name: 'Datasource Configuration' }).click();
  await nav.getByRole('button', { name: 'LLM Configuration' }).click();
  await expect(
    page.getByRole('heading', { name: 'LLM Configuration' }),
  ).toBeVisible();
}

const providerSelect = (page: Page) => page.getByLabel('Provider');
const apiStyleSelect = (page: Page) => page.getByTestId('llm-api-style');
const baseUrlField = (page: Page) => page.getByLabel('Base URL');
const apiKeyField = (page: Page) => page.getByLabel('API key (optional)');
const modelField = (page: Page) => page.getByLabel('Model', { exact: true });
const loadModelsButton = (page: Page) => page.getByTestId('llm-load-models');
const modelOptions = (page: Page) =>
  page.getByTestId('llm-model-options').getByRole('option');
const testButton = (page: Page) =>
  page.getByRole('button', { name: 'Test connection' });
const saveButton = (page: Page) =>
  page.getByRole('button', { name: 'Save connection' });

/** R15: the pass names the route and ends with the latency. */
const passText = (model: string) => {
  const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `Connection successful — custom/${escaped} replied "ok" in \\d+ms`,
  );
};

/** Chooses Custom endpoint (OpenAI-compatible) and fills its fields. */
async function fillCustomEndpoint(
  page: Page,
  baseUrl: string,
  model: string,
  apiKey = '',
): Promise<void> {
  await openLlmConfiguration(page);
  await providerSelect(page).selectOption('custom');
  await apiStyleSelect(page).selectOption('openai');
  await baseUrlField(page).fill(baseUrl);
  await apiKeyField(page).fill(apiKey);
  await modelField(page).fill(model);
}

/** Saves a custom endpoint configuration through the API, untested. */
async function saveCustomSettings(
  page: Page,
  baseUrl: string,
  model: string,
): Promise<void> {
  const response = await page.request.put(`${apiBase(page)}/llm/settings`, {
    data: { provider: 'custom', apiStyle: 'openai', baseUrl, model },
  });
  expect(response.ok(), `PUT /llm/settings → ${response.status()}`).toBe(true);
  const body = (await response.json()) as { ok: boolean; message: string };
  expect(body.ok, body.message).toBe(true);
}

/** A loopback port nothing listens on (bound, then released). */
async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Requests the stub received under the endpoint's `/v1` path. */
const endpointCalls = (stub: LlmStub) =>
  stub.calls.filter((call) => call.path.startsWith('/v1/'));

test.describe('OpenAI-compatible', () => {
  let stub: LlmStub;
  /** The stub's OpenAI-compatible base URL, version path included. */
  let endpoint: string;

  test.beforeEach(async () => {
    stub = await startLlmStub({ pathPrefix: '/v1', models: MODELS });
    endpoint = `${stub.baseUrl}/v1`;
  });

  test.afterEach(async () => {
    await stub.close();
  });

  test('configures an OpenAI-compatible endpoint by loading models, testing and saving', async ({
    page,
  }, testInfo) => {
    await openLlmConfiguration(page);
    await providerSelect(page).selectOption('custom');
    await expect(apiStyleSelect(page)).toHaveValue('openai');
    await expect(page.getByText(OPENAI_HINT)).toBeVisible();

    await baseUrlField(page).fill(endpoint);
    await apiKeyField(page).fill('sk-custom-4c5d');
    await loadModelsButton(page).click();
    await expect(modelOptions(page)).toHaveText(MODELS);
    const listCall = stub.calls.find(
      (call) => call.method === 'GET' && call.path === '/v1/models',
    );
    expect(listCall?.authorization).toBe('Bearer sk-custom-4c5d');
    // R45: the OpenAI style sends the key only as a bearer token.
    expect(listCall?.xApiKey).toBeUndefined();
    await page.screenshot({
      path: testInfo.outputPath('llm-custom-load-models.png'),
    });

    await modelOptions(page).filter({ hasText: MODEL }).click();
    await expect(modelField(page)).toHaveValue(MODEL);
    await expect(page.getByTestId('llm-model-options')).toHaveCount(0);

    await testButton(page).click();
    await expect(page.getByText(passText(MODEL))).toBeVisible();
    expect(stub.probes.at(-1)?.path).toBe('/v1/chat/completions');
    expect(stub.probes.at(-1)?.model).toBe(MODEL);
    const probeCall = stub.calls.find(
      (call) => call.method === 'POST' && call.path === '/v1/chat/completions',
    );
    expect(probeCall?.authorization).toBe('Bearer sk-custom-4c5d');
    expect(probeCall?.xApiKey).toBeUndefined();

    await saveButton(page).click();
    await expect(page.getByText('Configuration saved')).toBeVisible();

    await reopenLlmConfiguration(page);
    await expect(providerSelect(page)).toHaveValue('custom');
    await expect(apiStyleSelect(page)).toHaveValue('openai');
    await expect(baseUrlField(page)).toHaveValue(endpoint);
    await expect(modelField(page)).toHaveValue(MODEL);
    await expect(apiKeyField(page)).toHaveValue('');
    await expect(apiKeyField(page)).toHaveAttribute(
      'placeholder',
      '••••••••4c5d',
    );
  });

  test('a run of the Assistant runs on the custom endpoint', async ({ page }) => {
    await seedWorldCupDataset(page);
    await saveCustomSettings(page, endpoint, MODEL);
    await page.reload();

    const question = 'How many matches were played in 2022?';
    const result = await runAssistantOk(page, question);
    expect(turnRequests(stub, question).length).toBeGreaterThan(0);
    const [turn] = turnRequests(stub, question);
    expect(turn.path).toBe('/v1/chat/completions');
    expect(turn.model).toBe(MODEL);
    expect(result.text).toContain(STUB_ANSWER);
  });

  test('uses an endpoint that needs no key', async ({ page }) => {
    await fillCustomEndpoint(page, endpoint, MODEL);
    await expect(apiKeyField(page)).toHaveValue('');
    await expect(apiKeyField(page)).toHaveAttribute(
      'placeholder',
      'Leave blank if the server needs none',
    );

    await loadModelsButton(page).click();
    await expect(modelOptions(page)).toHaveText(MODELS);
    await page.keyboard.press('Escape');

    await testButton(page).click();
    await expect(
      page.getByText(`Connection successful — custom/`),
    ).toBeVisible();
    const calls = endpointCalls(stub);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.authorization, `${call.method} ${call.path}`).toBeUndefined();
      expect(call.xApiKey, `${call.method} ${call.path}`).toBeUndefined();
    }

    await saveButton(page).click();
    await expect(page.getByText('Configuration saved')).toBeVisible();
  });

  test('reports an unreachable endpoint', async ({ page }) => {
    const port = await closedPort();
    await fillCustomEndpoint(page, `http://127.0.0.1:${port}/v1`, MODEL);

    await testButton(page).click();
    await expect(
      page.getByText(unreachableMessage(`127.0.0.1:${port}`)),
    ).toBeVisible();
    await expect(saveButton(page)).toBeDisabled();
  });

  test('points at the version path when the endpoint answers 404', async ({
    page,
  }) => {
    // The stub serves only /v1, so the base URL without it answers 404.
    await fillCustomEndpoint(page, stub.baseUrl, MODEL);

    await testButton(page).click();
    await expect(
      page.getByText(notFoundMessage(`${stub.baseUrl}/chat/completions`)),
    ).toBeVisible();
    await expect(saveButton(page)).toBeDisabled();
    expect(stub.calls.at(-1)?.path).toBe('/chat/completions');
    expect(stub.probes).toHaveLength(0);
  });

  test("never sends another provider's key to a custom endpoint", async ({
    page,
  }) => {
    const response = await page.request.put(`${apiBase(page)}/llm/settings`, {
      data: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'sk-openai-1f1f',
      },
    });
    expect(response.ok()).toBe(true);
    await page.reload();

    await fillCustomEndpoint(page, endpoint, MODEL);
    await testButton(page).click();
    await expect(
      page.getByText(`Connection successful — custom/${MODEL}`),
    ).toBeVisible();
    const calls = endpointCalls(stub);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.authorization, `${call.method} ${call.path}`).toBeUndefined();
      expect(call.xApiKey, `${call.method} ${call.path}`).toBeUndefined();
    }
  });
});

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

  test('configures an Anthropic-compatible endpoint by loading models, testing and saving, then runs on it', async ({
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

    // A run goes to <root>/v1/messages with the saved model and key.
    stub.reply(ANSWER);
    const question = 'How many matches were played in 2022?';
    const result = await runAssistantOk(page, question);
    expect(result.text).toContain(ANSWER);

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
