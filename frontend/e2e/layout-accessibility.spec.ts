import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import axe from 'axe-core';

/** Saves an evidence screenshot when E2E_EVIDENCE_DIR names a folder. */
async function evidence(page: Page, folder: string, name: string) {
  const root = process.env['E2E_EVIDENCE_DIR'];
  if (!root) return;
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), fullPage: true });
}
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASET,
  createWorldCupDataset,
  createWorldCupDatasource,
  followOsTheme,
} from './helpers/app-actions';

test('supports keyboard layout controls and persists the right-panel width', async ({
  page,
}) => {
  await page.getByTitle('Expand right panel').click();
  const separator = page.getByRole('separator', { name: 'Resize right panel' });
  await expect(separator).toHaveAttribute('aria-valuenow', '572');

  await separator.focus();
  await separator.press('Home');
  await expect(separator).toHaveAttribute('aria-valuenow', '360');
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('questions-to-insights:right-panel-width'),
      ),
    )
    .toBe('360');

  await separator.press('End');
  await expect(separator).toHaveAttribute('aria-valuenow', '960');
  await separator.dblclick();
  await expect(separator).toHaveAttribute('aria-valuenow', '572');

  await page.getByTitle('Collapse right panel').click();
  await expect(separator).toBeHidden();
  await page.getByTitle('Expand right panel').click();
  await expect(separator).toBeVisible();
});

test('has no automatically detectable accessibility violations in the application shell', async ({
  page,
}) => {
  await page.addScriptTag({ content: axe.source });
  const results = await page.evaluate(async () => {
    return (window as unknown as { axe: typeof axe }).axe.run(document);
  });
  expect(results.violations).toEqual([]);
});

test('has no automatically detectable accessibility violations on any screen in either theme', async ({
  page,
}) => {
  test.slow();
  await followOsTheme(page);
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page);
  await page.addScriptTag({ content: axe.source });

  const rail = (name: string) =>
    page
      .getByRole('complementary', { name: 'Navigation rail' })
      .getByRole('button', { name, exact: true });
  const settingsSection = async (name: string) => {
    await rail('Settings').click();
    const section = page
      .getByRole('navigation', { name: 'Settings navigation' })
      .getByRole('button', { name });
    if ((await section.getAttribute('aria-current')) !== 'page') {
      await section.click();
    }
    await expect(page.getByRole('heading', { name })).toBeVisible();
  };
  const screens: [string, () => Promise<void>][] = [
    [
      'Datasets',
      async () => {
        await rail('Datasets').click();
        await expect(
          page.getByRole('heading', { name: 'Datasets' }),
        ).toBeVisible();
      },
    ],
    [
      'Dataset editor',
      async () => {
        await rail('Datasets').click();
        await page.getByRole('button', { name: 'New dataset' }).click();
        await expect(
          page.getByRole('heading', { name: 'New dataset' }),
        ).toBeVisible();
      },
    ],
    [
      'Agents',
      async () => {
        await rail('Agents').click();
        await expect(
          page.getByRole('heading', { name: 'Agents' }),
        ).toBeVisible();
      },
    ],
    [
      'Agent detail',
      async () => {
        await rail('Agents').click();
        await page.getByTestId('agent-assistant').click();
        await expect(page.getByText('All agents')).toBeVisible();
      },
    ],
    [
      'Dataset ontology',
      async () => {
        await rail('Datasets').click();
        await page.getByTestId(`dataset-${WORLD_CUP_DATASET}`).click();
        await page.getByTestId('dataset-tab-ontology').click();
        await expect(
          page.getByRole('heading', { name: 'Ontology', exact: true }),
        ).toBeVisible();
      },
    ],
    [
      'User personas',
      async () => {
        await rail('Context').click();
        await page.getByTestId('context-section-personas').click();
        await expect(
          page.getByRole('heading', { name: 'User personas' }),
        ).toBeVisible();
      },
    ],
    [
      'Runs',
      async () => {
        await rail('Runs').click();
        await expect(
          page.getByRole('tablist', { name: 'Runs views' }),
        ).toBeVisible();
      },
    ],
    [
      'Datasource Configuration',
      () => settingsSection('Datasource Configuration'),
    ],
    ['LLM Configuration', () => settingsSection('LLM Configuration')],
    ['Testing Data', () => settingsSection('Testing Data')],
    ['Developer', () => settingsSection('Developer')],
    ['Appearance', () => settingsSection('Appearance')],
  ];

  const failures: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const [name, open] of screens) {
      await open();
      await page.mouse.move(1, 1);
      await page.waitForTimeout(250); // let colour transitions settle
      const results = await page.evaluate(async () =>
        (window as unknown as { axe: typeof axe }).axe.run(document),
      );
      for (const violation of results.violations) {
        for (const node of violation.nodes) {
          failures.push(
            `${theme} · ${name} · ${violation.id} · ${node.target.join(' ')} · ${node.failureSummary?.split('\n').slice(-1)[0] ?? ''}`,
          );
        }
      }
    }
  }
  expect(failures).toEqual([]);
});

test('text in the app can be selected', async ({ page }) => {
  const heading = page.getByRole('heading', { name: 'Welcome to Agentic Hub' });
  await heading.click({ clickCount: 3 });
  expect(
    await page.evaluate(() => window.getSelection()?.toString()),
  ).toContain('Welcome to Agentic Hub');
  await evidence(page, '1.20.5', 'text-selected.png');
  expect(
    await heading.evaluate((el) => getComputedStyle(el).userSelect),
  ).not.toBe('none');

  await page.getByTitle('Expand right panel').click();
  const separator = page.getByRole('separator', { name: 'Resize right panel' });
  const box = (await separator.boundingBox())!;
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 5 });
  await expect(page.locator('.resizing-right-panel')).toHaveCount(1);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await page.mouse.up();
});

test('matches the stable application-shell visual baseline', async ({
  page,
}) => {
  await expect(page).toHaveScreenshot('application-shell.png', {
    caret: 'hide',
  });
});
