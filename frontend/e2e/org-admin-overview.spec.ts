import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/org.fixture';
import { expectNoAxeViolations, followOsTheme, railButton } from './helpers/org-actions';
import {
  ALAN,
  actAs,
  adminTab,
  apiStatus,
  attentionCount,
  attentionRow,
  button,
  dialog,
  giveAgents,
  openAdminTab,
  pick,
  recentActivity,
  recordAgentError,
  setLastActive,
  tileValue,
  toast,
  userOption,
} from './helpers/admin-actions';
import { ADA, ADMIN, GRACE } from './helpers/scim-client';

/**
 * Mirrors the Feature "Admin overview" in specs/capabilities/admin/spec.md
 * (Playwright `org` project; admin R41-R48, ui.md 4.18.2). Avery Admin
 * (`admin@contoso.test`) is the bootstrap admin.
 */

const OWNERLESS = 'Agents without an active owner';
const ERRORED = 'Agents with errors in the last 7 days';
const INACTIVE_MAKERS = 'Users inactive for 90+ days with Maker role';

test.beforeEach(async ({ org }) => {
  // Background: Ada, Grace and Alan are provisioned through SCIM.
  for (const person of [ADA, GRACE, ALAN]) await org.scim.createUser(person);
});

test('the overview shows the tiles, the chart and what needs attention', async ({
  page,
  org,
  signInAs,
}) => {
  await org.admin.seedWorldCup();
  await actAs(org, ADA);
  await actAs(org, GRACE);
  await setLastActive(org, ALAN, 40);
  await giveAgents(org, ADA, {
    live: ['Goal analyst'],
    draft: ['Card counter'],
  });

  await signInAs(page, ADMIN);
  await followOsTheme(page);
  await openAdminTab(page);

  await expect(adminTab(page, 'Overview')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(tileValue(page, 'Active users · 30 days')).toHaveText('3');
  await expect(tileValue(page, 'Agents live')).toHaveText('1');
  await expect(
    page.getByRole('list', { name: 'Needs attention' }).getByRole('listitem'),
  ).toHaveText([
    new RegExp(`^${OWNERLESS}`),
    new RegExp(`^${ERRORED}`),
    new RegExp(`^${INACTIVE_MAKERS.replace('+', '\\+')}`),
  ]);

  // The chart's numbers, as assistive technology reads them (admin R46).
  const weeks = page
    .getByRole('table', { name: 'Weekly active users', exact: true })
    .getByRole('row')
    .filter({ has: page.getByRole('cell') });
  await expect(weeks).toHaveCount(8);
  await expect(weeks.last().getByRole('cell').last()).toHaveText('3');
  await expect(
    page.getByText('Last 8 weeks · peak 3 this week', { exact: true }),
  ).toBeVisible();

  await expectNoAxeViolations(page);
});

test('a new org server shows empty states', async ({ page, signInAs }) => {
  await signInAs(page, ADMIN);
  await openAdminTab(page);

  await expect(tileValue(page, 'Agents live')).toHaveText('0');
  for (const [text, badge, action] of [
    [OWNERLESS, '0 agents', 'Assign'],
    [ERRORED, '0 agents', 'Inspect'],
    [INACTIVE_MAKERS, '0 users', 'Clean up'],
  ]) {
    await expect(attentionCount(page, text)).toHaveText(badge);
    await expect(button(attentionRow(page, text), action)).toBeDisabled();
  }
  await expect(
    recentActivity(page).getByText('No activity yet.', { exact: true }),
  ).toBeVisible();
});

test('agents whose owner is deactivated get a new owner', async ({
  page,
  org,
  signInAs,
}) => {
  await org.admin.seedWorldCup();
  await giveAgents(org, ADA, { live: ['Goal analyst'] });
  await org.scim.deactivate(ADA.email);

  await signInAs(page, ADMIN);
  await openAdminTab(page);
  await expect(attentionCount(page, OWNERLESS)).toHaveText('1 agent');

  await button(attentionRow(page, OWNERLESS), 'Assign').click();
  const assign = dialog(page, 'Assign an owner');
  const agent = assign.getByRole('checkbox', {
    name: 'Goal analyst',
    exact: true,
  });
  await expect(agent).toBeChecked();
  await expect(agent).toHaveAccessibleDescription(
    'Former owner: Ada Lovelace',
  );

  await pick(assign, 'New owner', 'Grace', userOption(GRACE));
  await button(assign, 'Transfer').click();

  await expect(toast(page, 'Transferred 1 agent to Grace Hopper')).toBeVisible();
  await expect(assign).toHaveCount(0);
  await expect(attentionCount(page, OWNERLESS)).toHaveText('0 agents');
  await expect(button(attentionRow(page, OWNERLESS), 'Assign')).toBeDisabled();
  await expect(recentActivity(page)).toContainText(
    'Avery Admin transferred Goal analyst from Ada Lovelace to Grace Hopper',
  );
});

test('agents with errors can be inspected', async ({ page, org, signInAs }) => {
  await org.admin.seedWorldCup();
  const { ids, client } = await giveAgents(org, ADA, {
    live: ['Goal analyst'],
  });
  await recordAgentError(
    org,
    ADA,
    client,
    ids['Goal analyst'],
    'Model unavailable',
  );

  await signInAs(page, ADMIN);
  await openAdminTab(page);
  await expect(attentionCount(page, ERRORED)).toHaveText('1 agent');

  await button(attentionRow(page, ERRORED), 'Inspect').click();
  const inspect = dialog(page, 'Agents with errors');
  const row = inspect
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'Goal analyst', exact: true }) });
  await expect(row.getByRole('cell')).toHaveText([
    'Goal analyst',
    'Ada Lovelace',
    '1',
    /Model unavailable/,
  ]);
  // Read-only: the sessions behind the errors stay private (admin R44).
  await expect(inspect.getByRole('button')).toHaveText(['Close']);
  await button(inspect, 'Close').click();
  await expect(inspect).toHaveCount(0);
});

test('inactive makers are cleaned up', async ({ page, org, signInAs }) => {
  await org.admin.assignRole(ALAN, 'maker');
  await setLastActive(org, ALAN, 95);

  await signInAs(page, ADMIN);
  await openAdminTab(page);
  await expect(attentionCount(page, INACTIVE_MAKERS)).toHaveText('1 user');

  await button(attentionRow(page, INACTIVE_MAKERS), 'Clean up').click();
  const cleanUp = dialog(page, 'Inactive makers');
  const alan = cleanUp.getByRole('checkbox', {
    name: 'Alan Turing',
    exact: true,
  });
  await expect(alan).toBeChecked();
  await expect(alan).toHaveAccessibleDescription(
    'Last active 95 days ago · Direct assignment',
  );

  await button(cleanUp, 'Remove Maker role').click();

  await expect(toast(page, 'Maker role removed from 1 user')).toBeVisible();
  await expect(attentionCount(page, INACTIVE_MAKERS)).toHaveText('0 users');
  await expect(recentActivity(page)).toContainText(
    'Avery Admin removed the Maker role from Alan Turing',
  );
});

test('export report downloads the overview as CSV', async ({
  page,
  org,
  signInAs,
}) => {
  await actAs(org, ADA);
  await actAs(org, GRACE);

  await signInAs(page, ADMIN);
  await openAdminTab(page);
  const today = new Date().toISOString().slice(0, 10);
  const downloading = page.waitForEvent('download');
  await button(page, 'Export report').click();
  const download = await downloading;

  expect(download.suggestedFilename()).toBe(`admin-report-${today}.csv`);
  const csv = (await readFile(await download.path(), 'utf8')).replace(
    /^﻿/,
    '',
  );
  const lines = csv.split('\r\n');
  expect(lines[0]).toBe('section,label,value');
  expect(lines).toContain('summary,Active users · 30 days,3');
  expect(
    lines.filter((line) => line.startsWith('weekly-active-users,')),
  ).toHaveLength(8);
});

test("a user without the admin permission can't reach the overview", async ({
  page,
  signInAs,
}) => {
  await signInAs(page, ADA);

  await expect(railButton(page, 'Admin')).toHaveCount(0);
  expect(await apiStatus(page, 'GET', '/admin/overview')).toBe(403);
});
