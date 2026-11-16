import { chromium, type Browser } from 'playwright-core';

/**
 * The browser Review a Website drives (ADR-0049): the machine's own
 * Microsoft Edge, else Google Chrome, through playwright-core, which ships
 * no browser. `SITE_REVIEW_BROWSER_PATH` names an executable instead (tests
 * and CI point it at Playwright's Chromium).
 */
export const NO_BROWSER_MESSAGE =
  'Review a Website needs Microsoft Edge or Google Chrome installed on this computer';

/** The channels tried in order when no executable is named. */
const CHANNELS = ['msedge', 'chrome'] as const;

/** Launch the browser: headless for the crawl, visible for a sign-in. */
export async function launchSiteBrowser(options: {
  headless: boolean;
}): Promise<Browser> {
  const executablePath = process.env.SITE_REVIEW_BROWSER_PATH?.trim();
  if (executablePath) {
    return chromium.launch({ executablePath, headless: options.headless });
  }
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ channel, headless: options.headless });
    } catch {
      // Not installed here: try the next one.
    }
  }
  throw new Error(NO_BROWSER_MESSAGE);
}
