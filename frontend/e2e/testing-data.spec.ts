import { createRequire } from 'node:module';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DB } from './helpers/world-cup-db';

// Mirrors the "Testing data" Feature in
// specs/capabilities/testing-data/spec.md. Scenarios not listed here are
// not automated yet (see the Feature's E2E line).

const SAMPLES = [
  { id: 'world-cup', name: 'World Cup', required: 9 },
  { id: 'formula-1', name: 'Formula 1', required: 48 },
  { id: 'intellify', name: 'Intellify', required: 49 },
  { id: 'world-cup-rest', name: 'World Cup (REST API)', required: 9 },
  { id: 'intellify-api', name: 'Intellify RFP API', required: 10 },
];

async function openTestingData(page: Page): Promise<void> {
  await page.getByTitle('Settings').click();
  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'Testing Data' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Testing Data' }),
  ).toBeVisible();
}

const card = (page: Page, id: string): Locator =>
  page.getByTestId(`testing-data-fixture-${id}`);
const status = (page: Page, id: string): Locator =>
  page.getByTestId(`testing-data-status-${id}`);

interface PgClient {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

/** Runs one statement on the sample server's maintenance database. */
async function onServer(sql: string): Promise<void> {
  const requireFromBackend = createRequire(
    path.resolve(__dirname, '../../backend/package.json'),
  );
  const { Client } = requireFromBackend('pg') as {
    Client: new (config: object) => PgClient;
  };
  const client = new Client({ ...WORLD_CUP_DB, database: 'postgres' });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

test('lists the bundled samples and what is loaded', async ({
  page,
}, testInfo) => {
  await openTestingData(page);

  const cards = page.locator('[data-testid^="testing-data-fixture-"]');
  await expect(cards).toHaveCount(SAMPLES.length);
  for (const [index, sample] of SAMPLES.entries()) {
    await expect(cards.nth(index)).toHaveAttribute(
      'data-testid',
      `testing-data-fixture-${sample.id}`,
    );
    await expect(card(page, sample.id)).toContainText(sample.name);
    await expect(status(page, sample.id)).toHaveText(
      `0/${sample.required} entities`,
    );
  }
  await expect(card(page, 'intellify')).toContainText(
    'Intellify employee-benefits data model (Halo × Marsh), synthetic data',
  );
  await page.screenshot({
    path: testInfo.outputPath('testing-data-samples-listed.png'),
  });
});

test.describe('loads the Intellify sample into a new database', () => {
  // A database name of its own, so the run never drops the shared `intellify`
  // database and always exercises "created the database".
  const database = `intellify_e2e_${Date.now().toString(36)}`;
  test.afterEach(() =>
    onServer(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`),
  );

  test('seeds it, registers it and reports 49/49', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await openTestingData(page);
    await card(page, 'intellify').getByRole('button').first().click();

    await page
      .getByTestId('testing-data-host-intellify')
      .fill(WORLD_CUP_DB.host);
    await page
      .getByTestId('testing-data-port-intellify')
      .fill(String(WORLD_CUP_DB.port));
    await page.getByTestId('testing-data-database-intellify').fill(database);
    await page
      .getByTestId('testing-data-user-intellify')
      .fill(WORLD_CUP_DB.user);
    await page
      .getByTestId('testing-data-password-intellify')
      .fill(WORLD_CUP_DB.password);

    await page.getByTestId('testing-data-load-intellify').click();
    const target = `${WORLD_CUP_DB.host}:${WORLD_CUP_DB.port}`;
    await expect(
      page.getByTestId('testing-data-confirm-panel-intellify'),
    ).toContainText(
      `This drops and recreates schema intellify on ${target}/${database}`,
    );
    await page.getByTestId('testing-data-confirm-intellify').click();

    const message = page
      .getByRole('region', { name: 'Notifications' })
      .getByText(
        `Seeded intellify on ${target} and loaded 49 entities into dataset "Intellify"`,
      );
    await expect(message).toBeVisible({ timeout: 90_000 });
    await expect(message).toContainText('— created the database');
    await expect(status(page, 'intellify')).toHaveText('49/49 entities');
    await expect(card(page, 'intellify')).toContainText(
      `${target}/${database}`,
    );
    await page.screenshot({
      path: testInfo.outputPath('testing-data-intellify-loaded.png'),
    });

    await page
      .getByRole('navigation', { name: 'Settings navigation' })
      .getByRole('button', { name: 'Datasource Configuration' })
      .click();
    await expect(page.getByText('Intellify PostgreSQL')).toBeVisible();
  });
});

test('registers the Intellify RFP API', async ({ app, page }, testInfo) => {
  // Given the Intellify sample is loaded into the database the API reads
  // (the shared `intellify_mercer_demo`, see .claude/skills/intellify-api).
  // Registering writes to no database (R21), so the shared one is safe.
  const apiUrl = app.intellifyApiUrl;
  expect(apiUrl, 'the CLI banner names the embedded API').toBeTruthy();
  await openTestingData(page);
  await card(page, 'intellify-api').getByRole('button').first().click();

  await expect(
    page.getByTestId('testing-data-api-url-intellify-api'),
  ).toHaveText(apiUrl!);
  await expect(page.getByTestId('testing-data-host-intellify-api')).toHaveCount(
    0,
  );
  await expect(
    page.getByTestId('testing-data-database-intellify-api'),
  ).toHaveCount(0);
  await expect(page.getByTestId('testing-data-test-intellify-api')).toHaveCount(
    0,
  );

  const register = page.getByTestId('testing-data-load-intellify-api');
  await expect(register).toHaveText('Register testing data');
  await register.click();
  await expect(
    page.getByTestId('testing-data-confirm-panel-intellify-api'),
  ).toContainText(
    `This registers the Intellify RFP API at ${apiUrl} as a datasource and dataset. No database changes are made.`,
  );
  await page.getByTestId('testing-data-confirm-intellify-api').click();

  await expect(
    page
      .getByRole('region', { name: 'Notifications' })
      .getByText(
        `Registered the Intellify RFP API at ${apiUrl} and loaded 10 entities into dataset "Intellify RFP API"`,
      ),
  ).toBeVisible({ timeout: 60_000 });
  await expect(status(page, 'intellify-api')).toHaveText('10/10 entities');
  await page.screenshot({
    path: testInfo.outputPath('testing-data-intellify-api-registered.png'),
  });

  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'Datasource Configuration' })
    .click();
  await expect(
    page
      .locator('[data-testid^="datasource-"]')
      .filter({ hasText: 'Intellify RFP API' }),
  ).toBeVisible();

  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Datasets' })
    .click();
  await expect(page.getByTestId('dataset-Intellify RFP API')).toBeVisible();
});
