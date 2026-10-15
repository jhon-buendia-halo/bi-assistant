import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.fixture';

const rail = (page: Page) =>
  page.getByRole('complementary', { name: 'Navigation rail' });

/** The session list in the middle of the Sessions page. */
const sessionsList = (page: Page) =>
  page.getByRole('navigation', { name: 'Sessions', exact: true });

const railItem = (page: Page, name: string) =>
  rail(page).getByRole('button', { name, exact: true });

async function expectCurrent(page: Page, name: string): Promise<void> {
  await expect(railItem(page, name)).toHaveAttribute('aria-current', 'page');
}

test('moves between areas from the rail', async ({ page }) => {
  await railItem(page, 'Datasets').click();
  await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible();
  await expectCurrent(page, 'Datasets');

  await railItem(page, 'Agents').click();
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  await expectCurrent(page, 'Agents');
  await expect(railItem(page, 'Datasets')).not.toHaveAttribute('aria-current');

  await railItem(page, 'Agents').click();
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  await expectCurrent(page, 'Agents');

  await railItem(page, 'Knowledge').click();
  await expectCurrent(page, 'Knowledge');

  await railItem(page, 'Sessions').click();
  await expectCurrent(page, 'Sessions');
  await expect(sessionsList(page)).toBeVisible();
  await expect(
    page
      .locator('header')
      .getByRole('button', { name: 'Start New Conversation' }),
  ).toBeVisible();
  // The drawer does not list sessions.
  await expect(
    page.getByRole('navigation', { name: 'Sessions navigation' }),
  ).toHaveCount(0);
});

test('the start page explains how the product works', async ({ page }) => {
  await expect(
    page.getByRole('heading', { name: 'Welcome to Agentic Hub' }),
  ).toBeVisible();
  const steps = [
    'Pick your data',
    'Ask a question',
    'Work with an agent',
    'Read, refine, download',
  ];
  for (const [index, step] of steps.entries()) {
    await expect(page.getByTestId(`welcome-step-${index + 1}`)).toContainText(
      step,
    );
  }
});

test('opens with the navigation drawer expanded', async ({ page }) => {
  await expect(
    page.getByRole('button', { name: 'Collapse navigation' }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByText('Datasets', { exact: true }),
  ).toBeVisible();
});

test('remembers a collapsed drawer after a restart', async ({
  app,
  appDataDir,
  launchApp,
}) => {
  await app.page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(
    app.page.getByRole('button', { name: 'Expand navigation' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await app.close();

  // A fresh browser profile on the same data: only the database remembers.
  const second = await launchApp(appDataDir);
  await expect(
    second.page.getByRole('button', { name: 'Expand navigation' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await second.page.getByRole('button', { name: 'Expand navigation' }).click();
  await second.close();

  const third = await launchApp(appDataDir);
  await expect(
    third.page.getByRole('button', { name: 'Collapse navigation' }),
  ).toHaveAttribute('aria-expanded', 'true');
});

test('expands the rail into a drawer with labels', async ({ page }) => {
  // Given the navigation drawer is collapsed
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  const menu = page.getByRole('button', { name: 'Expand navigation' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');

  await menu.click();
  const workspace = page.getByRole('navigation', {
    name: 'Workspace navigation',
  });
  for (const label of ['Datasets', 'Agents', 'Knowledge', 'Sessions']) {
    await expect(workspace.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole('navigation', { name: 'Sessions navigation' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Collapse navigation' }),
  ).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(
    page.getByRole('button', { name: 'Expand navigation' }),
  ).toHaveAttribute('aria-expanded', 'false');

  await railItem(page, 'Sessions').click();
  await expect(sessionsList(page)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Expand navigation' }),
  ).toHaveAttribute('aria-expanded', 'false');
});

test('shows the details panel only on demand', async ({ page }) => {
  const panel = page.getByRole('complementary', { name: 'Details panel' });
  await expect(panel).toHaveCount(0);
  await page.getByTitle('Expand right panel').click();
  await expect(panel).toBeVisible();
  await page.getByTitle('Collapse right panel').click();
  await expect(panel).toHaveCount(0);
});

test('opens Settings as an area with a section list', async ({ page }) => {
  await railItem(page, 'Settings').click();
  await expectCurrent(page, 'Settings');

  const sections = page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button');
  await expect(sections).toHaveText([
    /Datasource Configuration/,
    /LLM Configuration/,
    /Testing Data/,
    /Developer/,
    /Appearance/,
  ]);
  await expect(page.getByText('Choose a settings section.')).toBeVisible();

  await sections.filter({ hasText: 'Appearance' }).click();
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();

  await railItem(page, 'Datasets').click();
  await expect(
    page.getByRole('navigation', { name: 'Settings navigation' }),
  ).toHaveCount(0);

  await railItem(page, 'Settings').click();
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
});

test('shows the product name', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Agentic Hub',
  );
  await expect(page).toHaveTitle('Agentic Hub');

  await railItem(page, 'Settings').click();
  await expect(page.getByTestId('app-version')).toHaveText(
    /^Agentic Hub v\d+\.\d+\.\d+$/,
  );
});

test('the app opens straight into the shell', async ({ page }) => {
  await expect(rail(page)).toBeVisible();
  await expect(page.getByLabel('Open system logs')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Account menu', exact: true }),
  ).toHaveCount(0);
  await expect(railItem(page, 'Admin')).toHaveCount(0);
});
