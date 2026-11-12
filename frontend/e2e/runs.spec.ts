import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Page } from '@playwright/test';
import axe from 'axe-core';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASET,
  WORLD_CUP_SESSION,
  createWorldCupSession,
  followOsTheme,
  openSessions,
} from './helpers/app-actions';
import { apiFetch, apiJson } from './helpers/api';
import { worldCupKey } from './helpers/world-cup-db';
import {
  createUserAgent,
  deleteDataset,
  publishAgent,
  seedDataset,
  seedWorldCupDataset,
} from './helpers/agents-api';
import { saveLenaiSettings } from './helpers/agents-api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  startLlmStub,
  systemTexts,
} from './helpers/llm-stub';
import { scenarioStep } from './support/demo-captions';

/**
 * Mirrors the Feature "Session management" in
 * specs/capabilities/sessions-chat/spec.md: the Runs page and its Past chats
 * tab (R63, R66; roadmap 1.23.21), and the Sessions page, the New
 * conversation screen and its Workflow picker (R1, R46, R63, R64; roadmap
 * 1.14.17, 1.23.6), the Workflow chips of the page header and the Sessions
 * list (R57, R59, R63; roadmap 1.23.6), and the session id in the page
 * header (R62; roadmap 1.14.18). "The conversation and its history survive
 * a restart" is covered by the datasources Feature's World Cup workflow.
 *
 * Several stories add to this file: keep each test as its owner wrote it.
 */

const INTELLIFY_DATASET = 'Intellify RFP API';
const RFP_REQUIREMENT =
  'Load the "Intellify RFP API" sample in Settings → Testing Data first';
const ASSISTANT_DESCRIPTION = 'Answers questions over the datasets you pick.';
const EVIDENCE = path.resolve(__dirname, '../../evidence/1.14.17');
/** Questions to Insights v2 (R61, R64; agents-evals R107, BA-320). */
const V2 = 'Questions to Insights v2';
const V2_DESCRIPTION =
  'A slimmed-down data analyst under construction: answers questions over the datasets you pick using only the core data tools.';

let datasourceId = '';

test.beforeEach(async ({ page }) => {
  // Background: a "World Cup Core" dataset exists.
  datasourceId = await seedWorldCupDataset(page);
});

/** The Past chats tab's list: the old sessions (sessions-chat R63). */
const sessionsList = (page: Page) =>
  page.getByRole('navigation', { name: 'Past chats', exact: true });
const nameField = (page: Page) => page.getByPlaceholder('My new session');
const createButton = (page: Page) =>
  page.getByRole('button', { name: /^Create$/ });
const datasetCard = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name}`) });
const workflowField = (page: Page) => page.getByTestId('new-session-workflow');
const workflowList = (page: Page) =>
  page.getByRole('listbox', { name: 'Workflow' });
const workflowOption = (page: Page, name: string) =>
  workflowList(page).getByRole('option').filter({ hasText: name });
const workflowDescription = (page: Page) =>
  page.getByTestId('new-session-workflow-description');
/** The page header's Workflow chip (R57). */
const headerWorkflow = (page: Page) =>
  page.locator('header').getByTestId('session-workflow');

/** The Past chats row of the session named `name`. */
const sessionRow = (page: Page, name: string) =>
  sessionsList(page)
    .getByRole('listitem')
    .filter({
      has: page.getByRole('button', { name: new RegExp(`^${name}`) }),
    });

async function openComposer(page: Page): Promise<void> {
  await openSessions(page);
  await page
    .locator('header')
    .getByRole('button', { name: 'Start New Conversation' })
    .click();
  await expect(nameField(page)).toBeVisible();
}

/** Creates sessions through the API, oldest first. */
async function seedSessions(page: Page, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const { session } = await apiJson<{ session: { id: string } }>(
      page,
      'POST',
      '/sessions',
      { name, datasets: [WORLD_CUP_DATASET] },
    );
    ids.push(session.id);
  }
  return ids;
}

test('create stays disabled until the session has a name and a dataset', async ({
  page,
}) => {
  await openComposer(page);
  await expect(
    page.getByText('Select at least one dataset for this session'),
  ).toBeVisible();
  await expect(createButton(page)).toBeDisabled();

  await nameField(page).fill(WORLD_CUP_SESSION);
  await expect(createButton(page)).toBeDisabled();

  await datasetCard(page, WORLD_CUP_DATASET).click();
  await expect(createButton(page)).toBeEnabled();

  await datasetCard(page, WORLD_CUP_DATASET).click();
  await expect(createButton(page)).toBeDisabled();
});

test('shows guidance when there are no datasets', async ({ page }) => {
  await deleteDataset(page, WORLD_CUP_DATASET);
  await page.reload();
  await openComposer(page);
  await expect(
    page.getByText('No datasets yet — create one in Datasets first.'),
  ).toBeVisible();
});

test('a new session opens on its welcome block', async ({ page }) => {
  await openComposer(page);
  await nameField(page).fill(WORLD_CUP_SESSION);
  await datasetCard(page, WORLD_CUP_DATASET).click();
  await createButton(page).click();

  await expect(
    page.getByText(`Session "${WORLD_CUP_SESSION}" created`),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: WORLD_CUP_SESSION }),
  ).toBeVisible();
  await expect(page.getByText(`${WORLD_CUP_SESSION} is ready`)).toBeVisible();
  await expect(
    page.getByText(`Connected to ${WORLD_CUP_DATASET}.`),
  ).toBeVisible();

  const starter =
    'What data is available here? Summarise the tables and the key metrics.';
  await page.getByRole('button', { name: starter }).click();
  await expect(page.getByPlaceholder('Ask a follow-up question…')).toHaveValue(
    starter,
  );
  // No message has been sent.
  const label = await page
    .locator('header')
    .getByTestId('session-id')
    .getAttribute('aria-label');
  const id = label!.replace('Copy session ID ', '');
  const session = await apiJson<{ messages: unknown[] }>(
    page,
    'GET',
    `/sessions/${id}`,
  );
  expect(session.messages).toHaveLength(0);
});

test('I start an RFP Builder session from New conversation', async ({
  page,
}) => {
  // Given the "Intellify RFP API" sample is loaded: the RFP Builder only
  // needs a dataset of that name to start (sessions-chat R52), so one is
  // saved over the World Cup datasource instead of loading the sample.
  await seedDataset(page, INTELLIFY_DATASET, datasourceId);
  await page.reload();
  await openComposer(page);

  await expect(workflowField(page)).toHaveText(/Assistant/);
  await expect(workflowField(page)).toHaveAccessibleName('Workflow');
  await expect(workflowField(page)).toHaveRole('combobox');
  await expect(workflowDescription(page)).toHaveText(ASSISTANT_DESCRIPTION);
  await expect(
    page.getByText('Select at least one dataset for this session'),
  ).toBeVisible();

  // The Workflow field is a listbox showing each workflow's name and
  // description.
  await workflowField(page).click();
  await expect(workflowList(page)).toBeVisible();
  await expect(workflowField(page)).toHaveAttribute('aria-expanded', 'true');
  const options = workflowList(page).getByRole('option');
  await expect(options.first()).toContainText('Assistant');
  await expect(options.first()).toContainText(ASSISTANT_DESCRIPTION);
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  const rfp = workflowOption(page, 'RFP Builder');
  await expect(rfp).not.toHaveAttribute('aria-disabled', 'true');
  await expect(rfp).not.toContainText(RFP_REQUIREMENT);
  await page.screenshot({
    path: path.join(EVIDENCE, 'new-conversation-agent-picker.png'),
  });

  await rfp.click();
  await expect(workflowList(page)).toHaveCount(0);
  await expect(workflowField(page)).toHaveText(/RFP Builder/);
  const chips = page.getByTestId('new-session-workflow-datasets');
  await expect(chips).toContainText(INTELLIFY_DATASET);
  await expect(
    page.getByText('Select at least one dataset for this session'),
  ).toHaveCount(0);
  await expect(datasetCard(page, WORLD_CUP_DATASET)).toHaveCount(0);
  await expect(createButton(page)).toBeEnabled();
  await expect(createButton(page)).toHaveAttribute(
    'title',
    'Start a session with this workflow',
  );

  await createButton(page).click();
  await expect(page.getByText('Session "RFP Builder" created')).toBeVisible();
  await expect(headerWorkflow(page)).toHaveText('RFP Builder');

  // The Sessions page shows it with its dataset under its name and its
  // workflow as the row's chip (R63).
  await openSessions(page);
  const row = sessionRow(page, 'RFP Builder');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(INTELLIFY_DATASET);
  await expect(row.getByTestId('row-session-workflow')).toHaveText(
    'RFP Builder',
  );
});

test('the Workflow field disables a workflow that cannot start', async ({
  page,
}) => {
  // Given the "Intellify RFP API" sample is not loaded
  await openComposer(page);
  await workflowField(page).click();
  const rfp = workflowOption(page, 'RFP Builder');
  await expect(rfp).toHaveAttribute('aria-disabled', 'true');
  await expect(rfp).toContainText(RFP_REQUIREMENT);
  await page.screenshot({
    path: path.join(EVIDENCE, 'new-conversation-agent-disabled.png'),
  });

  // The Background's World Cup dataset is on PostgreSQL, so the Data
  // Readiness Agent's workflow can be chosen (data-readiness R1-R2).
  await expect(
    workflowOption(page, 'Data Readiness Agent'),
  ).not.toHaveAttribute('aria-disabled', 'true');
  // It cannot be chosen (clicked past Playwright's aria-disabled check).
  await rfp.click({ force: true });
  await expect(workflowField(page)).toHaveText(/Assistant/);
  await expect(workflowDescription(page)).toHaveText(ASSISTANT_DESCRIPTION);
});

test('deletes a session after confirmation', async ({ page }) => {
  // Given a "World Cup analysis" session exists and is open
  await seedSessions(page, [WORLD_CUP_SESSION]);
  await page.reload();
  await openSessions(page);
  await sessionRow(page, WORLD_CUP_SESSION)
    .getByRole('button', { name: new RegExp(`^${WORLD_CUP_SESSION}`) })
    .click();
  await expect(
    page.getByRole('heading', { name: WORLD_CUP_SESSION }),
  ).toBeVisible();

  await openSessions(page);
  let question = '';
  page.once('dialog', (dialog) => {
    question = dialog.message();
    void dialog.accept();
  });
  await page
    .getByRole('button', { name: `Options for ${WORLD_CUP_SESSION}` })
    .click();
  await page.getByRole('button', { name: 'Delete session' }).click();

  await expect(
    page.getByText(`Session "${WORLD_CUP_SESSION}" deleted`),
  ).toBeVisible();
  expect(question).toContain(`Delete “${WORLD_CUP_SESSION}”?`);
  await expect(sessionsList(page)).toBeVisible();
  await expect(sessionRow(page, WORLD_CUP_SESSION)).toHaveCount(0);
});

test('cancelling the delete confirmation keeps the session', async ({
  page,
}) => {
  await seedSessions(page, [WORLD_CUP_SESSION]);
  await page.reload();
  await openSessions(page);
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page
    .getByRole('button', { name: `Options for ${WORLD_CUP_SESSION}` })
    .click();
  await page.getByRole('button', { name: 'Delete session' }).click();

  await expect(sessionRow(page, WORLD_CUP_SESSION)).toHaveCount(1);
  await page.reload();
  await openSessions(page);
  await expect(sessionRow(page, WORLD_CUP_SESSION)).toHaveCount(1);
});

test('the Past chats tab finds a session by name or ID', async ({ page }) => {
  const names = Array.from({ length: 11 }, (_, i) => `Session ${i + 1}`);
  const ids = await seedSessions(page, [...names, 'Cup history']);
  const cupId = ids.at(-1)!;
  await page.reload();
  await openSessions(page);

  // Ten sessions per page, newest activity first.
  const rows = sessionsList(page).getByRole('listitem');
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText('Cup history');
  const pagination = page.getByTestId('sessions-pagination');
  await expect(pagination).toContainText('1–10 of 12');
  await expect(pagination).toContainText('Page 1 of 2');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(rows).toHaveCount(2);
  await expect(pagination).toContainText('11–12 of 12');

  // Each row shows its datasets, its workflow and its id.
  const search = page.getByPlaceholder('Search sessions by name or ID…');
  await search.fill('cup HISTORY');
  await expect(rows).toHaveCount(1);
  await expect(pagination).toContainText('1–1 of 1');
  const row = sessionRow(page, 'Cup history');
  await expect(row).toContainText(WORLD_CUP_DATASET);
  await expect(row.getByTestId('row-session-workflow')).toHaveText(
    'Assistant',
  );
  await expect(row.getByTestId('row-session-id')).toHaveText(
    `ID ${cupId.slice(0, 8)}`,
  );
  await page.screenshot({ path: path.join(EVIDENCE, 'sessions-page.png') });

  await search.fill(cupId.slice(0, 8).toUpperCase());
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Cup history');

  await search.fill('nothing like this');
  await expect(
    page.getByText('No sessions match "nothing like this".'),
  ).toBeVisible();

  await search.fill('');
  await expect(rows).toHaveCount(10);
  await sessionRow(page, 'Cup history')
    .getByRole('button', { name: /^Cup history/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Cup history' }),
  ).toBeVisible();
});

test('I copy the session id to share it', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  const id = await createWorldCupSession(page);

  const button = page.locator('header').getByTestId('session-id');
  await expect(button).toHaveText(`ID ${id.slice(0, 8)}`);
  await expect(button).toHaveAttribute(
    'title',
    `Session ID ${id} (click to copy)`,
  );

  await button.click();
  await expect(page.getByText('Session ID copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id);
});

/** The option names of the open Workflow field, in order. */
async function workflowNames(page: Page): Promise<string[]> {
  // allInnerTexts does not wait: wait for a known option to render first.
  await expect(workflowOption(page, 'RFP Builder')).toBeVisible();
  return (await workflowList(page).getByRole('option').allInnerTexts()).map(
    (text) => text.split('\n')[0].trim(),
  );
}

test('the Workflow field lists the workflows in catalogue order', async ({
  page,
}) => {
  await openComposer(page);
  await workflowField(page).click();
  // Assistant, Questions to Insights v2, the other Official workflows by
  // name, then the user's own agents' workflows (R64; workflows R1).
  expect((await workflowNames(page)).slice(0, 4)).toEqual([
    'Assistant',
    V2,
    'Data Readiness Agent',
    'RFP Builder',
  ]);
  // The Background's World Cup dataset is on PostgreSQL, so the Data
  // Readiness Agent's workflow can be chosen (data-readiness R1-R2).
  await expect(
    workflowOption(page, 'Data Readiness Agent'),
  ).not.toHaveAttribute('aria-disabled', 'true');
});

test('I start a Questions to Insights v2 session from New conversation', async ({
  page,
}) => {
  await openComposer(page);
  await workflowField(page).click();
  await workflowOption(page, V2).click();
  await expect(workflowList(page)).toHaveCount(0);
  await expect(workflowField(page)).toHaveText(new RegExp(V2));
  await expect(workflowDescription(page)).toHaveText(V2_DESCRIPTION);
  // Like the assistant, v2 runs over the datasets the user picks (R64).
  await expect(
    page.getByText('Select at least one dataset for this session'),
  ).toBeVisible();
  await expect(page.getByTestId('new-session-workflow-datasets')).toHaveCount(
    0,
  );
  await expect(createButton(page)).toBeDisabled();

  await datasetCard(page, WORLD_CUP_DATASET).click();
  await nameField(page).fill('V2 check');
  await expect(createButton(page)).toBeEnabled();
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/sessions') && r.request().method() === 'POST',
  );
  await createButton(page).click();
  const response = await created;
  // Create sends the workflow, the name and the picked datasets (R64).
  expect(response.request().postDataJSON()).toEqual({
    workflowId: 'qti-v2-turn',
    name: 'V2 check',
    datasets: [WORLD_CUP_DATASET],
  });
  const body = (await response.json()) as { session: { id: string } };
  await expect(page.getByText('Session "V2 check" created')).toBeVisible();
  await expect(headerWorkflow(page)).toHaveText(V2);

  // The session is bound to v2 over the picked dataset (R61, R65).
  const session = await apiJson<{
    agentKey?: string;
    agentName?: string;
    workflowId?: string;
    datasets: string[];
  }>(page, 'GET', `/sessions/${body.session.id}`);
  expect(session.agentKey).toBe('assistant-v2');
  expect(session.agentName).toBe(V2);
  expect(session.workflowId).toBe('qti-v2-turn');
  expect(session.datasets).toEqual([WORLD_CUP_DATASET]);

  await openSessions(page);
  const row = sessionRow(page, 'V2 check');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('row-session-workflow')).toHaveText(V2);
});

test('Start chat on Questions to Insights v2 opens New conversation with v2 selected', async ({
  page,
}) => {
  const before = await apiJson<{ sessions: unknown[] }>(
    page,
    'GET',
    '/sessions',
  );
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Workflows', exact: true })
    .click();
  await page
    .getByRole('button', { name: `Start chat with ${V2}`, exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'New conversation', exact: true }),
  ).toBeVisible();
  await expect(workflowField(page)).toHaveText(new RegExp(V2));
  await expect(nameField(page)).toBeVisible();
  const after = await apiJson<{ sessions: unknown[] }>(
    page,
    'GET',
    '/sessions',
  );
  expect(after.sessions).toHaveLength(before.sessions.length);
});

// ------------------------------------------ Workflow-first (roadmap 1.23.6)

const HISTORIAN = 'Cup historian';
const V2_STEPS = ['Receive question', 'Load catalog', 'Analyse', 'Wrap up'];

/** Creates and publishes a user agent over World Cup Core; returns its id. */
async function publishHistorian(page: Page): Promise<string> {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    description: 'Answers questions about World Cup history.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  return id;
}

/**
 * Saves a session the way a version before workflows did (sessions-chat
 * R65): straight into the app's SQLite store, with an agent binding and no
 * `workflowId`. The store reads the table on every call, so the running app
 * lists it at once.
 */
function seedPreWorkflowSession(
  appDataDir: string,
  doc: { name: string; datasets: string[]; agentKey: string; agentName: string },
): string {
  const backendRequire = createRequire(
    path.resolve(__dirname, '../../backend/package.json'),
  );
  const Database = backendRequire('better-sqlite3') as new (
    file: string,
  ) => {
    prepare(sql: string): { run(...args: unknown[]): unknown };
    close(): void;
  };
  const db = new Database(path.join(appDataDir, 'app.sqlite'));
  try {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO "sessions" (doc) VALUES (?)').run(
      JSON.stringify({
        id,
        ...doc,
        messages: [],
        createdAt: now,
        updatedAt: now,
      }),
    );
    return id;
  } finally {
    db.close();
  }
}

// The story's main scenario: `scripts/qa.mjs 1.23.6 --fast` records it as
// evidence/1.23.6/demo.webm, captioned with these Gherkin lines.
test(
  'I start a chat from the Workflow field',
  { tag: ['@demo', '@story-1.23.6'] },
  async ({ page }) => {
    await scenarioStep(
      page,
      `Given I have published the agent "${HISTORIAN}" over "${WORLD_CUP_DATASET}"`,
      async () => {
        await publishHistorian(page);
        await page.reload();
      },
    );
    await scenarioStep(page, 'When I click "Sessions" on the rail', async () => {
      await openSessions(page);
    });
    await scenarioStep(page, 'And I click "Start New Conversation"', async () => {
      await page
        .locator('header')
        .getByRole('button', { name: 'Start New Conversation' })
        .click();
      await expect(nameField(page)).toBeVisible();
    });
    await scenarioStep(
      page,
      'Then the "Workflow" field shows "Assistant"',
      async () => {
        await expect(workflowField(page)).toHaveAccessibleName('Workflow');
        await expect(workflowField(page)).toHaveText(/Assistant/);
        await expect(workflowDescription(page)).toHaveText(
          ASSISTANT_DESCRIPTION,
        );
      },
    );
    await scenarioStep(page, 'When I open the "Workflow" field', async () => {
      await workflowField(page).click();
      await expect(workflowList(page)).toBeVisible();
    });
    await scenarioStep(
      page,
      `Then the options are "Assistant", "${V2}", "Data Readiness Agent", "RFP Builder" and "${HISTORIAN}", in that order`,
      async () => {
        await expect(workflowOption(page, HISTORIAN)).toBeVisible();
        expect(await workflowNames(page)).toEqual([
          'Assistant',
          V2,
          'Data Readiness Agent',
          'RFP Builder',
          HISTORIAN,
        ]);
      },
    );
    await scenarioStep(
      page,
      `When I choose "${V2}" in the "Workflow" field`,
      async () => {
        await workflowOption(page, V2).click();
        await expect(workflowList(page)).toHaveCount(0);
        await expect(workflowField(page)).toHaveText(new RegExp(V2));
      },
    );
    await scenarioStep(
      page,
      'And I type "Workflow check" into the session name',
      async () => {
        await nameField(page).fill('Workflow check');
      },
    );
    await scenarioStep(
      page,
      `And I select the "${WORLD_CUP_DATASET}" dataset`,
      async () => {
        await datasetCard(page, WORLD_CUP_DATASET).click();
      },
    );
    await scenarioStep(page, 'And I click "Create"', async () => {
      await createButton(page).click();
      await expect(
        page.getByText('Session "Workflow check" created'),
      ).toBeVisible();
    });
    await scenarioStep(
      page,
      `Then the page header shows "Workflow" and "${V2}"`,
      async () => {
        await expect(
          page.locator('header').getByText('Workflow', { exact: true }),
        ).toBeVisible();
        await expect(headerWorkflow(page)).toHaveText(V2);
      },
    );
    await scenarioStep(
      page,
      'And the workflow bar shows "Receive question", "Load catalog", "Analyse" and "Wrap up"',
      async () => {
        await expect(
          page
            .getByTestId('workflow-bar')
            .getByRole('list', { name: 'Workflow' })
            .getByRole('listitem'),
        ).toHaveText(V2_STEPS.map((title) => new RegExp(title)));
      },
    );
    await scenarioStep(page, 'When I click "Sessions" on the rail', async () => {
      await openSessions(page);
    });
    await scenarioStep(
      page,
      `Then the "Workflow check" row's chip reads "${V2}" with the tooltip "Workflow: ${V2}"`,
      async () => {
        const chip = sessionRow(page, 'Workflow check').getByTestId(
          'row-session-workflow',
        );
        await expect(chip).toHaveText(V2);
        await expect(chip).toHaveAttribute('title', `Workflow: ${V2}`);
      },
    );
  },
);

test("a deleted agent's chat names its workflow as deleted", async ({
  page,
}) => {
  // Given a chat started from the workflow of the published agent
  const id = await publishHistorian(page);
  const { session } = await apiJson<{ session: { id: string } }>(
    page,
    'POST',
    '/sessions',
    { workflowId: `agent:${id}` },
  );
  // And the agent is deleted
  await apiJson(page, 'DELETE', `/agents/${encodeURIComponent(id)}`);
  await page.reload();

  const deleted = `${HISTORIAN} · agent deleted`;
  await openSessions(page);
  const chip = sessionRow(page, HISTORIAN).getByTestId('row-session-workflow');
  await expect(chip).toHaveText(deleted);
  await expect(chip).toHaveAttribute('title', `Workflow: ${deleted}`);

  await sessionRow(page, HISTORIAN)
    .getByRole('button', { name: new RegExp(`^${HISTORIAN}`) })
    .click();
  await expect(page.locator('header').getByTestId('session-id')).toHaveText(
    `ID ${session.id.slice(0, 8)}`,
  );
  await expect(headerWorkflow(page)).toHaveText(deleted);
});

test('a chat saved before workflows names the workflow of its agent', async ({
  appDataDir,
  page,
}) => {
  const id = seedPreWorkflowSession(appDataDir, {
    name: 'Saved RFP chat',
    datasets: [WORLD_CUP_DATASET],
    agentKey: 'rfp',
    agentName: 'RFP Builder',
  });
  await page.reload();

  await openSessions(page);
  const row = sessionRow(page, 'Saved RFP chat');
  await expect(row.getByTestId('row-session-workflow')).toHaveText(
    'RFP Builder',
  );
  await row.getByRole('button', { name: /^Saved RFP chat/ }).click();
  await expect(page.locator('header').getByTestId('session-id')).toHaveText(
    `ID ${id.slice(0, 8)}`,
  );
  await expect(
    page.locator('header').getByText('Workflow', { exact: true }),
  ).toBeVisible();
  await expect(headerWorkflow(page)).toHaveText('RFP Builder');
});

test('the New conversation screen has no detectable accessibility violations in either theme', async ({
  page,
}) => {
  await followOsTheme(page);
  await openComposer(page);
  await workflowField(page).click();
  await expect(workflowOption(page, 'RFP Builder')).toBeVisible();

  await page.addScriptTag({ content: axe.source });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Let the theme's colour transitions finish before axe reads colours.
    await page.waitForTimeout(500);
    const results = await page.evaluate(async () => {
      return (window as unknown as { axe: typeof axe }).axe.run(document);
    });
    expect(results.violations, theme).toEqual([]);
  }
});

// ------------------------------------------------------------------ Runs

/**
 * Feature "Session management", plan 1.24.11: the Runs page lists stored
 * runs and, in its Past chats tab, the old sessions, which open read-only.
 */
const QUESTION = 'Which team scored the most goals?';
const ANSWER = 'Brazil scored the most goals in this data.';
const OLD_QUESTION = 'How many matches were played at each stage?';
const OLD_ANSWER = 'The group stage holds most of the matches.';
const OLD_CHAT = 'Stage counts chat';
const OLD_SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;
const VISUAL_TITLE = 'Matches by stage';
const SKILL_TAG = '<interactive-visuals-skill>';
const SPEC_REPLY = {
  title: VISUAL_TITLE,
  description: 'The group stage is played far more often than any knockout round.',
  spec: {
    spec: 1,
    chart: {
      form: 'bar',
      select: ['stage', 'matches'],
      x: 'stage',
      y: 'matches',
      sort: { by: 'y', dir: 'desc' },
    },
  },
};

test.describe('Runs and Past chats', () => {
  let stub: LlmStub;

  function reply(request: StubRequest): StubReply {
    if (systemTexts(request).some((text) => text.includes(SKILL_TAG))) {
      return { text: JSON.stringify(SPEC_REPLY) };
    }
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const text = typeof lastUser?.content === 'string' ? lastUser.content : '';
    const old = text.includes(OLD_QUESTION);
    if (old && !request.messages.some((m) => m.role === 'tool')) {
      return {
        toolCall: {
          name: 'run_readonly_sql',
          arguments: { sql: OLD_SQL, rationale: 'Count the matches per stage.' },
        },
      };
    }
    return { text: old ? OLD_ANSWER : ANSWER };
  }

  test.beforeEach(async ({ page }) => {
    stub = await startLlmStub();
    stub.reply = reply;
    await saveLenaiSettings(page, stub.baseUrl);
  });

  test.afterEach(async () => {
    await stub.close();
  });

  const rail = (page: Page) =>
    page.getByRole('complementary', { name: 'Navigation rail' });
  const composerBox = (page: Page) =>
    page.getByPlaceholder('Ask a follow-up question…');

  /** A stored run of the Assistant, made through the API. */
  async function seedRun(page: Page): Promise<string> {
    const run = await apiJson<{ id: string }>(
      page,
      'POST',
      '/workflows/agent%3Aassistant/runs',
      { input: { question: QUESTION, datasets: [WORLD_CUP_DATASET] } },
    );
    return run.id;
  }

  /** An old session with a transcript and a visual, made through the API. */
  async function seedOldChat(page: Page): Promise<string> {
    const [id] = await seedSessions(page, [OLD_CHAT]);
    // The streamed turn keeps the SQL result the visual is designed from.
    const turn = await apiFetch(page, 'POST', `/sessions/${id}/messages/stream`, {
      content: OLD_QUESTION,
    });
    expect(turn.ok(), await turn.text()).toBe(true);
    const visual = await apiJson<{ ok: boolean; message: string }>(
      page,
      'POST',
      `/sessions/${id}/visualizations`,
      {},
    );
    expect(visual.ok, visual.message).toBe(true);
    return id;
  }

  test(
    'I find my past runs under Runs and my old chats under Past chats',
    { tag: ['@demo', '@story-1.23.21'] },
    async ({ page }) => {
      let runId = '';
      await scenarioStep(page, 'Given a run and an old chat made earlier', async () => {
        runId = await seedRun(page);
        await seedOldChat(page);
        await page.reload();
      });
      await scenarioStep(page, 'When I open Runs', async () => {
        await rail(page).getByRole('button', { name: 'Runs', exact: true }).click();
      });
      await scenarioStep(page, 'Then I see the run I made earlier', async () => {
        await expect(page.getByTestId('runs-tab-runs')).toHaveAttribute('aria-selected', 'true');
        const row = page.getByTestId(`run-${runId}`);
        await expect(row.getByTestId('row-run-title')).toHaveText(QUESTION);
        await expect(row.getByTestId('row-run-workflow')).toHaveText('Assistant');
        await expect(row.getByTestId('row-run-status')).toHaveText('Done');
      });
      await scenarioStep(page, 'When I open it', async () => {
        await page.getByTestId(`run-${runId}`).getByRole('button').first().click();
      });
      await scenarioStep(page, 'Then I see its input and its answer', async () => {
        await expect(page.getByTestId('run-detail-input')).toContainText(QUESTION);
        await expect(page.getByTestId('run-detail-input')).toContainText(WORLD_CUP_DATASET);
        await expect(page.getByTestId('run-detail-answer')).toContainText(ANSWER);
        await expect(page.getByTestId('run-detail-status')).toHaveText('Run succeeded');
      });
      await scenarioStep(page, 'When I click Run again', async () => {
        await page.getByTestId('run-again').click();
      });
      await scenarioStep(page, 'Then the Assistant opens on Run with the same input', async () => {
        await expect(page.getByTestId('workflow-detail-name')).toHaveText('Assistant');
        await expect(page.getByTestId('workflow-panel-tab-run')).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expect(page.getByTestId('workflow-input-question')).toHaveValue(QUESTION);
        await expect(
          page.getByTestId('workflow-input-datasets').getByRole('button', { name: WORLD_CUP_DATASET }),
        ).toHaveAttribute('aria-pressed', 'true');
      });
      await scenarioStep(page, 'When I open Past chats and open the old chat', async () => {
        await rail(page).getByRole('button', { name: 'Runs', exact: true }).click();
        await page.getByTestId('runs-tab-past-chats').click();
        await sessionRow(page, OLD_CHAT).getByRole('button', { name: /^Stage counts chat/ }).click();
      });
      await scenarioStep(page, 'Then I see the past-chat banner and its transcript', async () => {
        await expect(page.getByTestId('past-chat-banner')).toContainText('This is a past chat');
        await expect(page.getByText(OLD_QUESTION, { exact: true })).toBeVisible();
        await expect(page.getByText(OLD_ANSWER, { exact: true })).toBeVisible();
      });
      await scenarioStep(page, 'And there is no composer', async () => {
        await expect(composerBox(page)).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Send message' })).toHaveCount(0);
      });
      await scenarioStep(page, 'When I open its visual in the panel and download it', async () => {
        const panel = page.getByRole('complementary', { name: 'Details panel' });
        if (!(await panel.isVisible())) {
          await page.getByRole('button', { name: 'Expand right panel' }).first().click();
        }
        await expect(
          panel.locator('iframe[title="Interactive visualization"]'),
        ).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Tailor' })).toHaveCount(0);
        await expect(panel.getByRole('button', { name: 'Refresh data' })).toHaveCount(0);
        const download = page.waitForEvent('download');
        await panel.getByRole('button', { name: 'Download bundle' }).click();
        expect((await download).suggestedFilename()).toMatch(/\.zip$/);
      });
    },
  );

  test('no control on a past chat sends, rates, tailors or refreshes', async ({ page }) => {
    await seedOldChat(page);
    await page.reload();
    await openSessions(page);
    await sessionRow(page, OLD_CHAT).getByRole('button', { name: /^Stage counts chat/ }).click();
    await expect(page.getByTestId('past-chat-banner')).toBeVisible();
    await expect(page.getByText(OLD_ANSWER, { exact: true })).toBeVisible();

    const main = page.getByRole('main');
    await expect(main.locator('textarea')).toHaveCount(0);
    for (const name of [
      'Send message',
      'Careful mode',
      'Deep analysis',
      'Save as verified query',
      'Mark answer as wrong',
      'Generate interactive visuals',
    ]) {
      await expect(page.getByRole('button', { name }), name).toHaveCount(0);
    }
    const panel = page.getByRole('complementary', { name: 'Details panel' });
    if (!(await panel.isVisible())) {
      await page.getByRole('button', { name: 'Expand right panel' }).first().click();
    }
    await expect(panel.locator('iframe[title="Interactive visualization"]')).toBeVisible();
    for (const name of ['Tailor', 'Refresh data']) {
      await expect(panel.getByRole('button', { name }), name).toHaveCount(0);
    }
    // Deleting stays in the list.
    await openSessions(page);
    await expect(sessionRow(page, OLD_CHAT).getByRole('button', { name: /^Options for/ })).toBeVisible();
  });

  test('the Runs page has no detectable accessibility violations in either theme', async ({
    page,
  }) => {
    await seedRun(page);
    await followOsTheme(page);
    await page.reload();
    await rail(page).getByRole('button', { name: 'Runs', exact: true }).click();
    await expect(page.getByTestId('runs-list')).toBeVisible();
    await page.addScriptTag({ content: axe.source });
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.waitForTimeout(500);
      const results = await page.evaluate(async () => {
        return (window as unknown as { axe: typeof axe }).axe.run(document);
      });
      expect(results.violations, theme).toEqual([]);
    }
  });
});
