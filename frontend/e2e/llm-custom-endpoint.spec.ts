import http from 'node:http';
import { AddressInfo } from 'node:net';
import { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { createWorldCupSession, openSessions } from './helpers/app-actions';
import { apiBase, seedWorldCupDataset } from './helpers/agents-api';
import {
  LlmStub,
  STUB_ANSWER,
  startLlmStub,
  turnRequests,
} from './helpers/llm-stub';
import {
  notFoundMessage,
  unreachableMessage,
} from '../../backend/src/modules/llm/custom-endpoint/messages';

/*
 * Mirrors the "Custom endpoint connection" Feature in
 * specs/capabilities/llm-settings/spec.md (BA-281), against a local stub
 * server that records each request's path and headers.
 *
 * ASSUMPTIONS TO CONFIRM AT INTEGRATION (drafted before the UI and the
 * backend units merged; type-checked only, never run):
 * - The LLM Configuration form follows specs/system/ui.md 4.9: the provider
 *   option value is `custom`; the API style select (`llm-api-style`) has the
 *   option values `openai` / `anthropic`; the fields are labelled "Base URL",
 *   "API key (optional)" and "Model" (exact); "Load models" is
 *   `llm-load-models`, and its list `llm-model-options` holds one
 *   `role="option"` per model id.
 * - The OpenAI-style probe (R49) first sends a `response_format` (strict JSON
 *   schema), so the stub answers it as a connection test with
 *   `{"status":"ok"}`, and the probe sends the model in the body's `model`.
 * - The pass toast contains `Connection successful — custom/<model> replied
 *   "ok"` (the latency follows it, R15).
 * - The model list is `GET <base URL>/models` (R45, R48), answered by the
 *   stub's `models`. The stub serves only paths under `/v1` here, so a base
 *   URL without `/v1` gets 404 from it.
 * - `PUT /llm/settings` saves a custom configuration without a test, like the
 *   LenAI seed in helpers/agents-api.ts.
 * - The composer chip shows `<model> · <host:port>` (R53, `endpointHost`).
 * - The message texts are imported from the backend's messages.ts; Playwright
 *   transpiles that plain module across the frontend/backend boundary.
 * - Not covered here: the Anthropic-compatible scenarios (unit 17 adds them
 *   under the describe block below), "Passes the test on a server without
 *   strict JSON-schema support", "Reports a rejected key" and "Reports a model
 *   list that times out" (they need stub modes not built yet).
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

test.describe('OpenAI-compatible', () => {
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

  test('a chat turn runs on the custom endpoint', async ({ page }) => {
    await seedWorldCupDataset(page);
    await saveCustomSettings(page, endpoint, MODEL);
    await page.reload();

    await openSessions(page);
    await page
      .locator('header')
      .getByRole('button', { name: 'Start New Conversation' })
      .click();
    await expect(
      page.getByText(`${MODEL} · ${new URL(stub.baseUrl).host}`),
    ).toBeVisible();

    await createWorldCupSession(page);
    const question = 'How many matches were played in 2022?';
    await page.getByPlaceholder('Ask a follow-up question…').fill(question);
    await page.getByLabel('Send message').click();
    await expect
      .poll(() => turnRequests(stub, question).length)
      .toBeGreaterThan(0);
    const [turn] = turnRequests(stub, question);
    expect(turn.path).toBe('/v1/chat/completions');
    expect(turn.model).toBe(MODEL);
    await expect(page.getByText(STUB_ANSWER)).toBeVisible();
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
  // Unit 17 (BA-281) adds the Anthropic-compatible scenarios here:
  // "Configures an Anthropic-compatible endpoint by loading models, testing
  // and saving" and "Removes trailing slashes and accepts /v1 in the
  // Anthropic style".
});
