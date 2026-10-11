import BetterSqlite3 from 'better-sqlite3';
import type { OrgServerConfig } from '../../config/org-server.config';
import type { DocFilter } from '../../infrastructure/database/doc-store';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
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
import { AdminReadService } from './admin-read.service';
import { AllOwnersAgentsRepository } from './repositories/all-owners-agents.repository';

/**
 * The admin API's services (admin R37-R68; api.md 2.15; data-model 3.14.8)
 * over the real repositories and in-memory SQLite.
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
  const resolver = new RoleResolver(directory, roles, {
    bootstrapAdmins: ['admin@contoso.test'],
  } as OrgServerConfig);
  const allAgents = new AllOwnersAgentsRepository(agents);
  const reader = new AdminDirectoryReader(
    directory,
    roles,
    allAgents,
    connections,
    resolver,
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
    read: new AdminReadService(reader, activity),
    assignments,
    agents,
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

describe('AdminReadService users (api.md 83; admin R49-R54)', () => {
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
});

describe('AdminReadService groups (api.md 87; admin R55)', () => {
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
});
