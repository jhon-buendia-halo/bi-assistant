/**
 * API-level proof of the admin screens P2-P4 (specs/capabilities/admin/spec.md
 * R49-R68; api.md 2.15, endpoints 83-90; data-model 3.14.8): every admin
 * route's 403 for a non-admin, the users and groups tables, saving roles all
 * or nothing, agent transfers and their conflicts, and group mappings that
 * grant and take away roles. It drives the BUILT backend (`npm run build`
 * first) in org server mode against the in-test OIDC stub. Needs no Postgres
 * and no LLM.
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

interface UserDetail extends UserRow {
  heldRoles: HeldRole[];
  groupList: { id: string; displayName: string }[];
  agents: { id: string; name: string; status: string }[];
  isSelf: boolean;
  isBootstrap: boolean;
}

interface MappingView {
  id: string;
  groupId: string;
  role: string;
  datasourceId?: string;
  groupName: string;
  datasourceName?: string;
}

interface ActivityEvent {
  type: string;
  at: string;
  actorId?: string;
  subjectId?: string;
  details?: Record<string, unknown>;
}

const agentConfig = (name: string) => ({
  name,
  description: '',
  instructions: '',
  datasets: ['World Cup Core'],
  starterQuestions: [],
});

/** The admin routes, each with a body that would be valid for an admin. */
function adminRoutes(ids: {
  user: string;
  group: string;
}): [method: string, path: string, body?: unknown][] {
  return [
    ['POST', '/admin/role-assignments', { userId: ids.user, role: 'approver' }],
    ['DELETE', '/admin/role-assignments/r1'],
    ['GET', '/admin/users'],
    ['GET', `/admin/users/${ids.user}`],
    [
      'PUT',
      `/admin/users/${ids.user}/roles`,
      { roles: [{ role: 'approver' }] },
    ],
    [
      'POST',
      '/admin/agents/transfer',
      { agentIds: ['a1'], toUserId: ids.user },
    ],
    ['GET', '/admin/groups'],
    ['GET', '/admin/role-mappings'],
    ['POST', '/admin/role-mappings', { groupId: ids.group, role: 'maker' }],
    ['DELETE', '/admin/role-mappings/m1'],
  ];
}

describe('Admin API: users, groups, roles, transfers and mappings (BA-165, BA-166, BA-167)', () => {
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
  const detail = (id: string) => get<UserDetail>(`/admin/users/${id}`);
  const directRoles = async (id: string) =>
    (await detail(id)).heldRoles
      .filter((r) => r.source === 'direct')
      .map((r) => `${r.role}${r.datasourceId ? `:${r.datasourceId}` : ''}`)
      .sort();

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

  describe('Edit a user (BA-166)', () => {
    beforeAll(() => {
      org.insertDoc('agents', {
        id: 'agent-goal',
        draft: agentConfig('Goal analyst'),
        live: agentConfig('Goal analyst'),
        publishedAt: '2026-01-01T00:00:00.000Z',
        pinned: true,
        ownerId: ids.ada,
      });
      org.insertDoc('agents', {
        id: 'agent-card',
        draft: agentConfig('Card counter'),
        pinned: false,
        ownerId: ids.ada,
      });
      // Ada's session started from "Goal analyst" (sessions-chat R52).
      org.insertDoc('sessions', {
        id: 'session-ada-goal',
        name: 'Goal analyst',
        datasets: [],
        messages: [],
        visualizations: [],
        agentId: 'agent-goal',
        agentName: 'Goal analyst',
        ownerId: ids.ada,
      });
    });

    it("details a user's roles with their sources, groups and agents", async () => {
      const ada = await detail(ids.ada);
      expect(ada).toMatchObject({
        displayName: 'Ada Lovelace',
        email: 'ada@contoso.test',
        status: 'active',
        roles: ['maker'],
        agentsOwned: 2,
        groupList: [{ id: ids.Analysts, displayName: 'Analysts' }],
        agents: [
          { id: 'agent-card', name: 'Card counter', status: 'draft' },
          { id: 'agent-goal', name: 'Goal analyst', status: 'live' },
        ],
        isSelf: false,
        isBootstrap: false,
      });
      expect(ada.heldRoles).toEqual([
        { role: 'user', source: 'implicit' },
        {
          role: 'maker',
          source: 'direct',
          assignmentId: anyString,
        },
      ]);
      expect(await detail(ids.admin)).toMatchObject({
        isSelf: true,
        isBootstrap: true,
        heldRoles: [
          { role: 'user', source: 'implicit' },
          { role: 'platform-admin', source: 'bootstrap' },
        ],
      });
      const missing = await org.api('/admin/users/nobody', {
        cookie: adminCookie,
      });
      expect(missing.status).toBe(404);
      expect(((await missing.json()) as { message: string }).message).toBe(
        'User nobody not found',
      );
    });

    it('saving roles changes what the user can do on their next request', async () => {
      const res = await send('PUT', `/admin/users/${ids.ada}/roles`, {
        roles: [{ role: 'approver' }],
      });
      const body = await json<{
        ok: boolean;
        message: string;
        added: number;
        removed: number;
        heldRoles: HeldRole[];
      }>(res);
      expect(body).toMatchObject({
        ok: true,
        message: 'Roles saved for Ada Lovelace',
        added: 1,
        removed: 1,
      });
      expect(body.heldRoles.map((r) => r.role)).toEqual(['user', 'approver']);
      const { permissions } = await me(adaCookie);
      expect(permissions).toContain('approve-publishing');
      expect(permissions).not.toContain('create-agents');
      expect(
        events('role.removed').filter((e) => e.subjectId === ids.ada),
      ).toContainEqual(
        expect.objectContaining({
          actorId: ids.admin,
          details: { role: 'maker' },
        }),
      );
      const row = (await users('?q=ada')).items[0];
      expect(row.roles).toEqual(['approver']);

      const same = await json<{ message: string; added: number }>(
        await send('PUT', `/admin/users/${ids.ada}/roles`, {
          roles: [{ role: 'approver' }],
        }),
      );
      expect(same).toMatchObject({ message: 'No changes', added: 0 });
    });

    it('saves all or nothing: a set with one bad entry changes nothing', async () => {
      const eventsBefore = org.docs('activity_events').length;
      for (const [roles, status, message] of [
        [
          [{ role: 'maker' }, { role: 'data-owner' }],
          400,
          'Data owner needs a datasource',
        ],
        [
          [{ role: 'maker' }, { role: 'data-owner', datasourceId: 'ds-gone' }],
          404,
          'Datasource ds-gone not found',
        ],
        [[{ role: 'wizard' }], 400, 'Unknown role: wizard'],
      ] as [unknown[], number, string][]) {
        const res = await send('PUT', `/admin/users/${ids.ada}/roles`, {
          roles,
        });
        expect(res.status).toBe(status);
        expect(((await res.json()) as { message: string }).message).toBe(
          message,
        );
      }
      expect(await directRoles(ids.ada)).toEqual(['approver']);
      // No role event was written either.
      expect(
        org
          .docs<ActivityEvent>('activity_events')
          .slice(eventsBefore)
          .filter((e) => e.type.startsWith('role.')),
      ).toEqual([]);
    });

    it('names the datasource of a Data owner role', async () => {
      await json(
        await send('PUT', `/admin/users/${ids.ada}/roles`, {
          roles: [
            { role: 'approver' },
            { role: 'data-owner', datasourceId: 'ds-wc' },
          ],
        }),
      );
      expect((await detail(ids.ada)).heldRoles).toContainEqual(
        expect.objectContaining({
          role: 'data-owner',
          source: 'direct',
          datasourceId: 'ds-wc',
          datasourceName: 'World Cup',
        }),
      );
      expect((await users()).counts.dataOwners).toBe(1);
    });

    it("refuses removing the caller's own Platform admin role", async () => {
      await send('POST', '/admin/role-assignments', {
        userId: ids.grace,
        role: 'platform-admin',
      });
      const graceCookie = await org.signIn(GRACE);
      const own = await send(
        'PUT',
        `/admin/users/${ids.grace}/roles`,
        { roles: [{ role: 'approver' }] },
        graceCookie,
      );
      expect(own.status).toBe(400);
      expect(((await own.json()) as { message: string }).message).toBe(
        "You can't remove your own Platform admin role",
      );
      expect(await directRoles(ids.grace)).toEqual(['platform-admin']);
      expect((await detail(ids.grace)).isSelf).toBe(false);
      // Another admin can.
      await json(
        await send('PUT', `/admin/users/${ids.grace}/roles`, { roles: [] }),
      );
      expect(await directRoles(ids.grace)).toEqual([]);
    });

    it('transfers an agent to its new owner, unpinned; for the former owner its sessions act as deleted', async () => {
      const graceCookie = await org.signIn(GRACE);
      const res = await send('POST', '/admin/agents/transfer', {
        agentIds: ['agent-goal'],
        toUserId: ids.grace,
      });
      expect(await json(res)).toEqual({
        ok: true,
        message: 'Transferred 1 agent to Grace Hopper',
        transferred: 1,
      });
      type Catalogue = {
        agents: {
          id: string;
          owner: string;
          pinned: boolean;
          status: string;
        }[];
      };
      const graces = await get<Catalogue>('/agents', graceCookie);
      expect(graces.agents.find((a) => a.id === 'agent-goal')).toMatchObject({
        owner: 'You',
        pinned: false,
        status: 'live',
      });
      const adas = await get<Catalogue>('/agents', adaCookie);
      expect(adas.agents.map((a) => a.id)).not.toContain('agent-goal');
      const session = await get<{ agent?: { deleted: boolean; name: string } }>(
        '/sessions/session-ada-goal',
        adaCookie,
      );
      expect(session.agent).toMatchObject({
        deleted: true,
        name: 'Goal analyst',
      });
      expect((await detail(ids.ada)).agents.map((a) => a.name)).toEqual([
        'Card counter',
      ]);
      expect(events('agent.transferred')).toEqual([
        expect.objectContaining({
          actorId: ids.admin,
          subjectId: 'agent-goal',
          details: {
            agentName: 'Goal analyst',
            fromUserId: ids.ada,
            toUserId: ids.grace,
          },
        }),
      ]);
    });

    it('refuses a transfer that would duplicate a name, or reach a missing agent, and moves nothing', async () => {
      org.insertDoc('agents', {
        id: 'agent-grace-card',
        draft: agentConfig('card counter'),
        pinned: false,
        ownerId: ids.grace,
      });
      org.insertDoc('agents', {
        id: 'agent-local',
        draft: agentConfig('Local agent'),
        pinned: false,
      });
      const lin = await provision('lin@contoso.test', 'Lin Leaver');
      expect((await scimPatchActive(lin, false)).status).toBe(200);
      for (const [body, status, message] of [
        [
          { agentIds: ['agent-card'], toUserId: ids.grace },
          409,
          'Grace Hopper already has an agent named "Card counter"',
        ],
        [
          { agentIds: ['agent-card', 'agent-missing'], toUserId: ids.alan },
          404,
          'Agent agent-missing not found',
        ],
        [
          { agentIds: ['agent-local'], toUserId: ids.alan },
          404,
          'Agent agent-local not found',
        ],
        [
          { agentIds: ['agent-card'], toUserId: lin },
          400,
          'Lin Leaver is deactivated',
        ],
        [
          { agentIds: ['agent-card'], toUserId: ids.ada },
          400,
          '"Card counter" already belongs to Ada Lovelace',
        ],
        [
          { agentIds: [], toUserId: ids.alan },
          400,
          'Choose at least one agent',
        ],
      ] as [unknown, number, string][]) {
        const res = await send('POST', '/admin/agents/transfer', body);
        expect({ body, status: res.status }).toEqual({ body, status });
        expect(((await res.json()) as { message: string }).message).toBe(
          message,
        );
      }
      expect((await detail(ids.ada)).agents.map((a) => a.id)).toEqual([
        'agent-card',
      ]);
      expect(events('agent.transferred')).toHaveLength(1);
    });
  });

  describe('Roles and permissions (BA-167)', () => {
    it('a group mapping grants its role to the members on their next request, and removing it takes it away', async () => {
      expect(
        (await get<{ mappings: unknown[] }>('/admin/role-mappings')).mappings,
      ).toEqual([]);
      expect((await me(adaCookie)).permissions).not.toContain('create-agents');

      const added = await send('POST', '/admin/role-mappings', {
        groupId: ids.Analysts,
        role: 'maker',
      });
      expect(added.status).toBe(201);
      const { mapping, message } = (await added.json()) as {
        mapping: MappingView;
        message: string;
      };
      expect(message).toBe('Mapping added');
      expect(mapping).toMatchObject({
        groupId: ids.Analysts,
        role: 'maker',
        groupName: 'Analysts',
        createdBy: ids.admin,
      });
      const ada = await me(adaCookie);
      expect(ada.permissions).toContain('create-agents');
      expect(ada.roles).toContainEqual({
        role: 'maker',
        source: 'group',
        groupId: ids.Analysts,
      });
      expect((await detail(ids.ada)).heldRoles).toContainEqual({
        role: 'maker',
        source: 'group',
        groupId: ids.Analysts,
        groupNames: ['Analysts'],
      });

      const again = await send('POST', '/admin/role-mappings', {
        groupId: ids.Analysts,
        role: 'maker',
      });
      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({
        ok: true,
        message: 'Mapping already exists',
        mapping: { id: mapping.id },
      });

      const removed = await send(
        'DELETE',
        `/admin/role-mappings/${mapping.id}`,
      );
      expect(await json(removed)).toEqual({
        ok: true,
        message: 'Mapping removed',
      });
      expect((await me(adaCookie)).permissions).not.toContain('create-agents');
      const gone = await send('DELETE', `/admin/role-mappings/${mapping.id}`);
      expect(gone.status).toBe(404);
      expect(((await gone.json()) as { message: string }).message).toBe(
        `Group mapping ${mapping.id} not found`,
      );
      expect(events('mapping.added')).toContainEqual(
        expect.objectContaining({
          actorId: ids.admin,
          subjectId: ids.Analysts,
          details: { role: 'maker', mappingId: mapping.id },
        }),
      );
      expect(events('mapping.removed')).toContainEqual(
        expect.objectContaining({
          actorId: ids.admin,
          subjectId: ids.Analysts,
          details: { role: 'maker', mappingId: mapping.id },
        }),
      );
    });

    it('a Data owner mapping names its datasource; a group deleted through SCIM takes its mappings', async () => {
      const noDatasource = await send('POST', '/admin/role-mappings', {
        groupId: ids.Engineers,
        role: 'data-owner',
      });
      expect(noDatasource.status).toBe(400);
      expect(((await noDatasource.json()) as { message: string }).message).toBe(
        'Data owner needs a datasource',
      );
      const added = await send('POST', '/admin/role-mappings', {
        groupId: ids.Engineers,
        role: 'data-owner',
        datasourceId: 'ds-wc',
      });
      expect(added.status).toBe(201);
      const { mappings } = await get<{ mappings: MappingView[] }>(
        '/admin/role-mappings',
      );
      expect(mappings).toEqual([
        expect.objectContaining({
          groupName: 'Engineers',
          role: 'data-owner',
          datasourceId: 'ds-wc',
          datasourceName: 'World Cup',
        }),
      ]);

      expect(
        (await org.scim(`/Groups/${ids.Engineers}`, { method: 'DELETE' }))
          .status,
      ).toBe(204);
      expect(
        (await get<{ mappings: unknown[] }>('/admin/role-mappings')).mappings,
      ).toEqual([]);
      expect((await get<{ total: number }>('/admin/groups')).total).toBe(1);
      const unknown = await send('POST', '/admin/role-mappings', {
        groupId: ids.Engineers,
        role: 'maker',
      });
      expect(unknown.status).toBe(404);
      expect(((await unknown.json()) as { message: string }).message).toBe(
        `Group ${ids.Engineers} not found`,
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
