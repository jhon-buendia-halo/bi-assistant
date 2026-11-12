/**
 * Smoke test: the built backend starts and serves its API. It replaces the
 * Nest scaffold, which imported `AppModule` into Jest (impossible: Mastra and
 * the Databricks driver are ESM-only) and expected a `GET /` the app never had.
 * Run `npm run build` first; see `backend-process.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { type Backend, boot, stop } from './backend-process';

jest.setTimeout(120_000);

describe('Backend (e2e)', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'qti-app-'));
  let backend: Backend | undefined;

  beforeAll(async () => {
    backend = await boot(dataDir);
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('serves the sessions list on a fresh data dir', async () => {
    const res = await request(backend!.url).get('/sessions').expect(200);
    expect(res.body).toBeDefined();
  });
});

/**
 * Roadmap 1.14.19 (BA-232; ADR-0030), migration M14 (data-model 6): a data
 * dir written by an earlier, multi-user version opens with every user's data
 * listed for the one built-in super admin, and the identity tables gone.
 * The data is made through the API, then rewritten in `app.sqlite` the way
 * an org server would have stored it (other owners, a users table, per-user
 * UI preferences and a skill name two owners shared).
 */
describe('Opening a data dir from the multi-user version (M14)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sqlite = require('better-sqlite3') as typeof import('better-sqlite3');
  const dataDir = mkdtempSync(join(tmpdir(), 'qti-m14-'));
  let backend: Backend | undefined;
  const ids: Record<string, string> = {};

  const api = () => request(backend!.url);
  const created = async (path: string, body: object) => {
    const res = await api().post(path).send(body);
    expect(res.status).toBeLessThan(300);
    return res.body as Record<string, { id: string }> & { id?: string };
  };

  beforeAll(async () => {
    backend = await boot(dataDir, { env: { INTELLIFY_API: 'off' } });
    await created('/datasets', {
      name: 'World Cup Core',
      tables: ['world_cup.world_cup.matches'],
      entities: [],
      datasourceId: 'none',
      datasourceKind: 'postgres',
    });
    // No route starts a chat any more (1.23.27): Alice's past chat is
    // written into the store below, as an earlier version left it.
    ids.session = 'past-chat-alice';
    ids.agent = (
      await created('/agents', {
        name: "Bob's agent",
        description: 'Made by Bob',
        datasets: ['World Cup Core'],
      })
    ).agent.id;
    const skill = {
      description: 'Use when a question names a fiscal year.',
      body: 'Fiscal years start in July.',
    };
    ids.skill = (
      await created('/skills', { name: 'fiscal-calendar', ...skill })
    ).skill.id;
    ids.otherSkill = (
      await created('/skills', { name: 'fiscal-other', ...skill })
    ).skill.id;
    ids.snippet = 'snippet-carol';
    await stop(backend);

    const db = new Sqlite(join(dataDir, 'app.sqlite'));
    const setOwner = (table: string, id: string, owner: string) =>
      db
        .prepare(
          `UPDATE "${table}" SET doc = json_set(doc, '$.ownerId', ?) WHERE json_extract(doc, '$.id') = ?`,
        )
        .run(owner, id);
    db.prepare(`INSERT INTO sessions (doc) VALUES (?)`).run(
      JSON.stringify({
        id: ids.session,
        name: "Alice's session",
        datasets: ['World Cup Core'],
        workflowId: 'agent:assistant',
        messages: [],
        visualizations: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    setOwner('sessions', ids.session, 'u-alice');
    setOwner('agents', ids.agent, 'u-bob');
    // A knowledge snippet of Carol's, in the table the knowledge library
    // used before the dataset ontology (M15 copies it to ontology_items).
    db.exec(
      `CREATE TABLE knowledge_snippets (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)`,
    );
    db.prepare(`INSERT INTO knowledge_snippets (doc) VALUES (?)`).run(
      JSON.stringify({
        id: ids.snippet,
        kind: 'instruction',
        scope: null,
        title: "Carol's rule",
        body: 'Count only finals.',
        enabled: true,
        source: 'user',
        ownerId: 'u-carol',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    // A dataset to list the ontology under (the API one above has no
    // reachable datasource, so it is written here directly).
    db.prepare(`INSERT INTO datasets (doc) VALUES (?)`).run(
      JSON.stringify({
        name: 'Ontology Check',
        tables: ['world_cup.world_cup.matches'],
      }),
    );
    // Bob's skill had the same name as the super admin's.
    setOwner('skills', ids.otherSkill, 'u-bob');
    db.prepare(
      `UPDATE skills SET doc = json_set(doc, '$.name', 'fiscal-calendar') WHERE json_extract(doc, '$.id') = ?`,
    ).run(ids.otherSkill);
    db.exec(
      `CREATE TABLE users (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)`,
    );
    db.prepare(`INSERT INTO users (doc) VALUES (?)`).run(
      JSON.stringify({ id: 'u-alice', displayName: 'Alice' }),
    );
    db.prepare(`INSERT INTO settings (doc) VALUES (?)`).run(
      JSON.stringify({ key: 'ui-preferences:local', theme: 'dark' }),
    );
    db.prepare(`INSERT INTO settings (doc) VALUES (?)`).run(
      JSON.stringify({ key: 'ui-preferences:u-alice', theme: 'light' }),
    );
    db.close();

    backend = await boot(dataDir, { env: { INTELLIFY_API: 'off' } });
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("lists every user's sessions, agents, skills and knowledge", async () => {
    const sessions = (await api().get('/sessions').expect(200)).body as {
      sessions: { id: string; name: string }[];
    };
    expect(sessions.sessions.map((s) => s.id)).toContain(ids.session);
    // A past chat still opens (1.23.27): its read route answers it.
    const past = (await api().get(`/sessions/${ids.session}`).expect(200))
      .body as { id: string; workflowRef: { id: string } };
    expect(past).toMatchObject({
      id: ids.session,
      workflowRef: { id: 'agent:assistant' },
    });

    const agents = (await api().get('/agents').expect(200)).body as {
      agents: { id?: string; key?: string; name: string }[];
    };
    expect(agents.agents.map((a) => a.name)).toContain("Bob's agent");

    const skills = (await api().get('/skills').expect(200)).body as {
      skills: { id: string; name: string }[];
    };
    expect(
      Object.fromEntries(skills.skills.map((s) => [s.id, s.name])),
    ).toMatchObject({
      [ids.skill]: 'fiscal-calendar',
      [ids.otherSkill]: 'fiscal-calendar-2',
    });

    // A bare array; the global snippet became a shared item (M15).
    const items = (
      await api().get('/datasets/Ontology%20Check/ontology').expect(200)
    ).body as { id: string; dataset: string | null; kind: string }[];
    expect(items).toContainEqual(
      expect.objectContaining({
        id: ids.snippet,
        dataset: null,
        kind: 'instruction',
      }),
    );
  });

  it("keeps the super admin's UI preferences under the bare key", async () => {
    const prefs = (await api().get('/ui-preferences').expect(200)).body as {
      theme: string | null;
    };
    expect(prefs.theme).toBe('dark');
  });

  it('drops the identity tables and stamps every document with the super admin', () => {
    const db = new Sqlite(join(dataDir, 'app.sqlite'), { readonly: true });
    try {
      const users = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`,
        )
        .all();
      expect(users).toHaveLength(0);
      // M15 kept the old knowledge table for one release, renamed.
      const legacy = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('knowledge_snippets', 'knowledge_snippets_legacy')`,
        )
        .all() as { name: string }[];
      expect(legacy.map((t) => t.name)).toEqual(['knowledge_snippets_legacy']);
      for (const table of ['sessions', 'agents', 'skills', 'ontology_items']) {
        const owners = db
          .prepare(
            `SELECT DISTINCT json_extract(doc, '$.ownerId') AS owner FROM "${table}"`,
          )
          .all() as { owner: string | null }[];
        expect({ table, owners: owners.map((o) => o.owner) }).toEqual({
          table,
          owners: ['local'],
        });
      }
      const keys = db
        .prepare(`SELECT json_extract(doc, '$.key') AS key FROM settings`)
        .all() as { key: string }[];
      expect(keys.map((k) => k.key)).not.toContain('ui-preferences:u-alice');
    } finally {
      db.close();
    }
  });
});
