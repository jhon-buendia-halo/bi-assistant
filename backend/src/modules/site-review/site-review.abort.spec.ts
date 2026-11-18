/**
 * A stop ends Review a Website's browser work at once (agents.md 5.19): the
 * browser is closed under the navigation in flight, the operation reports
 * stopped, the abort listener is removed and the browser closes once. Uses a
 * fake browser, so it runs without Chromium.
 */
jest.mock('../../mastra/session-workspaces', () => ({
  sessionWorkspacePath: (id: string) => id,
}));
jest.mock('../sessions/workspace-files', () => ({
  writeWorkspaceFile: () => Promise.resolve(),
}));
jest.mock('./site-browser', () => ({ launchSiteBrowser: jest.fn() }));

import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import type { PreparedSession } from '../../mastra/workflows/review-website.schemas';
import { launchSiteBrowser } from './site-browser';
import { SiteReviewService } from './site-review.service';
import type { SiteSignInsRepository } from './site-signins.repository';

/** A browser whose navigation hangs until the browser is closed. */
function fakeBrowser() {
  let release: (error: Error) => void = () => undefined;
  const gotoStarted = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  let rejectGoto: (error: Error) => void = () => undefined;
  const page = {
    goto: jest.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectGoto = reject;
          release(new Error('started'));
        }),
    ),
    url: () => 'https://example.test/',
    close: jest.fn(() => Promise.resolve()),
  };
  const close = jest.fn(() => {
    rejectGoto(new Error('Target page, context or browser has been closed'));
    return Promise.resolve();
  });
  const context = {
    newPage: jest.fn(() => Promise.resolve(page)),
    close: jest.fn(() => Promise.resolve()),
  };
  const browser = {
    newContext: jest.fn(() => Promise.resolve(context)),
    close,
  };
  return { browser, close, gotoStarted };
}

const prepared = {
  url: 'https://example.test/',
  origin: 'https://example.test',
  screens: ['desktop'],
  maxPages: 5,
  maxDepth: 1,
  exclude: '',
  signedIn: false,
  loginUrl: '',
} as unknown as PreparedSession;

describe('SiteReviewService stop', () => {
  it('ends a navigation in flight at once as stopped, removes the listener and closes the browser once', async () => {
    const { browser, close, gotoStarted } = fakeBrowser();
    (launchSiteBrowser as jest.Mock).mockResolvedValue(browser);
    const stop = new AbortController();
    const remove = jest.spyOn(stop.signal, 'removeEventListener');
    const service = new SiteReviewService(
      {} as SiteSignInsRepository,
      new CryptoService(),
    );
    const work = service.forRun({
      sessionId: 's',
      signal: stop.signal,
      progress: () => undefined,
    });

    const running = work.discoverPages(prepared);
    await gotoStarted;
    stop.abort();

    await expect(running).rejects.toThrow('The review was stopped');
    expect(close).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
