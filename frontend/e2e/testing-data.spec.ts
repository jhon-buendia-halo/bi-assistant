import { createRequire } from 'node:module';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DB } from './helpers/world-cup-db';

// Mirrors the "Testing data" Feature in
// specs/capabilities/testing-data/spec.md. Scenarios not listed here are
// not automated yet (see the Feature's E2E line).

// In panel order: main's samples first, then the BA-9 eval samples.
const SAMPLES = [
  { id: 'world-cup', name: 'World Cup', required: 10 },
  { id: 'formula-1', name: 'Formula 1', required: 48 },
  { id: 'intellify', name: 'Intellify', required: 49 },
  { id: 'us-health', name: 'US Health', required: 45 },
  { id: 'edge-cases', name: 'Edge Cases', required: 19 },
  { id: 'world-cup-medallion', name: 'World Cup Medallion', required: 11 },
  { id: 'retail-ops', name: 'Retail Ops', required: 19 },
  { id: 'world-cup-excel', name: 'World Cup Excel', required: 4 },
  { id: 'world-cup-rest', name: 'World Cup (REST API)', required: 10 },
  { id: 'finance', name: 'Finance', required: 17 },
  { id: 'health-insurance', name: 'Health Insurance', required: 12 },
  { id: 'genomics', name: 'Genomics', required: 13 },
  { id: 'supply-chain', name: 'Supply Chain', required: 14 },
  { id: 'marketing-analytics', name: 'Marketing Analytics', required: 14 },
  { id: 'finance-rest', name: 'Finance (REST API)', required: 17 },
  {
    id: 'marketing-analytics-rest',
    name: 'Marketing Analytics (REST API)',
    required: 14,
  },
  {
    id: 'world-cup-rest-connector',
    name: 'World Cup (REST API, connector profile)',
    required: 13,
  },
  { id: 'world-cup-databricks', name: 'World Cup (Databricks)', required: 10 },
  { id: 'finance-databricks', name: 'Finance (Databricks)', required: 17 },
  {
    id: 'marketing-analytics-databricks',
    name: 'Marketing Analytics (Databricks)',
    required: 14,
  },
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
    'Intellify employee-benefits data model, synthetic data',
  );
  await expect(card(page, 'us-health')).toContainText(
    'A US health & benefits consultancy, synthetic data',
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

test.describe('loads the US Health sample into a new database', () => {
  // A database name of its own, so the run never drops a shared `us_health`
  // database and always exercises "created the database".
  const database = `us_health_e2e_${Date.now().toString(36)}`;
  test.afterEach(() =>
    onServer(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`),
  );

  test('seeds it, registers it and reports 45/45', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await openTestingData(page);
    await card(page, 'us-health').getByRole('button').first().click();

    await page
      .getByTestId('testing-data-host-us-health')
      .fill(WORLD_CUP_DB.host);
    await page
      .getByTestId('testing-data-port-us-health')
      .fill(String(WORLD_CUP_DB.port));
    await page.getByTestId('testing-data-database-us-health').fill(database);
    await page
      .getByTestId('testing-data-user-us-health')
      .fill(WORLD_CUP_DB.user);
    await page
      .getByTestId('testing-data-password-us-health')
      .fill(WORLD_CUP_DB.password);

    await page.getByTestId('testing-data-load-us-health').click();
    const target = `${WORLD_CUP_DB.host}:${WORLD_CUP_DB.port}`;
    await expect(
      page.getByTestId('testing-data-confirm-panel-us-health'),
    ).toContainText(
      `This drops and recreates schema us_health on ${target}/${database}`,
    );
    await page.getByTestId('testing-data-confirm-us-health').click();

    const message = page
      .getByRole('region', { name: 'Notifications' })
      .getByText(
        `Seeded us_health on ${target} and loaded 45 entities into dataset "US Health"`,
      );
    await expect(message).toBeVisible({ timeout: 90_000 });
    await expect(message).toContainText('— created the database');
    await expect(status(page, 'us-health')).toHaveText('45/45 entities');
    await expect(card(page, 'us-health')).toContainText(
      `${target}/${database}`,
    );
    await page.screenshot({
      path: testInfo.outputPath('testing-data-us-health-loaded.png'),
    });

    await page
      .getByRole('navigation', { name: 'Settings navigation' })
      .getByRole('button', { name: 'Datasource Configuration' })
      .click();
    await expect(page.getByText('US Health PostgreSQL')).toBeVisible();
  });
});
