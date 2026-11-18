import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASET,
  createWorldCupDatasource,
  createWorldCupDataset,
} from './helpers/app-actions';

/**
 * M1-26 (app-shell R58–R63, datasets R51–R54): long work keeps running when
 * the user leaves its screen; the rail's Background tasks button shows it.
 */
test('a dataset save keeps running in the background while the user is elsewhere', async ({
  page,
}) => {
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page);

  // Hold the next save for a few seconds so it can be watched while it runs.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/datasets', async (route) => {
    if (route.request().method() === 'POST') await held;
    await route.continue();
  });

  const rail = page.getByRole('complementary', { name: 'Navigation rail' });
  const tasksButton = rail.getByTestId('background-tasks-button');
  await expect(tasksButton).toHaveAccessibleName('Background tasks');

  await test.step('Saving returns to the list at once, with the row marked Saving', async () => {
    await page.getByTestId(`dataset-${WORLD_CUP_DATASET}`).click();
    await page.getByRole('button', { name: /^Save dataset/ }).click();
    await expect(
      page.getByTestId(`dataset-${WORLD_CUP_DATASET}`),
    ).toBeVisible();
    await expect(page.getByTestId('dataset-saving-chip')).toBeVisible();
    await expect(tasksButton).toHaveAccessibleName(
      'Background tasks, 1 running',
    );
  });

  await test.step('Another area: the save is still listed as running', async () => {
    await rail.getByRole('button', { name: 'User journeys', exact: true }).click();
    await tasksButton.click();
    const panel = page.getByRole('dialog', { name: 'Background tasks' });
    await expect(panel).toBeVisible();
    // The first save (setup) is listed as finished; this one runs.
    const row = panel
      .getByRole('list', { name: 'Running tasks' })
      .getByTestId('background-task');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(`Saving dataset "${WORLD_CUP_DATASET}"`);
    await expect(row).toHaveAttribute('data-status', 'running');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  await test.step('Back on Datasets the row is still Saving; then the save ends', async () => {
    await rail.getByRole('button', { name: 'Datasets', exact: true }).click();
    await expect(page.getByTestId('dataset-saving-chip')).toBeVisible();
    release();
    await expect(page.getByTestId('dataset-saving-chip')).toHaveCount(0);
    await expect(tasksButton).toHaveAccessibleName('Background tasks');
    const toast = page
      .getByRole('region', { name: 'Notifications' })
      .getByText(`Dataset "${WORLD_CUP_DATASET}" saved`, { exact: false })
      .last();
    await expect(toast).toBeVisible();
  });

  await test.step('The panel lists it as finished, with Open', async () => {
    await tasksButton.click();
    const panel = page.getByRole('dialog', { name: 'Background tasks' });
    // Newest first: this save, then the setup's.
    const row = panel
      .getByRole('list', { name: 'Finished tasks' })
      .getByTestId('background-task')
      .first();
    await expect(row).toContainText(`Saving dataset "${WORLD_CUP_DATASET}"`);
    await expect(row).toHaveAttribute('data-status', 'done');
    await row.getByRole('button', { name: 'Open' }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByPlaceholder('Dataset name')).toHaveValue(
      WORLD_CUP_DATASET,
    );
  });
});
