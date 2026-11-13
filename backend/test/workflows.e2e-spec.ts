/**
 * API-level proof of the workflow catalogue (specs/capabilities/workflows
 * R1-R4; api.md 116, 117, 118 and 34; ADR-0040): since 1.23.35 `GET
 * /workflows` lists only Questions to Insights v2 (`qti-v2-turn`); agents
 * are a library, so no agent gets a workflow (`agent:*` answers 404, as do
 * the removed `seq-text-demo` and `deep-analysis`), and an agent's detail
 * says only `assistant-v2` is used in a workflow. Runs that reach the model
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
  'agent:assistant',
  'agent:data-readiness',
  'seq-text-demo',
  'deep-analysis',
  'agent:assistant-v2',
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

  it('lists only Questions to Insights v2 on a fresh data dir (1.23.35)', async () => {
    const listed = await workflows();
    expect(listed).toEqual([
      {
        id: 'qti-v2-turn',
        name: 'Answer a Business Question',
        description: expect.any(String) as string,
        kind: 'code',
        owner: 'Official',
        // Michael analyses; Olivia plans and Jessica writes (agents.md 5.11).
        agents: [
          { key: 'assistant-v2', name: 'Michael' },
          { key: 'analysis-planner', name: 'Olivia' },
          { key: 'answer-writer', name: 'Jessica' },
        ],
        stepCount: 8,
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
      expect((await workflows()).map((w) => w.id)).toEqual(['qti-v2-turn']);
      await notFound(`agent:${liveId}`);
      await notFound(`agent:${draftId}`);
    });

    it('GET /workflows/qti-v2-turn details its steps and the agent they call', async () => {
      const v2 = (await http().get('/workflows/qti-v2-turn').expect(200))
        .body as {
        input: Record<string, unknown>[];
        steps: {
          id: string;
          agent?: { key: string; tools: string[] };
          exits: { label: string; outcome: string }[];
        }[];
        agents: { key: string; name: string; model: string | null }[];
      };
      expect(v2.steps.map((step) => step.id)).toEqual([
        'receive-question',
        'load-catalog',
        'plan',
        'clarify',
        'analyse',
        'validate',
        'write-answer',
        'wrap-up',
      ]);
      // The Start node: each field with its rules and the steps reading it.
      expect(
        v2.input.map(({ name, required, maxLength, usedBy }) => ({
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
          usedBy: ['receive-question'],
        },
        {
          name: 'datasets',
          required: true,
          maxLength: undefined,
          usedBy: ['receive-question'],
        },
      ]);
      // Receive question no longer fails on an empty question: the input
      // node refuses it before the run.
      expect(v2.steps[0].exits).toEqual([]);
      expect(v2.steps.flatMap((step) => step.exits)).not.toContainEqual(
        expect.objectContaining({ label: 'Empty question' }),
      );
      // Olivia plans, Michael analyses with his tools, Jessica writes.
      expect(
        v2.steps
          .filter((step) => step.agent)
          .map((step) => [step.id, step.agent?.key, step.agent?.tools.length]),
      ).toEqual([
        ['plan', 'analysis-planner', 0],
        ['analyse', 'assistant-v2', 5],
        ['write-answer', 'answer-writer', 0],
      ]);
      expect(v2.agents).toEqual([
        {
          key: 'assistant-v2',
          name: 'Michael',
          model: null,
          systemPrompt: expect.any(String) as string,
          toolDetails: expect.any(Array) as unknown[],
        },
        // Olivia and Jessica: their job descriptions, no tools.
        {
          key: 'analysis-planner',
          name: 'Olivia',
          model: null,
          systemPrompt: expect.stringMatching(
            /^You plan a data analysis for Questions to Insights\./,
          ) as string,
          toolDetails: [],
        },
        {
          key: 'answer-writer',
          name: 'Jessica',
          model: null,
          systemPrompt: expect.stringMatching(
            /^You write the final answer for Questions to Insights\./,
          ) as string,
          toolDetails: [],
        },
      ]);
      // Its tools are the ones GET /agents/:key lists (api.md 34).
      const agent = (await http().get('/agents/assistant-v2').expect(200))
        .body as { toolDetails: unknown[] };
      const [detail] = v2.agents as unknown as { toolDetails: unknown[] }[];
      expect(detail.toolDetails).toEqual(agent.toolDetails);
      expect(detail.toolDetails).toContainEqual(
        expect.objectContaining({
          name: 'run_readonly_sql',
          description: expect.any(String) as string,
          inputs: expect.arrayContaining(['sql']) as string[],
        }),
      );
    });

    it('GET /workflows/qti-v2-turn gives every step its declared JSON Schemas and the workflow its contractHash (agents.md 5.12)', async () => {
      const v2 = (await http().get('/workflows/qti-v2-turn').expect(200))
        .body as {
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
      };
      expect(v2.contractHash).toMatch(/^[0-9a-f]{12}$/);
      for (const step of v2.steps) {
        expect(step.inputSchema.type).toBe('object');
        expect(step.outputSchema.type).toBe('object');
        // The field names are derived from the schemas, in schema order.
        expect(Object.keys(step.inputSchema.properties)).toEqual(step.input);
        expect(Object.keys(step.outputSchema.properties)).toEqual(step.output);
      }
      const analyse = v2.steps.find((step) => step.id === 'analyse')!;
      expect(analyse.inputSchema).toMatchObject({
        properties: {
          question: { type: 'string', description: 'The trimmed question.' },
          catalog: { type: 'array', items: { type: 'object' } },
          plan: { type: 'object' },
        },
        required: ['question', 'catalog', 'plan'],
      });
      expect(analyse.outputSchema.properties).toMatchObject({
        calls: {
          type: 'array',
          items: {
            properties: { rowCount: { type: 'number' } },
            required: ['tool', 'failed'],
          },
        },
        queries: { type: 'array' },
        stopped: { type: 'boolean' },
      });
      // Write answer's output is the answer (AnswerOutput) and the calls.
      const written = v2.steps.find((step) => step.id === 'write-answer')!;
      expect(written.output).toEqual(['headline', 'answer', 'calls']);
      // The flow is its edges (117): a branch after Plan, a loop back from
      // Clarify to Plan once answered, a loop back from Validate to
      // Analyse, End after Wrap up.
      const { edges } = (await http().get('/workflows/qti-v2-turn').expect(200))
        .body as {
        edges: { from: string; to: string; kind: string; label?: string }[];
      };
      expect(edges).toEqual([
        { from: 'start', to: 'receive-question', kind: 'next' },
        { from: 'receive-question', to: 'load-catalog', kind: 'next' },
        { from: 'load-catalog', to: 'plan', kind: 'next' },
        {
          from: 'plan',
          to: 'clarify',
          kind: 'branch',
          label: 'Needs clarification',
        },
        { from: 'clarify', to: 'plan', kind: 'loop', label: 'Answered' },
        { from: 'plan', to: 'analyse', kind: 'branch', label: 'Clear' },
        { from: 'analyse', to: 'validate', kind: 'next' },
        { from: 'validate', to: 'analyse', kind: 'loop', label: 'Retry once' },
        {
          from: 'validate',
          to: 'write-answer',
          kind: 'next',
          label: 'Valid or retried',
        },
        { from: 'write-answer', to: 'wrap-up', kind: 'next' },
        { from: 'wrap-up', to: 'end', kind: 'next' },
      ]);
      // 116 is unchanged: the summary carries neither.
      const [summary] = await workflows();
      expect(summary).not.toHaveProperty('edges');
      expect(summary).not.toHaveProperty('contractHash');
      // The same hash on every read.
      const again = (await http().get('/workflows/qti-v2-turn').expect(200))
        .body as { contractHash: string };
      expect(again.contractHash).toBe(v2.contractHash);
    });

    it("an agent's detail says which workflows use it: Michael, Olivia and Jessica are used in one", async () => {
      const used = async (key: string) =>
        (
          (await http().get(`/agents/${key}`).expect(200)).body as {
            usedInWorkflows: { id: string; name: string }[];
          }
        ).usedInWorkflows;
      for (const key of ['assistant-v2', 'analysis-planner', 'answer-writer']) {
        expect({ key, used: await used(key) }).toEqual({
          key,
          used: [{ id: 'qti-v2-turn', name: 'Answer a Business Question' }],
        });
      }
      for (const key of ['assistant', 'data-readiness', liveId, draftId]) {
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
    ])('qti-v2-turn refuses %p with 400 %p', async (body, message) => {
      const res = await runs('qti-v2-turn').send(body).expect(400);
      expect((res.body as { message: string }).message).toBe(message);
    });

    it('refuses a blank question and no datasets with both errors (the whole input at once)', async () => {
      const res = await runs('qti-v2-turn')
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
