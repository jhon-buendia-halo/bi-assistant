import axe from 'axe-core';
import { expect, type Locator, type Page } from '@playwright/test';

/** UI actions and checks shared by the org server Features (`org-*.spec.ts`). */

export const signInButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Sign in with Microsoft', exact: true });

export const navigationRail = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Navigation rail' });

/** The rail avatar in org server mode (ui.md 1.3). */
export const accountMenuButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Account menu', exact: true });

/** A rail button by its exact name ("Datasets", "Admin", "Settings"…). */
export const railButton = (page: Page, name: string): Locator =>
  navigationRail(page).getByRole('button', { name, exact: true });

export async function openRail(page: Page, name: string): Promise<void> {
  await railButton(page, name).click();
}

/** The Settings list's section names, in order. */
export async function settingsSections(page: Page): Promise<string[]> {
  const nav = page.getByRole('navigation', { name: 'Settings navigation' });
  await expect(nav).toBeVisible();
  return (await nav.getByRole('button').allTextContents()).map((text) =>
    text.trim(),
  );
}

/** Opens the New-session composer from the Sessions area. */
export async function startNewConversation(page: Page): Promise<void> {
  await openRail(page, 'Sessions');
  await page
    .getByRole('button', { name: 'Start New Conversation', exact: true })
    .click();
  await expect(page.getByPlaceholder('My new session')).toBeVisible();
}

/** The composer's Reasoning effort dropdown (ui.md 4.7). */
export const composerReasoningEffort = (page: Page): Locator =>
  page.getByRole('main').getByTitle('Reasoning effort', { exact: true });

/**
 * Chooses the System theme through the browser copy and reloads, so a test
 * can drive light and dark through the emulated OS setting. The copy moves to
 * the backend at the next load once signed in (app-shell R43); on the
 * sign-in page it is all there is. Call it before navigating.
 */
export async function followOsTheme(page: Page): Promise<void> {
  await page.evaluate(() =>
    localStorage.setItem('questions-to-insights:theme', 'system'),
  );
  await page.reload();
  await expect(
    signInButton(page).or(page.getByLabel('Open system logs')),
  ).toBeVisible();
}

/** Runs axe on the page in the Light and the Dark theme (after followOsTheme). */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Let the theme's colour transitions finish before axe reads colours.
    await page.waitForTimeout(500);
    const results = await page.evaluate(async () =>
      (window as unknown as { axe: typeof axe }).axe.run(document),
    );
    expect(results.violations, `${theme} theme`).toEqual([]);
  }
}

/**
 * A JSON API call from `page`'s browser context (its auth session cookie),
 * with the Origin an org server requires on changes (admin R27).
 */
export async function pageApi<T = { ok: boolean; message: string }>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
): Promise<T> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.fetch(`${origin}${path}`, {
    method,
    data,
    headers: method === 'GET' ? {} : { Origin: origin },
  });
  expect(
    response.ok(),
    `${method} ${path} → HTTP ${response.status()}: ${await response.text()}`,
  ).toBe(true);
  const body = (await response.json()) as T & {
    ok?: boolean;
    message?: string;
  };
  expect(body.ok, `${method} ${path}: ${body.message}`).not.toBe(false);
  return body;
}
