// The data-readiness service loads the Databricks driver (ESM-only deps)
// at import time; the session specs never call it for real.
jest.mock('../data-readiness/data-readiness.service', () => ({
  DataReadinessService: class {},
}));

// Sessions bound to a workflow (ADR-0040; workflows R4; past-chats R65):
// every creation path stores the workflow its agent fields derive, `POST
// /sessions { workflowId }` resolves and refuses as api.md 3 says, and every
// view carries the derived `workflowRef`.
jest.mock('@mastra/core/request-context', () => ({
  RequestContext: class {
    private readonly values = new Map<string, unknown>();
    set = jest.fn((key: string, value: unknown) => {
      this.values.set(key, value);
    });
    get = jest.fn((key: string) => this.values.get(key));
  },
}));
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/model-resolver', () => ({
  AGENT_OVERRIDES_CONTEXT_KEY: 'agent-overrides',
  isCustomAnthropicConfig: () => false,
  resolveAgentModelConfig: jest.fn().mockResolvedValue('openai/gpt-4.1-mini'),
}));
jest.mock('../../mastra/tool-services', () => ({
  setDatasetToolServices: jest.fn(),
}));
jest.mock('../../mastra/tools/dataset.tools', () => ({
  DATASETS_CONTEXT_KEY: 'datasets',
}));
jest.mock('../../mastra/tools/visual.tools', () => ({
  ACTIVE_VISUAL_CONTEXT_KEY: 'active-visual-id',
  SESSION_ID_CONTEXT_KEY: 'session-id',
  TURN_QUESTION_CONTEXT_KEY: 'turn-question',
  TURN_RECORDS_CONTEXT_KEY: 'turn-data-records',
}));
jest.mock('../../mastra/session-workspaces', () => ({
  SESSION_WORKSPACE_CONTEXT_KEY: 'session-workspace-id',
}));
jest.mock('../datasets/repositories/datasets.repository', () => ({
  DatasetsRepository: class {},
}));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));
jest.mock('../verified-queries/verified-queries.service', () => ({
  VerifiedQueriesService: class {},
}));
jest.mock('../metrics/metrics.service', () => ({ MetricsService: class {} }));
jest.mock('../ontology/ontology.service', () => ({
  OntologyService: class {},
}));
jest.mock('../../mastra/agents/sql-fixer.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  return { sqlFixOutputSchema: z.object({ sql: z.string() }) };
});
jest.mock('../../mastra/agents/sql-verifier.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  return { sqlVerifyOutputSchema: z.object({ sql: z.string() }) };
});
jest.mock('./repositories/sessions.repository', () => ({
  SessionsRepository: class {},
}));
jest.mock('./visualization.service', () => ({
  VisualizationService: class {},
}));
jest.mock('../../common/markdown-pdf', () => ({ renderPdf: jest.fn() }));
jest.mock('./visualization-document', () => ({
  sourceEntities: jest.fn().mockReturnValue([]),
}));

import { SessionsService } from './sessions.service';
import type { SessionDoc } from './entities/session.entity';
import type { UserAgentDoc } from '../user-agents/entities/user-agent.entity';

const config = (name: string, datasets: string[] = ['World Cup']) => ({
  name,
  description: `${name} description`,
  instructions: 'Be brief.',
  datasets,
  starterQuestions: [],
});

const LIVE: UserAgentDoc = {
  id: 'u-live',
  draft: config('Historian draft'),
  live: config('Historian'),
} as unknown as UserAgentDoc;
const DRAFT_ONLY: UserAgentDoc = {
  id: 'u-draft',
  draft: config('Sketch'),
} as unknown as UserAgentDoc;

function build() {
  const stored = new Map<string, SessionDoc>();
  const repository = {
    insert: jest.fn().mockImplementation((doc: SessionDoc) => {
      stored.set(doc.id, doc);
      return Promise.resolve(doc);
    }),
    get: jest.fn((id: string) => Promise.resolve(stored.get(id) ?? null)),
    update: jest.fn(),
  };
  const agent = (name: string) => ({
    name,
    getDescription: () => `${name} description`,
  });
  const registry: Record<string, unknown> = {
    assistant: agent('Questions to Insights Assistant'),
    'assistant-v2': agent('Questions to Insights v2'),
    'data-readiness': agent('Data Readiness Agent'),
    'sql-fixer': agent('SQL Fixer'),
  };
  const mastra = {
    getAgent: jest.fn((key: string) => registry[key]),
    listAgents: () => registry,
    ensureSessionWorkspace: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve({ id: `session-${id}` }),
      ),
  };
  const docs = new Map<string, UserAgentDoc>([
    [LIVE.id, LIVE],
    [DRAFT_ONLY.id, DRAFT_ONLY],
  ]);
  const userAgents = {
    get: jest.fn((id: string) => Promise.resolve(docs.get(id) ?? null)),
    list: jest.fn(() => Promise.resolve([...docs.values()])),
    datasetNames: jest
      .fn()
      .mockResolvedValue(new Set(['World Cup', 'Orders API'])),
    datasetKinds: jest.fn().mockResolvedValue([
      { name: 'World Cup', datasourceKind: 'postgres' },
      { name: 'Orders API', datasourceKind: 'rest' },
    ]),
  };
  const service = new SessionsService(
    repository as never,
    mastra as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    userAgents as never,
  );
  return { service, repository, docs, stored };
}

describe('SessionsService sessions bound to a workflow (ADR-0040)', () => {
  describe('the derived workflowRef (api.md 2.1)', () => {
    const doc = (fields: Partial<SessionDoc>): SessionDoc => ({
      id: 's-1',
      name: 'S',
      datasets: ['World Cup'],
      messages: [],
      ...fields,
    });

    it.each<[string, Partial<SessionDoc>, object]>([
      [
        'a plain session saved before workflows',
        {},
        {
          id: 'agent:assistant',
          name: 'Assistant',
          kind: 'agent',
          deleted: false,
        },
      ],
      [
        'a v2 session saved before workflows',
        { agentKey: 'assistant-v2', agentName: 'Questions to Insights v2' },
        {
          id: 'qti-v2-turn',
          name: 'Answer a Business Question',
          kind: 'code',
          deleted: false,
        },
      ],
      [
        'a session of the removed RFP Builder, read as a plain one',
        { agentKey: 'rfp', agentName: 'RFP Builder', workflowId: 'agent:rfp' },
        {
          id: 'agent:assistant',
          name: 'Assistant',
          kind: 'agent',
          deleted: false,
        },
      ],
      [
        'a Data Readiness session',
        {
          agentKey: 'data-readiness',
          agentName: 'Data Readiness Agent',
          workflowId: 'agent:data-readiness',
        },
        {
          id: 'agent:data-readiness',
          name: 'Data Readiness Agent',
          kind: 'agent',
          deleted: false,
        },
      ],
      [
        "a Live user agent's session",
        { agentId: 'u-live', agentName: 'Old name' },
        {
          id: 'agent:u-live',
          name: 'Historian',
          kind: 'agent',
          deleted: false,
        },
      ],
      [
        "a deleted user agent's session",
        { agentId: 'u-gone', agentName: 'Short-lived' },
        {
          id: 'agent:u-gone',
          name: 'Short-lived',
          kind: 'agent',
          deleted: true,
        },
      ],
      [
        'a preview, named after the draft',
        { agentId: 'u-live', agentName: 'Historian draft', preview: true },
        {
          id: 'agent:u-live',
          name: 'Historian draft',
          kind: 'agent',
          deleted: false,
        },
      ],
      [
        'an unresolvable stored workflowId',
        { workflowId: 'removed-workflow', agentKey: 'assistant-v2' },
        {
          id: 'qti-v2-turn',
          name: 'Answer a Business Question',
          kind: 'code',
          deleted: false,
        },
      ],
    ])('%s', async (_label, fields, expected) => {
      const { service } = build();
      const session = doc(fields);
      expect((await service.toView(session)).workflowRef).toEqual(expected);
      if (!session.preview) {
        expect((await service.toViews([session]))[0].workflowRef).toEqual(
          expected,
        );
      }
    });

    it('never stores workflowRef, and leaves `workflow` (the bar) as it was', async () => {
      const { service } = build();
      const session = doc({ agentKey: 'assistant-v2' });
      const view = await service.toView(session);
      expect(session).not.toHaveProperty('workflowRef');
      expect(view.workflow?.source).toBe('workflow');
    });
  });
});
