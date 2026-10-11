import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/org.fixture';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import { openRail, pageApi } from './helpers/org-actions';
import { ADA, GRACE } from './helpers/scim-client';

/**
 * Mirrors the Feature "Private and shared data" in
 * specs/capabilities/admin/spec.md (Playwright `org` project). Owner
 * isolation of every private collection is covered at API level by
 * backend/test/owner-isolation.e2e-spec.ts; this Feature checks what each
 * person sees in the app.
 */

const ASSISTANT = 'Questions to Insights Assistant';

test.beforeEach(async ({ org }) => {
  // Background: shared World Cup data, and Ada and Grace are both Makers.
  await org.admin.seedWorldCup();
  await org.admin.assignRole(ADA, 'maker');
  await org.admin.assignRole(GRACE, 'maker');
});

const sessionsNav = (page: Page) =>
  page.getByRole('navigation', { name: 'Sessions navigation' });

async function openHub(page: Page): Promise<void> {
  await openRail(page, 'Agents');
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
}

test('users share datasources and datasets', async ({
  page,
  signInAs,
  newBrowserAs,
}) => {
  await signInAs(page, ADA);
  await openRail(page, 'Datasets');
  await expect(page.getByTestId(`dataset-${WORLD_CUP_DATASET}`)).toBeVisible();

  const grace = await newBrowserAs(GRACE);
  await openRail(grace, 'Datasets');
  await expect(grace.getByTestId(`dataset-${WORLD_CUP_DATASET}`)).toBeVisible();
});

test('sessions are private to their owner', async ({
  page,
  signInAs,
  newBrowserAs,
}) => {
  await signInAs(page, ADA);
  await pageApi(page, 'POST', '/sessions', {
    name: "Ada's goals",
    datasets: [WORLD_CUP_DATASET],
  });
  await page.reload();
  await openRail(page, 'Sessions');
  await expect(sessionsNav(page)).toContainText("Ada's goals");

  const grace = await newBrowserAs(GRACE);
  await openRail(grace, 'Sessions');
  await expect(sessionsNav(grace).getByText('No sessions yet.')).toBeVisible();
  await expect(sessionsNav(grace)).not.toContainText("Ada's goals");
});

test('agents and pins are private to their owner', async ({
  page,
  signInAs,
  newBrowserAs,
}) => {
  await signInAs(page, ADA);
  await pageApi(page, 'POST', '/agents', {
    name: "Ada's analyst",
    datasets: [WORLD_CUP_DATASET],
  });
  await pageApi(page, 'PUT', '/agents/assistant/pin', { pinned: true });
  await openHub(page);
  await expect(page.getByText("Ada's analyst", { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Unpin ${ASSISTANT}`, exact: true }),
  ).toBeVisible();

  const grace = await newBrowserAs(GRACE);
  await openHub(grace);
  await expect(
    grace.getByRole('button', { name: `Pin ${ASSISTANT}`, exact: true }),
  ).toBeVisible();
  await expect(grace.getByText("Ada's analyst", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    grace.getByRole('button', { name: `Pin ${ASSISTANT}`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');

  // Names are unique per owner (admin R31).
  await grace.getByRole('button', { name: 'New agent', exact: true }).click();
  await grace.getByLabel('Name', { exact: true }).fill("Ada's analyst");
  await grace
    .getByRole('group', { name: 'Datasets' })
    .getByRole('checkbox', { name: WORLD_CUP_DATASET, exact: true })
    .check();
  await grace.getByTestId('agent-save').click();
  await expect(
    grace.getByText(`Agent "Ada's analyst" saved as draft`),
  ).toBeVisible();
});

test('knowledge is private to its owner', async ({
  page,
  signInAs,
  newBrowserAs,
}) => {
  await signInAs(page, ADA);
  await pageApi(page, 'POST', '/knowledge', {
    kind: 'term',
    title: 'Goal',
    body: 'A ball that crosses the goal line between the posts.',
  });
  await openRail(page, 'Knowledge');
  await expect(page.getByText('Goal', { exact: true })).toBeVisible();

  const grace = await newBrowserAs(GRACE);
  await openRail(grace, 'Knowledge');
  await expect(
    grace.getByRole('heading', { name: 'Knowledge', exact: true }),
  ).toBeVisible();
  await expect(grace.getByText('No knowledge yet')).toBeVisible();
  await expect(grace.getByText('Goal', { exact: true })).toHaveCount(0);
});
