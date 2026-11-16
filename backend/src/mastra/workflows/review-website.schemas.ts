/**
 * The data contract of the Review a Website workflow (agents.md 5.19): the
 * Zod schema of the workflow's input and of every step's input and output,
 * and the shapes its pure code shares (the DOM snapshot a page yields, a
 * finding, the report). The Mastra workflow (./review-website.workflow.ts)
 * builds its steps from it and the step catalogue
 * (./review-website.steps.ts) derives each step's fields from it. Zod only,
 * no framework import, so Jest and the catalogue load it without Mastra.
 *
 * The flow: Prepare session → Discover pages → Capture and check → Save
 * report. Phase 1 makes no model call: every finding is measured in the
 * browser (docs/plans/m1-27-site-review.md).
 */
import { z } from 'zod';

/** The screens a run can review, narrowest first. */
export const SITE_SCREENS = [
  { name: 'mobile', label: 'Mobile', width: 390, height: 844, isMobile: true },
  { name: 'tablet', label: 'Tablet', width: 768, height: 1024, isMobile: true },
  {
    name: 'laptop',
    label: 'Laptop',
    width: 1440,
    height: 900,
    isMobile: false,
  },
  {
    name: 'desktop',
    label: 'Desktop',
    width: 1920,
    height: 1080,
    isMobile: false,
  },
] as const;

export type SiteScreenName = (typeof SITE_SCREENS)[number]['name'];
export const SITE_SCREEN_NAMES = SITE_SCREENS.map((screen) => screen.name) as [
  SiteScreenName,
  ...SiteScreenName[],
];

/** How bad a finding is. */
export const FINDING_SEVERITIES = ['critical', 'major', 'minor'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/**
 * The measured rules of phase 1 (plan section 4). An axe violation's rule
 * is `axe:<axe rule id>`, so it is a string, not one of these.
 */
export const MEASURED_RULES = [
  'overflow-x',
  'clipped-text',
  'covered-element',
  'tap-target',
  'broken-image',
  'http-error',
  'console-error',
  'placeholder-text',
] as const;
export type MeasuredRule = (typeof MEASURED_RULES)[number];

const screenNameSchema = z.enum(SITE_SCREEN_NAMES);

/** A box in the page's coordinates (CSS pixels from the document's top left). */
export const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Rect = z.output<typeof rectSchema>;

// ---------------------------------------------------------------------------
// The DOM snapshot: what one page on one screen yields to the rules. It is
// collected in the page by ./review-website.collect.ts and read by the pure
// rules of ./review-website.checks.ts. Raw facts only: no severity here.
// ---------------------------------------------------------------------------

/** One element the rules may look at. */
export const snapElementSchema = z.object({
  /** A CSS selector that finds the element again (id, else a short path). */
  selector: z.string(),
  tag: z.string(),
  /** Its visible text, trimmed, at most 120 characters. */
  text: z.string(),
  /** Its box in document coordinates. */
  rect: rectSchema,
  /** A link, button, field or an element with an interactive role. */
  interactive: z.boolean(),
  /** A submit button (`button[type=submit]`, `input[type=submit]`). */
  submit: z.boolean(),
  /** Text cut by its box: `scrollWidth > clientWidth + 1` with overflow hidden or an ellipsis. */
  clipsText: z.boolean(),
  /** How much of it (0 to 1) another, fixed or sticky, element covers at load. */
  coveredFraction: z.number(),
  /** The selector of the fixed or sticky element that covers it, else null. */
  coveredBy: z.string().nullable(),
  /** An image that finished loading with no pixels, with its `src`. */
  brokenImage: z.string().nullable(),
});
export type SnapElement = z.output<typeof snapElementSchema>;

/** One page on one screen, as the rules see it. */
export const domSnapshotSchema = z.object({
  url: z.string(),
  screen: screenNameSchema,
  viewport: z.object({ width: z.number(), height: z.number() }),
  /** The document's scroll width: wider than the viewport means sideways scroll. */
  scrollWidth: z.number(),
  scrollHeight: z.number(),
  /** The widest element that sticks out of the viewport, else null. */
  widest: z
    .object({ selector: z.string(), right: z.number(), rect: rectSchema })
    .nullable(),
  /** Only the elements a rule reads (interactive, clipping, covered, images). */
  elements: z.array(snapElementSchema),
  /** The page's visible text, at most 20 000 characters. */
  visibleText: z.string(),
});
export type DomSnapshot = z.output<typeof domSnapshotSchema>;

/** One axe violation, reduced to what a finding needs. */
export const axeViolationSchema = z.object({
  id: z.string(),
  impact: z.enum(['critical', 'serious', 'moderate', 'minor']).nullable(),
  help: z.string(),
  helpUrl: z.string(),
  nodes: z.array(
    z.object({
      selector: z.string(),
      /** axe's own summary of what failed, e.g. the measured contrast ratio. */
      summary: z.string(),
      rect: rectSchema.nullable(),
    }),
  ),
});
export type AxeViolation = z.output<typeof axeViolationSchema>;

/** What loading the page told us besides its DOM. */
export const pageLoadSchema = z.object({
  url: z.string(),
  screen: screenNameSchema,
  status: z.number().nullable(),
  /** Uncaught errors and `console.error` messages, at most 20. */
  consoleErrors: z.array(z.string()),
});
export type PageLoad = z.output<typeof pageLoadSchema>;

/**
 * A finding as one rule reports it on one page and screen, before the same
 * rule and element on other pages of its group are merged into one.
 */
export const rawFindingSchema = z.object({
  rule: z.string(),
  severity: z.enum(FINDING_SEVERITIES),
  /** One line, in plain words: `Page scrolls sideways`. */
  title: z.string(),
  screen: screenNameSchema,
  url: z.string(),
  /** The element, else null for a page-wide finding. */
  selector: z.string().nullable(),
  /** What was measured: `Content is 512 px wide in a 390 px screen`. */
  measured: z.string(),
  /** The rule it breaks: `No sideways scrolling (WCAG 1.4.10)`. */
  expected: z.string(),
  /** Where to crop the screenshot, in document coordinates, else null. */
  rect: rectSchema.nullable(),
  /** A link to the rule's documentation, else null. */
  helpUrl: z.string().nullable(),
});
export type RawFinding = z.output<typeof rawFindingSchema>;

/** A finding as the report shows it: one rule and element across the pages of a group. */
export const findingSchema = rawFindingSchema.omit({ url: true }).extend({
  /** A stable id: rule, screen, group and selector. */
  id: z.string(),
  /** The URL pattern of the pages it was found on (`/claims/:id`). */
  group: z.string(),
  /** Every page it was found on, first the one its crop comes from. */
  pages: z.array(z.string()),
  /** The crop's path in the run's workspace, else null. */
  crop: z.string().nullable(),
});
export type Finding = z.output<typeof findingSchema>;

// ---------------------------------------------------------------------------
// The workflow's input and the steps' contracts.
// ---------------------------------------------------------------------------

/** The workflow's input: what the run's form gives, field by field. */
export const reviewWebsiteInputSchema = z.object({
  url: z.string().describe('The entry URL: where the crawl starts.'),
  maxPages: z.number().describe('The most pages to review.'),
  maxDepth: z.number().describe('How many clicks away from the entry URL.'),
  mobile: z.boolean().describe('Review each page at 390 px.'),
  tablet: z.boolean().describe('Review each page at 768 px.'),
  laptop: z.boolean().describe('Review each page at 1440 px.'),
  desktop: z.boolean().describe('Review each page at 1920 px.'),
  exclude: z
    .string()
    .describe('A pattern of links never to follow (sign-out, delete).'),
  needsSignIn: z.boolean().describe('Whether the site needs a sign-in.'),
  loginUrl: z
    .string()
    .describe('Where the sign-in starts, else the entry URL.'),
});
export type ReviewWebsiteInput = z.output<typeof reviewWebsiteInputSchema>;

/**
 * What Prepare session found: the input made usable (the screens as a list,
 * the defaults filled in), with the site's origin and whether a sign-in is
 * used.
 */
export const preparedSessionSchema = z.object({
  url: z.string().describe('The entry URL: where the crawl starts.'),
  maxPages: z.number().describe('The most pages to review.'),
  maxDepth: z.number().describe('How many clicks away from the entry URL.'),
  screens: z
    .array(screenNameSchema)
    .describe('The screens each page is reviewed on, narrowest first.'),
  exclude: z
    .string()
    .describe('A pattern of links never to follow (sign-out, delete).'),
  needsSignIn: z.boolean().describe('Whether the site needs a sign-in.'),
  loginUrl: z
    .string()
    .describe('Where the sign-in starts, else the entry URL.'),
  origin: z.string().describe("The site's origin: scheme, host and port."),
  signedIn: z
    .boolean()
    .describe('Whether the crawl runs with a saved sign-in.'),
});
export type PreparedSession = z.output<typeof preparedSessionSchema>;

/** What a waiting Prepare session asks (the run's waiting card). */
export const signInQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
});

/** The user's answer to the sign-in question. */
export const signInAnswerSchema = z.object({ answer: z.string() });

/** One page the crawl reached. */
export const discoveredPageSchema = z.object({
  url: z.string(),
  /** Where it ended after redirects. */
  finalUrl: z.string(),
  status: z.number().nullable(),
  title: z.string(),
  depth: z.number(),
  /** The page it was first linked from, else null for the entry page. */
  parent: z.string().nullable(),
  /** Its URL pattern (`/claims/:id`): pages with one pattern are one group. */
  group: z.string(),
  /** Why it could not be loaded, else null. */
  error: z.string().nullable(),
});
export type DiscoveredPage = z.output<typeof discoveredPageSchema>;

/** What Discover pages found. */
export const discoveredSiteSchema = preparedSessionSchema.extend({
  pages: z
    .array(discoveredPageSchema)
    .describe('Every page reached, in crawl order.'),
  skippedLinks: z
    .array(z.string())
    .describe('Same-site links the exclusion pattern kept the crawl from.'),
  capped: z.boolean().describe('Whether the crawl stopped at the page limit.'),
  sessionLost: z
    .string()
    .nullable()
    .describe('The page that landed on the sign-in page, else null.'),
});
export type DiscoveredSite = z.output<typeof discoveredSiteSchema>;

/** One page on one screen, as Capture and check took it. */
export const captureSchema = z.object({
  url: z.string(),
  screen: screenNameSchema,
  group: z.string(),
  /** The full-page screenshot's path in the run's workspace, else null. */
  screenshot: z.string().nullable(),
  /** A viewport-sized JPEG thumbnail's path in the run's workspace, else null. */
  thumbnail: z.string().nullable(),
  status: z.number().nullable(),
  /** Why the capture failed, else null. */
  error: z.string().nullable(),
});
export type Capture = z.output<typeof captureSchema>;

/** What Capture and check measured. */
export const checkedSiteSchema = discoveredSiteSchema.extend({
  captures: z.array(captureSchema),
  findings: z.array(findingSchema),
});
export type CheckedSite = z.output<typeof checkedSiteSchema>;

/** Counts by severity. */
export const severityCountsSchema = z.object({
  critical: z.number(),
  major: z.number(),
  minor: z.number(),
});
export type SeverityCounts = z.output<typeof severityCountsSchema>;

/** The run's result: the saved report. */
export const savedReportSchema = z.object({
  visualId: z.string().describe("The report's id: a visual of the run."),
  reportFile: z
    .string()
    .describe("The findings JSON's path in the run's workspace."),
  origin: z.string(),
  pageCount: z.number(),
  groupCount: z.number(),
  findingCount: z.number(),
  counts: severityCountsSchema,
  answer: z.string().describe("The run's answer."),
});
export type SavedReport = z.output<typeof savedReportSchema>;

/**
 * The run's result (the workflow's output): Save report's output, or, for a
 * run that stopped early (the sign-in was lost, or the run was stopped), the
 * output of the step that stopped it.
 */
export const reviewWebsiteResultSchema = savedReportSchema
  .partial()
  .passthrough();

/** Every step's input and output schema, by step id, in catalogue order. */
export const REVIEW_WEBSITE_STEP_SCHEMAS = {
  'prepare-session': {
    input: reviewWebsiteInputSchema,
    output: preparedSessionSchema,
    suspend: signInQuestionSchema,
    resume: signInAnswerSchema,
  },
  'discover-pages': {
    input: preparedSessionSchema,
    output: discoveredSiteSchema,
  },
  'capture-and-check': {
    input: discoveredSiteSchema,
    output: checkedSiteSchema,
  },
  'save-report': { input: checkedSiteSchema, output: savedReportSchema },
} as const;
