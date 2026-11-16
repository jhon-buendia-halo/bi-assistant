import {
  irisReviewSchema,
  type IrisFinding,
  type IrisReview,
  type Rect,
  type ReviewMark,
  type VisualCategory,
} from '../workflows/review-website.schemas';
import type { EvalCustomCheck } from './assistant.evals';

/**
 * Custom checks of the `site-reviewer` set (agents.md 8.1, 2.16): what is
 * deterministic about Iris's review of one page template. The scored answer
 * is her `IrisReview` as JSON text plus, per screen, the marks the page got
 * and the mark of each planted element (`screens`), so each check knows
 * which marks are the right ones.
 */

/** One screen of a run: its marks and where the planted elements are. */
export interface ReviewedScreen {
  screen: string;
  /** The numbers of the marks drawn on the screen. */
  marks: number[];
  /** Planted element key to its mark number; null when it got no mark. */
  planted: Record<string, number | null>;
}

export interface SiteReviewerAnswer extends IrisReview {
  screens: ReviewedScreen[];
}

/** The most findings a review may hold (agents.md 5.19). */
export const MAX_FINDINGS = 8;

/** The answer read as a review with its screens, or the reason it is not one. */
export function answerOf(answer: string): SiteReviewerAnswer | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return 'The answer is not a JSON review';
  }
  const review = irisReviewSchema.safeParse(parsed);
  if (!review.success) {
    return `The answer is not an Iris review: ${review.error.issues[0]?.message ?? 'invalid'}`;
  }
  const screens = (parsed as { screens?: unknown }).screens;
  if (!Array.isArray(screens) || screens.length === 0) {
    return 'The answer carries no screens (the eval target adds them)';
  }
  return { ...review.data, screens: screens as ReviewedScreen[] };
}

function screenOf(
  answer: SiteReviewerAnswer,
  name: string,
): ReviewedScreen | undefined {
  return answer.screens.find((screen) => screen.screen === name);
}

/**
 * The mark of a planted element: the mark with its selector, else the
 * smallest mark whose box holds the element's box (a mark on the element's
 * own container still stands for it).
 */
export function markOfElement(
  element: { selector: string; rect: Rect },
  marks: readonly ReviewMark[],
): number | null {
  const same = marks.find((mark) => mark.selector === element.selector);
  if (same) return same.n;
  const slack = 2;
  const holds = marks.filter(
    (mark) =>
      mark.rect.x <= element.rect.x + slack &&
      mark.rect.y <= element.rect.y + slack &&
      mark.rect.x + mark.rect.width + slack >=
        element.rect.x + element.rect.width &&
      mark.rect.y + mark.rect.height + slack >=
        element.rect.y + element.rect.height,
  );
  holds.sort(
    (a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height,
  );
  return holds[0]?.n ?? null;
}

/** The reply was an Iris review with the screens the target adds. */
export function parsesAsReview(): EvalCustomCheck {
  return {
    id: 'parses-as-review',
    description: 'The reply is an Iris review (findings and summary)',
    run: ({ answer }) => {
      const read = answerOf(answer);
      return typeof read === 'string' ? read : undefined;
    },
  };
}

/** No more findings than the contract allows. */
export function atMostEightFindings(): EvalCustomCheck {
  return {
    id: 'at-most-8-findings',
    description: `The review holds at most ${MAX_FINDINGS} findings`,
    run: ({ answer }) => {
      const read = answerOf(answer);
      if (typeof read === 'string') return read;
      return read.findings.length > MAX_FINDINGS
        ? `The review holds ${read.findings.length} findings (at most ${MAX_FINDINGS})`
        : undefined;
    },
  };
}

/** Every mark a finding names exists on that finding's screen. */
export function marksExist(): EvalCustomCheck {
  return {
    id: 'marks-exist',
    description: "Every finding's mark is one of the marks of its screen",
    run: ({ answer }) => {
      const read = answerOf(answer);
      if (typeof read === 'string') return read;
      for (const finding of read.findings) {
        if (finding.mark === null) continue;
        const screen = screenOf(read, finding.screen);
        if (!screen) {
          return `A finding names the screen "${finding.screen}", which was not reviewed`;
        }
        if (!screen.marks.includes(finding.mark)) {
          return `Finding "${finding.title}" names mark ${finding.mark}, which the ${finding.screen} screen does not have`;
        }
      }
      return undefined;
    },
  };
}

/**
 * A finding of one of `categories` points at the mark of one of the planted
 * elements `keys`, on at least one screen.
 */
export function flagsPlantedElement(
  categories: readonly VisualCategory[],
  keys: readonly string[],
): EvalCustomCheck {
  return {
    id: 'flags-planted-element',
    description: `A ${categories.join(' or ')} finding points at the mark of ${keys.join(', ')}`,
    run: ({ answer }) => {
      const read = answerOf(answer);
      if (typeof read === 'string') return read;
      const hit = read.findings.some((finding) => {
        if (finding.mark === null) return false;
        if (!categories.includes(finding.category)) return false;
        const planted = screenOf(read, finding.screen)?.planted ?? {};
        return keys.some((key) => planted[key] === finding.mark);
      });
      if (hit) return undefined;
      const marks = read.screens
        .map(
          (screen) =>
            `${screen.screen}: ${keys
              .map((key) => `${key}=#${screen.planted[key] ?? 'none'}`)
              .join(', ')}`,
        )
        .join('; ');
      return `No ${categories.join(' or ')} finding points at ${keys.join(', ')} (marks ${marks})`;
    },
  };
}

/** No critical or major finding, and at most `maxMinor` minor ones per screen. */
export function onlyMinorFindings(maxMinor: number): EvalCustomCheck {
  return {
    id: 'only-minor-findings',
    description: `No critical or major finding, at most ${maxMinor} minor per screen`,
    run: ({ answer }) => {
      const read = answerOf(answer);
      if (typeof read === 'string') return read;
      const heavy = read.findings.find(
        (finding) => finding.severity !== 'minor',
      );
      if (heavy) {
        return `A ${heavy.severity} finding on a clean page: "${heavy.title}" (${heavy.screen})`;
      }
      for (const screen of read.screens) {
        const count = read.findings.filter(
          (finding) => finding.screen === screen.screen,
        ).length;
        if (count > maxMinor) {
          return `${count} minor findings on the ${screen.screen} screen of a clean page (at most ${maxMinor})`;
        }
      }
      return undefined;
    },
  };
}

/** Words that say a picture failed to load, and words that name a picture. */
const FAILURE =
  /\b(broken|fail\w*|not\s+(?:load|display|show|render)\w*|missing|doesn'?t\s+load|won'?t\s+load|no\s+image|blank)\b/i;
const PICTURE = /\b(image|img|picture|photo|photograph)\b/i;

function aboutFailedImage(finding: IrisFinding): boolean {
  const text = `${finding.title} ${finding.observed}`;
  return PICTURE.test(text) && FAILURE.test(text);
}

/** No finding repeats the measured "image does not load". */
export function doesNotRepeatMeasured(): EvalCustomCheck {
  return {
    id: 'does-not-repeat-measured',
    description:
      'No finding is about the image failing to load (it was measured already)',
    run: ({ answer }) => {
      const read = answerOf(answer);
      if (typeof read === 'string') return read;
      const repeat = read.findings.find(aboutFailedImage);
      return repeat
        ? `The finding "${repeat.title}" repeats the measured "Image does not load"`
        : undefined;
    },
  };
}
