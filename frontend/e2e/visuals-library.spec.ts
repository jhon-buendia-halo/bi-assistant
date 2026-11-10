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

  test('Search narrows the cards', async ({ page }) => {
    await test.step('Given I am on the "Visuals" section', async () => {
      await openSection(page);
    });
    await test.step('When I type "funnel" in "Search charts"', async () => {
      await page.getByTestId('visuals-search').fill('funnel');
    });
    await test.step('Then only "Funnel chart" is listed, under "Flow"', async () => {
      await expect(cards(page)).toHaveCount(1);
      await expect(groups(page)).toHaveCount(1);
      await expect(
        page.getByTestId('visuals-group-Flow').getByText('Funnel chart', {
          exact: true,
        }),
      ).toBeVisible();
    });
    await test.step('When I type "zzzz"', async () => {
      await page.getByTestId('visuals-search').fill('zzzz');
    });
    await test.step('Then I see "No charts match your search."', async () => {
      await expect(page.getByTestId('visuals-no-match')).toHaveText(
        'No charts match your search.',
      );
      await expect(cards(page)).toHaveCount(0);
    });
  });

  test('Filter by category', async ({ page }) => {
    await test.step('Given I am on the "Visuals" section', async () => {
      await openSection(page);
    });
    await test.step('When I click the "Ranking" chip', async () => {
      await page.getByTestId('visuals-category-Ranking').click();
    });
    await test.step('Then I see only the 3 charts of "Ranking"', async () => {
      await expect(cards(page)).toHaveCount(3);
      await expect(groups(page)).toHaveCount(1);
      await expect(page.getByTestId('visuals-group-Ranking')).toBeVisible();
    });
    await test.step('When I click "All"', async () => {
      await page.getByTestId('visuals-category-all').click();
    });
    await test.step('Then I see all 30 charts again', async () => {
      await expect(cards(page)).toHaveCount(30);
    });
  });

  test('Add a chart', async ({ app, page }) => {
    await test.step('Given I am on the "Visuals" section', async () => {
      await openSection(page);
    });
    await test.step('When I click "Add chart"', async () => {
      await page.getByTestId('visuals-add').click();
    });
    await test.step('And I fill Name with "Dot plot" and Category with "Distribution", choose the Preview "Strip", and fill Description', async () => {
      await page.getByTestId('visual-form-name').fill('Dot plot');
      await page.getByTestId('visual-form-category').fill('Distribution');
      await page.getByTestId('visual-form-preview').selectOption('strip');
      await page
        .getByTestId('visual-form-description')
        .fill('One dot per value along a single axis.');
    });
    await test.step('And I click "Save"', async () => {
      await page.getByTestId('visual-form-save').click();
    });
    await test.step('Then "Dot plot" is listed under "Distribution" in name order, without the badge "Drawn by the app"', async () => {
      const group = page.getByTestId('visuals-group-Distribution');
      await expect(group.getByText('Dot plot', { exact: true })).toBeVisible();
      await expect(cardOf(page, 'Dot plot')).not.toContainText(
        'Drawn by the app',
      );
      const names = await group
        .locator('[data-testid^="visual-card-"]')
        .evaluateAll((els) =>
          els.map((el) => el.querySelector('h4, h3, strong, .font-medium, .font-semibold')?.textContent?.trim() ?? ''),
        );
      const shown = names.filter((n) => n.length > 0);
      expect(shown).toEqual(
        [...shown].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' }),
        ),
      );
      await expect(group.locator('[data-testid^="visual-card-"]')).toHaveCount(4);
    });
    await test.step('And it is still listed after the app restarts', async () => {
      await app.restartCli();
      await openSection(page);
      await expect(cardOf(page, 'Dot plot')).toHaveCount(1);
    });
  });

  test('Edit a chart in place', async ({ page }) => {
    const description = 'Slices of a circle, one per category, for a few shares.';
    await test.step('Given the "Visuals" section lists "Pie chart"', async () => {
      await openSection(page);
      await expect(cardOf(page, 'Pie chart')).toHaveCount(1);
    });
    await test.step('When I click its card', async () => {
      await cardOf(page, 'Pie chart').click();
    });
    await test.step('Then the card is replaced by the editor at the same position', async () => {
      const group = page.getByTestId('visuals-group-Part-to-whole');
      await expect(group.getByTestId('visual-chart-form')).toBeVisible();
      await expect(cardOf(page, 'Pie chart')).toHaveCount(0);
      await expect(page.getByTestId('visual-form-name')).toHaveValue(
        'Pie chart',
      );
    });
    await test.step('When I change Description and click "Save"', async () => {
      await page.getByTestId('visual-form-description').fill(description);
      await page.getByTestId('visual-form-save').click();
    });
    await test.step('Then the card shows the new description', async () => {
      await expect(page.getByTestId('visual-chart-form')).toHaveCount(0);
      await expect(cardOf(page, 'Pie chart')).toContainText(description);
    });
    await test.step('And the other cards are unchanged', async () => {
      await expect(cards(page)).toHaveCount(30);
      await expect(cardOf(page, 'Donut chart')).not.toContainText(description);
    });
  });

  test('Disabling a chart fades it', async ({ page }) => {
    await test.step('Given the "Visuals" section lists "Pie chart"', async () => {
      await openSection(page);
    });
    await test.step('When I edit it, clear Enabled and click "Save"', async () => {
      await cardOf(page, 'Pie chart').click();
      await page.getByTestId('visual-form-enabled').uncheck();
      await page.getByTestId('visual-form-save').click();
      await expect(page.getByTestId('visual-chart-form')).toHaveCount(0);
    });
    await test.step('Then its card is faded and carries the badge "Disabled"', async () => {
      const card = cardOf(page, 'Pie chart');
      await expect(card).toContainText('Disabled');
      await expect(card).toHaveClass(/opacity-60/);
      await expect(cardOf(page, 'Donut chart')).not.toContainText('Disabled');
    });
  });

  test('Delete a chart after confirmation', async ({ page }) => {
    await test.step('Given a chart "Dot plot" exists', async () => {
      await openSection(page);
      await page.getByTestId('visuals-add').click();
      await page.getByTestId('visual-form-name').fill('Dot plot');
      await page.getByTestId('visual-form-category').fill('Distribution');
      await page.getByTestId('visual-form-save').click();
      await expect(cardOf(page, 'Dot plot')).toHaveCount(1);
    });
    await test.step('When I edit it, click "Delete" and confirm', async () => {
      await cardOf(page, 'Dot plot').click();
      page.once('dialog', (dialog) => void dialog.accept());
      await page.getByTestId('visual-form-delete').click();
    });
    await test.step('Then "Dot plot" is no longer listed', async () => {
      await expect(cardOf(page, 'Dot plot')).toHaveCount(0);
      await expect(cards(page)).toHaveCount(30);
    });
  });

  test('A duplicate name is refused', async ({ page }) => {
    await test.step('Given the "Visuals" section lists "Bar chart"', async () => {
      await openSection(page);
      await expect(cardOf(page, 'Bar chart')).toHaveCount(1);
    });
    await test.step('When I add a chart named "bar CHART" and click "Save"', async () => {
      await page.getByTestId('visuals-add').click();
      await page.getByTestId('visual-form-name').fill('bar CHART');
      await page.getByTestId('visual-form-category').fill('Comparison');
      await page.getByTestId('visual-form-save').click();
    });
    await test.step('Then I see the message `A chart named "bar CHART" already exists` in the editor', async () => {
      await expect(page.getByTestId('visual-form-error')).toHaveText(
        'A chart named "bar CHART" already exists',
      );
    });
    await test.step('And no second chart is listed', async () => {
      await expect(cards(page)).toHaveCount(30);
    });
  });

  test('A deleted default stays deleted', async ({ app, page }) => {
    await test.step('Given I deleted "Radar chart"', async () => {
      await openSection(page);
      await cardOf(page, 'Radar chart').click();
      page.once('dialog', (dialog) => void dialog.accept());
      await page.getByTestId('visual-form-delete').click();
      await expect(cardOf(page, 'Radar chart')).toHaveCount(0);
    });
    await test.step('When the app restarts', async () => {
      await app.restartCli();
    });
    await test.step('Then "Radar chart" is not listed', async () => {
      await openSection(page);
      await expect(cards(page)).toHaveCount(29);
      await expect(cardOf(page, 'Radar chart')).toHaveCount(0);
    });
    await test.step('And the other 29 default charts are listed', async () => {
      await expect(cardOf(page, 'Bar chart')).toHaveCount(1);
      await expect(cardOf(page, 'Table')).toHaveCount(1);
    });
  });
});
