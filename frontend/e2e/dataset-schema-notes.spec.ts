import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_CATALOG } from './helpers/world-cup-db';
import {
  WORLD_CUP_DATASET,
  apiUrl,
  createWorldCupDatasource,
  createWorldCupDataset,
} from './helpers/app-actions';

const DESCRIPTION = 'Tournament facts for analysis';
const SCHEMA_KEY = `${WORLD_CUP_CATALOG}.world_cup`;

/** Saves an evidence screenshot when E2E_EVIDENCE_DIR names a folder. */
async function evidence(page: Page, folder: string, name: string) {
  const root = process.env['E2E_EVIDENCE_DIR'];
  if (!root) return;
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), fullPage: true });
}

test('tags a schema with a layer and description and keeps them after saving', async ({
  page,
}) => {
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page);

  const openSchema = async (): Promise<void> => {
    await page.getByTestId(`dataset-${WORLD_CUP_DATASET}`).click();
    await page.getByTestId(`catalog-${WORLD_CUP_CATALOG}`).click();
    await page.getByTestId(`schema-${WORLD_CUP_CATALOG}-world_cup`).click();
  };

  await openSchema();
  await page.getByTestId('schema-layer-select').selectOption('consumption');
  await page.getByTestId('schema-description').fill(DESCRIPTION);
  await page.getByRole('button', { name: /^Save dataset/ }).click();
  await expect(page.getByTestId(`dataset-${WORLD_CUP_DATASET}`)).toBeVisible();

  // The notes are persisted on the dataset.
  const body = await (await page.request.get(apiUrl(page, '/datasets'))).json();
  const dataset = body.datasets.find(
    (d: { name: string }) => d.name === WORLD_CUP_DATASET,
  );
  expect(dataset.schemas).toEqual([
    { key: SCHEMA_KEY, layer: 'consumption', description: DESCRIPTION },
  ]);

  // Reload, reopen: the tree chip and the details panel carry the notes.
  await page.reload();
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Datasets' })
    .click();
  await openSchema();
  const chip = page.getByTestId(`schema-layer-${WORLD_CUP_CATALOG}-world_cup`);
  await expect(chip).toHaveText('Consumption');
  await expect(chip).toHaveAttribute('title', DESCRIPTION);
  await expect(page.getByTestId('schema-layer-select')).toHaveValue(
    'consumption',
  );
  await expect(page.getByTestId('schema-description')).toHaveValue(DESCRIPTION);
  await evidence(page, '1.20.1', 'dataset-schema-notes-panel.png');
});
