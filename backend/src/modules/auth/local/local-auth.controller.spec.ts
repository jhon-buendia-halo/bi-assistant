import BetterSqlite3 from 'better-sqlite3';
import type { Request } from 'express';
import { SqliteDocStore } from '../../../infrastructure/database/sqlite-doc-store';
import type { ActivityService } from '../activity.service';
import { AuthSessionsService } from '../auth-sessions.service';
import type {
  AuthSessionDoc,
  GroupDoc,
  GroupMemberDoc,
  GroupRoleMappingDoc,
  RoleAssignmentDoc,
  UserDoc,
} from '../entities/directory.entity';
import { AuthSessionsRepository } from '../repositories/auth-sessions.repository';
import { DirectoryRepository } from '../repositories/directory.repository';
import { RolesRepository } from '../repositories/roles.repository';
import { RoleResolver } from '../role-resolver';
import { LocalAuthController } from './local-auth.controller';
import {
  LocalDirectoryService,
  type LocalSeedDoc,
} from './local-directory.service';

/**
 * The local sign-in routes (api.md 91-93; admin R69-R71) over the real
 * directory, roles and auth sessions on in-memory SQLite.
 */
async function setup() {
  const db = new BetterSqlite3(':memory:');
  const users = new SqliteDocStore<UserDoc>(db, 'users');
  const directory = new DirectoryRepository(
    users,
    new SqliteDocStore<GroupDoc>(db, 'groups'),
    new SqliteDocStore<GroupMemberDoc>(db, 'group_members'),
  );
  const roles = new RolesRepository(
    new SqliteDocStore<RoleAssignmentDoc>(db, 'role_assignments'),
    new SqliteDocStore<GroupRoleMappingDoc>(db, 'group_role_mappings'),
  );
  const connections = new SqliteDocStore<{ id: string }>(db, 'connections');
  const resolver = new RoleResolver(directory, roles, connections, null);
  const activity = {
    record: jest.fn(() => Promise.resolve()),
    markActive: jest.fn(() => Promise.resolve()),
  };
  const sessionStore = new SqliteDocStore<AuthSessionDoc>(db, 'auth_sessions');
  const sessions = new AuthSessionsService(
    new AuthSessionsRepository(sessionStore),
    directory,
    resolver,
    activity as unknown as ActivityService,
    null,
  );
  const local = new LocalDirectoryService(
    directory,
    roles,
    connections,
    new SqliteDocStore<LocalSeedDoc>(db, 'settings'),
    null,
  );
  await local.onModuleInit();
  const controller = new LocalAuthController(
    directory,
    resolver,
    sessions,
    activity as unknown as ActivityService,
  );
  return {
    db,
    users,
    connections,
    sessions,
    sessionStore,
    activity,
    controller,
    local,
  };
}

const request = (headers: Record<string, string> = {}) =>
  ({ headers }) as unknown as Request;

describe('LocalAuthController', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => (ctx = await setup()));
  afterEach(() => ctx.db.close());

  it('lists active personas by display name with their roles, User left out', async () => {
    await ctx.connections.insert({ id: 'ds-1' });
    await ctx.local.onDatasourceCreated('ds-1');
    await ctx.users.update({ id: 'local-uma' }, { active: false });

    const { users } = await ctx.controller.users();

    expect(users.map((u) => [u.displayName, u.initials, u.roles])).toEqual([
      ['Avery Approver', 'AA', ['approver']],
      ['Dana Data Owner', 'DD', ['data-owner']],
      ['Demo User', 'DU', ['platform-admin']],
      ['Mark Maker', 'MM', ['maker']],
    ]);
  });

  it('signs a persona in: a bearer token, lastSignInAt, a sign-in event and the /me view', async () => {
    const result = await ctx.controller.signIn(
      { userId: 'local-mark' },
      request({ 'user-agent': 'jest' }),
    );

    expect(result).toMatchObject({
      ok: true,
      message: 'Signed in',
      me: {
        mode: 'local',
        user: { id: 'local-mark', initials: 'MM' },
        permissions: expect.arrayContaining(['create-agents']) as unknown,
      },
    });
    expect(result.token.length).toBeGreaterThanOrEqual(32);
    expect(
      (await ctx.users.findOne({ id: 'local-mark' }))?.lastSignInAt,
    ).toEqual(expect.any(String));
    expect(ctx.activity.record).toHaveBeenCalledWith('sign-in', {
      actorId: 'local-mark',
      subjectId: 'local-mark',
    });
    await expect(
      ctx.sessions.userForRequest(
        request({ authorization: `Bearer ${result.token}` }),
      ),
    ).resolves.toMatchObject({ id: 'local-mark' });
  });

  it.each([
    ['an unknown user', { userId: 'nobody' }, 'User nobody not found'],
    ['no user id', {}, 'User  not found'],
  ])('refuses %s with 404 and no session', async (_label, body, message) => {
    await expect(ctx.controller.signIn(body, request())).rejects.toThrow(
      message,
    );
    expect(await ctx.sessionStore.find()).toEqual([]);
  });

  it('refuses a deactivated persona', async () => {
    await ctx.users.update({ id: 'local-uma' }, { active: false });
    await expect(
      ctx.controller.signIn({ userId: 'local-uma' }, request()),
    ).rejects.toThrow('User local-uma not found');
  });

  it('signs out, harmlessly twice or without a token', async () => {
    const { token } = await ctx.controller.signIn(
      { userId: 'local' },
      request(),
    );
    const signedIn = request({ authorization: `Bearer ${token}` });

    await expect(ctx.controller.signOut(signedIn)).resolves.toEqual({
      ok: true,
      message: 'Signed out',
    });
    expect(ctx.activity.record).toHaveBeenCalledWith('sign-out', {
      actorId: 'local',
      subjectId: 'local',
    });
    expect(await ctx.sessionStore.find()).toEqual([]);
    await expect(ctx.controller.signOut(signedIn)).resolves.toEqual({
      ok: true,
      message: 'Signed out',
    });
    await expect(ctx.controller.signOut(request())).resolves.toEqual({
      ok: true,
      message: 'Signed out',
    });
  });
});
