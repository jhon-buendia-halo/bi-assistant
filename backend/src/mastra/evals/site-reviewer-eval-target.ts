import type { Agent } from '@mastra/core/agent';
import type { Browser, Page } from 'playwright-core';
import { launchSiteBrowser } from '../../modules/site-review/site-browser';
import type * as ReviewAgents from '../workflows/review-website.agents';
import {
  clearReviewMarks,
  drawReviewMarks,
} from '../workflows/review-website.collect';
import {
  SITE_SCREENS,
  type Finding,
  type IrisReview,
  type PageTemplate,
  type Rect,
  type ReviewMark,
  type SiteScreenName,
} from '../workflows/review-website.schemas';
import { answerResult } from './query-explainer-eval-answer';
import { lastUserText } from './insights-analyst-target';
import {
  markOfElement,
  type ReviewedScreen,
} from './site-reviewer-eval-checks';

/**
 * The `site-reviewer` eval target's turn (agents.md 8.1, 2.16): a case is one
 * small page, and a run of it does what Review templates does for one page
 * template: render the page on each screen, take the top of it clean and with
 * the numbered marks, and ask Iris once (`reviewTemplateWithModel`). The
 * scored answer is her review as JSON text with, per screen, the marks and
 * the mark of each planted element, so the checks and the judge read one
 * thing. The browser logic follows `SiteReviewService.captureReviewShot`.
 */

/** The screens every case is reviewed on. */
export const SITE_REVIEWER_EVAL_SCREENS: readonly SiteScreenName[] = [
  'mobile',
  'laptop',
];

/** The most marks drawn on a shot (the app's own cap). */
const MAX_MARKS = 30;

/** A case's page, as the target needs it. */
export interface SiteReviewerPlan {
  html: string;
  /** Planted element key to the CSS selector that finds it. */
  planted: Record<string, string>;
  /** A measured finding the page already has, as Iris is told it. */
  measured?: { rule: string; title: string; selector: string };
}

/** One screen as Iris is shown it, with where the planted elements are. */
export interface CapturedScreen {
  screen: SiteScreenName;
  label: string;
  width: number;
  clean: { data: Buffer; mediaType: string };
  marked: { data: Buffer; mediaType: string };
  marks: ReviewMark[];
  planted: Record<string, number | null>;
}

/** The page rendered and shot on each screen. */
export type CaptureScreens = (
  plan: SiteReviewerPlan,
  screens: readonly SiteScreenName[],
) => Promise<CapturedScreen[]>;

/** The model call: `reviewTemplateWithModel`, or a stand-in. */
export type ReviewTemplate = typeof ReviewAgents.reviewTemplateWithModel;

/** The template every case is reviewed as. */
export const EVAL_TEMPLATE: PageTemplate = {
  id: '/case',
  pages: ['https://example.test/case'],
  representative: 'https://example.test/case',
};

/** What the browser cannot do, said once and clearly. */
export function noBrowserMessage(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `The site-reviewer evals need a browser and could not launch one (${reason}). Install Microsoft Edge or Google Chrome, or set SITE_REVIEW_BROWSER_PATH to an executable.`;
}

/** The top of the page, as `captureReviewShot` clips it. */
async function shoot(
  page: Page,
  plan: SiteReviewerPlan,
  screen: (typeof SITE_SCREENS)[number],
): Promise<CapturedScreen> {
  const pageHeight = await page.evaluate(() =>
    Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
    ),
  );
  const clip = {
    x: 0,
    y: 0,
    width: screen.width,
    height: Math.max(1, Math.min(pageHeight, screen.height * 2)),
  };
  const jpeg = async (): Promise<{ data: Buffer; mediaType: string }> => ({
    data: await page.screenshot({
      fullPage: true,
      clip,
      type: 'jpeg',
      quality: 70,
    }),
    mediaType: 'image/jpeg',
  });
  await page.evaluate(clearReviewMarks);
  const clean = await jpeg();
  const rects: Record<string, Rect | null> = {};
  for (const [key, selector] of Object.entries(plan.planted)) {
    rects[key] = await page.evaluate((css: string) => {
      const el = document.querySelector(css);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return {
        x: box.x + window.scrollX,
        y: box.y + window.scrollY,
        width: box.width,
        height: box.height,
      };
    }, selector);
  }
  const drafts = await page.evaluate(drawReviewMarks, {
    maxMarks: MAX_MARKS,
    maxHeight: clip.height,
  });
  let marked: { data: Buffer; mediaType: string };
  try {
    marked = await jpeg();
  } finally {
    await page.evaluate(clearReviewMarks);
  }
  const marks: ReviewMark[] = drafts.map((draft) => ({ ...draft, crop: null }));
  const planted: Record<string, number | null> = {};
  for (const [key, selector] of Object.entries(plan.planted)) {
    const rect = rects[key];
    planted[key] = rect ? markOfElement({ selector, rect }, marks) : null;
  }
  return {
    screen: screen.name,
    label: screen.label,
    width: screen.width,
    clean,
    marked,
    marks,
    planted,
  };
}

/** The real capture: the case page rendered in the machine's browser. */
export const captureInBrowser: CaptureScreens = async (plan, names) => {
  let browser: Browser;
  try {
    browser = await launchSiteBrowser({ headless: true });
  } catch (error) {
    throw new Error(noBrowserMessage(error));
  }
  try {
    const captured: CapturedScreen[] = [];
    for (const name of names) {
      const screen = SITE_SCREENS.find((candidate) => candidate.name === name);
      if (!screen) throw new Error(`Unknown screen "${name}"`);
      const context = await browser.newContext({
        viewport: { width: screen.width, height: screen.height },
        isMobile: screen.isMobile,
      });
      try {
        const page = await context.newPage();
        await page.setContent(plan.html, { waitUntil: 'load' });
        captured.push(await shoot(page, plan, screen));
      } finally {
        await context.close().catch(() => undefined);
      }
    }
    return captured;
  } finally {
    await browser.close().catch(() => undefined);
  }
};

/** The finding a case passes as already measured, on one screen. */
function measuredFinding(
  measured: NonNullable<SiteReviewerPlan['measured']>,
  screen: SiteScreenName,
): Finding {
  return {
    id: `${measured.rule}:${screen}:${EVAL_TEMPLATE.id}:${measured.selector}`,
    rule: measured.rule,
    severity: 'major',
    title: measured.title,
    screen,
    selector: measured.selector,
    measured: 'The image finished loading with no pixels',
    expected: 'Every image loads',
    rect: null,
    helpUrl: null,
    group: EVAL_TEMPLATE.id,
    pages: EVAL_TEMPLATE.pages,
    crop: null,
    source: 'measured',
    context: null,
  };
}

/**
 * One page reviewed as the app does: shot on each screen, then Iris's one
 * call. The answer is her review plus the screens' marks and planted marks.
 */
export async function reviewForEval(input: {
  plan: SiteReviewerPlan;
  capture: CaptureScreens;
  review: ReviewTemplate;
}): Promise<IrisReview & { screens: ReviewedScreen[] }> {
  const { plan } = input;
  const captured = await input.capture(plan, SITE_REVIEWER_EVAL_SCREENS);
  const measured = plan.measured
    ? captured.map((shot) => measuredFinding(plan.measured!, shot.screen))
    : [];
  const { review } = await input.review(
    {
      url: EVAL_TEMPLATE.representative,
      template: EVAL_TEMPLATE,
      shots: captured.map((shot) => ({
        screen: shot.screen,
        label: shot.label,
        width: shot.width,
        clean: shot.clean,
        marked: shot.marked,
        marks: shot.marks,
      })),
      measured,
    },
    {},
  );
  return {
    ...review,
    screens: captured.map((shot) => ({
      screen: shot.screen,
      marks: shot.marks.map((mark) => mark.n),
      planted: shot.planted,
    })),
  };
}

/**
 * Iris's agent, its `generate` replaced by one reviewed page (above). The
 * question the case sends names the case; `planOf` finds its page. Every
 * other member is the agent's own.
 */
export function reviewerTurnAgent(
  agent: Agent,
  planOf: (question: string) => SiteReviewerPlan | undefined,
  capture: CaptureScreens,
  review: ReviewTemplate,
): Agent {
  const generate = async (input: unknown) => {
    const question = lastUserText(input).trim();
    const plan = planOf(question);
    if (!plan) throw new Error(`No page for the question "${question}"`);
    const answer = await reviewForEval({ plan, capture, review });
    return answerResult(input, JSON.stringify(answer));
  };
  return new Proxy(agent, {
    get(target, property): unknown {
      if (property === 'generate') return generate;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
