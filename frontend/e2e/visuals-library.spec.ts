import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';

const railItem = (page: Page, name: string) =>
  page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });

const cards = (page: Page) => page.locator('[data-testid^="visual-card-"]');
const cardOf = (page: Page, name: string) =>
  cards(page).filter({
    has: page.getByText(name, { exact: true }),
  });
const groups = (page: Page) =>
  page.locator('[data-testid^="visuals-group-"]');

async function openSection(page: Page): Promise<void> {
  await railItem(page, 'Context').click();
  await page.getByTestId('context-section-visuals').click();
  await expect(page.getByTestId('visuals-section')).toBeVisible();
}

test.describe('Feature: Visuals library', () => {
  test(
    'Browse the library and edit a chart in place',
    { tag: ['@demo', '@story-1.21.12'] },
    async ({ page }) => {
      await scenarioStep(
        page,
        'When I open the Context page and click the "Visuals" card',
        async () => {
          await openSection(page);
        },
      );
      await scenarioStep(
        page,
        'Then I see the charts grouped by category, "Comparison" first',
        async () => {
          await expect(groups(page)).toHaveCount(9);
          await expect(groups(page).first()).toHaveAttribute(
            'data-testid',
            'visuals-group-Comparison',
          );
          await expect(cards(page)).toHaveCount(30);
        },
      );
      await scenarioStep(
        page,
        'When I click the "Part-to-whole" chip',
        async () => {
          await page.getByTestId('visuals-category-Part-to-whole').click();
        },
      );
      await scenarioStep(
        page,
        'Then I see only its 5 charts, "Donut chart" with the badge "Drawn by the app"',
        async () => {
          await expect(cards(page)).toHaveCount(5);
          await expect(cardOf(page, 'Donut chart')).toContainText(
            'Drawn by the app',
          );
          await expect(cardOf(page, 'Pie chart')).not.toContainText(
            'Drawn by the app',
          );
        },
      );
      await scenarioStep(
        page,
        'When I click "All" and type "funnel" in "Search charts"',
        async () => {
          await page.getByTestId('visuals-category-all').click();
          await page.getByTestId('visuals-search').fill('funnel');
        },
      );
      await scenarioStep(
        page,
        'Then only "Funnel chart" is listed, under "Flow"',
        async () => {
          await expect(cards(page)).toHaveCount(1);
          await expect(
            page.getByTestId('visuals-group-Flow').getByText('Funnel chart', {
              exact: true,
            }),
          ).toBeVisible();
        },
      );
      await scenarioStep(
        page,
        'When I clear the search and click the "Pie chart" card',
        async () => {
          await page.getByTestId('visuals-search').fill('');
          await expect(cards(page)).toHaveCount(30);
          await cardOf(page, 'Pie chart').click();
        },
      );
      await scenarioStep(
        page,
        'Then the editor opens in place of the card, with every field filled in',
        async () => {
          const group = page.getByTestId('visuals-group-Part-to-whole');
          await expect(group.getByTestId('visual-chart-form')).toBeVisible();
          await expect(cardOf(page, 'Pie chart')).toHaveCount(0);
          await expect(page.getByTestId('visual-form-name')).toHaveValue(
            'Pie chart',
          );
          await expect(page.getByTestId('visual-form-category')).toHaveValue(
            'Part-to-whole',
          );
          await expect(page.getByTestId('visual-form-preview')).toHaveValue(
            'pie',
          );
          for (const id of [
            'visual-form-description',
            'visual-form-when-to-use',
            'visual-form-when-to-avoid',
            'visual-form-data-shape',
          ]) {
            await expect(page.getByTestId(id)).not.toHaveValue('');
          }
          await expect(page.getByTestId('visual-form-enabled')).toBeChecked();
        },
      );
    },
  );

  test('A new install shows the catalog grouped by category', async ({
    page,
  }) => {
    await test.step('When I open the Context page and click the "Visuals" card', async () => {
      await openSection(page);
    });
    await test.step('Then I see the "Visuals" section and "Context" is still the current rail item', async () => {
      await expect(
        page.getByRole('heading', { name: 'Visuals', exact: true }),
      ).toBeVisible();
      await expect(railItem(page, 'Context')).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
    await test.step('And I see 9 category groups, "Comparison" first and "Numbers and tables" last', async () => {
      await expect(groups(page)).toHaveCount(9);
      await expect(groups(page).first()).toHaveAttribute(
        'data-testid',
        'visuals-group-Comparison',
      );
      await expect(groups(page).last()).toHaveAttribute(
        'data-testid',
        'visuals-group-Numbers and tables',
      );
    });
    await test.step('And I see 30 chart cards, each with a preview thumbnail', async () => {
      await expect(cards(page)).toHaveCount(30);
      await expect(
        cards(page).locator('[data-testid^="visual-preview-"] svg, svg[data-testid^="visual-preview-"]'),
      ).toHaveCount(30);
    });
    await test.step('And "Bar chart" carries the badge "Drawn by the app" and "Radar chart" does not', async () => {
      await expect(cardOf(page, 'Bar chart')).toContainText('Drawn by the app');
      await expect(cardOf(page, 'Radar chart')).not.toContainText(
        'Drawn by the app',
      );
    });
  });
});
