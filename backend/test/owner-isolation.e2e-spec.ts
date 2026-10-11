/**
 * API-level proof of "Each private collection is isolated between two users"
 * (Feature "Org server API" in specs/capabilities/admin/spec.md) and of admin
 * R28-R31, data-model 3.15 and non-functional N75: for every private
 * collection, Grace can list none of Ada's items, and reading, changing or
 * deleting one by id answers exactly as for an id that does not exist.
 * Datasources and datasets are shared: both see the same ones.
 *
 * It drives the BUILT backend (`npm run build` first) in org server mode
 * against the OIDC stub. Verified queries and eval runs are written by chat
 * feedback and eval runs, which need an LLM; this test writes Ada's straight
 * into `app.sqlite` with her `ownerId`, the way those paths store them.
 * Needs no Postgres.
 */
import { randomUUID } from 'node:crypto';
import { type OrgServer, startOrgServer } from './org-server';

jest.setTimeout(180_000);

const ADMIN = 'admin@contoso.test';

describe('Org server API: each private collection is isolated between two users', () => {
  let org: OrgServer;
  let ada = '';
  let grace = '';
  let adaId = '';

  const call = async (
    cookie: string,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const res = await org.api(path, { method, cookie, body });
    const text = await res.text();
    return {
      status: res.status,
      body: (text ? JSON.parse(text) : null) as Record<string, unknown> &
        unknown[],
    };
  };
  const meId = async (cookie: string) =>
    (
      (await call(cookie, 'GET', '/me')).body as unknown as {
        user: { id: string };
      }
    ).user.id;

  beforeAll(async () => {
    org = await startOrgServer({ bootstrapAdmins: [ADMIN] });
    const admin = await org.signIn(ADMIN);
    ada = await org.signIn({ email: 'ada@contoso.test', name: 'Ada Lovelace' });
    grace = await org.signIn({
      email: 'grace@contoso.test',
      name: 'Grace Hopper',
    });
    adaId = await meId(ada);
    const graceId = await meId(grace);
    // Both hold Maker (agents and eval runs need create-agents).
    for (const userId of [adaId, graceId]) {
      const res = await call(admin, 'POST', '/admin/role-assignments', {
        userId,
        role: 'maker',
      });
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    await org?.close();
  });

  it('sessions (and the visuals, reports and deep analysis under them)', async () => {
    const created = await call(ada, 'POST', '/sessions', {
      name: "Ada's goals",
      datasets: ['World Cup Core'],
    });
    expect(created.body.ok).toBe(true);
    const id = (created.body.session as { id: string }).id;
    const missing = randomUUID();

    expect((await call(ada, 'GET', '/sessions')).body.sessions).toHaveLength(1);
    expect((await call(grace, 'GET', '/sessions')).body.sessions).toEqual([]);

    // Reading by id: the same answer as for an id that does not exist.
    const read = await call(grace, 'GET', `/sessions/${id}`);
    const readMissing = await call(grace, 'GET', `/sessions/${missing}`);
    expect(read.status).toBe(404);
    expect(read.status).toBe(readMissing.status);
    expect(read.body.message).toBe(`Session ${id} not found`);

    for (const [method, path] of [
      ['GET', `/sessions/${id}/visualizations/v1`],
      ['GET', `/sessions/${id}/visualizations/v1/download`],
      ['POST', `/sessions/${id}/messages/feedback`],
      ['GET', `/sessions/${id}/deep-analysis/j1`],
    ] as const) {
      const theirs = await call(
        grace,
        method,
        path,
        method === 'GET' ? undefined : { messageAt: 'x', rating: 'up' },
      );
      const nobody = await call(
        grace,
        method,
        path.replace(id, missing),
        method === 'GET' ? undefined : { messageAt: 'x', rating: 'up' },
      );
      expect({ path, status: theirs.status }).toEqual({
        path,
        status: nobody.status,
      });
      expect(JSON.stringify(theirs.body).replaceAll(id, '<id>')).toBe(
        JSON.stringify(nobody.body).replaceAll(missing, '<id>'),
      );
    }

    const removed = await call(grace, 'DELETE', `/sessions/${id}`);
    expect(removed.body).toEqual({
      ok: false,
      message: `Session ${id} not found`,
    });
    expect((await call(ada, 'GET', `/sessions/${id}`)).status).toBe(200);
  });

  it('agents and pins (names are unique per owner)', async () => {
    const created = await call(ada, 'POST', '/agents', {
      name: "Ada's analyst",
      datasets: [],
    });
    expect(created.body.ok).toBe(true);
    const id = (created.body.agent as { id: string }).id;
    const pinned = await call(ada, 'PUT', '/agents/assistant/pin', {
      pinned: true,
    });
    expect(pinned.body.ok).toBe(true);

    const graceAgents = (await call(grace, 'GET', '/agents')).body.agents as {
      key: string;
      id?: string;
      pinned: boolean;
    }[];
    expect(graceAgents.some((a) => a.id === id || a.key === id)).toBe(false);
    expect(graceAgents.find((a) => a.key === 'assistant')?.pinned).toBe(false);
    const adaAgents = (await call(ada, 'GET', '/agents')).body.agents as {
      key: string;
      pinned: boolean;
    }[];
    expect(adaAgents.find((a) => a.key === 'assistant')?.pinned).toBe(true);

    expect((await call(grace, 'GET', `/agents/${id}`)).status).toBe(404);
    for (const [method, path, body] of [
      ['PUT', `/agents/${id}/draft`, { name: 'Taken over' }],
      ['POST', `/agents/${id}/publish`, undefined],
      ['PUT', `/agents/${id}/pin`, { pinned: true }],
      ['DELETE', `/agents/${id}`, undefined],
    ] as const) {
      const res = await call(grace, method, path, body);
      expect({ path, body: res.body }).toEqual({
        path,
        body: { ok: false, message: `Agent "${id}" not found` },
      });
    }
    expect((await call(ada, 'GET', `/agents/${id}`)).body.name).toBe(
      "Ada's analyst",
    );

    const same = await call(grace, 'POST', '/agents', {
      name: "Ada's analyst",
      datasets: [],
    });
    expect(same.body.ok).toBe(true);
  });

  it('knowledge entries', async () => {
    const created = await call(ada, 'POST', '/knowledge', {
      kind: 'term',
      title: 'Goal',
      body: 'A ball over the line',
    });
    expect(created.status).toBe(201);
    const id = (created.body as unknown as { id: string }).id;
    expect(
      ((await call(grace, 'GET', '/knowledge')).body as unknown[]).length,
    ).toBe(0);
    const patch = await call(grace, 'PATCH', `/knowledge/${id}`, {
      title: 'Mine now',
    });
    expect(patch.status).toBe(404);
    expect(patch.body.message).toBe(`Knowledge snippet ${id} not found`);
    expect((await call(grace, 'DELETE', `/knowledge/${id}`)).status).toBe(404);
    const adas = (await call(ada, 'GET', '/knowledge')).body as unknown as {
      title: string;
    }[];
    expect(adas.map((k) => k.title)).toEqual(['Goal']);
  });

  it('metrics (names are unique per owner)', async () => {
    const metric = {
      name: 'goals_per_match',
      label: 'Goals per match',
      entity: 'world_cup.public.matches',
      expression: 'avg(goals)',
    };
    const created = await call(ada, 'POST', '/metrics', metric);
    expect(created.body.ok).toBe(true);
    const id = (created.body.metric as { id: string }).id;
    expect((await call(grace, 'GET', '/metrics')).body.metrics).toEqual([]);
    expect((await call(grace, 'PUT', `/metrics/${id}`, metric)).body).toEqual({
      ok: false,
      message: `Metric ${id} not found`,
    });
    expect((await call(grace, 'DELETE', `/metrics/${id}`)).body).toEqual({
      ok: false,
      message: `Metric ${id} not found`,
    });
    expect((await call(ada, 'GET', '/metrics')).body.metrics).toHaveLength(1);
    expect((await call(grace, 'POST', '/metrics', metric)).body.ok).toBe(true);
  });

  it('verified queries', async () => {
    org.insertDoc('verified_queries', {
      question: 'How many goals per match?',
      sql: 'select avg(goals) from world_cup.public.matches',
      entities: ['world_cup.public.matches'],
      sourceSessionId: randomUUID(),
      sourceMessageAt: new Date().toISOString(),
      ownerId: adaId,
    });
    const adas = (await call(ada, 'GET', '/metrics/candidates')).body
      .candidates as { label: string }[];
    expect(adas.map((c) => c.label)).toEqual(['How many goals per match?']);
    expect(
      (await call(grace, 'GET', '/metrics/candidates')).body.candidates,
    ).toEqual([]);
  });

  it('eval runs', async () => {
    const jobId = randomUUID();
    org.insertDoc('eval_runs', {
      jobId,
      agentKey: 'assistant',
      datasourceId: 'ds-shared',
      datasets: ['World Cup Core'],
      caseIds: [],
      totalCases: 0,
      status: 'completed',
      results: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ownerId: adaId,
    });
    expect(
      (await call(ada, 'GET', '/agents/assistant/evals/runs')).body.runs,
    ).toHaveLength(1);
    expect(
      (await call(grace, 'GET', '/agents/assistant/evals/runs')).body.runs,
    ).toEqual([]);
    expect(
      (await call(grace, 'GET', `/agents/assistant/evals/runs/${jobId}`)).body,
    ).toEqual({
      ok: false,
      message: `Eval run "${jobId}" not found`,
    });
    expect(
      (
        await call(
          grace,
          'GET',
          `/agents/assistant/evals/runs/${jobId}/download`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await call(grace, 'DELETE', `/agents/assistant/evals/runs/${jobId}`))
        .body.ok,
    ).toBe(false);
    expect(
      (await call(ada, 'GET', '/agents/assistant/evals/runs')).body.runs,
    ).toHaveLength(1);
  });

  it('datasources and datasets are shared: both users see the same ones', async () => {
    // Written as an admin's save would store them (data-model 3.1, 3.3).
    org.insertDoc('connections', {
      id: 'ds-shared',
      name: 'World Cup',
      kind: 'postgres',
      config: {
        host: '127.0.0.1',
        port: 5432,
        database: 'world_cup',
        user: 'world_cup',
        password: 'secret',
      },
    });
    org.insertDoc('datasets', {
      name: 'World Cup Core',
      datasourceId: 'ds-shared',
      datasourceKind: 'postgres',
      tables: ['world_cup.public.matches'],
    });
    for (const cookie of [ada, grace]) {
      const sources = (await call(cookie, 'GET', '/datasources')).body
        .datasources as { id: string }[];
      expect(sources.map((d) => d.id)).toEqual(['ds-shared']);
      const sets = (await call(cookie, 'GET', '/datasets')).body.datasets as {
        name: string;
      }[];
      expect(sets.map((d) => d.name)).toEqual(['World Cup Core']);
    }
  });
});
