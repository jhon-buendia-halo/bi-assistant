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
import { ANSWER_BUSINESS_QUESTION_STEPS } from '../../mastra/workflows/answer-business-question.steps';
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
    'insights-analyst': fakeAgent(
      'Insights Analyst',
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
    // The agents of v2's Plan and Write answer steps (agents.md 5.11).
    'analysis-planner': fakeAgent(
      'Analysis Planner',
      [],
      '',
      'You plan a data analysis.',
    ),
    'answer-writer': fakeAgent(
      'Answer Writer',
      [],
      '',
      'You write the final answer.',
    ),
    // The agent of Read images (agents.md 2.15).
    'image-reader': fakeAgent(
      'Image Reader',
      [],
      '',
      'You describe the reference images.',
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

/**
 * Assess Data Readiness as `GET /workflows` lists it (agents.md 5.13): its
 * datasets are the qualifying ones of the fixture, so only the fixed fields.
 */
const READINESS_SUMMARY = expect.objectContaining({
  id: 'data-readiness-assessment',
  name: 'Assess Data Readiness',
  kind: 'code',
  owner: 'Official',
  // Read images first (workflows R35), then its seven steps (Rows behind
  // findings since roadmap 1.28.11).
  stepCount: 8,
  bar: 'steps',
  trigger: 'run',
  starterQuestions: [
    'Assess the readiness of this dataset',
    'What are the worst data-quality problems?',
    'Show my past assessments',
  ],
}) as unknown;

/** Insights Analyst, as `GET /workflows` lists it. */
const ANSWER_BUSINESS_QUESTION_SUMMARY = {
  id: 'answer-business-question',
  name: 'Answer a Business Question',
  description: V2_DESCRIPTION,
  kind: 'code',
  owner: 'Official',
  // Every agent its steps run: Michael, then Zoe (Read images), Olivia
  // (Plan), Sarah (Check data quality) and Jessica (Write answer).
  agents: [
    { key: 'insights-analyst', name: 'Michael', role: 'Insights Analyst' },
    { key: 'image-reader', name: 'Zoe', role: 'Image Analyst' },
    { key: 'analysis-planner', name: 'Olivia', role: 'Analysis Lead' },
    { key: 'data-readiness', name: 'Sarah', role: 'Data Quality Analyst' },
    { key: 'answer-writer', name: 'Jessica', role: 'Insights Writer' },
  ],
  stepCount: 13,
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
      usedBy: ['read-images', 'receive-question'],
    },
    {
      // Only Read images reads them (workflows R35; api.md 116).
      name: 'images',
      label: 'Reference images',
      type: 'images',
      required: false,
      max: 4,
      help: 'Paste, drop or attach up to 4 PNG, JPEG or WebP images, 5 MB each.',
      usedBy: ['read-images'],
    },
    {
      name: 'datasets',
      label: 'Datasets',
      type: 'datasets',
      required: true,
      usedBy: ['receive-question'],
    },
    {
      // Picks the branch to Check data quality; no step reads it.
      name: 'checkDataQuality',
      label: 'Check data quality: Sarah reviews the tables the analysis used',
      type: 'boolean',
      required: false,
      default: false,
      usedBy: [],
    },
  ],
  datasets: [],
  missingDatasets: [],
  starterQuestions: [],
};

describe('WorkflowsService (api.md 116, 117; workflows R1, R2)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  it('lists only the code workflows: agents, Live user agents included, get no workflow (1.23.35)', async () => {
    ctx = build();
    const zeta = await ctx.userAgents.create(
      agentConfig('Zeta', ['World Cup Core']),
    );
    await ctx.userAgents.publish(zeta.id);
    await ctx.userAgents.create(agentConfig('Sketch', ['World Cup Core']));

    expect(await ctx.service.list()).toEqual([
      ANSWER_BUSINESS_QUESTION_SUMMARY,
      READINESS_SUMMARY,
    ]);
  });

  it('lists Assess Data Readiness on one PostgreSQL or Databricks dataset, its Explain report run by the Data Readiness Agent (agents.md 5.13)', async () => {
    ctx = build();
    const [, readiness] = await ctx.service.list();
    expect(readiness.agents.map((agent) => agent.key)).toEqual([
      'data-readiness',
      'image-reader',
    ]);
    expect(readiness.input.map((field) => field.name)).toEqual([
      'dataset',
      'question',
      'images',
    ]);
    expect(readiness.input[0]).toMatchObject({
      type: 'dataset',
      required: true,
      datasourceKinds: ['postgres', 'databricks'],
    });
    expect(readiness.input[1]).toMatchObject({
      type: 'textarea',
      required: false,
      default: 'Assess the readiness of this dataset',
    });
  });

  it('lists the same workflows while no dataset qualifies for the Data Readiness Agent', async () => {
    ctx = build([{ name: 'Orders API', datasourceKind: 'rest' }]);
    const workflows = await ctx.service.list();
    expect(workflows).toEqual([
      ANSWER_BUSINESS_QUESTION_SUMMARY,
      READINESS_SUMMARY,
    ]);
    expect(workflows[0]).not.toHaveProperty('runRequirement');
    expect(workflows[0]).not.toHaveProperty('chatRequirement');
  });

  describe('get', () => {
    it("answer-business-question's steps are agentWorkflow('insights-analyst')'s, with their declared schemas", async () => {
      ctx = build();
      const detail = await ctx.service.get('answer-business-question');
      // Its agent steps name their own agent's key (Zoe reads the images,
      // Olivia plans, Michael analyses, Jessica writes), and every step
      // carries its declared input and output schema (api.md 117; agents.md
      // 5.11, 5.12).
      expect(
        detail.steps.flatMap((step) => (step.agent ? [step.agent.key] : [])),
      ).toEqual([
        'image-reader',
        'result-explorer',
        'analysis-planner',
        'insights-analyst',
        'data-readiness',
        'answer-writer',
      ]);
      expect(detail.steps).toEqual(
        agentWorkflow('insights-analyst')!.steps.map((step, index) => ({
          ...step,
          inputSchema: ANSWER_BUSINESS_QUESTION_STEPS[index].inputSchema,
          outputSchema: ANSWER_BUSINESS_QUESTION_STEPS[index].outputSchema,
        })),
      );
      expect(detail.steps.some((step) => step.agent)).toBe(true);
      expect(detail).toMatchObject({
        id: 'answer-business-question',
        stepCount: 13,
        contractHash: CODE_WORKFLOWS[0].contractHash,
      });
      expect(detail.contractHash).toMatch(/^[0-9a-f]{12}$/);
      // Plan receives the question (a string), the catalog and Read
      // images' notes ('' without images; optional, so a run stored before
      // Read images existed resumes with none).
      expect(detail.steps[4]).toMatchObject({ id: 'plan' });
      expect(detail.steps[4].inputSchema).toMatchObject({
        type: 'object',
        properties: {
          question: { type: 'string' },
          catalog: { type: 'array', items: { type: 'object' } },
          columns: { type: 'array', items: { type: 'object' } },
          imageNotes: { type: 'string', default: '' },
        },
        required: ['question', 'catalog', 'columns'],
      });
      // The flow is its edges, a copy of the catalogue's (api.md 117).
      expect(detail.edges).toEqual(CODE_WORKFLOWS[0].edges);
      expect(detail.edges).not.toBe(CODE_WORKFLOWS[0].edges);
      // A run needs the hash and the edges too (data-model 3.16; the loop
      // steps keep one entry per attempt, api.md 3.6).
      await expect(
        ctx.service.definition('answer-business-question'),
      ).resolves.toMatchObject({
        contractHash: CODE_WORKFLOWS[0].contractHash,
        edges: CODE_WORKFLOWS[0].edges,
      });
      // 116 is unchanged: no hash and no schemas on a summary.
      const [summary] = await ctx.service.list();
      expect(summary).not.toHaveProperty('contractHash');
    });

    it('details the agents its steps call: their key, name, model, system prompt and tools (as api.md 34 toolDetails); no model without an LLM', async () => {
      ctx = build();
      const detail = await ctx.service.get('answer-business-question');
      expect(detail.agents).toEqual([
        {
          key: 'insights-analyst',
          // The agent's persona name, as the catalogue shows it.
          name: 'Michael',
          role: 'Insights Analyst',
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
        // Zoe, Olivia and Jessica: one model call each, on their own job
        // description (Zoe's only when the run has images).
        {
          key: 'image-reader',
          name: 'Zoe',
          role: 'Image Analyst',
          model: null,
          systemPrompt: 'You describe the reference images.',
          toolDetails: [],
        },
        {
          key: 'analysis-planner',
          name: 'Olivia',
          role: 'Analysis Lead',
          model: null,
          systemPrompt: 'You plan a data analysis.',
          toolDetails: [],
        },
        // Sarah checks data quality in one model call: none of her tools
        // here, though she has some.
        {
          key: 'data-readiness',
          name: 'Sarah',
          role: 'Data Quality Analyst',
          model: null,
          systemPrompt: 'You assess readiness.',
          toolDetails: [],
        },
        {
          key: 'answer-writer',
          name: 'Jessica',
          role: 'Insights Writer',
          model: null,
          systemPrompt: 'You write the final answer.',
          toolDetails: [],
        },
      ]);
      ctx.db.close();
      ctx = build(undefined, { llmView: ANTHROPIC_VIEW });
      const withLlm = await ctx.service.get('answer-business-question');
      expect(withLlm.agents[0].model).toBe('anthropic/claude-sonnet-4-6');
    });

    it('shortens a system prompt longer than 20 000 characters, and says so', async () => {
      ctx = build(undefined, { v2Prompt: 'p'.repeat(20_001) });
      const [agent] = (await ctx.service.get('answer-business-question'))
        .agents;
      expect(agent.systemPrompt).toHaveLength(20_000);
      expect(agent.systemPromptTruncated).toBe(true);
      ctx.db.close();
      ctx = build(undefined, { v2Prompt: 'p'.repeat(20_000) });
      const [exact] = (await ctx.service.get('answer-business-question'))
        .agents;
      expect(exact.systemPrompt).toHaveLength(20_000);
      expect(exact).not.toHaveProperty('systemPromptTruncated');
    });

    it('lists the summary agents only, without model or prompt (api.md 116 unchanged)', async () => {
      ctx = build(undefined, { llmView: ANTHROPIC_VIEW });
      const [v2] = await ctx.service.list();
      expect(v2.agents).toEqual([
        { key: 'insights-analyst', name: 'Michael', role: 'Insights Analyst' },
        { key: 'image-reader', name: 'Zoe', role: 'Image Analyst' },
        { key: 'analysis-planner', name: 'Olivia', role: 'Analysis Lead' },
        { key: 'data-readiness', name: 'Sarah', role: 'Data Quality Analyst' },
        { key: 'answer-writer', name: 'Jessica', role: 'Insights Writer' },
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
      'agent:insights-analyst',
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
    [
      'insights-analyst',
      [{ id: 'answer-business-question', name: 'Answer a Business Question' }],
    ],
    ['assistant', []],
    [
      'data-readiness',
      [
        { id: 'answer-business-question', name: 'Answer a Business Question' },
        { id: 'data-readiness-assessment', name: 'Assess Data Readiness' },
      ],
    ],
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
        id === 'answer-business-question'
          ? Promise.resolve({
              id,
              name: 'Answer a Business Question',
              steps: [],
            })
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
        .get('/workflows/answer-business-question')
        .expect(200)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            id: 'answer-business-question',
            name: 'Answer a Business Question',
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
    const run = {
      id: 'r-1',
      workflowId: 'answer-business-question',
      status: 'failed',
    };
    const service = {
      run: jest.fn((id: string, body: unknown) =>
        id === 'answer-business-question'
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
        .post('/workflows/answer-business-question/runs')
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
