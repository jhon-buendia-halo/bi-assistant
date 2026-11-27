// The real Mastra instance pulls in ESM-only packages Jest cannot require;
// the service only needs `listAgents()`, which the test passes in.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/evals/eval-sets', () => {
  const sets = [
    {
      id: 'world-cup',
      agentKey: 'insights-lead',
      name: 'World Cup',
      description: 'd',
      cases: [
        {
          id: 'champion-2022',
          question: 'q',
          intent: 'i',
          scorers: [
            { id: 'judge', name: 'Judge', description: 'Graded by Laura.' },
          ],
          // Elena's ported cases are scored by custom checks (ADR-0059).
          customChecks: [
            {
              id: 'answer-includes:Argentina',
              description: 'The answer includes "Argentina" (any case)',
            },
          ],
        },
      ],
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
    'insights-analyst': fakeAgent('insights-analyst'),
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
    // Alphabetical by persona name: David, Michael.
    expect(agents.map((agent) => agent.key)).toEqual([
      'sql-fixer',
      'insights-analyst',
    ]);
    expect(await service.get('rfp')).toBeNull();
    const michael = agents.find((agent) => agent.key === 'insights-analyst');
    expect(michael).toMatchObject({
      kind: 'official',
      datasets: [],
      missingDatasets: [],
    });
    expect(michael).not.toHaveProperty('chatRequirement');
  });

  it("lists each agent's own eval sets by agentKey (api.md 2.6 #35)", () => {
    const service = build();
    expect(service.evalSets('insights-lead').map((set) => set.id)).toEqual([
      'world-cup',
    ]);
    // Every check a case is scored on is listed: its scorers, then its
    // custom checks (Elena's ported sets have only the second).
    expect(service.evalSets('insights-lead')[0].cases[0].checks).toEqual([
      { id: 'judge', name: 'Judge', description: 'Graded by Laura.' },
      {
        id: 'answer-includes:Argentina',
        name: 'answer-includes:Argentina',
        description: 'The answer includes "Argentina" (any case)',
      },
    ]);
    expect(service.evalSets('query-explainer').map((set) => set.id)).toEqual([
      'explain-sql',
    ]);
    expect(service.evalSets('rfp')).toEqual([]);
    expect(service.evalSets('sql-fixer')).toEqual([]);
  });
});
