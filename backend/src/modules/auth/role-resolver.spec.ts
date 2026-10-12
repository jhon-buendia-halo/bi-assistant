import type { DocStore } from '../../infrastructure/database/doc-store';
import type {
  GroupRoleMappingDoc,
  RoleAssignmentDoc,
  UserDoc,
} from './entities/directory.entity';
import type { DirectoryRepository } from './repositories/directory.repository';
import type { RolesRepository } from './repositories/roles.repository';
import { initialsOf, resolveHeldRoles, RoleResolver } from './role-resolver';

describe('initialsOf (ui.md 1.3)', () => {
  it.each([
    [{ givenName: 'Ada', familyName: 'Lovelace', displayName: 'X Y' }, 'AL'],
    [{ givenName: 'Ada', displayName: 'grace brewster hopper' }, 'GB'],
    [{ displayName: 'Cher' }, 'C'],
    [{ displayName: '', email: 'zed@contoso.test' }, 'Z'],
  ])('%j → %s', (user, initials) => {
    expect(initialsOf(user)).toBe(initials);
  });
});

describe('RoleResolver (admin R18-R21)', () => {
  const user: UserDoc = {
    id: 'u1',
    userName: 'ada@contoso.test',
    email: 'ada@contoso.test',
    displayName: 'Ada Lovelace',
    active: true,
    source: 'scim',
  };
  const directory = {
    groupIdsOf: jest.fn(() => Promise.resolve(['g1'])),
  } as unknown as DirectoryRepository;
  const roles = {
    assignmentsOf: jest.fn(() =>
      Promise.resolve([
        {
          id: 'a1',
          userId: 'u1',
          role: 'data-owner',
          datasourceId: 'ds',
          assignedBy: 'x',
        },
      ]),
    ),
    mappingsOf: jest.fn(() =>
      Promise.resolve([
        { id: 'm1', groupId: 'g1', role: 'maker', createdBy: 'x' },
      ]),
    ),
  } as unknown as RolesRepository;
  /** The datasources that exist: `ds` only. */
  const connections = (ids: string[] = ['ds']) =>
    ({
      find: jest.fn(() => Promise.resolve(ids.map((id) => ({ id })))),
    }) as unknown as DocStore<{ id: string }>;

  it('is the union of User, direct assignments and group mappings', async () => {
    const resolved = await new RoleResolver(
      directory,
      roles,
      connections(),
      null,
    ).currentUserFor(user);
    expect(resolved.roles).toEqual([
      { role: 'user', source: 'implicit' },
      {
        role: 'data-owner',
        source: 'direct',
        assignmentId: 'a1',
        datasourceId: 'ds',
      },
      { role: 'maker', source: 'group', groupId: 'g1' },
    ]);
    expect(resolved.permissions).toEqual([
      'approve-datasource-access',
      'create-agents',
      'request-publishing',
      'share-agents-team',
      'use-agents',
    ]);
    expect(resolved.initials).toBe('AL');
  });

  it('adds Platform admin for a bootstrap user name (the UPN)', async () => {
    const resolver = new RoleResolver(directory, roles, connections(), {
      bootstrapAdmins: ['ada@contoso.test'],
    } as never);
    const resolved = await resolver.currentUserFor({
      ...user,
      email: 'ada.lovelace@elsewhere.test',
    });
    expect(resolved.roles[1]).toEqual({
      role: 'platform-admin',
      source: 'bootstrap',
    });
    expect(resolved.permissions).toContain('manage-users');
    expect(resolver.isBootstrapAdmin({ userName: 'ADA@Contoso.test' })).toBe(
      true,
    );
  });

  it('never makes a bootstrap admin by email (admin R18, N77)', async () => {
    const resolver = new RoleResolver(directory, roles, connections(), {
      bootstrapAdmins: ['admin@contoso.test'],
    } as never);
    const mallory: UserDoc = {
      ...user,
      id: 'u2',
      userName: 'mallory@contoso.test',
      email: 'admin@contoso.test',
    };
    expect(resolver.isBootstrapAdmin(mallory)).toBe(false);
    const resolved = await resolver.currentUserFor(mallory);
    expect(resolved.roles.map((r) => r.role)).not.toContain('platform-admin');
  });

  it('makes Demo User the only bootstrap admin in local mode (R18, R69)', async () => {
    const resolver = new RoleResolver(directory, roles, connections(), null);
    expect(resolver.isBootstrapAdmin({ userName: 'demo@local.test' })).toBe(
      true,
    );
    expect(resolver.isBootstrapAdmin({ userName: 'uma@local.test' })).toBe(
      false,
    );
    expect(resolver.isBootstrapAdmin(user)).toBe(false);
    const demo = await resolver.currentUserFor({
      ...user,
      id: 'local',
      userName: 'demo@local.test',
      email: 'demo@local.test',
      displayName: 'Demo User',
      givenName: 'Demo',
      familyName: 'User',
    });
    expect(demo.roles[1]).toEqual({
      role: 'platform-admin',
      source: 'bootstrap',
    });
    expect(demo.initials).toBe('DU');
    // An org server configuration never includes Demo User implicitly.
    const org = new RoleResolver(directory, roles, connections(), {
      bootstrapAdmins: [],
    } as never);
    expect(org.isBootstrapAdmin({ userName: 'demo@local.test' })).toBe(false);
  });
});

describe('a Data owner role whose datasource is gone (data-model 3.13)', () => {
  const user: UserDoc = {
    id: 'u1',
    userName: 'ada@contoso.test',
    displayName: 'Ada Lovelace',
    active: true,
    source: 'scim',
  };
  const assignment = (
    id: string,
    role: RoleAssignmentDoc['role'],
    datasourceId?: string,
  ): RoleAssignmentDoc => ({
    id,
    userId: 'u1',
    role,
    ...(datasourceId ? { datasourceId } : {}),
    assignedBy: 'x',
  });
  const mapping = (
    id: string,
    role: GroupRoleMappingDoc['role'],
    datasourceId?: string,
  ): GroupRoleMappingDoc => ({
    id,
    groupId: 'g1',
    role,
    ...(datasourceId ? { datasourceId } : {}),
    createdBy: 'x',
  });
  const exists = (id: string) => id === 'ds-live';

  it('grants nothing, from a direct assignment or a group mapping', () => {
    expect(
      resolveHeldRoles(
        false,
        [assignment('a1', 'data-owner', 'ds-gone'), assignment('a2', 'maker')],
        [
          mapping('m1', 'data-owner', 'ds-gone'),
          mapping('m2', 'data-owner', 'ds-live'),
        ],
        exists,
      ),
    ).toEqual([
      { role: 'user', source: 'implicit' },
      { role: 'maker', source: 'direct', assignmentId: 'a2' },
      {
        role: 'data-owner',
        source: 'group',
        groupId: 'g1',
        datasourceId: 'ds-live',
      },
    ]);
  });

  it('can list a dangling direct assignment, flagged, for the admin detail (api.md 84)', () => {
    expect(
      resolveHeldRoles(
        false,
        [assignment('a1', 'data-owner', 'ds-gone')],
        [mapping('m1', 'data-owner', 'ds-gone')],
        exists,
        { includeDanglingAssignments: true },
      ),
    ).toEqual([
      { role: 'user', source: 'implicit' },
      {
        role: 'data-owner',
        source: 'direct',
        assignmentId: 'a1',
        datasourceId: 'ds-gone',
        datasourceMissing: true,
      },
    ]);
  });

  it('leaves the role and its permission out of the current user', async () => {
    const directory = {
      groupIdsOf: jest.fn(() => Promise.resolve(['g1'])),
    } as unknown as DirectoryRepository;
    const roles = {
      assignmentsOf: jest.fn(() =>
        Promise.resolve([assignment('a1', 'data-owner', 'ds-gone')]),
      ),
      mappingsOf: jest.fn(() =>
        Promise.resolve([mapping('m1', 'data-owner', 'ds-gone')]),
      ),
    } as unknown as RolesRepository;
    const connections = {
      find: jest.fn(() => Promise.resolve([{ id: 'ds-live' }])),
    } as unknown as DocStore<{ id: string }>;
    const resolved = await new RoleResolver(
      directory,
      roles,
      connections,
      null,
    ).currentUserFor(user);
    expect(resolved.roles).toEqual([{ role: 'user', source: 'implicit' }]);
    expect(resolved.permissions).toEqual(['use-agents']);
  });

  it('reads the datasources only when the user holds a Data owner role', async () => {
    const directory = {
      groupIdsOf: jest.fn(() => Promise.resolve([])),
    } as unknown as DirectoryRepository;
    const roles = {
      assignmentsOf: jest.fn(() =>
        Promise.resolve([assignment('a1', 'maker')]),
      ),
      mappingsOf: jest.fn(() => Promise.resolve([])),
    } as unknown as RolesRepository;
    const find = jest.fn(() => Promise.resolve([]));
    const resolved = await new RoleResolver(
      directory,
      roles,
      { find } as unknown as DocStore<{ id: string }>,
      null,
    ).currentUserFor(user);
    expect(resolved.permissions).toContain('create-agents');
    expect(find).not.toHaveBeenCalled();
  });
});
