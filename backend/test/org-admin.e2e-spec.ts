/**
 * API-level proof of the Users & groups screen (specs/capabilities/admin/spec.md
 * R49-R57; api.md 2.15, endpoints 83 and 87; data-model 3.14.8): every admin
 * route's 403 for a non-admin and the users and groups tables. It drives the
 * BUILT backend (`npm run build` first) in org server mode against the
 * in-test OIDC stub. Needs no Postgres and no LLM.
 */
import { type OrgServer, scimUser, startOrgServer } from './org-server';

jest.setTimeout(240_000);

const DAY = 86_400_000;
const daysAgo = (days: number) =>
  new Date(Date.now() - days * DAY).toISOString();
const today = () => new Date().toISOString().slice(0, 10);
/** Asymmetric matchers, typed as the strings they stand for. */
const anyString = expect.any(String) as unknown as string;
const startingWith = (prefix: string) =>
  expect.stringMatching(new RegExp(`^${prefix}`)) as unknown as string;

const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

const ADMIN = { email: 'admin@contoso.test', name: 'Avery Admin' };
const ADA = { email: 'ada@contoso.test', name: 'Ada Lovelace' };
const GRACE = { email: 'grace@contoso.test', name: 'Grace Hopper' };

interface UserRow {
  id: string;
  displayName: string;
  email: string | null;
  initials: string;
  roles: string[];
  groups: string[];
  agentsOwned: number;
  lastActiveAt: string | null;
  status: string;
}

interface UsersPage {
  items: UserRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  lastSyncAt: string | null;
}

interface HeldRole {
  role: string;
  source: string;
  assignmentId?: string;
  datasourceId?: string;
  datasourceName?: string;
  groupId?: string;
  groupNames?: string[];
}

interface ActivityEvent {
  type: string;
  at: string;
  actorId?: string;
  subjectId?: string;
  details?: Record<string, unknown>;
}

/** The admin routes, each with a body that would be valid for an admin. */
function adminRoutes(ids: {
  user: string;
  group: string;
}): [method: string, path: string, body?: unknown][] {
  return [
    ['POST', '/admin/role-assignments', { userId: ids.user, role: 'approver' }],
    ['DELETE', '/admin/role-assignments/r1'],
    ['GET', '/admin/users'],
    ['GET', '/admin/groups'],
  ];
}

describe('Admin API: users and groups (BA-165)', () => {
  let org: OrgServer;
  let adminCookie = '';
  let adaCookie = '';
  const ids: Record<string, string> = {};

  const json = async <T>(res: Response, status = 200): Promise<T> => {
    const body = (await res.json()) as T;
    expect({ status: res.status, body }).toMatchObject({ status });
    return body;
  };
  const get = async <T>(path: string, cookie = adminCookie) =>
    json<T>(await org.api(path, { cookie }));
  const send = (
    method: string,
    path: string,
    body?: unknown,
    cookie = adminCookie,
  ) => org.api(path, { method, cookie, body });
  const me = async (cookie: string) =>
    get<{ user: { id: string }; roles: HeldRole[]; permissions: string[] }>(
      '/me',
      cookie,
    );
  const provision = async (email: string, name: string) => {
    const res = await org.scim('/Users', {
      method: 'POST',
      body: scimUser(email, name),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const scimPatchActive = (id: string, active: boolean) =>
    org.scim(`/Users/${id}`, {
      method: 'PATCH',
      body: {
        schemas: [PATCH_SCHEMA],
        Operations: [{ op: 'replace', path: 'active', value: active }],
      },
    });
  const events = (type: string) =>
    org.docs<ActivityEvent>('activity_events').filter((e) => e.type === type);
  const users = (query = '') => get<UsersPage>(`/admin/users${query}`);
  beforeAll(async () => {
    org = await startOrgServer({ bootstrapAdmins: [ADMIN.email] });
    adminCookie = await org.signIn(ADMIN);
    ids.admin = (await me(adminCookie)).user.id;
    ids.ada = await provision(ADA.email, ADA.name);
    ids.grace = await provision(GRACE.email, GRACE.name);
    ids.alan = await provision('alan@contoso.test', 'Alan Turing');
    for (const [name, member] of [
      ['Analysts', ids.ada],
      ['Engineers', ids.alan],
    ]) {
      const res = await org.scim('/Groups', {
        method: 'POST',
        body: {
          schemas: [GROUP_SCHEMA],
          displayName: name,
          members: [{ value: member }],
        },
      });
      expect(res.status).toBe(201);
      ids[name] = ((await res.json()) as { id: string }).id;
    }
    adaCookie = await org.signIn(ADA);
    expect(
      (
        await send('POST', '/admin/role-assignments', {
          userId: ids.ada,
          role: 'maker',
        })
      ).status,
    ).toBe(201);
    // Alan last used the app 95 days ago (admin R39) and makes no request here.
    org.patchDoc(
      'users',
      { id: ids.alan },
      { lastSignInAt: daysAgo(95), lastActiveAt: daysAgo(95) },
    );
    org.insertDoc('connections', {
      id: 'ds-wc',
      name: 'World Cup',
      kind: 'postgres',
      config: {
        host: '127.0.0.1',
        port: 1,
        database: 'none',
        user: 'none',
        password: 'none',
      },
    });
  });

  afterAll(async () => {
    await org?.close();
  });

  it('refuses every admin route to a user without manage-users, and changes nothing', async () => {
    for (const [method, path, body] of adminRoutes({
      user: ids.grace,
      group: ids.Analysts,
    })) {
      const res = await send(method, path, body, adaCookie);
      expect({ method, path, status: res.status }).toEqual({
        method,
        path,
        status: 403,
      });
      expect(await res.json()).toEqual({
        statusCode: 403,
        message: 'Missing permission: manage-users',
        error: 'Forbidden',
      });
    }
    expect(
      org
        .docs<{ userId: string }>('role_assignments')
        .filter((a) => a.userId === ids.grace),
    ).toEqual([]);
    expect(org.docs('group_role_mappings')).toEqual([]);
  });

  describe('Users and groups (BA-165)', () => {
    it("lists each person's roles, groups, agents, last activity and status", async () => {
      const page = await users();
      expect(page.items.map((r) => r.displayName)).toEqual([
        'Ada Lovelace',
        'Alan Turing',
        'Avery Admin',
        'Grace Hopper',
      ]);
      const row = (name: string) =>
        page.items.find((r) => r.displayName === name)!;
      expect(row('Ada Lovelace')).toEqual({
        id: ids.ada,
        displayName: 'Ada Lovelace',
        email: 'ada@contoso.test',
        initials: 'AL',
        roles: ['maker'],
        groups: ['Analysts'],
        agentsOwned: 0,
        lastActiveAt: startingWith(today()),
        status: 'active',
      });
      expect(row('Alan Turing')).toMatchObject({
        roles: [],
        groups: ['Engineers'],
        lastActiveAt: anyString,
        status: 'inactive',
      });
      expect(row('Alan Turing').lastActiveAt?.slice(0, 10)).toBe(
        daysAgo(95).slice(0, 10),
      );
      expect(row('Grace Hopper')).toMatchObject({
        lastActiveAt: null,
        status: 'not-signed-in',
      });
      expect(row('Avery Admin')).toMatchObject({ roles: ['platform-admin'] });
      expect(page).toMatchObject({
        total: 4,
        page: 1,
        pageSize: 25,
        counts: {
          users: 4,
          groups: 2,
          platformAdmins: 1,
          approvers: 0,
          dataOwners: 0,
          makers: 1,
          inactive: 1,
        },
      });
      // Last sync is the newest SCIM request (admin R54).
      const scim = events('scim.request')
        .map((e) => e.at)
        .sort();
      expect(page.lastSyncAt).toBe(scim[scim.length - 1]);
    });

    it('searches by name, email or group, and filters by role or inactivity', async () => {
      const names = async (query: string) =>
        (await users(query)).items.map((r) => r.displayName);
      expect(await names('?q=analysts')).toEqual(['Ada Lovelace']);
      expect(await names('?q=%20TURING%20')).toEqual(['Alan Turing']);
      expect(await names('?q=grace%40contoso')).toEqual(['Grace Hopper']);
      expect(await users('?q=nobody')).toMatchObject({ items: [], total: 0 });
      expect(await names('?filter=maker')).toEqual(['Ada Lovelace']);
      expect(await names('?filter=inactive')).toEqual(['Alan Turing']);
      expect(await names('?filter=platform-admin')).toEqual(['Avery Admin']);
      expect(await names('?filter=approver')).toEqual([]);
      for (const [query, message] of [
        ['?filter=wizards', 'Unknown filter: wizards'],
        ['?page=0', 'page must be a positive integer'],
        ['?pageSize=500', 'pageSize must be between 1 and 100'],
      ]) {
        const res = await org.api(`/admin/users${query}`, {
          cookie: adminCookie,
        });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { message: string }).message).toBe(
          message,
        );
      }
    });

    it('lists the groups with their members and mapped roles', async () => {
      org.insertDoc('group_role_mappings', {
        id: 'mapping-seeded',
        groupId: ids.Analysts,
        role: 'maker',
        createdBy: ids.admin,
      });
      const page = await get<{
        items: { displayName: string; members: number; mappings: unknown[] }[];
        total: number;
      }>('/admin/groups');
      expect(page).toMatchObject({
        total: 2,
        items: [
          {
            displayName: 'Analysts',
            members: 1,
            mappings: [{ role: 'maker' }],
          },
          { displayName: 'Engineers', members: 1, mappings: [] },
        ],
      });
      expect(
        (await get<{ items: unknown[] }>('/admin/groups?q=ENG')).items,
      ).toHaveLength(1);
      org.sql(
        `DELETE FROM group_role_mappings WHERE json_extract(doc, '$.id') = ?`,
        'mapping-seeded',
      );
    });
  });

  describe('Users and groups, after the directory changes (BA-165)', () => {
    it('shows a user deactivated through SCIM as Deactivated, and leaves them out of the pickers', async () => {
      expect((await scimPatchActive(ids.alan, false)).status).toBe(200);
      const alan = (await users('?q=turing')).items[0];
      expect(alan.status).toBe('deactivated');
      expect((await users('?q=turing&excludeDeactivated=true')).items).toEqual(
        [],
      );
    });

    it('pages the users table 25 rows at a time', async () => {
      for (let i = 0; i < 30; i++) {
        await provision(`extra${i}@contoso.test`, `Extra Person ${i}`);
      }
      const first = await users();
      const total = first.total;
      expect(total).toBe(first.counts.users);
      expect(first.items).toHaveLength(25);
      const second = await users('?page=2');
      expect(second.items).toHaveLength(total - 25);
      expect(second.items[0].displayName).not.toBe(first.items[0].displayName);
      expect(await users('?page=9')).toMatchObject({ items: [], total });
    });
  });
});
