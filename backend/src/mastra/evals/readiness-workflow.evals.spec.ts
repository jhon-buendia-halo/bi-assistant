// The registry imports every agent: stand them in (as eval-sets.spec.ts does).
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy(
    {},
    {
      get: (_target, kind: string) => () => ({
        id: `check-${kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
      }),
    },
  ),
}));
jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));
jest.mock('../agents/assistant.agent', () => ({ assistantAgent: {} }));
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
jest.mock('../agents/result-explorer.agent', () => ({
  resultExplorerAgent: { id: 'result-explorer' },
  interpretResultWithModel: jest.fn(),
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

import type { EvalCustomCheck } from './assistant.evals';
import { EVAL_SETS, evalTargetFor } from './eval-sets';
import {
  answerStates,
  completenessTotalEqualsReport,
  namesPlantedFinding,
  noMoneyAmount,
  numbersFromReport,
  quotesReportScoreAndMaturity,
} from './readiness-workflow-eval-checks';
import { READINESS_WORKFLOW_EVAL_SET } from './readiness-workflow.evals';

type Ctx = Parameters<EvalCustomCheck['run']>[0];

const REPORT = {
  overallScore: 90,
  maturity: 'Managed',
  dimensionScores: [
    { dimension: 'completeness', score: 86, findingCount: 41 },
    { dimension: 'integrity', score: 90, findingCount: 3 },
  ],
  topFindings: [
    { entity: 'order_lines', field: 'order_id', measured: '20 orphan row(s)' },
  ],
  orphans: 20,
};

function ctx(answer: string, extra: Partial<Ctx> = {}): Ctx {
  return {
    answer,
    toolCalls: [],
    datasets: ['Edge Cases'],
    vars: {},
    details: { report: REPORT },
    ...extra,
  };
}

async function verdict(check: EvalCustomCheck, c: Ctx) {
  return check.run(c);
}

describe('readiness-workflow checks (story 1.29.7)', () => {
  it('quotesReportScoreAndMaturity wants the saved score and band', async () => {
    const check = quotesReportScoreAndMaturity();
    expect(
      await verdict(check, ctx('Overall 90, band Managed.')),
    ).toBeUndefined();
    expect(await verdict(check, ctx('Overall 88, band Managed.'))).toMatch(
      /90/,
    );
  });

  it('completenessTotalEqualsReport wants the pages and the answer at the report count', async () => {
    const check = completenessTotalEqualsReport();
    const pages = [
      {
        name: 'get_readiness_report',
        input: { dimension: 'completeness', page: 1 },
        output: {
          findings: {
            dimension: 'completeness',
            total: 41,
            page: 1,
            pageCount: 1,
            pageSize: 50,
            items: [],
          },
        },
        failed: false,
      },
    ];
    expect(
      await verdict(
        check,
        ctx('There are 41 completeness findings.', {
          toolCalls: pages,
        }),
      ),
    ).toBeUndefined();
    expect(
      await verdict(
        check,
        ctx('There are 40 completeness findings.', {
          toolCalls: pages,
        }),
      ),
    ).toMatch(/41/);
  });

  // Explain report's prompt carries the summary (data-readiness R4): with no
  // get_readiness_report call, the counts of its complete topFindings list
  // still ground the answer, and a number it does not hold still fails.
  it('numbersFromReport reads the summary the prompt carried, without a get_readiness_report call', async () => {
    const check = numbersFromReport();
    const summary = {
      overallScore: 90,
      maturity: 'Managed',
      findingCount: 4,
      topFindings: [
        { dimension: 'integrity', severity: 'high', measured: 11 },
        { dimension: 'integrity', severity: 'high', measured: 12 },
        { dimension: 'integrity', severity: 'high', measured: 13 },
        { dimension: 'completeness', severity: 'low', measured: 0.3 },
      ],
    };
    const details = { report: summary };
    expect(
      await verdict(
        check,
        ctx('Overall 90 (Managed): 3 integrity findings are high.', {
          details,
        }),
      ),
    ).toBeUndefined();
    expect(
      await verdict(
        check,
        ctx('Overall 90 (Managed): 6 integrity findings are high.', {
          details,
        }),
      ),
    ).toMatch(/6 in/);
  });

  it('namesPlantedFinding wants the table and a count the report holds', async () => {
    const check = namesPlantedFinding('order_lines', 20);
    expect(
      await verdict(check, ctx('order_lines has 20 orphan rows.')),
    ).toBeUndefined();
    expect(await verdict(check, ctx('orders has 20 orphan rows.'))).toMatch(
      /order_lines/,
    );
  });

  it('answerStates and noMoneyAmount', async () => {
    const stale = answerStates(
      ['LegacyOrders', '2015'],
      'names LegacyOrders and its 2015',
    );
    expect(
      await verdict(
        stale,
        ctx('LegacyOrders is stale: newest row 2015-02-19.'),
      ),
    ).toBeUndefined();
    expect(await verdict(stale, ctx('Overall 90, Managed.'))).toMatch(
      /LegacyOrders/,
    );
    const money = noMoneyAmount();
    expect(
      await verdict(
        money,
        ctx('Questions to Insights answers revenue questions.'),
      ),
    ).toBeUndefined();
    expect(await verdict(money, ctx('Revenue is $1,234,567.'))).toBeDefined();
  });
});

describe('readiness-workflow set', () => {
  it('runs the whole workflow on Edge Cases under Sarah, with unique case ids', () => {
    expect(EVAL_SETS).toContain(READINESS_WORKFLOW_EVAL_SET);
    expect(READINESS_WORKFLOW_EVAL_SET).toMatchObject({
      id: 'readiness-workflow',
      fixtureId: 'edge-cases',
      agentKey: 'data-readiness',
      target: 'data-readiness:assessment-workflow',
    });
    const ids = READINESS_WORKFLOW_EVAL_SET.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('rw-'))).toBe(true);
    expect(evalTargetFor('data-readiness', ids).agentKey).toBe(
      'data-readiness',
    );
  });

  // data-readiness R4: Explain report's prompt carries the summary, so no
  // case requires a call to read it; only the drill-down into every
  // completeness finding still names get_readiness_report.
  it('requires no get_readiness_report call to read the summary', () => {
    for (const evalCase of READINESS_WORKFLOW_EVAL_SET.cases) {
      const ids = (evalCase.scorers ?? []).map(
        (scorer) => (scorer as { id?: string }).id,
      );
      expect(ids).not.toContain('check-called-tool');
    }
    const drillDown = READINESS_WORKFLOW_EVAL_SET.cases
      .filter((c) =>
        (c.customChecks ?? []).some((check) =>
          check.description.includes('get_readiness_report'),
        ),
      )
      .map((c) => c.id);
    expect(drillDown).toEqual(['rw-all-completeness-issues']);
  });
});
