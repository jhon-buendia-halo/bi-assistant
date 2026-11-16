// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps, bail and suspend/resume with the engine's events.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);

import { RequestContext } from '@mastra/core/request-context';
import { reviewWebsiteWorkflow } from './review-website.workflow';
import {
  REVIEW_WEBSITE_DEFAULT_EXCLUDE,
  REVIEW_WEBSITE_RUNTIME_KEY,
  REVIEW_WEBSITE_STEPS,
  REVIEW_WEBSITE_WORKFLOW_ID,
  SIGN_IN_CONTINUE,
  type ReviewWebsiteRuntime,
} from './review-website.steps';
import type {
  DiscoveredPage,
  Finding,
  GroupedSite,
  ReviewWebsiteInput,
} from './review-website.schemas';

interface StubEvent {
  type: string;
  payload?: {
    id?: string;
    status?: string;
    output?: unknown;
    suspendPayload?: unknown;
  };
}
interface StubResult {
  status: string;
  result?: Record<string, unknown>;
  error?: unknown;
  suspended?: string[][];
}
interface StubStream {
  fullStream: AsyncIterable<StubEvent>;
  result: Promise<StubResult>;
}
interface StubRun {
  stream(args: { inputData: unknown; requestContext: unknown }): StubStream;
  resumeStream(args: {
    step: string[];
    resumeData: unknown;
    requestContext: unknown;
  }): StubStream;
}
interface StubWorkflow {
  id: string;
  steps: { id: string; description?: string }[];
  entries: { type: string; pairs?: [unknown, { id: string }][] }[];
  options?: {
    shouldPersistSnapshot?: (args: { workflowStatus: string }) => boolean;
  };
  createRun(): Promise<StubRun>;
}

const workflow = reviewWebsiteWorkflow as unknown as StubWorkflow;

const INPUT: ReviewWebsiteInput = {
  url: 'https://shop.example.com/',
  maxPages: 20,
  maxDepth: 2,
  mobile: true,
  tablet: false,
  laptop: true,
  desktop: false,
  exclude: '',
  needsSignIn: false,
  loginUrl: '',
  // Phase 1's flow; Iris's review has its own tests below.
  visualReview: false,
};

const PAGES: DiscoveredPage[] = [
  {
    url: 'https://shop.example.com/',
    finalUrl: 'https://shop.example.com/',
    status: 200,
    title: 'Shop',
    depth: 0,
    parent: null,
    group: '/',
    fingerprint: 'f00d',
    error: null,
  },
];

const FINDING: Finding = {
  id: 'f-1',
  rule: 'broken-image',
  severity: 'major',
  title: 'Image does not load',
  screen: 'mobile',
  group: '/',
  selector: 'img.hero',
  measured: 'hero.png',
  expected: 'Every image loads',
  rect: { x: 0, y: 0, width: 100, height: 50 },
  helpUrl: null,
  pages: ['https://shop.example.com/'],
  crop: 'site-review/mobile/home.0.crop.jpg',
  source: 'measured',
};

type MockedRuntime = { [K in keyof ReviewWebsiteRuntime]: jest.Mock };

/** A runtime whose every call succeeds on a one-page public site. */
function runtime(overrides: Partial<MockedRuntime> = {}): MockedRuntime {
  return {
    checkSignIn: jest.fn(() => Promise.resolve({ signedIn: false })),
    openSignIn: jest.fn(() => Promise.resolve()),
    finishSignIn: jest.fn(() => Promise.resolve({ signedIn: true })),
    discoverPages: jest.fn(() =>
      Promise.resolve({
        pages: PAGES,
        skippedLinks: [],
        capped: false,
        sessionLost: null,
      }),
    ),
    captureAndCheck: jest.fn(() =>
      Promise.resolve({
        captures: [
          {
            url: PAGES[0].url,
            screen: 'mobile',
            group: '/',
            screenshot: 'site-review/mobile/home.jpg',
            thumbnail: 'site-review/mobile/home.thumb.jpg',
            status: 200,
            error: null,
          },
        ],
        findings: [FINDING],
        reviewShots: [],
      }),
    ),
    reviewTemplate: jest.fn(() =>
      Promise.resolve({
        review: { findings: [], summary: 'Looks right.' },
        stopped: false,
      }),
    ),
    progress: jest.fn(),
    loadReportImages: jest.fn((paths: string[]) =>
      Promise.resolve(
        Object.fromEntries(
          paths.map((path) => [path, 'data:image/jpeg;base64,AAAA']),
        ),
      ),
    ),
    saveReport: jest.fn(() =>
      Promise.resolve({
        visualId: 'v-1',
        reportFile: 'site-review/findings.json',
      }),
    ),
    showAnswer: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

async function drain(stream: StubStream) {
  const events: string[] = [];
  const suspended: unknown[] = [];
  for await (const event of stream.fullStream) {
    if (event.payload?.id && event.payload.status) {
      events.push(`${event.payload.id}:${event.payload.status}`);
    }
    if (event.type === 'workflow-step-suspended') {
      suspended.push(event.payload?.suspendPayload);
    }
  }
  return { events, suspended, result: await stream.result };
}

async function start(
  given: MockedRuntime,
  input: Partial<ReviewWebsiteInput> = {},
) {
  const requestContext = new RequestContext();
  requestContext.set(REVIEW_WEBSITE_RUNTIME_KEY, given);
  const engineRun = await workflow.createRun();
  const drained = await drain(
    engineRun.stream({ inputData: { ...INPUT, ...input }, requestContext }),
  );
  return { ...drained, engineRun, requestContext };
}

describe('review-website workflow (agents.md 5.19)', () => {
  it('builds the catalogue steps in order, Confirm review inside the branch', () => {
    expect(workflow.id).toBe(REVIEW_WEBSITE_WORKFLOW_ID);
    expect(workflow.steps.map((step) => [step.id, step.description])).toEqual(
      REVIEW_WEBSITE_STEPS.filter((step) => step.id !== 'confirm-review').map(
        (step) => [step.id, step.title],
      ),
    );
    const branch = workflow.entries.find((entry) => entry.type === 'branch');
    expect(branch?.pairs?.map(([, step]) => step.id)).toEqual([
      'confirm-review',
    ]);
  });

  it('snapshots only while the run waits for the sign-in', () => {
    const persist = workflow.options?.shouldPersistSnapshot;
    expect(persist?.({ workflowStatus: 'suspended' })).toBe(true);
    expect(persist?.({ workflowStatus: 'running' })).toBe(false);
    expect(persist?.({ workflowStatus: 'success' })).toBe(false);
  });

  it('reviews a public site: crawl, measure, report, with no sign-in call', async () => {
    const given = runtime();
    const { events, result } = await start(given);
    expect(result.status).toBe('success');
    expect(events).toEqual([
      'prepare-session:running',
      'prepare-session:success',
      'discover-pages:running',
      'discover-pages:success',
      'group-templates:running',
      'group-templates:success',
      'review-choice:running',
      'review-choice:success',
      'capture-and-check:running',
      'capture-and-check:success',
      'review-templates:running',
      'review-templates:success',
      'save-report:running',
      'save-report:success',
    ]);
    expect(given.checkSignIn).not.toHaveBeenCalled();
    // The input made usable: screens as a list, the default exclusion.
    expect(given.discoverPages).toHaveBeenCalledWith(
      expect.objectContaining({
        screens: ['mobile', 'laptop'],
        exclude: REVIEW_WEBSITE_DEFAULT_EXCLUDE,
        origin: 'https://shop.example.com',
        loginUrl: 'https://shop.example.com/',
        signedIn: false,
      }),
    );
    // Only the images the report shows are read.
    expect(given.loadReportImages).toHaveBeenCalledWith([
      'site-review/mobile/home.0.crop.jpg',
      'site-review/mobile/home.thumb.jpg',
    ]);
    const saved = (given.saveReport.mock.calls as unknown[][])[0][0] as {
      bundle: { title: string; javascript: string };
      findings: string;
      answer: string;
    };
    expect(saved.bundle.title).toBe('Site review: shop.example.com');
    expect(
      (JSON.parse(saved.findings) as { findings: unknown[] }).findings,
    ).toHaveLength(1);
    expect(saved.answer).toContain('**shop.example.com**');
    expect(result.result).toEqual(
      expect.objectContaining({
        visualId: 'v-1',
        pageCount: 1,
        groupCount: 1,
        findingCount: 1,
        counts: { critical: 0, major: 1, minor: 0 },
      }),
    );
  });

  it('refuses an entry URL that is no web address before any browser work', async () => {
    const given = runtime();
    const { result } = await start(given, { url: 'ftp://shop.example.com' });
    expect(result.status).toBe('failed');
    expect(String(result.error)).toContain(
      'Entry URL must be a web address starting with http:// or https://',
    );
    expect(given.discoverPages).not.toHaveBeenCalled();
  });

  it('refuses a run with no screen', async () => {
    const { result } = await start(runtime(), { mobile: false, laptop: false });
    expect(result.status).toBe('failed');
    expect(String(result.error)).toContain('Choose at least one screen');
  });

  it('uses the saved sign-in when it still works, without waiting', async () => {
    const given = runtime({
      checkSignIn: jest.fn(() => Promise.resolve({ signedIn: true })),
    });
    const { result } = await start(given, { needsSignIn: true });
    expect(result.status).toBe('success');
    expect(given.openSignIn).not.toHaveBeenCalled();
    expect(given.discoverPages).toHaveBeenCalledWith(
      expect.objectContaining({ signedIn: true }),
    );
  });

  it('waits for the user to sign in, then goes on with the saved sign-in', async () => {
    const given = runtime();
    const started = await start(given, {
      needsSignIn: true,
      loginUrl: 'https://shop.example.com/login',
    });
    expect(started.result.status).toBe('suspended');
    expect(given.openSignIn).toHaveBeenCalledWith({
      loginUrl: 'https://shop.example.com/login',
    });
    const asked = started.suspended[0] as {
      question: string;
      options: string[];
    };
    expect(asked.question).toContain('Sign in to shop.example.com');
    expect(asked.options).toEqual([SIGN_IN_CONTINUE]);
    expect(given.discoverPages).not.toHaveBeenCalled();
    const resumed = await drain(
      started.engineRun.resumeStream({
        step: started.result.suspended![0],
        resumeData: { answer: SIGN_IN_CONTINUE },
        requestContext: started.requestContext,
      }),
    );
    expect(resumed.result.status).toBe('success');
    expect(given.finishSignIn).toHaveBeenCalledTimes(1);
    expect(given.discoverPages).toHaveBeenCalledWith(
      expect.objectContaining({ signedIn: true }),
    );
  });

  it('asks again when Continue still finds no sign-in', async () => {
    const given = runtime({
      finishSignIn: jest.fn(() => Promise.resolve({ signedIn: false })),
    });
    const started = await start(given, { needsSignIn: true });
    const resumed = await drain(
      started.engineRun.resumeStream({
        step: started.result.suspended![0],
        resumeData: { answer: SIGN_IN_CONTINUE },
        requestContext: started.requestContext,
      }),
    );
    expect(resumed.result.status).toBe('suspended');
    const again = resumed.suspended[0] as {
      question: string;
      options: string[];
    };
    expect(again.question).toContain('Still not signed in');
    expect(again.options).toEqual([SIGN_IN_CONTINUE]);
    expect(given.discoverPages).not.toHaveBeenCalled();
  });

  it('ends early when the crawl loses the sign-in: nothing measured, the answer says why', async () => {
    const given = runtime({
      checkSignIn: jest.fn(() => Promise.resolve({ signedIn: true })),
      discoverPages: jest.fn(() =>
        Promise.resolve({
          pages: PAGES,
          skippedLinks: [],
          capped: false,
          sessionLost: 'https://shop.example.com/orders',
        }),
      ),
    });
    const { events, result } = await start(given, { needsSignIn: true });
    expect(result.status).toBe('success');
    expect(events).toContain('discover-pages:bailed');
    expect(given.captureAndCheck).not.toHaveBeenCalled();
    expect(given.saveReport).not.toHaveBeenCalled();
    expect(given.showAnswer).toHaveBeenCalledWith(
      expect.stringContaining('The sign-in for **shop.example.com** expired'),
    );
  });

  it('fails a step that has no runtime, naming it', async () => {
    const engineRun = await workflow.createRun();
    const { result } = await drain(
      engineRun.stream({
        inputData: INPUT,
        requestContext: new RequestContext(),
      }),
    );
    expect(result.status).toBe('failed');
    expect(String(result.error)).toContain(
      'The Discover pages step has no website to review',
    );
  });
  describe('phase 2: page templates and Iris (agents.md 5.19)', () => {
    /** `count` pages, each its own template (distinct URL patterns and structures). */
    function sitePages(count: number): DiscoveredPage[] {
      return Array.from({ length: count }, (_, at) => ({
        url: `https://shop.example.com/section-${at}`,
        finalUrl: `https://shop.example.com/section-${at}`,
        status: 200,
        title: `Section ${at}`,
        depth: at === 0 ? 0 : 1,
        parent: at === 0 ? null : 'https://shop.example.com/section-0',
        group: `/section-${at}`,
        fingerprint: `fp-${at}`,
        error: null,
      }));
    }

    /** A runtime on `count` templates whose capture returns a shot per reviewed template. */
    function reviewRuntime(
      count: number,
      overrides: Partial<MockedRuntime> = {},
    ) {
      const pages = sitePages(count);
      return runtime({
        discoverPages: jest.fn(() =>
          Promise.resolve({
            pages,
            skippedLinks: [],
            capped: false,
            sessionLost: null,
          }),
        ),
        captureAndCheck: jest.fn((site: GroupedSite) =>
          Promise.resolve({
            captures: [],
            findings: [],
            reviewShots: site.reviewTemplates.map((template) => ({
              template,
              url: site.templates.find((t) => t.id === template)!
                .representative,
              screen: 'mobile',
              clean: `site-review/review/mobile/${template.slice(1)}.clean.jpg`,
              marked: `site-review/review/mobile/${template.slice(1)}.marked.jpg`,
              marks: [
                {
                  n: 1,
                  selector: 'h1',
                  tag: 'h1',
                  text: 'Title',
                  rect: { x: 0, y: 0, width: 200, height: 40 },
                  crop: `site-review/review/mobile/${template.slice(1)}.mark-1.jpg`,
                },
              ],
            })),
          }),
        ),
        reviewTemplate: jest.fn(() =>
          Promise.resolve({
            review: {
              findings: [
                {
                  mark: 1,
                  screen: 'mobile',
                  severity: 'major',
                  category: 'hierarchy',
                  title: 'Title competes with the banner',
                  observed: 'The banner is bigger than the page title.',
                  suggestion: 'Make the title the largest text.',
                },
              ],
              summary: 'Busy header.',
            },
            stopped: false,
          }),
        ),
        ...overrides,
      });
    }

    it('Iris reviews every template when there are ten or fewer, and her findings join the report', async () => {
      const given = reviewRuntime(3);
      const { events, result } = await start(given, { visualReview: true });
      expect(result.status).toBe('success');
      expect(events).not.toContain('confirm-review:running');
      expect(given.reviewTemplate).toHaveBeenCalledTimes(3);
      const first = (given.reviewTemplate.mock.calls as unknown[][])[0][0] as {
        template: { id: string };
        shots: unknown[];
      };
      expect(first.template.id).toBe('/section-0');
      expect(first.shots).toHaveLength(1);
      const saved = (given.saveReport.mock.calls as unknown[][])[0][0] as {
        findings: string;
        answer: string;
      };
      const stored = JSON.parse(saved.findings) as {
        findings: Finding[];
        reviewed: { template: string; summary: string }[];
      };
      expect(stored.findings.filter((f) => f.source === 'iris')).toHaveLength(
        3,
      );
      expect(stored.findings[0]).toEqual(
        expect.objectContaining({
          rule: 'visual:hierarchy',
          selector: 'h1',
          crop: 'site-review/review/mobile/section-0.mark-1.jpg',
        }),
      );
      expect(stored.reviewed.map((r) => r.template)).toEqual([
        '/section-0',
        '/section-1',
        '/section-2',
      ]);
      expect(saved.answer).toContain('Iris reviewed 3 page templates');
      expect(given.progress).toHaveBeenCalledWith(
        expect.stringContaining('Reviewed 3 of 3 templates'),
      );
    });

    it('asks before reviewing more than ten templates; "Only the 10 biggest" reviews ten', async () => {
      const given = reviewRuntime(12);
      const started = await start(given, { visualReview: true });
      expect(started.result.status).toBe('suspended');
      const asked = started.suspended[0] as {
        question: string;
        options: string[];
      };
      expect(asked.options).toEqual([
        'Review all 12 templates',
        'Only the 10 biggest templates',
        'Measured checks only',
      ]);
      expect(given.captureAndCheck).not.toHaveBeenCalled();
      const resumed = await drain(
        started.engineRun.resumeStream({
          step: started.result.suspended![0],
          resumeData: { answer: 'Only the 10 biggest templates' },
          requestContext: started.requestContext,
        }),
      );
      expect(resumed.result.status).toBe('success');
      const site = (
        given.captureAndCheck.mock.calls as unknown[][]
      )[0][0] as GroupedSite;
      expect(site.reviewTemplates).toHaveLength(10);
      expect(site.templates).toHaveLength(12);
      expect(given.reviewTemplate).toHaveBeenCalledTimes(10);
    });

    it('"Measured checks only" calls no model', async () => {
      const given = reviewRuntime(12);
      const started = await start(given, { visualReview: true });
      const resumed = await drain(
        started.engineRun.resumeStream({
          step: started.result.suspended![0],
          resumeData: { answer: 'Measured checks only' },
          requestContext: started.requestContext,
        }),
      );
      expect(resumed.result.status).toBe('success');
      expect(given.reviewTemplate).not.toHaveBeenCalled();
      const saved = (given.saveReport.mock.calls as unknown[][])[0][0] as {
        answer: string;
      };
      expect(saved.answer).toContain('measured checks only');
    });

    it('Visual review off: no template is planned and no model is called', async () => {
      const given = reviewRuntime(12);
      const { result } = await start(given, { visualReview: false });
      expect(result.status).toBe('success');
      const site = (
        given.captureAndCheck.mock.calls as unknown[][]
      )[0][0] as GroupedSite;
      expect(site.reviewTemplates).toEqual([]);
      expect(given.reviewTemplate).not.toHaveBeenCalled();
    });

    it('a stopped review ends the run early, nothing saved', async () => {
      const given = reviewRuntime(2, {
        reviewTemplate: jest.fn(() =>
          Promise.resolve({
            review: { findings: [], summary: '' },
            stopped: true,
          }),
        ),
      });
      const { events, result } = await start(given, { visualReview: true });
      expect(result.status).toBe('success');
      expect(events).toContain('review-templates:bailed');
      expect(given.saveReport).not.toHaveBeenCalled();
    });
  });
});
