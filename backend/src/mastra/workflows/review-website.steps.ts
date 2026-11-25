/**
 * The step catalogue of the Review a Website workflow (agents.md 5.19): its
 * id and name, the steps and edges the workflow page shows, the runtime a
 * run hands its steps, and the pure code of its steps (the input made
 * usable, the sign-in question, whether a page looks signed in). No
 * framework import, so the catalogue and Jest read it without Mastra;
 * ./review-website.workflow.ts builds the Mastra steps from it. The
 * measured rules are in ./review-website.checks.ts and the report in
 * ./review-website.report.ts.
 */
import {
  REVIEW_WEBSITE_STEP_SCHEMAS,
  SITE_SCREENS,
  type CheckedSite,
  type DiscoveredSite,
  type Finding,
  type GroupedSite,
  type IrisReview,
  type PageTemplate,
  type ReviewShot,
  type PreparedSession,
  type ReviewWebsiteInput,
} from './review-website.schemas';
import {
  contractStepEntry,
  type ContractStepEntry,
  type WorkflowEdge,
} from './workflow-contract';
import { ModelTimeoutError } from './model-call';

/** The workflow's registry key and id. */
export const REVIEW_WEBSITE_WORKFLOW_ID = 'review-website';

/** The name the app shows for the workflow (workflows R1). */
export const REVIEW_WEBSITE_WORKFLOW_NAME = 'Review a Website';

/** What the catalogue says the workflow does. */
export const REVIEW_WEBSITE_DESCRIPTION =
  'Maps a website and checks every page on each screen size for visual and usability defects, measured in a real browser. Each finding shows the element, what was measured and a crop of the screenshot.';

/** The RequestContext key of a run's runtime. */
export const REVIEW_WEBSITE_RUNTIME_KEY = 'review-website-runtime';

/** The links a run never follows unless its form says otherwise. */
export const REVIEW_WEBSITE_DEFAULT_EXCLUDE =
  'logout|log-out|signout|sign-out|logoff|delete|remove|unsubscribe';

/** The page limit's default and bounds. */
export const REVIEW_WEBSITE_PAGES = { default: 50, min: 1, max: 250 } as const;
/** The depth limit's default and bounds. */
export const REVIEW_WEBSITE_DEPTH = { default: 3, min: 0, max: 6 } as const;

/** The option of the sign-in question that goes on. */
export const SIGN_IN_CONTINUE = 'Continue';

const SCHEMAS = REVIEW_WEBSITE_STEP_SCHEMAS;

/**
 * The steps, in catalogue order. Their field names and JSON Schemas come
 * from ./review-website.schemas.ts; how they connect is
 * `REVIEW_WEBSITE_EDGES`.
 */
export const REVIEW_WEBSITE_STEPS: readonly ContractStepEntry[] = [
  contractStepEntry(
    {
      id: 'prepare-session',
      title: 'Prepare session',
      kind: 'code',
      summary:
        'Checks the entry URL and the screens. When the site needs a sign-in, uses the one saved for the site, or opens a browser window for you to sign in and waits until you continue. No LLM.',
      exits: [
        {
          label: 'the entry URL or the exclusion pattern is not valid',
          outcome: 'fails',
        },
        {
          label: 'no Microsoft Edge or Google Chrome is installed',
          outcome: 'fails',
        },
        { label: 'until you sign in', outcome: 'waits' },
      ],
    },
    SCHEMAS['prepare-session'],
  ),
  contractStepEntry(
    {
      id: 'discover-pages',
      title: 'Discover pages',
      kind: 'code',
      summary:
        'Follows the links of the entry page, then of each page it reaches, on the same site only, up to the depth and page limits, never following the excluded links. No LLM.',
      exits: [
        { label: 'you stop it', outcome: 'stops' },
        { label: 'the sign-in is lost', outcome: 'stops' },
      ],
    },
    SCHEMAS['discover-pages'],
  ),
  contractStepEntry(
    {
      id: 'group-templates',
      title: 'Group templates',
      kind: 'code',
      summary:
        'Groups the pages into page templates: pages that share a URL pattern or a page structure. Picks one page per template for Iris and counts the AI calls her review takes. No LLM.',
      exits: [],
    },
    SCHEMAS['group-templates'],
  ),
  contractStepEntry(
    {
      id: 'confirm-review',
      title: 'Confirm review',
      kind: 'code',
      summary:
        'Only when Iris would review more than ten templates: asks whether to review them all, only the ten biggest, or to keep to the measured checks. No LLM.',
      exits: [{ label: 'until you choose', outcome: 'waits' }],
    },
    SCHEMAS['confirm-review'],
  ),
  contractStepEntry(
    {
      id: 'capture-and-check',
      title: 'Capture and check',
      kind: 'code',
      summary:
        'Opens every page on every screen, takes a full-page screenshot and measures it: accessibility (axe), sideways scrolling, cut-off text, controls covered by banners, small tap targets, broken images, HTTP and console errors, placeholder text. For each template Iris reviews, also takes the top of its page with numbered marks on its elements. No LLM.',
      exits: [{ label: 'you stop it', outcome: 'stops' }],
    },
    SCHEMAS['capture-and-check'],
  ),
  contractStepEntry(
    {
      id: 'review-templates',
      title: 'Review templates',
      kind: 'agent',
      summary:
        'Only when there are templates to review: Iris looks at one page per template, the narrowest and the widest screen side by side, with the measured findings as context, and reports what measuring cannot see: hierarchy, alignment, spacing, consistency, imagery, legibility. One model call per template, two at a time, at most two minutes each.',
      exits: [
        { label: 'the model returns an error', outcome: 'fails' },
        {
          label: 'Iris does not answer within two minutes',
          outcome: 'fails',
        },
        { label: 'you stop it', outcome: 'stops' },
      ],
      modelOnly: true,
    },
    SCHEMAS['review-templates'],
  ),
  contractStepEntry(
    {
      id: 'save-report',
      title: 'Save report',
      kind: 'code',
      summary:
        'Draws the report by page template as a visual of the run, with a crop of each finding, saves the findings as a file of the run and writes the answer. No LLM.',
      exits: [],
    },
    SCHEMAS['save-report'],
  ),
];

/** The edges of the workflow (api.md 117), from Start to End. */
export const REVIEW_WEBSITE_EDGES: readonly WorkflowEdge[] = [
  { from: 'start', to: 'prepare-session', kind: 'next' },
  { from: 'prepare-session', to: 'discover-pages', kind: 'next' },
  { from: 'discover-pages', to: 'group-templates', kind: 'next' },
  {
    from: 'group-templates',
    to: 'capture-and-check',
    kind: 'next',
    label: 'Ten templates or fewer',
    note: 'Few enough page templates to review without asking.',
  },
  {
    from: 'group-templates',
    to: 'confirm-review',
    kind: 'branch',
    label: 'More than ten templates',
    note: 'Many templates: the run waits for you to confirm before the long review.',
  },
  { from: 'confirm-review', to: 'capture-and-check', kind: 'next' },
  {
    from: 'capture-and-check',
    to: 'save-report',
    kind: 'next',
    label: 'No visual review',
    note: 'Visual review is off, or no template needs it: the report is saved.',
  },
  {
    from: 'capture-and-check',
    to: 'review-templates',
    kind: 'branch',
    label: 'Templates to review',
    note: 'Iris looks at each template’s screenshots for visual defects.',
  },
  { from: 'review-templates', to: 'save-report', kind: 'next' },
  { from: 'save-report', to: 'end', kind: 'next' },
];

/** A visual's bundle, as the report draws it. */
export interface ReviewReportBundle {
  title: string;
  description: string;
  html: string;
  css: string;
  javascript: string;
}

/**
 * What a run hands its steps on the RequestContext: the browser work, the
 * sign-in store and the run's files. A step throws when it is missing.
 */
export interface ReviewWebsiteRuntime {
  /** Prepare session: whether the sign-in saved for the site still works. */
  checkSignIn(input: { url: string; loginUrl: string }): Promise<{
    signedIn: boolean;
  }>;
  /** Prepare session: opens a visible browser window on the sign-in page. */
  openSignIn(input: { loginUrl: string }): Promise<void>;
  /**
   * Prepare session, resumed: when the window is signed in, saves its
   * sign-in for the site and closes it; else leaves it open.
   */
  finishSignIn(input: { url: string; loginUrl: string }): Promise<{
    signedIn: boolean;
  }>;
  /** Discover pages: the crawl. */
  discoverPages(
    input: PreparedSession,
  ): Promise<
    Pick<DiscoveredSite, 'pages' | 'skippedLinks' | 'capped' | 'sessionLost'>
  >;
  /**
   * Capture and check: every page on every screen, measured; and the marked
   * screenshots of the templates Iris reviews.
   */
  captureAndCheck(
    input: GroupedSite,
  ): Promise<Pick<CheckedSite, 'captures' | 'findings' | 'reviewShots'>>;
  /**
   * Review templates: Iris's review of one template, from its shots, with
   * the measured findings of that template as context.
   */
  reviewTemplate(input: {
    template: PageTemplate;
    shots: readonly ReviewShot[];
    measured: readonly Finding[];
  }): Promise<{ review: IrisReview; stopped: boolean }>;
  /** Review templates: one progress line. */
  progress(line: string): void;
  /** Save report: the images, as `data:` URIs, by workspace path. */
  loadReportImages(paths: readonly string[]): Promise<Record<string, string>>;
  /**
   * Save report: stores the report as a visual of the run, the findings as
   * a file of the run, and shows the answer.
   */
  saveReport(input: {
    bundle: ReviewReportBundle;
    findings: string;
    answer: string;
  }): Promise<{ visualId: string; reportFile: string }>;
  /** Shows the run's answer when it ends early (the sign-in was lost). */
  showAnswer(text: string): Promise<void>;
}

/**
 * The workflow's input from a run's checked form values (agents.md 5.19):
 * each field, or its default when the form left it out.
 */
export function reviewWebsiteInputOf(
  values: Readonly<Record<string, unknown>>,
): ReviewWebsiteInput {
  const text = (name: string) =>
    typeof values[name] === 'string' ? values[name] : '';
  const number = (name: string, fallback: number) =>
    typeof values[name] === 'number' ? values[name] : fallback;
  const flag = (name: string, fallback: boolean) =>
    typeof values[name] === 'boolean' ? values[name] : fallback;
  return {
    url: text('url'),
    maxPages: number('maxPages', REVIEW_WEBSITE_PAGES.default),
    maxDepth: number('maxDepth', REVIEW_WEBSITE_DEPTH.default),
    mobile: flag('mobile', true),
    tablet: flag('tablet', false),
    laptop: flag('laptop', true),
    desktop: flag('desktop', false),
    exclude: text('exclude'),
    needsSignIn: flag('needsSignIn', false),
    loginUrl: text('loginUrl'),
    visualReview: flag('visualReview', true),
  };
}

/** A run's input that cannot be used, said in the form's words. */
export class ReviewWebsiteInputError extends Error {}

/**
 * How long one try of Iris's call may take, rate-limit retries included:
 * her one deadline, which her guarded call uses (`reviewTemplateWithModel`;
 * workflows R43).
 */
export const IRIS_CALL_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Iris's call took longer than `IRIS_CALL_TIMEOUT_MS`: a model timeout in
 * her own words, so it is never retried and never read as a Stop.
 */
export class IrisTimeoutError extends ModelTimeoutError {
  constructor(template: string) {
    super('Review templates', IRIS_CALL_TIMEOUT_MS);
    this.name = 'IrisTimeoutError';
    this.message = `Iris did not answer within two minutes while reviewing ${template}. The model may be busy or rate limited: run again later, or untick Visual review with Iris to keep to the measured checks.`;
  }
}

/** The site's origin, or an error naming the field. */
export function siteOrigin(url: string, label = 'Entry URL'): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ReviewWebsiteInputError(
      `${label} must be a web address starting with http:// or https://`,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ReviewWebsiteInputError(
      `${label} must be a web address starting with http:// or https://`,
    );
  }
  return parsed.origin;
}

/** The site's host, for the answer and the sign-in question. */
export function siteHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function bounded(
  value: number,
  limits: { default: number; min: number; max: number },
): number {
  if (!Number.isFinite(value)) return limits.default;
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

/**
 * The run's input made usable (Prepare session): the screens as a list,
 * narrowest first; the limits within their bounds; the exclusion pattern's
 * default when it is blank; the sign-in page, else the entry URL. Throws
 * `ReviewWebsiteInputError` for an entry URL or sign-in page that is no web
 * address, an exclusion pattern that is no regular expression, or no
 * screen.
 */
export function preparedSessionOf(
  input: ReviewWebsiteInput,
): Omit<PreparedSession, 'signedIn'> {
  const url = input.url.trim();
  const origin = siteOrigin(url);
  const loginUrl = input.loginUrl.trim();
  if (loginUrl) siteOrigin(loginUrl, 'Sign-in page');
  const screens = SITE_SCREENS.filter((screen) => input[screen.name]).map(
    (screen) => screen.name,
  );
  if (!screens.length) {
    throw new ReviewWebsiteInputError('Choose at least one screen');
  }
  const exclude = input.exclude.trim() || REVIEW_WEBSITE_DEFAULT_EXCLUDE;
  try {
    new RegExp(exclude, 'i');
  } catch (error) {
    throw new ReviewWebsiteInputError(
      `Never follow links matching is not a valid pattern: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    url,
    maxPages: bounded(input.maxPages, REVIEW_WEBSITE_PAGES),
    maxDepth: bounded(input.maxDepth, REVIEW_WEBSITE_DEPTH),
    screens,
    exclude,
    needsSignIn: input.needsSignIn,
    visualReview: input.visualReview,
    loginUrl: loginUrl || url,
    origin,
  };
}

/** What the waiting run asks while the sign-in window is open. */
export function signInQuestion(
  url: string,
  again = false,
): {
  question: string;
  options: string[];
} {
  const host = siteHost(url);
  return {
    question: again
      ? `Still not signed in to ${host}. Finish signing in in the browser window, then press ${SIGN_IN_CONTINUE}.`
      : `Sign in to ${host} in the browser window that just opened (multi-factor sign-in included), then press ${SIGN_IN_CONTINUE}. The sign-in is saved, encrypted, for the next reviews of this site.`,
    options: [SIGN_IN_CONTINUE],
  };
}

/**
 * Whether a loaded page looks signed in to the site: it stayed on the
 * site's origin, it is not the sign-in page itself, and it shows no
 * password field.
 */
export function looksSignedIn(page: {
  finalUrl: string;
  origin: string;
  loginUrl: string;
  url: string;
  hasPasswordField: boolean;
}): boolean {
  if (page.hasPasswordField) return false;
  let final: URL;
  try {
    final = new URL(page.finalUrl);
  } catch {
    return false;
  }
  if (final.origin !== page.origin) return false;
  // Sent to the sign-in page (not where the run asked to go).
  const path = (url: string) => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
    } catch {
      return url;
    }
  };
  const login = path(page.loginUrl);
  return !(login !== path(page.url) && path(page.finalUrl) === login);
}
