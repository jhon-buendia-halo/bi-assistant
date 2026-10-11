/**
 * API-level proof of the SCIM scenarios of the Feature "Org server API" in
 * specs/capabilities/admin/spec.md ("SCIM needs its token", "SCIM provisions
 * users, groups and memberships", "A group mapping grants its role to the
 * group's members") and of admin R14-R17 and api.md 2.14. It drives the
 * BUILT backend (`npm run build` first) in org server mode against the OIDC
 * stub. Group mappings have no API yet (api.md 89 ships with BA-167), so the
 * mapping is written straight into `app.sqlite`, as the store holds it
 * (data-model 3.14.5).
 */
import { randomUUID } from 'node:crypto';
import { type OrgServer, scimUser, startOrgServer } from './org-server';

jest.setTimeout(180_000);

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

interface ScimUser {
  id: string;
  userName: string;
  active: boolean;
  displayName: string;
  externalId?: string;
  name: { givenName?: string; familyName?: string };
  emails: { value: string; type: string; primary: boolean }[];
  meta: {
    resourceType: string;
    location: string;
    created: string;
    lastModified: string;
  };
  schemas: string[];
}

interface ScimGroup {
  id: string;
  displayName: string;
  externalId?: string;
  members?: { value: string; display?: string }[];
  schemas: string[];
  meta: { resourceType: string; location: string };
}

interface ScimList<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

const patch = (...Operations: Record<string, unknown>[]) => ({
  schemas: [PATCH_SCHEMA],
  Operations,
});

const filter = (expr: string) => `filter=${encodeURIComponent(expr)}`;

describe('Org server API: SCIM 2.0', () => {
  let org: OrgServer;
  let startedAt = 0;

  const json = async <T>(res: Response) => (await res.json()) as T;
  const me = async (cookie: string) => {
    const res = await org.api('/me', { cookie });
    return {
      status: res.status,
      body: await json<{
        user: { id: string };
        roles: { role: string; source: string; groupId?: string }[];
        permissions: string[];
      }>(res),
    };
  };

  beforeAll(async () => {
    org = await startOrgServer();
    startedAt = Date.now();
  });

  afterAll(async () => {
    await org?.close();
  });

  describe('SCIM needs its token', () => {
    it.each([
      ['no token', null],
      ['a wrong token', 'x'.repeat(48)],
    ])(
      'GET /scim/v2/Users with %s answers 401 in SCIM error format',
      async (_label, token) => {
        const res = await org.scim('/Users', { token });
        expect(res.status).toBe(401);
        expect(res.headers.get('content-type')).toContain(
          'application/scim+json',
        );
        expect(await res.json()).toMatchObject({
          schemas: [ERROR_SCHEMA],
          status: '401',
        });
      },
    );

    it('an auth session cookie does not open SCIM', async () => {
      const cookie = await org.signIn({
        email: 'cookie@contoso.test',
        name: 'Cody Cookie',
      });
      const res = await fetch(`${org.url}/scim/v2/Users`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(401);
    });

    it('SCIM needs no Origin header', async () => {
      const res = await org.scim('/Users', {
        method: 'POST',
        body: scimUser('origin-free@contoso.test', 'Orin Free'),
      });
      expect(res.status).toBe(201);
    });
  });

  describe('Discovery', () => {
    it('ServiceProviderConfig, ResourceTypes and Schemas describe the subset', async () => {
      const config = await json<
        Record<string, { supported: boolean; maxResults?: number }> & {
          authenticationSchemes: { type: string }[];
        }
      >(await org.scim('/ServiceProviderConfig'));
      expect(config.patch.supported).toBe(true);
      expect(config.filter).toMatchObject({ supported: true, maxResults: 100 });
      expect(config.bulk.supported).toBe(false);
      expect(config.changePassword.supported).toBe(false);
      expect(config.sort.supported).toBe(false);
      expect(config.etag.supported).toBe(false);
      expect(config.authenticationSchemes[0].type).toBe('oauthbearertoken');

      const types = await json<ScimList<{ name: string; endpoint: string }>>(
        await org.scim('/ResourceTypes'),
      );
      expect(types.Resources.map((t) => t.name).sort()).toEqual([
        'Group',
        'User',
      ]);

      const schemas = await json<ScimList<{ id: string }>>(
        await org.scim('/Schemas'),
      );
      expect(schemas.Resources.map((s) => s.id).sort()).toEqual(
        [GROUP_SCHEMA, USER_SCHEMA].sort(),
      );
    });
  });

  describe('Users', () => {
    let ada: ScimUser;

    it('creates a user: 201, a Location header and the resource', async () => {
      const res = await org.scim('/Users', {
        method: 'POST',
        body: scimUser('Ada@Contoso.test', 'Ada Lovelace', {
          externalId: 'ext-ada',
        }),
      });
      expect(res.status).toBe(201);
      expect(res.headers.get('content-type')).toContain(
        'application/scim+json',
      );
      ada = await json<ScimUser>(res);
      expect(res.headers.get('location')).toBe(
        `${org.url}/scim/v2/Users/${ada.id}`,
      );
      expect(ada).toMatchObject({
        schemas: [USER_SCHEMA],
        userName: 'ada@contoso.test',
        active: true,
        displayName: 'Ada Lovelace',
        externalId: 'ext-ada',
        name: { givenName: 'Ada', familyName: 'Lovelace' },
        emails: [{ value: 'ada@contoso.test', type: 'work', primary: true }],
        meta: {
          resourceType: 'User',
          location: `${org.url}/scim/v2/Users/${ada.id}`,
        },
      });
    });

    it('refuses a duplicate userName with 409 uniqueness', async () => {
      const res = await org.scim('/Users', {
        method: 'POST',
        body: scimUser('ADA@contoso.test', 'Ada Again'),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        schemas: [ERROR_SCHEMA],
        status: '409',
        scimType: 'uniqueness',
      });
    });

    it('refuses a user without userName with 400', async () => {
      const res = await org.scim('/Users', {
        method: 'POST',
        body: { schemas: [USER_SCHEMA], displayName: 'Nameless' },
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        status: '400',
        scimType: 'invalidValue',
      });
    });

    it('reads, filters and pages users', async () => {
      const one = await json<ScimUser>(await org.scim(`/Users/${ada.id}`));
      expect(one.userName).toBe('ada@contoso.test');

      const byName = await json<ScimList<ScimUser>>(
        await org.scim(`/Users?${filter('userName eq "ADA@contoso.test"')}`),
      );
      expect(byName).toMatchObject({
        schemas: [LIST_SCHEMA],
        totalResults: 1,
        startIndex: 1,
      });
      expect(byName.Resources[0].id).toBe(ada.id);

      const byExternal = await json<ScimList<ScimUser>>(
        await org.scim(`/Users?${filter('externalId eq "ext-ada"')}`),
      );
      expect(byExternal.totalResults).toBe(1);

      const none = await json<ScimList<ScimUser>>(
        await org.scim(`/Users?${filter('userName eq "nobody@contoso.test"')}`),
      );
      expect(none.totalResults).toBe(0);
      expect(none.Resources).toEqual([]);

      const paged = await json<ScimList<ScimUser>>(
        await org.scim('/Users?startIndex=1&count=1'),
      );
      expect(paged.itemsPerPage).toBe(1);
      expect(paged.Resources).toHaveLength(1);
      expect(paged.totalResults).toBeGreaterThanOrEqual(2);
    });

    it('answers 400 invalidFilter for an unsupported filter and 404 for an unknown id', async () => {
      const bad = await org.scim(`/Users?${filter('displayName co "Ada"')}`);
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ scimType: 'invalidFilter' });

      const missing = await org.scim(`/Users/${randomUUID()}`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({
        schemas: [ERROR_SCHEMA],
        status: '404',
      });
    });

    it('replaces a user with PUT', async () => {
      const res = await org.scim(`/Users/${ada.id}`, {
        method: 'PUT',
        body: scimUser('ada@contoso.test', 'Ada King', {
          externalId: 'ext-ada',
        }),
      });
      expect(res.status).toBe(200);
      expect((await json<ScimUser>(res)).displayName).toBe('Ada King');
    });

    it('patches attributes the way Entra ID sends them', async () => {
      const res = await org.scim(`/Users/${ada.id}`, {
        method: 'PATCH',
        body: patch(
          { op: 'Replace', path: 'displayName', value: 'Ada Lovelace' },
          { op: 'Add', path: 'name.familyName', value: 'Lovelace' },
          {
            op: 'replace',
            path: 'emails[type eq "work"].value',
            value: 'ada.lovelace@contoso.test',
          },
          { op: 'replace', value: { 'name.givenName': 'Augusta Ada' } },
        ),
      });
      expect(res.status).toBe(200);
      const body = await json<ScimUser>(res);
      expect(body.displayName).toBe('Ada Lovelace');
      expect(body.name).toMatchObject({
        givenName: 'Augusta Ada',
        familyName: 'Lovelace',
      });
      expect(body.emails[0].value).toBe('ada.lovelace@contoso.test');
    });
  });

  describe('SCIM provisions users, groups and memberships; deactivation', () => {
    let ada: ScimUser;
    let grace: ScimUser;
    let analysts: ScimGroup;
    let adaCookie = '';

    beforeAll(async () => {
      ada = await json<ScimUser>(
        await org.scim('/Users', {
          method: 'POST',
          body: scimUser('ada.k@contoso.test', 'Ada Byron'),
        }),
      );
      grace = await json<ScimUser>(
        await org.scim('/Users', {
          method: 'POST',
          body: scimUser('grace@contoso.test', 'Grace Hopper'),
        }),
      );
    });

    it('creates a group and adds a member', async () => {
      const created = await org.scim('/Groups', {
        method: 'POST',
        body: {
          schemas: [GROUP_SCHEMA],
          displayName: 'Analysts',
          externalId: 'ext-analysts',
        },
      });
      expect(created.status).toBe(201);
      analysts = await json<ScimGroup>(created);
      expect(created.headers.get('location')).toBe(
        `${org.url}/scim/v2/Groups/${analysts.id}`,
      );
      expect(analysts).toMatchObject({
        schemas: [GROUP_SCHEMA],
        displayName: 'Analysts',
        members: [],
      });

      const dup = await org.scim('/Groups', {
        method: 'POST',
        body: { schemas: [GROUP_SCHEMA], displayName: 'analysts' },
      });
      expect(dup.status).toBe(409);

      const added = await org.scim(`/Groups/${analysts.id}`, {
        method: 'PATCH',
        body: patch({
          op: 'Add',
          path: 'members',
          value: [{ value: ada.id }, { value: grace.id }],
        }),
      });
      expect(added.status).toBe(200);

      const read = await json<ScimGroup>(
        await org.scim(`/Groups/${analysts.id}`),
      );
      expect(read.members?.map((m) => m.value).sort()).toEqual(
        [ada.id, grace.id].sort(),
      );
      expect(read.members?.find((m) => m.value === ada.id)?.display).toBe(
        'Ada Byron',
      );

      const list = await json<ScimList<ScimGroup>>(
        await org.scim(`/Groups?${filter('displayName eq "Analysts"')}`),
      );
      expect(list.totalResults).toBe(1);
      const lean = await json<ScimList<ScimGroup>>(
        await org.scim(
          `/Groups?${filter('externalId eq "ext-analysts"')}&excludedAttributes=members`,
        ),
      );
      expect(lean.Resources[0].members).toBeUndefined();
    });

    it('removes a member by filter path and renames the group', async () => {
      const res = await org.scim(`/Groups/${analysts.id}`, {
        method: 'PATCH',
        body: patch(
          { op: 'Remove', path: `members[value eq "${grace.id}"]` },
          { op: 'Replace', path: 'displayName', value: 'Data Analysts' },
        ),
      });
      expect(res.status).toBe(200);
      const read = await json<ScimGroup>(
        await org.scim(`/Groups/${analysts.id}`),
      );
      expect(read.displayName).toBe('Data Analysts');
      expect(read.members?.map((m) => m.value)).toEqual([ada.id]);
    });

    it('setting active to false ends the user’s auth sessions and blocks sign-in', async () => {
      adaCookie = await org.signIn('ada.k@contoso.test');
      expect((await me(adaCookie)).status).toBe(200);

      const res = await org.scim(`/Users/${ada.id}`, {
        method: 'PATCH',
        body: patch({ op: 'Replace', path: 'active', value: 'False' }),
      });
      expect(res.status).toBe(200);
      expect((await json<ScimUser>(res)).active).toBe(false);

      expect((await me(adaCookie)).status).toBe(401);
      const { location, cookie } =
        await org.signInRoundTrip('ada.k@contoso.test');
      expect(location).toBe('/?signInError=deactivated');
      expect(cookie).toBeNull();

      const reactivated = await org.scim(`/Users/${ada.id}`, {
        method: 'PATCH',
        body: patch({ op: 'replace', value: { active: true } }),
      });
      expect((await json<ScimUser>(reactivated)).active).toBe(true);
      adaCookie = await org.signIn('ada.k@contoso.test');
      expect((await me(adaCookie)).body.user.id).toBe(ada.id);

      const events = org
        .sql<{ doc: string }>('SELECT doc FROM activity_events')
        .map((r) => JSON.parse(r.doc) as { type: string; subjectId?: string });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'user.deactivated',
          subjectId: ada.id,
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'user.reactivated',
          subjectId: ada.id,
        }),
      );
      expect(events.some((e) => e.type === 'scim.request')).toBe(true);
    });

    it('records at most one scim.request event a minute', () => {
      const count = org.sql<{ n: number }>(
        `SELECT COUNT(*) AS n FROM activity_events WHERE json_extract(doc, '$.type') = 'scim.request'`,
      )[0].n;
      // Dozens of SCIM calls so far, at most one event per started minute.
      const minutes = Math.ceil((Date.now() - startedAt) / 60_000);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(minutes + 1);
    });

    describe('A group mapping grants its role to the group’s members', () => {
      let mappingGroupId = '';

      it('a member of a group mapped to Maker holds Maker and create-agents', async () => {
        mappingGroupId = analysts.id;
        org.insertDoc('group_role_mappings', {
          groupId: mappingGroupId,
          role: 'maker',
          createdBy: 'test',
        });
        const { body } = await me(adaCookie);
        expect(body.roles).toContainEqual({
          role: 'maker',
          source: 'group',
          groupId: mappingGroupId,
        });
        expect(body.permissions).toContain('create-agents');
      });

      it('a user added to the group later gets the role on their next request', async () => {
        const graceCookie = await org.signIn('grace@contoso.test');
        expect((await me(graceCookie)).body.permissions).toEqual([
          'use-agents',
        ]);
        await org.scim(`/Groups/${mappingGroupId}`, {
          method: 'PATCH',
          body: patch({
            op: 'add',
            path: 'members',
            value: [{ value: grace.id }],
          }),
        });
        expect((await me(graceCookie)).body.permissions).toContain(
          'create-agents',
        );

        await org.scim(`/Groups/${mappingGroupId}`, {
          method: 'PATCH',
          body: patch({
            op: 'remove',
            path: 'members',
            value: [{ value: grace.id }],
          }),
        });
        expect((await me(graceCookie)).body.permissions).toEqual([
          'use-agents',
        ]);
      });

      it('deleting the group removes its memberships and mappings', async () => {
        const res = await org.scim(`/Groups/${mappingGroupId}`, {
          method: 'DELETE',
        });
        expect(res.status).toBe(204);
        expect((await org.scim(`/Groups/${mappingGroupId}`)).status).toBe(404);
        const left = (table: string) =>
          org.sql<{ n: number }>(
            `SELECT COUNT(*) AS n FROM ${table} WHERE json_extract(doc, '$.groupId') = ?`,
            mappingGroupId,
          )[0].n;
        expect(left('group_members')).toBe(0);
        expect(left('group_role_mappings')).toBe(0);
        expect((await me(adaCookie)).body.permissions).toEqual(['use-agents']);
      });
    });

    it('DELETE deactivates the user, hides them from SCIM and keeps them in the directory; POST again reactivates the same id', async () => {
      const group = await json<ScimGroup>(
        await org.scim('/Groups', {
          method: 'POST',
          body: {
            schemas: [GROUP_SCHEMA],
            displayName: 'Engineers',
            members: [{ value: grace.id }],
          },
        }),
      );
      expect(group.members?.map((m) => m.value)).toEqual([grace.id]);
      const graceCookie = await org.signIn('grace@contoso.test');

      const res = await org.scim(`/Users/${grace.id}`, { method: 'DELETE' });
      expect(res.status).toBe(204);
      expect((await org.scim(`/Users/${grace.id}`)).status).toBe(404);
      const list = await json<ScimList<ScimUser>>(
        await org.scim(`/Users?${filter('userName eq "grace@contoso.test"')}`),
      );
      expect(list.totalResults).toBe(0);
      expect((await me(graceCookie)).status).toBe(401);
      const members = await json<ScimGroup>(
        await org.scim(`/Groups/${group.id}`),
      );
      expect(members.members).toEqual([]);
      const stored = org.sql<{ n: number }>(
        `SELECT COUNT(*) AS n FROM users WHERE json_extract(doc, '$.id') = ?`,
        grace.id,
      )[0].n;
      expect(stored).toBe(1);

      const again = await org.scim('/Users', {
        method: 'POST',
        body: scimUser('grace@contoso.test', 'Grace Hopper'),
      });
      expect(again.status).toBe(201);
      expect((await json<ScimUser>(again)).id).toBe(grace.id);
    });
  });
});
