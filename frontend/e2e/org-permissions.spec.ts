import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/org.fixture';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import {
  composerReasoningEffort,
  expectNoAxeViolations,
  followOsTheme,
  openRail,
  railButton,
  settingsSections,
  startNewConversation,
} from './helpers/org-actions';
import { ADMIN, type OrgPerson } from './helpers/scim-client';

/**
 * Mirrors the Feature "Permissions in the app" in
 * specs/capabilities/admin/spec.md (Playwright `org` project). Avery Admin
 * (`admin@contoso.test`) is the bootstrap admin of every org server here.
 */

const USER: OrgPerson = { email: 'user@contoso.test', name: 'Uma User' };
const MAKER: OrgPerson = { email: 'maker@contoso.test', name: 'Max Maker' };
const AGENT_NAME = 'Goal analyst';

test.beforeEach(async ({ org }) => {
  // Background: the World Cup datasource and the "World Cup Core" dataset.
  await org.admin.seedWorldCup();
});

const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });

async function openNewAgentEditor(page: Page): Promise<void> {
  await openRail(page, 'Agents');
  await button(page, 'New agent').click();
  await expect(
    page.getByRole('heading', { name: 'New agent', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(AGENT_NAME);
  await page
    .getByRole('group', { name: 'Datasets' })
    .getByRole('checkbox', { name: WORLD_CUP_DATASET, exact: true })
    .check();
}

test('a User sees no maker, data or admin controls', async ({
  page,
  signInAs,
}) => {
  await signInAs(page, USER);

  await openRail(page, 'Agents');
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
  await expect(button(page, 'New agent')).toHaveCount(0);

  await openRail(page, 'Datasets');
  await expect(page.getByTestId(`dataset-${WORLD_CUP_DATASET}`)).toBeVisible();
  await expect(button(page, 'New dataset')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: `Options for ${WORLD_CUP_DATASET}` }),
  ).toHaveCount(0);

  await openRail(page, 'Settings');
  expect(await settingsSections(page)).toEqual(['Appearance']);
  await expect(railButton(page, 'Admin')).toHaveCount(0);

  await startNewConversation(page);
  await expect(composerReasoningEffort(page)).toHaveCount(0);
});

test('a Maker can create an agent', async ({ page, org, signInAs }) => {
  await org.admin.assignRole(MAKER, 'maker');
  await signInAs(page, MAKER);

  await openNewAgentEditor(page);
  await page.getByTestId('agent-save').click();

  await expect(
    page.getByText(`Agent "${AGENT_NAME}" saved as draft`),
  ).toBeVisible();
  await expect(railButton(page, 'Admin')).toHaveCount(0);
});

test('a bootstrap admin sees the Admin area', async ({ page, signInAs }) => {
  await signInAs(page, ADMIN);
  await followOsTheme(page);

  await openRail(page, 'Admin');
  await expect(railButton(page, 'Admin')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    page.getByRole('heading', { level: 2, name: 'Admin', exact: true }),
  ).toBeVisible();
  const tabs = page
    .getByRole('tablist', { name: 'Admin sections' })
    .getByRole('tab');
  await expect(tabs).toHaveText([
    'Overview',
    'Users & groups',
    'Roles & permissions',
  ]);
  await expect(
    page.getByRole('tab', { name: 'Overview', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  // TODO(BA-164): And I see "Needs attention" (the Overview's content, P1).

  await page.getByRole('tab', { name: 'Users & groups', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: 'Users & groups', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('tabpanel', { name: 'Users & groups', exact: true }),
  ).toBeVisible();
  // TODO(BA-165): Then I see the "Search users" field (the tab's content, P2).

  await expectNoAxeViolations(page);
});

test('a Platform admin manages shared settings', async ({ page, signInAs }) => {
  await signInAs(page, ADMIN);

  await openRail(page, 'Settings');
  expect(await settingsSections(page)).toEqual([
    'Datasource Configuration',
    'LLM Configuration',
    'Testing Data',
    'Developer',
    'Appearance',
  ]);

  await startNewConversation(page);
  await expect(composerReasoningEffort(page)).toBeVisible();
});

test('an action the user lost the right to is refused', async ({
  page,
  org,
  signInAs,
}) => {
  await org.admin.assignRole(MAKER, 'maker');
  await signInAs(page, MAKER);
  await openNewAgentEditor(page);

  await org.admin.removeRole(MAKER, 'maker');
  await page.getByTestId('agent-save').click();

  await expect(
    page.getByText("You don't have permission to do this.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'New agent', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    AGENT_NAME,
  );
});
