import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.fixture';
import { apiFetch } from './helpers/local-auth';

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

test('expands the rail into a drawer with labels and sessions', async ({
  page,
}) => {
  const sessionsNav = page.getByRole('navigation', {
    name: 'Sessions navigation',
  });
  // Given the navigation drawer is collapsed
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
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

test('local mode signs in as Demo User', async ({ page }) => {
  // The fixture signed in as Demo User through the local sign-in (admin
  // R70, R71); local mode never offers the Microsoft sign-in.
  await expect(rail(page)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sign in with Microsoft' }),
  ).toHaveCount(0);

  const avatar = page.getByRole('button', { name: 'Account menu', exact: true });
  await expect(avatar).toHaveText('DU');
  await expect(avatar).toHaveAttribute('title', 'Demo User');
  // Demo User is always a Platform admin (admin R18, R34, R69).
  await expect(railItem(page, 'Admin')).toBeVisible();

  const me = await apiFetch(page, 'GET', '/me');
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({
    mode: 'local',
    user: {
      id: 'local',
      displayName: 'Demo User',
      email: 'demo@local.test',
      initials: 'DU',
    },
    roles: [
      { role: 'user', source: 'implicit' },
      { role: 'platform-admin', source: 'bootstrap' },
    ],
  });
});
