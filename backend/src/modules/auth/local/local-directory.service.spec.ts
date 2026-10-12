import BetterSqlite3 from 'better-sqlite3';
import type { OrgServerConfig } from '../../../config/org-server.config';
import { SqliteDocStore } from '../../../infrastructure/database/sqlite-doc-store';
import type {
  GroupDoc,
  GroupMemberDoc,
  GroupRoleMappingDoc,
  RoleAssignmentDoc,
  UserDoc,
} from '../entities/directory.entity';
import { DirectoryRepository } from '../repositories/directory.repository';
import { RolesRepository } from '../repositories/roles.repository';
import {
  LOCAL_SEED_KEY,
  LocalDirectoryService,
  type LocalSeedDoc,
} from './local-directory.service';

/**
 * The local personas and their seeded roles (admin R69, R72; data-model
 * 3.2.2), over the real repositories on in-memory SQLite.
 */
function setup(config: OrgServerConfig | null = null) {
  const db = new BetterSqlite3(':memory:');
  const users = new SqliteDocStore<UserDoc>(db, 'users');
  const directory = new DirectoryRepository(
    users,
    new SqliteDocStore<GroupDoc>(db, 'groups'),
    new SqliteDocStore<GroupMemberDoc>(db, 'group_members'),
  );
  const assignments = new SqliteDocStore<RoleAssignmentDoc>(
    db,
    'role_assignments',
  );
  const roles = new RolesRepository(
    assignments,
    new SqliteDocStore<GroupRoleMappingDoc>(db, 'group_role_mappings'),
  );
  const connections = new SqliteDocStore<{ id: string }>(db, 'connections');
  const settings = new SqliteDocStore<LocalSeedDoc>(db, 'settings');
  const service = () =>
    new LocalDirectoryService(directory, roles, connections, settings, config);
  const held = async () =>
    (await assignments.find({}, { sort: { createdAt: 1 } })).map((a) =>
      [a.userId, a.role, a.datasourceId].filter(Boolean).join(':'),
    );
  return {
    db,
    users,
    roles,
    assignments,
    connections,
    settings,
    service,
    held,
  };
}

describe('LocalDirectoryService (admin R69, R72)', () => {
  let ctx: ReturnType<typeof setup>;
  afterEach(() => ctx.db.close());

  it('creates the five personas with fixed ids and seeds Maker and Approver', async () => {
    ctx = setup();
    await ctx.service().onModuleInit();

    const users = await ctx.users.find({}, { sort: { createdAt: 1 } });
    expect(
      users.map((u) => [u.id, u.userName, u.email, u.displayName]),
    ).toEqual([
      ['local', 'demo@local.test', 'demo@local.test', 'Demo User'],
      ['local-uma', 'uma@local.test', 'uma@local.test', 'Uma User'],
      ['local-mark', 'mark@local.test', 'mark@local.test', 'Mark Maker'],
      ['local-dana', 'dana@local.test', 'dana@local.test', 'Dana Data Owner'],
      ['local-avery', 'avery@local.test', 'avery@local.test', 'Avery Approver'],
    ]);
    expect(users.every((u) => u.active && u.source === 'local')).toBe(true);
    expect(users.find((u) => u.id === 'local-dana')).toMatchObject({
      givenName: 'Dana',
      familyName: 'Data Owner',
    });
    expect(await ctx.held()).toEqual([
      'local-mark:maker',
      'local-avery:approver',
    ]);
    expect(await ctx.settings.findOne({ key: LOCAL_SEED_KEY })).toMatchObject({
      applied: ['maker:local-mark', 'approver:local-avery'],
    });
  });

  it('is idempotent across restarts and keeps edited personas', async () => {
    ctx = setup();
    await ctx.service().onModuleInit();
    await ctx.users.update({ id: 'local-uma' }, { displayName: 'Uma Renamed' });

    await ctx.service().onModuleInit();

    expect(await ctx.users.find()).toHaveLength(5);
    expect(await ctx.users.findOne({ id: 'local-uma' })).toMatchObject({
      displayName: 'Uma Renamed',
    });
    expect(await ctx.held()).toEqual([
      'local-mark:maker',
      'local-avery:approver',
    ]);
  });

  it('never re-adds a seeded role an admin removed', async () => {
    ctx = setup();
    await ctx.service().onModuleInit();
    await ctx.assignments.deleteMany({ userId: 'local-mark' });

    await ctx.service().onModuleInit();

    expect(await ctx.held()).toEqual(['local-avery:approver']);
  });

  it('recreates a missing persona without re-seeding its applied role', async () => {
    ctx = setup();
    await ctx.service().onModuleInit();
    await ctx.users.deleteOne({ id: 'local-mark' });
    await ctx.assignments.deleteMany({ userId: 'local-mark' });

    await ctx.service().onModuleInit();

    expect(await ctx.users.findOne({ id: 'local-mark' })).not.toBeNull();
    expect(await ctx.held()).toEqual(['local-avery:approver']);
  });

  it('makes Dana Data owner of every existing datasource at startup, once', async () => {
    ctx = setup();
    await ctx.connections.insert({ id: 'ds-1' });
    await ctx.connections.insert({ id: 'ds-2' });

    await ctx.service().onModuleInit();
    await ctx.service().onModuleInit();

    expect(await ctx.held()).toEqual([
      'local-mark:maker',
      'local-avery:approver',
      'local-dana:data-owner:ds-1',
      'local-dana:data-owner:ds-2',
    ]);
  });

  it('makes Dana Data owner of a datasource created later, once (R72)', async () => {
    ctx = setup();
    const service = ctx.service();
    await service.onModuleInit();

    await Promise.all([
      service.onDatasourceCreated('ds-new'),
      service.onDatasourceCreated('ds-new'),
    ]);
    await service.onDatasourceCreated('ds-new');

    expect(
      (await ctx.held()).filter((h) => h.startsWith('local-dana')),
    ).toEqual(['local-dana:data-owner:ds-new']);

    // Removed in Admin, the datasource saved again: not re-added.
    await ctx.assignments.deleteMany({ userId: 'local-dana' });
    await service.onDatasourceCreated('ds-new');
    await ctx.service().onModuleInit();
    expect(
      (await ctx.held()).filter((h) => h.startsWith('local-dana')),
    ).toEqual([]);
    expect(
      (await ctx.settings.findOne({ key: LOCAL_SEED_KEY }))?.applied,
    ).toContain('data-owner:local-dana:ds-new');
  });

  it('does nothing on an org server', async () => {
    ctx = setup({ bootstrapAdmins: [] } as unknown as OrgServerConfig);
    await ctx.connections.insert({ id: 'ds-1' });
    const service = ctx.service();

    await service.onModuleInit();
    await service.onDatasourceCreated('ds-1');

    expect(await ctx.users.find()).toEqual([]);
    expect(await ctx.held()).toEqual([]);
    expect(await ctx.settings.find()).toEqual([]);
  });
});
