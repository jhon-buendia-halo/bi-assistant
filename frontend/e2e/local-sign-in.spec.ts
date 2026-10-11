import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASOURCE,
  createWorldCupDatasource,
  openSessions,
} from './helpers/app-actions';
import {
  button,
  openAdminTab,
  openAgents,
  openUser,
  roleCheckbox,
  toast,
} from './helpers/admin-actions';
import {
  LOCAL_USERS,
  apiBaseOf,
  appSql,
  localSignInButton,
  localToken,
  localUserOption,
  localUserSelect,
  signInLocally,
  signInThroughPage,
} from './helpers/local-auth';
import {
  accountMenuButton,
  expectNoAxeViolations,
  navigationRail,
  openRail,
  railButton,
  settingsSections,
} from './helpers/org-actions';

/**
 * Mirrors the Feature "Sign in to local mode" in
 * specs/capabilities/admin/spec.md (Playwright `web` project; admin R69-R72,
 * ui.md 4.17.1). Background: the app runs in local mode and nobody is
 * signed in, so the fixture opens the sign-in page instead of signing in.
 */

test.use({ autoSignIn: false });

const systemLogs = (page: Page) => page.getByLabel('Open system logs');

const sessionsNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Sessions navigation' });

/** The personas as the dropdown lists them on a fresh data folder. */
const DEMO = localUserOption('Demo User', 'Platform admin');
const UMA = localUserOption('Uma User', 'User');
const MARK = localUserOption('Mark Maker', 'Maker');

/** Chooses the System theme in the browser copy and reloads the sign-in page. */
async function followOsThemeSignedOut(page: Page): Promise<void> {
  await page.evaluate(() =>
    localStorage.setItem('questions-to-insights:theme', 'system'),
  );
  await page.reload();
  await expect(localUserSelect(page)).toBeVisible();
}

test('The app opens on the sign-in page listing the personas', async ({
  page,
}) => {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Agentic Hub' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Choose who you are to continue. Local mode has no passwords.',
    ),
  ).toBeVisible();
  await expect(navigationRail(page)).toHaveCount(0);
  await expect(systemLogs(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Sign in with Microsoft' }),
  ).toHaveCount(0);

  const select = localUserSelect(page);
  await expect(select).toBeVisible();
  await expect(select).toHaveAttribute('id', 'local-user');
  // Sorted by display name; roles other than User, or "User" (admin R70).
  // Dana owns no datasource yet on a fresh data folder (R69, R72).
  await expect(select.locator('option')).toHaveText([
    'Choose a user',
    localUserOption('Avery Approver', 'Approver'),
    localUserOption('Dana Data Owner', 'User'),
    DEMO,
    MARK,
    UMA,
  ]);
  await expect(select).toHaveValue('');
  await expect(localSignInButton(page)).toBeDisabled();

  await select.selectOption({ label: MARK });
  await expect(localSignInButton(page)).toBeEnabled();

  await followOsThemeSignedOut(page);
  await expectNoAxeViolations(page);
});

test('Signing in as Demo User opens the shell', async ({ page }) => {
  await signInThroughPage(page, DEMO);

  // The home view: no rail area is current.
  await expect(
    navigationRail(page).locator('[aria-current="page"]'),
  ).toHaveCount(0);
  await expect(accountMenuButton(page)).toHaveText('DU');
  await expect(accountMenuButton(page)).toHaveAttribute('title', 'Demo User');
  await expect(railButton(page, 'Admin')).toBeVisible();
  // The token is kept in browser storage, never in a cookie (admin R71).
  expect(await localToken(page)).toBeTruthy();
  expect(await page.context().cookies()).toEqual([]);

  await page.reload();
  await expect(systemLogs(page)).toBeVisible();
  await expect(accountMenuButton(page)).toHaveText('DU');
  await expect(localUserSelect(page)).toHaveCount(0);
});

test('Uma User sees no maker, data or admin controls', async ({ app }) => {
  await app.signInAs(LOCAL_USERS.uma);
  const { page } = app;
  await expect(accountMenuButton(page)).toHaveText('UU');

  await openAgents(page);
  await expect(button(page, 'New agent')).toHaveCount(0);

  await openRail(page, 'Datasets');
  await expect(
    page.getByRole('heading', { name: 'Datasets', exact: true }),
  ).toBeVisible();
  await expect(button(page, 'New dataset')).toHaveCount(0);

  await openRail(page, 'Settings');
  expect(await settingsSections(page)).toEqual(['Appearance']);
  await expect(railButton(page, 'Admin')).toHaveCount(0);
});

test("Mark Maker's agents are private", async ({ app }) => {
  const agentName = "Mark's analyst";
  await app.signInAs(LOCAL_USERS.mark);
  const { page } = app;

  await openAgents(page);
  await button(page, 'New agent').click();
  await expect(
    page.getByRole('heading', { name: 'New agent', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(agentName);
  await page.getByTestId('agent-save').click();
  await expect(
    page.getByText(`Agent "${agentName}" saved as draft`),
  ).toBeVisible();
  await openAgents(page);
  await expect(page.getByText(agentName, { exact: true })).toBeVisible();

  await app.signOut();
  await signInThroughPage(page, UMA);
  await openAgents(page);
  await expect(page.getByText(agentName, { exact: true })).toHaveCount(0);

  await app.signOut();
  await signInThroughPage(page, DEMO);
  await openAgents(page);
  await expect(page.getByText(agentName, { exact: true })).toHaveCount(0);
});

test('Signing out returns to the sign-in page', async ({ app }) => {
  await app.signInAs(LOCAL_USERS.demo);
  const { page } = app;
  const token = await localToken(page);
  expect(token).toBeTruthy();

  await accountMenuButton(page).click();
  const menu = page.getByTestId('account-menu');
  await expect(menu.getByText('Demo User', { exact: true })).toBeVisible();
  await expect(menu.getByText('demo@local.test', { exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Sign out', exact: true }).click();

  await expect(localUserSelect(page)).toBeVisible();
  await expect(localSignInButton(page)).toBeVisible();
  await expect(navigationRail(page)).toHaveCount(0);
  // The app forgot the token and the server ended the session (admin R71).
  expect(await localToken(page)).toBeNull();
  const me = await page.request.get(`${apiBaseOf(page)}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(me.status()).toBe(401);

  await page.reload();
  await expect(localUserSelect(page)).toBeVisible();
  await expect(navigationRail(page)).toHaveCount(0);
});

test('A role change in Admin persists', async ({ app }) => {
  await app.signInAs(LOCAL_USERS.demo);
  const { page } = app;

  await openAdminTab(page, 'Users & groups');
  const panel = await openUser(page, 'Uma User');
  await expect(roleCheckbox(panel, 'Maker')).not.toBeChecked();
  await roleCheckbox(panel, 'Maker').check();
  await button(panel, 'Save changes').click();
  await expect(toast(page, 'Roles saved for Uma User')).toBeVisible();

  await app.signOut();
  // The dropdown shows Uma's new role.
  await signInThroughPage(page, localUserOption('Uma User', 'Maker'));
  await expect(accountMenuButton(page)).toHaveText('UU');
  await openAgents(page);
  await expect(button(page, 'New agent')).toBeVisible();

  await app.restartCli();
  await expect(systemLogs(page)).toBeVisible();
  await expect(accountMenuButton(page)).toHaveText('UU');
  await openAgents(page);
  await expect(button(page, 'New agent')).toBeVisible();
});

test('Dana Data Owner owns every datasource', async ({ app }) => {
  await app.signInAs(LOCAL_USERS.demo);
  const { page } = app;

  await createWorldCupDatasource(page);

  await openAdminTab(page, 'Users & groups');
  const dana = await openUser(page, 'Dana Data Owner');
  await expect(
    roleCheckbox(dana, `Data owner · ${WORLD_CUP_DATASOURCE}`),
  ).toBeChecked();

  const demo = await openUser(page, 'Demo User');
  const platformAdmin = roleCheckbox(demo, 'Platform admin');
  await expect(platformAdmin).toBeChecked();
  await expect(platformAdmin).toBeDisabled();
  await expect(platformAdmin).toHaveAccessibleDescription(
    /Always a Platform admin in local mode\./,
  );
});

test('Data from before sign-in belongs to Demo User', async ({
  app,
  appDataDir,
}) => {
  const { page } = app;
  // Given the data folder holds "Old goals" with no owner: created through
  // the API, its owner is then removed as if stored before local sign-in.
  const token = await signInLocally(apiBaseOf(page), LOCAL_USERS.demo);
  const created = await page.request.post(`${apiBaseOf(page)}/sessions`, {
    data: { name: 'Old goals', datasets: ['World Cup Core'] },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(created.status()).toBe(201);
  const ownerOf = () =>
    appSql<{ ownerId: string | null }>(
      appDataDir,
      "SELECT json_extract(doc, '$.ownerId') AS ownerId FROM sessions WHERE json_extract(doc, '$.name') = ?",
      'Old goals',
    );
  appSql(
    appDataDir,
    "UPDATE sessions SET doc = json_remove(doc, '$.ownerId') WHERE json_extract(doc, '$.name') = ?",
    'Old goals',
  );
  expect(ownerOf()).toEqual([{ ownerId: null }]);

  // The startup migration gives it to Demo User (data-model M13).
  await app.restartCli();
  await expect(localUserSelect(page)).toBeVisible();
  expect(ownerOf()).toEqual([{ ownerId: 'local' }]);

  await signInThroughPage(page, DEMO);
  await openSessions(page);
  await expect(sessionsNav(page)).toContainText('Old goals');

  await app.signOut();
  await signInThroughPage(page, UMA);
  await openSessions(page);
  await expect(sessionsNav(page).getByText('No sessions yet.')).toBeVisible();
  await expect(sessionsNav(page)).not.toContainText('Old goals');
});
