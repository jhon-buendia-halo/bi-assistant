import { test, expect } from './fixtures/org.fixture';
import { WORLD_CUP_DATASOURCE } from './helpers/app-actions';
import { expectNoAxeViolations, followOsTheme } from './helpers/org-actions';
import {
  addMapping,
  apiStatus,
  button,
  dialog,
  grantedRoles,
  mappingsList,
  MATRIX_ROLES,
  openAdminTab,
  openAgents,
  permissionMatrix,
  pick,
  reloadAgents,
  toast,
} from './helpers/admin-actions';
import { ADA, ADMIN } from './helpers/scim-client';

/**
 * Mirrors the Feature "Roles and permissions" in
 * specs/capabilities/admin/spec.md (Playwright `org` project; admin R65-R68,
 * ui.md 4.18.5). Avery Admin (`admin@contoso.test`) is the bootstrap admin.
 */

let analystsId: string;

test.beforeEach(async ({ org }) => {
  // Background: the World Cup datasource and the group "Analysts" with Ada.
  await org.admin.seedWorldCup();
  const adaId = await org.scim.createUser(ADA);
  analystsId = await org.scim.createGroup('Analysts', [adaId]);
});

const noMappings = (page: Parameters<typeof mappingsList>[0]) =>
  page.getByText('No group mappings yet.', { exact: true });

test('the matrix shows what each role can do', async ({ page, signInAs }) => {
  await signInAs(page, ADMIN);
  await followOsTheme(page);
  await openAdminTab(page, 'Roles & permissions');

  await expect(permissionMatrix(page).getByRole('columnheader')).toHaveText([
    'Permission',
    ...MATRIX_ROLES,
  ]);
  await expect(permissionMatrix(page).getByRole('rowheader')).toHaveCount(11);
  expect(
    await grantedRoles(page, 'Use agents in the gallery and chat'),
  ).toEqual([...MATRIX_ROLES]);
  expect(
    await grantedRoles(page, 'Manage users, roles and group mappings'),
  ).toEqual(['Platform admin']);
  expect(await grantedRoles(page, 'View audit log')).toEqual([
    'Approver',
    'Platform admin',
  ]);
  // Read-only (admin R65): nothing in the matrix can be changed.
  await expect(
    permissionMatrix(page).locator('button, input, select'),
  ).toHaveCount(0);
  await expect(noMappings(page)).toBeVisible();

  await expectNoAxeViolations(page);
});

test("a group mapping gives the group's members the role", async ({
  page,
  signInAs,
  newBrowserAs,
}) => {
  const ada = await newBrowserAs(ADA);
  await openAgents(ada);
  await expect(button(ada, 'New agent')).toHaveCount(0);

  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Roles & permissions');
  await button(page, 'Add mapping').click();
  const add = dialog(page, 'Add mapping');
  await pick(add, 'Entra ID group', 'Analy', 'Analysts');
  await add.getByLabel('Role', { exact: true }).selectOption('Maker');
  await button(add, 'Add').click();

  await expect(toast(page, 'Mapping added')).toBeVisible();
  await expect(add).toHaveCount(0);
  await expect(mappingsList(page).getByRole('listitem')).toHaveText([
    /Analysts\s*Maker/,
  ]);

  await reloadAgents(ada);
  await expect(button(ada, 'New agent')).toBeVisible();
});

test('removing a mapping takes the role away', async ({
  page,
  org,
  signInAs,
  newBrowserAs,
}) => {
  await addMapping(org, analystsId, 'maker');

  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Roles & permissions');
  await expect(mappingsList(page).getByRole('listitem')).toHaveCount(1);

  page.once('dialog', (confirm) => {
    expect(confirm.message()).toBe(
      'Remove the mapping “Analysts → Maker”?\n\nMembers of Analysts lose the Maker role on their next request, unless they hold it another way.',
    );
    void confirm.accept();
  });
  await button(page, 'Remove mapping Analysts → Maker').click();

  await expect(toast(page, 'Mapping removed')).toBeVisible();
  await expect(noMappings(page)).toBeVisible();

  const ada = await newBrowserAs(ADA);
  await openAgents(ada);
  await expect(button(ada, 'New agent')).toHaveCount(0);
});

test('a data owner mapping names its datasource', async ({
  page,
  signInAs,
}) => {
  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Roles & permissions');
  await button(page, 'Add mapping').click();
  const add = dialog(page, 'Add mapping');
  await pick(add, 'Entra ID group', 'Analy', 'Analysts');
  await add.getByLabel('Role', { exact: true }).selectOption('Data owner');
  await expect(button(add, 'Add')).toBeDisabled();

  await add
    .getByLabel('Datasource', { exact: true })
    .selectOption({ label: WORLD_CUP_DATASOURCE });
  await button(add, 'Add').click();

  await expect(toast(page, 'Mapping added')).toBeVisible();
  await expect(mappingsList(page).getByRole('listitem')).toHaveText([
    new RegExp(`Analysts\\s*Data owner · ${WORLD_CUP_DATASOURCE}`),
  ]);
});

test('add mapping needs a group', async ({ page, org, signInAs }) => {
  await org.scim.deleteGroup(analystsId);

  await signInAs(page, ADMIN);
  await openAdminTab(page, 'Roles & permissions');

  await expect(noMappings(page)).toBeVisible();
  await expect(button(page, 'Add mapping')).toBeDisabled();
  await expect(button(page, 'Add mapping')).toHaveAttribute(
    'title',
    'No groups yet. Groups arrive from Entra ID through SCIM.',
  );
});

test("a user without the admin permission can't add a mapping", async ({
  page,
  org,
  signInAs,
}) => {
  await signInAs(page, ADA);

  expect(
    await apiStatus(page, 'POST', '/admin/role-mappings', {
      groupId: analystsId,
      role: 'maker',
    }),
  ).toBe(403);
  const { mappings } = await org.admin.call<{
    ok: boolean;
    message: string;
    mappings: unknown[];
  }>('GET', '/admin/role-mappings');
  expect(mappings).toEqual([]);
});
