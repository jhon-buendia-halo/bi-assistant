import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { sessionWorkspacePath } from '../../mastra/session-workspaces';
import { collectDomSnapshot } from '../../mastra/workflows/review-website.collect';
import {
  axeFindings,
  exclusionMatcher,
  loadFindings,
  mergeFindings,
  snapshotFindings,
  urlGroup,
} from '../../mastra/workflows/review-website.checks';
import {
  SITE_SCREENS,
  axeViolationSchema,
  domSnapshotSchema,
  type AxeViolation,
  type Capture,
  type DiscoveredPage,
  type DiscoveredSite,
  type PreparedSession,
  type RawFinding,
  type Rect,
  type SiteScreenName,
} from '../../mastra/workflows/review-website.schemas';
import {
  looksSignedIn,
  siteOrigin,
  type ReviewWebsiteRuntime,
} from '../../mastra/workflows/review-website.steps';
import { writeWorkspaceFile } from '../sessions/workspace-files';
import { launchSiteBrowser } from './site-browser';
import { SiteSignInsRepository } from './site-signins.repository';
import { pageFileName, pageUrlOf } from './site-urls';

/** What a run hands the browser work: its host, its stop and its progress. */
export interface SiteReviewRunIo {
  /** The run host's id: its workspace holds the screenshots. */
  sessionId: string;
  signal: AbortSignal;
  /** One line of progress, shown while the step runs. */
  progress(line: string): void;
}

/** The runtime functions the browser work provides (agents.md 5.19). */
export type SiteReviewWork = Pick<
  ReviewWebsiteRuntime,
  | 'checkSignIn'
  | 'openSignIn'
  | 'finishSignIn'
  | 'discoverPages'
  | 'captureAndCheck'
  | 'loadReportImages'
>;

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

/** How long a page may take to load, and to settle after it. */
const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 5_000;
/** How long a sign-in window stays open: as long as a run waits (R28). */
const SIGN_IN_WINDOW_TTL_MS = 30 * 60 * 1000;
/** Pages captured at once on one screen. */
const CAPTURE_CONCURRENCY = 2;
/** The most elements the collector hands the rules per page. */
const MAX_SNAPSHOT_ELEMENTS = 400;
/** The most nodes kept per axe violation. */
const MAX_AXE_NODES = 10;
/** The workspace folder of a run's screenshots, crops and report. */
export const SITE_REVIEW_DIR = 'site-review';

/** A sign-in window waiting for the user, by run host. */
interface SignInWindow {
  browser: Browser;
  context: BrowserContext;
  timer: ReturnType<typeof setTimeout>;
}

/** The error a stopped run's browser work ends with. */
class StoppedError extends Error {
  constructor() {
    super('The review was stopped');
  }
}

function stopIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new StoppedError();
}

/** A page's path for progress lines. */
function screenLabel(screen: SiteScreenName): string {
  return SITE_SCREENS.find((entry) => entry.name === screen)?.label ?? screen;
}

function shortPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

/** Whether the page shows a password field. */
async function hasPasswordField(page: Page): Promise<boolean> {
  return page
    .$$eval('input[type=password]', (inputs) =>
      inputs.some((input) => {
        const box = input.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      }),
    )
    .catch(() => false);
}

/** Load a page and wait for it to settle; the response's status. */
async function openPage(page: Page, url: string): Promise<number | null> {
  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  await page
    .waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS })
    .catch(() => undefined);
  return response?.status() ?? null;
}

/** A crop around a box, inside the page, at most one screen wide and 600 px tall. */
function cropOf(
  rect: Rect,
  page: { width: number; height: number },
): Rect | undefined {
  const pad = 24;
  const x = Math.max(0, Math.floor(rect.x - pad));
  const y = Math.max(0, Math.floor(rect.y - pad));
  const width = Math.min(
    page.width - x,
    Math.max(40, Math.ceil(rect.width + pad * 2)),
    page.width,
  );
  const height = Math.min(
    page.height - y,
    Math.max(40, Math.ceil(rect.height + pad * 2)),
    600,
  );
  if (width < 8 || height < 8) return undefined;
  return { x, y, width, height };
}

/**
 * The browser work of Review a Website (agents.md 5.19; ADR-0049): the
 * crawl, the capture and measures of every page on every screen, and the
 * site's sign-in, saved encrypted per origin. Each run gets its functions
 * from `forRun`; a sign-in window lives here while its run waits.
 */
@Injectable()
export class SiteReviewService implements OnApplicationShutdown {
  private readonly logger = new Logger(SiteReviewService.name);
  private readonly windows = new Map<string, SignInWindow>();

  constructor(
    private readonly signIns: SiteSignInsRepository,
    private readonly crypto: CryptoService,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      [...this.windows.keys()].map((sessionId) => this.closeWindow(sessionId)),
    );
  }

  /** The functions one run's steps call. */
  forRun(io: SiteReviewRunIo): SiteReviewWork {
    return {
      checkSignIn: ({ url, loginUrl }) => this.checkSignIn(url, loginUrl),
      openSignIn: ({ loginUrl }) => this.openSignIn(io.sessionId, loginUrl),
      finishSignIn: ({ url, loginUrl }) =>
        this.finishSignIn(io.sessionId, url, loginUrl),
      discoverPages: (input) => this.discoverPages(input, io),
      captureAndCheck: (input) => this.captureAndCheck(input, io),
      loadReportImages: (paths) => this.readImages(io.sessionId, paths),
    };
  }

  /** The origin's saved sign-in, decrypted; undefined when none can be read. */
  private async savedState(origin: string): Promise<StorageState | undefined> {
    const doc = await this.signIns.get(origin);
    if (!doc) return undefined;
    try {
      return JSON.parse(
        this.crypto.decrypt(doc.storageStateCiphertext),
      ) as StorageState;
    } catch {
      this.logger.warn(`The saved sign-in for ${origin} cannot be read`);
      return undefined;
    }
  }

  /** Whether the entry URL, opened in this context, looks signed in. */
  private async signedInWith(
    context: BrowserContext,
    url: string,
    loginUrl: string,
  ): Promise<boolean> {
    const page = await context.newPage();
    try {
      await openPage(page, url);
      return looksSignedIn({
        url,
        finalUrl: page.url(),
        origin: siteOrigin(url),
        loginUrl,
        hasPasswordField: await hasPasswordField(page),
      });
    } catch {
      return false;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async checkSignIn(
    url: string,
    loginUrl: string,
  ): Promise<{ signedIn: boolean }> {
    const state = await this.savedState(siteOrigin(url));
    if (!state) return { signedIn: false };
    const browser = await launchSiteBrowser({ headless: true });
    try {
      const context = await browser.newContext({ storageState: state });
      return { signedIn: await this.signedInWith(context, url, loginUrl) };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  private async openSignIn(sessionId: string, loginUrl: string): Promise<void> {
    await this.closeWindow(sessionId);
    const browser = await launchSiteBrowser({ headless: false });
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    const timer = setTimeout(() => {
      void this.closeWindow(sessionId);
    }, SIGN_IN_WINDOW_TTL_MS);
    timer.unref?.();
    this.windows.set(sessionId, { browser, context, timer });
    await page
      .goto(loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      })
      .catch((error: unknown) => {
        // The window stays open: the user can type the address there.
        this.logger.warn(
          `The sign-in page did not load: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  private async finishSignIn(
    sessionId: string,
    url: string,
    loginUrl: string,
  ): Promise<{ signedIn: boolean }> {
    const window = this.windows.get(sessionId);
    if (!window) {
      // The window was closed (it timed out, or the app restarted): open it again.
      await this.openSignIn(sessionId, loginUrl);
      return { signedIn: false };
    }
    const signedIn = await this.signedInWith(window.context, url, loginUrl);
    if (!signedIn) return { signedIn: false };
    const state = await window.context.storageState();
    await this.signIns.put({
      origin: siteOrigin(url),
      storageStateCiphertext: this.crypto.encrypt(JSON.stringify(state)),
      capturedAt: new Date().toISOString(),
    });
    await this.closeWindow(sessionId);
    return { signedIn: true };
  }

  private async closeWindow(sessionId: string): Promise<void> {
    const window = this.windows.get(sessionId);
    if (!window) return;
    this.windows.delete(sessionId);
    clearTimeout(window.timer);
    await window.browser.close().catch(() => undefined);
  }

  /** The context options of a crawl on one screen, signed in when asked. */
  private async contextOptions(
    session: PreparedSession,
    screen: SiteScreenName,
  ): Promise<Parameters<Browser['newContext']>[0]> {
    const spec = SITE_SCREENS.find((entry) => entry.name === screen);
    if (!spec) throw new Error(`Unknown screen "${screen}"`);
    const storageState = session.signedIn
      ? await this.savedState(session.origin)
      : undefined;
    return {
      viewport: { width: spec.width, height: spec.height },
      deviceScaleFactor: 1,
      isMobile: spec.isMobile,
      hasTouch: spec.isMobile,
      ...(storageState ? { storageState } : {}),
    };
  }

  /**
   * Discover pages (agents.md 5.19): breadth first from the entry URL, on
   * the widest chosen screen, on the site's origin only, to `maxDepth`
   * clicks and `maxPages` pages, never following a link the exclusion
   * pattern matches. A signed-in crawl that lands on the sign-in page
   * stops there (`sessionLost`).
   */
  private async discoverPages(
    session: PreparedSession,
    io: SiteReviewRunIo,
  ): Promise<
    Pick<DiscoveredSite, 'pages' | 'skippedLinks' | 'capped' | 'sessionLost'>
  > {
    const excluded = exclusionMatcher(session.exclude);
    const entry = pageUrlOf(session.url, session.origin) ?? session.url;
    const queue: { url: string; depth: number; parent: string | null }[] = [
      { url: entry, depth: 0, parent: null },
    ];
    const seen = new Set([entry]);
    const skipped = new Set<string>();
    const pages: DiscoveredPage[] = [];
    let sessionLost: string | null = null;
    const widest = session.screens[session.screens.length - 1];
    const browser = await launchSiteBrowser({ headless: true });
    try {
      const context = await browser.newContext(
        await this.contextOptions(session, widest),
      );
      const page = await context.newPage();
      while (queue.length && pages.length < session.maxPages) {
        stopIfAborted(io.signal);
        const next = queue.shift()!;
        const record: DiscoveredPage = {
          url: next.url,
          finalUrl: next.url,
          status: null,
          title: '',
          depth: next.depth,
          parent: next.parent,
          group: urlGroup(next.url),
          error: null,
        };
        try {
          record.status = await openPage(page, next.url);
          record.finalUrl = page.url();
          record.title = (await page.title().catch(() => '')).slice(0, 200);
        } catch (error) {
          record.error =
            error instanceof Error
              ? error.message.split('\n')[0]
              : String(error);
        }
        if (
          session.signedIn &&
          !record.error &&
          !looksSignedIn({
            url: next.url,
            finalUrl: record.finalUrl,
            origin: session.origin,
            loginUrl: session.loginUrl,
            hasPasswordField: await hasPasswordField(page),
          })
        ) {
          sessionLost = next.url;
          break;
        }
        pages.push(record);
        io.progress(
          `Found ${pages.length} of at most ${session.maxPages} pages · ${shortPath(next.url)}${record.error ? ' (did not load)' : ''}`,
        );
        if (record.error || next.depth >= session.maxDepth) continue;
        if (pageUrlOf(record.finalUrl, session.origin) === undefined) continue;
        const hrefs = await page
          .$$eval('a[href]', (links) =>
            links.map((link) => (link as HTMLAnchorElement).href),
          )
          .catch(() => [] as string[]);
        for (const href of hrefs) {
          const url = pageUrlOf(href, session.origin);
          if (!url || seen.has(url)) continue;
          if (excluded(url)) {
            skipped.add(url);
            continue;
          }
          seen.add(url);
          queue.push({ url, depth: next.depth + 1, parent: next.url });
        }
      }
      return {
        pages,
        skippedLinks: [...skipped],
        capped: sessionLost === null && queue.length > 0,
        sessionLost,
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /**
   * Capture and check (agents.md 5.19): every page that loaded, on every
   * chosen screen, two at a time: a full-page screenshot, a thumbnail for
   * the first page of each group, the DOM snapshot and axe, then the
   * measured rules, with a crop of each finding's element the first time
   * it is found in its group.
   */
  private async captureAndCheck(
    site: DiscoveredSite,
    io: SiteReviewRunIo,
  ): Promise<{
    captures: Capture[];
    findings: ReturnType<typeof mergeFindings>;
  }> {
    const axeSource = await readFile(
      require.resolve('axe-core/axe.min.js'),
      'utf8',
    );
    const targets = site.pages.filter((page) => !page.error);
    // Progress: every page once per screen.
    const checkTotal = targets.length * site.screens.length;
    let checkedCount = 0;
    io.progress(
      `Checking ${targets.length} page${targets.length === 1 ? '' : 's'} on ${site.screens.map(screenLabel).join(' and ')}`,
    );
    const captures: Capture[] = [];
    const raw: (RawFinding & { crop: string | null })[] = [];
    const browser = await launchSiteBrowser({ headless: true });
    try {
      for (const screen of site.screens) {
        stopIfAborted(io.signal);
        const context = await browser.newContext(
          await this.contextOptions(site, screen),
        );
        const thumbnailed = new Set<string>();
        const cropped = new Set<string>();
        let index = 0;
        const worker = async () => {
          while (index < targets.length) {
            stopIfAborted(io.signal);
            const target = targets[index++];
            const page = await context.newPage();
            // Claimed before the capture, so two workers on one group take
            // one thumbnail; given back when the capture made none.
            const thumbnail = !thumbnailed.has(target.group);
            if (thumbnail) thumbnailed.add(target.group);
            try {
              const result = await this.capturePage(page, target, screen, {
                sessionId: io.sessionId,
                axeSource,
                thumbnail,
                cropped,
              });
              if (thumbnail && !result.capture.thumbnail) {
                thumbnailed.delete(target.group);
              }
              captures.push(result.capture);
              raw.push(...result.findings);
              checkedCount += 1;
              io.progress(
                `Checked ${checkedCount} of ${checkTotal} · ${shortPath(target.url)} on ${screenLabel(screen)} · ${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}`,
              );
            } finally {
              await page.close().catch(() => undefined);
            }
          }
        };
        await Promise.all(
          Array.from(
            { length: Math.min(CAPTURE_CONCURRENCY, targets.length) },
            worker,
          ),
        );
        await context.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
    const order = new Map(site.pages.map((page, at) => [page.url, at]));
    captures.sort(
      (a, b) =>
        site.screens.indexOf(a.screen) - site.screens.indexOf(b.screen) ||
        (order.get(a.url) ?? 0) - (order.get(b.url) ?? 0),
    );
    raw.sort((a, b) => (order.get(a.url) ?? 0) - (order.get(b.url) ?? 0));
    return { captures, findings: mergeFindings(raw) };
  }

  /** One page on one screen: its images, its measures and its findings. */
  private async capturePage(
    page: Page,
    target: DiscoveredPage,
    screen: SiteScreenName,
    options: {
      sessionId: string;
      axeSource: string;
      thumbnail: boolean;
      cropped: Set<string>;
    },
  ): Promise<{
    capture: Capture;
    findings: (RawFinding & { crop: string | null })[];
  }> {
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const base = `${SITE_REVIEW_DIR}/${screen}/${pageFileName(target.url)}`;
    const capture: Capture = {
      url: target.url,
      screen,
      group: target.group,
      screenshot: null,
      thumbnail: null,
      status: null,
      error: null,
    };
    let status: number | null;
    try {
      status = await openPage(page, target.url);
    } catch (error) {
      capture.error =
        error instanceof Error ? error.message.split('\n')[0] : String(error);
      return { capture, findings: [] };
    }
    capture.status = status;
    const findings: RawFinding[] = loadFindings({
      url: target.url,
      screen,
      status,
      consoleErrors: consoleErrors.slice(0, 20),
    });
    try {
      const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
      const snapshot = domSnapshotSchema.parse(
        await page.evaluate(collectDomSnapshot, {
          screen,
          viewport,
          maxElements: MAX_SNAPSHOT_ELEMENTS,
        }),
      );
      findings.push(...snapshotFindings({ ...snapshot, url: target.url }));
      findings.push(
        ...axeFindings(
          await this.runAxe(page, options.axeSource),
          screen,
          target.url,
        ),
      );
      await writeWorkspaceFile(
        options.sessionId,
        `${base}.jpg`,
        await page.screenshot({ fullPage: true, type: 'jpeg', quality: 70 }),
      );
      capture.screenshot = `${base}.jpg`;
      if (options.thumbnail) {
        await writeWorkspaceFile(
          options.sessionId,
          `${base}.thumb.jpg`,
          await page.screenshot({ type: 'jpeg', quality: 50 }),
        );
        capture.thumbnail = `${base}.thumb.jpg`;
      }
      const size = {
        width: Math.max(snapshot.scrollWidth, viewport.width),
        height: snapshot.scrollHeight,
      };
      const withCrops: (RawFinding & { crop: string | null })[] = [];
      for (const finding of findings) {
        // One crop per rule, group and element on a screen: the merge keeps it.
        const key = `${finding.rule}|${urlGroup(finding.url)}|${finding.selector ?? ''}`;
        let crop: string | null = null;
        const clip =
          finding.rect && !options.cropped.has(key)
            ? cropOf(finding.rect, size)
            : undefined;
        if (clip) {
          options.cropped.add(key);
          const path = `${base}.${withCrops.length}.crop.jpg`;
          try {
            await writeWorkspaceFile(
              options.sessionId,
              path,
              await page.screenshot({
                fullPage: true,
                clip,
                type: 'jpeg',
                quality: 60,
              }),
            );
            crop = path;
          } catch {
            // The finding stays, without its crop.
          }
        }
        withCrops.push({ ...finding, crop });
      }
      return { capture, findings: withCrops };
    } catch (error) {
      capture.error =
        error instanceof Error ? error.message.split('\n')[0] : String(error);
      return {
        capture,
        findings: findings.map((finding) => ({ ...finding, crop: null })),
      };
    }
  }

  /** axe's violations on the page, with each node's box in document coordinates. */
  private async runAxe(page: Page, source: string): Promise<AxeViolation[]> {
    await page.addScriptTag({ content: source });
    const violations = await page.evaluate(async (maxNodes: number) => {
      type AxeNode = { target: unknown[]; failureSummary?: string };
      type AxeResult = {
        id: string;
        impact?: string | null;
        help: string;
        helpUrl: string;
        nodes: AxeNode[];
      };
      const axe = (
        window as unknown as {
          axe: {
            run(
              context: Document,
              options: object,
            ): Promise<{ violations: AxeResult[] }>;
          };
        }
      ).axe;
      // WCAG 2.x A and AA only: axe's best-practice rules (landmarks,
      // regions) flag nearly every page and drown the defects. Its
      // `target-size` is our own `tap-target` rule, which exempts inline
      // links as WCAG 2.5.8 does.
      const result = await axe.run(document, {
        resultTypes: ['violations'],
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        },
        rules: { 'target-size': { enabled: false } },
      });
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? null,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.slice(0, maxNodes).map((node) => {
          const selector = node.target.map(String).join(' ');
          let rect: {
            x: number;
            y: number;
            width: number;
            height: number;
          } | null = null;
          try {
            const element = document.querySelector(String(node.target[0]));
            if (element) {
              const box = element.getBoundingClientRect();
              rect = {
                x: box.x + window.scrollX,
                y: box.y + window.scrollY,
                width: box.width,
                height: box.height,
              };
            }
          } catch {
            // A selector axe wrote for a shadow root or an iframe.
          }
          return { selector, summary: node.failureSummary ?? '', rect };
        }),
      }));
    }, MAX_AXE_NODES);
    return violations.flatMap((violation) => {
      const parsed = axeViolationSchema.safeParse(violation);
      return parsed.success ? [parsed.data] : [];
    });
  }

  /** The run's images, as `data:` URIs, by workspace path. */
  private async readImages(
    sessionId: string,
    paths: readonly string[],
  ): Promise<Record<string, string>> {
    const root = sessionWorkspacePath(sessionId);
    const images: Record<string, string> = {};
    for (const path of paths) {
      if (!path.startsWith(`${SITE_REVIEW_DIR}/`) || path.includes('..')) {
        continue;
      }
      try {
        const data = await readFile(join(root, path));
        images[path] = `data:image/jpeg;base64,${data.toString('base64')}`;
      } catch {
        // A missing image is drawn as a placeholder.
      }
    }
    return images;
  }
}
