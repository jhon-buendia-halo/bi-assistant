import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { apiFetch, apiJson } from './helpers/api';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import {
  createOntologyItem,
  saveLenaiSettings,
  seedDataset,
  seedWorldCupDataset,
} from './helpers/agents-api';
import { startLlmStub, type LlmStub } from './helpers/llm-stub';
import { worldCupKey } from './helpers/world-cup-db';

/**
 * Feature: Dataset ontology (specs/capabilities/dataset-ontology/spec.md,
 * roadmap 1.21.7–1.21.11). Every scenario drives the Ontology tab of a saved
 * dataset, the Graph view or the Context → Ontologies card, none of which
 * exist on `main` (it had a flat Knowledge screen), so each fails there.
 *
 * The World Cup dataset is seeded through the API over `matches` with one
 * column (`match_number`); items the scenario's Given names are seeded with
 * `createOntologyItem`. The migration scenario is covered API-level in
 * backend/test/app.e2e-spec.ts; the two chat scenarios ("An answer lists the
 * ontology it was given", "Disabled items are never sent") are not covered
 * here.
 */

const MATCHES = worldCupKey('matches');
const OTHER_DATASET = 'Formula 1';
const BOOTSTRAP_PROMPT = 'Draft ontology items for the dataset below.';

/** A list row (not the form, the summary or the checkbox, which share the prefix). */
const ROW = 'div[data-testid^="ontology-item-"]:not([data-testid="ontology-item-form"])';

let datasourceId: string;

test.beforeEach(async ({ page }) => {
  datasourceId = await seedWorldCupDataset(page);
  // The dataset list is read when the app starts.
  await page.reload();
  await expect(page.getByTitle('Settings')).toBeVisible();
});

function rail(page: Page, name: string): Locator {
  return page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });
}

async function openDatasets(page: Page): Promise<void> {
  // The rail keeps an area's current view when it is already shown (the
  // dataset editor included), so leave the area first to land on the list.
  await rail(page, 'Context').click();
  await rail(page, 'Datasets').click();
  await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible();
}

async function openOntologyTab(page: Page, dataset = WORLD_CUP_DATASET) {
  await openDatasets(page);
  await page.getByTestId(`dataset-${dataset}`).click();
  await page.getByTestId('dataset-tab-ontology').click();
  await expect(
    page.getByRole('heading', { name: 'Ontology', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Loading ontology…')).toHaveCount(0);
}

function section(page: Page, kind: string): Locator {
  return page.getByTestId(`ontology-section-${kind}`);
}

/** The list row of the item named `name` inside `scope`. */
function row(scope: Locator, name: string): Locator {
  return scope.locator(ROW).filter({
    has: scope.page().getByRole('button', { name: `Edit ${name}`, exact: true }),
  });
}

function toast(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).first();
}

interface ListedItem {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  source: string;
  dataset: string | null;
}

async function listItems(page: Page, dataset = WORLD_CUP_DATASET) {
  return apiJson<ListedItem[]>(
    page,
    'GET',
    `/datasets/${encodeURIComponent(dataset)}/ontology`,
  );
}

async function seedConcept(page: Page, name: string, description: string) {
  return createOntologyItem(page, WORLD_CUP_DATASET, {
    kind: 'concept',
    name,
    description,
    mappings: [{ entity: MATCHES }],
  });
}

test('opens the Ontology tab of a saved dataset', async ({ page }) => {
  await test.step('Given a dataset "World Cup Core" exists with no ontology items', async () => {
    expect(await listItems(page)).toEqual([]);
  });

  await test.step('When I open it from the Datasets list', async () => {
    await openDatasets(page);
    await page.getByTestId(`dataset-${WORLD_CUP_DATASET}`).click();
  });

  await test.step('Then I see the tabs "Schema" and "Ontology"', async () => {
    await expect(page.getByTestId('dataset-tab-schema')).toHaveText('Schema');
    await expect(page.getByTestId('dataset-tab-ontology')).toHaveText(
      'Ontology',
    );
    await expect(page.getByTestId('dataset-tab-schema')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  await test.step('When I click the "Ontology" tab', async () => {
    await page.getByTestId('dataset-tab-ontology').click();
  });

  await test.step('Then I see "No ontology yet" and the actions "New item" and "Generate suggestions"', async () => {
    await expect(page.getByTestId('ontology-panel')).toBeVisible();
    await expect(page.getByText('No ontology yet')).toBeVisible();
    await expect(page.getByTestId('new-ontology-item')).toHaveText('New item');
    await expect(page.getByTestId('open-generate-suggestions')).toHaveText(
      'Generate suggestions',
    );
  });
});

test('a new dataset has no tabs', async ({ page }) => {
  await test.step('When I click "New dataset"', async () => {
    await openDatasets(page);
    await page.getByRole('button', { name: 'New dataset' }).click();
    await expect(
      page.getByRole('heading', { name: 'New dataset' }),
    ).toBeVisible();
  });

  await test.step('Then I see the catalog browser and no "Ontology" tab', async () => {
    await expect(page.getByPlaceholder('Dataset name')).toBeVisible();
    await expect(page.getByTestId('dataset-tab-schema')).toHaveCount(0);
    await expect(page.getByTestId('dataset-tab-ontology')).toHaveCount(0);
  });
});

test('creates a concept with a column mapping', async ({ page }) => {
  await test.step('Given I am on the Ontology tab of "World Cup Core"', async () => {
    await openOntologyTab(page);
  });

  const form = page.getByTestId('ontology-item-form');

  await test.step('When I click "New item" and choose Kind "Concept"', async () => {
    await page.getByTestId('new-ontology-item').click();
    // New item opens its editor at the top of the list.
    await expect(page.getByTestId('ontology-form-anchor')).not.toHaveAttribute(
      'data-editing',
      /.+/,
    );
    await form.getByTestId('ontology-kind').selectOption('concept');
  });

  await test.step('And I fill Name with "Match" and Definition with "One played fixture"', async () => {
    await form.getByTestId('ontology-name').fill('Match');
    await form.getByTestId('ontology-description').fill('One played fixture');
    await expect(form.getByTestId('mapping-empty')).toHaveText(
      'Not mapped yet.',
    );
  });

  await test.step('And I click "Add mapping", choose the table "matches" and the column "match_number"', async () => {
    await form.getByTestId('add-mapping').click();
    const picker = form.getByTestId('mapping-picker');
    await expect(picker).toBeVisible();
    // Save waits while the picker is open; Add waits for a complete target.
    await expect(form.getByTestId('save-ontology-item')).toBeDisabled();
    await picker.getByTestId('mapping-entity').selectOption(MATCHES);
    await picker.getByTestId('mapping-target-column').check();
    await expect(picker.getByTestId('mapping-commit')).toBeDisabled();
    await picker.getByTestId('mapping-column').selectOption('match_number');
    await picker.getByTestId('mapping-commit').click();
  });

  await test.step('Then the mapping reads as a sentence', async () => {
    const sentence = form.getByTestId('mapping-sentence');
    await expect(sentence).toHaveText(/matches\s*→\s*column\s*match_number/);
    await expect(sentence).toHaveAttribute('title', /world_cup\.matches/);
  });

  await test.step('And I click "Create item"', async () => {
    await expect(form.getByTestId('save-ontology-item')).toHaveText(
      'Create item',
    );
    await form.getByTestId('save-ontology-item').click();
  });

  await test.step('Then I see the toast "Item created"', async () => {
    await expect(toast(page, 'Item created')).toBeVisible();
  });

  await test.step('And "Match" is listed under "Concepts" as "Enabled", its summary showing the mapping', async () => {
    const match = row(section(page, 'concept'), 'Match');
    await expect(match).toBeVisible();
    await expect(match.getByTestId('ontology-item-enabled')).toBeChecked();
    await expect(match).toContainText('Enabled');
    await expect(match.getByTestId('ontology-item-summary')).toHaveText(
      `One played fixture · maps to ${MATCHES}.match_number`,
    );
    const [stored] = await listItems(page);
    expect(stored).toMatchObject({
      kind: 'concept',
      name: 'Match',
      source: 'user',
      enabled: true,
      dataset: WORLD_CUP_DATASET,
      mappings: [{ entity: MATCHES, column: 'match_number' }],
    });
  });
});

test('creates a relation and a measured-by relation', async ({ page }) => {
  let metricId = '';
  await test.step('Given the concepts "Match" and "Goal" exist and a metric "goals_total" exists', async () => {
    await seedConcept(page, 'Match', 'One played fixture');
    await seedConcept(page, 'Goal', 'A goal scored in a match');
    const res = await apiJson<{ ok: boolean; message: string; metric: { id: string } }>(
      page,
      'POST',
      '/metrics',
      {
        name: 'goals_total',
        label: 'Total goals',
        entity: MATCHES,
        expression: 'SUM(home_team_score + away_team_score)',
        datasourceId,
      },
    );
    expect(res.ok, res.message).toBe(true);
    metricId = res.metric.id;
    await openOntologyTab(page);
  });

  const form = page.getByTestId('ontology-item-form');

  await test.step('When I create a relation From "Match", Relation "has-many", To "Goal"', async () => {
    await page.getByTestId('new-ontology-item').click();
    await form.getByTestId('ontology-kind').selectOption('relation');
    await expect(form.getByTestId('save-ontology-item')).toBeDisabled();
    await form.getByTestId('relation-from').selectOption({ label: 'Match' });
    await form.getByTestId('relation-type').selectOption('has-many');
    await form.getByTestId('relation-to').selectOption({ label: 'Goal' });
    await form.getByTestId('save-ontology-item').click();
    await expect(toast(page, 'Item created')).toBeVisible();
  });

  await test.step('Then "Match has-many Goal" is listed under "Relations"', async () => {
    await expect(
      section(page, 'relation').getByTestId('ontology-item-summary'),
    ).toHaveText(['Match has-many Goal']);
  });

  await test.step('When I create a relation From "Goal", Relation "measured-by", Metric "goals_total"', async () => {
    await page.getByTestId('new-ontology-item').click();
    await form.getByTestId('ontology-kind').selectOption('relation');
    await form.getByTestId('relation-from').selectOption({ label: 'Goal' });
    await form.getByTestId('relation-type').selectOption('measured-by');
    // measured-by asks for a metric in place of the To concept.
    await expect(form.getByTestId('relation-to')).toHaveCount(0);
    await expect(form.getByTestId('save-ontology-item')).toBeDisabled();
    await form.getByTestId('relation-metric').selectOption({ label: 'Total goals' });
    await form.getByTestId('save-ontology-item').click();
    await expect(form).toHaveCount(0);
  });

  await test.step("Then the relation is listed with the metric's label", async () => {
    await expect(
      section(page, 'relation').getByTestId('ontology-item-summary').first(),
    ).toHaveText('Goal measured-by Total goals');
    const relations = (await listItems(page)).filter((i) => i.kind === 'relation');
    expect(relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'measured-by', metricId }),
      ]),
    );
  });
});

test('creates a constraint', async ({ page }) => {
  await openOntologyTab(page);
  const form = page.getByTestId('ontology-item-form');

  await test.step('When I click "New item", choose Kind "Constraint" and fill Name and Predicate', async () => {
    await page.getByTestId('new-ontology-item').click();
    await form.getByTestId('ontology-kind').selectOption('constraint');
    await form.getByTestId('ontology-name').fill('Exclude friendlies');
    await expect(form.getByTestId('save-ontology-item')).toBeDisabled();
    await form.getByTestId('constraint-predicate').fill("stage <> 'friendly'");
    await form.getByTestId('save-ontology-item').click();
  });

  await test.step('Then "Exclude friendlies" is listed under "Constraints" as "Enabled"', async () => {
    const constraint = row(section(page, 'constraint'), 'Exclude friendlies');
    await expect(constraint).toBeVisible();
    await expect(constraint.getByTestId('ontology-item-summary')).toHaveText(
      "stage <> 'friendly'",
    );
    await expect(constraint.getByTestId('ontology-item-enabled')).toBeChecked();
  });
});

test('a shared item appears in another dataset\'s tab', async ({ page }) => {
  await test.step('Given a second dataset "Formula 1" exists', async () => {
    await seedDataset(page, OTHER_DATASET, datasourceId);
    await page.reload();
    await expect(page.getByTitle('Settings')).toBeVisible();
  });

  await test.step('When I create an instruction "Currency" and tick "Share with all datasets"', async () => {
    await openOntologyTab(page);
    const form = page.getByTestId('ontology-item-form');
    await page.getByTestId('new-ontology-item').click();
    await form.getByTestId('ontology-kind').selectOption('instruction');
    await form.getByTestId('ontology-name').fill('Currency');
    await form.getByTestId('ontology-description').fill('All amounts are in USD');
    await form.getByTestId('ontology-shared').check();
    await form.getByTestId('save-ontology-item').click();
    await expect(toast(page, 'Item created')).toBeVisible();
    await expect(
      row(section(page, 'instruction'), 'Currency').getByTestId('shared-chip'),
    ).toHaveText('All datasets');
  });

  await test.step('And I open the Ontology tab of "Formula 1"', async () => {
    await openOntologyTab(page, OTHER_DATASET);
  });

  await test.step('Then I see "Currency" with the badge "All datasets"', async () => {
    const currency = row(section(page, 'instruction'), 'Currency');
    await expect(currency).toBeVisible();
    await expect(currency.getByTestId('shared-chip')).toHaveText('All datasets');
    const [stored] = await listItems(page, OTHER_DATASET);
    expect(stored).toMatchObject({ name: 'Currency', dataset: null });
  });
});

test('validation messages', async ({ page }) => {
  await test.step('Given the "New item" panel is open, Kind "Concept" with a blank Name', async () => {
    await openOntologyTab(page);
    const form = page.getByTestId('ontology-item-form');
    await page.getByTestId('new-ontology-item').click();
    await form.getByTestId('ontology-kind').selectOption('concept');
    await form.getByTestId('ontology-description').fill('Defined, but unnamed');
    await form.getByTestId('ontology-name').fill('   ');
    await expect(form.getByTestId('save-ontology-item')).toBeDisabled();
  });

  const route = `/datasets/${encodeURIComponent(WORLD_CUP_DATASET)}/ontology`;

  await test.step('When a mapping entity is not in the dataset (API), the request is refused', async () => {
    const outside = 'world_cup.world_cup.not_a_table';
    const res = await apiFetch(page, 'POST', route, {
      kind: 'concept',
      name: 'Stadium',
      description: 'Where a match is played',
      mappings: [{ entity: outside }],
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toBe(
      `Entity "${outside}" is not in dataset "${WORLD_CUP_DATASET}"`,
    );
  });

  await test.step('When a relation\'s From concept is not in this ontology (API), the request is refused', async () => {
    const goal = await seedConcept(page, 'Goal', 'A goal scored in a match');
    const res = await apiFetch(page, 'POST', route, {
      kind: 'relation',
      from: 'no-such-concept',
      type: 'related-to',
      to: goal,
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toBe(
      'Concept "no-such-concept" is not in this ontology',
    );
  });
});

test('edits an item in place', async ({ page }) => {
  let matchId = '';
  await test.step('Given the concept "Match" exists among others', async () => {
    matchId = await seedConcept(page, 'Match', 'One played fixture');
    await seedConcept(page, 'Goal', 'A goal scored in a match');
    await seedConcept(page, 'Tournament', 'A World Cup edition');
    await openOntologyTab(page);
  });

  const concepts = section(page, 'concept');

  await test.step('When I click its row (the oldest, at the bottom)', async () => {
    await expect(concepts.locator(ROW)).toHaveCount(3);
    await row(concepts, 'Match').getByTestId('open-ontology-item').click();
  });

  await test.step('Then its editor opens in place of that row, not at the top of the list', async () => {
    const anchor = concepts.locator(
      `[data-testid="ontology-form-anchor"][data-editing="${matchId}"]`,
    );
    await expect(anchor).toBeVisible();
    await expect(page.getByTestId('ontology-form-anchor')).toHaveCount(1);
    await expect(page.getByTestId(`ontology-item-${matchId}`)).toHaveCount(0);
    // The newer rows stay above it.
    const tournament = await row(concepts, 'Tournament').boundingBox();
    const editor = await anchor.boundingBox();
    expect(tournament && editor && editor.y > tournament.y).toBe(true);
    await expect(anchor.getByText('Edit ontology item')).toBeVisible();
    await expect(anchor.getByTestId('ontology-kind')).toBeDisabled();
    await expect(anchor.getByTestId('ontology-name')).toHaveValue('Match');
    await expect(anchor.getByTestId('ontology-shared')).toHaveCount(0);
  });

  await test.step('When I change the Definition and click "Save changes"', async () => {
    const anchor = page.getByTestId('ontology-form-anchor');
    await anchor.getByTestId('ontology-description').fill('One played World Cup fixture');
    await expect(anchor.getByTestId('save-ontology-item')).toHaveText('Save changes');
    await anchor.getByTestId('save-ontology-item').click();
  });

  await test.step('Then I see the toast "Item updated" and the list shows the new definition', async () => {
    await expect(toast(page, 'Item updated')).toBeVisible();
    await expect(page.getByTestId('ontology-form-anchor')).toHaveCount(0);
    await expect(
      page.getByTestId(`ontology-item-${matchId}`).getByTestId('ontology-item-summary'),
    ).toHaveText(/^One played World Cup fixture/);
  });
});

test('disables an item so the assistant stops using it', async ({ page }) => {
  await seedConcept(page, 'Match', 'One played fixture');
  await openOntologyTab(page);
  const match = row(section(page, 'concept'), 'Match');

  await test.step('When I untick its "Enabled" checkbox', async () => {
    await match.getByTestId('ontology-item-enabled').uncheck();
  });

  await test.step('Then I see the toast "Item disabled" and the label reads "Disabled"', async () => {
    await expect(toast(page, 'Item disabled')).toBeVisible();
    await expect(match).toContainText('Disabled');
    const [stored] = await listItems(page);
    expect(stored.enabled).toBe(false);
  });
});

test('deleting a concept deletes its relations', async ({ page }) => {
  let relationId = '';
  await test.step('Given "Match", "Goal" and "Match has-many Goal" exist', async () => {
    const match = await seedConcept(page, 'Match', 'One played fixture');
    const goal = await seedConcept(page, 'Goal', 'A goal scored in a match');
    relationId = await createOntologyItem(page, WORLD_CUP_DATASET, {
      kind: 'relation',
      from: match,
      type: 'has-many',
      to: goal,
    });
    await openOntologyTab(page);
    await expect(page.getByTestId(`ontology-item-${relationId}`)).toBeVisible();
  });

  let asked = '';
  await test.step('When I click Delete on "Match" and confirm', async () => {
    page.once('dialog', (dialog) => {
      asked = dialog.message();
      void dialog.accept();
    });
    await row(section(page, 'concept'), 'Match')
      .getByTestId('delete-ontology-item')
      .click();
  });

  await test.step('Then I was asked to confirm that its relations go too', async () => {
    await expect(toast(page, 'Item deleted')).toBeVisible();
    expect(asked).toContain('Delete “Match”?');
    expect(asked).toContain('The assistant will stop using it.');
    expect(asked).toContain('Its relations are deleted too.');
  });

  await test.step('And "Match" and its relation are gone while "Goal" stays', async () => {
    await expect(row(section(page, 'concept'), 'Match')).toHaveCount(0);
    await expect(page.getByTestId(`ontology-item-${relationId}`)).toHaveCount(0);
    await expect(section(page, 'relation')).toContainText('No relations yet.');
    await expect(row(section(page, 'concept'), 'Goal')).toBeVisible();
    expect((await listItems(page)).map((i) => i.name)).toEqual(['Goal']);
  });
});

test.describe('ontology bootstrap', () => {
  let stub: LlmStub;

  test.beforeEach(async ({ page }) => {
    stub = await startLlmStub();
    await saveLenaiSettings(page, stub.baseUrl);
  });

  test.afterEach(async () => {
    await stub.close();
  });

  const isBootstrap = (request: { messages: { role: string; content?: unknown }[] }) =>
    request.messages.some(
      (m) => m.role === 'user' && JSON.stringify(m.content ?? '').includes(BOOTSTRAP_PROMPT),
    );

  test('generates suggestions, then accepts and rejects them', async ({ page }) => {
    stub.reply = (request) =>
      isBootstrap(request)
        ? {
            text: JSON.stringify({
              drafts: [
                {
                  kind: 'concept',
                  name: 'Match',
                  description: 'One played fixture',
                  mappings: [{ entity: MATCHES, column: 'match_number' }],
                },
                {
                  kind: 'concept',
                  name: 'Tournament',
                  description: 'A World Cup edition',
                },
                { kind: 'relation', from: 'Match', type: 'part-of', to: 'Tournament' },
              ],
            }),
          }
        : { text: 'unexpected call' };

    await test.step('Given an LLM is configured and I am on the Ontology tab', async () => {
      await openOntologyTab(page);
    });

    await test.step('When I click "Generate suggestions" and click "Generate"', async () => {
      await page.getByTestId('open-generate-suggestions').click();
      await expect(page.getByTestId('generate-panel')).toContainText(
        'nothing is applied until you accept it',
      );
      await page.getByTestId('run-generate-suggestions').click();
    });

    await test.step('Then a toast says "3 suggestions generated" and I am shown the Pending suggestions view', async () => {
      await expect(
        toast(page, '3 suggestions generated — review in Pending suggestions'),
      ).toBeVisible({ timeout: 30_000 });
      expect(stub.requests.filter(isBootstrap)).toHaveLength(1);
      await expect(page.getByTestId('pending-suggestions-filter')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByTestId('pending-count')).toHaveText('3');
      const pending = page.getByTestId('pending-list');
      await expect(pending.locator(ROW)).toHaveCount(3);
    });

    await test.step('And each suggestion is badged "Mined" and is not enabled', async () => {
      const pending = page.getByTestId('pending-list');
      for (const name of ['Match', 'Tournament']) {
        await expect(row(pending, name)).toContainText('Mined');
      }
      await expect(pending.getByTestId('ontology-item-summary')).toContainText([
        'Match part-of Tournament',
      ]);
      const stored = await listItems(page);
      expect(stored).toHaveLength(3);
      for (const item of stored) {
        expect(item).toMatchObject({ source: 'mined', enabled: false, dataset: WORLD_CUP_DATASET });
      }
    });

    await test.step('When I click "Accept" on "Match"', async () => {
      await row(page.getByTestId('pending-list'), 'Match')
        .getByTestId('accept-suggestion')
        .click();
    });

    await test.step('Then I see "Item enabled" and it leaves the pending view, enabled in the full list', async () => {
      await expect(toast(page, 'Item enabled')).toBeVisible();
      await expect(row(page.getByTestId('pending-list'), 'Match')).toHaveCount(0);
      await expect(page.getByTestId('pending-count')).toHaveText('2');
      await page.getByTestId('ontology-filter-all').click();
      const match = row(section(page, 'concept'), 'Match');
      await expect(match.getByTestId('ontology-item-enabled')).toBeChecked();
      await expect(match).toContainText('Mined');
    });

    await test.step('When I reject "Tournament" and confirm, it is permanently deleted', async () => {
      await page.getByTestId('pending-suggestions-filter').click();
      let asked = '';
      page.once('dialog', (dialog) => {
        asked = dialog.message();
        void dialog.accept();
      });
      await row(page.getByTestId('pending-list'), 'Tournament')
        .getByTestId('reject-suggestion')
        .click();
      await expect(toast(page, 'Item deleted')).toBeVisible();
      expect(asked).toContain('Reject “Tournament”?');
      expect(asked).toContain('This permanently removes the suggestion.');
      const names = (await listItems(page)).map((i) => i.name);
      expect(names).not.toContain('Tournament');
      expect(names).toContain('Match');
    });
  });

  test('generation fails without adding suggestions', async ({ page }) => {
    stub.reply = () => ({ text: 'I cannot produce drafts today.' });
    await openOntologyTab(page);

    await test.step('When I click "Generate" and the model answers no usable drafts', async () => {
      await page.getByTestId('open-generate-suggestions').click();
      await page.getByTestId('run-generate-suggestions').click();
    });

    await test.step('Then an error toast appears and no suggestion is added', async () => {
      await expect(toast(page, /^Ontology bootstrap failed: /)).toBeVisible({
        timeout: 30_000,
      });
      expect(await listItems(page)).toEqual([]);
      await expect(page.getByTestId('pending-count')).toHaveCount(0);
    });
  });
});

test('sees the ontology as a graph and edits a concept from it', async ({ page }) => {
  let matchId = '';
  let tournamentId = '';
  let relationId = '';
  await test.step('Given "Match", "Tournament" and "Match part-of Tournament"', async () => {
    matchId = await seedConcept(page, 'Match', 'One played fixture');
    tournamentId = await seedConcept(page, 'Tournament', 'A World Cup edition');
    relationId = await createOntologyItem(page, WORLD_CUP_DATASET, {
      kind: 'relation',
      from: matchId,
      type: 'part-of',
      to: tournamentId,
    });
    await openOntologyTab(page);
  });

  await test.step('When I choose "Graph" in the filter row', async () => {
    await page.getByTestId('ontology-filter-graph').click();
    await expect(page.getByTestId('ontology-filter-graph')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  await test.step('Then I see the nodes joined by an arrow labelled "part-of"', async () => {
    await expect(page.getByTestId('ontology-graph')).toBeVisible();
    await expect(page.getByTestId(`ontology-graph-node-${matchId}`)).toContainText('Match');
    await expect(page.getByTestId(`ontology-graph-node-${tournamentId}`)).toContainText(
      'Tournament',
    );
    await expect(page.getByTestId(`ontology-graph-edge-${relationId}`)).toContainText(
      'part-of',
    );
    await expect(page.getByTestId('ontology-section-concept')).toHaveCount(0);
  });

  await test.step('When I click the node "Match", its details are shown', async () => {
    await page.getByTestId(`ontology-graph-node-${matchId}`).click();
    const details = page.getByTestId('ontology-graph-details');
    await expect(details).toBeVisible();
    await expect(details.getByTestId('ontology-graph-details-kind')).toHaveText('Concept');
    await expect(details).toContainText('Match');
    await expect(details).toContainText('One played fixture');
    await expect(page.getByTestId(`ontology-graph-node-${matchId}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  await test.step('And clicking "Edit" opens the concept editor under the graph', async () => {
    await page.getByTestId('ontology-graph-edit').click();
    const anchor = page.getByTestId('ontology-form-anchor');
    await expect(anchor).toBeVisible();
    await expect(anchor.getByTestId('ontology-name')).toHaveValue('Match');
    const graph = await page.getByTestId('ontology-graph').boundingBox();
    const editor = await anchor.boundingBox();
    expect(graph && editor && editor.y >= graph.y + graph.height - 1).toBe(true);
    await anchor.getByRole('button', { name: 'Cancel' }).click();
  });

  await test.step('And choosing "All" shows the list again', async () => {
    await page.getByTestId('ontology-filter-all').click();
    await expect(page.getByTestId('ontology-graph')).toHaveCount(0);
    await expect(row(section(page, 'concept'), 'Match')).toBeVisible();
  });
});

test("reviews every dataset's ontology from Context", async ({ page }) => {
  await test.step('Given "World Cup Core" has 2 concepts and 1 relation, a shared item exists, and "Formula 1" has none', async () => {
    const match = await seedConcept(page, 'Match', 'One played fixture');
    const goal = await seedConcept(page, 'Goal', 'A goal scored in a match');
    await createOntologyItem(page, WORLD_CUP_DATASET, {
      kind: 'relation',
      from: match,
      type: 'has-many',
      to: goal,
    });
    await createOntologyItem(page, WORLD_CUP_DATASET, {
      kind: 'instruction',
      name: 'Currency',
      description: 'All amounts are in USD',
      shared: true,
    });
    await seedDataset(page, OTHER_DATASET, datasourceId);
  });

  await test.step('When I open "Context" and click the "Ontologies" card', async () => {
    await rail(page, 'Context').click();
    await page.getByTestId('context-section-ontologies').click();
    await expect(page.getByTestId('ontology-overview')).toBeVisible();
  });

  await test.step('Then each dataset shows the size of its own ontology, shared items counted once', async () => {
    await expect(page.getByTestId('ontologies-shared')).toContainText(
      '1 shared item applies to every dataset.',
    );
    await expect(page.getByTestId(`ontology-dataset-${WORLD_CUP_DATASET}`)).toContainText(
      '2 concepts · 1 relation',
    );
    await expect(page.getByTestId(`ontology-dataset-${WORLD_CUP_DATASET}`)).not.toContainText(
      'instruction',
    );
    await expect(page.getByTestId(`ontology-dataset-${OTHER_DATASET}`)).toContainText(
      'No ontology yet',
    );
    // Sorted by name.
    await expect(page.getByTestId('ontologies-list').locator('button')).toHaveText([
      new RegExp(OTHER_DATASET),
      new RegExp(WORLD_CUP_DATASET),
    ]);
  });

  await test.step('When I click "World Cup Core", I see its Ontology panel under an "Ontologies" back control', async () => {
    await page.getByTestId(`ontology-dataset-${WORLD_CUP_DATASET}`).click();
    await expect(page.getByTestId('ontologies-back')).toHaveText('Ontologies');
    await expect(page.getByTestId('ontology-panel')).toBeVisible();
    await expect(row(section(page, 'concept'), 'Match')).toBeVisible();
    await expect(row(section(page, 'instruction'), 'Currency')).toContainText(
      'All datasets',
    );
  });

  await test.step('And the back control returns to the list with fresh counts', async () => {
    await createOntologyItem(page, WORLD_CUP_DATASET, {
      kind: 'constraint',
      name: 'Exclude friendlies',
      predicate: "stage <> 'friendly'",
    });
    await page.getByTestId('ontologies-back').click();
    await expect(page.getByTestId(`ontology-dataset-${WORLD_CUP_DATASET}`)).toContainText(
      '2 concepts · 1 relation · 1 constraint',
    );
  });
});
