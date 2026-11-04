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
      id: 'rfp',
      agentKey: 'rfp',
      name: 'RFP Builder',
      description: 'd',
      cases: [
        { id: 'rfp-skill-first', question: 'q', intent: 'i', scorers: [] },
      ],
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
) {
  const registry = {
    assistant: fakeAgent('assistant'),
    rfp: fakeAgent('RFP Builder'),
    'data-readiness': fakeAgent('Data Readiness Agent'),
    'sql-fixer': fakeAgent('sql-fixer'),
  };
  const userAgents = {
    builtinPins: jest.fn().mockResolvedValue([]),
    list: jest.fn().mockResolvedValue([]),
    datasetNames: jest.fn().mockResolvedValue(new Set(datasets)),
    datasetKinds: jest.fn().mockResolvedValue(kinds),
    skillsById: jest.fn().mockResolvedValue(new Map()),
  } as unknown as UserAgentsService;
  const mastra = { listAgents: () => registry } as unknown as MastraService;
  return new AgentsService(mastra, userAgents);
}

describe('built-in agents with sessions of their own (ADR-0028)', () => {
  it('declares the RFP Builder and the Data Readiness Agent', () => {
    expect(Object.keys(BUILTIN_AGENT_SESSIONS)).toEqual([
      'rfp',
      'data-readiness',
    ]);
    expect(builtinAgentSession('data-readiness')).toEqual({
      datasourceKinds: ['postgres', 'databricks'],
      sessionName: 'Data Readiness',
      requirement: READINESS_REQUIREMENT,
      starterQuestions: READINESS_STARTERS,
    });
    expect(builtinAgentSession('rfp')).toEqual({
      datasetName: 'Intellify RFP API',
      requirement:
        'Load the "Intellify RFP API" sample in Settings → Testing Data first',
      starterQuestions: [
        'Start an RFP for a client',
        'Which of my clients renew on 1 January 2027?',
        'Resume my draft RFPs',
      ],
    });
    expect(builtinAgentSession('assistant')).toBeUndefined();
    expect(builtinAgentSession('toString')).toBeUndefined();
  });

  it('shows the RFP Builder as Official with its dataset and the chat requirement while it is missing (api.md 2.6 #33)', async () => {
    const agents = await build([]).list();
    const rfp = agents.find((agent) => agent.key === 'rfp');
    expect(rfp).toMatchObject({
      name: 'RFP Builder',
      kind: 'official',
      owner: 'Official',
      status: 'builtin',
      datasets: ['Intellify RFP API'],
      missingDatasets: ['Intellify RFP API'],
      starterQuestions: [],
      chatRequirement:
        'Load the "Intellify RFP API" sample in Settings → Testing Data first',
    });
    const assistant = agents.find((agent) => agent.key === 'assistant');
    expect(assistant).toMatchObject({
      kind: 'official',
      datasets: [],
      missingDatasets: [],
    });
    expect(assistant).not.toHaveProperty('chatRequirement');
    expect(agents.find((agent) => agent.key === 'sql-fixer')).toMatchObject({
      kind: 'system',
      owner: 'System',
    });
  });

  it('drops the requirement once the dataset exists', async () => {
    const rfp = (await build(['Intellify RFP API']).list()).find(
      (agent) => agent.key === 'rfp',
    );
    expect(rfp).toMatchObject({
      datasets: ['Intellify RFP API'],
      missingDatasets: [],
    });
    expect(rfp).not.toHaveProperty('chatRequirement');
  });

  it('resolves a kind declaration to every matching dataset, by name', () => {
    const session = builtinAgentSession('data-readiness')!;
    const declared = builtinSessionDatasets(session, [
      { name: 'Zeta', datasourceKind: 'databricks' },
      { name: 'Intellify RFP API', datasourceKind: 'rest' },
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

  it('shows the Data Readiness Agent as Official, blocked without a PostgreSQL or Databricks dataset (api.md 2.6 #33)', async () => {
    const agents = await build(
      ['Intellify RFP API'],
      [{ name: 'Intellify RFP API', datasourceKind: 'rest' }],
    ).list();
    const readiness = agents.find((agent) => agent.key === 'data-readiness');
    expect(readiness).toMatchObject({
      name: 'Data Readiness Agent',
      kind: 'official',
      owner: 'Official',
      status: 'builtin',
      datasets: [],
      missingDatasets: [],
      starterQuestions: READINESS_STARTERS,
      chatRequirement: READINESS_REQUIREMENT,
    });
  });

  it('lists the qualifying datasets and drops the requirement once one exists', async () => {
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
    expect(service.evalSets('rfp').map((set) => set.id)).toEqual(['rfp']);
    expect(service.evalSets('sql-fixer')).toEqual([]);
  });
});
