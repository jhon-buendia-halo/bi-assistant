jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));
// The cases' scorers are built at import; they never run here.
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/assistant.agent', () => ({
  assistantAgent: { id: 'assistant' },
}));
jest.mock('../agents/data-readiness.agent', () => ({
  dataReadinessAgent: { id: 'data-readiness' },
}));
jest.mock('../agents/insights-analyst.agent', () => ({
  insightsAnalystAgent: { id: 'insights-analyst' },
}));
jest.mock('../agents/query-explainer.agent', () => ({
  queryExplainerAgent: { id: 'query-explainer' },
  explainQueryWithModel: jest.fn(),
}));
jest.mock('../agents/site-reviewer.agent', () => ({
  siteReviewerAgent: { id: 'site-reviewer' },
}));
jest.mock('../workflows/review-website.agents', () => ({
  reviewTemplateWithModel: jest.fn(),
}));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import type { Agent } from '@mastra/core/agent';
import { agentForCases, evalTargetFor, EVAL_SETS, hasEvals } from './eval-sets';
import { selectCliEvalCases } from './eval-cli-selection';
import {
  planOfQuestion,
  SITE_REVIEWER_EVAL_SET,
  siteReviewerEvalTarget,
} from './site-reviewer.evals';
import {
  noBrowserMessage,
  reviewForEval,
  reviewerTurnAgent,
  type CapturedScreen,
  type CaptureScreens,
  type ReviewTemplate,
} from './site-reviewer-eval-target';
import * as pages from './site-reviewer-pages';

describe('site-reviewer eval set (agents.md 8.1, 2.16)', () => {
  const cases = SITE_REVIEWER_EVAL_SET.cases;

  it('runs on site-reviewer', () => {
    expect(SITE_REVIEWER_EVAL_SET.id).toBe('site-reviewer');
    expect(SITE_REVIEWER_EVAL_SET.agentKey).toBe('site-reviewer');
  });

  it('has the 5 cases with ids unique across every set', () => {
    expect(cases.map((c) => c.id)).toEqual([
      'inconsistent-buttons',
      'text-over-image',
      'misaligned-cards',
      'clean-page',
      'measured-not-repeated',
    ]);
    const ids = EVAL_SETS.flatMap((set) => set.cases.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds the shared checks, one expectation and one rubric per case', () => {
    for (const evalCase of cases) {
      const ids = (evalCase.customChecks ?? []).map((c) => c.id);
      expect(ids.slice(0, 3)).toEqual([
        'parses-as-review',
        'at-most-8-findings',
        'marks-exist',
      ]);
      expect(ids).toHaveLength(4);
      expect(evalCase.intent.trim()).not.toBe('');
      expect(evalCase.judgeRubric?.match(/Pass condition:/g)).toHaveLength(1);
    }
  });

  it('finds the page of each case by its question', () => {
    for (const evalCase of cases) {
      const plan = planOfQuestion(evalCase.question);
      expect(plan?.html).toMatch(/^<!doctype html>/);
      for (const selector of Object.values(plan?.planted ?? {})) {
        const id = selector.replace(/^#/, '');
        expect(plan?.html).toContain(`id="${id}"`);
      }
    }
    expect(planOfQuestion('Review nothing')).toBeUndefined();
  });

  it('keeps every page self-contained: no network', () => {
    for (const html of Object.values(pages)) {
      expect(html).not.toMatch(/(src|href)="https?:/);
      expect(html).not.toMatch(/@import|url\(http/);
    }
  });

  it('passes the broken image as measured on the last case only', () => {
    const measured = cases.map(
      (c) => planOfQuestion(c.question)?.measured?.selector,
    );
    expect(measured).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      '#team-photo',
    ]);
  });
});

describe('site-reviewer registration', () => {
  const ids = SITE_REVIEWER_EVAL_SET.cases.map((c) => c.id);

  it('lists the set under the site-reviewer agent only', () => {
    expect(hasEvals('site-reviewer')).toBe(true);
    expect(EVAL_SETS.filter((set) => set.agentKey === 'site-reviewer')).toEqual(
      [SITE_REVIEWER_EVAL_SET],
    );
  });

  it('selects the set by EVAL_SET=site-reviewer and names it in the errors', () => {
    expect(
      selectCliEvalCases({ EVAL_SET: 'site-reviewer' }, EVAL_SETS),
    ).toEqual({ caseIds: ids });
    expect(selectCliEvalCases({}, EVAL_SETS)).toEqual({
      error: expect.stringContaining('site-reviewer') as string,
    });
  });

  it('maps its cases to the site-reviewer agent and builds its target', () => {
    expect(agentForCases(ids)).toEqual({ agentKey: 'site-reviewer' });
    const target = evalTargetFor('site-reviewer');
    expect(target.agentKey).toBe('site-reviewer');
    expect(target.sets).toEqual([SITE_REVIEWER_EVAL_SET]);
    expect(target.sendsKnowledge).toBe(false);
    expect(target.orientation({} as never)).toBe('');
  });
});

function shot(
  screen: 'mobile' | 'laptop',
  planted: Record<string, number | null>,
): CapturedScreen {
  const image = { data: Buffer.from('x'), mediaType: 'image/jpeg' };
  return {
    screen,
    label: screen === 'mobile' ? 'Mobile' : 'Laptop',
    width: screen === 'mobile' ? 390 : 1440,
    clean: image,
    marked: image,
    marks: [
      {
        n: 1,
        selector: '#team-photo',
        tag: 'img',
        text: '',
        rect: { x: 0, y: 0, width: 10, height: 10 },
        crop: null,
      },
    ],
    planted,
  };
}

describe('site-reviewer eval target', () => {
  const plan = planOfQuestion(
    SITE_REVIEWER_EVAL_SET.cases[4].question,
  ) as NonNullable<ReturnType<typeof planOfQuestion>>;
  const capture: CaptureScreens = jest.fn(() =>
    Promise.resolve([
      shot('mobile', { photo: 1 }),
      shot('laptop', { photo: 1 }),
    ]),
  );

  it('asks Iris once with every screen, the measured finding on each, and answers with the marks', async () => {
    const review = jest.fn(() =>
      Promise.resolve({
        review: { findings: [], summary: 'Fine.' },
        stopped: false,
      }),
    ) as unknown as jest.MockedFunction<ReviewTemplate>;
    const answer = await reviewForEval({ plan, capture, review });
    expect(review).toHaveBeenCalledTimes(1);
    const [input] = review.mock.calls[0];
    expect(input.template.id).toBe('/case');
    expect(input.shots.map((s) => s.screen)).toEqual(['mobile', 'laptop']);
    expect(input.measured.map((f) => [f.screen, f.title, f.selector])).toEqual([
      ['mobile', 'Image does not load', '#team-photo'],
      ['laptop', 'Image does not load', '#team-photo'],
    ]);
    expect(answer.screens).toEqual([
      { screen: 'mobile', marks: [1], planted: { photo: 1 } },
      { screen: 'laptop', marks: [1], planted: { photo: 1 } },
    ]);
  });

  it('replaces generate with one reviewed page and fails an unknown question', async () => {
    const review = jest.fn(() =>
      Promise.resolve({
        review: { findings: [], summary: 'Fine.' },
        stopped: false,
      }),
    ) as unknown as ReviewTemplate;
    const agent = reviewerTurnAgent(
      { id: 'site-reviewer' } as unknown as Agent,
      planOfQuestion,
      capture,
      review,
    );
    const result = (await agent.generate(
      SITE_REVIEWER_EVAL_SET.cases[0].question,
    )) as unknown as { text: string };
    expect(JSON.parse(result.text)).toMatchObject({ summary: 'Fine.' });
    await expect(agent.generate('Review nothing')).rejects.toThrow(
      /No page for the question/,
    );
  });

  it('fails a run with a clear message when no browser launches', () => {
    expect(noBrowserMessage(new Error('no edge'))).toMatch(
      /need a browser and could not launch one \(no edge\)/,
    );
    const target = siteReviewerEvalTarget(
      () => ({ id: 'site-reviewer' }) as unknown as Agent,
    );
    expect(target.agentKey).toBe('site-reviewer');
  });
});
