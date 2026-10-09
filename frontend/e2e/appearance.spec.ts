import axe from 'axe-core';
import type { Page } from '@playwright/test';
import { expect, RunningApp, test } from './fixtures/app.fixture';

type Theme = 'light' | 'dark';

/** Canvas and surface tokens per theme (specs/system/ui.md §6.0). */
const THEME_COLOURS: Record<Theme, { canvas: string; surface: string }> = {
  light: { canvas: 'rgb(243, 246, 250)', surface: 'rgb(255, 255, 255)' },
  dark: { canvas: 'rgb(11, 22, 38)', surface: 'rgb(18, 35, 58)' },
};

/**
 * Stands in for the operating system's light/dark setting by emulating the
 * `prefers-color-scheme` media query the app follows. (Electron's
 * `nativeTheme.themeSource` does not reach that query on Linux.)
 */
async function setOsTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
}

async function openAppearance(page: Page): Promise<void> {
  await page.getByTitle('Settings').click();
  await page
    .getByRole('navigation', { name: 'Settings navigation' })
    .getByRole('button', { name: 'Appearance' })
    .click();
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
}

const themeGroup = (page: Page) =>
  page.getByRole('radiogroup', { name: 'Theme' });

const themeOption = (page: Page, name: 'System' | 'Light' | 'Dark') =>
  themeGroup(page).getByRole('radio', { name, exact: true });

async function expectTheme(page: Page, theme: Theme): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    THEME_COLOURS[theme].canvas,
  );
  const group = themeGroup(page);
  if (await group.isVisible()) {
    await expect(group).toHaveCSS(
      'background-color',
      THEME_COLOURS[theme].surface,
    );
  }
}

/**
 * Desktop only: the Electron window's own background colour (app-shell R44).
 * The web target has no native window, so there is nothing to check.
 */
async function expectWindowBackground(
  app: RunningApp,
  colour: string,
): Promise<void> {
  const electronApp = app.electronApp;
  if (!electronApp) return;
  await expect
    .poll(() =>
      electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase(),
      ),
    )
    .toBe(colour);
}

test('follows the operating system theme by default', async ({
  app,
  page,
}) => {
  await setOsTheme(page, 'light');
  await openAppearance(page);

  await expect(themeOption(page, 'System')).toBeChecked();
  await expectTheme(page, 'light');
  await expectWindowBackground(app, '#f3f6fa');

  const url = page.url();
  await setOsTheme(page, 'dark');
  await expectTheme(page, 'dark');
  expect(page.url()).toBe(url);
  await expect(themeOption(page, 'System')).toBeChecked();
  await expectWindowBackground(app, '#0b1626');
});

test('forces a theme regardless of the operating system', async ({
  app,
  page,
}) => {
  await setOsTheme(page, 'light');
  await openAppearance(page);

  await themeOption(page, 'Dark').check();
  await expectTheme(page, 'dark');
  await expectWindowBackground(app, '#0b1626');

  await setOsTheme(page, 'dark');
  await setOsTheme(page, 'light');
  await expectTheme(page, 'dark');

  await themeOption(page, 'Light').check();
  await expectTheme(page, 'light');
  await expectWindowBackground(app, '#f3f6fa');
});

test('remembers the chosen theme after a restart', async ({
  app,
  appDataDir,
  launchApp,
}) => {
  let page = app.page;
  await setOsTheme(page, 'light');
  await openAppearance(page);
  await themeOption(page, 'Dark').check();
  await expectTheme(page, 'dark');

  let restarted = app;
  if (app.target === 'web') {
    // Same port and browser profile, so the remembered choice is still there.
    await app.restartCli();
  } else {
    await app.close();
    restarted = await launchApp(appDataDir);
    page = restarted.page;
  }
  // Set by the inline boot script, before the app has rendered.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectWindowBackground(restarted, '#0b1626');

  await openAppearance(page);
  await expect(themeOption(page, 'Dark')).toBeChecked();
  await expectTheme(page, 'dark');
});

test('has no automatically detectable accessibility violations in either theme', async ({
  page,
}) => {
  await openAppearance(page);
  await page.addScriptTag({ content: axe.source });

  for (const option of ['Light', 'Dark'] as const) {
    await themeOption(page, option).check();
    await expectTheme(page, option === 'Light' ? 'light' : 'dark');
    // The Appearance section only: the legacy Settings sidebar has known
    // contrast failures that roadmap 1.8.3 removes with the rail.
    const results = await page.evaluate(async () => {
      return (window as unknown as { axe: typeof axe }).axe.run('main');
    });
    expect(results.violations, `${option} theme`).toEqual([]);
  }
});
