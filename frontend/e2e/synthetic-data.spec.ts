import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import { seedWorldCupDataset } from './helpers/agents-api';
import { worldCupKey } from './helpers/world-cup-db';
import { scenarioStep } from './support/demo-captions';

/**
 * Feature: Synthetic data (specs/capabilities/synthetic-data/spec.md,
 * roadmap 1.22.x; plan docs/plans/m1-22-synthetic-data.md 3.4).
 *
 * The World Cup dataset is seeded through the API over `matches`; `matches`
 * is small (read in full) and its `stage` column has six distinct values, so
 * the profile reuses them.
 */

const MATCHES = worldCupKey('matches');

test.beforeEach(async ({ page }) => {
  await seedWorldCupDataset(page);
  // The dataset list is read when the app starts.
  await page.reload();
  await expect(page.getByTitle('Settings')).toBeVisible();
});

function rail(page: Page, name: string): Locator {
  return page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });
}

test.describe('Feature: Synthetic data', () => {
  test(
    'Profile a sample of World Cup',
    { tag: ['@demo', '@story-1.22.1'] },
    async ({ page }) => {
      await scenarioStep(
        page,
        'Given I open the "World Cup Core" dataset',
        async () => {
          // Leave the area first so the rail lands on the dataset list.
          await rail(page, 'Context').click();
          await rail(page, 'Datasets').click();
          await page.getByTestId(`dataset-${WORLD_CUP_DATASET}`).click();
        },
      );
      await scenarioStep(
        page,
        'When I open the "Profile & synthesize" tab',
        async () => {
          await page.getByTestId('dataset-tab-synthesize').click();
          await expect(
            page.getByRole('heading', { name: 'Profile & synthesize' }),
          ).toBeVisible();
          await expect(page.getByTestId('synth-table-count')).toHaveText(
            '1 of 1 tables',
          );
        },
      );
      await scenarioStep(page, 'And I click "Profile sample"', async () => {
        await page.getByTestId('synth-profile').click();
      });
      await scenarioStep(
        page,
        'Then I see a card for "matches" whose method reads "Read all … rows"',
        async () => {
          await expect(page.getByTestId('synth-profile-view')).toBeVisible();
          await expect(
            page.getByTestId(`synth-table-card-${MATCHES}`),
          ).toBeVisible();
          await expect(page.getByTestId(`synth-method-${MATCHES}`)).toHaveText(
            /^Read all [\d,]+ rows$/,
          );
        },
      );
      await scenarioStep(
        page,
        'And the "stage" column is generated as "Reuses 6 values"',
        async () => {
          await expect(
            page.getByTestId(`synth-col-${MATCHES}-stage`),
          ).toContainText('Reuses 6 values');
        },
      );
    },
  );
});
