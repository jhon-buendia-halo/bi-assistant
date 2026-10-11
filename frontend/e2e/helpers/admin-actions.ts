import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import type { OrgApp } from '../fixtures/org.fixture';
import { WORLD_CUP_DATASET } from './app-actions';
import { openRail } from './org-actions';
import { AdminClient, type OrgPerson } from './scim-client';

/**
 * Seeding and UI helpers for the Admin area Features (`org-admin-*.spec.ts`,
 * specs/capabilities/admin/spec.md R37-R68). Seeding goes through SCIM, the
 * admin API and the people's own API sessions (signed in through the OIDC
 * stub). Only what has no endpoint, past activity and agent errors, is
 * written to the store through the org harness (`org.sql`).
 */

export const ALAN: OrgPerson = {
  email: 'alan@contoso.test',
  name: 'Alan Turing',
};

export type AdminTabName = 'Overview' | 'Users & groups' | 'Roles & permissions';

type AssignableRole = 'maker' | 'data-owner' | 'approver' | 'platform-admin';

interface StyleA {
  ok: boolean;
  message: string;
}

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- seeding

/**
 * `person`'s own API session, signed in through the OIDC stub; the sign-in
 * and its first request make them active today (admin R36, R39).
 */
export async function actAs(org: OrgApp, person: OrgPerson): Promise<AdminClient> {
  const client = new AdminClient(org.url, org.stub, org.scim, person);
  await client.call('GET', '/me');
  return client;
}

/** The person's directory id (they must be in the directory). */
export async function userIdOf(org: OrgApp, person: OrgPerson): Promise<string> {
  const user = await org.scim.findUser(person.email);
  if (!user) throw new Error(`No directory user ${person.email}`);
  return user.id;
}

/**
 * Makes `person` last active `daysAgo` days ago (admin R39): their sign-in
 * and last activity are set in the store, with a `user.active` event that
 * day (data-model 3.14.7). They must not sign in afterwards in the test.
 */
export async function setLastActive(
  org: OrgApp,
  person: OrgPerson,
  daysAgo: number,
): Promise<void> {
  const userId = await org.scim.ensureUser(person);
  const at = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  org.sql(
    `UPDATE users SET doc = json_set(doc, '$.lastSignInAt', ?, '$.lastActiveAt', ?) WHERE json_extract(doc, '$.id') = ?`,
    at,
    at,
    userId,
  );
  insertActivity(org, {
    type: 'user.active',
    at,
    actorId: userId,
    subjectId: userId,
  });
}

/** Appends an `activity_events` document (data-model 3.14.7). */
function insertActivity(
  org: OrgApp,
  event: {
    type: string;
    at: string;
    actorId?: string;
    subjectId?: string;
    details?: Record<string, unknown>;
  },
): void {
  org.sql(
    'INSERT INTO activity_events (doc) VALUES (?)',
    JSON.stringify({
      id: randomUUID(),
      ...event,
      createdAt: event.at,
      updatedAt: event.at,
    }),
  );
}

/**
 * Gives `person` user agents over "World Cup Core" (seed the World Cup data
 * first): `live` ones are published, `draft` ones are not. They get the
 * Maker role first if they don't hold it. Resolves to the ids by name and
 * the person's own API session.
 */
export async function giveAgents(
  org: OrgApp,
  person: OrgPerson,
  agents: { live?: string[]; draft?: string[] },
): Promise<{ ids: Record<string, string>; client: AdminClient }> {
  await org.admin.assignRole(person, 'maker');
  const client = await actAs(org, person);
  const ids: Record<string, string> = {};
  for (const name of [...(agents.live ?? []), ...(agents.draft ?? [])]) {
    const { agent } = await client.call<StyleA & { agent: { id: string } }>(
      'POST',
      '/agents',
      { name, datasets: [WORLD_CUP_DATASET] },
    );
    ids[name] = agent.id;
  }
  for (const name of agents.live ?? []) {
    await client.call('POST', `/agents/${encodeURIComponent(ids[name])}/publish`);
  }
  return { ids, client };
}

/**
 * A chat turn in a session `owner` started from the agent that ended in an
 * error (admin R40). The session is real; the failed turn is written as the
 * `agent.turn-failed` event the chat stream records (data-model 3.14.7).
 */
export async function recordAgentError(
  org: OrgApp,
  owner: OrgPerson,
  client: AdminClient,
  agentId: string,
  message: string,
): Promise<void> {
  const { session } = await client.call<StyleA & { session: { id: string } }>(
    'POST',
    '/sessions',
    { agentId },
  );
  insertActivity(org, {
    type: 'agent.turn-failed',
    at: new Date().toISOString(),
    actorId: await userIdOf(org, owner),
    subjectId: agentId,
    details: { sessionId: session.id, message },
  });
}

/** Maps a group to a role through the admin API (api.md 89). */
export async function addMapping(
  org: OrgApp,
  groupId: string,
  role: AssignableRole,
  datasourceId?: string,
): Promise<void> {
  await org.admin.call('POST', '/admin/role-mappings', {
    groupId,
    role,
    ...(datasourceId ? { datasourceId } : {}),
  });
}

/** The HTTP status of an API call from `page`'s browser (its auth session). */
export async function apiStatus(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  data?: unknown,
): Promise<number> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.fetch(`${origin}${path}`, {
    method,
    data,
    headers: method === 'GET' ? {} : { Origin: origin },
  });
  return response.status();
}

// ---------------------------------------------------------------- UI

export const button = (scope: Page | Locator, name: string): Locator =>
  scope.getByRole('button', { name, exact: true });

export const adminTab = (page: Page, name: AdminTabName): Locator =>
  page
    .getByRole('tablist', { name: 'Admin sections' })
    .getByRole('tab', { name, exact: true });

/** Opens the Admin area on the rail, then `tab` (Overview opens first). */
export async function openAdminTab(
  page: Page,
  tab: AdminTabName = 'Overview',
): Promise<void> {
  await openRail(page, 'Admin');
  await expect(adminTab(page, 'Overview')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  if (tab !== 'Overview') await adminTab(page, tab).click();
  await expect(adminTab(page, tab)).toHaveAttribute('aria-selected', 'true');
}

/** A toast in the Notifications stack, by its exact message. */
export const toast = (page: Page, message: string): Locator =>
  page
    .getByRole('region', { name: 'Notifications' })
    .getByText(message, { exact: true });

/** An admin dialog by its title (ui.md 4.18.1). */
export const dialog = (page: Page, title: string): Locator =>
  page.getByRole('dialog', { name: title, exact: true });

/**
 * Picks `option` in a picker (User, New owner, Entra ID group): types
 * `query`, then clicks the match.
 */
export async function pick(
  scope: Locator,
  label: string,
  query: string,
  option: string,
): Promise<void> {
  await scope.getByRole('combobox', { name: label, exact: true }).fill(query);
  await scope.getByRole('option', { name: option, exact: true }).click();
}

/** A user's option text in the User and New owner pickers. */
export const userOption = (person: OrgPerson): string =>
  `${person.name} · ${person.email}`;

// Overview (ui.md 4.18.2)

/** A tile's value, by the tile's label. */
export const tileValue = (page: Page, label: string): Locator =>
  page
    .getByTestId('admin-tile')
    .filter({ hasText: label })
    .getByTestId('admin-tile-value');

/** A Needs attention row, by its text. */
export const attentionRow = (page: Page, text: string): Locator =>
  page
    .getByRole('list', { name: 'Needs attention' })
    .getByRole('listitem')
    .filter({ hasText: text });

export const attentionCount = (page: Page, text: string): Locator =>
  attentionRow(page, text).getByTestId('attention-count');

export const recentActivity = (page: Page): Locator =>
  page.getByTestId('admin-recent-activity');

// Users & groups (ui.md 4.18.3)

export const usersTable = (page: Page): Locator =>
  page.getByRole('table', { name: 'Users', exact: true });

export const groupsTable = (page: Page): Locator =>
  page.getByRole('table', { name: 'Groups', exact: true });

export const searchUsers = (page: Page): Locator =>
  page.getByRole('searchbox', { name: 'Search users', exact: true });

/** The names listed in the users table, through their name buttons. */
export const listedUsers = (page: Page): Locator =>
  usersTable(page).getByRole('button');

/** The users table row of the user with this display name. */
export const userRow = (page: Page, name: string): Locator =>
  usersTable(page)
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name, exact: true }) });

/** The groups table row of this group. */
export const groupRow = (page: Page, name: string): Locator =>
  groupsTable(page)
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name, exact: true }) });

export const viewTab = (page: Page, name: string): Locator =>
  page
    .getByRole('tablist', { name: 'Directory view' })
    .getByRole('tab', { name, exact: true });

export const roleChips = (page: Page): Locator =>
  page.getByRole('group', { name: 'Filter users by role' }).getByRole('button');

/** Opens a user's detail panel from the users table (ui.md 4.18.4). */
export async function openUser(page: Page, name: string): Promise<Locator> {
  await usersTable(page).getByRole('button', { name, exact: true }).click();
  const panel = userDetails(page);
  await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible();
  return panel;
}

export const userDetails = (page: Page): Locator =>
  page.getByRole('region', { name: 'User details', exact: true });

/** A role checkbox in the user detail panel, by its exact label. */
export const roleCheckbox = (panel: Locator, label: string): Locator =>
  panel.getByRole('checkbox', { name: label, exact: true });

// Roles & permissions (ui.md 4.18.5)

export const permissionMatrix = (page: Page): Locator =>
  page.getByRole('table', { name: 'Permission matrix', exact: true });

export const MATRIX_ROLES = [
  'User',
  'Maker',
  'Data owner',
  'Approver',
  'Platform admin',
] as const;

/** The roles whose cell in this permission's row reads "Granted". */
export async function grantedRoles(
  page: Page,
  permission: string,
): Promise<string[]> {
  const row = permissionMatrix(page)
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: permission, exact: true }) });
  await expect(row).toHaveCount(1);
  const cells = row.getByRole('cell');
  await expect(cells).toHaveCount(MATRIX_ROLES.length);
  const granted: string[] = [];
  for (const [index, role] of MATRIX_ROLES.entries()) {
    if (
      (await cells.nth(index).getByText('Granted', { exact: true }).count()) > 0
    ) {
      granted.push(role);
    }
  }
  return granted;
}

export const mappingsList = (page: Page): Locator =>
  page.getByRole('list', { name: 'Group mappings', exact: true });

/** Reloads `person`'s page and opens the Agents screen (permissions reload). */
export async function reloadAgents(page: Page): Promise<void> {
  await page.reload();
  await openAgents(page);
}

export async function openAgents(page: Page): Promise<void> {
  await openRail(page, 'Agents');
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
}
