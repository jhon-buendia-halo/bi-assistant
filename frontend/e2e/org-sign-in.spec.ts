import { test, expect } from './fixtures/org.fixture';
import {
  accountMenuButton,
  expectNoAxeViolations,
  followOsTheme,
  navigationRail,
  openRail,
  signInButton,
} from './helpers/org-actions';
import { ADA, GRACE } from './helpers/scim-client';

/**
 * Mirrors the Feature "Sign in to an org server" in
 * specs/capabilities/admin/spec.md (Playwright `org` project).
 */

test.beforeEach(async ({ org }) => {
  // Background: the app runs in org server mode, and Ada is provisioned.
  await org.scim.createUser(ADA);
});

const systemLogs = (page: import('@playwright/test').Page) =>
  page.getByLabel('Open system logs');

test('an unauthenticated visitor sees only the sign-in page', async ({
  page,
}) => {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Agentic Hub' }),
  ).toBeVisible();
  await expect(
    page.getByText('Sign in with your organisation account to continue.'),
  ).toBeVisible();
  await expect(signInButton(page)).toBeVisible();
  await expect(navigationRail(page)).toHaveCount(0);
  await expect(systemLogs(page)).toHaveCount(0);

  await followOsTheme(page);
  await expectNoAxeViolations(page);
});

test('signing in opens the app as that user', async ({ page, org }) => {
  org.willSignInAs(ADA);
  await signInButton(page).click();

  await expect(systemLogs(page)).toBeVisible();
  // The home view: no rail area is current.
  await expect(
    navigationRail(page).locator('[aria-current="page"]'),
  ).toHaveCount(0);
  await expect(accountMenuButton(page)).toHaveText('AL');
  await expect(accountMenuButton(page)).toHaveAttribute(
    'title',
    'Ada Lovelace',
  );

  await accountMenuButton(page).click();
  await expect(accountMenuButton(page)).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const menu = page.getByTestId('account-menu');
  await expect(menu.getByText('Ada Lovelace', { exact: true })).toBeVisible();
  await expect(
    menu.getByText('ada@contoso.test', { exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: 'Sign out', exact: true }),
  ).toBeVisible();
});

test('a person not yet provisioned is added at first sign-in', async ({
  page,
  org,
}) => {
  expect(await org.scim.findUser(GRACE.email)).toBeNull();

  org.willSignInAs(GRACE);
  await signInButton(page).click();

  await expect(systemLogs(page)).toBeVisible();
  await expect(accountMenuButton(page)).toHaveText('GH');
  const grace = await org.scim.findUser(GRACE.email);
  expect(grace?.userName).toBe(GRACE.email);
});

test('signing out returns to the sign-in page', async ({
  page,
  org,
  signInAs,
}) => {
  await signInAs(page, ADA);

  await accountMenuButton(page).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(signInButton(page)).toBeVisible();
  // The identity provider's session was ended too (admin R10).
  expect(org.stub.endSessionCalls).toHaveLength(1);

  await page.reload();
  await expect(signInButton(page)).toBeVisible();
  await expect(navigationRail(page)).toHaveCount(0);
});

test('a failed sign-in shows an error', async ({ page, org }) => {
  org.willSignInAs(ADA);
  org.stub.failNextSignIn('access_denied');
  await signInButton(page).click();

  await expect(page.getByText('Sign-in failed. Try again.')).toBeVisible();
  await expect(signInButton(page)).toBeVisible();
  // The error is removed from the address bar once shown (ui.md 4.17).
  await expect(page).not.toHaveURL(/signInError/);
});

test('deactivating a user ends their session and blocks sign-in', async ({
  page,
  org,
  signInAs,
}) => {
  await signInAs(page, ADA);

  await org.scim.deactivate(ADA.email);
  await page.reload();
  await expect(signInButton(page)).toBeVisible();

  org.willSignInAs(ADA);
  await signInButton(page).click();
  await expect(
    page.getByText('Your account is deactivated. Contact your administrator.'),
  ).toBeVisible();
  await expect(signInButton(page)).toBeVisible();
});

test('an expired session shows the sign-in page', async ({
  page,
  org,
  signInAs,
}) => {
  await signInAs(page, ADA);

  // The auth session ends on the server (idle or absolute expiry, admin R9).
  org.sql('DELETE FROM auth_sessions');
  await openRail(page, 'Datasets');

  await expect(signInButton(page)).toBeVisible();
  await expect(navigationRail(page)).toHaveCount(0);
});

test('an org server never offers the local sign-in', async ({ page, org }) => {
  await expect(signInButton(page)).toBeVisible();
  await expect(page.getByLabel('Sign in as', { exact: true })).toHaveCount(0);
  await expect(page.locator('select#local-user')).toHaveCount(0);

  // The local sign-in routes don't exist on an org server (admin R73).
  const signIn = await page.request.post(`${org.url}/auth/local/sign-in`, {
    data: { userId: 'local' },
    headers: { Origin: org.url },
  });
  expect(signIn.status()).toBe(404);
  const users = await page.request.get(`${org.url}/auth/local/users`);
  expect(users.status()).toBe(404);
});
