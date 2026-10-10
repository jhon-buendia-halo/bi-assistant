/**
 * API-level proof of R52 and R57-R59 in specs/capabilities/sessions-chat/spec.md
 * ("Sessions started from an agent"): `POST /sessions` with an `agentId`
 * takes the agent's Live name and existing datasets, refuses unknown,
 * built-in, unpublished and dataset-less agents, and every session read
 * carries the derived `agent` field, including after the agent is deleted
 * and after a backend restart. The turns themselves are proven by the
 * Playwright spec `frontend/e2e/agent-sessions.spec.ts`. Preview sessions
 * (agents-evals R60, R61; data-model 3.12) are covered here too.
 *
 * Needs no Postgres: the datasource points at a closed port, and saving a
 * dataset only samples it on a best-effort basis.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { type Backend, boot, stop } from './backend-process';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-agent-sessions-'));

jest.setTimeout(120_000);

interface AgentRef {
  id: string;
  name: string;
  deleted: boolean;
  description: string;
  starterQuestions: string[];
}

interface SessionView {
  id: string;
  name: string;
  datasets: string[];
  agentId?: string;
  agentName?: string;
  preview?: boolean;
  agent?: AgentRef;
}

interface Answer {
  ok: boolean;
  message: string;
  session?: SessionView;
  agent?: { id: string };
}

describe('Sessions started from an agent (API)', () => {
  let backend: Backend | undefined;
  const http = () => request(backend!.url);

  const ok = async (
    method: 'post' | 'put' | 'delete',
    path: string,
    body?: object,
  ): Promise<Answer> => {
    const res = await http()[method](path).send(body);
    const answer = res.body as Answer;
    expect(answer.message).toBeDefined();
    expect({ path, ok: answer.ok, message: answer.message }).toMatchObject({
      ok: true,
    });
    return answer;
  };
  const startFrom = async (agentId: string, body: object = {}) =>
    (
      await http()
        .post('/sessions')
        .send({ agentId, ...body })
    ).body as Answer;
  const getSession = async (id: string) =>
    (await http().get(`/sessions/${id}`).expect(200)).body as SessionView;
  const listed = async (id: string) =>
    (
      (await http().get('/sessions').expect(200)).body as {
        sessions: SessionView[];
      }
    ).sessions.find((session) => session.id === id);

  const historian = {
    name: 'Cup historian',
    description: 'Answers questions about World Cup history',
    instructions: 'Always name the tournament year.',
    datasets: ['World Cup Core', 'Gone'],
    starterQuestions: ['Who won in 2014?', 'Which country hosted in 2002?'],
  };
  let historianId = '';
  let sessionId = '';

  beforeAll(async () => {
    backend = await boot(dataDir);
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
    for (const name of ['World Cup Core', 'Scratch']) {
      await ok('post', '/datasets', {
        name,
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
    }
    historianId = (await ok('post', '/agents', historian)).agent!.id;
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('refuses an agent that is not Live yet', async () => {
    expect(await startFrom(historianId)).toEqual({
      ok: false,
      message: 'Publish "Cup historian" before starting a chat',
    });
  });

  it('refuses unknown ids and built-in agents', async () => {
    expect(await startFrom('no-such-agent')).toEqual({
      ok: false,
      message: 'Agent "no-such-agent" not found',
    });
    expect(await startFrom('assistant')).toEqual({
      ok: false,
      message: 'Agent "assistant" not found',
    });
  });

  it("creates a session from the Live agent, dropping missing datasets and ignoring the body's name and datasets", async () => {
    await ok('post', `/agents/${historianId}/publish`);
    const answer = await startFrom(historianId, {
      name: 'Ignored',
      datasets: ['Scratch'],
    });
    expect(answer).toMatchObject({
      ok: true,
      message: 'Session "Cup historian" created',
      session: {
        name: 'Cup historian',
        datasets: ['World Cup Core'],
        agentId: historianId,
        agentName: 'Cup historian',
        agent: {
          id: historianId,
          name: 'Cup historian',
          deleted: false,
          description: historian.description,
          starterQuestions: historian.starterQuestions,
        },
      },
    });
    sessionId = answer.session!.id;
    expect((await getSession(sessionId)).agent).toMatchObject({
      name: 'Cup historian',
      deleted: false,
    });
    expect((await listed(sessionId))?.agent).toMatchObject({
      name: 'Cup historian',
      deleted: false,
    });
  });

  it('refuses an agent none of whose datasets exist', async () => {
    const scratchId = (
      await ok('post', '/agents', {
        name: 'Scratch analyst',
        datasets: ['Scratch'],
      })
    ).agent!.id;
    await ok('post', `/agents/${scratchId}/publish`);
    await ok('delete', '/datasets/Scratch');
    expect(await startFrom(scratchId)).toEqual({
      ok: false,
      message: "None of this agent's datasets exist",
    });
  });

  it('a plain session carries no agent', async () => {
    const answer = await ok('post', '/sessions', {
      name: 'Plain',
      datasets: ['World Cup Core'],
    });
    expect(answer.session).not.toHaveProperty('agentId');
    expect(answer.session).not.toHaveProperty('agent');
  });

  it('shows the Live name, never the draft, and keeps the session name', async () => {
    await ok('put', `/agents/${historianId}/draft`, {
      ...historian,
      name: 'Draft-only name',
    });
    expect((await getSession(sessionId)).agent?.name).toBe('Cup historian');

    await ok('put', `/agents/${historianId}/draft`, {
      ...historian,
      name: 'Cup historian II',
      starterQuestions: ['Who scored most?'],
    });
    await ok('post', `/agents/${historianId}/publish`);
    const session = await getSession(sessionId);
    expect(session.name).toBe('Cup historian');
    expect(session.agent).toMatchObject({
      name: 'Cup historian II',
      starterQuestions: ['Who scored most?'],
    });
  });

  const workspaceOf = (id: string) =>
    join(dataDir, 'workspaces', `session-${id}`);
  const startPreview = async (agentId: string) =>
    (await http().post('/sessions').send({ agentId, preview: true }))
      .body as Answer;
  let previewerId = '';

  it('starts a preview of the draft that is never listed', async () => {
    previewerId = (
      await ok('post', '/agents', {
        name: 'Previewer',
        description: 'Tries things out',
        instructions: 'Answer in one sentence.',
        datasets: ['World Cup Core', 'Gone'],
        starterQuestions: ['What changed?'],
      })
    ).agent!.id;

    const answer = await startPreview(previewerId);
    expect(answer).toMatchObject({
      ok: true,
      message: 'Preview started',
      session: {
        name: 'Preview: Previewer',
        datasets: ['World Cup Core'],
        preview: true,
        agentId: previewerId,
        agent: {
          id: previewerId,
          name: 'Previewer',
          deleted: false,
          description: 'Tries things out',
          starterQuestions: ['What changed?'],
        },
      },
    });
    const preview = answer.session!;
    expect(preview.id).toMatch(/^preview-/);
    expect((await getSession(preview.id)).name).toBe('Preview: Previewer');
    expect(await listed(preview.id)).toBeUndefined();
    expect(existsSync(workspaceOf(preview.id))).toBe(true);

    // The preview follows the draft as it is saved.
    await ok('put', `/agents/${previewerId}/draft`, {
      name: 'Previewer',
      datasets: ['World Cup Core'],
      starterQuestions: ['And now?'],
    });
    expect((await getSession(preview.id)).agent?.starterQuestions).toEqual([
      'And now?',
    ]);

    expect(
      (await http().delete(`/sessions/${preview.id}`)).body as Answer,
    ).toEqual({ ok: true, message: 'Preview discarded' });
    await http().get(`/sessions/${preview.id}`).expect(404);
    expect(existsSync(workspaceOf(preview.id))).toBe(false);
  });

  it('refuses a preview without datasets or for a built-in agent', async () => {
    const emptyId = (await ok('post', '/agents', { name: 'Empty' })).agent!.id;
    expect(await startPreview(emptyId)).toEqual({
      ok: false,
      message: 'Select at least one dataset to preview',
    });
    expect(await startPreview('assistant')).toEqual({
      ok: false,
      message: 'Agent "assistant" not found',
    });
  });

  it('marks the agent deleted once it is gone, and survives a restart', async () => {
    const shortLivedId = (
      await ok('post', '/agents', {
        name: 'Short-lived',
        description: 'Gone soon',
        starterQuestions: ['Anything?'],
        datasets: ['World Cup Core'],
      })
    ).agent!.id;
    await ok('post', `/agents/${shortLivedId}/publish`);
    const doomed = (await startFrom(shortLivedId)).session!;
    await ok('delete', `/agents/${shortLivedId}`);

    const deleted = {
      id: shortLivedId,
      name: 'Short-lived',
      deleted: true,
      description: '',
      starterQuestions: [],
    };
    expect((await getSession(doomed.id)).agent).toEqual(deleted);
    expect((await listed(doomed.id))?.agent).toEqual(deleted);
    // A preview left open when the backend stops is swept at the next start.
    const orphan = (await startPreview(previewerId)).session!;
    expect(existsSync(workspaceOf(orphan.id))).toBe(true);

    await stop(backend);
    backend = await boot(dataDir);

    await http().get(`/sessions/${orphan.id}`).expect(404);
    expect(existsSync(workspaceOf(orphan.id))).toBe(false);

    expect(await getSession(doomed.id)).toMatchObject({
      agentId: shortLivedId,
      agentName: 'Short-lived',
      agent: deleted,
    });
    expect((await getSession(sessionId)).agent).toMatchObject({
      id: historianId,
      name: 'Cup historian II',
      deleted: false,
    });
  });
});
