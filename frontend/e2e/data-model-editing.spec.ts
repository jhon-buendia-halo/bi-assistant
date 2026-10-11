import { test, expect } from './fixtures/electron.fixture';
import {
  WORLD_CUP_DATASET,
  createWorldCupDataset,
  createWorldCupDatasource,
} from './helpers/app-actions';

/**
 * Feature: Data model editing (gherkin.md, roadmap 1.2.3 / BA-87). Each test
 * builds its own World Cup datasource + dataset ("matches" and "teams", so a
 * declared relationship exists to edit) against a fresh Electron app/data
 * dir (the fixture's per-test isolation) rather than sharing state, so a
 * failure in one scenario cannot leave a later one starting from an
 * unexpected version.
 *
 * Downloads are not asserted via Playwright's `download` event — per the
 * code review (mirroring `agents.spec.ts`'s "downloads an execution as a
 * Markdown report"), that event is not wired through the Electron renderer.
 * The export button's actual effect is the `GET .../model/export` call
 * Angular's `HttpClient` makes before building the Blob URL, so the export
 * scenario asserts that network response instead, and feeds its body
 * straight into the import step (no filesystem round trip needed either).
 */

const BACKEND = 'http://localhost:3000';

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
    throw new Error(`entity "${entityName}" not found in yaml:\n${lines.join('\n')}`);
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

/** Points an entity's sql binding at a column that does not exist, the same
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

/** Drops the first two lines (`model: <name>`, `version: <n>`) — doc-level
 * identity `appendVersion` always rewrites on every write, so an
 * export/import round trip is only ever "identical apart from the version
 * header" (review finding 10), never byte-identical in full. */
function stripVersionHeader(yaml: string): string {
  return yaml.split('\n').slice(2).join('\n');
}

test.beforeEach(async ({ page }) => {
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page, ['matches', 'teams']);
});

test('opens a dataset\'s data model and sees its bootstrapped entities, relationships and metrics', async ({
  page,
}) => {
  // A real metric so the Overview's metrics list has something to show —
  // a bare bootstrap carries no metrics until one is defined (review
  // finding 9).
  const created = await page.request.post(
    `${BACKEND}/datasets/${encodeURIComponent(WORLD_CUP_DATASET)}/model/metrics`,
    {
      data: {
        name: 'match_count',
        label: 'Match count',
        entity: 'matches',
        agg: 'count',
      },
    },
  );
  expect(created.ok()).toBe(true);

  await page.getByTestId(`dataset-model-${WORLD_CUP_DATASET}`).click();

  await expect(page.getByTestId('data-model-view')).toBeVisible();
  // The metric API call above already bumped the model to v2 · user.
  await expect(page.getByTestId('model-version-badge')).toHaveText(
    'v2 · user',
  );
  await expect(page.getByTestId('overview-entity-matches')).toBeVisible();
  await expect(page.getByTestId('overview-entity-teams')).toBeVisible();
  // A positive relationship count, not just "the word relationships
  // appears" — the declared FKs from matches to teams.
  await expect(page.getByText(/Relationships \([1-9]\d*\)/)).toBeVisible();
  await expect(page.getByTestId('overview-metric-match_count')).toBeVisible();
});

test('edits the YAML, saves, and the version badge advances; v1 is still listed', async ({
  page,
}) => {
  await page.getByTestId(`dataset-model-${WORLD_CUP_DATASET}`).click();
  await page.getByTestId('tab-yaml').click();

  const textarea = page.getByTestId('yaml-textarea');
  await expect(textarea).toBeVisible();
  const original = await textarea.inputValue();
  await textarea.fill(addEntityDescription(original, 'matches', 'One played match'));
  await page.getByTestId('save-yaml').click();

  await expect(page.getByTestId('model-version-badge')).toHaveText(
    'v2 · user',
  );

  await page.getByTestId('tab-versions').click();
  await expect(page.getByTestId('model-version-1')).toBeVisible();
  await expect(page.getByTestId('model-version-2')).toBeVisible();
});

test('rejects an invalid YAML edit with the offending line highlighted, leaving v1 current', async ({
  page,
}) => {
  await page.getByTestId(`dataset-model-${WORLD_CUP_DATASET}`).click();
  await page.getByTestId('tab-yaml').click();

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

  // No line is highlighted before the click…
  await expect(page.locator('[data-highlighted="true"]')).toHaveCount(0);
  await errors.getByRole('button').first().click();
  // …and exactly one gutter line is highlighted after it — the offending
  // line itself, not just "the click did not error" (review finding 9).
  await expect(page.locator('[data-highlighted="true"]')).toHaveCount(1);
  await expect(page.getByTestId('model-version-badge')).toHaveText(
    'v1 · bootstrap',
  );
});

test('reverts to version 1 from the Versions tab, keeping version 2, and diffs them', async ({
  page,
}) => {
  await page.getByTestId(`dataset-model-${WORLD_CUP_DATASET}`).click();
  await page.getByTestId('tab-yaml').click();
  const textarea = page.getByTestId('yaml-textarea');
  const original = await textarea.inputValue();
  await textarea.fill(addEntityDescription(original, 'matches', 'One played match'));
  await page.getByTestId('save-yaml').click();
  await expect(page.getByTestId('model-version-badge')).toHaveText('v2 · user');

  await page.getByTestId('tab-versions').click();
  await page.getByTestId('revert-1').click();
  await expect(page.getByTestId('model-version-badge')).toHaveText(
    'v1 · bootstrap',
  );
  await expect(page.getByTestId('model-version-2')).toBeVisible();

  // Compare v1 -> v2: click the compare icon on both rows, then see the
  // diff, including a genuine added (+) line (review finding 9), not just
  // the container rendering at all.
  await page.getByTestId('model-version-1').getByTitle('Compare').click();
  await page.getByTestId('model-version-2').getByTitle('Compare').click();
  await expect(page.getByTestId('model-diff')).toBeVisible();
  await expect(
    page.getByTestId('diff-line-added').filter({ hasText: 'One played match' }),
  ).toBeVisible();
});

test('changes a relationship\'s cardinality in the entity form and saves a new version', async ({
  page,
}) => {
  await page.getByTestId(`dataset-model-${WORLD_CUP_DATASET}`).click();
  await page.getByTestId('overview-entity-matches').click();

  const relationship = page.getByTestId('relationship-0');
  await expect(relationship).toBeVisible();
  const cardinalitySelect = page.getByTestId('relationship-cardinality-0');
  const original = await cardinalitySelect.inputValue();
  const next = original === 'many_to_one' ? 'one_to_one' : 'many_to_one';
  await cardinalitySelect.selectOption(next);

  await expect(page.getByTestId('save-entity')).toBeEnabled();
  await page.getByTestId('save-entity').click();
  await expect(page.getByTestId('model-version-badge')).toHaveText(
    'v2 · user',
  );

  // The new cardinality is visible on the Overview tab itself (review
  // finding 9), not only by re-entering the entity form.
  await page.getByTestId('tab-overview').click();
  await expect(
    page.getByTestId('overview-relationship-cardinality-0'),
  ).toHaveText(next);

  await page.getByTestId('overview-entity-matches').click();
  await expect(page.getByTestId('relationship-cardinality-0')).toHaveValue(
    next,
  );
});

test('defines a metric in the Metrics tab; it appears in the list and in the YAML', async ({
  page,
}) => {
  await page.getByTestId(`dataset-model-${WORLD_CUP_DATASET}`).click();
  await page.getByTestId('tab-metrics').click();

  await page.getByTestId('new-model-metric').click();
  // The entity select defaults to the dataset's first included table
  // ("matches", included before "teams" in the Background) — no need to
  // touch it; the default aggregation is "count", which needs no attribute.
  await page.getByPlaceholder('Goals per match').fill('Goals per match');
  await page.getByPlaceholder('goals_per_match').fill('goals_per_match');
  await page.getByTestId('save-model-metric').click();

  await expect(page.getByTestId('model-metric-goals_per_match')).toBeVisible();

  await page.getByTestId('tab-yaml').click();
  await expect(page.getByTestId('yaml-textarea')).toHaveValue(
    /goals_per_match/,
  );
});

test('exports the model; the response is a yaml file, and importing it back creates an equivalent "import" version', async ({
  page,
}) => {
  await page.getByTestId(`dataset-model-${WORLD_CUP_DATASET}`).click();

  // Review findings 3+4: no Electron `download` event, and the filename is
  // built client-side (the Content-Disposition header is unreadable
  // cross-origin under `file://` without CORS `exposedHeaders`) — assert
  // the network response the export button's click actually produces.
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes('/model/export')),
    page.getByTestId('export-model').click(),
  ]);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/yaml');
  const exportedYaml = await response.text();
  expect(exportedYaml).toContain('entities:');

  await page.getByTestId('import-file-input').setInputFiles({
    name: 'reimport.yaml',
    mimeType: 'text/yaml',
    buffer: Buffer.from(exportedYaml, 'utf8'),
  });

  await expect(page.getByTestId('model-version-badge')).toHaveText(
    'v2 · import',
  );

  // "Re-imports identically" (roadmap 1.2.3 acceptance) means apart from
  // the version header `appendVersion` always rewrites (review finding
  // 10) — compare everything else byte-for-byte.
  const reimported = await page.request.get(
    `${BACKEND}/datasets/${encodeURIComponent(WORLD_CUP_DATASET)}/model/versions/2`,
  );
  const reimportedBody = (await reimported.json()) as { yaml: string };
  expect(stripVersionHeader(reimportedBody.yaml)).toBe(
    stripVersionHeader(exportedYaml),
  );
});
