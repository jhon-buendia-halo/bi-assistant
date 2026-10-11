import { test, expect } from './fixtures/org.fixture';
import { WORLD_CUP_DATASOURCE } from './helpers/app-actions';
import { expectNoAxeViolations, followOsTheme } from './helpers/org-actions';
import {
  ALAN,
  actAs,
  addMapping,
  apiStatus,
  button,
  dialog,
  giveAgents,
  openAdminTab,
  openAgents,
  openUser,
  pick,
  reloadAgents,
  roleCheckbox,
  toast,
  userDetails,
  userIdOf,
  userOption,
  userRow,
  usersTable,
} from './helpers/admin-actions';
import { ADA, ADMIN, GRACE } from './helpers/scim-client';

/**
 * Mirrors the Feature "Edit a user" in specs/capabilities/admin/spec.md
 * (Playwright `org` project; admin R58-R64, ui.md 4.18.4). Avery Admin
 * (`admin@contoso.test`) is the bootstrap admin.
 */

let analystsId: string;

test.beforeEach(async ({ org }) => {
  // Background: the World Cup datasource; Ada in "Analysts", a Maker,
  // active today; Grace a Maker.
  await org.admin.seedWorldCup();
  const adaId = await org.scim.createUser(ADA);
  analystsId = await org.scim.createGroup('Analysts', [adaId]);
  await org.admin.assignRole(ADA, 'maker');
  await actAs(org, ADA);
  await org.admin.assignRole(GRACE, 'maker');
});

const agentsOwned = (panel: ReturnType<typeof userDetails>) =>
  panel.getByRole('list', { name: 'Agents owned', exact: true });

test("selecting a user opens their details", async ({ page, signInAs }) => {
  await signInAs(page, ADMIN);
  await followOsTheme(page);
  await openAdminTab(page, 'Users & groups');

  const panel = await openUser(page, 'Ada Lovelace');
  await expect(panel.getByText('ada@contoso.test', { exact: true })).toBeVisible();
  await expect(panel.getByText('Active', { exact: true })).toBeVisible();
  await expect(roleCheckbox(panel, 'Maker')).toBeChecked();
  await expect(roleCheckbox(panel, 'Platform admin')).not.toBeChecked();
  await expect(roleCheckbox(panel, 'Approver')).not.toBeChecked();
  await expect(
    panel.getByRole('list', {
      name: 'Groups (from Entra ID, read-only)',
      exact: true,
    }),
  ).toHaveText('Analysts');
  await expect(userRow(page, 'Ada Lovelace')).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(usersTable(page).getByRole('columnheader')).toHaveText([
    'Name',
    'Roles',
    'Last active',
  ]);

  await expectNoAxeViolations(page);

  await button(panel, 'Close user details').click();
  await expect(userDetails(page)).toHaveCount(0);
  await expect(
    usersTable(page).getByRole('columnheader', { name: 'Status', exact: true }),
  ).toBeVisible();
  // Focus returns to the user's name in the table (admin R58).
  await expect(
    usersTable(page).getByRole('button', { name: 'Ada Lovelace', exact: true }),
  ).toBeFocused();
});

test('changing roles changes what the user can do', async ({
  page,
  signInAs,
  newBrowserAs,
}) => {
  const ada = await newBrowserAs(ADA);

  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Users & groups');
  const panel = await openUser(page, 'Ada Lovelace');
  await expect(button(panel, 'Save changes')).toBeDisabled();

  await roleCheckbox(panel, 'Approver').check();
  await roleCheckbox(panel, 'Maker').uncheck();
  await button(panel, 'Save changes').click();

  await expect(toast(page, 'Roles saved for Ada Lovelace')).toBeVisible();
  const roles = userRow(page, 'Ada Lovelace').getByRole('cell').nth(1);
  await expect(roles).toContainText('Approver');
  await expect(roles).not.toContainText('Maker');
  await expect(roleCheckbox(panel, 'Approver')).toBeChecked();

  // Ada's permissions load with the page (admin R20).
  await reloadAgents(ada);
  await expect(button(ada, 'New agent')).toHaveCount(0);
});

test('data owner names its datasource', async ({ page, signInAs }) => {
  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Users & groups');
  const panel = await openUser(page, 'Ada Lovelace');
  const datasource = panel.getByLabel('Datasource', { exact: true });
  await expect(datasource).toBeDisabled();

  await roleCheckbox(panel, 'Data owner').check();
  await expect(datasource).toBeEnabled();
  await expect(button(panel, 'Save changes')).toBeDisabled();

  await datasource.selectOption({ label: WORLD_CUP_DATASOURCE });
  await button(panel, 'Save changes').click();

  await expect(toast(page, 'Roles saved for Ada Lovelace')).toBeVisible();
  await expect(
    roleCheckbox(panel, `Data owner · ${WORLD_CUP_DATASOURCE}`),
  ).toBeChecked();
  // With no other datasource to own, the add box is disabled (admin R59).
  await expect(roleCheckbox(panel, 'Data owner')).toBeDisabled();
  await expect(roleCheckbox(panel, 'Data owner')).toHaveAccessibleDescription(
    /No other datasource to own\./,
  );
});

test("a role from a group mapping can't be unticked", async ({
  page,
  org,
  signInAs,
}) => {
  await addMapping(org, analystsId, 'approver');

  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Users & groups');
  const panel = await openUser(page, 'Ada Lovelace');

  const approver = roleCheckbox(panel, 'Approver');
  await expect(approver).toBeChecked();
  await expect(approver).toBeDisabled();
  await expect(approver).toHaveAccessibleDescription(/From group Analysts/);
});

test("an admin can't remove their own Platform admin role", async ({
  page,
  org,
  signInAs,
}) => {
  await org.admin.assignRole(GRACE, 'platform-admin');

  await signInAs(page, GRACE);
  await openAdminTab(page, 'Users & groups');
  const panel = await openUser(page, 'Grace Hopper');

  const platformAdmin = roleCheckbox(panel, 'Platform admin');
  await expect(platformAdmin).toBeChecked();
  await expect(platformAdmin).toBeDisabled();
  await expect(platformAdmin).toHaveAccessibleDescription(
    /You can't remove your own Platform admin role\./,
  );
});

test('transferring agents hands them to another user', async ({
  page,
  org,
  signInAs,
  newBrowserAs,
}) => {
  await giveAgents(org, ADA, {
    live: ['Goal analyst'],
    draft: ['Card counter'],
  });

  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Users & groups');
  const panel = await openUser(page, 'Ada Lovelace');
  await expect(agentsOwned(panel).getByRole('listitem')).toHaveText([
    /Card counter\s*Draft/,
    /Goal analyst\s*Live/,
  ]);

  await button(panel, 'Transfer ownership').click();
  const transfer = dialog(page, 'Transfer ownership');
  await transfer
    .getByRole('checkbox', { name: 'Card counter', exact: true })
    .uncheck();
  await pick(transfer, 'New owner', 'Grace', userOption(GRACE));
  await button(transfer, 'Transfer').click();

  await expect(toast(page, 'Transferred 1 agent to Grace Hopper')).toBeVisible();
  await expect(transfer).toHaveCount(0);
  await expect(agentsOwned(panel).getByRole('listitem')).toHaveText([
    /Card counter/,
  ]);

  const grace = await newBrowserAs(GRACE);
  await openAgents(grace);
  await expect(
    grace.getByTestId('agent-section-mine').getByText('Goal analyst', {
      exact: true,
    }),
  ).toBeVisible();
});

test('a transfer that would duplicate a name is refused', async ({
  page,
  org,
  signInAs,
}) => {
  await giveAgents(org, ADA, { live: ['Goal analyst'] });
  await giveAgents(org, GRACE, { draft: ['Goal analyst'] });

  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Users & groups');
  const panel = await openUser(page, 'Ada Lovelace');

  await button(panel, 'Transfer ownership').click();
  const transfer = dialog(page, 'Transfer ownership');
  await pick(transfer, 'New owner', 'Grace', userOption(GRACE));
  await button(transfer, 'Transfer').click();

  await expect(
    toast(page, 'Grace Hopper already has an agent named "Goal analyst"'),
  ).toBeVisible();
  // A failure keeps the dialog open (ui.md 4.18.1); nothing moved.
  await button(transfer, 'Cancel').click();
  await expect(agentsOwned(panel).getByRole('listitem')).toHaveText([
    /Goal analyst/,
  ]);
});

test('a user with no groups and no agents', async ({ page, org, signInAs }) => {
  await org.scim.createUser(ALAN);

  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Users & groups');
  const panel = await openUser(page, 'Alan Turing');

  await expect(panel.getByText('No groups.', { exact: true })).toBeVisible();
  await expect(
    panel.getByText('No agents owned.', { exact: true }),
  ).toBeVisible();
  await expect(button(panel, 'Transfer ownership')).toBeDisabled();
});

test("a user without the admin permission can't change roles", async ({
  page,
  org,
  signInAs,
}) => {
  const graceId = await userIdOf(org, GRACE);
  await signInAs(page, ADA);

  expect(
    await apiStatus(page, 'PUT', `/admin/users/${graceId}/roles`, {
      roles: [],
    }),
  ).toBe(403);
  const grace = await org.admin.call<{
    ok: boolean;
    message: string;
    roles: string[];
  }>('GET', `/admin/users/${graceId}`);
  expect(grace.roles).toEqual(['maker']);
});
