import axe from 'axe-core';
import { test, expect } from './fixtures/app.fixture';
import {
  createWorldCupDataset,
  createWorldCupDatasource,
} from './helpers/app-actions';

test('supports keyboard layout controls and persists the right-panel width', async ({
  page,
}) => {
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
    ['Datasets', async () => {
      await rail('Datasets').click();
      await expect(page.getByRole('heading', { name: 'Datasets' })).toBeVisible();
    }],
    ['Dataset editor', async () => {
      await rail('Datasets').click();
      await page.getByRole('button', { name: 'New dataset' }).click();
      await expect(page.getByRole('heading', { name: 'New dataset' })).toBeVisible();
    }],
    ['Agents', async () => {
      await rail('Agents').click();
      await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
    }],
    ['Agent detail', async () => {
      await rail('Agents').click();
      await page.getByTestId('agent-assistant').click();
      await expect(page.getByText('All agents')).toBeVisible();
    }],
    ['Knowledge', async () => {
      await rail('Knowledge').click();
      await expect(page.getByRole('heading', { name: 'Knowledge' })).toBeVisible();
    }],
    ['Sessions', async () => {
      await rail('Sessions').click();
      await expect(page.getByRole('navigation', { name: 'Sessions navigation' })).toBeVisible();
    }],
    ['New-session composer', async () => {
      await rail('Sessions').click();
      await page.getByTitle('New conversation').click();
      await expect(page.getByPlaceholder('My new session')).toBeVisible();
    }],
    ['Datasource Configuration', () => settingsSection('Datasource Configuration')],
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

test('matches the stable application-shell visual baseline', async ({
  page,
}) => {
  await expect(page).toHaveScreenshot('application-shell.png', {
    caret: 'hide',
  });
});
