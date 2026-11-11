import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASET,
  WORLD_CUP_SESSION,
  createWorldCupSession,
  openSessions,
} from './helpers/app-actions';
import { apiJson } from './helpers/api';
import {
  deleteDataset,
  seedDataset,
  seedWorldCupDataset,
} from './helpers/agents-api';

/**
 * Mirrors the Feature "Session management" in
 * specs/capabilities/sessions-chat/spec.md: the Sessions page, the New
 * conversation screen and its Agent picker (R1, R46, R63, R64; roadmap
 * 1.14.17), and the session id in the page header (R62; roadmap 1.14.18).
 * "The conversation and its history survive a restart" is covered by the
 * datasources Feature's World Cup workflow.
 *
 * Two stories add to this file: keep each test as its owner wrote it.
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

const sessionsList = (page: Page) =>
  page.getByRole('navigation', { name: 'Sessions', exact: true });
const nameField = (page: Page) => page.getByPlaceholder('My new session');
const createButton = (page: Page) =>
  page.getByRole('button', { name: /^Create$/ });
const datasetCard = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name}`) });
const agentField = (page: Page) => page.getByTestId('new-session-agent');
const agentList = (page: Page) => page.getByRole('listbox', { name: 'Agent' });
const agentOption = (page: Page, name: string) =>
  agentList(page).getByRole('option').filter({ hasText: name });

/** The Sessions page row of the session named `name`. */
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

  await expect(agentField(page)).toHaveText(/Assistant/);
  await expect(page.getByTestId('new-session-agent-description')).toHaveText(
    ASSISTANT_DESCRIPTION,
  );
  await expect(
    page.getByText('Select at least one dataset for this session'),
  ).toBeVisible();

  // The Agent field is a listbox showing each agent's name and description.
  await agentField(page).click();
  await expect(agentList(page)).toBeVisible();
  await expect(agentField(page)).toHaveAttribute('aria-expanded', 'true');
  const options = agentList(page).getByRole('option');
  await expect(options.first()).toContainText('Assistant');
  await expect(options.first()).toContainText(ASSISTANT_DESCRIPTION);
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  const rfp = agentOption(page, 'RFP Builder');
  await expect(rfp).not.toHaveAttribute('aria-disabled', 'true');
  await expect(rfp).not.toContainText(RFP_REQUIREMENT);
  await page.screenshot({
    path: path.join(EVIDENCE, 'new-conversation-agent-picker.png'),
  });

  await rfp.click();
  await expect(agentList(page)).toHaveCount(0);
  await expect(agentField(page)).toHaveText(/RFP Builder/);
  const chips = page.getByTestId('new-session-agent-datasets');
  await expect(chips).toContainText(INTELLIFY_DATASET);
  await expect(
    page.getByText('Select at least one dataset for this session'),
  ).toHaveCount(0);
  await expect(datasetCard(page, WORLD_CUP_DATASET)).toHaveCount(0);
  await expect(createButton(page)).toBeEnabled();

  await createButton(page).click();
  await expect(page.getByText('Session "RFP Builder" created')).toBeVisible();
  await expect(page.locator('header')).toContainText('RFP Builder');

  // The Sessions page shows it with its dataset under its name and its
  // agent as the row's chip (R63).
  await openSessions(page);
  const row = sessionRow(page, 'RFP Builder');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(INTELLIFY_DATASET);
  await expect(row.getByTestId('row-session-agent')).toHaveText('RFP Builder');
});

test('the Agent field disables an agent that cannot start', async ({
  page,
}) => {
  // Given the "Intellify RFP API" sample is not loaded
  await openComposer(page);
  await agentField(page).click();
  const rfp = agentOption(page, 'RFP Builder');
  await expect(rfp).toHaveAttribute('aria-disabled', 'true');
  await expect(rfp).toContainText(RFP_REQUIREMENT);
  await page.screenshot({
    path: path.join(EVIDENCE, 'new-conversation-agent-disabled.png'),
  });

  // The Background's World Cup dataset is on PostgreSQL, so the Data
  // Readiness Agent can be chosen (data-readiness R1-R2).
  await expect(agentOption(page, 'Data Readiness Agent')).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  // It cannot be chosen (clicked past Playwright's aria-disabled check).
  await rfp.click({ force: true });
  await expect(agentField(page)).toHaveText(/Assistant/);
  await expect(page.getByTestId('new-session-agent-description')).toHaveText(
    ASSISTANT_DESCRIPTION,
  );
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

test('the Sessions page finds a session by name or ID', async ({ page }) => {
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

  // Each row shows its datasets, its agent and its id.
  const search = page.getByPlaceholder('Search sessions by name or ID…');
  await search.fill('cup HISTORY');
  await expect(rows).toHaveCount(1);
  await expect(pagination).toContainText('1–1 of 1');
  const row = sessionRow(page, 'Cup history');
  await expect(row).toContainText(WORLD_CUP_DATASET);
  await expect(row.getByTestId('row-session-agent')).toHaveText('Assistant');
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

test('the Agent field lists only agents that can chat', async ({ page }) => {
  await openComposer(page);
  await agentField(page).click();
  // allInnerTexts does not wait: wait for the last option to render first.
  await expect(agentOption(page, 'RFP Builder')).toBeVisible();
  const names = (await agentList(page).getByRole('option').allInnerTexts()).map(
    (text) => text.split('\n')[0].trim(),
  );
  // Assistant, Questions to Insights v2 (BA-320), the Official agents that
  // bring their own datasets alphabetical (the Data Readiness Agent, BA-251,
  // then the RFP Builder), then the user's own agents (R64).
  expect(names.slice(0, 4)).toEqual([
    'Assistant',
    V2,
    'Data Readiness Agent',
    'RFP Builder',
  ]);
  for (const name of [
    'Benchmarking Agent',
    'LAD COE Agent',
    'Strategy Agent',
    'Survey Agent',
  ]) {
    await expect(agentOption(page, name)).toHaveCount(0);
  }
  // The Background's World Cup dataset is on PostgreSQL, so the Data
  // Readiness Agent can be chosen (data-readiness R1-R2).
  await expect(agentOption(page, 'Data Readiness Agent')).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('I start a Questions to Insights v2 session from New conversation', async ({
  page,
}) => {
  await openComposer(page);
  await agentField(page).click();
  await agentOption(page, V2).click();
  await expect(agentList(page)).toHaveCount(0);
  await expect(agentField(page)).toHaveText(new RegExp(V2));
  await expect(page.getByTestId('new-session-agent-description')).toHaveText(
    V2_DESCRIPTION,
  );
  // Like the assistant, v2 runs over the datasets the user picks (R64).
  await expect(
    page.getByText('Select at least one dataset for this session'),
  ).toBeVisible();
  await expect(page.getByTestId('new-session-agent-datasets')).toHaveCount(0);
  await expect(createButton(page)).toBeDisabled();

  await datasetCard(page, WORLD_CUP_DATASET).click();
  await nameField(page).fill('V2 check');
  await expect(createButton(page)).toBeEnabled();
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/sessions') && r.request().method() === 'POST',
  );
  await createButton(page).click();
  const body = (await (await created).json()) as {
    session: { id: string };
  };
  await expect(page.getByText('Session "V2 check" created')).toBeVisible();
  await expect(page.getByTestId('session-agent')).toHaveText(V2);

  // The session is bound to v2 over the picked dataset (R61).
  const session = await apiJson<{
    agentKey?: string;
    agentName?: string;
    datasets: string[];
  }>(page, 'GET', `/sessions/${body.session.id}`);
  expect(session.agentKey).toBe('assistant-v2');
  expect(session.agentName).toBe(V2);
  expect(session.datasets).toEqual([WORLD_CUP_DATASET]);

  await openSessions(page);
  const row = sessionRow(page, 'V2 check');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('row-session-agent')).toHaveText(V2);
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
    .getByRole('button', { name: 'Agents', exact: true })
    .click();
  await page
    .getByRole('button', { name: `Start chat with ${V2}`, exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'New conversation', exact: true }),
  ).toBeVisible();
  await expect(agentField(page)).toHaveText(new RegExp(V2));
  await expect(nameField(page)).toBeVisible();
  const after = await apiJson<{ sessions: unknown[] }>(
    page,
    'GET',
    '/sessions',
  );
  expect(after.sessions).toHaveLength(before.sessions.length);
});

test('the Agent field lists Questions to Insights v2 right after Assistant', async ({
  page,
}) => {
  await openComposer(page);
  await agentField(page).click();
  await expect(agentOption(page, 'RFP Builder')).toBeVisible();
  const names = (await agentList(page).getByRole('option').allInnerTexts()).map(
    (text) => text.split('\n')[0].trim(),
  );
  expect(names.slice(0, 4)).toEqual([
    'Assistant',
    V2,
    'Data Readiness Agent',
    'RFP Builder',
  ]);
});
