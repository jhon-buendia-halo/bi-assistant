// The data-readiness service loads the Databricks driver (ESM-only deps)
// at import time; the session specs never call it for real.
jest.mock('../data-readiness/data-readiness.service', () => ({
  DataReadinessService: class {},
}));

// Sessions bound to a workflow (ADR-0040; workflows R4; sessions-chat R65):
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
jest.mock('../rfp-packages/rfp-packages.service', () => ({
  RfpPackagesService: class {},
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

import { BadRequestException } from '@nestjs/common';
import { sessionWorkflowId } from '../../mastra/workflows/workflow-catalog';
import { SessionsController } from './sessions.controller';
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
    rfp: agent('RFP Builder'),
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
      .mockResolvedValue(new Set(['World Cup', 'Intellify RFP API'])),
    datasetKinds: jest.fn().mockResolvedValue([
      { name: 'World Cup', datasourceKind: 'postgres' },
      { name: 'Intellify RFP API', datasourceKind: 'rest' },
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

const derived = (session: SessionDoc) =>
  sessionWorkflowId({ agentKey: session.agentKey, agentId: session.agentId });

describe('SessionsService sessions bound to a workflow (ADR-0040)', () => {
  describe('every creation path stores the workflowId its agent fields derive (R4)', () => {
    it.each<[string, (s: SessionsService) => Promise<SessionDoc>, string]>([
      [
        'a plain body',
        (s) => s.create('Chat', ['World Cup']),
        'agent:assistant',
      ],
      [
        'agentId assistant-v2',
        (s) => s.createFromAgent('assistant-v2', 'v2 chat', ['World Cup']),
        'qti-v2-turn',
      ],
      ['agentId rfp', (s) => s.createFromAgent('rfp'), 'agent:rfp'],
      [
        'agentId data-readiness',
        (s) => s.createFromAgent('data-readiness'),
        'agent:data-readiness',
      ],
      ['a Live user agent', (s) => s.createFromAgent('u-live'), 'agent:u-live'],
      ['a preview', (s) => s.createPreview('u-draft'), 'agent:u-draft'],
      [
        'workflowId qti-v2-turn',
        (s) => s.createFromWorkflow('qti-v2-turn', 'v2 chat', ['World Cup']),
        'qti-v2-turn',
      ],
      [
        'workflowId agent:assistant',
        (s) => s.createFromWorkflow('agent:assistant', 'Chat', ['World Cup']),
        'agent:assistant',
      ],
      [
        'workflowId agent:rfp',
        (s) => s.createFromWorkflow('agent:rfp'),
        'agent:rfp',
      ],
      [
        'workflowId agent:<Live user agent>',
        (s) => s.createFromWorkflow('agent:u-live'),
        'agent:u-live',
      ],
    ])('%s', async (_label, create, expected) => {
      const session = await create(build().service);
      expect(session.workflowId).toBe(expected);
      expect(session.workflowId).toBe(derived(session));
    });
  });

  describe('createFromWorkflow (api.md 3)', () => {
    it('qti-v2-turn creates the session as agentId assistant-v2 does', async () => {
      const ctx = build();
      const session = await ctx.service.createFromWorkflow(
        'qti-v2-turn',
        ' v2 chat ',
        ['World Cup'],
      );
      expect(session).toMatchObject({
        name: 'v2 chat',
        datasets: ['World Cup'],
        agentKey: 'assistant-v2',
        agentName: 'Questions to Insights v2',
        workflowId: 'qti-v2-turn',
      });
    });

    it('agent:assistant creates a plain session, no agent fields', async () => {
      const session = await build().service.createFromWorkflow(
        'agent:assistant',
        'Chat',
        ['World Cup'],
      );
      expect(session).toMatchObject({ name: 'Chat', datasets: ['World Cup'] });
      expect(session).not.toHaveProperty('agentKey');
      expect(session).not.toHaveProperty('agentId');
    });

    it.each(['qti-v2-turn', 'agent:assistant'])(
      '%s validates name and datasets as a plain body does',
      async (id) => {
        const { service } = build();
        await expect(
          service.createFromWorkflow(id, '  ', ['World Cup']),
        ).rejects.toThrow('session name is required');
        await expect(
          service.createFromWorkflow(id, 'Chat', []),
        ).rejects.toThrow('select at least one dataset');
        await expect(service.createFromWorkflow(id, 'Chat')).rejects.toThrow(
          'select at least one dataset',
        );
      },
    );

    it("a one-step workflow ignores the body's datasets and takes an optional name", async () => {
      const { service } = build();
      const rfp = await service.createFromWorkflow('agent:rfp', undefined, [
        'World Cup',
      ]);
      expect(rfp).toMatchObject({
        name: 'RFP Builder',
        datasets: ['Intellify RFP API'],
        agentKey: 'rfp',
      });
      const user = await service.createFromWorkflow('agent:u-live', 'Kickoff', [
        'Other',
      ]);
      expect(user).toMatchObject({
        name: 'Kickoff',
        datasets: ['World Cup'],
        agentId: 'u-live',
        agentName: 'Historian',
      });
    });

    it.each([
      'nope',
      'agent:no-such-agent',
      'agent:u-draft',
      'agent:sql-fixer',
      'agent:assistant-v2',
      'agent-turn',
    ])('refuses %p with "Workflow not found", creating nothing', async (id) => {
      const ctx = build();
      await expect(
        ctx.service.createFromWorkflow(id, 'Chat', ['World Cup']),
      ).rejects.toThrow(`Workflow "${id}" not found`);
      expect(ctx.repository.insert).not.toHaveBeenCalled();
    });

    it("refuses a run workflow: it can't start a chat, creating nothing (workflows R11)", async () => {
      const ctx = build();
      const refusal = ctx.service.createFromWorkflow('seq-text-demo', 'Chat', [
        'World Cup',
      ]);
      await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
      await expect(refusal).rejects.toThrow(
        `Workflow "seq-text-demo" can't start a chat`,
      );
      expect(ctx.repository.insert).not.toHaveBeenCalled();
    });

    it("refuses a Live user agent with no dataset left, with the agentId path's text", async () => {
      const ctx = build();
      ctx.docs.set('u-empty', {
        id: 'u-empty',
        draft: config('Empty', ['Gone']),
        live: config('Empty', ['Gone']),
      } as unknown as UserAgentDoc);
      await expect(
        ctx.service.createFromWorkflow('agent:u-empty'),
      ).rejects.toThrow("None of this agent's datasets exist");
    });
  });

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
          name: 'Questions to Insights v2',
          kind: 'code',
          deleted: false,
        },
      ],
      [
        'an RFP session',
        { agentKey: 'rfp', agentName: 'RFP Builder', workflowId: 'agent:rfp' },
        { id: 'agent:rfp', name: 'RFP Builder', kind: 'agent', deleted: false },
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
          name: 'Questions to Insights v2',
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

describe('SessionsController POST /sessions with workflowId (api.md 3)', () => {
  const controllerWith = () => {
    const service = {
      create: jest.fn(),
      createFromAgent: jest.fn(),
      createPreview: jest.fn(),
      createFromWorkflow: jest
        .fn()
        .mockResolvedValue({ id: 's', name: 'Chat', datasets: [] }),
      toView: jest.fn((s: SessionDoc) => Promise.resolve(s)),
    };
    return {
      service,
      controller: new SessionsController(service as never),
    };
  };

  it('refuses workflowId together with agentId', async () => {
    const { controller, service } = controllerWith();
    expect(
      await controller.create({ workflowId: 'qti-v2-turn', agentId: 'rfp' }),
    ).toEqual({ ok: false, message: 'Send workflowId or agentId, not both' });
    expect(service.createFromWorkflow).not.toHaveBeenCalled();
    expect(service.createFromAgent).not.toHaveBeenCalled();
  });

  it('passes workflowId, name and datasets on, ignoring preview', async () => {
    const { controller, service } = controllerWith();
    const answer = await controller.create({
      workflowId: 'qti-v2-turn',
      name: 'Chat',
      datasets: ['World Cup'],
      preview: true,
    });
    expect(service.createFromWorkflow).toHaveBeenCalledWith(
      'qti-v2-turn',
      'Chat',
      ['World Cup'],
    );
    expect(service.createPreview).not.toHaveBeenCalled();
    expect(answer).toMatchObject({
      ok: true,
      message: 'Session "Chat" created',
    });
  });
});
