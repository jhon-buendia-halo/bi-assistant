import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_CATALOG, worldCupKey } from './helpers/world-cup-db';
import {
  WORLD_CUP_DATASET,
  WORLD_CUP_DATASOURCE,
  createWorldCupDatasource,
  createWorldCupDataset,
  openDatasourceSettings,
} from './helpers/app-actions';
import { saveLenaiSettings } from './helpers/agents-api';
import {
  startLlmStub,
  type StubRequest,
  type StubReply,
  messageText,
} from './helpers/llm-stub';
import { railItem, runAnswer, runQuestionInTab } from './helpers/run-ui';

const QUESTION = 'How many World Cup matches are in the data?';
const ANSWER = 'The World Cup data holds the matches counted by the query.';
const SQL = `SELECT COUNT(*) AS matches FROM ${worldCupKey('matches')}`;

test('creates a PostgreSQL datasource, dataset, and run using the real World Cup database', async ({
  app,
  page,
}) => {
  const stub = await startLlmStub();
  try {
    await createWorldCupDatasource(page);
    await createWorldCupDataset(page);
    await saveLenaiSettings(page, stub.baseUrl);

    // The model queries the real World Cup database once, then answers.
    stub.reply = (request: StubRequest): StubReply =>
      request.messages.at(-1)?.role === 'tool'
        ? { text: ANSWER }
        : {
            toolCall: {
              name:
                request.tools.find((tool) => tool.endsWith('run_readonly_sql')) ??
                'run_readonly_sql',
              arguments: { sql: SQL, rationale: 'Counting the matches.' },
            },
          };

    // A run of Questions to Insights v2 over the dataset just created queries
    // the real database and shows the answer with the query behind it.
    await runQuestionInTab(page, QUESTION, WORLD_CUP_DATASET);
    await expect(runAnswer(page)).toContainText(ANSWER);
    await runAnswer(page)
      .getByText(/Data used \(1 query\)/)
      .click();
    await expect(runAnswer(page).locator('pre', { hasText: SQL })).toBeVisible();
    const toolResult = stub.requests
      .flatMap((request) => request.messages)
      .filter((message) => message.role === 'tool')
      .map(messageText)
      .join('\n');
    expect(toolResult).toContain('matches');
    expect(toolResult).not.toMatch(/"error"/i);

    // Reload the application: the desktop shell loads its built entry file,
    // the browser reloads the app URL.
    if (app.target === 'desktop') {
      const entryUrl = pathToFileURL(
        path.resolve(process.cwd(), 'dist/frontend/browser/index.html'),
      ).href;
      await page.goto(entryUrl);
    } else {
      await page.reload();
    }
    await expect(page.getByLabel('Open system logs')).toBeVisible();

    // The run is kept: Runs lists it, and it reopens with its answer.
    await railItem(page, 'Runs').click();
    const row = page.getByTestId('row-run-title').filter({ hasText: QUESTION });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId('run-detail-answer')).toContainText(ANSWER);
    await expect(page.getByTestId('run-detail-input')).toContainText(
      WORLD_CUP_DATASET,
    );
  } finally {
    await stub.close();
  }
});

test('preserves masked credentials when editing and supports datasource deletion', async ({
  page,
}) => {
  await createWorldCupDatasource(page);

  const datasource = page
    .locator('[data-testid^="datasource-"]')
    .filter({ hasText: WORLD_CUP_DATASOURCE });
  await datasource.getByTitle('Edit').click();
  await expect(page.getByLabel('Password')).toHaveValue('••••••••');
  await page.getByLabel('Name', { exact: true }).fill('World Cup Statistics');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connection successful')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByText('World Cup Statistics', { exact: true }),
  ).toBeVisible();

  const edited = page
    .locator('[data-testid^="datasource-"]')
    .filter({ hasText: 'World Cup Statistics' });
  page.once('dialog', (dialog) => dialog.accept());
  await edited.getByTitle('Delete').click();
  await expect(page.getByText('No datasources yet.')).toBeVisible();
});

test('surfaces a failed connection in both the form and system diagnostics', async ({
  page,
}) => {
  await openDatasourceSettings(page);
  await page.getByRole('button', { name: 'New datasource' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Unavailable database');
  await page.getByLabel('Kind').selectOption('postgres');
  await page.getByLabel('Host').fill('127.0.0.1');
  await page.getByLabel('Port').fill('1');
  await page.getByLabel('Database').fill('missing');
  await page.getByLabel('User').fill('missing');
  await page.getByLabel('Password').fill('do-not-log-this');
  await page.getByRole('button', { name: 'Test connection' }).click();

  await expect(page.getByText(/Postgres —/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save datasource' }),
  ).toBeDisabled();

  await page.getByLabel('Open system logs').click();
  await page.getByRole('button', { name: /^Issues/ }).click();
  await page.getByLabel('Search system logs').fill('Postgres');
  await expect(page.getByText(/Postgres —/).first()).toBeVisible();
  await expect(page.locator('app-system-logs-panel')).not.toContainText(
    'do-not-log-this',
  );
});

test('shows the real catalog schema and column metadata before a dataset is saved', async ({
  page,
}) => {
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page);

  await page.getByTestId('dataset-World Cup Core').click();
  await page.getByTestId(`catalog-${WORLD_CUP_CATALOG}`).click();
  await page.getByTestId(`schema-${WORLD_CUP_CATALOG}-world_cup`).click();
  await page.getByTestId(`table-${WORLD_CUP_CATALOG}-world_cup-goals`).click();
  await expect(
    page.getByText('scorer_player_id', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/bigint/).first()).toBeVisible();
});
