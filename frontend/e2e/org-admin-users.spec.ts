import { test, expect } from './fixtures/org.fixture';
import { expectNoAxeViolations, followOsTheme } from './helpers/org-actions';
import {
  ALAN,
  actAs,
  addMapping,
  apiStatus,
  button,
  dialog,
  groupRow,
  listedUsers,
  openAdminTab,
  pick,
  roleChips,
  searchUsers,
  setLastActive,
  toast,
  userOption,
  userRow,
  usersTable,
  viewTab,
} from './helpers/admin-actions';
import { ADA, ADMIN, GRACE } from './helpers/scim-client';

/**
 * Mirrors the Feature "Users and groups" in specs/capabilities/admin/spec.md
 * (Playwright `org` project; admin R49-R57, ui.md 4.18.3). Avery Admin
 * (`admin@contoso.test`) is the bootstrap admin.
 */

let analystsId: string;

test.beforeEach(async ({ org }) => {
  // Background: the groups, Ada (Analysts, Maker, active today), Alan
  // (Engineers, last active 95 days ago) and Grace (never signed in).
  const adaId = await org.scim.createUser(ADA);
  const alanId = await org.scim.createUser(ALAN);
  await org.scim.createUser(GRACE);
  analystsId = await org.scim.createGroup('Analysts', [adaId]);
  await org.scim.createGroup('Engineers', [alanId]);
  await org.admin.assignRole(ADA, 'maker');
  await actAs(org, ADA);
  await setLastActive(org, ALAN, 95);
});

/** The six cells of a users table row (ui.md 4.18.3). */
const cells = (row: ReturnType<typeof userRow>) => row.getByRole('cell');

test("the users table shows each person's roles, groups and status", async ({
  page,
  signInAs,
}) => {
  await signInAs(page, ADMIN);
  await followOsTheme(page);
  await openAdminTab(page, 'Users & groups');

  await expect(viewTab(page, 'Users · 4')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(viewTab(page, 'Groups · 2')).toBeVisible();
  await expect(usersTable(page).getByRole('columnheader')).toHaveText([
    'Name',
    'Roles',
    'IdP groups',
    'Agents owned',
    'Last active',
    'Status',
  ]);
  await expect(cells(userRow(page, 'Ada Lovelace'))).toHaveText([
    /Ada Lovelace.*ada@contoso\.test/,
    'Maker',
    'Analysts',
    '0',
    'Today',
    'Active',
  ]);
  await expect(cells(userRow(page, 'Alan Turing'))).toHaveText([
    /Alan Turing/,
    'User',
    'Engineers',
    '0',
    '95 days ago',
    'Inactive',
  ]);
  await expect(cells(userRow(page, 'Grace Hopper'))).toHaveText([
    /Grace Hopper/,
    'User',
    '—',
    '0',
    'Never',
    'Not signed in',
  ]);
  await expect(cells(userRow(page, 'Avery Admin')).nth(1)).toHaveText(
    'Platform admin',
  );
  // Sorted by display name (admin R52).
  await expect(listedUsers(page)).toHaveText([
    'Ada Lovelace',
    'Alan Turing',
    'Avery Admin',
    'Grace Hopper',
  ]);
  await expect(
    page.getByText(
      'Users and groups come from Entra ID via SCIM · last sync',
    ),
  ).toBeVisible();

  await expectNoAxeViolations(page);
});

test('search finds users by name, email or group', async ({
  page,
  signInAs,
}) => {
  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Users & groups');
  await expect(listedUsers(page)).toHaveCount(4);

  await searchUsers(page).fill('analysts');
  await expect(listedUsers(page)).toHaveText(['Ada Lovelace']);

  await searchUsers(page).fill('turing');
  await expect(listedUsers(page)).toHaveText(['Alan Turing']);

  await searchUsers(page).fill('GRACE@contoso');
  await expect(listedUsers(page)).toHaveText(['Grace Hopper']);

  await searchUsers(page).fill('nobody');
  await expect(
    page.getByText('No users match your search.', { exact: true }),
  ).toBeVisible();
  await expect(listedUsers(page)).toHaveCount(0);
});

test('role filter chips narrow the list', async ({ page, signInAs }) => {
  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Users & groups');

  await expect(roleChips(page)).toHaveText([
    'All roles',
    'Platform admins · 1',
    'Approvers · 0',
    'Data owners · 0',
    'Makers · 1',
    'Inactive 90d · 1',
  ]);
  await expect(roleChips(page).first()).toHaveAttribute('aria-pressed', 'true');

  await roleChips(page).getByText('Makers · 1', { exact: true }).click();
  await expect(listedUsers(page)).toHaveText(['Ada Lovelace']);

  await roleChips(page).getByText('Inactive 90d · 1', { exact: true }).click();
  await expect(listedUsers(page)).toHaveText(['Alan Turing']);

  await roleChips(page).getByText('Approvers · 0', { exact: true }).click();
  await expect(
    page.getByText('No users match this filter.', { exact: true }),
  ).toBeVisible();
});

test('a deactivated user is shown as deactivated', async ({
  page,
  org,
  signInAs,
}) => {
  await org.scim.deactivate(ALAN.email);

  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Users & groups');

  await expect(cells(userRow(page, 'Alan Turing')).last()).toHaveText(
    'Deactivated',
  );
});

test('the users table is paged', async ({ page, org, signInAs }) => {
  for (let i = 1; i <= 30; i++) {
    const n = String(i).padStart(2, '0');
    await org.scim.createUser({
      email: `tester${n}@contoso.test`,
      name: `Test User ${n}`,
    });
  }

  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Users & groups');

  await expect(page.getByText('1–25 of 34', { exact: true })).toBeVisible();
  await expect(listedUsers(page)).toHaveCount(25);
  await expect(button(page, 'Previous page')).toBeDisabled();

  await button(page, 'Next page').click();
  await expect(page.getByText('26–34 of 34', { exact: true })).toBeVisible();
  await expect(listedUsers(page)).toHaveCount(9);
  await expect(button(page, 'Next page')).toBeDisabled();
  await expect(button(page, 'Previous page')).toBeEnabled();
});

test('the Groups view lists groups, members and mapped roles', async ({
  page,
  org,
  signInAs,
}) => {
  await addMapping(org, analystsId, 'maker');

  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Users & groups');
  await viewTab(page, 'Groups · 2').click();
  await expect(viewTab(page, 'Groups · 2')).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await expect(groupRow(page, 'Analysts').getByRole('cell')).toHaveText([
    'Analysts',
    '1',
    'Maker',
  ]);
  await expect(groupRow(page, 'Engineers').getByRole('cell')).toHaveText([
    'Engineers',
    '1',
    '—',
  ]);
  await expect(
    page.getByRole('searchbox', { name: 'Search groups', exact: true }),
  ).toBeVisible();
});

test('assign role gives a user a role', async ({ page, signInAs }) => {
  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Users & groups');

  await button(page, 'Assign role').click();
  const assign = dialog(page, 'Assign role');
  await expect(assign.getByLabel('Datasource', { exact: true })).toBeDisabled();
  await expect(button(assign, 'Assign')).toBeDisabled();

  await pick(assign, 'User', 'Grace', userOption(GRACE));
  await assign.getByLabel('Role', { exact: true }).selectOption('Approver');
  await button(assign, 'Assign').click();

  await expect(toast(page, 'Role assigned')).toBeVisible();
  await expect(assign).toHaveCount(0);
  await expect(cells(userRow(page, 'Grace Hopper')).nth(1)).toHaveText(
    'Approver',
  );
});

test("a user without the admin permission can't list users", async ({
  page,
  signInAs,
}) => {
  await signInAs(page, ADA);

  expect(await apiStatus(page, 'GET', '/admin/users')).toBe(403);
});
