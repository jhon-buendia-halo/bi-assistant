/**
 * API-level proof of the workflow catalogue (specs/capabilities/workflows
 * R1-R4; api.md 116, 117, 118 and 34; ADR-0040, ADR-0042): `GET
 * /workflows` lists the code workflows, Answer a Business Question
 * (Avery + Michael) (`orchestrated-answer-michael`, the only
 * question-answering one: `answer-business-question` and
 * `orchestrated-answer` were removed) and Assess Data Readiness
 * (`data-readiness-assessment`) first; agents are a library, so
 * no agent gets a workflow (`agent:*` answers 404, as do the removed
 * `seq-text-demo` and `deep-analysis`), and an agent's detail says which
 * workflows its steps run in. Runs that reach the model
 * are proved in workflow-runs.e2e-spec.ts; here only the refusals before
 * any model call.
 *
 * Needs no Postgres: the datasource points at a closed port, and saving a
 * dataset only samples it on a best-effort basis.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { type Backend, boot, stop } from './backend-process';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-workflows-'));

jest.setTimeout(120_000);

interface WorkflowSummary {
  id: string;
  name: string;
  kind: 'code' | 'agent';
  owner: 'Official' | 'You';
  agents: { key: string; name: string }[];
  stepCount: number;
  trigger: 'run';
  input: { name: string; label: string; type: string; required: boolean }[];
  datasets: string[];
}

interface Answer {
  ok: boolean;
  message: string;
  agent?: { id: string };
}

/** Every id a removed workflow had, and other ids the catalogue never held. */
const NOT_WORKFLOWS = [
  'answer-business-question',
  'orchestrated-answer',
  'recreate-dashboard',
  'map-dashboard-data',
  'review-website',
  'agent:assistant',
  'agent:data-readiness',
  'seq-text-demo',
  'deep-analysis',
  'agent:insights-analyst',
  'agent:sql-fixer',
  'agent:rfp',
  'agent-turn',
  'nope',
];

describe('The workflow catalogue (API)', () => {
  let backend: Backend | undefined;
  const http = () => request.agent(backend!.url);

  const ok = async (
    method: 'post' | 'put',
    path: string,
    body?: object,
  ): Promise<Answer> => {
    const answer = (await http()[method](path).send(body)).body as Answer;
    expect({ path, ok: answer.ok, message: answer.message }).toMatchObject({
      ok: true,
    });
    return answer;
  };
  const workflows = async () =>
    (
      (await http().get('/workflows').expect(200)).body as {
        workflows: WorkflowSummary[];
      }
    ).workflows;
  const notFound = async (id: string) => {
    const res = await http()
      .get(`/workflows/${encodeURIComponent(id)}`)
      .expect(404);
    expect((res.body as { message: string }).message).toBe(
      `Workflow "${id}" not found`,
    );
  };

  beforeAll(async () => {
    backend = await boot(dataDir);
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('GET /health answers { ok: true }: the desktop readiness probe (api.md 135)', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("lists Answer a Business Question (Avery + Michael) with Avery as its step's agent, and only its question and datasets as input (agents.md 5.23)", async () => {
    const listed = (await workflows()).find(
      (w) => w.id === 'orchestrated-answer-michael',
    )!;
    // No build-a-visual and no approve-steps input: both went with the
    // removed workflows.
    expect(listed.input.map((field) => field.name)).toEqual([
      'question',
      'datasets',
    ]);
    expect(listed.stepCount).toBe(1);
    expect(listed.agents).toEqual([
      { key: 'insights-analyst', name: 'Michael', role: 'Insights Analyst' },
      { key: 'chief-of-staff', name: 'Avery', role: 'Chief of Staff' },
    ]);
    const detail = (
      await http().get('/workflows/orchestrated-answer-michael').expect(200)
    ).body as {
      steps: { id: string; kind: string; agent?: { key: string } }[];
      exits?: unknown;
    };
    expect(detail.steps).toEqual([
      expect.objectContaining({
        id: 'orchestrate',
        kind: 'agent',
        agent: expect.objectContaining({ key: 'chief-of-staff' }) as object,
      }),
    ]);
    const avery = (await http().get('/agents/chief-of-staff').expect(200))
      .body as { name: string; usedInWorkflows: { id: string }[] };
    expect(avery).toMatchObject({ name: 'Avery' });
    expect(avery.usedInWorkflows.map((w) => w.id)).toEqual([
      'orchestrated-answer-michael',
    ]);
  });

  it('lists the two code workflows, Answer a Business Question (Avery + Michael) and Assess Data Readiness, on a fresh data dir (R1)', async () => {
    const listed = await workflows();
    expect(listed.map((w) => w.id)).toEqual([
      'orchestrated-answer-michael',
      'data-readiness-assessment',
    ]);
    expect([listed[0], listed[1]]).toEqual([
      {
        id: 'orchestrated-answer-michael',
        name: 'Answer a Business Question (Avery + Michael)',
        description: expect.any(String) as string,
        kind: 'code',
        owner: 'Official',
        category: { id: 'data-analytics', name: 'Data Analytics' },
        // A conversation with Avery (plan Elena 1.2, ADR-0058).
        conversational: true,
        // Michael analyses; Avery briefs him and is the only one you talk to.
        agents: [
          {
            key: 'insights-analyst',
            name: 'Michael',
            role: 'Insights Analyst',
          },
          { key: 'chief-of-staff', name: 'Avery', role: 'Chief of Staff' },
        ],
        stepCount: 1,
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
            usedBy: ['orchestrate'],
          },
          {
            name: 'datasets',
            label: 'Datasets',
            type: 'datasets',
            required: true,
            usedBy: ['orchestrate'],
          },
        ],
        datasets: [],
        missingDatasets: [],
        starterQuestions: [],
      },
      {
        id: 'data-readiness-assessment',
        name: 'Assess Data Readiness',
        description: expect.any(String) as string,
        kind: 'code',
        owner: 'Official',
        category: { id: 'data-engineering', name: 'Data Engineering' },
        agents: [
          {
            key: 'data-readiness',
            name: 'Sarah',
            role: 'Data Quality Analyst',
          },
        ],
        stepCount: 7,
        bar: 'steps',
        trigger: 'run',
        input: [
          {
            name: 'dataset',
            label: 'Dataset',
            type: 'dataset',
            required: true,
            datasourceKinds: ['postgres', 'databricks'],
            usedBy: ['resolve-dataset'],
          },
          {
            name: 'question',
            label: 'Question',
            type: 'textarea',
            required: false,
            placeholder: 'Assess the readiness of this dataset',
            default: 'Assess the readiness of this dataset',
            maxLength: 4000,
            // Resolve dataset runs first (agents.md 5.13), so it is the
            // step that takes the run's input.
            usedBy: ['resolve-dataset'],
          },
        ],
        datasets: [],
        missingDatasets: [],
        starterQuestions: [
          'Assess the readiness of this dataset',
          'What are the worst data-quality problems?',
          'Show my past assessments',
        ],
      },
    ]);
  });

  it.each(NOT_WORKFLOWS)('GET /workflows/%s answers 404', async (id) => {
    await notFound(id);
  });

  it('no longer has the RFP Builder, its workflow or the Intellify RFP API sample', async () => {
    expect((await workflows()).map((w) => w.id)).not.toContain('agent:rfp');
    const agent = await http().get('/agents/rfp').expect(404);
    expect((agent.body as { message: string }).message).toBe(
      'Agent "rfp" not found',
    );
    const agents = (await http().get('/agents').expect(200)).body as {
      agents: { key: string }[];
    };
    expect(agents.agents.map((a) => a.key)).not.toContain('rfp');
    const samples = (await http().get('/testing-data').expect(200)).body as {
      fixtures: { id: string }[];
    };
    expect(samples.fixtures.map((f) => f.id)).not.toContain('intellify-api');
    // The Postgres Intellify sample stays.
    expect(samples.fixtures.map((f) => f.id)).toContain('intellify');
    const load = await http()
      .post('/testing-data/intellify-api/load')
      .send({})
      .expect(200);
    expect(load.body).toEqual({
      ok: false,
      message: 'Unknown sample fixture "intellify-api"',
    });
  });

  it('no longer ships the deep-analysis skill', async () => {
    const skills = (await http().get('/skills/built-in').expect(200)).body as {
      skills: { name: string }[];
    };
    expect(skills.skills.map((skill) => skill.name)).not.toContain(
      'deep-analysis',
    );
  });

  describe('with a dataset and user agents', () => {
    let liveId = '';
    let draftId = '';

    beforeAll(async () => {
      const { datasource } = (await ok('post', '/datasources', {
        kind: 'postgres',
        name: 'Closed port',
        config: {
          host: '127.0.0.1',
          port: 1,
          database: 'none',
          user: 'none',
          password: 'none',
          ssl: false,
        },
      })) as Answer & { datasource: { id: string } };
      await ok('post', '/datasets', {
        name: 'World Cup Core',
        tables: ['world_cup.world_cup.matches'],
        entities: [
          {
            key: 'world_cup.world_cup.matches',
            columns: [
              { name: 'match_number', type: 'integer', nullable: false },
            ],
          },
        ],
        datasourceId: datasource.id,
        datasourceKind: 'postgres',
      });
      liveId = (
        await ok('post', '/agents', {
          name: 'Cup historian',
          description: 'Answers questions about World Cup history',
          instructions: 'Always name the tournament year.',
          datasets: ['World Cup Core'],
          starterQuestions: ['Who won in 2014?'],
        })
      ).agent!.id;
      await ok('post', `/agents/${liveId}/publish`);
      draftId = (
        await ok('post', '/agents', {
          name: 'Sketch',
          description: 'Not published yet',
          instructions: 'Draft.',
          datasets: ['World Cup Core'],
        })
      ).agent!.id;
    });

    it('a published user agent adds no workflow: agents are a library', async () => {
      expect((await workflows()).map((w) => w.id)).toEqual([
        'orchestrated-answer-michael',
        'data-readiness-assessment',
      ]);
      await notFound(`agent:${liveId}`);
      await notFound(`agent:${draftId}`);
    });

    it('GET /workflows/orchestrated-answer-michael details its one step and the agents it calls', async () => {
      const detail = (
        await http().get('/workflows/orchestrated-answer-michael').expect(200)
      ).body as {
        input: Record<string, unknown>[];
        steps: {
          id: string;
          agent?: {
            key: string;
            tools: string[];
            maxSteps: number;
            team: { tool: string; key: string }[];
          };
          exits: { label: string; outcome: string }[];
        }[];
        agents: { key: string; name: string; model: string | null }[];
      };
      expect(detail.steps.map((step) => step.id)).toEqual(['orchestrate']);
      // The Start node: each field with its rules and the steps reading it.
      expect(
        detail.input.map(({ name, required, maxLength, usedBy }) => ({
          name,
          required,
          maxLength,
          usedBy,
        })),
      ).toEqual([
        {
          name: 'question',
          required: true,
          maxLength: 4000,
          usedBy: ['orchestrate'],
        },
        {
          name: 'datasets',
          required: true,
          maxLength: undefined,
          usedBy: ['orchestrate'],
        },
      ]);
      // Avery's turn is the one step: her tools are her team and her own.
      const [orchestrate] = detail.steps;
      expect(orchestrate.agent).toMatchObject({
        key: 'chief-of-staff',
        tools: [
          'answer_from_data',
          'build_dashboard',
          'export_conversation',
          'ask_clarification',
        ],
        maxSteps: 16,
      });
      expect(orchestrate.agent!.team.map((member) => member.tool)).toEqual([
        'answer_from_data',
        'build_dashboard',
      ]);
      expect(orchestrate.exits.map((exit) => exit.outcome)).toEqual([
        'fails',
        'stops',
        'waits',
      ]);
      expect(detail.agents.map((agent) => agent.key)).toEqual([
        'insights-analyst',
        'chief-of-staff',
      ]);
      // Michael works through Avery's `answer_from_data`, so the workflow
      // lists him as a job description; his own tools are his agent's.
      const [michael] = detail.agents as unknown as {
        toolDetails: unknown[];
      }[];
      expect(michael.toolDetails).toEqual([]);
      const agent = (await http().get('/agents/insights-analyst').expect(200))
        .body as { toolDetails: unknown[] };
      expect(agent.toolDetails).toContainEqual(
        expect.objectContaining({
          name: 'run_readonly_sql',
          description: expect.any(String) as string,
          inputs: expect.arrayContaining(['sql']) as string[],
        }),
      );
    });

    it('GET /workflows/orchestrated-answer-michael gives its step its declared JSON Schemas and the workflow its contractHash (agents.md 5.12)', async () => {
      const detail = (
        await http().get('/workflows/orchestrated-answer-michael').expect(200)
      ).body as {
        contractHash: string;
        steps: {
          id: string;
          input: string[];
          output: string[];
          inputSchema: {
            type: string;
            properties: Record<string, { type?: unknown }>;
            required: string[];
          };
          outputSchema: {
            type: string;
            properties: Record<string, { type?: unknown }>;
            required: string[];
          };
        }[];
        edges: { from: string; to: string; kind: string; label?: string }[];
      };
      expect(detail.contractHash).toMatch(/^[0-9a-f]{12}$/);
      for (const step of detail.steps) {
        expect(step.inputSchema.type).toBe('object');
        expect(step.outputSchema.type).toBe('object');
        // The field names are derived from the schemas, in schema order.
        expect(Object.keys(step.inputSchema.properties)).toEqual(step.input);
        expect(Object.keys(step.outputSchema.properties)).toEqual(step.output);
      }
      const [orchestrate] = detail.steps;
      expect(orchestrate.inputSchema).toMatchObject({
        properties: {
          question: { type: 'string' },
          datasets: { type: 'array', items: { type: 'string' } },
        },
        required: ['question', 'datasets'],
      });
      // Its output is the run's answer.
      expect(orchestrate.output).toEqual(['answer']);
      expect(orchestrate.outputSchema.required).toEqual(['answer']);
      // The flow is its edges (117): Start, Orchestrate, End.
      expect(detail.edges).toEqual([
        { from: 'start', to: 'orchestrate', kind: 'next' },
        { from: 'orchestrate', to: 'end', kind: 'next' },
      ]);
      // 116 is unchanged: the summary carries neither.
      const [summary] = await workflows();
      expect(summary).not.toHaveProperty('edges');
      expect(summary).not.toHaveProperty('contractHash');
      // The same hash on every read.
      const again = (
        await http().get('/workflows/orchestrated-answer-michael').expect(200)
      ).body as { contractHash: string };
      expect(again.contractHash).toBe(detail.contractHash);
    });

    it("an agent's detail says which workflows use it: Michael and Avery in one, Sarah in the other, the removed pipeline's agents in none", async () => {
      const used = async (key: string) =>
        (
          (await http().get(`/agents/${key}`).expect(200)).body as {
            usedInWorkflows: { id: string; name: string }[];
          }
        ).usedInWorkflows;
      for (const key of ['insights-analyst', 'chief-of-staff']) {
        expect({ key, used: await used(key) }).toEqual({
          key,
          used: [
            {
              id: 'orchestrated-answer-michael',
              name: 'Answer a Business Question (Avery + Michael)',
            },
          ],
        });
      }
      // Sarah runs every agent step of Assess Data Readiness only.
      expect(await used('data-readiness')).toEqual([
        { id: 'data-readiness-assessment', name: 'Assess Data Readiness' },
      ]);
      // Olivia, Jessica and Ryan ran in the removed workflow only.
      for (const key of [
        'analysis-planner',
        'answer-writer',
        'visualization',
        'assistant',
        liveId,
        draftId,
      ]) {
        expect({ key, used: await used(key) }).toEqual({ key, used: [] });
      }
    });

    it('no agent carries a run requirement on the wire', async () => {
      const agents = (await http().get('/agents').expect(200)).body as {
        agents: Record<string, unknown>[];
      };
      for (const agent of agents.agents) {
        expect(agent).not.toHaveProperty('chatRequirement');
      }
    });
  });

  describe('running a workflow on an input: refusals before any model call (api.md 118)', () => {
    const runs = (id: string) =>
      http().post(`/workflows/${encodeURIComponent(id)}/runs`);

    it.each([
      [{ input: { datasets: ['World Cup Core'] } }, 'Question is required'],
      [
        { input: { question: '   ', datasets: ['World Cup Core'] } },
        'Question is required',
      ],
      [{ input: { question: 'Hi' } }, 'Select at least one dataset'],
      [
        { input: { question: 'Hi', datasets: ['Nope'] } },
        'Dataset "Nope" not found',
      ],
      [
        { input: { question: 'x'.repeat(4001), datasets: ['World Cup Core'] } },
        'Question must be at most 4000 characters',
      ],
    ])(
      'orchestrated-answer-michael refuses %p with 400 %p',
      async (body, message) => {
        const res = await runs('orchestrated-answer-michael')
          .send(body)
          .expect(400);
        expect((res.body as { message: string }).message).toBe(message);
      },
    );

    it('refuses a blank question and no datasets with both errors (the whole input at once)', async () => {
      const res = await runs('orchestrated-answer-michael')
        .send({ input: { question: ' \n ', datasets: [] } })
        .expect(400);
      expect(res.body).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Question is required',
        errors: [
          { field: 'question', message: 'Question is required' },
          { field: 'datasets', message: 'Select at least one dataset' },
        ],
      });
    });

    it('refuses asking one agent: no workflow takes `context.askStep` any more (400)', async () => {
      const res = await runs('orchestrated-answer-michael')
        .send({
          input: { question: 'Hi', datasets: ['World Cup Core'] },
          context: { askStep: 'plan' },
        })
        .expect(400);
      expect((res.body as { message: string }).message).toBe(
        'Workflow "orchestrated-answer-michael" can\'t ask one agent',
      );
    });

    it.each(NOT_WORKFLOWS)('%s answers 404', async (id) => {
      const res = await runs(id)
        .send({ input: { question: 'Hi', text: 'Hi' } })
        .expect(404);
      expect((res.body as { message: string }).message).toBe(
        `Workflow "${id}" not found`,
      );
    });

    it('a refused run is never stored', async () => {
      const history = (await http().get('/workflow-runs').expect(200)).body as {
        runs: unknown[];
      };
      expect(history.runs).toEqual([]);
    });
  });
});
