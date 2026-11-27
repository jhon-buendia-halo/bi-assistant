// The cases' scorers are built at import; they never run here.
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));
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

import type { Agent } from '@mastra/core/agent';
import { agentForCases, EVAL_SETS, evalTargetFor } from './eval-sets';
import {
  explorerInputOfWords,
  RESULT_EXPLORER_CASES,
  RESULT_EXPLORER_EDGE_CASES,
  RESULT_EXPLORER_EDGE_EVAL_SET,
  RESULT_EXPLORER_EVAL_SET,
  resultExplorerEvalTarget,
} from './result-explorer.evals';
import { explorerTurnAgent } from './result-explorer-eval-target';

describe('result-explorer eval set (agents.md 8.1, 2.17)', () => {
  it('has 13 cases with unique ids, across every set too', () => {
    expect(RESULT_EXPLORER_EVAL_SET.cases).toHaveLength(13);
    const ids = EVAL_SETS.flatMap((s) => s.cases.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    const words = RESULT_EXPLORER_CASES.map((c) => c.words);
    expect(new Set(words).size).toBe(words.length);
  });

  it('runs on result-explorer over the World Cup fixture', () => {
    expect(RESULT_EXPLORER_EVAL_SET.agentKey).toBe('result-explorer');
    expect(RESULT_EXPLORER_EVAL_SET.fixtureId).toBe('world-cup');
    expect(agentForCases(['re-next-page'])).toEqual({
      agentKey: 'result-explorer',
    });
    expect(evalTargetFor('result-explorer').agentKey).toBe('result-explorer');
  });

  it('has an Edge Cases set on the same target, its words distinct (story 1.29.6)', () => {
    expect(RESULT_EXPLORER_EDGE_EVAL_SET).toMatchObject({
      fixtureId: 'edge-cases',
      agentKey: 'result-explorer',
    });
    expect(EVAL_SETS).toContain(RESULT_EXPLORER_EDGE_EVAL_SET);
    const words = [...RESULT_EXPLORER_CASES, ...RESULT_EXPLORER_EDGE_CASES].map(
      (c) => c.words,
    );
    expect(new Set(words).size).toBe(words.length);
    expect(explorerInputOfWords('descuento mayor a 10')).toBeDefined();
    expect(resultExplorerEvalTarget().sets).toContain(
      RESULT_EXPLORER_EDGE_EVAL_SET,
    );
  });

  it('every expected column exists in the candidate the case expects', () => {
    for (const c of [...RESULT_EXPLORER_CASES, ...RESULT_EXPLORER_EDGE_CASES]) {
      const names = c.candidates[c.expect.query].columns.map((x) => x.name);
      const columns = [
        ...c.expect.filters.flat().map((f) => f.column),
        ...c.expect.sort.map((s) => s.column),
      ];
      for (const column of columns) expect(names).toContain(column);
    }
  });

  it('every expected text value is stored in its column, as spelled', () => {
    const brazil = RESULT_EXPLORER_CASES.find((c) => c.id === 're-only-brazil');
    const country = brazil?.candidates[0].columns.find(
      (x) => x.name === 'country',
    );
    expect(country?.values).toContain('Brazil');
  });

  it('every case has the checks its expectation needs', () => {
    for (const c of RESULT_EXPLORER_EVAL_SET.cases) {
      const ids = (c.customChecks ?? []).map((x) => x.id);
      expect(ids).toEqual(
        expect.arrayContaining(['reply-is-a-view', 'filters', 'sort', 'page']),
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('the target runs one interpretation of the case the words belong to', async () => {
    const interpret = jest.fn().mockResolvedValue({
      action: 'explore',
      query: 0,
      interpretation: { request: { page: 2 }, understood: 'page 2' },
    });
    const target = resultExplorerEvalTarget(
      () => ({ id: 'result-explorer' }) as unknown as Agent,
      interpret,
    );
    const result = await (
      target.runTarget as unknown as {
        generate(input: unknown): Promise<{ text: string }>;
      }
    ).generate('next page');
    expect(JSON.parse(result.text)).toMatchObject({
      action: 'explore',
      page: 2,
    });
    expect(interpret).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'next page', pageCount: 3 }),
    );
    await expect(
      (
        explorerTurnAgent(
          {} as Agent,
          interpret,
          explorerInputOfWords,
        ) as unknown as { generate(i: unknown): Promise<unknown> }
      ).generate('no such case'),
    ).rejects.toThrow(/No result-explorer case/);
  });
});
