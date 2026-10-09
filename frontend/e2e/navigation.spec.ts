import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.fixture';

const rail = (page: Page) =>
  page.getByRole('complementary', { name: 'Navigation rail' });

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
  await expect(railItem(page, 'Datasets')).not.toHaveAttribute(
    'aria-current',
  );

  await railItem(page, 'Agents').click();
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  await expectCurrent(page, 'Agents');

  await railItem(page, 'Knowledge').click();
  await expectCurrent(page, 'Knowledge');

  await railItem(page, 'Sessions').click();
  await expectCurrent(page, 'Sessions');
  const sessionsNav = page.getByRole('navigation', {
    name: 'Sessions navigation',
  });
  await expect(sessionsNav).toBeVisible();
  await expect(page.getByTitle('New conversation')).toBeVisible();
  await expect(
    page.getByText('Select a session or start a new conversation.'),
  ).toBeVisible();
});

test('expands the rail into a drawer with labels and sessions', async ({
  page,
}) => {
  const sessionsNav = page.getByRole('navigation', {
    name: 'Sessions navigation',
  });
  await expect(sessionsNav).toHaveCount(0);
  const menu = page.getByRole('button', { name: 'Expand navigation' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');

  await menu.click();
  const workspace = page.getByRole('navigation', {
    name: 'Workspace navigation',
  });
  for (const label of ['Datasets', 'Agents', 'Knowledge', 'Sessions']) {
    await expect(workspace.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(sessionsNav).toBeVisible();
  await expect(page.getByTitle('New conversation')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Collapse navigation' }),
  ).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(sessionsNav).toHaveCount(0);

  await railItem(page, 'Sessions').click();
  await expect(sessionsNav).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Collapse navigation' }),
  ).toBeVisible();
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
