import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { test, expect, Env } from './fixtures/app.fixture';
import { apiBase, seedWorldCupDataset } from './helpers/agents-api';
import { startLlmStub } from './helpers/llm-stub';
import { runQuestionOk } from './helpers/runs-api';
import { scenarioStep } from './support/demo-captions';
import {
  COPILOT_NOT_SIGNED_IN,
  copilotSignedInMessage,
  copilotToolAsTextNudge,
} from '../../backend/src/mastra/copilot/copilot-contracts';

/*
 * Mirrors the "GitHub Copilot connection" Feature in
 * specs/capabilities/llm-settings/spec.md (BA-159, story 1.10.3). The backend
 * spawns helpers/copilot-runtime-stub.js in place of the real Copilot runtime
 * through the SDK's own COPILOT_CLI_PATH variable; the stub's behaviour comes
 * from COPILOT_STUB_* variables and it logs every request it receives, so a
 * test can check what the app sent to Copilot. The message texts are imported
 * from the backend's copilot-contracts.ts, so a reworded message cannot drift.
 */

const STUB = path.join(__dirname, 'helpers', 'copilot-runtime-stub.js');
const SEAT_MODELS = ['claude-sonnet-5.5', 'gpt-5-mini'];
const FREE_SEAT_MESSAGE =
  'Your Copilot plan lists no models to choose — leave the model as auto.';
const FINAL_ANSWER =
  'France won the 2018 World Cup final, beating Croatia 4–2 in Moscow.';
const TOOL_SQL = 'SELECT count(*) AS matches FROM world_cup.matches';

interface StubLogEntry {
  method: string;
  sessionId?: string;
  model?: string | null;
  reasoningEffort?: string | null;
  tools?: string[];
  prompt?: string;
  structured?: boolean;
  result?: unknown;
}

/** The env that makes the backend spawn the stub, plus a fresh log file. */
function stubEnv(
  appDataDir: string,
  overrides: Env = {},
): { env: Env; log: () => StubLogEntry[] } {
  const logFile = path.join(appDataDir, 'copilot-stub.log');
  return {
    env: {
      COPILOT_CLI_PATH: STUB,
      COPILOT_STUB_LOGIN: 'octo-dev',
      COPILOT_STUB_LOG: logFile,
      ...overrides,
    },
    log: () =>
      fs.existsSync(logFile)
        ? fs
            .readFileSync(logFile, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as StubLogEntry)
        : [],
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
const copilotStatus = (page: Page) => page.getByTestId('llm-copilot-status');
const modelField = (page: Page) => page.getByLabel('Model', { exact: true });
const loadModelsButton = (page: Page) => page.getByTestId('llm-load-models');
const modelOptions = (page: Page) =>
  page.getByTestId('llm-model-options').getByRole('option');
const testButton = (page: Page) =>
  page.getByRole('button', { name: 'Test connection' });
const saveButton = (page: Page) =>
  page.getByRole('button', { name: 'Save connection' });

async function chooseCopilot(page: Page): Promise<void> {
  await openLlmConfiguration(page);
  await providerSelect(page).selectOption('copilot');
}

/** Saves a configuration through the API, untested (R55 for copilot). */
async function putSettings(
  page: Page,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await page.request.put(`${apiBase(page)}/llm/settings`, {
    data,
  });
  expect(response.ok(), `PUT /llm/settings → ${response.status()}`).toBe(true);
  const body = (await response.json()) as { ok: boolean; message: string };
  expect(body.ok, body.message).toBe(true);
}

test('shows who is signed in to GitHub', async ({ appDataDir, launchApp }) => {
  const { env } = stubEnv(appDataDir);
  const { page } = await launchApp(appDataDir, env);

  await chooseCopilot(page);
  await expect(copilotStatus(page)).toHaveText(
    copilotSignedInMessage('octo-dev'),
  );
  await expect(page.getByLabel('Base URL')).toHaveCount(0);
  await expect(page.getByTestId('llm-api-key')).toHaveCount(0);
  await expect(page.getByTestId('llm-api-style')).toHaveCount(0);
  await expect(modelField(page)).toHaveAttribute('placeholder', 'auto');
});

test(
  'configures GitHub Copilot by testing and saving with model auto',
  { tag: ['@demo', '@story-1.10.3'] },
  async ({ appDataDir, launchApp }, testInfo) => {
    const { env, log } = stubEnv(appDataDir);
    const { page } = await launchApp(appDataDir, env);

    await scenarioStep(page, 'Given this machine is signed in to GitHub with a Copilot seat', async () => {
      await openLlmConfiguration(page);
    });
    await scenarioStep(page, 'When I choose the provider "GitHub Copilot" and leave the model empty', async () => {
      await providerSelect(page).selectOption('copilot');
      await expect(copilotStatus(page)).toHaveText(
        copilotSignedInMessage('octo-dev'),
      );
      await expect(modelField(page)).toHaveValue('');
    });
    await scenarioStep(page, 'And I click "Test connection"', async () => {
      await testButton(page).click();
    });
    await scenarioStep(page, 'Then I see a message starting "Connection successful — copilot/auto"', async () => {
      await expect(
        page.getByText(/Connection successful — copilot\/auto replied "ok" in \d+ms/),
      ).toBeVisible();
      // The probe went to the runtime with no model, so Copilot chose (R56),
      // and as structured output (R58).
      const probe = log().find((e) => e.method === 'session.create');
      expect(probe?.model).toBeNull();
      expect(log().some((e) => e.method === 'session.send' && e.structured)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('llm-copilot-tested.png') });
    });
    await scenarioStep(page, 'When I click "Save connection"', async () => {
      await saveButton(page).click();
    });
    await scenarioStep(page, 'Then I see "Configuration saved"', async () => {
      await expect(page.getByText('Configuration saved', { exact: true })).toBeVisible();
    });

    // The stored settings hold the provider and model only (R55).
    const settings = await (
      await page.request.get(`${apiBase(page)}/llm/settings`)
    ).json();
    expect(settings).toMatchObject({ provider: 'copilot', model: 'auto' });
    expect(settings.apiKeyMasked).toBeNull();
  },
);

test('says how to sign in when no GitHub login is found', async ({
  appDataDir,
  launchApp,
}) => {
  const { env } = stubEnv(appDataDir, { COPILOT_STUB_LOGIN: '' });
  const { page } = await launchApp(appDataDir, env);

  await chooseCopilot(page);
  await expect(copilotStatus(page)).toHaveText(COPILOT_NOT_SIGNED_IN);

  await testButton(page).click();
  await expect(
    page
      .getByRole('region', { name: 'Notifications' })
      .getByText(COPILOT_NOT_SIGNED_IN),
  ).toBeVisible();
  // Load models needs a signed-in seat (R59).
  await expect(loadModelsButton(page)).toBeDisabled();
  await expect(saveButton(page)).toBeDisabled();
});

test("lists the seat's models", async ({ appDataDir, launchApp }) => {
  const { env, log } = stubEnv(appDataDir, {
    COPILOT_STUB_MODELS: SEAT_MODELS.join(','),
  });
  const { page } = await launchApp(appDataDir, env);

  await chooseCopilot(page);
  await loadModelsButton(page).click();
  await expect(modelOptions(page)).toHaveText(SEAT_MODELS);
  expect(log().filter((e) => e.method === 'models.list')).toHaveLength(1);

  await modelOptions(page).filter({ hasText: 'gpt-5-mini' }).click();
  await expect(modelField(page)).toHaveValue('gpt-5-mini');

  // A named model goes through to Copilot on the test (R56).
  await testButton(page).click();
  await expect(
    page.getByText(/Connection successful — copilot\/gpt-5-mini replied "ok"/),
  ).toBeVisible();
  expect(log().find((e) => e.method === 'session.create')?.model).toBe(
    'gpt-5-mini',
  );
});

test('a Copilot Free seat lists no models', async ({
  appDataDir,
  launchApp,
}) => {
  const { env } = stubEnv(appDataDir, { COPILOT_STUB_MODELS: '' });
  const { page } = await launchApp(appDataDir, env);

  await chooseCopilot(page);
  await loadModelsButton(page).click();
  await expect(page.getByText(FREE_SEAT_MESSAGE)).toBeVisible();
  await expect(modelOptions(page)).toHaveCount(0);
});

test('a run of Questions to Insights v2 runs on GitHub Copilot', async ({
  appDataDir,
  launchApp,
}) => {
  const { env, log } = stubEnv(appDataDir, {
    COPILOT_STUB_ANSWER: FINAL_ANSWER,
    COPILOT_STUB_DELTA_MS: '150',
    COPILOT_STUB_TOOL_CALL: JSON.stringify({
      name: 'run_readonly_sql',
      arguments: { sql: TOOL_SQL, rationale: 'Count the matches' },
    }),
  });
  const { page } = await launchApp(appDataDir, env);
  await seedWorldCupDataset(page);
  await putSettings(page, { provider: 'copilot', model: 'auto' });
  await page.reload();

  const question = 'Who won the 2018 World Cup final and what was the score?';
  const result = await runQuestionOk(page, question);

  // The answer streams (R62): it arrives in several pieces, not one.
  expect(result.events.filter((e) => e.type === 'text').length).toBeGreaterThan(1);
  expect(result.text).toContain(FINAL_ANSWER);
  expect(result.run?.status).toBe('success');

  // The thinking steps show the app's own tool call, run by the app (R61):
  // the SQL ran against the World Cup database and returned a row.
  expect(
    result.events.some((e) => e.type === 'tool' && JSON.stringify(e).includes('run_readonly_sql')),
  ).toBe(true);
  const toolResult = log().find(
    (e) => e.method === 'session.tools.handlePendingToolCall',
  );
  expect(String(toolResult?.result)).toContain('matches');
  expect(String(toolResult?.result)).not.toMatch(/"error"/i);

  // The run's turn offered the app's tools (R61).
  const turn = log().find(
    (e) => e.method === 'session.create' && e.tools?.includes('run_readonly_sql'),
  );
  expect(turn).toBeDefined();
  expect(
    log().some((e) => e.method === 'session.send' && e.prompt?.includes(question)),
  ).toBe(true);
});

test('a tool call written as text is never shown in a run', async ({
  appDataDir,
  launchApp,
}) => {
  const toolArguments = { sql: TOOL_SQL, rationale: 'Count the matches' };
  const { env, log } = stubEnv(appDataDir, {
    COPILOT_STUB_ANSWER: FINAL_ANSWER,
    COPILOT_STUB_TOOL_CALL: JSON.stringify({
      name: 'run_readonly_sql',
      arguments: toolArguments,
    }),
    COPILOT_STUB_TOOL_AS_TEXT: '1',
  });
  const { page } = await launchApp(appDataDir, env);
  await seedWorldCupDataset(page);
  await putSettings(page, { provider: 'copilot', model: 'auto' });
  await page.reload();

  const result = await runQuestionOk(page, 'How many matches are in the data?');

  // The model first wrote the tool's arguments as its message; the app asked
  // once for the real call (R66), so the answer follows a real tool run.
  expect(result.text).toContain(FINAL_ANSWER);
  expect(
    result.events.some((e) => e.type === 'tool' && JSON.stringify(e).includes('run_readonly_sql')),
  ).toBe(true);
  expect(result.text).not.toContain('Count the matches"}');
  expect(result.text).not.toContain('{"sql":');
  const sends = log().filter((e) => e.method === 'session.send');
  expect(
    sends.some(
      (e) => e.prompt === copilotToolAsTextNudge('run_readonly_sql'),
    ),
  ).toBe(true);
});

test('switching from GitHub Copilot to OpenAI asks for an API key', async ({
  appDataDir,
  launchApp,
}) => {
  const { env } = stubEnv(appDataDir);
  const { page } = await launchApp(appDataDir, env);
  // A key stored before switching to Copilot is removed on save (R55). The
  // save tests the endpoint first, so it goes to a local OpenAI-style stub.
  const endpoint = await startLlmStub({ pathPrefix: '/v1' });
  try {
    await putSettings(page, {
      provider: 'custom',
      apiStyle: 'openai',
      baseUrl: `${endpoint.baseUrl}/v1`,
      model: 'qwen3-8b',
      apiKey: 'sk-before-copilot',
    });
  } finally {
    await endpoint.close();
  }
  const before = await (await page.request.get(`${apiBase(page)}/llm/settings`)).json();
  expect(before.apiKeyMasked).toMatch(/ilot$/);
  await putSettings(page, { provider: 'copilot', model: 'auto' });
  await page.reload();

  await openLlmConfiguration(page);
  await expect(providerSelect(page)).toHaveValue('copilot');
  await providerSelect(page).selectOption('openai');
  await modelField(page).fill('gpt-4o-mini');
  await expect(page.getByTestId('llm-api-key')).toHaveValue('');
  await testButton(page).click();
  await expect(
    page.getByText('apiKey is required — none stored yet'),
  ).toBeVisible();
});
