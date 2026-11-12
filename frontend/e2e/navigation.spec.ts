import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/app.fixture';
import { apiFetch } from './helpers/api';
import { scenarioStep } from './support/demo-captions';

/** Evidence screenshots of the claimed state (CLAUDE.md Evidence convention). */
const evidence = (feature: string, name: string) =>
  path.resolve(__dirname, '../../evidence', feature, name);

const rail = (page: Page) =>
  page.getByRole('complementary', { name: 'Navigation rail' });

/** The Runs page: its tabs, Runs and Past chats. */
const sessionsList = (page: Page) =>
  page.getByRole('tablist', { name: 'Runs views' });

const railItem = (page: Page, name: string) =>
  rail(page).getByRole('button', { name, exact: true });

async function expectCurrent(page: Page, name: string): Promise<void> {
  await expect(railItem(page, name)).toHaveAttribute('aria-current', 'page');
}

test('moves between areas from the rail', async ({ page }) => {
  await railItem(page, 'Datasets').click();
  await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible();
  await expectCurrent(page, 'Datasets');

  await railItem(page, 'Workflows').click();
  await expect(
    page.getByRole('heading', { name: 'Workflows', exact: true }),
  ).toBeVisible();
  await expectCurrent(page, 'Workflows');

  await railItem(page, 'Agents').click();
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  await expectCurrent(page, 'Agents');
  await expect(railItem(page, 'Datasets')).not.toHaveAttribute('aria-current');

  await railItem(page, 'Agents').click();
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  await expectCurrent(page, 'Agents');

  await railItem(page, 'Context').click();
  await expectCurrent(page, 'Context');
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
  await expect(page.getByTestId('context-section-knowledge')).toHaveCount(0);
  await expect(page.getByTestId('context-section-ontologies')).toBeVisible();
  await expect(page.getByTestId('context-section-personas')).toBeVisible();
  await page.getByTestId('context-section-visuals').click();
  await expect(
    page.getByRole('heading', { name: 'Visuals', exact: true }),
  ).toBeVisible();
  await expectCurrent(page, 'Context');
  await page.getByTestId('context-back').click();
  await expect(page.getByRole('heading', { name: 'Context' })).toBeVisible();
  await page.getByTestId('context-section-personas').click();
  await expect(
    page.getByRole('heading', { name: 'User personas' }),
  ).toBeVisible();
  await expectCurrent(page, 'Context');

  await railItem(page, 'Runs').click();
  await expectCurrent(page, 'Runs');
  await expect(sessionsList(page)).toBeVisible();
  await expect(
    page
      .locator('header')
      .getByRole('button', { name: 'Start New Conversation' }),
  ).toBeVisible();
  // The drawer does not list sessions.
  await expect(
    page.getByRole('navigation', { name: 'Sessions navigation' }),
  ).toHaveCount(0);
});

test(
  'Opens the empty Monitoring page from the rail',
  async ({ page }) => {
    await scenarioStep(page, 'When I click "Monitoring" on the rail', async () => {
      await railItem(page, 'Monitoring').click();
    });
    await scenarioStep(
      page,
      'Then I see the "Monitoring" page with "No LLM calls yet." and "Monitoring" is the current rail item',
      async () => {
        await expect(
          page.getByRole('heading', { name: 'Monitoring', exact: true }),
        ).toBeVisible();
        await expect(page.getByTestId('monitoring-note')).toHaveText(
          "LLM calls made by the app's agents, newest first.",
        );
        await expect(page.getByTestId('llm-calls-empty')).toHaveText(
          'No LLM calls yet.',
        );
        await expectCurrent(page, 'Monitoring');
      },
    );
    await scenarioStep(page, 'When I click "Runs" on the rail', async () => {
      await railItem(page, 'Runs').click();
    });
    await scenarioStep(
      page,
      'Then I see the Runs page and "Monitoring" is no longer the current rail item',
      async () => {
        await expect(sessionsList(page)).toBeVisible();
        await expect(railItem(page, 'Monitoring')).not.toHaveAttribute(
          'aria-current',
        );
        await expect(page.getByTestId('monitoring-page')).toHaveCount(0);
      },
    );
  },
);

test('the start page explains how the product works', async ({ page }) => {
  await expect(
    page.getByRole('heading', { name: 'Welcome to Agentic Hub' }),
  ).toBeVisible();
  const steps = [
    'Pick your data',
    'Ask a question',
    'Work with an agent',
    'Read, refine, download',
  ];
  for (const [index, step] of steps.entries()) {
    await expect(page.getByTestId(`welcome-step-${index + 1}`)).toContainText(
      step,
    );
  }
  // The fourth step names a place but opens nothing.
  await expect(
    page.getByTestId('welcome-step-4').getByRole('button'),
  ).toHaveCount(0);
  await page.screenshot({ path: evidence('1.14.17', 'welcome-page.png') });

  // Each step opens the place it names (app-shell R51).
  const step = (n: number) => page.getByTestId(`welcome-step-${n}`);
  await step(1).getByRole('button', { name: 'Datasets' }).click();
  await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible();
  await expectCurrent(page, 'Datasets');

  await page.goto(page.url());
  await step(2).getByRole('button', { name: 'Start a conversation' }).click();
  await expect(page.getByPlaceholder('My new session')).toBeVisible();
  await expectCurrent(page, 'Runs');

  await page.goto(page.url());
  await step(3).getByRole('button', { name: 'Agents' }).click();
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  await expectCurrent(page, 'Agents');

  await page.goto(page.url());
  await page.getByRole('button', { name: 'Explore agents' }).click();
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  await expectCurrent(page, 'Agents');
});

test('opens with the navigation drawer expanded', async ({ page }) => {
  await expect(
    page.getByRole('button', { name: 'Collapse navigation' }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByText('Datasets', { exact: true }),
  ).toBeVisible();
});

test('remembers a collapsed drawer after a restart', async ({
  app,
  appDataDir,
  launchApp,
}) => {
  await app.page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(
    app.page.getByRole('button', { name: 'Expand navigation' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await app.close();

  // A fresh browser profile on the same data: only the database remembers.
  const second = await launchApp(appDataDir);
  await expect(
    second.page.getByRole('button', { name: 'Expand navigation' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await second.page.getByRole('button', { name: 'Expand navigation' }).click();
  await second.close();

  const third = await launchApp(appDataDir);
  await expect(
    third.page.getByRole('button', { name: 'Collapse navigation' }),
  ).toHaveAttribute('aria-expanded', 'true');
});

test('expands the rail into a drawer with labels', async ({ page }) => {
  // Given the navigation drawer is collapsed
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  const menu = page.getByRole('button', { name: 'Expand navigation' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');

  await menu.click();
  const workspace = page.getByRole('navigation', {
    name: 'Workspace navigation',
  });
  for (const label of [
    'Datasets',
    'Agents',
    'Context',
    'Runs',
    'Monitoring',
  ]) {
    await expect(workspace.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole('navigation', { name: 'Sessions navigation' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Collapse navigation' }),
  ).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(
    page.getByRole('button', { name: 'Expand navigation' }),
  ).toHaveAttribute('aria-expanded', 'false');

  await railItem(page, 'Runs').click();
  await expect(sessionsList(page)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Expand navigation' }),
  ).toHaveAttribute('aria-expanded', 'false');
});

test('shows the details panel only on demand', async ({ page }) => {
  const panel = page.getByRole('complementary', { name: 'Details panel' });
  await expect(panel).toHaveCount(0);
  await page.getByTitle('Expand right panel').click();
  await expect(panel).toBeVisible();
  await page.getByTitle('Collapse right panel').click();
  await expect(panel).toHaveCount(0);
});

test('opens Settings as an area with a section list', async ({ page }) => {
  await railItem(page, 'Settings').click();
  await expectCurrent(page, 'Settings');

  const sections = page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button');
  await expect(sections).toHaveText([
    /Datasource Configuration/,
    /LLM Configuration/,
    /Testing Data/,
    /Developer/,
    /Appearance/,
  ]);
  await expect(page.getByText('Choose a settings section.')).toBeVisible();

  await sections.filter({ hasText: 'Appearance' }).click();
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();

  await railItem(page, 'Datasets').click();
  await expect(
    page.getByRole('navigation', { name: 'Settings navigation' }),
  ).toHaveCount(0);

  await railItem(page, 'Settings').click();
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
});

test('shows the product name', async ({ page }) => {
  // Only the banner names US Health (app-shell R7, BA-234).
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'US Health Agentic Hub',
  );
  await expect(page).toHaveTitle('Agentic Hub');

  await railItem(page, 'Settings').click();
  await expect(page.getByTestId('app-version')).toHaveText(
    /^Agentic Hub v\d+\.\d+\.\d+$/,
  );
});

test('the app opens straight into the shell', async ({ page }) => {
  // The fixture only waits for the shell; it never signs in (BA-232).
  await expect(rail(page)).toBeVisible();
  await expect(page.getByLabel('Open system logs')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Welcome to Agentic Hub' }),
  ).toBeVisible();
  // No sign-in page.
  await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0);
  await expect(page.getByText(/sign in/i)).toHaveCount(0);
  // No account avatar or account menu, and no Admin item.
  await expect(
    page.getByRole('button', { name: 'Account menu', exact: true }),
  ).toHaveCount(0);
  await expect(railItem(page, 'Admin')).toHaveCount(0);
  await expect(rail(page).getByText('Admin', { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: evidence('1.14.19', 'opens-without-sign-in.png'),
  });

  // The identity and admin routes are gone (api.md; ADR-0030).
  for (const route of ['/me', '/admin/overview', '/auth/local/personas']) {
    expect((await apiFetch(page, 'GET', route)).status(), route).toBe(404);
  }

  // Every area is reachable (app-shell R3, R50).
  for (const [area, heading] of [
    ['Datasets', 'Datasets'],
    ['Agents', 'Agents'],
    ['Context', 'Context'],
  ]) {
    await railItem(page, area).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expectCurrent(page, area);
  }
  await railItem(page, 'Runs').click();
  await expect(sessionsList(page)).toBeVisible();

  // Every Settings section is reachable, LLM Configuration with its
  // Reasoning effort (llm-settings R37, R43).
  await railItem(page, 'Settings').click();
  const sections = page.getByRole('navigation', {
    name: 'Settings navigation',
  });
  for (const section of [
    'Datasource Configuration',
    'LLM Configuration',
    'Testing Data',
    'Developer',
    'Appearance',
  ]) {
    await sections.getByRole('button', { name: section }).click();
    await expect(
      page.getByRole('heading', { name: section, exact: true }),
    ).toBeVisible();
    if (section === 'LLM Configuration') {
      await expect(page.getByLabel('Reasoning effort')).toBeVisible();
    }
  }
});
