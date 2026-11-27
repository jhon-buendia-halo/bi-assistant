// The sets' scorers are built at import and never run here. The stub gives
// each kind the id the real `checks` give it (`check-<kind in kebab case>`,
// so two of one kind in a case share an id), which the uniqueness test reads.
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
jest.mock('../../mastra/agents/insights-analyst.agent', () => ({
  insightsAnalystAgent: { id: 'insights-analyst' },
}));
jest.mock('../../mastra/agents/query-explainer.agent', () => ({
  queryExplainerAgent: { id: 'query-explainer' },
  explainQueryWithModel: jest.fn(),
}));
jest.mock('../../mastra/agents/result-explorer.agent', () => ({
  resultExplorerAgent: { id: 'result-explorer' },
  interpretResultWithModel: jest.fn(),
}));
jest.mock('../../mastra/agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../../mastra/model-resolver', () => ({
  resolveAgentModel: jest.fn(),
}));
jest.mock('../sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import { buildAgentQualityCatalogue } from './agent-quality.catalogue';

describe('buildAgentQualityCatalogue', () => {
  const catalogue = buildAgentQualityCatalogue();

  it('names every agent by its registry key, its Mastra agent id too', () => {
    expect(catalogue.find((a) => a.key === 'insights-lead')!.agentId).toBe(
      'insights-lead',
    );
    // The removed assistant's data sets run on Elena now.
    expect(catalogue.map((a) => a.key)).not.toContain('assistant');
    for (const agent of catalogue) expect(agent.agentId).toBe(agent.key);
    // The removed Data Readiness Agent has no evals left.
    expect(catalogue.map((a) => a.key)).not.toContain('data-readiness');
  });

  it('lists Dana with her set, so agent quality shows her eval runs', () => {
    const dana = catalogue.find((a) => a.key === 'data-readiness-assessor')!;
    expect(dana).toMatchObject({
      agentId: 'data-readiness-assessor',
      name: 'Dana',
      role: 'Data Readiness Assessor',
    });
    expect(dana.sets.map((s) => s.id)).toEqual(['data-readiness-assessor']);
    expect(dana.sets[0].caseIds).toContain('dra-null-customer-id');
  });

  it('has a persona and at least one set with cases for every agent', () => {
    expect(catalogue.length).toBeGreaterThan(3);
    for (const agent of catalogue) {
      expect(agent.name).not.toBe('');
      expect(agent.sets.length).toBeGreaterThan(0);
      expect(agent.sets.every((s) => s.caseIds.length > 0)).toBe(true);
    }
  });
});
