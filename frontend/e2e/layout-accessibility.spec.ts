import axe from 'axe-core';
import { test, expect } from './fixtures/app.fixture';

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

  await page.getByTitle('Collapse sidebar').click();
  await expect(page.getByTitle('Expand sidebar')).toBeVisible();
  await page.getByTitle('Expand sidebar').click();
  await expect(page.getByLabel('Open system logs')).toBeVisible();
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

test('matches the stable application-shell visual baseline', async ({
  page,
}) => {
  await expect(page).toHaveScreenshot('application-shell.png', {
    caret: 'hide',
  });
});
