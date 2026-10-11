/**
 * API-level proof of "Local mode answers as the local user" (Feature "Org
 * server API" in specs/capabilities/admin/spec.md) and of admin R2/R23 in
 * local mode: the built server starts (so every route declares a permission),
 * `GET /me` answers the implicit local user with every permission, and the
 * existing routes answer exactly as before the permission guard existed.
 *
 * It drives the BUILT backend (`node dist/main.js`, so run `npm run build`
 * first) as a child process with a fresh `APP_DATA_DIR` and no `ORG_*`
 * configuration. Needs no Postgres.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { type Backend, boot, stop } from './backend-process';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-local-auth-'));

jest.setTimeout(120_000);

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

describe('Local mode answers as the local user (API)', () => {
  let backend: Backend | undefined;
  const http = () => request(backend!.url);

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

  it('GET /me answers mode "local", the user "Demo User" and every permission', async () => {
    const res = await http().get('/me').expect(200);
    expect(res.body).toEqual({
      mode: 'local',
      user: {
        id: 'local',
        displayName: 'Demo User',
        email: null,
        initials: 'D',
      },
      roles: [
        { role: 'user', source: 'implicit' },
        { role: 'platform-admin', source: 'implicit' },
      ],
      permissions: ALL_PERMISSIONS,
    });
  });

  it('reads answer as before: no 401 and no 403 in local mode', async () => {
    await http().get('/sessions').expect(200);
    await http().get('/agents').expect(200);
    await http().get('/datasources').expect(200);
    await http().get('/datasets').expect(200);
    await http().get('/knowledge').expect(200);
    await http().get('/metrics').expect(200);
    await http().get('/llm/settings').expect(200);
    await http().get('/developer-settings').expect(200);
    await http().get('/ui-preferences').expect(200);
    await http().get('/testing-data').expect(200);
  });

  it('writes guarded by admin-only permissions still succeed for the local user', async () => {
    const created = await http()
      .post('/sessions')
      .send({ name: 'Local auth check', datasets: ['World Cup Core'] })
      .expect(201);
    const sessionId = (created.body as { session: { id: string } }).session.id;
    expect(sessionId).toBeTruthy();
    await http().delete(`/sessions/${sessionId}`).expect(200);

    const prefs = await http()
      .put('/ui-preferences')
      .send({ theme: 'dark' })
      .expect(200);
    expect((prefs.body as { ok: boolean }).ok).toBe(true);

    // The handler runs (its own validation answers), the guard refuses nothing.
    const dataset = await http()
      .post('/datasets')
      .send({ name: 'Local auth check', tables: [] })
      .expect(201);
    expect(dataset.body).toEqual({
      ok: false,
      message: 'Include at least one entity',
    });
  });

  it('the org server routes answer 404 in local mode, except GET /me', async () => {
    const notAvailable = {
      statusCode: 404,
      message: 'Not available in local mode',
      error: 'Not Found',
    };
    for (const [method, path] of [
      ['get', '/auth/login'],
      ['get', '/auth/callback'],
      ['post', '/auth/logout'],
      ['get', '/scim/v2/Users'],
      ['get', '/scim/v2/ServiceProviderConfig'],
      ['post', '/scim/v2/Groups'],
      ['post', '/admin/role-assignments'],
      ['delete', '/admin/role-assignments/r1'],
    ] as const) {
      const res = await http()[method](path).send({});
      expect({ path, status: res.status, body: res.body as unknown }).toEqual({
        path,
        status: 404,
        body: notAvailable,
      });
    }
  });

  it('a request without any Origin header is accepted in local mode', async () => {
    await http()
      .put('/developer-settings')
      .send({ observabilityEnabled: false })
      .expect(200);
  });
});
