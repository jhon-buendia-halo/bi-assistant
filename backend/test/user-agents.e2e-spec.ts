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
 * simply reported as missing here. The links scenarios (BA-213: R81-R89,
 * api.md 41-45 and 94-98) save LLM settings against a local stub that only
 * answers the connection test, so no model is ever called.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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
  tools?: string[];
  skills?: string[];
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

  const http = () => request.agent(backend!.url);
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
    // R49: memory and model are the assistant's; the tools and prompt are the
    // ones the agent's tool selection gives it (ADR-0024). This agent's
    // instructions link no tool, so it gets only the always-on tools and none
    // of the optional groups (sample_rows, ask_clarification, visuals).
    expect(detail).toMatchObject({
      key: agentId,
      kind: 'user',
      owner: 'You',
      memory: assistant.memory,
    });
    const alwaysOn = [
      'describe_entity',
      'list_entities',
      'run_readonly_sql',
      'show_in_panel',
      'update_workflow',
    ];
    expect([...detail.tools].sort()).toEqual(alwaysOn);
    expect(assistant.tools).toEqual(expect.arrayContaining(alwaysOn));
    for (const optional of [
      'sample_rows',
      'ask_clarification',
      'create_visual',
      'update_visual',
    ]) {
      expect(assistant.tools).toContain(optional);
      expect(detail.tools).not.toContain(optional);
    }
    expect(
      (detail.toolDetails as { name: string }[]).map((tool) => tool.name),
    ).toEqual(expect.arrayContaining(alwaysOn));
    expect(detail.toolDetails).toHaveLength(alwaysOn.length);
    expect(detail.instructions).not.toBe(assistant.instructions);
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

/** A skill as `POST /skills` / `GET /skills/:id` return it (api.md 95). */
interface SkillView {
  id: string;
  name: string;
  description: string;
  body: string;
  agents: string[];
  tools: string[];
}

interface ToolLinkView {
  name: string;
  status: 'always-on' | 'linked' | 'not-linked';
  linkedVia: { instructions: boolean; skills: string[] };
}

interface LinkedAgentView extends AgentView {
  toolLinks: ToolLinkView[];
  llm: {
    provider: string | null;
    model: string | null;
    apiKeyConfigured: boolean;
    maxOutputTokens: number | null;
    reasoningEffort: string | null;
  };
}

/**
 * Answers the settings connection test (`PUT /llm/settings` proves the
 * provider before saving) with `{"status":"ok"}`, as a LenAI gateway would.
 */
async function startConnectionStub(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-stub',
          object: 'chat.completion',
          created: 0,
          model: 'stub',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: '{"status":"ok"}' },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('Agent definitions (API): links, skills and LLM settings', () => {
  const linksDir = mkdtempSync(join(tmpdir(), 'qti-agent-links-'));
  let backend: Backend | undefined;

  const http = () => request.agent(backend!.url);
  const detailOf = async (key: string): Promise<LinkedAgentView> =>
    (await http().get(`/agents/${key}`).expect(200)).body as LinkedAgentView;
  const skillBody = (res: { body: unknown }) =>
    res.body as { ok: boolean; message: string; skill: SkillView };

  /** Creates an in-app skill and returns it (api.md 96). */
  const createSkill = async (
    name: string,
    body = `Notes for ${name}.`,
    description = `Use when a question needs ${name}.`,
  ): Promise<SkillView> => {
    const res = await http().post('/skills').send({ name, description, body });
    expect(skillBody(res)).toMatchObject({
      ok: true,
      message: `Skill "${name}" created`,
    });
    return skillBody(res).skill;
  };

  /** Creates a user agent's draft; returns the answer (Style A). */
  const createAgent = async (input: Record<string, unknown>) =>
    answer(await http().post('/agents').send(input));

  /** `SKILL.md` of an agent's in-app skill, as its sessions see it (34b). */
  const skillMdOf = async (agentId: string, name: string) =>
    (
      (
        await http()
          .get(`/agents/${agentId}/skills/${name}/file`)
          .query({ path: 'SKILL.md' })
          .expect(200)
      ).body as { content: string }
    ).content;

  beforeAll(async () => {
    backend = await bootIn(linksDir);
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(linksDir, { recursive: true, force: true });
  });

  it('Skills refuse a bad name or description', async () => {
    const refuse = async (input: Record<string, unknown>, message: string) =>
      expect((await http().post('/skills').send(input)).body).toEqual({
        ok: false,
        message,
      });
    const body = 'Body';
    const description = 'Use when a question names a fiscal year.';
    await refuse(
      { name: 'Fiscal Calendar', description, body },
      'Use lowercase letters, digits and single hyphens in a skill name',
    );
    await refuse(
      { name: 'curated-knowledge', description, body },
      '"curated-knowledge" is the name of a built-in skill',
    );
    await refuse(
      { name: 'fiscal-calendar', description: 'Fiscal calendar rules.', body },
      'The description must start with "Use when"',
    );
    expect(
      ((await http().get('/skills').expect(200)).body as { skills: unknown[] })
        .skills,
    ).toEqual([]);
  });

  it('Tools and skills are derived from the links in the instructions', async () => {
    const fiscal = await createSkill(
      'fiscal-calendar',
      'Our fiscal year starts on 1 July.',
      'Use when a question names a fiscal year.',
    );
    const instructions =
      'Use [[skill:fiscal-calendar]] and [[tool:sample_rows]].';
    const created = await createAgent({
      name: 'Finance helper',
      instructions,
      datasets: ['World Cup Core'],
    });
    expect(created).toMatchObject({
      ok: true,
      message: 'Agent "Finance helper" saved as draft',
    });
    const finance = await detailOf(created.agent.id);
    expect(finance.draft.tools).toEqual(['sample_rows']);
    expect(finance.draft.skills).toEqual([fiscal.id]);
    expect(finance.draft.instructions).toBe(instructions);
    expect(finance.tools).toContain('sample_rows');
    expect(finance.tools).not.toContain('ask_clarification');

    // The request's lists are ignored: only links count.
    const plain = await createAgent({
      name: 'Plain',
      instructions: 'Be brief.',
      tools: ['ask_clarification'],
      skills: [fiscal.id],
    });
    expect(plain.ok).toBe(true);
    const plainDetail = await detailOf(plain.agent.id);
    expect(plainDetail.draft.tools ?? []).toEqual([]);
    expect(plainDetail.draft.skills ?? []).toEqual([]);
    expect(plainDetail.tools).not.toContain('ask_clarification');

    // The skill reports the agent whose draft links it (api.md 94).
    const listed = (
      (await http().get('/skills').expect(200)).body as {
        skills: SkillView[];
      }
    ).skills;
    expect(
      listed.find((skill) => skill.name === 'fiscal-calendar'),
    ).toMatchObject({ agents: ['Finance helper'] });
  });

  it('Unknown links are refused', async () => {
    const refused = async (instructions: string) =>
      (await http().post('/agents').send({ name: 'Refused', instructions }))
        .body as Answer;
    expect(await refused('Use [[tool:delete_everything]].')).toEqual({
      ok: false,
      message: 'Unknown tool "delete_everything"',
    });
    expect(await refused('Use [[skill:nope]].')).toEqual({
      ok: false,
      message: 'Unknown skill "nope"',
    });

    const names: string[] = [];
    for (let i = 1; i <= 11; i += 1) {
      const name = `limit-skill-${String(i).padStart(2, '0')}`;
      await createSkill(name);
      names.push(name);
    }
    const eleven = names.map((name) => `[[skill:${name}]]`).join(' ');
    expect(await refused(eleven)).toEqual({
      ok: false,
      message: 'An agent can have at most 10 skills',
    });
    // Ten are allowed, on a draft save as on a create.
    const ten = names
      .slice(0, 10)
      .map((name) => `[[skill:${name}]]`)
      .join(' ');
    const tenAgent = await createAgent({
      name: 'Ten skills',
      instructions: ten,
    });
    expect(tenAgent.ok).toBe(true);
    const save = (
      await http()
        .put(`/agents/${tenAgent.agent.id}/draft`)
        .send({ name: 'Ten skills', instructions: eleven })
    ).body as Answer;
    expect(save).toEqual({
      ok: false,
      message: 'An agent can have at most 10 skills',
    });
    expect(
      (
        await http()
          .put(`/agents/${tenAgent.agent.id}/draft`)
          .send({ name: 'Ten skills', instructions: '[[tool:nope]]' })
      ).body,
    ).toEqual({ ok: false, message: 'Unknown tool "nope"' });
    await http().delete(`/agents/${tenAgent.agent.id}`).expect(200);
    expect(
      (
        (await http().get('/agents').expect(200)).body as {
          agents: AgentView[];
        }
      ).agents.map((agent) => agent.name),
    ).not.toContain('Refused');
  });

  it('A skill links tools only', async () => {
    const create = async (body: string) =>
      (
        await http().post('/skills').send({
          name: 'linker',
          description: 'Use when testing links.',
          body,
        })
      ).body as { ok: boolean; message: string };
    expect(await create('See [[skill:other]].')).toEqual({
      ok: false,
      message: 'Skills can link tools only',
    });
    expect(await create('Run [[tool:delete_everything]].')).toEqual({
      ok: false,
      message: 'Unknown tool "delete_everything"',
    });
    const chart = await createSkill(
      'chart-style',
      'Draw every chart with [[tool:create_visual]].',
      'Use when drawing a chart.',
    );
    expect(chart.tools).toEqual(['create_visual']);
  });

  it('The detail of an agent shows its links and its LLM settings', async () => {
    const secret = 'sk-secret-e2e-7c1d';
    const stub = await startConnectionStub();
    try {
      const saved = (
        await http().put('/llm/settings').send({
          provider: 'lenai',
          model: 'stub-deployment',
          baseUrl: stub.baseUrl,
          apiKey: secret,
        })
      ).body as { ok: boolean; message: string };
      expect(saved).toMatchObject({ ok: true });
    } finally {
      await stub.close();
    }

    const created = await createAgent({
      name: 'Chart helper',
      instructions: 'Use [[skill:chart-style]] and [[tool:sample_rows]].',
      datasets: ['World Cup Core'],
    });
    expect(created.ok).toBe(true);
    const res = await http().get(`/agents/${created.agent.id}`).expect(200);
    const detail = res.body as LinkedAgentView;
    const link = (name: string) =>
      detail.toolLinks.find((entry) => entry.name === name);
    expect(link('create_visual')).toEqual({
      name: 'create_visual',
      status: 'linked',
      linkedVia: { instructions: false, skills: ['chart-style'] },
    });
    expect(link('sample_rows')).toEqual({
      name: 'sample_rows',
      status: 'linked',
      linkedVia: { instructions: true, skills: [] },
    });
    expect(link('run_readonly_sql')).toMatchObject({ status: 'always-on' });
    expect(link('ask_clarification')).toMatchObject({ status: 'not-linked' });
    // The tools a linked skill links come with it (R84).
    expect(detail.tools).toEqual(
      expect.arrayContaining(['create_visual', 'sample_rows']),
    );
    expect(detail.tools).not.toContain('ask_clarification');

    expect(detail.llm).toMatchObject({
      provider: 'lenai',
      model: 'stub-deployment',
      apiKeyConfigured: true,
    });
    // Never the key, anywhere in the detail or the catalogue.
    expect(res.text).not.toContain(secret);
    expect((await http().get('/agents').expect(200)).text).not.toContain(
      secret,
    );
    expect(
      (await http().get('/agents/assistant').expect(200)).text,
    ).not.toContain(secret);
  });

  it("A skill that an agent's draft links can't be deleted or renamed", async () => {
    const skills = (
      (await http().get('/skills').expect(200)).body as { skills: SkillView[] }
    ).skills;
    const fiscal = skills.find((skill) => skill.name === 'fiscal-calendar')!;
    const message =
      '"fiscal-calendar" is linked by Finance helper. Unlink it first.';
    expect((await http().delete(`/skills/${fiscal.id}`)).body).toEqual({
      ok: false,
      message,
    });
    expect(
      (
        await http().put(`/skills/${fiscal.id}`).send({
          name: 'fiscal-rules',
          description: 'Use when a question names a fiscal year.',
          body: 'Our fiscal year starts on 1 July.',
        })
      ).body,
    ).toEqual({ ok: false, message });
    // Neither went through.
    expect(
      ((await http().get(`/skills/${fiscal.id}`).expect(200)).body as SkillView)
        .name,
    ).toBe('fiscal-calendar');
  });

  it('Publishing copies the skills and a later skill edit leaves the Live copy', async () => {
    const agents = (
      (await http().get('/agents').expect(200)).body as { agents: AgentView[] }
    ).agents;
    const finance = agents.find((agent) => agent.name === 'Finance helper')!;
    const skills = (
      (await http().get('/skills').expect(200)).body as { skills: SkillView[] }
    ).skills;
    const fiscal = skills.find((skill) => skill.name === 'fiscal-calendar')!;

    const published = answer(
      await http().post(`/agents/${finance.id}/publish`).expect(201),
    );
    expect(published).toMatchObject({
      ok: true,
      agent: { status: 'live', hasUnpublishedChanges: false },
    });
    expect(await skillMdOf(finance.id, 'fiscal-calendar')).toContain(
      'Our fiscal year starts on 1 July.',
    );

    const saved = skillBody(
      await http().put(`/skills/${fiscal.id}`).send({
        name: 'fiscal-calendar',
        description: 'Use when a question names a fiscal year.',
        body: 'Our fiscal year starts on 1 April.',
      }),
    );
    expect(saved).toMatchObject({ ok: true, message: 'Skill saved' });

    const after = await detailOf(finance.id);
    expect(after.hasUnpublishedChanges).toBe(true);
    const live = await skillMdOf(finance.id, 'fiscal-calendar');
    expect(live).toContain('Our fiscal year starts on 1 July.');
    expect(live).not.toContain('1 April');

    await http().post(`/agents/${finance.id}/publish`).expect(201);
    const republished = await skillMdOf(finance.id, 'fiscal-calendar');
    expect(republished).toContain('Our fiscal year starts on 1 April.');
    expect((await detailOf(finance.id)).hasUnpublishedChanges).toBe(false);
  });
});
