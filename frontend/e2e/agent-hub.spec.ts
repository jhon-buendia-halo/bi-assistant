import axe from 'axe-core';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DATASET, followOsTheme } from './helpers/app-actions';
import {
  createUserAgent,
  publishAgent,
  saveAgentDraft,
  seedWorldCupDataset,
} from './helpers/agents-api';

/** Mirrors the Feature "Agent Hub" in specs/capabilities/agents-evals/spec.md. */

const ASSISTANT = 'Questions to Insights Assistant';
const HEALTH = 'Health plan analyst';
const HEALTH_DESCRIPTION = 'Answers questions about the 2026 health plan';
const CLAIMS = 'Claims triage';
const CLAIMS_DESCRIPTION = 'Sorts incoming claims by urgency';

/** Ids of the Background's user agents (a user agent's key is its id). */
let healthId = '';
let claimsId = '';

test.beforeEach(async ({ page }) => {
  // Background
  await seedWorldCupDataset(page);
  healthId = await createUserAgent(page, {
    name: HEALTH,
    description: HEALTH_DESCRIPTION,
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, healthId);
  claimsId = await createUserAgent(page, {
    name: CLAIMS,
    description: CLAIMS_DESCRIPTION,
  });
});

async function openHub(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
}

function section(page: Page, id: string): Locator {
  return page.getByTestId(`agent-section-${id}`);
}

function cards(scope: Page | Locator): Locator {
  return scope.locator('[data-testid^="agent-card-"]');
}

/** The keys of the cards in `scope`, in the order they are shown. */
async function cardKeys(scope: Page | Locator): Promise<string[]> {
  const ids = await cards(scope).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-testid') ?? ''),
  );
  return ids.map((id) => id.slice('agent-card-'.length));
}

async function sectionIds(page: Page): Promise<string[]> {
  const ids = await page
    .locator('[data-testid^="agent-section-"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-testid') ?? ''),
    );
  return ids.map((id) => id.slice('agent-section-'.length));
}

function filter(page: Page, name: string): Locator {
  return page
    .getByRole('group', { name: 'Filter agents' })
    .getByRole('button', { name, exact: true });
}

function search(page: Page): Locator {
  return page.getByLabel('Search agents by name or description', {
    exact: true,
  });
}

async function openAgent(page: Page, key: string, name: string) {
  await page.getByTestId(`agent-${key}`).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

function button(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
}

test('shows the built-in agents and mine in sections', async ({ page }) => {
  await openHub(page);

  await expect(section(page, 'system')).toBeVisible();
  expect(await sectionIds(page)).toEqual(['official', 'mine', 'system']);
  await expect(section(page, 'pinned')).toHaveCount(0);
  await expect(button(page, 'New agent')).toBeEnabled();

  const official = section(page, 'official');
  await expect(
    official.getByRole('heading', { name: 'Official' }),
  ).toBeVisible();
  await expect(official.getByTestId('agent-card-assistant')).toContainText(
    ASSISTANT,
  );
  await expect(official.getByTestId('agent-card-assistant')).toContainText(
    'Owner: Official',
  );

  const mine = section(page, 'mine');
  await expect(mine.getByTestId(`agent-card-${healthId}`)).toContainText(
    HEALTH,
  );
  await expect(mine.getByTestId(`agent-card-${healthId}`)).toContainText(
    'Owner: You',
  );
  await expect(mine.getByTestId(`agent-status-${healthId}`)).toHaveText('Live');
  await expect(mine.getByTestId(`agent-card-${claimsId}`)).toContainText(
    CLAIMS,
  );
  await expect(mine.getByTestId(`agent-status-${claimsId}`)).toHaveText(
    'Draft',
  );

  const system = section(page, 'system');
  await expect(cards(system)).toHaveCount(3);
  const showMore = system.getByTestId('agent-show-more-system');
  await expect(showMore).toHaveText('Show more (2)');
  await expect(showMore).toHaveAttribute('aria-expanded', 'false');

  await button(page, 'Show more (2)').click();
  await expect(cards(system)).toHaveCount(5);
  await expect(system.getByTestId('agent-card-sql-verifier')).toContainText(
    'SQL Verifier',
  );
  await expect(showMore).toHaveAttribute('aria-expanded', 'true');

  await button(page, 'Show less').click();
  await expect(cards(system)).toHaveCount(3);
});

test('search narrows the agents by name or description', async ({ page }) => {
  await openHub(page);

  await search(page).fill('urgency');
  await expect(page.getByTestId(`agent-card-${claimsId}`)).toBeVisible();
  await expect(page.getByTestId(`agent-card-${healthId}`)).toHaveCount(0);

  await search(page).fill('HEALTH PLAN');
  await expect(page.getByTestId(`agent-card-${healthId}`)).toBeVisible();
  await expect(page.getByTestId(`agent-card-${claimsId}`)).toHaveCount(0);

  await search(page).fill('nothing here');
  await expect(page.getByText('No agents match "nothing here"')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test('filters limit the hub to one kind of agent', async ({ page }) => {
  await openHub(page);

  await filter(page, 'Mine').click();
  await expect(filter(page, 'Mine')).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page)).toHaveCount(2);
  expect(await cardKeys(page)).toEqual([claimsId, healthId]);
  expect(await sectionIds(page)).toEqual(['mine']);

  await filter(page, 'Official').click();
  await expect(cards(page)).toHaveCount(1);
  expect(await cardKeys(page)).toEqual(['assistant']);
  expect(await sectionIds(page)).toEqual(['official']);

  await filter(page, 'Pinned').click();
  await expect(page.getByText('No pinned agents yet.')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);

  await filter(page, 'All').click();
  await expect(section(page, 'system')).toBeVisible();
});

test('pinned agents come first in their own section and survive a restart', async ({
  app,
  appDataDir,
  launchApp,
}) => {
  let page = app.page;
  await openHub(page);

  await button(page, `Pin ${HEALTH}`).click();
  await button(page, `Pin ${ASSISTANT}`).click();

  const assistantToggle = button(page, `Unpin ${ASSISTANT}`);
  await expect(assistantToggle).toHaveText('Pinned');
  await expect(assistantToggle).toHaveAttribute('aria-pressed', 'true');
  expect((await cardKeys(section(page, 'official')))[0]).toBe('assistant');

  const healthToggle = button(page, `Unpin ${HEALTH}`);
  await expect(healthToggle).toHaveText('Pinned');
  await expect(cards(section(page, 'mine')).first()).toHaveAttribute(
    'data-testid',
    `agent-card-${healthId}`,
  );
  await expect(section(page, 'pinned')).toHaveCount(0);

  await filter(page, 'Pinned').click();
  await expect(cards(section(page, 'pinned'))).toHaveCount(2);
  expect(await cardKeys(section(page, 'pinned'))).toEqual([
    'assistant',
    healthId,
  ]);

  // The app restarts on the same data directory.
  if (app.target === 'web') {
    await app.restartCli();
  } else {
    await app.close();
    page = (await launchApp(appDataDir)).page;
  }

  await openHub(page);
  await filter(page, 'Pinned').click();
  await expect(cards(section(page, 'pinned'))).toHaveCount(2);
  expect(await cardKeys(section(page, 'pinned'))).toEqual([
    'assistant',
    healthId,
  ]);

  await button(page, `Unpin ${HEALTH}`).click();
  await expect(cards(section(page, 'pinned'))).toHaveCount(1);
  expect(await cardKeys(section(page, 'pinned'))).toEqual(['assistant']);

  await filter(page, 'All').click();
  await expect(
    section(page, 'mine').getByRole('button', {
      name: `Pin ${HEALTH}`,
      exact: true,
    }),
  ).toHaveText('Pin');
});

test('flags an agent whose dataset no longer exists', async ({ page }) => {
  await saveAgentDraft(page, claimsId, {
    name: CLAIMS,
    description: CLAIMS_DESCRIPTION,
    datasets: ['Gone'],
  });
  await openHub(page);

  await expect(page.getByTestId(`agent-card-${claimsId}`)).toContainText(
    'Missing dataset: Gone',
  );
  await expect(page.getByTestId(`agent-card-${healthId}`)).toBeVisible();
  await expect(page.getByTestId(`agent-card-${healthId}`)).not.toContainText(
    'Missing dataset',
  );
});

test("a card opens the agent's detail view with its actions", async ({
  page,
}) => {
  await openHub(page);

  await openAgent(page, claimsId, CLAIMS);
  await expect(button(page, 'Edit')).toBeVisible();
  await expect(button(page, 'Publish')).toBeVisible();
  await expect(button(page, 'Delete')).toBeVisible();
  await expect(button(page, 'Start chat')).toHaveCount(0);

  await button(page, 'All agents').click();
  await openAgent(page, healthId, HEALTH);
  await expect(button(page, 'Start chat')).toBeVisible();
  await expect(button(page, 'Edit')).toBeVisible();
  await expect(button(page, 'Delete')).toBeVisible();
  await expect(button(page, 'Publish')).toHaveCount(0);

  await button(page, 'All agents').click();
  await openAgent(page, 'assistant', ASSISTANT);
  await expect(button(page, 'Start chat')).toBeVisible();
  await expect(button(page, 'Edit')).toHaveCount(0);
  await expect(button(page, 'Publish')).toHaveCount(0);
  await expect(button(page, 'Delete')).toHaveCount(0);
});

test('publishing a draft makes it Live', async ({ page }) => {
  await openHub(page);

  await openAgent(page, claimsId, CLAIMS);
  await button(page, 'Publish').click();
  await expect(
    page.getByText('Select at least one dataset to publish'),
  ).toBeVisible();

  await saveAgentDraft(page, claimsId, {
    name: CLAIMS,
    description: CLAIMS_DESCRIPTION,
    datasets: [WORLD_CUP_DATASET],
  });
  await button(page, 'All agents').click();
  await openAgent(page, claimsId, CLAIMS);
  await button(page, 'Publish').click();
  await expect(page.getByText(`Agent "${CLAIMS}" is Live`)).toBeVisible();
  await expect(button(page, 'Publish')).toHaveCount(0);

  await button(page, 'All agents').click();
  await expect(
    section(page, 'mine').getByTestId(`agent-status-${claimsId}`),
  ).toHaveText('Live');
});

test('deleting an agent asks first', async ({ page }) => {
  await openHub(page);
  await openAgent(page, claimsId, CLAIMS);

  const asked: string[] = [];
  page.once('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await button(page, 'Delete').click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe(
    `Delete "${CLAIMS}"?\n\nIts sessions keep their transcripts and continue with the assistant.`,
  );
  await expect(
    page.getByRole('heading', { name: CLAIMS, exact: true }),
  ).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await button(page, 'Delete').click();
  await expect(page.getByText(`Agent "${CLAIMS}" deleted`)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId(`agent-card-${healthId}`)).toBeVisible();
  await expect(page.getByTestId(`agent-card-${claimsId}`)).toHaveCount(0);
});

test('the hub has no detectable accessibility violations in either theme', async ({
  page,
}) => {
  await followOsTheme(page);
  await openHub(page);
  await button(page, 'Show more (2)').click();
  await expect(cards(section(page, 'system'))).toHaveCount(5);

  await page.addScriptTag({ content: axe.source });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Let the theme's colour transitions finish before axe reads colours.
    await page.waitForTimeout(500);
    const results = await page.evaluate(async () => {
      return (window as unknown as { axe: typeof axe }).axe.run(document);
    });
    expect(results.violations, theme).toEqual([]);
  }
});
