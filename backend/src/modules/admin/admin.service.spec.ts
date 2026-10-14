import BetterSqlite3 from 'better-sqlite3';
import type { OrgServerConfig } from '../../config/org-server.config';
import type { DocFilter } from '../../infrastructure/database/doc-store';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { SqliteTransactions } from '../../infrastructure/database/sqlite-transactions';
import { ActivityService } from '../auth/activity.service';
import type {
  ActivityEventDoc,
  ActivityEventType,
  GroupDoc,
  GroupMemberDoc,
  GroupRoleMappingDoc,
  RoleAssignmentDoc,
  UserDoc,
} from '../auth/entities/directory.entity';
import { DirectoryRepository } from '../auth/repositories/directory.repository';
import { RolesRepository } from '../auth/repositories/roles.repository';
import { RoleResolver } from '../auth/role-resolver';
import type { UserAgentDoc } from '../user-agents/entities/user-agent.entity';
import { AdminDirectoryReader } from './admin-directory.reader';
import { AdminOverviewService } from './admin-overview.service';
import { AdminReadService } from './admin-read.service';
import { AdminService } from './admin.service';
import { AllOwnersAgentsRepository } from './repositories/all-owners-agents.repository';
import { AllOwnersSkillsRepository } from './repositories/all-owners-skills.repository';
import type { SkillDoc } from '../skills/entities/skill.entity';

/**
 * The admin API's services (admin R37-R68; api.md 2.15; data-model 3.14.8)
 * over the real repositories and in-memory SQLite, so "all or nothing" is
 * proven against a real transaction.
 */

const DAY = 86_400_000;
const NOW = new Date();
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * DAY).toISOString();

/** A store whose writes can be made to fail after a number of calls. */
class FlakyStore<T extends object> extends SqliteDocStore<T> {
  private inserts = 0;
  private updates = 0;
  private insertLimit = Number.POSITIVE_INFINITY;
  private updateLimit = Number.POSITIVE_INFINITY;

  /** From now on, let `n` inserts through and fail the ones after. */
  failInsertsAfter(n: number): void {
    this.insertLimit = this.inserts + n;
  }

  failUpdatesAfter(n: number): void {
    this.updateLimit = this.updates + n;
  }

  insert(doc: T): Promise<T> {
    if (this.inserts++ >= this.insertLimit) {
      return Promise.reject(new Error('disk I/O error'));
    }
    return super.insert(doc);
  }

  update(filter: DocFilter, patch: Partial<T>): Promise<T | null> {
    if (this.updates++ >= this.updateLimit) {
      return Promise.reject(new Error('disk I/O error'));
    }
    return super.update(filter, patch);
  }
}

function setup() {
  const db = new BetterSqlite3(':memory:');
  const users = new SqliteDocStore<UserDoc>(db, 'users');
  const groups = new SqliteDocStore<GroupDoc>(db, 'groups');
  const members = new SqliteDocStore<GroupMemberDoc>(db, 'group_members');
  const assignments = new FlakyStore<RoleAssignmentDoc>(db, 'role_assignments');
  const mappings = new SqliteDocStore<GroupRoleMappingDoc>(
    db,
    'group_role_mappings',
  );
  const events = new SqliteDocStore<ActivityEventDoc>(db, 'activity_events');
  const agents = new FlakyStore<UserAgentDoc>(db, 'agents');
  const connections = new SqliteDocStore<{ id: string; name: string }>(
    db,
    'connections',
  );
  const directory = new DirectoryRepository(users, groups, members);
  const roles = new RolesRepository(assignments, mappings);
  const activity = new ActivityService(events, directory);
  const resolver = new RoleResolver(directory, roles, connections, {
    bootstrapAdmins: ['admin@contoso.test'],
  } as OrgServerConfig);
  const skills = new SqliteDocStore<SkillDoc>(db, 'skills');
  const allAgents = new AllOwnersAgentsRepository(agents);
  const reader = new AdminDirectoryReader(
    directory,
    roles,
    allAgents,
    connections,
    resolver,
  );
  const admin = new AdminService(
    directory,
    roles,
    activity,
    connections,
    allAgents,
    new AllOwnersSkillsRepository(skills),
    new SqliteTransactions(db),
    reader,
  );
  const config = (name: string) => ({
    name,
    description: '',
    instructions: '',
    datasets: ['World Cup Core'],
    starterQuestions: [],
  });

  const t = {
    db,
    admin,
    read: new AdminReadService(reader, activity),
    overview: new AdminOverviewService(reader, activity),
    assignments,
    agents,
    skills,
    async user(
      id: string,
      displayName: string,
      fields: Partial<UserDoc> = {},
    ): Promise<UserDoc> {
      return users.insert({
        id,
        userName: `${id}@contoso.test`,
        email: `${id}@contoso.test`,
        displayName,
        active: true,
        source: 'scim',
        lastSignInAt: daysAgo(1),
        lastActiveAt: daysAgo(0),
        ...fields,
      });
    },
    async group(id: string, displayName: string, memberIds: string[] = []) {
      await groups.insert({ id, displayName });
      for (const userId of memberIds) await directory.addMember(id, userId);
    },
    assign(
      userId: string,
      role: RoleAssignmentDoc['role'],
      datasourceId?: string,
    ) {
      return roles.insertAssignment({
        userId,
        role,
        ...(datasourceId ? { datasourceId } : {}),
        assignedBy: 'admin',
      });
    },
    map(
      groupId: string,
      role: GroupRoleMappingDoc['role'],
      datasourceId?: string,
    ) {
      return mappings.insert({
        id: `m-${groupId}-${role}-${datasourceId ?? ''}`,
        groupId,
        role,
        ...(datasourceId ? { datasourceId } : {}),
        createdBy: 'admin',
      });
    },
    agent(
      id: string,
      name: string,
      fields: { ownerId?: string; live?: boolean; pinned?: boolean } = {},
    ) {
      return agents.insert({
        id,
        draft: config(name),
        ...(fields.live
          ? { live: config(name), publishedAt: '2026-01-01T00:00:00.000Z' }
          : {}),
        pinned: fields.pinned ?? false,
        ...(fields.ownerId ? { ownerId: fields.ownerId } : {}),
      });
    },
    datasource(id: string, name: string) {
      return connections.insert({ id, name });
    },
    event(
      type: ActivityEventType,
      at: string,
      fields: Partial<ActivityEventDoc> = {},
    ) {
      return events.insert({
        id: `${type}-${at}-${Math.random()}`,
        type,
        at,
        ...fields,
      });
    },
    async eventsOf(type: ActivityEventType) {
      return (await events.find({ type })).map((e) => ({
        actorId: e.actorId,
        subjectId: e.subjectId,
        details: e.details,
      }));
    },
    async directRoles(userId: string) {
      return (await roles.assignmentsOf(userId))
        .map((a) => `${a.role}${a.datasourceId ? `:${a.datasourceId}` : ''}`)
        .sort();
    },
    async ownerOf(agentId: string) {
      return (await agents.findOne({ id: agentId }))?.ownerId;
    },
  };
  return t;
}

type Testbed = ReturnType<typeof setup>;

/** Avery (bootstrap admin), Ada (Maker, Analysts) and Grace. */
async function directoryWithPeople(t: Testbed) {
  await t.user('admin', 'Avery Admin');
  await t.user('ada', 'Ada Lovelace');
  await t.user('grace', 'Grace Hopper');
  await t.group('g-analysts', 'Analysts', ['ada']);
  await t.datasource('ds-1', 'World Cup');
  await t.assign('ada', 'maker');
}

describe('AdminService.saveUserRoles (api.md 85; admin R60-R62)', () => {
  it('replaces the direct assignments and records one event per change', async () => {
    const t = setup();
    await directoryWithPeople(t);
    const result = await t.admin.saveUserRoles(
      'ada',
      {
        roles: [
          { role: 'approver' },
          { role: 'data-owner', datasourceId: 'ds-1' },
        ],
      },
      'admin',
    );
    expect(result).toMatchObject({
      message: 'Roles saved for Ada Lovelace',
      added: 2,
      removed: 1,
    });
    expect(await t.directRoles('ada')).toEqual(['approver', 'data-owner:ds-1']);
    expect(result.heldRoles).toEqual([
      { role: 'user', source: 'implicit' },
      expect.objectContaining({ role: 'approver', source: 'direct' }),
      expect.objectContaining({
        role: 'data-owner',
        source: 'direct',
        datasourceId: 'ds-1',
        datasourceName: 'World Cup',
      }),
    ]);
    expect(await t.eventsOf('role.removed')).toEqual([
      { actorId: 'admin', subjectId: 'ada', details: { role: 'maker' } },
    ]);
    expect(await t.eventsOf('role.assigned')).toEqual(
      expect.arrayContaining([
        { actorId: 'admin', subjectId: 'ada', details: { role: 'approver' } },
        {
          actorId: 'admin',
          subjectId: 'ada',
          details: { role: 'data-owner', datasourceId: 'ds-1' },
        },
      ]),
    );
  });

  it('answers "No changes" and writes nothing when the set is what is stored; duplicates collapse', async () => {
    const t = setup();
    await directoryWithPeople(t);
    const result = await t.admin.saveUserRoles(
      'ada',
      { roles: [{ role: 'maker' }, { role: 'maker' }] },
      'admin',
    );
    expect(result).toMatchObject({
      message: 'No changes',
      added: 0,
      removed: 0,
    });
    expect(await t.eventsOf('role.assigned')).toEqual([]);
    expect(await t.eventsOf('role.removed')).toEqual([]);
  });

  it.each([
    [{ roles: 'maker' }, 400, 'roles must be a list'],
    [
      { roles: [{ role: 'approver' }, { role: 'wizard' }] },
      400,
      'Unknown role: wizard',
    ],
    [{ roles: [{ role: 'user' }] }, 400, 'The User role is implicit'],
    [
      { roles: [{ role: 'approver' }, { role: 'data-owner' }] },
      400,
      'Data owner needs a datasource',
    ],
    [
      { roles: [{ role: 'maker', datasourceId: 'ds-1' }] },
      400,
      'Only Data owner takes a datasource',
    ],
    [
      {
        roles: [
          { role: 'approver' },
          { role: 'data-owner', datasourceId: 'ds-gone' },
        ],
      },
      404,
      'Datasource ds-gone not found',
    ],
  ])(
    'refuses %j with %i before writing anything',
    async (dto, status, message) => {
      const t = setup();
      await directoryWithPeople(t);
      await expect(
        t.admin.saveUserRoles('ada', dto as never, 'admin'),
      ).rejects.toMatchObject({
        status,
        message,
      });
      expect(await t.directRoles('ada')).toEqual(['maker']);
      expect(await t.eventsOf('role.assigned')).toEqual([]);
    },
  );

  it('keeps a stored Data owner assignment whose datasource is gone', async () => {
    const t = setup();
    await directoryWithPeople(t);
    await t.assign('ada', 'data-owner', 'ds-gone');
    const result = await t.admin.saveUserRoles(
      'ada',
      { roles: [{ role: 'data-owner', datasourceId: 'ds-gone' }] },
      'admin',
    );
    expect(result).toMatchObject({ added: 0, removed: 1 });
    expect(await t.directRoles('ada')).toEqual(['data-owner:ds-gone']);
  });

  it('refuses an unknown user with 404', async () => {
    const t = setup();
    await directoryWithPeople(t);
    await expect(
      t.admin.saveUserRoles('nobody', { roles: [] }, 'admin'),
    ).rejects.toMatchObject({ status: 404, message: 'User nobody not found' });
  });

  it("refuses dropping the caller's own direct Platform admin role (admin R61)", async () => {
    const t = setup();
    await directoryWithPeople(t);
    await t.assign('grace', 'platform-admin');
    await expect(
      t.admin.saveUserRoles(
        'grace',
        { roles: [{ role: 'approver' }] },
        'grace',
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "You can't remove your own Platform admin role",
    });
    expect(await t.directRoles('grace')).toEqual(['platform-admin']);
    // Keeping it while changing the rest is fine; another admin may drop it.
    await t.admin.saveUserRoles(
      'grace',
      { roles: [{ role: 'platform-admin' }, { role: 'approver' }] },
      'grace',
    );
    await t.admin.saveUserRoles('grace', { roles: [] }, 'admin');
    expect(await t.directRoles('grace')).toEqual([]);
  });

  it('is all or nothing: a write that fails rolls back the ones before it', async () => {
    const t = setup();
    await directoryWithPeople(t);
    t.assignments.failInsertsAfter(1);
    await expect(
      t.admin.saveUserRoles(
        'ada',
        { roles: [{ role: 'approver' }, { role: 'platform-admin' }] },
        'admin',
      ),
    ).rejects.toThrow('disk I/O error');
    expect(await t.directRoles('ada')).toEqual(['maker']);
    expect(await t.eventsOf('role.removed')).toEqual([]);
    expect(await t.eventsOf('role.assigned')).toEqual([]);
  });
});

describe('AdminService.transferAgents (api.md 86; admin R43, R64)', () => {
  async function withAgents(t: Testbed) {
    await directoryWithPeople(t);
    await t.agent('a-goal', 'Goal analyst', {
      ownerId: 'ada',
      live: true,
      pinned: true,
    });
    await t.agent('a-card', 'Card counter', { ownerId: 'ada' });
  }

  it('moves each agent with its draft, Live version and publish time, unpinned, and records one event each', async () => {
    const t = setup();
    await withAgents(t);
    const result = await t.admin.transferAgents(
      { agentIds: ['a-goal', 'a-card', 'a-goal'], toUserId: 'grace' },
      'admin',
    );
    expect(result).toEqual({
      message: 'Transferred 2 agents to Grace Hopper',
      transferred: 2,
    });
    const goal = await t.agents.findOne({ id: 'a-goal' });
    expect(goal).toMatchObject({
      ownerId: 'grace',
      pinned: false,
      live: { name: 'Goal analyst' },
      draft: { name: 'Goal analyst' },
      publishedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await t.eventsOf('agent.transferred')).toEqual(
      expect.arrayContaining([
        {
          actorId: 'admin',
          subjectId: 'a-goal',
          details: {
            agentName: 'Goal analyst',
            fromUserId: 'ada',
            toUserId: 'grace',
          },
        },
        {
          actorId: 'admin',
          subjectId: 'a-card',
          details: {
            agentName: 'Card counter',
            fromUserId: 'ada',
            toUserId: 'grace',
          },
        },
      ]),
    );
    const one = await t.admin.transferAgents(
      { agentIds: ['a-goal'], toUserId: 'ada' },
      'admin',
    );
    expect(one.message).toBe('Transferred 1 agent to Ada Lovelace');
  });

  it('copies the skills a draft names to the new owner, renames clashes and remaps the ids', async () => {
    const t = setup();
    await withAgents(t);
    const cfg = (name: string) => ({
      name,
      description: '',
      instructions: '',
      datasets: ['World Cup Core'],
      starterQuestions: [],
    });
    const skill = (id: string, name: string, ownerId: string) =>
      t.skills.insert({
        id,
        name,
        description: 'Use when needed.',
        body: `Body of ${name}.`,
        files: [{ path: 'references/a.md', content: 'A' }],
        ownerId,
      });
    await skill('s-cal', 'fiscal-calendar', 'ada');
    await skill('s-tax', 'tax-rules', 'ada');
    await skill('g-cal', 'fiscal-calendar', 'grace');
    await t.agents.update(
      { id: 'a-goal' },
      {
        draft: {
          ...cfg('Goal analyst'),
          instructions:
            'Use [[skill:fiscal-calendar]] and [[skill:tax-rules]].',
          skills: ['s-cal', 's-tax'],
        },
        live: {
          ...cfg('Goal analyst'),
          instructions: 'Live: [[skill:fiscal-calendar]].',
          skills: ['s-cal'],
        },
        liveSkills: [
          {
            id: 's-cal',
            name: 'fiscal-calendar',
            description: 'Use when needed.',
            body: 'Old body.',
            files: [],
          },
        ],
      },
    );
    await t.agents.update(
      { id: 'a-card' },
      { draft: { ...cfg('Card counter'), skills: ['s-cal'] } },
    );

    await t.admin.transferAgents(
      { agentIds: ['a-goal', 'a-card'], toUserId: 'grace' },
      'admin',
    );

    const graces = await t.skills.find({ ownerId: 'grace' });
    expect(graces.map((s) => s.name).sort()).toEqual([
      'fiscal-calendar',
      'fiscal-calendar-2',
      'tax-rules',
    ]);
    const copyOf = (name: string) => graces.find((s) => s.name === name)!;
    expect(copyOf('fiscal-calendar-2')).toMatchObject({
      body: 'Body of fiscal-calendar.',
      files: [{ path: 'references/a.md', content: 'A' }],
    });
    // The clashing id is copied once for both agents.
    const calId = copyOf('fiscal-calendar-2').id;
    const goal = await t.agents.findOne({ id: 'a-goal' });
    expect(goal?.draft.skills).toEqual([calId, copyOf('tax-rules').id]);
    expect(goal?.live?.skills).toEqual([calId]);
    expect(goal?.liveSkills?.map((s) => s.id)).toEqual([calId]);
    expect(goal?.liveSkills?.[0].body).toBe('Old body.');
    // Links follow the renamed copy; the copy's name stays consistent.
    expect(goal?.draft.instructions).toBe(
      'Use [[skill:fiscal-calendar-2]] and [[skill:tax-rules]].',
    );
    expect(goal?.live?.instructions).toBe('Live: [[skill:fiscal-calendar-2]].');
    expect(goal?.liveSkills?.[0].name).toBe('fiscal-calendar-2');
    expect((await t.agents.findOne({ id: 'a-card' }))?.draft.skills).toEqual([
      calId,
    ]);
    // The former owner keeps theirs.
    expect(
      (await t.skills.find({ ownerId: 'ada' })).map((s) => s.id).sort(),
    ).toEqual(['s-cal', 's-tax']);
  });

  it('refuses a name the new owner already has, ignoring case, and moves nothing', async () => {
    const t = setup();
    await withAgents(t);
    await t.agent('g-card', 'CARD COUNTER', { ownerId: 'grace' });
    await expect(
      t.admin.transferAgents(
        { agentIds: ['a-goal', 'a-card'], toUserId: 'grace' },
        'admin',
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Grace Hopper already has an agent named "Card counter"',
    });
    expect(await t.ownerOf('a-goal')).toBe('ada');
    expect(await t.ownerOf('a-card')).toBe('ada');
  });

  it('refuses two agents that share a name', async () => {
    const t = setup();
    await withAgents(t);
    await t.user('alan', 'Alan Turing');
    await t.agent('alan-goal', 'Goal analyst', { ownerId: 'alan' });
    await expect(
      t.admin.transferAgents(
        { agentIds: ['a-goal', 'alan-goal'], toUserId: 'grace' },
        'admin',
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Grace Hopper already has an agent named "Goal analyst"',
    });
  });

  it.each([
    [{ agentIds: [], toUserId: 'grace' }, 400, 'Choose at least one agent'],
    [{ toUserId: 'grace' }, 400, 'Choose at least one agent'],
    [
      {
        agentIds: Array.from({ length: 101 }, (_, i) => `a${i}`),
        toUserId: 'grace',
      },
      400,
      'Choose at most 100 agents',
    ],
    [
      { agentIds: ['a-goal'], toUserId: 'nobody' },
      404,
      'User nobody not found',
    ],
    [
      { agentIds: ['a-goal', 'a-missing'], toUserId: 'grace' },
      404,
      'Agent a-missing not found',
    ],
    [
      { agentIds: ['a-goal', 'a-local'], toUserId: 'grace' },
      404,
      'Agent a-local not found',
    ],
    [
      { agentIds: ['a-goal'], toUserId: 'ada' },
      400,
      '"Goal analyst" already belongs to Ada Lovelace',
    ],
  ])('refuses %j with %i and moves nothing', async (dto, status, message) => {
    const t = setup();
    await withAgents(t);
    // Stored before org server mode: no owner (admin R33).
    await t.agent('a-local', 'Local agent');
    await expect(
      t.admin.transferAgents(dto as never, 'admin'),
    ).rejects.toMatchObject({
      status,
      message,
    });
    expect(await t.ownerOf('a-goal')).toBe('ada');
    expect(await t.eventsOf('agent.transferred')).toEqual([]);
  });

  it('refuses a deactivated new owner', async () => {
    const t = setup();
    await withAgents(t);
    await t.user('lin', 'Lin Leaver', { active: false });
    await t.user('sam', 'Sam Removed', { scimDeleted: true });
    for (const toUserId of ['lin', 'sam']) {
      await expect(
        t.admin.transferAgents({ agentIds: ['a-goal'], toUserId }, 'admin'),
      ).rejects.toMatchObject({
        status: 400,
        message: `${toUserId === 'lin' ? 'Lin Leaver' : 'Sam Removed'} is deactivated`,
      });
    }
  });

  it('is all or nothing: a failed move rolls back the moves before it', async () => {
    const t = setup();
    await withAgents(t);
    t.agents.failUpdatesAfter(1);
    await expect(
      t.admin.transferAgents(
        { agentIds: ['a-goal', 'a-card'], toUserId: 'grace' },
        'admin',
      ),
    ).rejects.toThrow('disk I/O error');
    expect(await t.ownerOf('a-goal')).toBe('ada');
    expect(await t.ownerOf('a-card')).toBe('ada');
    expect(await t.eventsOf('agent.transferred')).toEqual([]);
  });
});

describe('AdminService group mappings (api.md 89, 90; admin R66-R68)', () => {
  it('adds a mapping once, records it, and removes it', async () => {
    const t = setup();
    await directoryWithPeople(t);
    const added = await t.admin.addMapping(
      { groupId: 'g-analysts', role: 'data-owner', datasourceId: 'ds-1' },
      'admin',
    );
    expect(added.created).toBe(true);
    expect(added.mapping).toMatchObject({
      groupId: 'g-analysts',
      role: 'data-owner',
      datasourceId: 'ds-1',
      createdBy: 'admin',
      groupName: 'Analysts',
      datasourceName: 'World Cup',
    });
    const again = await t.admin.addMapping(
      { groupId: 'g-analysts', role: 'data-owner', datasourceId: 'ds-1' },
      'admin',
    );
    expect(again).toMatchObject({
      created: false,
      mapping: { id: added.mapping.id },
    });
    expect(await t.eventsOf('mapping.added')).toEqual([
      {
        actorId: 'admin',
        subjectId: 'g-analysts',
        details: {
          role: 'data-owner',
          datasourceId: 'ds-1',
          mappingId: added.mapping.id,
        },
      },
    ]);

    await t.admin.removeMapping(added.mapping.id, 'admin');
    expect(await t.eventsOf('mapping.removed')).toEqual([
      {
        actorId: 'admin',
        subjectId: 'g-analysts',
        details: {
          role: 'data-owner',
          datasourceId: 'ds-1',
          mappingId: added.mapping.id,
        },
      },
    ]);
    await expect(
      t.admin.removeMapping(added.mapping.id, 'admin'),
    ).rejects.toMatchObject({
      status: 404,
      message: `Group mapping ${added.mapping.id} not found`,
    });
  });

  it.each([
    [{ groupId: 'g-analysts', role: 'wizard' }, 400, 'Unknown role: wizard'],
    [{ groupId: 'g-analysts', role: 'user' }, 400, 'The User role is implicit'],
    [
      { groupId: 'g-analysts', role: 'data-owner' },
      400,
      'Data owner needs a datasource',
    ],
    [
      { groupId: 'g-analysts', role: 'maker', datasourceId: 'ds-1' },
      400,
      'Only Data owner takes a datasource',
    ],
    [{ groupId: 'g-gone', role: 'maker' }, 404, 'Group g-gone not found'],
    [
      { groupId: 'g-analysts', role: 'data-owner', datasourceId: 'ds-gone' },
      404,
      'Datasource ds-gone not found',
    ],
  ])('refuses %j with %i', async (dto, status, message) => {
    const t = setup();
    await directoryWithPeople(t);
    await expect(
      t.admin.addMapping(dto as never, 'admin'),
    ).rejects.toMatchObject({ status, message });
    expect(await t.eventsOf('mapping.added')).toEqual([]);
  });
});

describe('AdminReadService users (api.md 83, 84; admin R49-R54, R59-R61)', () => {
  async function directory(t: Testbed) {
    await directoryWithPeople(t);
    await t.user('alan', 'Alan Turing', {
      lastSignInAt: daysAgo(95),
      lastActiveAt: daysAgo(95),
    });
    await t.user('bea', 'bea Never', {
      lastSignInAt: undefined,
      lastActiveAt: undefined,
    });
    await t.user('lin', 'Lin Leaver', { active: false });
    await t.group('g-eng', 'Engineers', ['alan', 'ada']);
    await t.map('g-analysts', 'approver');
    await t.map('g-eng', 'maker');
    await t.agent('a-goal', 'Goal analyst', { ownerId: 'ada', live: true });
    await t.agent('a-card', 'Card counter', { ownerId: 'ada' });
  }

  it('lists one row per user, sorted by name, with roles from every source, groups, agents and status', async () => {
    const t = setup();
    await directory(t);
    const page = await t.read.listUsers({});
    expect(page.items.map((r) => r.displayName)).toEqual([
      'Ada Lovelace',
      'Alan Turing',
      'Avery Admin',
      'bea Never',
      'Grace Hopper',
      'Lin Leaver',
    ]);
    const row = (name: string) =>
      page.items.find((r) => r.displayName === name);
    expect(row('Ada Lovelace')).toEqual({
      id: 'ada',
      displayName: 'Ada Lovelace',
      email: 'ada@contoso.test',
      initials: 'AL',
      roles: ['approver', 'maker'],
      groups: ['Analysts', 'Engineers'],
      agentsOwned: 2,
      lastActiveAt: daysAgo(0),
      status: 'active',
    });
    expect(row('Avery Admin')).toMatchObject({ roles: ['platform-admin'] });
    expect(row('Alan Turing')).toMatchObject({
      roles: ['maker'],
      status: 'inactive',
      lastActiveAt: daysAgo(95),
    });
    expect(row('bea Never')).toMatchObject({
      roles: [],
      groups: [],
      status: 'not-signed-in',
      lastActiveAt: null,
    });
    expect(row('Lin Leaver')).toMatchObject({ status: 'deactivated' });
    expect(page).toMatchObject({
      total: 6,
      page: 1,
      pageSize: 25,
      counts: {
        users: 6,
        groups: 2,
        platformAdmins: 1,
        approvers: 1,
        dataOwners: 0,
        makers: 2,
        inactive: 1,
      },
      lastSyncAt: null,
    });
  });

  it.each([
    [{ q: 'ENGINEERS' }, ['Ada Lovelace', 'Alan Turing']],
    [{ q: '  turing ' }, ['Alan Turing']],
    [{ q: 'grace@contoso' }, ['Grace Hopper']],
    [
      { q: '   ' },
      [
        'Ada Lovelace',
        'Alan Turing',
        'Avery Admin',
        'bea Never',
        'Grace Hopper',
        'Lin Leaver',
      ],
    ],
    [{ filter: 'maker' }, ['Ada Lovelace', 'Alan Turing']],
    [{ filter: 'platform-admin' }, ['Avery Admin']],
    [{ filter: 'inactive' }, ['Alan Turing']],
    [{ filter: 'data-owner' }, []],
    [{ filter: 'maker', q: 'analysts' }, ['Ada Lovelace']],
    [{ excludeDeactivated: 'true', q: 'l' }, ['Ada Lovelace', 'Alan Turing']],
  ])('%j lists %j', async (query, names) => {
    const t = setup();
    await directory(t);
    const page = await t.read.listUsers(query);
    expect(page.items.map((r) => r.displayName)).toEqual(names);
    expect(page.total).toBe(names.length);
    // The chip counts ignore the search and the filter.
    expect(page.counts.users).toBe(6);
  });

  it('pages the rows and keeps the real total past the end', async () => {
    const t = setup();
    await directory(t);
    const second = await t.read.listUsers({ page: '2', pageSize: '4' });
    expect(second.items.map((r) => r.displayName)).toEqual([
      'Grace Hopper',
      'Lin Leaver',
    ]);
    expect(second).toMatchObject({ total: 6, page: 2, pageSize: 4 });
    const past = await t.read.listUsers({ page: '9', pageSize: '4' });
    expect(past).toMatchObject({ items: [], total: 6, page: 9 });
  });

  it.each([
    [{ filter: 'wizards' }, 'Unknown filter: wizards'],
    [{ page: '0' }, 'page must be a positive integer'],
    [{ page: 'two' }, 'page must be a positive integer'],
    [{ pageSize: '101' }, 'pageSize must be between 1 and 100'],
    [{ pageSize: '0' }, 'pageSize must be between 1 and 100'],
    [{ pageSize: '2.5' }, 'pageSize must be between 1 and 100'],
  ])('refuses %j with 400', async (query, message) => {
    const t = setup();
    await expect(t.read.listUsers(query)).rejects.toMatchObject({
      status: 400,
      message,
    });
  });

  it('reports the last sync as the newest SCIM request', async () => {
    const t = setup();
    await t.event('scim.request', daysAgo(2));
    await t.event('scim.request', daysAgo(1));
    await t.event('sign-in', daysAgo(0));
    expect((await t.read.listUsers({})).lastSyncAt).toBe(daysAgo(1));
  });

  it("details a user's held roles with their sources, groups and agents", async () => {
    const t = setup();
    await directory(t);
    await t.map('g-eng', 'approver');
    const direct = await t.assign('ada', 'data-owner', 'ds-1');
    await t.assign('ada', 'data-owner', 'ds-gone');
    const detail = await t.read.userDetail('ada', 'admin');
    expect(detail).toMatchObject({
      id: 'ada',
      displayName: 'Ada Lovelace',
      roles: ['approver', 'data-owner', 'maker'],
      isSelf: false,
      isBootstrap: false,
      groupList: [
        { id: 'g-analysts', displayName: 'Analysts' },
        { id: 'g-eng', displayName: 'Engineers' },
      ],
      agents: [
        { id: 'a-card', name: 'Card counter', status: 'draft' },
        { id: 'a-goal', name: 'Goal analyst', status: 'live' },
      ],
    });
    expect(detail.heldRoles).toEqual([
      { role: 'user', source: 'implicit' },
      expect.objectContaining({ role: 'maker', source: 'direct' }),
      {
        role: 'data-owner',
        source: 'direct',
        assignmentId: direct.id,
        datasourceId: 'ds-1',
        datasourceName: 'World Cup',
      },
      expect.objectContaining({
        role: 'data-owner',
        source: 'direct',
        datasourceId: 'ds-gone',
        datasourceName: 'ds-gone',
        datasourceMissing: true,
      }),
      {
        role: 'approver',
        source: 'group',
        groupId: 'g-analysts',
        groupNames: ['Analysts', 'Engineers'],
      },
      {
        role: 'maker',
        source: 'group',
        groupId: 'g-eng',
        groupNames: ['Engineers'],
      },
    ]);

    const self = await t.read.userDetail('admin', 'admin');
    expect(self).toMatchObject({ isSelf: true, isBootstrap: true, agents: [] });
    expect(self.heldRoles).toEqual([
      { role: 'user', source: 'implicit' },
      { role: 'platform-admin', source: 'bootstrap' },
    ]);
    await expect(t.read.userDetail('nobody', 'admin')).rejects.toMatchObject({
      status: 404,
      message: 'User nobody not found',
    });
  });
});

describe('A Data owner role whose datasource is gone (data-model 3.13)', () => {
  it('grants nothing, but the detail still lists the direct assignment, flagged', async () => {
    const t = setup();
    await directoryWithPeople(t);
    await t.user('dora', 'Dora Owner');
    await t.group('g-owners', 'Owners', ['dora']);
    const dangling = await t.assign('dora', 'data-owner', 'ds-gone');
    await t.map('g-owners', 'data-owner', 'ds-gone');

    const page = await t.read.listUsers({ q: 'dora' });
    expect(page.items[0].roles).toEqual([]);
    expect(page.counts.dataOwners).toBe(0);
    expect((await t.read.listUsers({ filter: 'data-owner' })).total).toBe(0);

    expect((await t.read.userDetail('dora', 'admin')).heldRoles).toEqual([
      { role: 'user', source: 'implicit' },
      {
        role: 'data-owner',
        source: 'direct',
        assignmentId: dangling.id,
        datasourceId: 'ds-gone',
        datasourceName: 'ds-gone',
        datasourceMissing: true,
      },
    ]);

    // Unticking it removes the stored assignment (api.md 85).
    const saved = await t.admin.saveUserRoles('dora', { roles: [] }, 'admin');
    expect(saved).toMatchObject({ removed: 1, added: 0 });
    expect(await t.directRoles('dora')).toEqual([]);
  });
});

describe('AdminReadService groups and mappings (api.md 87, 88; admin R55, R66)', () => {
  it('lists groups with members and mapped roles, searchable and paged', async () => {
    const t = setup();
    await directoryWithPeople(t);
    await t.group('g-eng', 'engineers', ['ada', 'grace']);
    await t.group('g-empty', 'Board');
    await t.map('g-analysts', 'maker');
    await t.map('g-analysts', 'data-owner', 'ds-1');
    await t.map('g-analysts', 'platform-admin');
    const page = await t.read.listGroups({});
    expect(page).toEqual({
      items: [
        {
          id: 'g-analysts',
          displayName: 'Analysts',
          members: 1,
          mappings: [
            { role: 'platform-admin' },
            {
              role: 'data-owner',
              datasourceId: 'ds-1',
              datasourceName: 'World Cup',
            },
            { role: 'maker' },
          ],
        },
        { id: 'g-empty', displayName: 'Board', members: 0, mappings: [] },
        { id: 'g-eng', displayName: 'engineers', members: 2, mappings: [] },
      ],
      total: 3,
      page: 1,
      pageSize: 25,
    });
    const searched = await t.read.listGroups({ q: ' ENG ', pageSize: '10' });
    expect(searched.items.map((g) => g.displayName)).toEqual(['engineers']);
    await expect(t.read.listGroups({ page: '-1' })).rejects.toMatchObject({
      status: 400,
      message: 'page must be a positive integer',
    });
  });

  it('lists every mapping sorted by group name then role', async () => {
    const t = setup();
    await directoryWithPeople(t);
    await t.group('g-board', 'Board');
    await t.map('g-analysts', 'maker');
    await t.map('g-board', 'approver');
    await t.map('g-analysts', 'data-owner', 'ds-1');
    const { mappings } = await t.read.listMappings();
    expect(
      mappings.map((m) => [m.groupName, m.role, m.datasourceName ?? null]),
    ).toEqual([
      ['Analysts', 'data-owner', 'World Cup'],
      ['Analysts', 'maker', null],
      ['Board', 'approver', null],
    ]);
    expect(mappings[0].id).toMatch(/^m-g-analysts-/);
    expect(mappings[0]).toMatchObject({
      groupId: 'g-analysts',
      createdBy: 'admin',
    });
  });
});

describe('AdminOverviewService (api.md 81, 82; admin R41-R48; data-model 3.14.8)', () => {
  it('shows zeros, eight empty weeks and no activity on a new org server', async () => {
    const t = setup();
    await t.user('admin', 'Avery Admin', {
      lastActiveAt: undefined,
      lastSignInAt: undefined,
    });
    await t.event('sign-in', daysAgo(0), {
      actorId: 'admin',
      subjectId: 'admin',
    });
    await t.event('sign-in.refused', daysAgo(0), {
      subjectId: 'admin',
      details: { reason: 'subject-mismatch' },
    });
    await t.event('scim.request', daysAgo(0));
    const overview = await t.overview.overview();
    expect(overview).toMatchObject({
      activeUsers30d: 0,
      agentsLive: 0,
      attention: {
        ownerlessAgents: { count: 0, items: [] },
        erroredAgents: { count: 0, items: [] },
        inactiveMakers: { count: 0, items: [] },
      },
      recentActivity: [],
    });
    expect(overview.weeklyActiveUsers).toHaveLength(8);
    expect(overview.weeklyActiveUsers.every((w) => w.users === 0)).toBe(true);
  });

  it('derives the tiles, Needs attention, the chart and Recent activity', async () => {
    const t = setup();
    await directoryWithPeople(t);
    await t.user('alan', 'Alan Turing', {
      lastSignInAt: daysAgo(95),
      lastActiveAt: daysAgo(95),
    });
    await t.user('olga', 'Olga Old', {
      lastSignInAt: daysAgo(40),
      lastActiveAt: daysAgo(40),
    });
    await t.user('ivy', 'Ivy Inactive', {
      lastSignInAt: daysAgo(120),
      lastActiveAt: daysAgo(120),
    });
    await t.user('lin', 'Lin Leaver', {
      active: false,
      lastSignInAt: daysAgo(60),
      lastActiveAt: daysAgo(60),
    });
    await t.group('g-eng', 'Engineers', ['ivy']);
    await t.map('g-eng', 'maker');
    const alanMaker = await t.assign('alan', 'maker');

    await t.agent('a-goal', 'Goal analyst', { ownerId: 'ada', live: true });
    await t.agent('a-card', 'Card counter', { ownerId: 'ada' });
    await t.agent('a-orphan', 'Orphan', { ownerId: 'lin', live: true });
    await t.agent('a-ghost', 'Ghost', { ownerId: 'ghost-user' });
    await t.agent('a-local', 'Local', { live: true });

    await t.event('agent.turn-failed', daysAgo(1), {
      actorId: 'ada',
      subjectId: 'a-goal',
      details: { sessionId: 's1', message: 'Older failure' },
    });
    await t.event('agent.turn-failed', daysAgo(0.5), {
      actorId: 'ada',
      subjectId: 'a-goal',
      details: { sessionId: 's1', message: 'Model unavailable' },
    });
    await t.event('agent.turn-failed', daysAgo(8), {
      actorId: 'ada',
      subjectId: 'a-goal',
      details: { sessionId: 's1', message: 'Too old' },
    });
    await t.event('agent.turn-failed', daysAgo(0), {
      actorId: 'ada',
      subjectId: 'a-deleted',
      details: { sessionId: 's2', message: 'Gone' },
    });
    for (const actorId of ['admin', 'ada', 'grace']) {
      await t.event('user.active', daysAgo(0), { actorId, subjectId: actorId });
    }
    await t.event('user.active', daysAgo(14), {
      actorId: 'olga',
      subjectId: 'olga',
    });
    await t.event('role.assigned', daysAgo(0.1), {
      actorId: 'admin',
      subjectId: 'alan',
      details: { role: 'maker' },
    });
    await t.event('user.deactivated', daysAgo(0.05), { subjectId: 'lin' });
    await t.event('sign-in.refused', daysAgo(0.01), {
      subjectId: 'ada',
      details: { reason: 'subject-mismatch' },
    });

    const overview = await t.overview.overview(NOW);
    expect(overview.activeUsers30d).toBe(3);
    expect(overview.agentsLive).toBe(2);
    expect(overview.attention.ownerlessAgents).toEqual({
      count: 2,
      items: [
        { agentId: 'a-ghost', agentName: 'Ghost', formerOwner: null },
        {
          agentId: 'a-orphan',
          agentName: 'Orphan',
          formerOwner: { id: 'lin', displayName: 'Lin Leaver' },
        },
      ],
    });
    expect(overview.attention.erroredAgents).toEqual({
      count: 1,
      items: [
        {
          agentId: 'a-goal',
          agentName: 'Goal analyst',
          owner: { id: 'ada', displayName: 'Ada Lovelace' },
          errors: 2,
          lastErrorAt: daysAgo(0.5),
          lastErrorMessage: 'Model unavailable',
        },
      ],
    });
    expect(overview.attention.inactiveMakers).toEqual({
      count: 2,
      items: [
        {
          user: { id: 'alan', displayName: 'Alan Turing' },
          lastActiveAt: daysAgo(95),
          makerAssignmentId: alanMaker.id,
          makerGroups: [],
        },
        {
          user: { id: 'ivy', displayName: 'Ivy Inactive' },
          lastActiveAt: daysAgo(120),
          makerAssignmentId: null,
          makerGroups: ['Engineers'],
        },
      ],
    });
    const weeks = overview.weeklyActiveUsers;
    expect(weeks).toHaveLength(8);
    expect(weeks[7].users).toBe(3);
    expect(weeks.slice(0, 7).map((w) => w.users)).toEqual([
      0, 0, 0, 0, 0, 1, 0,
    ]);
    expect(overview.recentActivity.map((a) => a.text)).toEqual([
      'Entra ID deactivated Lin Leaver',
      'Avery Admin gave Alan Turing the Maker role',
    ]);

    const exported = await t.overview.exportCsv(NOW);
    expect(exported.fileName).toBe(
      `admin-report-${NOW.toISOString().slice(0, 10)}.csv`,
    );
    expect(exported.csv).toContain('\r\nsummary,Active users · 30 days,3\r\n');
    expect(exported.csv).toContain(
      '\r\nattention,Agents without an active owner,2\r\n',
    );
  });
});
