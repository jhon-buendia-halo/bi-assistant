import { expect, Page } from '@playwright/test';

export const WORLD_CUP_DATASOURCE = 'World Cup PostgreSQL';
export const WORLD_CUP_DATASET = 'World Cup Core';
export const WORLD_CUP_SESSION = 'World Cup analysis';

export async function openDatasourceSettings(page: Page): Promise<void> {
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Datasource Configuration' }).click();
  await expect(
    page.getByRole('heading', { name: 'Datasource Configuration' }),
  ).toBeVisible();
}

export async function createWorldCupDatasource(page: Page): Promise<void> {
  await openDatasourceSettings(page);
  await page.getByRole('button', { name: 'New datasource' }).click();
  await page.getByLabel('Name', { exact: true }).fill(WORLD_CUP_DATASOURCE);
  await page.getByLabel('Kind').selectOption('postgres');
  await page.getByLabel('Host').fill('127.0.0.1');
  await page.getByLabel('Port').fill('55432');
  await page.getByLabel('Database').fill('world_cup');
  await page.getByLabel('User').fill('world_cup');
  await page.getByLabel('Password').fill('world_cup_dev');

  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connection successful')).toBeVisible();
  await page.getByRole('button', { name: 'Save datasource' }).click();
  const datasource = page
    .locator('[data-testid^="datasource-"]')
    .filter({ hasText: WORLD_CUP_DATASOURCE });
  await expect(datasource).toBeVisible();
  await expect(datasource).toContainText('PostgreSQL');
}

export async function createWorldCupDataset(
  page: Page,
  tables: string[] = ['matches'],
): Promise<void> {
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Datasets' }).click();
  await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible();
  await page.getByRole('button', { name: 'New dataset' }).click();
  await expect(
    page.getByRole('heading', { name: 'New dataset' }),
  ).toBeVisible();

  await expect(page.getByTestId('catalog-world_cup')).toBeVisible();
  await page.getByTestId('catalog-world_cup').click();
  await page.getByTestId('schema-world_cup-world_cup').click();
  for (const table of tables) {
    await page.getByTestId(`table-world_cup-world_cup-${table}`).click();
    if (table === 'matches') {
      await expect(
        page.getByText('match_number', { exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole('button', { name: 'Include item', exact: true })
      .click();
  }

  await page.getByPlaceholder('Dataset name').fill(WORLD_CUP_DATASET);
  await page
    .getByRole('button', { name: `Save dataset (${tables.length})` })
    .click();
  await expect(page.getByTestId(`dataset-${WORLD_CUP_DATASET}`)).toBeVisible();
  await expect(
    page.getByText(`PostgreSQL · ${tables.length} entities`),
  ).toBeVisible();
}

export async function createWorldCupSession(page: Page): Promise<string> {
  await page.getByTitle('New conversation').click();
  await expect(page.getByPlaceholder('My new session')).toBeVisible();
  await page.getByPlaceholder('My new session').fill(WORLD_CUP_SESSION);
  await page
    .getByRole('button', { name: new RegExp(WORLD_CUP_DATASET) })
    .click();
  await page.getByRole('button', { name: /^Create$/ }).click();

  await expect(
    page.getByText(WORLD_CUP_SESSION, { exact: true }),
  ).toBeVisible();
  await expect(page.locator('header')).toContainText(WORLD_CUP_DATASOURCE);
  await expect(page.locator('header')).toContainText('PostgreSQL');

  const session = page.locator('[data-testid^="session-"]').filter({
    hasText: WORLD_CUP_SESSION,
  });
  const testId = await session.getAttribute('data-testid');
  if (!testId) throw new Error('Created session did not expose its id');
  return testId.slice('session-'.length);
}

export async function createWorldCupWorkspace(page: Page): Promise<string> {
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page);
  return createWorldCupSession(page);
}
