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
  edgeCasesPlannerCatalog,
  edgeEntityKey,
} from './analysis-planner-edge-catalog';
import {
  assumesMayBeEmpty,
  clarificationDecision,
  entitiesInCatalog,
  namesSpelledExactly,
  noInvented,
  planParses,
  readsTables,
  statesGap,
} from './analysis-planner-eval-checks';
import { ANALYSIS_PLANNER_EVAL_SET } from './analysis-planner.evals';

const CATALOG = edgeCasesPlannerCatalog();

function plan(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    question: 'How many orders were cancelled in 2024?',
    measures: ['count of orders with status cancelled'],
    entities: [edgeEntityKey('orders')],
    scope: 'Orders placed in 2024',
    assumptions: ['customers.fax may be empty'],
    needsClarification: false,
    clarification: null,
    ...patch,
  });
}

async function run(check: EvalCustomCheck, answer: string) {
  return check.run({
    answer,
    toolCalls: [],
    datasets: ['Edge Cases'],
    vars: {},
  });
}

describe('analysis-planner checks (story 1.29.2)', () => {
  it('planParses refuses prose and accepts a plan', async () => {
    expect(await run(planParses(), plan())).toBeUndefined();
    expect(await run(planParses(), 'I would count the orders.')).toBeDefined();
  });

  it('clarificationDecision wants a question with options, or none', async () => {
    const asks = plan({
      needsClarification: true,
      clarification: {
        question: 'Best by what?',
        options: ['Revenue', 'Orders'],
      },
    });
    expect(await run(clarificationDecision(true), asks)).toBeUndefined();
    expect(await run(clarificationDecision(true), plan())).toBeDefined();
    expect(await run(clarificationDecision(false), plan())).toBeUndefined();
    expect(await run(clarificationDecision(false), asks)).toBeDefined();
  });

  it('entitiesInCatalog and readsTables refuse an invented entity', async () => {
    expect(await run(entitiesInCatalog(CATALOG), plan())).toBeUndefined();
    expect(
      await run(
        entitiesInCatalog(CATALOG),
        plan({ entities: ['edge_cases.edge_cases.suppliers'] }),
      ),
    ).toBeDefined();
    expect(await run(readsTables(['orders']), plan())).toBeUndefined();
    expect(await run(readsTables(['LegacyOrders']), plan())).toBeDefined();
  });

  it('noInvented and statesGap on a measure the data lacks', async () => {
    const honest = plan({
      measures: ['margin'],
      assumptions: ['There is no supplier in the data'],
    });
    const invented = plan({
      measures: ['margin by supplier'],
      entities: ['edge_cases.edge_cases.suppliers'],
    });
    expect(
      await run(noInvented(/supplier/i, 'a supplier'), honest),
    ).toBeUndefined();
    expect(
      await run(noInvented(/supplier/i, 'a supplier'), invented),
    ).toBeDefined();
    expect(
      await run(statesGap(/supplier/i, 'no supplier'), honest),
    ).toBeUndefined();
    expect(
      await run(statesGap(/supplier/i, 'no supplier'), plan()),
    ).toBeDefined();
  });

  it('namesSpelledExactly refuses a mangled name', async () => {
    const check = namesSpelledExactly(['Order Notes'], [/order_notes/i]);
    expect(
      await run(check, plan({ measures: ['orders with "Order Notes"'] })),
    ).toBeUndefined();
    expect(
      await run(check, plan({ measures: ['orders with order_notes'] })),
    ).toBeDefined();
  });

  it('assumesMayBeEmpty wants the column named as possibly empty', async () => {
    expect(await run(assumesMayBeEmpty('fax'), plan())).toBeUndefined();
    expect(
      await run(assumesMayBeEmpty('fax'), plan({ assumptions: [] })),
    ).toBeDefined();
  });
});

describe('analysis-planner set', () => {
  it('runs Olivia alone on Edge Cases, every case with checks and a frozen input', () => {
    expect(EVAL_SETS).toContain(ANALYSIS_PLANNER_EVAL_SET);
    expect(ANALYSIS_PLANNER_EVAL_SET).toMatchObject({
      id: 'analysis-planner',
      fixtureId: 'edge-cases',
      agentKey: 'analysis-planner',
    });
    const ids = ANALYSIS_PLANNER_EVAL_SET.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ANALYSIS_PLANNER_EVAL_SET.cases) {
      expect(c.id.startsWith('ap-')).toBe(true);
      expect(c.customChecks?.length).toBeGreaterThan(0);
      expect((c.input as { catalogBlock: string }).catalogBlock).toContain(
        'orders',
      );
    }
    expect(evalTargetFor('analysis-planner').agentKey).toBe('analysis-planner');
  });
});
