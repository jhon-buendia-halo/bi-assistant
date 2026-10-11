import type { UserDoc } from './entities/directory.entity';
import type { DirectoryRepository } from './repositories/directory.repository';
import type { RolesRepository } from './repositories/roles.repository';
import { initialsOf, RoleResolver } from './role-resolver';

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

  it('is the union of User, direct assignments and group mappings', async () => {
    const resolved = await new RoleResolver(
      directory,
      roles,
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
    const resolver = new RoleResolver(directory, roles, {
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
    const resolver = new RoleResolver(directory, roles, {
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
});
