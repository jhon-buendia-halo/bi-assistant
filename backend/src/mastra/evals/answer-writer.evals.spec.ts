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
  answerParses,
  figuresFromRows,
  neverSays,
  says,
} from './answer-writer-eval-checks';
import { ANSWER_WRITER_EVAL_SET } from './answer-writer.evals';

const written = (headline: string, answer = headline) =>
  JSON.stringify({ headline, answer });

async function run(check: EvalCustomCheck, answer: string) {
  return check.run({
    answer,
    toolCalls: [],
    datasets: ['Edge Cases'],
    vars: {},
  });
}

describe('answer-writer checks (story 1.28.3)', () => {
  it('answerParses refuses prose', async () => {
    expect(
      await run(answerParses(), written('37,712 orders were cancelled.')),
    ).toBeUndefined();
    expect(await run(answerParses(), 'There were 37,712.')).toBeDefined();
  });

  it('figuresFromRows accepts figures of the rows, rounded as written, and refuses others', async () => {
    const rows = [{ status: 'cancelled', orders: 37712 }, { avg: 25.175 }];
    const check = figuresFromRows(rows, [300000]);
    expect(
      await run(
        check,
        written(
          '37,712 of 300,000 orders were cancelled; the average is 25.18 kg.',
        ),
      ),
    ).toBeUndefined();
    expect(
      await run(check, written('About 38,000 orders were cancelled.')),
    ).toMatch(/38,000/);
    // Small whole numbers (ranks, list counts) pass.
    expect(await run(check, written('The top 5 statuses.'))).toBeUndefined();
  });

  it('says and neverSays', async () => {
    const tie = says(/\btie/i, 'says they tie', 'says-tie');
    expect(
      await run(tie, written('Five products tie at 50,000,000.00.')),
    ).toBeUndefined();
    expect(await run(tie, written('Product 5 ranks first.'))).toBeDefined();
    const nan = neverSays(/\bNaN\b/, 'gives NaN', 'no-nan');
    expect(
      await run(nan, written('The average is 25.175 kg.')),
    ).toBeUndefined();
    expect(await run(nan, written('The average is NaN.'))).toBeDefined();
  });
});

describe('answer-writer set', () => {
  it('runs Jessica alone on Edge Cases rows, every case with checks and a frozen input', () => {
    expect(EVAL_SETS).toContain(ANSWER_WRITER_EVAL_SET);
    expect(ANSWER_WRITER_EVAL_SET).toMatchObject({
      id: 'answer-writer',
      fixtureId: 'edge-cases',
      agentKey: 'answer-writer',
    });
    const ids = ANSWER_WRITER_EVAL_SET.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ANSWER_WRITER_EVAL_SET.cases) {
      expect(c.id.startsWith('aw-')).toBe(true);
      const ids2 = (c.customChecks ?? []).map((k) => k.id);
      expect(new Set(ids2).size).toBe(ids2.length);
      expect(
        (c.input as { queries: unknown[] }).queries.length,
      ).toBeGreaterThan(0);
    }
    expect(evalTargetFor('answer-writer').agentKey).toBe('answer-writer');
  });
});
