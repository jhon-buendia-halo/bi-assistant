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
        name: 'Questions to Insights v2',
        description: expect.any(String) as string,
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
          },
          {
            name: 'datasets',
            label: 'Datasets',
            type: 'datasets',
            required: true,
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
        steps: { id: string; agent?: { key: string } }[];
        agents: { key: string; name: string; model: string | null }[];
      };
      expect(v2.steps.map((step) => step.id)).toEqual([
        'receive-question',
        'load-catalog',
        'analyse',
        'wrap-up',
      ]);
      expect(
        v2.steps.filter((step) => step.agent).map((step) => step.agent?.key),
      ).toEqual(['assistant-v2']);
      expect(v2.agents).toEqual([
        {
          key: 'assistant-v2',
          name: 'Questions to Insights v2',
          model: null,
          systemPrompt: expect.any(String) as string,
        },
      ]);
    });

    it("an agent's detail says which workflows use it: only assistant-v2 is used in one", async () => {
      const used = async (key: string) =>
        (
          (await http().get(`/agents/${key}`).expect(200)).body as {
            usedInWorkflows: { id: string; name: string }[];
          }
        ).usedInWorkflows;
      expect(await used('assistant-v2')).toEqual([
        { id: 'qti-v2-turn', name: 'Questions to Insights v2' },
      ]);
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
      [{ input: { question: 'Hi' } }, 'Select at least one dataset'],
      [
        { input: { question: 'Hi', datasets: ['Nope'] } },
        'Dataset "Nope" not found',
      ],
    ])('qti-v2-turn refuses %p with 400 %p', async (body, message) => {
      const res = await runs('qti-v2-turn').send(body).expect(400);
      expect((res.body as { message: string }).message).toBe(message);
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
