/**
 * API-level proof of the workflow catalogue (specs/capabilities/workflows
 * R1-R4; api.md 116, 117, 3, 2.1 and 34; ADR-0040): `GET /workflows` lists
 * the assistant's, Questions to Insights v2's and the Official agents'
 * workflows and one per Live user agent, `GET /workflows/:id` answers 404
 * for System and draft-only agents, and an agent's detail says which
 * workflows use it. The sequential test
 * workflow runs once on a text (`POST /workflows/:id/runs`, api.md 118;
 * workflows R11); no workflow starts a chat.
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
  runRequirement?: string;
}

interface Answer {
  ok: boolean;
  message: string;
  agent?: { id: string };
}

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

  it('lists the six Official workflows on a fresh data dir, in catalogue order', async () => {
    const listed = await workflows();
    expect(listed.map((w) => w.id)).toEqual([
      'agent:assistant',
      'qti-v2-turn',
      'seq-text-demo',
      'deep-analysis',
      'agent:data-readiness',
      'agent:rfp',
    ]);
    // Every workflow runs on its input; the `chat` trigger is gone (1.23.22).
    expect(listed.map((w) => w.trigger)).toEqual([
      'run',
      'run',
      'run',
      'run',
      'run',
      'run',
    ]);
    for (const workflow of listed) {
      expect(workflow).not.toHaveProperty('picksDatasets');
      expect(workflow).not.toHaveProperty('chatRequirement');
    }
    expect(listed[0]).toMatchObject({
      name: 'Assistant',
      kind: 'agent',
      stepCount: 1,
    });
    expect(listed[0]).not.toHaveProperty('runRequirement');
    expect(listed[1]).toMatchObject({
      name: 'Questions to Insights v2',
      kind: 'code',
      stepCount: 4,
      agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
    });
    expect(listed[1]).not.toHaveProperty('runRequirement');
    expect(listed[1].input.map((field) => field.name)).toEqual([
      'question',
      'datasets',
    ]);
    expect(listed[2]).toMatchObject({
      name: 'Sequential test workflow',
      kind: 'code',
      stepCount: 3,
      agents: [],
      input: [
        {
          name: 'text',
          label: 'Text',
          type: 'textarea',
          required: true,
          placeholder: 'Paste or type any text',
        },
      ],
    });
    // Deep analysis (plan 1.25.3): a run workflow whose steps call the assistant.
    expect(listed[3]).toMatchObject({
      name: 'Deep analysis',
      kind: 'code',
      stepCount: 4,
      agents: [{ key: 'assistant' }],
    });
    expect(listed[4]).toMatchObject({
      name: 'Data Readiness Agent',
      runRequirement: 'Add a PostgreSQL or Databricks dataset first',
    });
    expect(listed[5]).toMatchObject({
      name: 'RFP Builder',
      runRequirement:
        'Load the "Intellify RFP API" sample in Settings → Testing Data first',
    });
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

    it('a published user agent adds its one-step workflow; a draft-only one does not', async () => {
      const listed = await workflows();
      expect(listed.map((w) => w.id)).toEqual([
        'agent:assistant',
        'qti-v2-turn',
        'seq-text-demo',
        'deep-analysis',
        'agent:data-readiness',
        'agent:rfp',
        `agent:${liveId}`,
      ]);
      expect(listed[6]).toMatchObject({
        name: 'Cup historian',
        kind: 'agent',
        owner: 'You',
        agents: [{ key: liveId, name: 'Cup historian' }],
        datasets: ['World Cup Core'],
      });
      expect(listed[6]).not.toHaveProperty('chatRequirement');
    });

    it('GET /workflows/:id answers 404 for a System agent and a draft-only agent', async () => {
      for (const id of ['agent:sql-fixer', `agent:${draftId}`]) {
        const res = await http()
          .get(`/workflows/${encodeURIComponent(id)}`)
          .expect(404);
        expect((res.body as { message: string }).message).toBe(
          `Workflow "${id}" not found`,
        );
      }
      await http().get('/workflows/agent:sql-fixer').expect(404);
    });

    it('GET /workflows/:id resolves an encoded id with its steps', async () => {
      const rfp = (await http().get('/workflows/agent%3Arfp').expect(200))
        .body as WorkflowSummary & { steps: { id: string }[] };
      expect(rfp).toMatchObject({ id: 'agent:rfp', name: 'RFP Builder' });
      expect(rfp.steps.map((step) => step.id)).toEqual(['answer']);
      const v2 = (await http().get('/workflows/qti-v2-turn').expect(200))
        .body as { steps: { id: string }[] };
      expect(v2.steps.map((step) => step.id)).toEqual([
        'receive-question',
        'load-catalog',
        'analyse',
        'wrap-up',
      ]);
    });

    it("an agent's detail says which workflows use it", async () => {
      const v2 = (await http().get('/agents/assistant-v2').expect(200))
        .body as { usedInWorkflows: { id: string; name: string }[] };
      expect(v2.usedInWorkflows).toEqual([
        { id: 'qti-v2-turn', name: 'Questions to Insights v2' },
      ]);
      const live = (await http().get(`/agents/${liveId}`).expect(200)).body as {
        usedInWorkflows: { id: string; name: string }[];
      };
      expect(live.usedInWorkflows).toEqual([
        { id: `agent:${liveId}`, name: 'Cup historian' },
      ]);
      const draft = (await http().get(`/agents/${draftId}`).expect(200))
        .body as { usedInWorkflows: unknown[] };
      expect(draft.usedInWorkflows).toEqual([]);
    });
  });

  describe('running a workflow on an input (api.md 118; workflows R11)', () => {
    interface RunResult {
      workflowId: string;
      status: 'success' | 'failed';
      steps: {
        id: string;
        title: string;
        status: string;
        output?: Record<string, unknown>;
        error?: string;
      }[];
      output?: Record<string, unknown>;
      error?: string;
    }
    const runs = (id: string) =>
      http().post(`/workflows/${encodeURIComponent(id)}/runs`);

    it('runs seq-text-demo on a text: three steps succeed and the output has the summary', async () => {
      const res = await runs('seq-text-demo')
        .send({ input: { text: '  Hello   workflow   world  ' } })
        .expect(200);
      const run = res.body as RunResult;
      expect(run).toEqual({
        workflowId: 'seq-text-demo',
        status: 'success',
        steps: [
          {
            id: 'clean-text',
            title: 'Clean text',
            status: 'success',
            output: { text: 'Hello workflow world' },
          },
          {
            id: 'count-words',
            title: 'Count words',
            status: 'success',
            output: { text: 'Hello workflow world', words: 3, characters: 20 },
          },
          {
            id: 'format-result',
            title: 'Format result',
            status: 'success',
            output: {
              summary: '3 words, 20 characters: "Hello workflow world"',
            },
          },
        ],
        output: { summary: '3 words, 20 characters: "Hello workflow world"' },
        // The stored run (1.23.14; api.md 121).
        runId: expect.any(String) as string,
      });
    });

    it('a text of only spaces fails Clean text and skips the others, still 200', async () => {
      const run = (
        await runs('seq-text-demo')
          .send({ input: { text: '   ' } })
          .expect(200)
      ).body as RunResult;
      expect(run).toEqual({
        workflowId: 'seq-text-demo',
        status: 'failed',
        steps: [
          {
            id: 'clean-text',
            title: 'Clean text',
            status: 'failed',
            error: 'The text is empty',
          },
          { id: 'count-words', title: 'Count words', status: 'skipped' },
          { id: 'format-result', title: 'Format result', status: 'skipped' },
        ],
        error: 'The text is empty',
        runId: expect.any(String) as string,
      });
    });

    it('refuses a missing text (400), an agent run without its question (400) and an unknown id (404)', async () => {
      const missing = await runs('seq-text-demo')
        .send({ input: {} })
        .expect(400);
      expect((missing.body as { message: string }).message).toBe(
        'Text is required',
      );
      // An agent workflow runs on its own input since 1.23.12.
      const chat = await runs('agent:assistant')
        .send({ input: { text: 'Hi' } })
        .expect(400);
      expect((chat.body as { message: string }).message).toBe(
        'Question is required',
      );
      const unknown = await runs('nope').send({ input: {} }).expect(404);
      expect((unknown.body as { message: string }).message).toBe(
        'Workflow "nope" not found',
      );
    });
  });
});
