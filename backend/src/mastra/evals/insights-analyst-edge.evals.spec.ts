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
  dataReadinessStepAgent: { id: 'data-readiness-step' },
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
  aggregatesNeverLists,
  answerKeepsTie,
  answerSaysNoRows,
  answerStatesEachCount,
  averageHandlesNonFinite,
  sqlUsesAny,
} from './insights-analyst-edge-checks';
import { INSIGHTS_ANALYST_EDGE_EVAL_SET } from './insights-analyst-edge.evals';

async function run(check: EvalCustomCheck, answer: string, sql: string[] = []) {
  return check.run({
    answer,
    toolCalls: sql.map((s) => ({
      name: 'run_readonly_sql',
      input: { sql: s },
      output: {},
      failed: false,
    })),
    datasets: ['Edge Cases'],
    vars: {},
  });
}

const ctx = (answer: string) =>
  ({ answer, parsed: undefined, details: undefined }) as never;

describe('insights-analyst-edge checks (story 1.28.6)', () => {
  it('answerKeepsTie wants the tie stated', async () => {
    expect(
      await run(answerKeepsTie(), 'Five products tie at 50,000,000.00 each.'),
    ).toBeUndefined();
    expect(
      await run(answerKeepsTie(), 'Product 5 ranks first with 50,000,000.00.'),
    ).toBeDefined();
  });

  it('answerSaysNoRows refuses an invented table', async () => {
    expect(
      await run(
        answerSaysNoRows('gift cards'),
        'No gift cards were issued: the table is empty.',
      ),
    ).toBeUndefined();
    expect(
      await run(
        answerSaysNoRows('gift cards'),
        '12 gift cards worth 1,200.00.',
      ),
    ).toBeDefined();
  });

  it('answerSaysNoRows accepts a summary table of zeros (1.28.8)', async () => {
    const summary =
      'No gift cards have been issued.\n\n| Measure | Result |\n|---|---|\n| Gift cards issued | 0 |\n| Total value | none |';
    expect(await run(answerSaysNoRows('gift cards'), summary)).toBeUndefined();
    const invented =
      'No gift cards.\n\n| Card | Value |\n|---|---|\n| GC-1 | 25.00 |';
    expect(await run(answerSaysNoRows('gift cards'), invented)).toBeDefined();
  });

  it('sqlUsesAny wants the quoted name in a query', async () => {
    const check = sqlUsesAny(['"legacyorders"'], 'legacy');
    expect(
      await run(check, 'x', ['SELECT count(*) FROM edge_cases."LegacyOrders"']),
    ).toBeUndefined();
    expect(
      await run(check, 'x', ['SELECT count(*) FROM edge_cases.legacyorders']),
    ).toBeDefined();
  });

  it('aggregatesNeverLists refuses a long table', async () => {
    const table = [
      '| id |',
      '|---|',
      ...Array.from({ length: 20 }, (_, i) => `| ${i} |`),
    ].join('\n');
    expect(
      await run(aggregatesNeverLists(), 'There are 1,000,000 order lines.', [
        'SELECT count(*) FROM edge_cases.order_lines',
      ]),
    ).toBeUndefined();
    expect(await run(aggregatesNeverLists(), table)).toBeDefined();
  });

  it('answerStatesEachCount and averageHandlesNonFinite compare with the SQL rows', () => {
    const counts = answerStatesEachCount('status', 'orders');
    const rows = [
      { status: 'cancelled', orders: 37712 },
      { status: 'paid', orders: 37544 },
    ];
    expect(
      counts(rows, ctx('cancelled: 37,712; paid: 37,544')),
    ).toBeUndefined();
    expect(counts(rows, ctx('cancelled: 37,000; paid: 37,544'))).toBeDefined();
    const avg = averageHandlesNonFinite('avg');
    expect(
      avg(
        [{ avg: 25.18 }],
        ctx('The average is 25.18 kg; 5 NaN weights were excluded.'),
      ),
    ).toBeUndefined();
    expect(avg([{ avg: 25.18 }], ctx('The average is NaN.'))).toBeDefined();
  });
});

describe('insights-analyst-edge set', () => {
  it('runs on the insights-analyst whole-workflow target, on Edge Cases', () => {
    expect(EVAL_SETS).toContain(INSIGHTS_ANALYST_EDGE_EVAL_SET);
    const ids = INSIGHTS_ANALYST_EDGE_EVAL_SET.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of INSIGHTS_ANALYST_EDGE_EVAL_SET.cases) {
      const checkIds = (c.customChecks ?? []).map((k) => k.id);
      expect(new Set(checkIds).size).toBe(checkIds.length);
    }
    const target = evalTargetFor('insights-analyst', ids);
    expect(target.sets).toContain(INSIGHTS_ANALYST_EDGE_EVAL_SET);
  });
});
