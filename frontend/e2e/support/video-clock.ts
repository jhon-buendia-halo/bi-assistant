import type { Page } from '@playwright/test';

/**
 * When each page's recorded video started: Playwright starts recording when
 * the page is created, so a walkthrough's subtitle times are measured from
 * there (scripts/walkthrough.mjs). No imports from the fixture, so both the
 * fixture and demo-captions.ts can use it.
 */
const started = new WeakMap<Page, number>();

export function markVideoStart(page: Page): void {
  started.set(page, Date.now());
}

/** Seconds since the page's video started (0 for a page with no mark). */
export function videoSeconds(page: Page): number {
  const at = started.get(page);
  return at === undefined ? 0 : (Date.now() - at) / 1000;
}
