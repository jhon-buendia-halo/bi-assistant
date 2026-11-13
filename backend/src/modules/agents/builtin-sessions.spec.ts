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
      id: 'data-readiness',
      agentKey: 'data-readiness',
      name: 'Data Readiness',
      description: 'd',
      cases: [{ id: 'dr-first', question: 'q', intent: 'i', scorers: [] }],
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
  BUILTIN_AGENT_SESSIONS,
  builtinAgentSession,
  builtinSessionDatasets,
  canStartBuiltinSession,
  PICKED_DATASETS_AGENT_KEYS,
  runsOnPickedDatasets,
} from './builtin-sessions';

const READINESS_REQUIREMENT = 'Add a PostgreSQL or Databricks dataset first';
const READINESS_STARTERS = [
  'Assess the readiness of this dataset',
  'What are the worst data-quality problems?',
  'Show my past assessments',
];

function fakeAgent(name: string) {
  return {
    id: name,
    name,
    getDescription: () => `${name} description`,
    listTools: () => ({}),
  };
}

type Kind = 'postgres' | 'databricks' | 'rest';

function build(
  datasets: string[],
  kinds: { name: string; datasourceKind?: Kind }[] = [],
  pins: string[] = [],
) {
  const registry = {
    assistant: fakeAgent('assistant'),
    'data-readiness': fakeAgent('Data Readiness Agent'),
    'sql-fixer': fakeAgent('sql-fixer'),
  };
  const userAgents = {
    builtinPins: jest.fn().mockResolvedValue(pins),
    get: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    datasetNames: jest.fn().mockResolvedValue(new Set(datasets)),
    datasetKinds: jest.fn().mockResolvedValue(kinds),
    skillsById: jest.fn().mockResolvedValue(new Map()),
  } as unknown as UserAgentsService;
  const mastra = { listAgents: () => registry } as unknown as MastraService;
  return new AgentsService(mastra, userAgents);
}

describe('built-in agents with sessions of their own (ADR-0028)', () => {
  it('declares the Data Readiness Agent only (the RFP Builder was removed)', () => {
    expect(Object.keys(BUILTIN_AGENT_SESSIONS)).toEqual(['data-readiness']);
    expect(builtinAgentSession('data-readiness')).toEqual({
      datasourceKinds: ['postgres', 'databricks'],
      sessionName: 'Data Readiness',
      requirement: READINESS_REQUIREMENT,
      starterQuestions: READINESS_STARTERS,
    });
    expect(builtinAgentSession('rfp')).toBeUndefined();
    expect(builtinAgentSession('assistant')).toBeUndefined();
    expect(builtinAgentSession('toString')).toBeUndefined();
    // Questions to Insights v2 declares no dataset: it runs on picked ones.
    expect(builtinAgentSession('assistant-v2')).toBeUndefined();
  });

  it('runs Questions to Insights v2 sessions on picked datasets, and only it (BA-320)', () => {
    expect(PICKED_DATASETS_AGENT_KEYS).toEqual(['assistant-v2']);
    expect(runsOnPickedDatasets('assistant-v2')).toBe(true);
    for (const key of ['assistant', 'data-readiness', 'user-1']) {
      expect(runsOnPickedDatasets(key)).toBe(false);
    }
  });

  it('does not list the removed RFP Builder, even with a pin saved for it', async () => {
    const service = build([], [], ['rfp']);
    const agents = await service.list();
    // Alphabetical by persona name: David, Emily, Sarah.
    expect(agents.map((agent) => agent.key)).toEqual([
      'sql-fixer',
      'assistant',
      'data-readiness',
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

  it('resolves a named declaration: listed, and missing until it exists', () => {
    const session = {
      datasetName: 'Orders',
      requirement: 'Load Orders first',
      starterQuestions: [],
    };
    const missing = builtinSessionDatasets(session, [{ name: 'Other' }]);
    expect(missing).toEqual({ datasets: ['Orders'], missing: ['Orders'] });
    expect(canStartBuiltinSession(missing)).toBe(false);
    const found = builtinSessionDatasets(session, [{ name: 'Orders' }]);
    expect(found).toEqual({ datasets: ['Orders'], missing: [] });
    expect(canStartBuiltinSession(found)).toBe(true);
  });

  it('resolves a kind declaration to every matching dataset, by name', () => {
    const session = builtinAgentSession('data-readiness')!;
    const declared = builtinSessionDatasets(session, [
      { name: 'Zeta', datasourceKind: 'databricks' },
      { name: 'Orders API', datasourceKind: 'rest' },
      { name: 'Legacy' },
      { name: 'Alpha', datasourceKind: 'postgres' },
    ]);
    expect(declared).toEqual({ datasets: ['Alpha', 'Zeta'], missing: [] });
    expect(canStartBuiltinSession(declared)).toBe(true);
    expect(
      canStartBuiltinSession(
        builtinSessionDatasets(session, [
          { name: 'x', datasourceKind: 'rest' },
        ]),
      ),
    ).toBe(false);
  });

  it('shows the Data Readiness Agent as Official, with no dataset and no requirement without a PostgreSQL or Databricks dataset (api.md 2.6 #33)', async () => {
    const agents = await build(
      ['Orders API'],
      [{ name: 'Orders API', datasourceKind: 'rest' }],
    ).list();
    const readiness = agents.find((agent) => agent.key === 'data-readiness');
    expect(readiness).toMatchObject({
      name: 'Sarah',
      role: 'Data Quality Analyst',
      kind: 'official',
      owner: 'Official',
      status: 'builtin',
      datasets: [],
      missingDatasets: [],
      starterQuestions: READINESS_STARTERS,
    });
    // Agents are a library since 1.23.35: no Run, so no run requirement.
    expect(readiness).not.toHaveProperty('chatRequirement');
  });

  it('lists the qualifying datasets once one exists', async () => {
    const readiness = (
      await build(
        ['World Cup', 'Sales'],
        [
          { name: 'World Cup', datasourceKind: 'postgres' },
          { name: 'Sales', datasourceKind: 'databricks' },
        ],
      ).list()
    ).find((agent) => agent.key === 'data-readiness');
    expect(readiness).toMatchObject({
      datasets: ['Sales', 'World Cup'],
      missingDatasets: [],
    });
    expect(readiness).not.toHaveProperty('chatRequirement');
  });

  it("lists each agent's own eval sets by agentKey (api.md 2.6 #35)", () => {
    const service = build([]);
    expect(service.evalSets('assistant').map((set) => set.id)).toEqual([
      'world-cup',
    ]);
    expect(service.evalSets('data-readiness').map((set) => set.id)).toEqual([
      'data-readiness',
    ]);
    expect(service.evalSets('rfp')).toEqual([]);
    expect(service.evalSets('sql-fixer')).toEqual([]);
  });
});
