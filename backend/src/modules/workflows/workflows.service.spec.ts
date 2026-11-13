// The real Mastra instance pulls in ESM-only packages Jest cannot require;
// the services only need `listAgents()`, which the test passes in.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/evals/assistant.evals', () => ({
  ASSISTANT_EVAL_SETS: [],
}));
jest.mock('../../mastra/evals/eval-sets', () => ({
  evalSetsFor: () => [],
}));
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));
// The run service's session side loads Mastra; these specs never run a turn.
jest.mock('../sessions/sessions.service', () => ({
  SessionsService: class {},
  RUN_HOST_ID_PREFIX: 'run-',
}));

import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import BetterSqlite3 from 'better-sqlite3';
import request from 'supertest';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { MastraService } from '../../mastra/mastra.service';
import { agentWorkflow } from '../../mastra/workflows/agent-workflows';
import { QTI_V2_TURN_STEPS } from '../../mastra/workflows/qti-v2-turn.steps';
import { CODE_WORKFLOWS } from '../../mastra/workflows/workflow-catalog';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import type { SkillDoc } from '../skills/entities/skill.entity';
import { SkillsRepository } from '../skills/repositories/skills.repository';
import { BuiltinAgentPinsRepository } from '../user-agents/repositories/builtin-agent-pins.repository';
import { UserAgentsRepository } from '../user-agents/repositories/user-agents.repository';
import { UserAgentsService } from '../user-agents/user-agents.service';
import { AgentsService } from '../agents/agents.service';
import type { LlmService } from '../llm/llm.service';
import { WorkflowRunsService } from './workflow-runs.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

function fakeAgent(
  name: string,
  tools: string[],
  description = '',
  instructions = '',
) {
  return {
    id: name,
    name,
    getDescription: () => description || `${name} description`,
    listTools: () =>
      Object.fromEntries(
        tools.map((tool) => [
          tool,
          {
            description: `${tool} description`,
            // A Zod-like object schema: its top-level keys are the inputs.
            ...(tool === 'run_readonly_sql'
              ? { inputSchema: { shape: { sql: {}, reason: {} } } }
              : {}),
          },
        ]),
      ),
    getInstructions: () => instructions,
    getMemory: () => undefined,
    getModel: () => {
      throw new Error('no LLM settings');
    },
  };
}

/** The saved LLM settings, as `LlmService.getView` answers them. */
const ANTHROPIC_VIEW = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  configured: true,
  reasoningEffort: null,
};

const V2_DESCRIPTION =
  'A business data analyst: answers questions over the datasets you pick with read-only SQL, checks its results and explains how it got them.';

function build(
  datasets: { name: string; datasourceKind?: string }[] = [
    { name: 'World Cup Core', datasourceKind: 'postgres' },
  ],
  options: { llmView?: typeof ANTHROPIC_VIEW; v2Prompt?: string } = {},
) {
  const db = new BetterSqlite3(':memory:');
  const userAgents = new UserAgentsService(
    new UserAgentsRepository(new SqliteDocStore(db, 'agents')),
    new BuiltinAgentPinsRepository(new SqliteDocStore(db, 'settings')),
    {
      list: jest.fn().mockResolvedValue(datasets),
    } as unknown as DatasetsRepository,
    new SkillsRepository(new SqliteDocStore<SkillDoc>(db, 'skills')),
  );
  const registry = {
    'sql-fixer': fakeAgent('SQL Fixer', ['b']),
    assistant: fakeAgent('Questions to Insights Assistant', [
      'run_readonly_sql',
      'ask_clarification',
    ]),
    'assistant-v2': fakeAgent(
      'Questions to Insights v2',
      ['list_entities', 'describe_entity', 'run_readonly_sql'],
      '',
      options.v2Prompt ?? 'You answer with the core data tools.',
    ),
    'data-readiness': fakeAgent(
      'Data Readiness Agent',
      ['assess_readiness', 'get_readiness_report'],
      '',
      'You assess readiness.',
    ),
  };
  const mastra = { listAgents: () => registry } as unknown as MastraService;
  const llm = options.llmView
    ? ({
        getView: () => Promise.resolve(options.llmView),
      } as unknown as LlmService)
    : undefined;
  const agents = new AgentsService(mastra, userAgents, llm);
  return {
    db,
    userAgents,
    agents,
    service: new WorkflowsService(agents),
  };
}

const agentConfig = (name: string, datasets: string[]) => ({
  name,
  description: `${name} description`,
  instructions: 'Be brief.',
  datasets,
  starterQuestions: [`Ask ${name}`],
});

/** The one catalogue workflow, as `GET /workflows` lists it. */
const QTI_V2_SUMMARY = {
  id: 'qti-v2-turn',
  name: 'Questions to Insights v2',
  description: V2_DESCRIPTION,
  kind: 'code',
  owner: 'Official',
  agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
  stepCount: 4,
  bar: 'steps',
  trigger: 'run',
  input: [
    {
      name: 'question',
      label: 'Question',
      type: 'textarea',
      required: true,
      placeholder: 'Ask a question about your data',
      maxLength: 4000,
      usedBy: ['receive-question'],
    },
    {
      name: 'datasets',
      label: 'Datasets',
      type: 'datasets',
      required: true,
      usedBy: ['receive-question'],
    },
  ],
  datasets: [],
  missingDatasets: [],
  starterQuestions: [],
};

describe('WorkflowsService (api.md 116, 117; workflows R1, R2)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  it('lists only Questions to Insights v2: agents, Live user agents included, get no workflow (1.23.35)', async () => {
    ctx = build();
    const zeta = await ctx.userAgents.create(
      agentConfig('Zeta', ['World Cup Core']),
    );
    await ctx.userAgents.publish(zeta.id);
    await ctx.userAgents.create(agentConfig('Sketch', ['World Cup Core']));

    expect(await ctx.service.list()).toEqual([QTI_V2_SUMMARY]);
  });

  it('lists the same one workflow while no dataset qualifies for the Data Readiness Agent', async () => {
    ctx = build([{ name: 'Orders API', datasourceKind: 'rest' }]);
    const workflows = await ctx.service.list();
    expect(workflows).toEqual([QTI_V2_SUMMARY]);
    expect(workflows[0]).not.toHaveProperty('runRequirement');
    expect(workflows[0]).not.toHaveProperty('chatRequirement');
  });

  describe('get', () => {
    it("qti-v2-turn's steps are agentWorkflow('assistant-v2')'s, with their declared schemas", async () => {
      ctx = build();
      const detail = await ctx.service.get('qti-v2-turn');
      // Its agent steps also name their agent's key, and every step carries
      // its declared input and output schema (api.md 117; agents.md 5.12).
      expect(detail.steps).toEqual(
        agentWorkflow('assistant-v2')!.steps.map((step, index) => ({
          ...(step.agent
            ? { ...step, agent: { ...step.agent, key: 'assistant-v2' } }
            : step),
          inputSchema: QTI_V2_TURN_STEPS[index].inputSchema,
          outputSchema: QTI_V2_TURN_STEPS[index].outputSchema,
        })),
      );
      expect(detail.steps.some((step) => step.agent)).toBe(true);
      expect(detail).toMatchObject({
        id: 'qti-v2-turn',
        stepCount: 4,
        contractHash: CODE_WORKFLOWS[0].contractHash,
      });
      expect(detail.contractHash).toMatch(/^[0-9a-f]{12}$/);
      // Analyse receives the question (a string) and the catalog.
      expect(detail.steps[2].inputSchema).toMatchObject({
        type: 'object',
        properties: {
          question: { type: 'string' },
          catalog: { type: 'array', items: { type: 'object' } },
        },
        required: ['question', 'catalog'],
      });
      // A run needs the hash too: it stores it (data-model 3.16).
      await expect(
        ctx.service.definition('qti-v2-turn'),
      ).resolves.toMatchObject({
        contractHash: CODE_WORKFLOWS[0].contractHash,
      });
      // 116 is unchanged: no hash and no schemas on a summary.
      const [summary] = await ctx.service.list();
      expect(summary).not.toHaveProperty('contractHash');
    });

    it('details the agent its steps call: its key, name, model, system prompt and tools (as api.md 34 toolDetails); no model without an LLM', async () => {
      ctx = build();
      const detail = await ctx.service.get('qti-v2-turn');
      expect(detail.agents).toEqual([
        {
          key: 'assistant-v2',
          name: 'Questions to Insights v2',
          model: null,
          systemPrompt: 'You answer with the core data tools.',
          toolDetails: [
            {
              name: 'describe_entity',
              description: 'describe_entity description',
              inputs: [],
            },
            {
              name: 'list_entities',
              description: 'list_entities description',
              inputs: [],
            },
            {
              name: 'run_readonly_sql',
              description: 'run_readonly_sql description',
              inputs: ['sql', 'reason'],
            },
          ],
        },
      ]);
      ctx.db.close();
      ctx = build(undefined, { llmView: ANTHROPIC_VIEW });
      const withLlm = await ctx.service.get('qti-v2-turn');
      expect(withLlm.agents[0].model).toBe('anthropic/claude-sonnet-4-6');
    });

    it('shortens a system prompt longer than 20 000 characters, and says so', async () => {
      ctx = build(undefined, { v2Prompt: 'p'.repeat(20_001) });
      const [agent] = (await ctx.service.get('qti-v2-turn')).agents;
      expect(agent.systemPrompt).toHaveLength(20_000);
      expect(agent.systemPromptTruncated).toBe(true);
      ctx.db.close();
      ctx = build(undefined, { v2Prompt: 'p'.repeat(20_000) });
      const [exact] = (await ctx.service.get('qti-v2-turn')).agents;
      expect(exact.systemPrompt).toHaveLength(20_000);
      expect(exact).not.toHaveProperty('systemPromptTruncated');
    });

    it('lists the summary agents only, without model or prompt (api.md 116 unchanged)', async () => {
      ctx = build(undefined, { llmView: ANTHROPIC_VIEW });
      const [v2] = await ctx.service.list();
      expect(v2.agents).toEqual([
        { key: 'assistant-v2', name: 'Questions to Insights v2' },
      ]);
    });

    it.each([
      // The removed one-step agent workflows (1.23.35).
      'agent:assistant',
      'agent:data-readiness',
      // The removed code workflows (1.23.35).
      'seq-text-demo',
      'deep-analysis',
      'agent:sql-fixer',
      'agent:assistant-v2',
      'agent:rfp',
      'nope',
      'agent-turn',
    ])('answers 404 for %p', async (id) => {
      ctx = build();
      await expect(ctx.service.get(id)).rejects.toThrow(
        new NotFoundException(`Workflow "${id}" not found`),
      );
      await expect(ctx.service.definition(id)).rejects.toThrow(
        `Workflow "${id}" not found`,
      );
    });

    it('answers 404 for a Live and a draft-only user agent', async () => {
      ctx = build();
      const live = await ctx.userAgents.create(
        agentConfig('Historian', ['World Cup Core']),
      );
      await ctx.userAgents.publish(live.id);
      const draft = await ctx.userAgents.create(
        agentConfig('Sketch', ['World Cup Core']),
      );
      for (const id of [live.id, draft.id]) {
        await expect(ctx.service.get(`agent:${id}`)).rejects.toThrow(
          `Workflow "agent:${id}" not found`,
        );
      }
    });
  });
});

describe('AgentsService usedInWorkflows (api.md 34)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  it.each([
    ['assistant-v2', [{ id: 'qti-v2-turn', name: 'Questions to Insights v2' }]],
    ['assistant', []],
    ['data-readiness', []],
    ['sql-fixer', []],
  ])('%s is used in %p', async (key, expected) => {
    ctx = build();
    expect((await ctx.agents.get(key))?.usedInWorkflows).toEqual(expected);
  });

  it('a user agent is used in none, draft-only or Live', async () => {
    ctx = build();
    const doc = await ctx.userAgents.create(
      agentConfig('Historian', ['World Cup Core']),
    );
    expect((await ctx.agents.get(doc.id))?.usedInWorkflows).toEqual([]);
    await ctx.userAgents.publish(doc.id);
    expect((await ctx.agents.get(doc.id))?.usedInWorkflows).toEqual([]);
  });

  it('no agent carries a chat or run requirement on the wire any more', async () => {
    ctx = build([{ name: 'Orders API', datasourceKind: 'rest' }]);
    for (const agent of await ctx.agents.list()) {
      expect(agent).not.toHaveProperty('chatRequirement');
    }
    expect(await ctx.agents.get('data-readiness')).not.toHaveProperty(
      'chatRequirement',
    );
  });
});

describe('WorkflowsController (ids contain ":")', () => {
  it('GET /workflows/:id resolves the decoded id, and an unknown one answers 404', async () => {
    const service = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn((id: string) =>
        id === 'qti-v2-turn'
          ? Promise.resolve({ id, name: 'Questions to Insights v2', steps: [] })
          : Promise.reject(new NotFoundException(`Workflow "${id}" not found`)),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowsController],
      providers: [
        { provide: WorkflowsService, useValue: service },
        { provide: WorkflowRunsService, useValue: {} },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      await request(server)
        .get('/workflows/qti-v2-turn')
        .expect(200)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            id: 'qti-v2-turn',
            name: 'Questions to Insights v2',
          }),
        );
      await request(server)
        .get('/workflows/agent%3Aassistant')
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            message: 'Workflow "agent:assistant" not found',
          }),
        );
      expect(service.get).toHaveBeenLastCalledWith('agent:assistant');
      await request(server)
        .get('/workflows')
        .expect(200)
        .expect(({ body }) => expect(body).toEqual({ workflows: [] }));
    } finally {
      await app.close();
    }
  });
});

describe('WorkflowsController POST /workflows/:id/runs (api.md 118)', () => {
  it('answers 200 with the stored run, and a refusal with its status', async () => {
    const run = { id: 'r-1', workflowId: 'qti-v2-turn', status: 'failed' };
    const service = {
      run: jest.fn((id: string, body: unknown) =>
        id === 'qti-v2-turn'
          ? Promise.resolve({ ...run, body })
          : Promise.reject(new NotFoundException(`Workflow "${id}" not found`)),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowsController],
      providers: [
        { provide: WorkflowsService, useValue: {} },
        { provide: WorkflowRunsService, useValue: service },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const input = { question: 'Hi', datasets: ['World Cup Core'] };
      await request(server)
        .post('/workflows/qti-v2-turn/runs')
        .send({ input })
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual({ ...run, body: { input } }),
        );
      await request(server)
        .post('/workflows/seq-text-demo/runs')
        .send({ input: { text: 'Hi' } })
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            message: 'Workflow "seq-text-demo" not found',
          }),
        );
      expect(service.run).toHaveBeenLastCalledWith('seq-text-demo', {
        input: { text: 'Hi' },
      });
    } finally {
      await app.close();
    }
  });
});
