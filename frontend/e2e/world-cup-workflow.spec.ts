import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASOURCE,
  WORLD_CUP_SESSION,
  createWorldCupDatasource,
  createWorldCupDataset,
  createWorldCupWorkspace,
  openDatasourceSettings,
} from './helpers/app-actions';

test('creates a PostgreSQL datasource, dataset, and session using the real World Cup database', async ({
  app,
  page,
}) => {
  await createWorldCupWorkspace(page);

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
  await expect(
    page.getByText(WORLD_CUP_SESSION, { exact: true }),
  ).toBeVisible();
  await page.getByText(WORLD_CUP_SESSION, { exact: true }).click();
  await expect(page.locator('header')).toContainText(WORLD_CUP_DATASOURCE);
  await expect(page.locator('header')).toContainText('PostgreSQL');
  await expect(
    page.getByPlaceholder('Ask a follow-up question…'),
  ).toBeVisible();
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

  await page.getByRole('button', { name: 'Back' }).click();
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
  await page.getByTestId('catalog-world_cup').click();
  await page.getByTestId('schema-world_cup-world_cup').click();
  await page.getByTestId('table-world_cup-world_cup-goals').click();
  await expect(
    page.getByText('scorer_player_id', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/bigint/).first()).toBeVisible();
});
