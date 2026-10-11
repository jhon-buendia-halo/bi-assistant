import BetterSqlite3 from 'better-sqlite3';
import type { OrgServerConfig } from '../../../config/org-server.config';
import { SqliteDocStore } from '../../../infrastructure/database/sqlite-doc-store';
import type { ActivityService } from '../activity.service';
import type { AuthSessionsService } from '../auth-sessions.service';
import type {
  GroupDoc,
  GroupMemberDoc,
  UserDoc,
} from '../entities/directory.entity';
import { DirectoryRepository } from '../repositories/directory.repository';
import type { RolesRepository } from '../repositories/roles.repository';
import { USER_SCHEMA, ScimService } from './scim.service';

/**
 * `POST /scim/v2/Users` with a user name a removed or deactivated user holds
 * (admin R16; api.md 2.14; data-model 3.14.1): the same person comes back,
 * a different person (another `externalId`) gets a new user and the old one
 * is released. Runs the real `DirectoryRepository` over in-memory SQLite.
 */
function setup() {
  const db = new BetterSqlite3(':memory:');
  const users = new SqliteDocStore<UserDoc>(db, 'users');
  const directory = new DirectoryRepository(
    users,
    new SqliteDocStore<GroupDoc>(db, 'groups'),
    new SqliteDocStore<GroupMemberDoc>(db, 'group_members'),
  );
  const sessions = { endAllOf: jest.fn(() => Promise.resolve()) };
  const activity = { record: jest.fn(() => Promise.resolve()) };
  const service = new ScimService(
    { publicBaseUrl: 'https://insights.contoso.test' } as OrgServerConfig,
    directory,
    {} as RolesRepository,
    sessions as unknown as AuthSessionsService,
    activity as unknown as ActivityService,
  );
  return {
    service,
    directory,
    sessions,
    async user(id: string): Promise<UserDoc> {
      const doc = await users.findOne({ id });
      if (!doc) throw new Error(`No user ${id}`);
      return doc;
    },
    seed(user: Omit<UserDoc, 'source' | 'displayName'> & Partial<UserDoc>) {
      return users.insert({
        displayName: 'Lee Leaver',
        source: 'scim',
        ...user,
      });
    },
    create(userName: string, externalId?: string) {
      return service.createUser({
        schemas: [USER_SCHEMA],
        userName,
        displayName: 'New Person',
        active: true,
        ...(externalId ? { externalId } : {}),
      });
    },
  };
}

describe('ScimService.createUser with a taken user name (admin R16)', () => {
  it('releases a removed user whose externalId differs and creates a new user', async () => {
    const t = setup();
    await t.seed({
      id: 'old',
      userName: 'leaver@contoso.test',
      externalId: 'oid-old',
      oidcSubject: 'tenant:oid-old',
      active: false,
      scimDeleted: true,
    });
    const created = await t.create('Leaver@Contoso.test', 'oid-new');
    expect(created.id).not.toBe('old');
    expect(await t.user(created.id)).toMatchObject({
      userName: 'leaver@contoso.test',
      externalId: 'oid-new',
      active: true,
      source: 'scim',
    });
    expect((await t.user(created.id)).oidcSubject).toBeUndefined();
    // The old user keeps its id, subject and name for display, but not the user name.
    expect(await t.user('old')).toMatchObject({
      userName: 'released:old',
      releasedUserName: 'leaver@contoso.test',
      displayName: 'Lee Leaver',
      oidcSubject: 'tenant:oid-old',
      active: false,
      scimDeleted: true,
    });
    expect(t.sessions.endAllOf).toHaveBeenCalledWith('old');
    expect((await t.directory.userByUserName('leaver@contoso.test'))?.id).toBe(
      created.id,
    );
    expect(await t.directory.userByUserName('released:old')).toBeNull();
  });

  it('releases a deactivated user who has signed in, hides them from SCIM and takes them out of their groups', async () => {
    const t = setup();
    await t.seed({
      id: 'old',
      userName: 'mover@contoso.test',
      externalId: 'oid-a',
      oidcSubject: 'sub-a',
      active: false,
    });
    await t.directory.addMember('g1', 'old');
    const created = await t.create('mover@contoso.test', 'oid-b');
    expect(created.id).not.toBe('old');
    expect(await t.user('old')).toMatchObject({
      userName: 'released:old',
      releasedUserName: 'mover@contoso.test',
      scimDeleted: true,
    });
    expect(await t.directory.groupIdsOf('old')).toEqual([]);
    await expect(t.service.getUser('old')).rejects.toMatchObject({
      detail: 'User old not found',
    });
  });

  it.each([
    ['the same externalId', 'oid-1', 'oid-1'],
    ['no externalId on the old user', undefined, 'oid-2'],
    ['no externalId in the request', 'oid-3', undefined],
  ])(
    'brings a removed user back under the same id with %s',
    async (_label, oldExternalId, newExternalId) => {
      const t = setup();
      await t.seed({
        id: 'old',
        userName: 'grace@contoso.test',
        ...(oldExternalId ? { externalId: oldExternalId } : {}),
        oidcSubject: 'sub-grace',
        active: false,
        scimDeleted: true,
      });
      const created = await t.create('grace@contoso.test', newExternalId);
      expect(created.id).toBe('old');
      const revived = await t.user('old');
      expect(revived).toMatchObject({
        userName: 'grace@contoso.test',
        active: true,
      });
      expect(revived.scimDeleted).toBeUndefined();
      expect(revived.releasedUserName).toBeUndefined();
    },
  );

  it.each([
    ['an active user', { active: true, oidcSubject: 'sub-a' }],
    ['a deactivated user who never signed in', { active: false }],
  ])(
    'answers 409 for %s whatever the externalId',
    async (_label, state: Partial<UserDoc>) => {
      const t = setup();
      await t.seed({
        id: 'old',
        userName: 'taken@contoso.test',
        externalId: 'oid-a',
        active: true,
        ...state,
      });
      await expect(
        t.create('taken@contoso.test', 'oid-b'),
      ).rejects.toMatchObject({
        detail: 'User taken@contoso.test already exists',
        scimType: 'uniqueness',
      });
      expect((await t.user('old')).userName).toBe('taken@contoso.test');
    },
  );
});
