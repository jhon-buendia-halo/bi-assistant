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

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import BetterSqlite3 from 'better-sqlite3';
import request from 'supertest';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { MastraService } from '../../mastra/mastra.service';
import { agentWorkflow } from '../../mastra/workflows/agent-workflows';
import { oneStepWorkflowInput } from '../../mastra/workflows/workflow-catalog';
import { SEQ_TEXT_DEMO_STEPS } from '../../mastra/workflows/seq-text-demo.steps';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import type { SkillDoc } from '../skills/entities/skill.entity';
import { SkillsRepository } from '../skills/repositories/skills.repository';
import { BuiltinAgentPinsRepository } from '../user-agents/repositories/builtin-agent-pins.repository';
import { UserAgentsRepository } from '../user-agents/repositories/user-agents.repository';
import { UserAgentsService } from '../user-agents/user-agents.service';
import { AgentsService } from '../agents/agents.service';
import { WorkflowRunsService } from './workflow-runs.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

function fakeAgent(name: string, tools: string[], description = '') {
  return {
    id: name,
    name,
    getDescription: () => description || `${name} description`,
    listTools: () =>
      Object.fromEntries(tools.map((tool) => [tool, { description: tool }])),
    getInstructions: () => '',
    getMemory: () => undefined,
    getModel: () => {
      throw new Error('no LLM settings');
    },
  };
}

const RFP_REQUIREMENT =
  'Load the "Intellify RFP API" sample in Settings → Testing Data first';
const READINESS_REQUIREMENT = 'Add a PostgreSQL or Databricks dataset first';

function build(
  datasets: { name: string; datasourceKind?: string }[] = [
    { name: 'World Cup Core', datasourceKind: 'postgres' },
  ],
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
    'assistant-v2': fakeAgent('Questions to Insights v2', [
      'list_entities',
      'describe_entity',
      'run_readonly_sql',
    ]),
    rfp: fakeAgent('RFP Builder', ['create_rfp', 'update_rfp']),
    'data-readiness': fakeAgent('Data Readiness Agent', ['assess_readiness']),
  };
  const runWorkflow = jest.fn();
  const mastra = {
    listAgents: () => registry,
    runWorkflow,
  } as unknown as MastraService;
  const agents = new AgentsService(mastra, userAgents);
  return {
    db,
    userAgents,
    agents,
    runWorkflow,
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

describe('WorkflowsService (api.md 116, 117; workflows R1, R2)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  it('lists the assistant, the code workflows, the other Official agents and the Live user agents, in that order', async () => {
    ctx = build();
    const zeta = await ctx.userAgents.create(
      agentConfig('Zeta', ['World Cup Core']),
    );
    await ctx.userAgents.publish(zeta.id);
    const alpha = await ctx.userAgents.create(agentConfig('Alpha', ['Gone']));
    await ctx.userAgents.publish(alpha.id);
    await ctx.userAgents.create(agentConfig('Sketch', ['World Cup Core']));

    const workflows = await ctx.service.list();
    expect(workflows.map((w) => w.id)).toEqual([
      'agent:assistant',
      'qti-v2-turn',
      'seq-text-demo',
      'agent:data-readiness',
      'agent:rfp',
      `agent:${alpha.id}`,
      `agent:${zeta.id}`,
    ]);
    expect(workflows[0]).toEqual({
      id: 'agent:assistant',
      name: 'Assistant',
      description: 'Answers questions over the datasets you pick.',
      kind: 'agent',
      owner: 'Official',
      agents: [{ key: 'assistant', name: 'Questions to Insights Assistant' }],
      stepCount: 1,
      bar: 'agent',
      trigger: 'chat',
      input: oneStepWorkflowInput('assistant'),
      picksDatasets: true,
      datasets: [],
      missingDatasets: [],
      starterQuestions: [],
    });
    expect(workflows[1]).toEqual({
      id: 'qti-v2-turn',
      name: 'Questions to Insights v2',
      description:
        'A slimmed-down data analyst under construction: answers questions over the datasets you pick using only the core data tools.',
      kind: 'code',
      owner: 'Official',
      agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
      stepCount: 4,
      bar: 'steps',
      trigger: 'chat',
      input: [
        {
          name: 'question',
          label: 'Question',
          type: 'textarea',
          required: true,
          placeholder: 'Ask a question about your data',
        },
        {
          name: 'datasets',
          label: 'Datasets',
          type: 'datasets',
          required: true,
        },
      ],
      picksDatasets: true,
      datasets: [],
      missingDatasets: [],
      starterQuestions: [],
    });
    expect(workflows[2]).toEqual({
      id: 'seq-text-demo',
      name: 'Sequential test workflow',
      description:
        'A three-step example: cleans a text, counts its words and characters, and formats the result. No LLM.',
      kind: 'code',
      owner: 'Official',
      agents: [],
      stepCount: 3,
      bar: 'steps',
      trigger: 'run',
      input: [
        {
          name: 'text',
          label: 'Text',
          type: 'textarea',
          required: true,
          placeholder: 'Paste or type any text',
        },
      ],
      picksDatasets: false,
      datasets: [],
      missingDatasets: [],
      starterQuestions: [],
    });
    expect(workflows[3]).toEqual({
      id: 'agent:data-readiness',
      name: 'Data Readiness Agent',
      description: 'Data Readiness Agent description',
      kind: 'agent',
      owner: 'Official',
      agents: [{ key: 'data-readiness', name: 'Data Readiness Agent' }],
      stepCount: 1,
      bar: 'agent',
      trigger: 'chat',
      input: oneStepWorkflowInput('data-readiness'),
      picksDatasets: false,
      datasets: ['World Cup Core'],
      missingDatasets: [],
      starterQuestions: [
        'Assess the readiness of this dataset',
        'What are the worst data-quality problems?',
        'Show my past assessments',
      ],
    });
    expect(workflows[4]).toEqual({
      id: 'agent:rfp',
      name: 'RFP Builder',
      description: 'RFP Builder description',
      kind: 'agent',
      owner: 'Official',
      agents: [{ key: 'rfp', name: 'RFP Builder' }],
      stepCount: 1,
      bar: 'agent',
      trigger: 'chat',
      input: oneStepWorkflowInput('rfp'),
      picksDatasets: false,
      datasets: ['Intellify RFP API'],
      missingDatasets: ['Intellify RFP API'],
      starterQuestions: [],
      chatRequirement: RFP_REQUIREMENT,
      runRequirement: RFP_REQUIREMENT,
    });
    expect(workflows[5]).toEqual({
      id: `agent:${alpha.id}`,
      name: 'Alpha',
      description: 'Alpha description',
      kind: 'agent',
      owner: 'You',
      agents: [{ key: alpha.id, name: 'Alpha' }],
      stepCount: 1,
      bar: 'agent',
      trigger: 'chat',
      input: oneStepWorkflowInput(alpha.id),
      picksDatasets: false,
      datasets: [],
      missingDatasets: ['Gone'],
      starterQuestions: ['Ask Alpha'],
      chatRequirement: "None of this agent's datasets exist",
      runRequirement: "None of this agent's datasets exist",
    });
    expect(workflows[6]).toMatchObject({
      id: `agent:${zeta.id}`,
      owner: 'You',
      trigger: 'chat',
      input: oneStepWorkflowInput(zeta.id),
      datasets: ['World Cup Core'],
      missingDatasets: [],
    });
    expect(workflows[6]).not.toHaveProperty('chatRequirement');
    expect(workflows[6]).not.toHaveProperty('runRequirement');
    // Every workflow says how it is started and what it takes.
    for (const workflow of workflows) {
      expect(['chat', 'run']).toContain(workflow.trigger);
      expect(Array.isArray(workflow.input)).toBe(true);
    }
  });

  it('gives the Data Readiness workflow its requirement while no dataset qualifies, and never lists System agents', async () => {
    ctx = build([{ name: 'Intellify RFP API', datasourceKind: 'rest' }]);
    const workflows = await ctx.service.list();
    expect(workflows.map((w) => w.id)).not.toContain('agent:sql-fixer');
    const readiness = workflows.find((w) => w.id === 'agent:data-readiness');
    expect(readiness).toMatchObject({
      datasets: [],
      chatRequirement: READINESS_REQUIREMENT,
      runRequirement: READINESS_REQUIREMENT,
    });
    const rfp = workflows.find((w) => w.id === 'agent:rfp');
    expect(rfp).not.toHaveProperty('chatRequirement');
  });

  describe('get', () => {
    it("qti-v2-turn's steps are agentWorkflow('assistant-v2')'s", async () => {
      ctx = build();
      const detail = await ctx.service.get('qti-v2-turn');
      expect(detail.steps).toEqual(agentWorkflow('assistant-v2')!.steps);
      expect(detail).toMatchObject({ id: 'qti-v2-turn', stepCount: 4 });
    });

    it("a one-step workflow's step runs its agent with its tools and budget", async () => {
      ctx = build();
      const rfp = await ctx.service.get('agent:rfp');
      expect(rfp.steps).toHaveLength(1);
      expect(rfp.steps[0]).toMatchObject({
        id: 'answer',
        title: 'Answer',
        agent: {
          name: 'RFP Builder',
          tools: ['create_rfp', 'update_rfp'],
          maxSteps: 15,
        },
      });
      expect(rfp.steps[0].exits).toHaveLength(2);
      const readiness = await ctx.service.get('agent:data-readiness');
      expect(readiness.steps[0].agent?.maxSteps).toBe(10);
      const assistant = await ctx.service.get('agent:assistant');
      expect(assistant.steps[0].agent).toEqual({
        name: 'Questions to Insights Assistant',
        tools: ['ask_clarification', 'run_readonly_sql'],
        maxSteps: 15,
      });
      expect(assistant.steps[0].exits.at(-1)).toEqual({
        label: 'Clarifying question',
        outcome: 'stops',
      });
    });

    it("a Live user agent's step runs the assistant's tools under its Live name", async () => {
      ctx = build();
      const doc = await ctx.userAgents.create(
        agentConfig('Historian', ['World Cup Core']),
      );
      await ctx.userAgents.publish(doc.id);
      const detail = await ctx.service.get(`agent:${doc.id}`);
      expect(detail).toMatchObject({
        id: `agent:${doc.id}`,
        name: 'Historian',
      });
      expect(detail.steps[0].agent).toMatchObject({
        name: 'Historian',
        maxSteps: 15,
      });
    });

    it("seq-text-demo's steps are its catalogue's, with no agent", async () => {
      ctx = build();
      const detail = await ctx.service.get('seq-text-demo');
      expect(detail).toMatchObject({
        id: 'seq-text-demo',
        trigger: 'run',
        stepCount: 3,
      });
      expect(detail.steps).toEqual(
        SEQ_TEXT_DEMO_STEPS.map((step) => ({
          id: step.id,
          title: step.title,
          kind: step.kind,
          summary: step.summary,
          input: [...step.input],
          output: [...step.output],
          exits: [...step.exits],
        })),
      );
      expect(detail.steps.some((step) => step.agent)).toBe(false);
    });

    it.each(['agent:sql-fixer', 'agent:assistant-v2', 'nope', 'agent-turn'])(
      'answers 404 for %p',
      async (id) => {
        ctx = build();
        await expect(ctx.service.get(id)).rejects.toThrow(
          new NotFoundException(`Workflow "${id}" not found`),
        );
      },
    );

    it('answers 404 for a draft-only user agent', async () => {
      ctx = build();
      const doc = await ctx.userAgents.create(
        agentConfig('Sketch', ['World Cup Core']),
      );
      await expect(ctx.service.get(`agent:${doc.id}`)).rejects.toThrow(
        `Workflow "agent:${doc.id}" not found`,
      );
    });
  });
});

describe('AgentsService usedInWorkflows (api.md 34)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  it.each([
    ['assistant', [{ id: 'agent:assistant', name: 'Assistant' }]],
    ['assistant-v2', [{ id: 'qti-v2-turn', name: 'Questions to Insights v2' }]],
    ['rfp', [{ id: 'agent:rfp', name: 'RFP Builder' }]],
    [
      'data-readiness',
      [{ id: 'agent:data-readiness', name: 'Data Readiness Agent' }],
    ],
    ['sql-fixer', []],
  ])('%s is used in %p', async (key, expected) => {
    ctx = build();
    expect((await ctx.agents.get(key))?.usedInWorkflows).toEqual(expected);
  });

  it('a Live user agent is used in its one-step workflow; a draft-only one in none', async () => {
    ctx = build();
    const doc = await ctx.userAgents.create(
      agentConfig('Historian', ['World Cup Core']),
    );
    expect((await ctx.agents.get(doc.id))?.usedInWorkflows).toEqual([]);
    await ctx.userAgents.publish(doc.id);
    expect((await ctx.agents.get(doc.id))?.usedInWorkflows).toEqual([
      { id: `agent:${doc.id}`, name: 'Historian' },
    ]);
  });
});

describe('WorkflowsController (ids contain ":")', () => {
  it('GET /workflows/agent%3Arfp resolves the decoded id, and an unknown one answers 404', async () => {
    const service = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn((id: string) =>
        id === 'agent:rfp'
          ? Promise.resolve({ id, name: 'RFP Builder', steps: [] })
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
        .get('/workflows/agent%3Arfp')
        .expect(200)
        .expect(({ body }) =>
          expect(body).toMatchObject({ id: 'agent:rfp', name: 'RFP Builder' }),
        );
      await request(server).get('/workflows/agent:rfp').expect(200);
      expect(service.get).toHaveBeenCalledWith('agent:rfp');
      await request(server)
        .get('/workflows/agent%3Anope')
        .expect(404)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            message: 'Workflow "agent:nope" not found',
          }),
        );
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
  it('answers 200 with the run result, and a refusal with its status', async () => {
    const result = { workflowId: 'seq-text-demo', status: 'failed', steps: [] };
    const service = {
      run: jest.fn((id: string, body: unknown) =>
        id === 'seq-text-demo'
          ? Promise.resolve({ ...result, body })
          : Promise.reject(
              new BadRequestException(`Workflow "${id}" can't run on an input`),
            ),
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
      await request(server)
        .post('/workflows/seq-text-demo/runs')
        .send({ input: { text: '   ' } })
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual({
            ...result,
            body: { input: { text: '   ' } },
          }),
        );
      await request(server)
        .post('/workflows/agent%3Aassistant/runs')
        .send({ input: {} })
        .expect(400)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            message: 'Workflow "agent:assistant" can\'t run on an input',
          }),
        );
      expect(service.run).toHaveBeenLastCalledWith('agent:assistant', {
        input: {},
      });
    } finally {
      await app.close();
    }
  });
});
