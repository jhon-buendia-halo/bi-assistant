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

import { EVAL_SETS, evalTargetFor } from './eval-sets';
import { selectCliEvalCases } from './eval-cli-selection';
import { IAR_CASES } from './insights-analyst-retail-reference';
import { INSIGHTS_ANALYST_RETAIL_EVAL_SET } from './insights-analyst-retail.evals';

const cases = INSIGHTS_ANALYST_RETAIL_EVAL_SET.cases;
const checkIds = (c: (typeof cases)[number]) =>
  (c.customChecks ?? []).map((k) => k.id);

describe('insights-analyst-retail set', () => {
  it('is registered and reached by the insights-analyst target', () => {
    expect(EVAL_SETS).toContain(INSIGHTS_ANALYST_RETAIL_EVAL_SET);
    expect(INSIGHTS_ANALYST_RETAIL_EVAL_SET).toMatchObject({
      id: 'insights-analyst-retail',
      name: 'Insights Analyst: Retail Ops',
      fixtureId: 'retail-ops',
      agentKey: 'insights-analyst',
    });
    expect(INSIGHTS_ANALYST_RETAIL_EVAL_SET.description).toMatch(
      /Load the "Retail Ops" sample in Settings → Testing Data\.$/,
    );
    const target = evalTargetFor(
      'insights-analyst',
      cases.map((c) => c.id),
    );
    expect(target.sets).toContain(INSIGHTS_ANALYST_RETAIL_EVAL_SET);
  });

  it('holds the 36 cases of IAR_CASES, no more and no fewer', () => {
    expect(cases).toHaveLength(36);
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(36);
    for (const id of ids) {
      expect(id.startsWith('iar-')).toBe(true);
      expect(IAR_CASES[id]).toBeDefined();
    }
    expect([...ids].sort()).toEqual(Object.keys(IAR_CASES).sort());
  });

  it('gives every case unique check ids', () => {
    for (const c of cases) {
      const ids = checkIds(c);
      expect({ id: c.id, unique: new Set(ids).size === ids.length }).toEqual({
        id: c.id,
        unique: true,
      });
    }
  });

  it('makes every answer case, and no other, check that it answered', () => {
    for (const c of cases) {
      const expected = IAR_CASES[c.id].expected;
      expect({
        id: c.id,
        has: checkIds(c).includes('answers-without-clarifying'),
      }).toEqual({
        id: c.id,
        has: expected === 'answer',
      });
    }
  });

  it('lets a coverage refusal rest on the catalog and end on a question', () => {
    const coverage = cases.filter(
      (c) => IAR_CASES[c.id].expected === 'not-covered',
    );
    expect(coverage).toHaveLength(3);
    for (const c of coverage) {
      expect(c.judgeRubric).toContain('needs no tool call');
      expect(c.judgeRubric).toContain(
        'Ending with a question that offers other measures is fine.',
      );
    }
  });

  it('makes every clarification case end on a question without a query', () => {
    const clarify = cases.filter(
      (c) => IAR_CASES[c.id].expected === 'clarification',
    );
    expect(clarify).toHaveLength(4);
    for (const c of clarify) {
      expect(checkIds(c)).toContain('ends-on-clarification');
      expect(c.scorers.map((s) => (s as { id?: string }).id)).toContain(
        'check-did-not-call',
      );
      expect(c.judgeRubric).toBeUndefined();
    }
  });

  it('grades only the 3 out-of-coverage cases with a judge, and no case with expectedSql', () => {
    const judged = cases.filter((c) => c.judgeRubric).map((c) => c.id);
    expect(judged.sort()).toEqual(
      Object.entries(IAR_CASES)
        .filter(([, c]) => c.expected === 'not-covered')
        .map(([id]) => id)
        .sort(),
    );
    expect(judged).toHaveLength(3);
    for (const c of cases) expect(c.expectedSql).toBeUndefined();
  });

  it('reads every truth check from the reference SQL of its case', () => {
    for (const c of cases) {
      if (IAR_CASES[c.id].expected !== 'answer') continue;
      const truths = checkIds(c).filter((k) => k.startsWith(c.id + '-'));
      if (c.id === 'iar-empty-loyalty-redemptions') continue;
      expect({ id: c.id, truths: truths.length > 0 }).toEqual({
        id: c.id,
        truths: true,
      });
    }
  });

  it('is picked by EVAL_SET=insights-analyst-retail', () => {
    const selection = selectCliEvalCases(
      { EVAL_SET: 'insights-analyst-retail' },
      EVAL_SETS,
    );
    expect(selection).toMatchObject({
      caseIds: cases.map((c) => c.id),
    });
  });
});
