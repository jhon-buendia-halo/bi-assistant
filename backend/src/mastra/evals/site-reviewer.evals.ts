import type { Agent } from '@mastra/core/agent';
import { checks } from '@mastra/evals/checks';
import type * as SiteReviewerAgent from '../agents/site-reviewer.agent';
import type * as ReviewAgents from '../workflows/review-website.agents';
import type {
  AssistantEvalCase,
  AssistantEvalSet,
  EvalCustomCheck,
  EvalTarget,
} from './assistant.evals';
import {
  atMostEightFindings,
  doesNotRepeatMeasured,
  flagsPlantedElement,
  marksExist,
  onlyMinorFindings,
  parsesAsReview,
} from './site-reviewer-eval-checks';
import {
  BROKEN_IMAGE_PAGE,
  CLEAN_PAGE,
  INCONSISTENT_BUTTONS_PAGE,
  MISALIGNED_CARDS_PAGE,
  TEXT_OVER_IMAGE_PAGE,
} from './site-reviewer-pages';
import {
  captureInBrowser,
  reviewerTurnAgent,
  type CaptureScreens,
  type ReviewTemplate,
  type SiteReviewerPlan,
} from './site-reviewer-eval-target';

/**
 * The eval set of Iris, Site Reviewer (agents.md 8.1, 2.16, 5.19), run on
 * the `site-reviewer` agent. A case is one small self-contained page with
 * one planted defect (or none), reviewed on Mobile (390 px) and Laptop
 * (1440 px) as Review templates does: the top of the page clean and with
 * numbered marks, the marks legend and the measured findings already known.
 * The page in the case is the fixture: no data is read, and the set needs a
 * browser (Edge or Chrome, or `SITE_REVIEW_BROWSER_PATH`).
 *
 * The planted elements are found by CSS selector at run time and mapped to
 * the numbers of the marks, so the code checks know which marks are right.
 * One judged rubric per case holds the one pass condition.
 */

/**
 * The sample fixture the runner's dataset preflight binds the set to. Iris
 * reads no data (the page in the case is her input), but every run still
 * selects a dataset, as the Query Explainer's does.
 */
export const SITE_REVIEWER_EVAL_FIXTURE_ID = 'world-cup';

/** The registry key of the agent the set runs on. */
export const SITE_REVIEWER_EVAL_AGENT_KEY = 'site-reviewer';

interface SiteReviewerPage {
  id: string;
  /** What the case probes. */
  intent: string;
  plan: SiteReviewerPlan;
  /** The checks of this case, after the shared ones. */
  expect: EvalCustomCheck[];
  /** The one pass condition, as the judge reads it. */
  pass: string;
}

const PAGES: SiteReviewerPage[] = [
  {
    id: 'inconsistent-buttons',
    intent:
      'Three calls to action in one row in clearly different styles (radius, colour, font size): a consistency or hierarchy finding on one of the buttons.',
    plan: {
      html: INCONSISTENT_BUTTONS_PAGE,
      planted: {
        start: '#cta-start',
        demo: '#cta-demo',
        contact: '#cta-contact',
      },
    },
    expect: [
      flagsPlantedElement(
        ['consistency', 'hierarchy'],
        ['start', 'demo', 'contact'],
      ),
    ],
    pass:
      'a finding says the three buttons in the row (Start free trial, Watch demo, Contact sales) look different from each other ' +
      '(shape, colour or size) and points at one of them',
  },
  {
    id: 'text-over-image',
    intent:
      'White text over a light, busy patterned background: a legibility finding on the hero text, which a contrast tool cannot measure over images.',
    plan: {
      html: TEXT_OVER_IMAGE_PAGE,
      planted: { heading: '#hero-heading', lede: '#hero-lede' },
    },
    expect: [flagsPlantedElement(['legibility'], ['heading', 'lede'])],
    pass: 'a finding says the white hero text ("Make every journey simple" or the line under it) is hard to read over the light patterned background and points at that text',
  },
  {
    id: 'misaligned-cards',
    intent:
      'A row of three cards where the middle one sits about 40 px lower and is narrower: an alignment or spacing finding on a card.',
    plan: {
      html: MISALIGNED_CARDS_PAGE,
      // A card is a container with no mark of its own: its title stands for it.
      planted: { a: '#card-a-title', b: '#card-b-title', c: '#card-c-title' },
    },
    expect: [flagsPlantedElement(['alignment', 'spacing'], ['a', 'b', 'c'])],
    pass: 'a finding says the cards in the row are not aligned (one sits lower or is narrower than the others, the "Clear reports" card) and points at one of the cards',
  },
  {
    id: 'clean-page',
    intent:
      'A tidy, consistent page: no critical or major finding, at most two minor ones per screen.',
    plan: { html: CLEAN_PAGE, planted: {} },
    expect: [onlyMinorFindings(2)],
    pass: 'the review reports no problem a person would have to fix: it is empty, or holds only minor remarks, and it claims no defect the page does not have',
  },
  {
    id: 'measured-not-repeated',
    intent:
      'A page with a broken image whose failure is already measured and passed to Iris: she must not report the image failing to load again.',
    plan: {
      html: BROKEN_IMAGE_PAGE,
      planted: { photo: '#team-photo' },
      measured: {
        rule: 'broken-image',
        title: 'Image does not load',
        selector: '#team-photo',
      },
    },
    expect: [doesNotRepeatMeasured()],
    pass: 'no finding is about the team photo failing to load, being broken or missing, since the measured finding "Image does not load" already says it',
  },
];

function rubricOf(page: SiteReviewerPage): string {
  return (
    `Iris reviewed one page on a Mobile (390 px) and a Laptop (1440 px) screen. ${page.intent} ` +
    `Pass condition: score pass=true only if ${page.pass}. ` +
    'Score pass=false otherwise, or if a finding invents an element the page does not have.'
  );
}

/** The question of a case: the target finds the page by the case id. */
function questionOf(page: SiteReviewerPage): string {
  return `Review the page of the case "${page.id}" on the Mobile and Laptop screens`;
}

export const SITE_REVIEWER_EVAL_CASES: AssistantEvalCase[] = PAGES.map(
  (page): AssistantEvalCase => ({
    id: page.id,
    question: questionOf(page),
    intent: page.intent,
    // `runEvals` needs one built-in check: the answer holds the findings list.
    scorers: [checks.includes('"findings"')],
    customChecks: [
      parsesAsReview(),
      atMostEightFindings(),
      marksExist(),
      ...page.expect,
    ],
    judgeRubric: rubricOf(page),
  }),
);

export const SITE_REVIEWER_EVAL_SET: AssistantEvalSet = {
  id: 'site-reviewer',
  name: 'Site Reviewer',
  description:
    'Pages for Iris, Site Reviewer, each with one planted defect (inconsistent ' +
    'buttons, text over a busy background, misaligned cards), a clean page and ' +
    'a page whose broken image is already measured. Each is rendered on Mobile ' +
    'and Laptop and reviewed with vision. Needs Microsoft Edge or Google Chrome ' +
    '(or SITE_REVIEW_BROWSER_PATH). No data is read; select the World Cup ' +
    'dataset, as every run does.',
  fixtureId: SITE_REVIEWER_EVAL_FIXTURE_ID,
  agentKey: SITE_REVIEWER_EVAL_AGENT_KEY,
  cases: SITE_REVIEWER_EVAL_CASES,
};

/** The page of a case, by the question the case sends. */
export function planOfQuestion(question: string): SiteReviewerPlan | undefined {
  return PAGES.find((page) => question.includes(`"${page.id}"`))?.plan;
}

/**
 * The real agent and its model call, required on first use: they keep
 * Mastra off the module graph of the eval catalogue (which Jest and the
 * Agents screen load without running a case).
 */
function defaultAgent(): typeof SiteReviewerAgent {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../agents/site-reviewer.agent') as typeof SiteReviewerAgent;
}

function defaultReview(): typeof ReviewAgents {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../workflows/review-website.agents') as typeof ReviewAgents;
}

/**
 * The eval target of one `site-reviewer` run (agents.md 8.1): the agent, its
 * `generate` replaced by one page rendered and reviewed. Iris gets no
 * orientation and no knowledge (her request holds her own context), and the
 * case's judge reads the review JSON.
 */
export function siteReviewerEvalTarget(
  loadAgent: () => Agent = () => defaultAgent().siteReviewerAgent,
  review: ReviewTemplate = (input, options) =>
    defaultReview().reviewTemplateWithModel(input, options),
  capture: CaptureScreens = captureInBrowser,
): EvalTarget {
  let agent: Agent | undefined;
  let run: Agent | undefined;
  return {
    agentKey: SITE_REVIEWER_EVAL_AGENT_KEY,
    get agent(): Agent {
      agent ??= loadAgent();
      return agent;
    },
    // Each case reviews one page, as Review templates does (not an agent chat).
    get runTarget(): Agent {
      run ??= reviewerTurnAgent(
        (agent ??= loadAgent()),
        planOfQuestion,
        capture,
        review,
      );
      return run;
    },
    sets: [SITE_REVIEWER_EVAL_SET],
    sendsKnowledge: false,
    orientation: () => '',
  };
}
