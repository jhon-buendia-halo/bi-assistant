// The real Mastra instance pulls in ESM-only packages Jest cannot require;
// the service only needs `listAgents()`, which the test passes in.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/evals/eval-sets', () => {
  const sets = [
    {
      id: 'world-cup',
      name: 'World Cup',
      description: 'd',
      cases: [{ id: 'champion-2022', question: 'q', intent: 'i', scorers: [] }],
    },
    {
      id: 'explain-sql',
      agentKey: 'query-explainer',
      name: 'Explain SQL',
      description: 'd',
      cases: [{ id: 'qe-first', question: 'q', intent: 'i', scorers: [] }],
    },
  ];
  return {
    evalSetsFor: (key: string) =>
      sets.filter((set) => (set.agentKey ?? 'assistant') === key),
  };
});
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));

import type { MastraService } from '../../mastra/mastra.service';
import type { UserAgentsService } from '../user-agents/user-agents.service';
import { AgentsService } from './agents.service';
import {
  PICKED_DATASETS_AGENT_KEYS,
  runsOnPickedDatasets,
} from './builtin-sessions';

function fakeAgent(name: string) {
  return {
    id: name,
    name,
    getDescription: () => `${name} description`,
    listTools: () => ({}),
  };
}

function build(pins: string[] = []) {
  const registry = {
    assistant: fakeAgent('assistant'),
    'sql-fixer': fakeAgent('sql-fixer'),
  };
  const userAgents = {
    builtinPins: jest.fn().mockResolvedValue(pins),
    get: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    datasetNames: jest.fn().mockResolvedValue(new Set()),
    datasetKinds: jest.fn().mockResolvedValue([]),
    skillsById: jest.fn().mockResolvedValue(new Map()),
  } as unknown as UserAgentsService;
  const mastra = { listAgents: () => registry } as unknown as MastraService;
  return new AgentsService(mastra, userAgents);
}

describe('built-in agents with sessions of their own (ADR-0028)', () => {
  it('runs Insights Analyst sessions on picked datasets, and only it (BA-320)', () => {
    expect(PICKED_DATASETS_AGENT_KEYS).toEqual(['insights-analyst']);
    expect(runsOnPickedDatasets('insights-analyst')).toBe(true);
    for (const key of ['assistant', 'data-readiness', 'user-1']) {
      expect(runsOnPickedDatasets(key)).toBe(false);
    }
  });

  it('does not list the removed RFP Builder, even with a pin saved for it', async () => {
    const service = build(['rfp']);
    const agents = await service.list();
    // Alphabetical by persona name: David, Emily.
    expect(agents.map((agent) => agent.key)).toEqual([
      'sql-fixer',
      'assistant',
    ]);
    expect(await service.get('rfp')).toBeNull();
    const assistant = agents.find((agent) => agent.key === 'assistant');
    expect(assistant).toMatchObject({
      kind: 'official',
      datasets: [],
      missingDatasets: [],
    });
    expect(assistant).not.toHaveProperty('chatRequirement');
  });

  it("lists each agent's own eval sets by agentKey (api.md 2.6 #35)", () => {
    const service = build();
    expect(service.evalSets('assistant').map((set) => set.id)).toEqual([
      'world-cup',
    ]);
    expect(service.evalSets('query-explainer').map((set) => set.id)).toEqual([
      'explain-sql',
    ]);
    expect(service.evalSets('rfp')).toEqual([]);
    expect(service.evalSets('sql-fixer')).toEqual([]);
  });
});
