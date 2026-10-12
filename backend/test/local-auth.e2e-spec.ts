/**
 * API-level proof of local mode sign-in (ADR-0012): the Feature "Org server
 * API" scenario "Local mode refuses a request without a session and answers
 * the signed-in persona" in specs/capabilities/admin/spec.md, admin R2, R11,
 * R18, R33, R69-R73, api.md 1.9 and 2.13 (64, 91-93) and data-model M13.
 * The five personas are seeded at startup; a persona signs in without a
 * password and the token travels as `Authorization: Bearer <token>`; roles,
 * permissions and owner scoping apply exactly as on an org server.
 *
 * It drives the BUILT backend (`node dist/main.js`, so run `npm run build`
 * first) as a child process with a fresh `APP_DATA_DIR` and no `ORG_*`
 * configuration. Needs no Postgres.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Backend,
  bearer,
  boot,
  signInLocally,
  stop,
} from './backend-process';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-local-auth-'));

jest.setTimeout(180_000);

const ALL_PERMISSIONS = [
  'approve-datasource-access',
  'approve-publishing',
  'create-agents',
  'edit-policies',
  'manage-datasources',
  'manage-llm',
  'manage-users',
  'request-publishing',
  'share-agents-team',
  'use-agents',
  'view-audit-log',
];

const DEMO_USER = {
  id: 'local',
  displayName: 'Demo User',
  email: 'demo@local.test',
  initials: 'DU',
};

const DEMO_ME = {
  mode: 'local',
  user: DEMO_USER,
  roles: [
    { role: 'user', source: 'implicit' },
    { role: 'platform-admin', source: 'bootstrap' },
  ],
  permissions: ALL_PERMISSIONS,
};

interface MeView {
  mode: string;
  user: { id: string; displayName: string; email: string | null };
  roles: { role: string; source: string; datasourceId?: string }[];
  permissions: string[];
}

interface LocalUser {
  id: string;
  displayName: string;
  email: string | null;
  initials: string;
  roles: string[];
}

interface ApiInit {
  method?: string;
  token?: string | null;
  body?: unknown;
}

interface SqliteDatabase {
  pragma(statement: string): unknown;
  prepare(statement: string): {
    reader: boolean;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
  close(): void;
}

/** Runs one statement on the data folder's `app.sqlite`. */
function sql<T = unknown>(statement: string, ...params: unknown[]): T[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as new (
    file: string,
  ) => SqliteDatabase;
  const db = new Database(join(dataDir, 'app.sqlite'));
  try {
    db.pragma('busy_timeout = 5000');
    const prepared = db.prepare(statement);
    if (prepared.reader) return prepared.all(...params) as T[];
    prepared.run(...params);
    return [];
  } finally {
    db.close();
  }
}

const activityEvents = () =>
  sql<{ doc: string }>('SELECT doc FROM activity_events').map(
    (row) =>
      JSON.parse(row.doc) as {
        type: string;
        actorId?: string;
        subjectId?: string;
      },
  );

describe('Local mode signs in a persona (API)', () => {
  let backend: Backend | undefined;
  /** Tokens by persona id, signed in once each. */
  const tokens: Record<string, string> = {};

  const api = (path: string, init: ApiInit = {}) => {
    const headers: Record<string, string> = init.token
      ? bearer(init.token)
      : {};
    let body: string | undefined;
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    return fetch(`${backend!.url}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body,
    });
  };
  const json = async <T = Record<string, unknown>>(
    path: string,
    init: ApiInit = {},
  ): Promise<{ status: number; body: T }> => {
    const res = await api(path, init);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const as = async (userId: string): Promise<string> =>
    (tokens[userId] ??= await signInLocally(backend!.url, userId));
  const me = async (userId: string) =>
    json<MeView>('/me', { token: await as(userId) });

  beforeAll(async () => {
    // Local mode is the absence of org server configuration.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ORG_')) delete process.env[key];
    }
    backend = await boot(dataDir);
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('Without an auth session', () => {
    it('GET /me answers 401 with the mode', async () => {
      expect(await json('/me')).toEqual({
        status: 401,
        body: {
          statusCode: 401,
          message: 'Sign in required',
          error: 'Unauthorized',
          mode: 'local',
        },
      });
    });

    it.each([
      ['GET', '/sessions'],
      ['POST', '/sessions'],
      ['GET', '/agents'],
      ['GET', '/datasources'],
      ['GET', '/ui-preferences'],
      ['PUT', '/ui-preferences'],
      ['GET', '/admin/users'],
    ])('%s %s answers 401', async (method, path) => {
      const res = await json(path, {
        method,
        body: method === 'GET' ? undefined : {},
      });
      expect(res).toEqual({
        status: 401,
        body: {
          statusCode: 401,
          message: 'Sign in required',
          error: 'Unauthorized',
        },
      });
    });

    it('an unknown bearer token is the same as none', async () => {
      expect((await json('/me', { token: 'not-a-real-token' })).status).toBe(
        401,
      );
      expect(
        (await json('/sessions', { token: 'not-a-real-token' })).status,
      ).toBe(401);
    });
  });

  describe('The local sign-in routes', () => {
    it('GET /auth/local/users lists the five personas with their roles', async () => {
      const res = await json<{ users: LocalUser[] }>('/auth/local/users');
      expect(res.status).toBe(200);
      // Dana owns no datasource yet: no Data owner role to show (R69, R72).
      expect(res.body.users).toEqual([
        {
          id: 'local-avery',
          displayName: 'Avery Approver',
          email: 'avery@local.test',
          initials: 'AA',
          roles: ['approver'],
        },
        {
          id: 'local-dana',
          displayName: 'Dana Data Owner',
          email: 'dana@local.test',
          initials: 'DD',
          roles: [],
        },
        { ...DEMO_USER, roles: ['platform-admin'] },
        {
          id: 'local-mark',
          displayName: 'Mark Maker',
          email: 'mark@local.test',
          initials: 'MM',
          roles: ['maker'],
        },
        {
          id: 'local-uma',
          displayName: 'Uma User',
          email: 'uma@local.test',
          initials: 'UU',
          roles: [],
        },
      ]);
    });

    it('signing in as Demo User answers a bearer token and the Platform admin view, no cookie', async () => {
      const res = await api('/auth/local/sign-in', {
        method: 'POST',
        body: { userId: 'local' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.getSetCookie()).toEqual([]);
      const body = (await res.json()) as {
        ok: boolean;
        message: string;
        token: string;
        me: MeView;
      };
      expect(body).toEqual({
        ok: true,
        message: 'Signed in',
        token: expect.any(String) as unknown,
        me: DEMO_ME,
      });
      expect(body.token.length).toBeGreaterThanOrEqual(32);
      tokens.local = body.token;

      expect(await json('/me', { token: body.token })).toEqual({
        status: 200,
        body: DEMO_ME,
      });
      expect((await json('/sessions', { token: body.token })).status).toBe(200);
      // The server stores only the token's hash (data-model 3.14.6).
      const stored = sql<{ doc: string }>('SELECT doc FROM auth_sessions')
        .map((row) => row.doc)
        .join('\n');
      expect(stored).not.toContain(body.token);
    });

    it('an unknown user cannot sign in', async () => {
      const res = await json('/auth/local/sign-in', {
        method: 'POST',
        body: { userId: 'nobody' },
      });
      expect(res).toEqual({
        status: 404,
        body: {
          statusCode: 404,
          message: 'User nobody not found',
          error: 'Not Found',
        },
      });
    });

    it('signing out ends the session; signing out twice is harmless', async () => {
      const token = await signInLocally(backend!.url, 'local');
      expect((await json('/me', { token })).status).toBe(200);

      expect(
        await json('/auth/local/sign-out', { method: 'POST', token }),
      ).toEqual({ status: 200, body: { ok: true, message: 'Signed out' } });
      expect((await json('/me', { token })).status).toBe(401);
      expect(
        await json('/auth/local/sign-out', { method: 'POST', token }),
      ).toEqual({ status: 200, body: { ok: true, message: 'Signed out' } });
      expect(await json('/auth/local/sign-out', { method: 'POST' })).toEqual({
        status: 200,
        body: { ok: true, message: 'Signed out' },
      });
    });

    it('records sign-in and sign-out as activity', () => {
      const events = activityEvents();
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'sign-in', actorId: 'local' }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'sign-out', actorId: 'local' }),
      );
    });
  });

  describe('Roles and permissions apply as on an org server', () => {
    it('Uma User holds only User and is refused maker and admin routes with 403', async () => {
      expect(await me('local-uma')).toEqual({
        status: 200,
        body: {
          mode: 'local',
          user: {
            id: 'local-uma',
            displayName: 'Uma User',
            email: 'uma@local.test',
            initials: 'UU',
          },
          roles: [{ role: 'user', source: 'implicit' }],
          permissions: ['use-agents'],
        },
      });
      const token = await as('local-uma');
      expect(
        await json('/agents', {
          method: 'POST',
          token,
          body: { name: "Uma's agent" },
        }),
      ).toEqual({
        status: 403,
        body: {
          statusCode: 403,
          message: 'Missing permission: create-agents',
          error: 'Forbidden',
        },
      });
      expect((await json('/admin/users', { token })).status).toBe(403);
      expect(
        (
          await json('/datasources', {
            method: 'POST',
            token,
            body: { kind: 'postgres', name: 'Nope', config: {} },
          })
        ).status,
      ).toBe(403);
    });

    it('Mark Maker and Avery Approver hold their seeded roles', async () => {
      const mark = await me('local-mark');
      expect(mark.body.roles).toContainEqual(
        expect.objectContaining({ role: 'maker', source: 'direct' }),
      );
      expect(mark.body.permissions).toContain('create-agents');
      const avery = await me('local-avery');
      expect(avery.body.roles).toContainEqual(
        expect.objectContaining({ role: 'approver', source: 'direct' }),
      );
    });

    it("Demo User's Platform admin can't be removed", async () => {
      const token = await as('local');
      // Saving no direct roles leaves the bootstrap role in place (R18, R62).
      expect(
        (
          await json('/admin/users/local/roles', {
            method: 'PUT',
            token,
            body: { roles: [] },
          })
        ).status,
      ).toBe(200);
      expect((await me('local')).body.roles).toContainEqual({
        role: 'platform-admin',
        source: 'bootstrap',
      });

      // A direct Platform admin on oneself can't be removed either (R61).
      const assigned = await json<{ assignment: { id: string } }>(
        '/admin/role-assignments',
        {
          method: 'POST',
          token,
          body: { userId: 'local', role: 'platform-admin' },
        },
      );
      expect(assigned.status).toBe(201);
      const own = await json<{ message: string }>(
        `/admin/role-assignments/${assigned.body.assignment.id}`,
        { method: 'DELETE', token },
      );
      expect(own.status).toBe(400);
      expect(own.body.message).toBe(
        "You can't remove your own Platform admin role",
      );
    });

    it('the admin routes answer in local mode, recording role changes', async () => {
      const token = await as('local');
      expect((await json('/admin/overview', { token })).status).toBe(200);
      // api.md 83: the page's rows are `items`.
      const users = await json<{ items: { id: string }[] }>('/admin/users', {
        token,
      });
      expect(users.status).toBe(200);
      expect(users.body.items.map((user) => user.id).sort()).toEqual([
        'local',
        'local-avery',
        'local-dana',
        'local-mark',
        'local-uma',
      ]);
      expect(activityEvents()).toContainEqual(
        expect.objectContaining({
          type: 'role.assigned',
          actorId: 'local',
          subjectId: 'local',
        }),
      );
    });

    it('the org server routes answer 404 in local mode', async () => {
      const token = await as('local');
      const notAvailable = {
        statusCode: 404,
        message: 'Not available in local mode',
        error: 'Not Found',
      };
      for (const [method, path] of [
        ['GET', '/auth/login'],
        ['GET', '/auth/callback'],
        ['POST', '/auth/logout'],
        ['GET', '/scim/v2/Users'],
        ['GET', '/scim/v2/ServiceProviderConfig'],
        ['POST', '/scim/v2/Groups'],
      ] as const) {
        const res = await json(path, {
          method,
          token,
          body: method === 'GET' ? undefined : {},
        });
        expect({ path, ...res }).toEqual({
          path,
          status: 404,
          body: notAvailable,
        });
      }
    });

    it('a request without any Origin header is accepted in local mode', async () => {
      expect(
        (
          await json('/developer-settings', {
            method: 'PUT',
            token: await as('local'),
            body: { observabilityEnabled: false },
          })
        ).status,
      ).toBe(200);
    });
  });

  describe('Owner scoping applies in local mode', () => {
    it("Mark Maker's agents and sessions are private", async () => {
      const mark = await as('local-mark');
      const created = await json<{ ok: boolean; agent: { id: string } }>(
        '/agents',
        { method: 'POST', token: mark, body: { name: "Mark's analyst" } },
      );
      expect(created.status).toBe(201);
      const session = await json<{ session: { id: string } }>('/sessions', {
        method: 'POST',
        token: mark,
        body: { name: "Mark's goals", datasets: ['World Cup Core'] },
      });
      expect(session.status).toBe(201);

      const agentNames = async (userId: string) =>
        (
          await json<{ agents: { name: string }[] }>('/agents', {
            token: await as(userId),
          })
        ).body.agents.map((agent) => agent.name);
      const sessionNames = async (userId: string) =>
        (
          await json<{ sessions: { name: string }[] }>('/sessions', {
            token: await as(userId),
          })
        ).body.sessions.map((s) => s.name);

      expect(await agentNames('local-mark')).toContain("Mark's analyst");
      expect(await agentNames('local-uma')).not.toContain("Mark's analyst");
      expect(await agentNames('local')).not.toContain("Mark's analyst");
      expect(await sessionNames('local-mark')).toContain("Mark's goals");
      expect(await sessionNames('local-uma')).not.toContain("Mark's goals");
      expect(await sessionNames('local')).not.toContain("Mark's goals");
      expect(
        (
          await json(`/sessions/${session.body.session.id}`, {
            token: await as('local-uma'),
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('Dana Data Owner owns every datasource', () => {
    it('a new datasource makes Dana its Data owner, once', async () => {
      const created = await json<{ ok: boolean; datasource: { id: string } }>(
        '/datasources',
        {
          method: 'POST',
          token: await as('local'),
          body: {
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
          },
        },
      );
      expect(created.status).toBe(201);
      expect(created.body.ok).toBe(true);
      const datasourceId = created.body.datasource.id;

      const dana = await me('local-dana');
      const owned = dana.body.roles.filter(
        (role) =>
          role.role === 'data-owner' && role.datasourceId === datasourceId,
      );
      expect(owned).toEqual([
        expect.objectContaining({ source: 'direct', datasourceId }),
      ]);
      expect(dana.body.permissions).toContain('approve-datasource-access');

      const users = await json<{ users: LocalUser[] }>('/auth/local/users');
      expect(
        users.body.users.find((user) => user.id === 'local-dana')?.roles,
      ).toEqual(['data-owner']);
    });
  });

  describe('After a restart', () => {
    let demoToken = '';

    beforeAll(async () => {
      demoToken = await as('local');
      // Remove Mark's seeded Maker role in Admin (R69: stays removed).
      const removed = await json<{ removed: number }>(
        '/admin/users/local-mark/roles',
        { method: 'PUT', token: demoToken, body: { roles: [] } },
      );
      expect(removed.status).toBe(200);
      expect(removed.body.removed).toBe(1);

      // A session and UI preferences stored before local sign-in existed:
      // no owner, and the unsuffixed settings key (data-model M13).
      const legacy = await json('/sessions', {
        method: 'POST',
        token: demoToken,
        body: { name: 'Legacy goals', datasets: ['World Cup Core'] },
      });
      expect(legacy.status).toBe(201);
      await stop(backend);

      sql(
        "UPDATE sessions SET doc = json_remove(doc, '$.ownerId') WHERE json_extract(doc, '$.name') = ?",
        'Legacy goals',
      );
      sql(
        "DELETE FROM settings WHERE json_extract(doc, '$.key') LIKE 'ui-preferences%'",
      );
      const now = new Date().toISOString();
      sql(
        'INSERT INTO settings (doc) VALUES (?)',
        JSON.stringify({
          id: randomUUID(),
          key: 'ui-preferences',
          theme: 'dark',
          createdAt: now,
          updatedAt: now,
        }),
      );

      backend = await boot(dataDir);
    });

    it('an auth session survives the restart (R71)', async () => {
      expect(await json('/me', { token: demoToken })).toMatchObject({
        status: 200,
        body: { user: { id: 'local' } },
      });
    });

    it('a seeded role removed in Admin is not re-added', async () => {
      const mark = await me('local-mark');
      expect(mark.body.roles).toEqual([{ role: 'user', source: 'implicit' }]);
      expect(mark.body.permissions).toEqual(['use-agents']);
    });

    it('data stored with no owner belongs to Demo User', async () => {
      const ownerIds = sql<{ ownerId: string | null }>(
        "SELECT json_extract(doc, '$.ownerId') AS ownerId FROM sessions WHERE json_extract(doc, '$.name') = ?",
        'Legacy goals',
      );
      expect(ownerIds).toEqual([{ ownerId: 'local' }]);

      const sessionNames = async (token: string) =>
        (
          await json<{ sessions: { name: string }[] }>('/sessions', { token })
        ).body.sessions.map((s) => s.name);
      expect(await sessionNames(demoToken)).toContain('Legacy goals');
      expect(await sessionNames(await as('local-uma'))).not.toContain(
        'Legacy goals',
      );
    });

    it('UI preferences stored before sign-in belong to Demo User', async () => {
      const prefs = async (token: string) =>
        (await json<{ theme: string | null }>('/ui-preferences', { token }))
          .body.theme;
      expect(await prefs(demoToken)).toBe('dark');
      expect(await prefs(await as('local-uma'))).toBeNull();
      const keys = sql<{ key: string }>(
        "SELECT json_extract(doc, '$.key') AS key FROM settings WHERE json_extract(doc, '$.key') LIKE 'ui-preferences%'",
      ).map((row) => row.key);
      expect(keys).not.toContain('ui-preferences');
      expect(keys).toContain('ui-preferences:local');
    });
  });
});
