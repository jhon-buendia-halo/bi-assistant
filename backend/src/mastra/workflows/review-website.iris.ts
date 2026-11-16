/**
 * Iris's vision review of Review a Website (agents.md 5.19), in pure code:
 * the lenient reader of her reply and the conversion of her findings into
 * the report's findings. No framework import, so Jest loads it without
 * Mastra.
 */
import {
  FINDING_SEVERITIES,
  VISUAL_CATEGORIES,
  type Finding,
  type FindingSeverity,
  type IrisFinding,
  type IrisReview,
  type PageTemplate,
  type ReviewShot,
  type SiteScreenName,
  type VisualCategory,
} from './review-website.schemas';

/** The most findings kept from one template's review. */
export const IRIS_MAX_FINDINGS = 8;

/** The longest text kept for a title, an observation or a suggestion. */
const IRIS_TEXT_MAX_CHARS = 300;

/** What the reader checks a reply against: the screens shown and their marks. */
export interface IrisValid {
  screens: readonly SiteScreenName[];
  marks: ReadonlyMap<SiteScreenName, ReadonlySet<number>>;
}

function textOf(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().slice(0, IRIS_TEXT_MAX_CHARS)
    : '';
}

/** The first JSON object in a reply, fences and prose around it allowed. */
function firstObject(reply: unknown): Record<string, unknown> | undefined {
  let value: unknown = reply;
  if (typeof reply === 'string') {
    const start = reply.indexOf('{');
    const end = reply.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      value = JSON.parse(reply.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function findingOf(entry: unknown, valid: IrisValid): IrisFinding | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const raw = entry as Record<string, unknown>;
  const screen = raw['screen'] as SiteScreenName;
  if (typeof screen !== 'string' || !valid.screens.includes(screen)) {
    return undefined;
  }
  const title = textOf(raw['title']);
  if (!title) return undefined;
  const mark = raw['mark'];
  const known =
    typeof mark === 'number' && valid.marks.get(screen)?.has(mark) === true;
  const category = VISUAL_CATEGORIES.includes(raw['category'] as VisualCategory)
    ? (raw['category'] as VisualCategory)
    : 'other';
  const severity = FINDING_SEVERITIES.includes(
    raw['severity'] as FindingSeverity,
  )
    ? (raw['severity'] as FindingSeverity)
    : 'minor';
  return {
    mark: known ? mark : null,
    screen,
    severity,
    category,
    title,
    observed: textOf(raw['observed']),
    suggestion: textOf(raw['suggestion']),
  };
}

/**
 * Iris's review from her reply, read leniently (agents.md 5.19). A finding
 * on a screen that was not shown, or with no title, is dropped; a mark the
 * screen does not have becomes `null` (the page as a whole); an unknown
 * category is `other` and an unknown severity `minor`. At most eight
 * findings are kept, in order. A reply that is no JSON object reviews
 * nothing. It never fails.
 */
export function irisReviewOf(reply: unknown, valid: IrisValid): IrisReview {
  const object = firstObject(reply);
  const entries = Array.isArray(object?.['findings']) ? object['findings'] : [];
  const findings: IrisFinding[] = [];
  for (const entry of entries) {
    const finding = findingOf(entry, valid);
    if (finding) findings.push(finding);
    if (findings.length >= IRIS_MAX_FINDINGS) break;
  }
  return { findings, summary: textOf(object?.['summary']) };
}

/** An 8 hex digit FNV-1a hash. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * The report's findings from Iris's review of one template: rule
 * `visual:<category>`, source `iris`, the template as the group and the
 * representative page as the only page. A finding about a mark takes that
 * mark's selector, box and crop from the screen's shot; one about the page
 * as a whole has none. The id is stable across runs for the same finding.
 */
export function irisFindings(
  review: IrisReview,
  ctx: {
    template: PageTemplate;
    url: string;
    shots: readonly ReviewShot[];
  },
): Finding[] {
  return review.findings.map((finding) => {
    const shot = ctx.shots.find((s) => s.screen === finding.screen);
    const mark =
      finding.mark === null
        ? undefined
        : shot?.marks.find((m) => m.n === finding.mark);
    return {
      id: `f-${fnv1a(
        `visual|${finding.category}|${finding.screen}|${ctx.template.id}|${finding.mark ?? ''}|${finding.title}`,
      )}`,
      rule: `visual:${finding.category}`,
      severity: finding.severity,
      title: finding.title,
      screen: finding.screen,
      group: ctx.template.id,
      pages: [ctx.url],
      selector: mark?.selector ?? null,
      rect: mark?.rect ?? null,
      crop: mark?.crop ?? null,
      // Iris saw the top of the page: frame her element (or the page) there.
      context: shot ? { image: shot.clean, clip: shot.clip } : null,
      measured: finding.observed,
      expected: finding.suggestion,
      helpUrl: null,
      source: 'iris',
    };
  });
}
