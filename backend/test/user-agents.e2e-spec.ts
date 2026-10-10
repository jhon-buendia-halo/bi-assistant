/**
 * API-level proof of the Feature "Agent definitions (API)" in
 * specs/capabilities/agents-evals/spec.md (R43-R52): user agents are created,
 * published, edited, pinned and deleted over HTTP, built-in agents stay
 * read-only, and everything survives a backend restart on the same data dir.
 *
 * It drives the BUILT backend (`node dist/main.js`, so run `npm run build`
 * first) as a child process on a free port with a fresh `APP_DATA_DIR`.
 * Booting `AppModule` inside Jest is not possible: Mastra and the Databricks
 * driver pull in ESM-only packages that Jest's CommonJS runtime cannot
 * require. A real process also makes "the backend restarts" literal, and
 * leaves no Mastra/LibSQL handles open in the Jest worker.
 *
 * Needs no Postgres: datasets are referenced by name, so "World Cup Core" is
 * simply reported as missing here.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { type Backend, boot as bootIn, stop } from './backend-process';

const boot = () => bootIn(dataDir);
const dataDir = mkdtempSync(join(tmpdir(), 'qti-user-agents-'));

jest.setTimeout(120_000);

interface AgentConfigView {
  name: string;
  instructions: string;
}

/** The parts of `AgentSummary` / `AgentDetail` the scenarios read. */
interface AgentView {
  key: string;
  id: string;
  name: string;
  tools: string[];
  hasUnpublishedChanges: boolean;
  instructions: string;
  toolDetails: unknown[];
  memory: unknown;
  draft: AgentConfigView;
  live: AgentConfigView;
}

/** A Style A answer of the agent-definition routes. */
interface Answer {
  ok: boolean;
  message: string;
  agent: AgentView;
}

const answer = (res: { body: unknown }) => res.body as Answer;

describe('Agent definitions (API)', () => {
  let backend: Backend | undefined;
  let agentId = '';

  const http = () => request(backend!.url);
  const listAgents = async (): Promise<AgentView[]> =>
    ((await http().get('/agents').expect(200)).body as { agents: AgentView[] })
      .agents;
  const detailOf = async (key: string): Promise<AgentView> =>
    (await http().get(`/agents/${key}`).expect(200)).body as AgentView;
  const findAgent = async (key: string) =>
    (await listAgents()).find((agent) => agent.key === key);

  beforeAll(async () => {
    backend = await boot();
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('Creating an agent stores a draft', async () => {
    const res = await http()
      .post('/agents')
      .send({
        name: 'Health plan analyst',
        description: 'Answers health plan questions',
        instructions: 'Always state the plan year.',
        datasets: ['World Cup Core'],
        starterQuestions: ['Which plan grew fastest?'],
      })
      .expect(201);
    expect(res.body).toMatchObject({
      ok: true,
      message: 'Agent "Health plan analyst" saved as draft',
      agent: { kind: 'user', status: 'draft', owner: 'You', pinned: false },
    });
    agentId = answer(res).agent.id;
    expect(answer(res).agent.key).toBe(agentId);

    expect(await findAgent(agentId)).toMatchObject({
      name: 'Health plan analyst',
      kind: 'user',
      status: 'draft',
      owner: 'You',
      pinned: false,
      hasUnpublishedChanges: false,
      datasets: ['World Cup Core'],
      starterQuestions: ['Which plan grew fastest?'],
      missingDatasets: ['World Cup Core'],
    });
    // The six built-ins are still listed alongside it.
    expect(await findAgent('assistant')).toMatchObject({
      kind: 'official',
      status: 'builtin',
      owner: 'Official',
    });
    expect(await findAgent('sql-fixer')).toMatchObject({
      kind: 'system',
      owner: 'System',
    });
  });

  it('Publishing makes the draft Live', async () => {
    const res = await http().post(`/agents/${agentId}/publish`).expect(201);
    expect(res.body).toMatchObject({
      ok: true,
      message: 'Agent "Health plan analyst" is Live',
      agent: { status: 'live', hasUnpublishedChanges: false },
    });
    const detail = await detailOf(agentId);
    expect(detail.live).toEqual(detail.draft);
    expect(detail.live.instructions).toBe('Always state the plan year.');
  });

  it('Editing a Live agent keeps serving the Live version', async () => {
    const res = await http()
      .put(`/agents/${agentId}/draft`)
      .send({
        name: 'Health plan analyst',
        instructions: 'Always state the plan year and the region.',
        datasets: ['World Cup Core'],
      })
      .expect(200);
    expect(res.body).toMatchObject({
      ok: true,
      message: 'Draft saved',
      agent: { status: 'live', hasUnpublishedChanges: true },
    });
    let detail = await detailOf(agentId);
    expect(detail.live.instructions).toBe('Always state the plan year.');
    expect(detail.draft.instructions).toBe(
      'Always state the plan year and the region.',
    );

    await http().post(`/agents/${agentId}/publish`).expect(201);
    detail = await detailOf(agentId);
    expect(detail.live.instructions).toBe(
      'Always state the plan year and the region.',
    );
    expect(detail.hasUnpublishedChanges).toBe(false);
  });

  it('Names must be unique and publishing needs a dataset', async () => {
    const duplicate = await http()
      .post('/agents')
      .send({ name: 'health plan analyst' })
      .expect(201);
    expect(duplicate.body).toEqual({
      ok: false,
      message: 'An agent named "health plan analyst" already exists',
    });

    const noName = await http().post('/agents').send({ name: '  ' });
    expect(noName.body).toEqual({
      ok: false,
      message: 'Agent name is required',
    });

    const bare = await http()
      .post('/agents')
      .send({ name: 'No data yet' })
      .expect(201);
    const publish = await http().post(
      `/agents/${answer(bare).agent.id}/publish`,
    );
    expect(publish.body).toEqual({
      ok: false,
      message: 'Select at least one dataset to publish',
    });
    await http()
      .delete(`/agents/${answer(bare).agent.id}`)
      .expect(200);
  });

  it('Built-in agents are read-only', async () => {
    const edit = await http()
      .put('/agents/sql-fixer/draft')
      .send({ name: 'Mine' });
    expect(edit.body).toEqual({
      ok: false,
      message: "Built-in agents can't be edited",
    });
    const publish = await http().post('/agents/sql-fixer/publish');
    expect(publish.body).toEqual({
      ok: false,
      message: "Built-in agents can't be edited",
    });
    const remove = await http().delete('/agents/sql-fixer');
    expect(remove.body).toEqual({
      ok: false,
      message: "Built-in agents can't be deleted",
    });
    expect(await findAgent('sql-fixer')).toBeDefined();
  });

  it('Pins apply to user and built-in agents and survive a restart', async () => {
    const pinUser = await http()
      .put(`/agents/${agentId}/pin`)
      .send({ pinned: true })
      .expect(200);
    expect(pinUser.body).toMatchObject({
      ok: true,
      message: 'Pinned',
      agent: { key: agentId, pinned: true },
    });
    const pinAssistant = await http()
      .put('/agents/assistant/pin')
      .send({ pinned: true })
      .expect(200);
    expect(pinAssistant.body).toMatchObject({
      ok: true,
      message: 'Pinned',
      agent: { key: 'assistant', pinned: true },
    });

    // The backend restarts on the same data directory.
    await stop(backend);
    backend = await boot();

    expect(await findAgent('assistant')).toMatchObject({ pinned: true });
    expect(await findAgent(agentId)).toMatchObject({
      pinned: true,
      status: 'live',
      name: 'Health plan analyst',
    });
    expect(await findAgent('sql-fixer')).toMatchObject({ pinned: false });

    const unpin = await http()
      .put('/agents/assistant/pin')
      .send({ pinned: false })
      .expect(200);
    expect(unpin.body).toMatchObject({
      ok: true,
      message: 'Unpinned',
      agent: { pinned: false },
    });
  });

  it("A user agent's detail reports the assistant's tools with its draft and Live version", async () => {
    const assistant = await detailOf('assistant');
    const detail = await detailOf(agentId);
    expect(detail).toMatchObject({
      key: agentId,
      kind: 'user',
      owner: 'You',
      instructions: assistant.instructions,
      toolDetails: assistant.toolDetails,
      memory: assistant.memory,
    });
    expect(detail.tools).toEqual(assistant.tools);
    expect(detail.draft.name).toBe('Health plan analyst');
    expect(detail.live.name).toBe('Health plan analyst');

    const missing = await http().get('/agents/unknown-agent').expect(404);
    expect(answer(missing).message).toBe('Agent "unknown-agent" not found');
  });

  it('Unknown ids are reported as not found', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const message = `Agent "${id}" not found`;
    expect(
      (await http().put(`/agents/${id}/draft`).send({ name: 'X' })).body,
    ).toEqual({ ok: false, message });
    expect((await http().post(`/agents/${id}/publish`)).body).toEqual({
      ok: false,
      message,
    });
    expect((await http().delete(`/agents/${id}`)).body).toEqual({
      ok: false,
      message,
    });
    expect(
      (await http().put(`/agents/${id}/pin`).send({ pinned: true })).body,
    ).toEqual({ ok: false, message });
    await http().get(`/agents/${id}`).expect(404);
  });

  it('Deleting an agent', async () => {
    const res = await http().delete(`/agents/${agentId}`).expect(200);
    expect(res.body).toEqual({
      ok: true,
      message: 'Agent "Health plan analyst" deleted',
    });
    expect(await findAgent(agentId)).toBeUndefined();
    await http().get(`/agents/${agentId}`).expect(404);
  });
});
