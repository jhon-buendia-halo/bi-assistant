import axe from 'axe-core';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASET,
  apiUrl,
  createWorldCupDataset,
  createWorldCupDatasource,
  followOsTheme,
} from './helpers/app-actions';
import { worldCupKey } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Data model editing" in
 * specs/capabilities/data-model/spec.md (one test per Scenario, titled as
 * the Scenario). Every test starts its own web app on a fresh data dir and
 * builds the Background through the UI: the World Cup datasource and the
 * "World Cup Core" dataset over "matches" and "teams" (so a declared
 * relationship exists to edit). The Data model view is ui.md 4.19.
 *
 * Evidence screenshots go to the test's output folder (`testInfo.outputPath`,
 * as llm-settings.spec.ts does), named for what they show.
 */

const TABLES = ['matches', 'teams'];
/** `slugifyDatasetName("World Cup Core")`, the export's file-name stem. */
const DATASET_SLUG = 'world-cup-core';

const TAB_LABELS = {
  overview: 'Overview',
  yaml: 'YAML',
  versions: 'Versions',
  metrics: 'Metrics',
} as const;

/**
 * Finds the line holding an entity's `name: <entity>` key. Mirrors
 * `backend/test/data-models.e2e-spec.ts`'s `findEntityNameLine`: the DSL's
 * YAML writer puts the block-sequence dash and the first key on one line
 * (`  - name: matches`), so the match tolerates an optional leading `- `.
 */
function findEntityNameLine(
  lines: string[],
  entityName: string,
): { index: number; indent: string } {
  const index = lines.findIndex((line) => {
    const trimmed = line.trim();
    return (
      trimmed === `name: ${entityName}` || trimmed === `- name: ${entityName}`
    );
  });
  if (index === -1) {
    throw new Error(
      `entity "${entityName}" not found in yaml:\n${lines.join('\n')}`,
    );
  }
  const dash = /^(\s*)-\s/.exec(lines[index]);
  const indent = dash
    ? `${dash[1]}  `
    : (/^(\s*)/.exec(lines[index])?.[1] ?? '');
  return { index, indent };
}

function addEntityDescription(
  yaml: string,
  entityName: string,
  description: string,
): string {
  const lines = yaml.split('\n');
  const { index, indent } = findEntityNameLine(lines, entityName);
  lines.splice(index + 1, 0, `${indent}description: ${description}`);
  return lines.join('\n');
}

/** Points an entity's binding at a column that does not exist, the same
 * way the backend spec's `breakColumnBinding` does. */
function breakColumnBinding(
  yaml: string,
  entityName: string,
  attribute: string,
  missingColumn: string,
): string {
  const lines = yaml.split('\n');
  const { index: entityIdx } = findEntityNameLine(lines, entityName);
  const tableIdx = lines.findIndex(
    (line, i) => i > entityIdx && line.trim().startsWith('table:'),
  );
  if (tableIdx === -1) {
    throw new Error(`no binding table found for "${entityName}" in yaml`);
  }
  const indent = /^(\s*)/.exec(lines[tableIdx])?.[1] ?? '';
  lines.splice(
    tableIdx + 1,
    0,
    `${indent}columns:`,
    `${indent}  ${attribute}: ${missingColumn}`,
  );
  return lines.join('\n');
}

/** Drops the first two lines (`model: <name>`, `version: <n>`): the version
 * header every write rewrites, so an export/import round trip is identical
 * apart from it, never byte-identical in full. */
function stripVersionHeader(yaml: string): string {
  return yaml.split('\n').slice(2).join('\n');
}

/** A data-model API route of the Background's dataset. */
function modelRoute(suffix = ''): string {
  return `/datasets/${encodeURIComponent(WORLD_CUP_DATASET)}/model${suffix}`;
}

/** Clicks "Data model" on the dataset's row in the Datasets list. */
async function openWorldCupModel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Datasets', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible();
  await page.getByTestId(`dataset-${WORLD_CUP_DATASET}`).hover();
  await page
    .getByRole('button', {
      name: `Data model of ${WORLD_CUP_DATASET}`,
      exact: true,
    })
    .click();
  await expect(page.getByTestId('data-model-view')).toBeVisible();
}

/** Opens a tab of the Data model view by its label (ui.md 4.19.2). */
async function openTab(
  page: Page,
  tab: keyof typeof TAB_LABELS,
): Promise<void> {
  const button = page.getByTestId(`tab-${tab}`);
  await expect(button).toHaveText(TAB_LABELS[tab]);
  await button.click();
}

async function expectVersion(page: Page, text: string): Promise<void> {
  await expect(page.getByTestId('model-version-badge')).toHaveText(text);
}

/** Adds a description to "matches" in the YAML tab and saves it as v2. */
async function saveDescribedMatches(page: Page): Promise<void> {
  await openTab(page, 'yaml');
  const textarea = page.getByTestId('yaml-textarea');
  await expect(textarea).toBeVisible();
  const original = await textarea.inputValue();
  await textarea.fill(
    addEntityDescription(original, 'matches', 'One played match'),
  );
  await page.getByTestId('save-yaml').click();
  await expectVersion(page, 'v2 · user');
}

test.beforeEach(async ({ page }) => {
  // Background, first half: the dataset is created by each test, after any
  // state its Given needs on the dataset's first save.
  await createWorldCupDatasource(page);
});

test("Opens a dataset's data model and sees its bootstrapped entities, relationships and metrics", async ({
  page,
}, testInfo) => {
  // A metric on "matches" before the dataset is first saved: the bootstrap
  // on save brings it into version 1, so "the dataset's metrics" exist.
  const metric = await page.request.post(apiUrl(page, '/metrics'), {
    data: {
      name: 'match_count',
      label: 'Match count',
      entity: worldCupKey('matches'),
      expression: 'count(*)',
    },
  });
  expect(metric.ok()).toBe(true);
  expect(((await metric.json()) as { ok: boolean }).ok).toBe(true);
  await createWorldCupDataset(page, TABLES);
  await followOsTheme(page);

  await openWorldCupModel(page);

  await expectVersion(page, 'v1 · bootstrap');
  await expect(page.getByTestId('overview-entity-matches')).toBeVisible();
  await expect(page.getByTestId('overview-entity-teams')).toBeVisible();
  // A positive count, not just the word: the declared FKs between the two.
  await expect(page.getByText(/Relationships \([1-9]\d*\)/)).toBeVisible();
  await expect(page.getByTestId('overview-relationship-0')).toBeVisible();
  await expect(page.getByTestId('overview-metric-match_count')).toBeVisible();

  await page.addScriptTag({ content: axe.source });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Let the theme's colour transitions finish before axe reads colours.
    await page.waitForTimeout(500);
    await page.screenshot({
      path: testInfo.outputPath(`data-model-overview-${theme}.png`),
    });
    const results = await page.evaluate(async () =>
      (window as unknown as { axe: typeof axe }).axe.run(document),
    );
    expect(results.violations, `${theme} theme`).toEqual([]);
  }
});

test('Edits the YAML, saves, and the version badge advances', async ({
  page,
}) => {
  await createWorldCupDataset(page, TABLES);
  await openWorldCupModel(page);

  await saveDescribedMatches(page);

  await openTab(page, 'versions');
  await expect(page.getByTestId('model-version-1')).toBeVisible();
  await expect(page.getByTestId('model-version-2')).toBeVisible();
});

test('An invalid YAML edit is rejected with its line highlighted', async ({
  page,
}, testInfo) => {
  await createWorldCupDataset(page, TABLES);
  await openWorldCupModel(page);
  await openTab(page, 'yaml');

  const textarea = page.getByTestId('yaml-textarea');
  const original = await textarea.inputValue();
  await textarea.fill(
    breakColumnBinding(original, 'matches', 'attendance', 'nope'),
  );
  await page.getByTestId('save-yaml').click();

  const errors = page.getByTestId('yaml-errors');
  await expect(errors).toBeVisible();
  await expect(errors).toContainText('attendance');
  await expect(errors).toContainText(/\d+:\d+/);

  // No line is highlighted before the click, exactly one after it.
  await expect(page.locator('[data-highlighted="true"]')).toHaveCount(0);
  await errors.getByRole('button').first().click();
  await expect(page.locator('[data-highlighted="true"]')).toHaveCount(1);
  await expectVersion(page, 'v1 · bootstrap');
  await page.screenshot({
    path: testInfo.outputPath('data-model-yaml-error.png'),
  });
});

test('Reverts to version 1 from the Versions tab', async ({
  page,
}, testInfo) => {
  await createWorldCupDataset(page, TABLES);
  await openWorldCupModel(page);
  // Given the model has versions 1 and 2.
  await saveDescribedMatches(page);

  await openTab(page, 'versions');
  await page.getByTestId('revert-1').click();
  await expectVersion(page, 'v1 · bootstrap');
  await expect(page.getByTestId('model-version-2')).toBeVisible();

  // Compare v1 -> v2: the diff shows the added description line.
  await page.getByTestId('model-version-1').getByTitle('Compare').click();
  await page.getByTestId('model-version-2').getByTitle('Compare').click();
  await expect(page.getByTestId('model-diff')).toBeVisible();
  await expect(
    page.getByTestId('diff-line-added').filter({ hasText: 'One played match' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('data-model-versions-diff.png'),
  });
});

test("Changes a relationship's cardinality in the entity form and saves", async ({
  page,
}) => {
  await createWorldCupDataset(page, TABLES);
  await openWorldCupModel(page);
  await page.getByTestId('overview-entity-matches').click();

  await expect(page.getByTestId('relationship-0')).toBeVisible();
  const cardinality = page.getByTestId('relationship-cardinality-0');
  const original = await cardinality.inputValue();
  const next = original === 'many_to_one' ? 'one_to_one' : 'many_to_one';
  await cardinality.selectOption(next);

  await expect(page.getByTestId('save-entity')).toBeEnabled();
  await page.getByTestId('save-entity').click();
  await expectVersion(page, 'v2 · user');

  await openTab(page, 'overview');
  await expect(
    page.getByTestId('overview-relationship-cardinality-0'),
  ).toHaveText(next);
});

test('Defines a metric in the Metrics tab', async ({ page }, testInfo) => {
  await createWorldCupDataset(page, TABLES);
  await openWorldCupModel(page);
  await openTab(page, 'metrics');

  await page.getByTestId('new-model-metric').click();
  // The entity select defaults to the first entity ("matches", included
  // first in the Background) and the aggregation to "count", which needs no
  // attribute.
  await expect(page.getByTestId('metric-entity')).toHaveValue('matches');
  await page.getByPlaceholder('Goals per match').fill('Goals per match');
  await page.getByPlaceholder('goals_per_match').fill('goals_per_match');
  await page.getByTestId('save-model-metric').click();

  await expect(page.getByTestId('model-metric-goals_per_match')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('data-model-metrics.png'),
  });

  await openTab(page, 'yaml');
  await expect(page.getByTestId('yaml-textarea')).toHaveValue(
    /^metrics:$[\s\S]*goals_per_match/m,
  );
});

test('Exports the model and re-imports it', async ({ page }) => {
  await createWorldCupDataset(page, TABLES);
  await openWorldCupModel(page);
  await expectVersion(page, 'v1 · bootstrap');

  const downloading = page.waitForEvent('download');
  await page.getByTestId('export-model').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${DATASET_SLUG}.model.v1.yaml`);
  const exportedYaml = await readFile(await download.path(), 'utf8');
  expect(exportedYaml).toContain('entities:');

  const choosing = page.waitForEvent('filechooser');
  await page.getByTestId('import-model').click();
  const chooser = await choosing;
  await chooser.setFiles({
    name: download.suggestedFilename(),
    mimeType: 'text/yaml',
    buffer: Buffer.from(exportedYaml, 'utf8'),
  });

  await expectVersion(page, 'v2 · import');
  const reimported = await page.request.get(
    apiUrl(page, modelRoute('/versions/2')),
  );
  expect(reimported.ok()).toBe(true);
  const { yaml } = (await reimported.json()) as { yaml: string };
  expect(stripVersionHeader(yaml)).toBe(stripVersionHeader(exportedYaml));
});
