/**
 * API-level proof of the workflow catalogue (specs/capabilities/workflows
 * R1-R4; api.md 116, 117, 3, 2.1 and 34; ADR-0040): `GET /workflows` lists
 * the assistant's, Questions to Insights v2's and the Official agents'
 * workflows and one per Live user agent, `GET /workflows/:id` answers 404
 * for System and draft-only agents, `POST /sessions { workflowId }` starts a
 * session bound to that workflow, every session read carries `workflowRef`,
 * and an agent's detail says which workflows use it.
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
  picksDatasets: boolean;
  datasets: string[];
  chatRequirement?: string;
}

interface SessionView {
  id: string;
  name: string;
  datasets: string[];
  agentKey?: string;
  agentName?: string;
  workflowId?: string;
  workflowRef?: { id: string; name: string; kind: string; deleted: boolean };
}

interface Answer {
  ok: boolean;
  message: string;
  session?: SessionView;
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
  const createSession = async (body: object) =>
    (await http().post('/sessions').send(body)).body as Answer;

  beforeAll(async () => {
    backend = await boot(dataDir);
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('lists the four Official workflows on a fresh data dir, in catalogue order', async () => {
    const listed = await workflows();
    expect(listed.map((w) => w.id)).toEqual([
      'agent:assistant',
      'qti-v2-turn',
      'agent:data-readiness',
      'agent:rfp',
    ]);
    expect(listed[0]).toMatchObject({
      name: 'Assistant',
      kind: 'agent',
      picksDatasets: true,
      stepCount: 1,
    });
    expect(listed[0]).not.toHaveProperty('chatRequirement');
    expect(listed[1]).toMatchObject({
      name: 'Questions to Insights v2',
      kind: 'code',
      stepCount: 4,
      agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
    });
    expect(listed[1]).not.toHaveProperty('chatRequirement');
    expect(listed[2]).toMatchObject({
      name: 'Data Readiness Agent',
      chatRequirement: 'Add a PostgreSQL or Databricks dataset first',
    });
    expect(listed[3]).toMatchObject({
      name: 'RFP Builder',
      chatRequirement:
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
        'agent:data-readiness',
        'agent:rfp',
        `agent:${liveId}`,
      ]);
      expect(listed[4]).toMatchObject({
        name: 'Cup historian',
        kind: 'agent',
        owner: 'You',
        agents: [{ key: liveId, name: 'Cup historian' }],
        datasets: ['World Cup Core'],
      });
      expect(listed[4]).not.toHaveProperty('chatRequirement');
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

    it('POST /sessions { workflowId: qti-v2-turn } binds the session to v2 and its workflow', async () => {
      const answer = await createSession({
        workflowId: 'qti-v2-turn',
        name: 'v2 chat',
        datasets: ['World Cup Core'],
      });
      expect(answer).toMatchObject({
        ok: true,
        message: 'Session "v2 chat" created',
        session: {
          name: 'v2 chat',
          datasets: ['World Cup Core'],
          agentKey: 'assistant-v2',
          workflowId: 'qti-v2-turn',
          workflowRef: {
            id: 'qti-v2-turn',
            name: 'Questions to Insights v2',
            kind: 'code',
            deleted: false,
          },
        },
      });
      const read = (
        await http().get(`/sessions/${answer.session!.id}`).expect(200)
      ).body as SessionView;
      expect(read.workflowRef?.name).toBe('Questions to Insights v2');
    });

    it('refuses workflowId with agentId, and an unknown workflow id', async () => {
      expect(
        await createSession({ workflowId: 'qti-v2-turn', agentId: liveId }),
      ).toEqual({ ok: false, message: 'Send workflowId or agentId, not both' });
      expect(await createSession({ workflowId: 'nope' })).toEqual({
        ok: false,
        message: 'Workflow "nope" not found',
      });
      expect(await createSession({ workflowId: `agent:${draftId}` })).toEqual({
        ok: false,
        message: `Workflow "agent:${draftId}" not found`,
      });
    });

    it('a session created with a plain body runs agent:assistant', async () => {
      const answer = await createSession({
        name: 'Plain chat',
        datasets: ['World Cup Core'],
      });
      expect(answer.session).toMatchObject({
        workflowId: 'agent:assistant',
        workflowRef: { id: 'agent:assistant', name: 'Assistant' },
      });
      const listed = (
        (await http().get('/sessions').expect(200)).body as {
          sessions: SessionView[];
        }
      ).sessions.find((session) => session.id === answer.session!.id);
      expect(listed?.workflowRef?.id).toBe('agent:assistant');
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
});
