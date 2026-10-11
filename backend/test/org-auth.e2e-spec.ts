/**
 * API-level proof of the Feature "Org server API" in
 * specs/capabilities/admin/spec.md (sign-in, 401, 403, Origin check, role
 * assignments) and of admin R3-R13, R16, R18-R24, R27, R36, api.md 1.9,
 * 2.13, 2.15 (79-80, and the 401 and 403 of every admin route) and 2.16
 * (the 401 of every data model route, the 403 of its writes: data-model
 * R38-R39), and non-functional N77 (never trust the email claim). It drives the BUILT backend (`npm run build` first)
 * in org server mode against the in-test OIDC stub (`test/oidc-stub.ts`).
 * Needs no Postgres and no Entra ID tenant.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootFailure } from './backend-process';
import {
  type OrgServer,
  newScimToken,
  scimUser,
  startOrgServer,
} from './org-server';

jest.setTimeout(180_000);

const ADMIN = 'admin@contoso.test';
/** A bootstrap admin whose UPN and email differ. */
const ROOT = 'root@contoso.test';
const ADA = { email: 'ada@contoso.test', name: 'Ada Lovelace' };

interface MeView {
  mode: string;
  user: {
    id: string;
    displayName: string;
    email: string | null;
    initials: string;
  };
  roles: {
    role: string;
    source: string;
    assignmentId?: string;
    groupId?: string;
  }[];
  permissions: string[];
}

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

/**
 * Every API route outside the sign-in routes, `GET /me` and SCIM, with the
 * permission api.md 1.9 gives it. Ids are placeholders: the guard answers
 * before the handler, so they never need to exist.
 */
const ROUTES: [method: string, path: string, permission: string][] = [
  ['GET', '/sessions', 'use-agents'],
  ['GET', '/sessions/s1', 'use-agents'],
  ['POST', '/sessions', 'use-agents'],
  ['DELETE', '/sessions/s1', 'use-agents'],
  ['POST', '/sessions/s1/messages/stream', 'use-agents'],
  ['POST', '/sessions/s1/messages', 'use-agents'],
  ['POST', '/sessions/s1/messages/feedback', 'use-agents'],
  ['POST', '/sessions/s1/visualizations', 'use-agents'],
  ['GET', '/sessions/s1/visualizations/v1', 'use-agents'],
  ['POST', '/sessions/s1/visualizations/v1/tailor', 'use-agents'],
  ['POST', '/sessions/s1/visualizations/v1/revert', 'use-agents'],
  ['POST', '/sessions/s1/visualizations/v1/refresh', 'use-agents'],
  ['POST', '/sessions/s1/visualizations/v1/repair', 'use-agents'],
  ['GET', '/sessions/s1/visualizations/v1/download', 'use-agents'],
  ['POST', '/sessions/s1/deep-analysis', 'use-agents'],
  ['GET', '/sessions/s1/deep-analysis/j1', 'use-agents'],
  ['GET', '/sessions/s1/deep-analysis/j1/download', 'use-agents'],
  ['GET', '/datasources', 'use-agents'],
  ['POST', '/datasources/test-connection', 'manage-datasources'],
  ['POST', '/datasources/rest/discover', 'manage-datasources'],
  ['POST', '/datasources', 'manage-datasources'],
  ['DELETE', '/datasources/d1', 'manage-datasources'],
  ['GET', '/datasources/d1/inventory', 'use-agents'],
  ['GET', '/datasets', 'use-agents'],
  ['POST', '/datasets', 'manage-datasources'],
  ['DELETE', '/datasets/n1', 'manage-datasources'],
  ['GET', '/metrics', 'use-agents'],
  ['GET', '/metrics/candidates', 'use-agents'],
  ['POST', '/metrics', 'use-agents'],
  ['PUT', '/metrics/m1', 'use-agents'],
  ['DELETE', '/metrics/m1', 'use-agents'],
  ['GET', '/data-models/schema.json', 'use-agents'],
  ['GET', '/datasets/n1/model', 'use-agents'],
  ['GET', '/datasets/n1/model/versions', 'use-agents'],
  ['GET', '/datasets/n1/model/versions/1', 'use-agents'],
  ['GET', '/datasets/n1/model/drift', 'use-agents'],
  ['GET', '/datasets/n1/model/export', 'use-agents'],
  ['GET', '/datasets/n1/model/metrics', 'use-agents'],
  ['GET', '/datasets/n1/model/metrics/candidates', 'use-agents'],
  ['POST', '/datasets/n1/model/resolve', 'use-agents'],
  ['POST', '/datasets/n1/model/compile', 'use-agents'],
  ['POST', '/datasets/n1/model/query', 'use-agents'],
  ['POST', '/datasets/n1/model/serialize', 'use-agents'],
  ['PUT', '/datasets/n1/model', 'manage-datasources'],
  ['POST', '/datasets/n1/model/revert', 'manage-datasources'],
  ['POST', '/datasets/n1/model/bootstrap', 'manage-datasources'],
  ['POST', '/datasets/n1/model/import', 'manage-datasources'],
  ['POST', '/datasets/n1/model/metrics', 'manage-datasources'],
  ['PUT', '/datasets/n1/model/metrics/m1', 'manage-datasources'],
  ['DELETE', '/datasets/n1/model/metrics/m1', 'manage-datasources'],
  ['GET', '/llm/settings', 'use-agents'],
  ['GET', '/llm/effort-levels', 'use-agents'],
  ['PUT', '/llm/settings', 'manage-llm'],
  ['PUT', '/llm/reasoning', 'manage-llm'],
  ['POST', '/llm/test-connection', 'manage-llm'],
  ['GET', '/agents', 'use-agents'],
  ['GET', '/agents/assistant', 'use-agents'],
  ['GET', '/agents/assistant/evals', 'use-agents'],
  ['POST', '/agents/assistant/evals/run', 'create-agents'],
  ['GET', '/agents/assistant/evals/runs', 'create-agents'],
  ['GET', '/agents/assistant/evals/runs/j1', 'create-agents'],
  ['GET', '/agents/assistant/evals/runs/j1/download', 'create-agents'],
  ['DELETE', '/agents/assistant/evals/runs/j1', 'create-agents'],
  ['POST', '/agents', 'create-agents'],
  ['PUT', '/agents/a1/draft', 'create-agents'],
  ['POST', '/agents/a1/publish', 'create-agents'],
  ['DELETE', '/agents/a1', 'create-agents'],
  ['PUT', '/agents/assistant/pin', 'use-agents'],
  ['GET', '/knowledge', 'use-agents'],
  ['POST', '/knowledge', 'use-agents'],
  ['PATCH', '/knowledge/k1', 'use-agents'],
  ['DELETE', '/knowledge/k1', 'use-agents'],
  ['POST', '/knowledge/bootstrap', 'use-agents'],
  ['POST', '/knowledge/bootstrap/stream', 'use-agents'],
  ['GET', '/testing-data', 'manage-datasources'],
  ['POST', '/testing-data/world-cup/load', 'manage-datasources'],
  ['DELETE', '/testing-data/world-cup', 'manage-datasources'],
  ['GET', '/developer-settings', 'edit-policies'],
  ['PUT', '/developer-settings', 'edit-policies'],
  ['POST', '/developer-settings/test-endpoint', 'edit-policies'],
  ['GET', '/ui-preferences', 'use-agents'],
  ['PUT', '/ui-preferences', 'use-agents'],
  ['POST', '/admin/role-assignments', 'manage-users'],
  ['DELETE', '/admin/role-assignments/r1', 'manage-users'],
  ['GET', '/admin/overview', 'manage-users'],
  ['GET', '/admin/overview/export', 'manage-users'],
  ['GET', '/admin/users', 'manage-users'],
  ['GET', '/admin/users/u1', 'manage-users'],
  ['PUT', '/admin/users/u1/roles', 'manage-users'],
  ['POST', '/admin/agents/transfer', 'manage-users'],
  ['GET', '/admin/groups', 'manage-users'],
  ['GET', '/admin/role-mappings', 'manage-users'],
  ['POST', '/admin/role-mappings', 'manage-users'],
  ['DELETE', '/admin/role-mappings/m1', 'manage-users'],
];

describe('Org server API: sign-in, 401, 403 and the Origin check', () => {
  let org: OrgServer;
  let adminCookie = '';

  const me = async (cookie: string | null) => {
    const res = await org.api('/me', { cookie });
    return { status: res.status, body: (await res.json()) as MeView };
  };

  beforeAll(async () => {
    // Bootstrap user names (UPNs) match case-insensitively (admin R18).
    org = await startOrgServer({
      bootstrapAdmins: [' ADMIN@Contoso.test ', '', ROOT.toUpperCase()],
    });
    adminCookie = await org.signIn({ email: ADMIN, name: 'Avery Admin' });
  });

  afterAll(async () => {
    await org?.close();
  });

  describe('Every route refuses an unauthenticated request', () => {
    it.each(ROUTES)('%s %s answers 401', async (method, path) => {
      const res = await org.api(path, {
        method,
        body: method === 'GET' ? undefined : {},
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        statusCode: 401,
        message: 'Sign in required',
        error: 'Unauthorized',
      });
    });

    it('GET /me answers 401 without an auth session', async () => {
      expect((await me(null)).status).toBe(401);
    });

    it('an unknown cookie is the same as none', async () => {
      expect((await me('qti_session=not-a-real-token')).status).toBe(401);
      const res = await org.api('/sessions', { cookie: 'qti_session=nope' });
      expect(res.status).toBe(401);
    });

    it('the public sign-in routes answer without a session', async () => {
      const login = await org.api('/auth/login');
      expect(login.status).toBe(302);
      const logout = await org.api('/auth/logout', { method: 'POST' });
      expect(logout.status).toBe(200);
    });

    it('the web UI shell and an unknown route are not hidden behind 401', async () => {
      // The SPA must load to show the sign-in page; unmatched routes stay 404.
      const res = await org.api('/no-such-route');
      expect(res.status).toBe(404);
    });
  });

  describe('Signing in', () => {
    it('a person not yet in the directory is added at first sign-in with the User role only', async () => {
      const { location, cookie } = await org.signInRoundTrip(ADA);
      expect(location).toBe('/');
      expect(cookie).toMatch(/^qti_session=[A-Za-z0-9_-]{43}$/);
      const { status, body } = await me(cookie);
      expect(status).toBe(200);
      expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(body).toEqual({
        mode: 'org',
        user: {
          id: body.user.id,
          displayName: 'Ada Lovelace',
          email: 'ada@contoso.test',
          initials: 'AL',
        },
        roles: [{ role: 'user', source: 'implicit' }],
        permissions: ['use-agents'],
      });
      // SCIM now lists her (admin R12, R15).
      const scim = await org.scim(
        `/Users?filter=${encodeURIComponent('userName eq "ada@contoso.test"')}`,
      );
      const list = (await scim.json()) as {
        totalResults: number;
        Resources: { id: string }[];
      };
      expect(list.totalResults).toBe(1);
      expect(list.Resources[0].id).toBe(body.user.id);
    });

    it('sets an HttpOnly, SameSite=Lax session cookie, not Secure over http, and stores only its hash', async () => {
      org.stub.signInAs(ADA);
      const login = await fetch(`${org.url}/auth/login`, {
        redirect: 'manual',
      });
      const oidc = login.headers
        .getSetCookie()
        .find((c) => c.startsWith('qti_oidc='));
      expect(oidc).toMatch(/HttpOnly/i);
      expect(oidc).toMatch(/SameSite=Lax/i);
      expect(oidc).toMatch(/Path=\/auth/i);
      expect(oidc).toMatch(/Max-Age=600/i);
      expect(oidc).not.toMatch(/Secure/i);
      const provider = new URL(login.headers.get('location')!);
      expect(provider.origin + provider.pathname).toBe(
        `${org.stub.issuer}/authorize`,
      );
      expect(provider.searchParams.get('response_type')).toBe('code');
      expect(provider.searchParams.get('scope')).toBe('openid profile email');
      expect(provider.searchParams.get('redirect_uri')).toBe(
        `${org.url}/auth/callback`,
      );
      expect(provider.searchParams.get('code_challenge_method')).toBe('S256');
      expect(provider.searchParams.get('state')).toBeTruthy();
      expect(provider.searchParams.get('nonce')).toBeTruthy();

      const authorize = await fetch(provider, { redirect: 'manual' });
      const callback = await fetch(authorize.headers.get('location')!, {
        redirect: 'manual',
        headers: { Cookie: oidc!.split(';')[0] },
      });
      const cookies = callback.headers.getSetCookie();
      const session = cookies.find((c) => c.startsWith('qti_session='))!;
      expect(session).toMatch(/HttpOnly/i);
      expect(session).toMatch(/SameSite=Lax/i);
      expect(session).toMatch(/Path=\//i);
      expect(session).not.toMatch(/Secure/i);
      expect(session).not.toMatch(/Max-Age|Expires/i);
      // The round-trip cookie is cleared.
      expect(cookies.find((c) => c.startsWith('qti_oidc='))).toMatch(
        /Max-Age=0/i,
      );

      const token = session.split(';')[0].slice('qti_session='.length);
      const rows = org.sql<{ doc: string }>('SELECT doc FROM auth_sessions');
      const docs = rows.map((r) => JSON.parse(r.doc) as { id: string });
      expect(docs.some((d) => d.id === token)).toBe(false);
      const hash = createHash('sha256').update(token).digest('hex');
      expect(docs.some((d) => d.id === hash)).toBe(true);
    });

    it('keeps a safe returnTo and ignores one outside the app', async () => {
      org.stub.signInAs(ADA);
      const roundTrip = async (returnTo: string) => {
        const login = await fetch(
          `${org.url}/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
          { redirect: 'manual' },
        );
        const oidc = login.headers.getSetCookie()[0].split(';')[0];
        const authorize = await fetch(login.headers.get('location')!, {
          redirect: 'manual',
        });
        const callback = await fetch(authorize.headers.get('location')!, {
          redirect: 'manual',
          headers: { Cookie: oidc },
        });
        return callback.headers.get('location');
      };
      expect(await roundTrip('/agents')).toBe('/agents');
      expect(await roundTrip('//evil.test/x')).toBe('/');
      expect(await roundTrip('https://evil.test/')).toBe('/');
    });

    it('a sign-in the identity provider refuses returns with signInError=failed and no session', async () => {
      org.stub.failNextSignIn('access_denied');
      const { location, cookie } = await org.signInRoundTrip(ADA);
      expect(location).toBe('/?signInError=failed');
      expect(cookie).toBeNull();
    });

    it('a callback with a state that does not match, or without the round-trip cookie, fails', async () => {
      org.stub.signInAs(ADA);
      const login = await fetch(`${org.url}/auth/login`, {
        redirect: 'manual',
      });
      const oidc = login.headers.getSetCookie()[0].split(';')[0];
      const authorize = await fetch(login.headers.get('location')!, {
        redirect: 'manual',
      });
      const callbackUrl = new URL(authorize.headers.get('location')!);
      callbackUrl.searchParams.set('state', 'tampered');
      const tampered = await fetch(callbackUrl, {
        redirect: 'manual',
        headers: { Cookie: oidc },
      });
      expect(tampered.headers.get('location')).toBe('/?signInError=failed');
      expect(
        tampered.headers
          .getSetCookie()
          .some((c) => c.startsWith('qti_session=') && !/Max-Age=0/i.test(c)),
      ).toBe(false);

      const noCookie = await fetch(authorize.headers.get('location')!, {
        redirect: 'manual',
      });
      expect(noCookie.headers.get('location')).toBe('/?signInError=failed');
    });

    it('a SCIM-provisioned user is matched at sign-in, not duplicated (R13, R15)', async () => {
      const created = await org.scim('/Users', {
        method: 'POST',
        body: scimUser('Grace@Contoso.test', 'Grace Hopper'),
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      const cookie = await org.signIn({
        email: 'grace@contoso.test',
        name: 'Grace B. Hopper',
      });
      const { body } = await me(cookie);
      expect(body.user.id).toBe(id);
      // The display name is refreshed from the claims.
      expect(body.user.displayName).toBe('Grace B. Hopper');
    });

    it('a bootstrap admin holds Platform admin and every permission', async () => {
      const { body } = await me(adminCookie);
      expect(body.roles).toEqual([
        { role: 'user', source: 'implicit' },
        { role: 'platform-admin', source: 'bootstrap' },
      ]);
      expect(body.permissions).toEqual(ALL_PERMISSIONS);
    });

    it("an email claim equal to the bootstrap admin's never lands on their account nor grants Platform admin (R13, R18, N77)", async () => {
      const adminBefore = (await me(adminCookie)).body;
      const cookie = await org.signIn({
        preferredUsername: 'mallory@contoso.test',
        email: ADMIN,
        name: 'Mallory Spoof',
      });
      const { status, body } = await me(cookie);
      expect(status).toBe(200);
      expect(body.user.id).not.toBe(adminBefore.user.id);
      expect(body.user.displayName).toBe('Mallory Spoof');
      expect(body.roles).toEqual([{ role: 'user', source: 'implicit' }]);
      expect(body.permissions).toEqual(['use-agents']);
      // The admin's account is untouched and still the only Platform admin.
      expect((await me(adminCookie)).body).toEqual(adminBefore);
      const scim = await org.scim(
        `/Users?filter=${encodeURIComponent('userName eq "mallory@contoso.test"')}`,
      );
      const list = (await scim.json()) as {
        totalResults: number;
        Resources: { id: string }[];
      };
      expect(list.totalResults).toBe(1);
      expect(list.Resources[0].id).toBe(body.user.id);
    });

    it('a bootstrap admin is matched by UPN, whatever their email claim (R18)', async () => {
      const cookie = await org.signIn({
        preferredUsername: 'Root@Contoso.test',
        email: 'root.mail@elsewhere.test',
        name: 'Rory Root',
      });
      const { body } = await me(cookie);
      expect(body.user.email).toBe('root.mail@elsewhere.test');
      expect(body.roles).toEqual([
        { role: 'user', source: 'implicit' },
        { role: 'platform-admin', source: 'bootstrap' },
      ]);
    });

    it('a sign-in name now held by a different subject is refused, changes nothing and is recorded (R13)', async () => {
      const adaCookie = await org.signIn(ADA);
      const before = (await me(adaCookie)).body;
      const { location, cookie } = await org.signInRoundTrip({
        ...ADA,
        sub: 'a-different-person',
        name: 'Ada Impostor',
      });
      expect(location).toBe('/?signInError=failed');
      expect(cookie).toBeNull();
      expect((await me(adaCookie)).body).toEqual(before);
      const refused = org
        .sql<{ doc: string }>('SELECT doc FROM activity_events')
        .map(
          (r) =>
            JSON.parse(r.doc) as {
              type: string;
              actorId?: string;
              subjectId?: string;
              details?: unknown;
            },
        )
        .filter((e) => e.type === 'sign-in.refused');
      expect(refused).toEqual([
        expect.objectContaining({
          subjectId: before.user.id,
          details: { reason: 'subject-mismatch' },
        }),
      ]);
      expect(refused[0].actorId).toBeUndefined();
    });

    it('records sign-in and the first request of the day as activity', () => {
      const types = org
        .sql<{ doc: string }>('SELECT doc FROM activity_events')
        .map((r) => (JSON.parse(r.doc) as { type: string }).type);
      expect(types).toContain('sign-in');
      expect(types).toContain('user.active');
    });
  });

  describe('Auth sessions end', () => {
    const setSession = (cookie: string, field: string, value: string) => {
      const token = cookie.slice('qti_session='.length);
      const hash = createHash('sha256').update(token).digest('hex');
      org.sql(
        `UPDATE auth_sessions SET doc = json_set(doc, '$.${field}', ?) WHERE json_extract(doc, '$.id') = ?`,
        value,
        hash,
      );
    };

    it('7 days after sign-in', async () => {
      const cookie = await org.signIn(ADA);
      expect((await me(cookie)).status).toBe(200);
      setSession(
        cookie,
        'expiresAt',
        new Date(Date.now() - 1000).toISOString(),
      );
      expect((await me(cookie)).status).toBe(401);
      expect((await org.api('/sessions', { cookie })).status).toBe(401);
    });

    it('after 8 hours without a request', async () => {
      const cookie = await org.signIn(ADA);
      setSession(
        cookie,
        'lastSeenAt',
        new Date(Date.now() - 9 * 3600_000).toISOString(),
      );
      expect((await me(cookie)).status).toBe(401);
    });

    it('on sign-out, which also returns the end-session URL, and leaves other browsers signed in', async () => {
      const first = await org.signIn(ADA);
      const second = await org.signIn(ADA);
      const res = await org.api('/auth/logout', {
        method: 'POST',
        cookie: first,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        message: string;
        endSessionUrl: string;
      };
      expect(body.ok).toBe(true);
      expect(body.message).toBe('Signed out');
      const end = new URL(body.endSessionUrl);
      expect(end.origin + end.pathname).toBe(`${org.stub.issuer}/logout`);
      expect(end.searchParams.get('post_logout_redirect_uri')).toBe(
        `${org.url}/`,
      );
      expect(end.searchParams.get('client_id')).toBe(org.stub.clientId);
      expect(
        res.headers.getSetCookie().find((c) => c.startsWith('qti_session=')),
      ).toMatch(/Max-Age=0/i);
      expect((await me(first)).status).toBe(401);
      expect((await me(second)).status).toBe(200);
      // Signing out twice is harmless.
      const again = await org.api('/auth/logout', {
        method: 'POST',
        cookie: first,
      });
      expect(again.status).toBe(200);
      const types = org
        .sql<{ doc: string }>('SELECT doc FROM activity_events')
        .map((r) => (JSON.parse(r.doc) as { type: string }).type);
      expect(types).toContain('sign-out');
    });
  });

  describe('Every route refuses a caller without its permission', () => {
    let userCookie = '';
    beforeAll(async () => {
      userCookie = await org.signIn({
        email: 'user@contoso.test',
        name: 'Una User',
      });
    });

    const guarded = ROUTES.filter(
      ([, , permission]) => permission !== 'use-agents',
    );

    it.each(guarded)('%s %s answers 403', async (method, path, permission) => {
      const res = await org.api(path, {
        method,
        cookie: userCookie,
        body: method === 'GET' ? undefined : {},
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        statusCode: 403,
        message: `Missing permission: ${permission}`,
        error: 'Forbidden',
      });
    });

    it('a refused write changes nothing', async () => {
      await org.api('/developer-settings', {
        method: 'PUT',
        cookie: userCookie,
        body: { observabilityEnabled: true },
      });
      const res = await org.api('/developer-settings', { cookie: adminCookie });
      const view = (await res.json()) as {
        saved: { observabilityEnabled: boolean };
      };
      expect(view.saved.observabilityEnabled).toBe(false);
    });

    it('GET /llm/settings hides the masked key from a caller without manage-llm', async () => {
      const res = await org.api('/llm/settings', { cookie: userCookie });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { apiKeyMasked?: unknown };
      expect(body.apiKeyMasked ?? null).toBeNull();
    });
  });

  describe('A cross-site request is refused', () => {
    let cookie = '';
    beforeAll(async () => {
      cookie = await org.signIn({
        email: 'origin@contoso.test',
        name: 'Oscar Origin',
      });
    });

    const sessionCount = async () => {
      const res = await org.api('/sessions', { cookie });
      return ((await res.json()) as { sessions: unknown[] }).sessions.length;
    };

    it('POST /sessions with the Origin https://evil.test answers 403 and creates nothing', async () => {
      const before = await sessionCount();
      const res = await org.api('/sessions', {
        method: 'POST',
        cookie,
        origin: 'https://evil.test',
        body: { name: 'Cross-site', datasets: [] },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        statusCode: 403,
        message: 'Cross-site request refused',
        error: 'Forbidden',
      });
      expect(await sessionCount()).toBe(before);
    });

    it('a write with neither Origin nor Referer is refused; a matching Referer is accepted', async () => {
      const none = await org.api('/ui-preferences', {
        method: 'PUT',
        cookie,
        origin: null,
        body: { theme: 'dark' },
      });
      expect(none.status).toBe(403);
      const referer = await org.api('/ui-preferences', {
        method: 'PUT',
        cookie,
        origin: null,
        headers: { Referer: `${org.url}/settings` },
        body: { theme: 'dark' },
      });
      expect(referer.status).toBe(200);
    });

    it('UI preferences are per user in org server mode', async () => {
      await org.api('/ui-preferences', {
        method: 'PUT',
        cookie,
        body: { theme: 'dark', navExpanded: false },
      });
      const mine = await org.api('/ui-preferences', { cookie });
      expect(await mine.json()).toEqual({ theme: 'dark', navExpanded: false });
      const theirs = await org.api('/ui-preferences', { cookie: adminCookie });
      expect(await theirs.json()).toEqual({ theme: null, navExpanded: null });
    });
  });

  describe('Role assignments (api.md 79, 80)', () => {
    let adaId = '';
    let adaCookie = '';
    let adminId = '';

    beforeAll(async () => {
      adaCookie = await org.signIn(ADA);
      adaId = (await me(adaCookie)).body.user.id;
      adminId = (await me(adminCookie)).body.user.id;
    });

    const assign = (body: unknown, cookie = adminCookie) =>
      org.api('/admin/role-assignments', { method: 'POST', cookie, body });

    it('assigns a role, which applies to the next request without signing in again', async () => {
      const res = await assign({ userId: adaId, role: 'maker' });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        ok: boolean;
        message: string;
        assignment: {
          id: string;
          userId: string;
          role: string;
          assignedBy: string;
        };
      };
      expect(body).toMatchObject({
        ok: true,
        message: 'Role assigned',
        assignment: { userId: adaId, role: 'maker', assignedBy: adminId },
      });
      const { body: view } = await me(adaCookie);
      expect(view.roles).toContainEqual({
        role: 'maker',
        source: 'direct',
        assignmentId: body.assignment.id,
      });
      expect(view.permissions).toContain('create-agents');

      const again = await assign({ userId: adaId, role: 'maker' });
      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({
        ok: true,
        message: 'Role already assigned',
        assignment: { id: body.assignment.id },
      });

      const removed = await org.api(
        `/admin/role-assignments/${body.assignment.id}`,
        {
          method: 'DELETE',
          cookie: adminCookie,
        },
      );
      expect(removed.status).toBe(200);
      expect(await removed.json()).toEqual({
        ok: true,
        message: 'Role removed',
      });
      expect((await me(adaCookie)).body.permissions).toEqual(['use-agents']);

      const gone = await org.api(
        `/admin/role-assignments/${body.assignment.id}`,
        {
          method: 'DELETE',
          cookie: adminCookie,
        },
      );
      expect(gone.status).toBe(404);
      expect(((await gone.json()) as { message: string }).message).toBe(
        `Role assignment ${body.assignment.id} not found`,
      );

      const types = org
        .sql<{ doc: string }>('SELECT doc FROM activity_events')
        .map(
          (r) =>
            JSON.parse(r.doc) as {
              type: string;
              actorId?: string;
              subjectId?: string;
            },
        );
      expect(types).toContainEqual(
        expect.objectContaining({
          type: 'role.assigned',
          actorId: adminId,
          subjectId: adaId,
        }),
      );
      expect(types).toContainEqual(
        expect.objectContaining({
          type: 'role.removed',
          actorId: adminId,
          subjectId: adaId,
        }),
      );
    });

    it.each([
      [{ role: 'wizard' }, 400, 'Unknown role: wizard'],
      [{ role: 'user' }, 400, 'The User role is implicit'],
      [{ role: 'data-owner' }, 400, 'Data owner needs a datasource'],
      [
        { role: 'maker', datasourceId: 'd1' },
        400,
        'Only Data owner takes a datasource',
      ],
      [
        { role: 'data-owner', datasourceId: 'missing-ds' },
        404,
        'Datasource missing-ds not found',
      ],
    ])('refuses %j with %i', async (extra, status, message) => {
      const res = await assign({ userId: adaId, ...extra });
      expect(res.status).toBe(status);
      expect(((await res.json()) as { message: string }).message).toBe(message);
    });

    it('refuses an unknown user with 404', async () => {
      const res = await assign({ userId: 'nobody', role: 'maker' });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { message: string }).message).toBe(
        'User nobody not found',
      );
    });

    it('assigns Data owner on an existing datasource', async () => {
      org.insertDoc('connections', {
        id: 'ds-1',
        name: 'Warehouse',
        kind: 'postgres',
        config: {
          host: '127.0.0.1',
          port: 5432,
          database: 'dw',
          user: 'dw',
          password: 'secret',
        },
      });
      const res = await assign({
        userId: adaId,
        role: 'data-owner',
        datasourceId: 'ds-1',
      });
      expect(res.status).toBe(201);
      const { body } = await me(adaCookie);
      expect(body.roles).toContainEqual(
        expect.objectContaining({
          role: 'data-owner',
          source: 'direct',
          datasourceId: 'ds-1',
        }),
      );
      expect(body.permissions).toContain('approve-datasource-access');
    });

    it("refuses removing the caller's own Platform admin role with 400", async () => {
      // Make Ada a direct Platform admin, then let her try to remove it.
      const res = await assign({ userId: adaId, role: 'platform-admin' });
      const { assignment } = (await res.json()) as {
        assignment: { id: string };
      };
      const own = await org.api(`/admin/role-assignments/${assignment.id}`, {
        method: 'DELETE',
        cookie: adaCookie,
      });
      expect(own.status).toBe(400);
      expect(((await own.json()) as { message: string }).message).toBe(
        "You can't remove your own Platform admin role",
      );
      // Another Platform admin (here the bootstrap admin) can.
      const other = await org.api(`/admin/role-assignments/${assignment.id}`, {
        method: 'DELETE',
        cookie: adminCookie,
      });
      expect(other.status).toBe(200);
    });
  });
});

describe('Org server configuration', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'qti-org-config-'));
  afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

  it('a partial configuration stops startup and names what is missing', async () => {
    const { code, output } = await bootFailure(dataDir, {
      ORG_OIDC_ISSUER: 'https://login.example.test/tenant/v2.0',
      ORG_OIDC_CLIENT_ID: 'client',
      ORG_OIDC_CLIENT_SECRET: 'secret',
      ORG_PUBLIC_BASE_URL: 'https://insights.example.test',
    });
    expect(code).not.toBe(0);
    expect(output).toContain('missing: ORG_SCIM_TOKEN');
  });

  it('a multi-tenant issuer stops startup and names ORG_OIDC_ISSUER (R3)', async () => {
    const { code, output } = await bootFailure(dataDir, {
      ORG_OIDC_ISSUER: 'https://login.microsoftonline.com/common/v2.0',
      ORG_OIDC_CLIENT_ID: 'client',
      ORG_OIDC_CLIENT_SECRET: 'secret',
      ORG_PUBLIC_BASE_URL: 'https://insights.example.test',
      ORG_SCIM_TOKEN: newScimToken(),
    });
    expect(code).not.toBe(0);
    expect(output).toContain('ORG_OIDC_ISSUER must name one tenant');
  });

  it('a SCIM token shorter than 32 characters stops startup', async () => {
    const { code, output } = await bootFailure(dataDir, {
      ORG_OIDC_ISSUER: 'https://login.example.test/tenant/v2.0',
      ORG_OIDC_CLIENT_ID: 'client',
      ORG_OIDC_CLIENT_SECRET: 'secret',
      ORG_PUBLIC_BASE_URL: 'https://insights.example.test',
      ORG_SCIM_TOKEN: 'short',
    });
    expect(code).not.toBe(0);
    expect(output).toContain('ORG_SCIM_TOKEN must be at least 32 characters');
    expect(newScimToken().length).toBeGreaterThanOrEqual(32);
  });
});
