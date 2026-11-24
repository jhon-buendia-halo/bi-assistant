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
// The check scorers are built when the sets load: a stand-in that never runs.
jest.mock('@mastra/core/evals', () => ({
  runEvals: jest.fn(),
  createScorer: (config: Record<string, unknown>) => {
    const scorer: Record<string, unknown> = { ...config };
    for (const step of ['analyze', 'generateScore', 'generateReason']) {
      scorer[step] = () => scorer;
    }
    return scorer;
  },
}));
jest.mock('../../mastra/agents/assistant.agent', () => ({
  assistantAgent: {},
}));
jest.mock('../../mastra/agents/data-readiness.agent', () => ({
  dataReadinessAgent: { id: 'data-readiness' },
}));
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

  it('maps data-readiness to its Mastra agent id', () => {
    const readiness = catalogue.find((a) => a.key === 'data-readiness')!;
    expect(readiness.agentId).toBe('data-readiness-agent');
    expect(catalogue.find((a) => a.key === 'assistant')!.agentId).toBe(
      'assistant',
    );
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
