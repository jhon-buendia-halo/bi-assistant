import BetterSqlite3 from 'better-sqlite3';
import type { OrgServerConfig } from '../../config/org-server.config';
import type { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { ActivityService } from './activity.service';
import type { AuthSessionsService } from './auth-sessions.service';
import type {
  GroupDoc,
  GroupMemberDoc,
  UserDoc,
} from './entities/directory.entity';
import type { OidcClaims, OidcClient } from './oidc/oidc-client';
import { DirectoryRepository } from './repositories/directory.repository';
import { SignInService, type SignInOutcome } from './sign-in.service';

/**
 * Finding the directory user at sign-in (admin R7, R12, R13; api.md 62;
 * non-functional N77): by the stored subject, then by `preferred_username`
 * against `userName`, never by the `email` claim, which Entra ID can send
 * unverified. Runs the real `DirectoryRepository` over in-memory SQLite.
 */
const TENANT = '0b5e0f7a-1c2d-4e3f-9a8b-7c6d5e4f3a2b';
const OTHER_TENANT = '9f8e7d6c-5b4a-4321-8fed-cba987654321';

function setup(
  config: Partial<OrgServerConfig> & Record<string, unknown> = {},
) {
  const db = new BetterSqlite3(':memory:');
  const users = new SqliteDocStore<UserDoc>(db, 'users');
  const directory = new DirectoryRepository(
    users,
    new SqliteDocStore<GroupDoc>(db, 'groups'),
    new SqliteDocStore<GroupMemberDoc>(db, 'group_members'),
  );
  let claims: OidcClaims = { sub: 'unset' };
  const oidc = {
    finishSignIn: jest.fn(() => Promise.resolve(claims)),
  } as unknown as OidcClient;
  const crypto = {
    encrypt: (value: string) => value,
    decrypt: (value: string) => value,
  } as unknown as CryptoService;
  const sessions = {
    create: jest.fn((user: UserDoc) => Promise.resolve(`token:${user.id}`)),
  };
  const activity = { record: jest.fn(() => Promise.resolve()) };
  const service = new SignInService(
    {
      publicBaseUrl: 'https://insights.contoso.test',
      issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      tenantId: TENANT,
      ...config,
    } as OrgServerConfig,
    oidc,
    crypto,
    directory,
    sessions as unknown as AuthSessionsService,
    activity as unknown as ActivityService,
  );
  const sealed = JSON.stringify({
    state: 'state',
    nonce: 'nonce',
    codeVerifier: 'verifier',
    returnTo: '/',
    at: Date.now(),
  });

  return {
    users,
    sessions,
    /** Finish a sign-in whose ID token carries `next`. */
    signIn(next: OidcClaims): Promise<SignInOutcome> {
      claims = next;
      return service.finish({ code: 'code', state: 'state' }, sealed);
    },
    /** The user id a successful outcome signed in. */
    userIdOf(outcome: SignInOutcome): string {
      if (!outcome.ok) throw new Error(`Sign-in failed: ${outcome.error}`);
      return outcome.token.slice('token:'.length);
    },
    async user(id: string): Promise<UserDoc> {
      const doc = await users.findOne({ id });
      if (!doc) throw new Error(`No user ${id}`);
      return doc;
    },
    async seed(user: Omit<UserDoc, 'active' | 'source'> & Partial<UserDoc>) {
      return users.insert({ active: true, source: 'scim', ...user });
    },
  };
}

describe('SignInService: finding the directory user (admin R12, R13)', () => {
  it('matches by the subject recorded at an earlier sign-in first', async () => {
    const t = setup();
    await t.seed({
      id: 'ada',
      userName: 'ada@contoso.test',
      displayName: 'Ada Lovelace',
      oidcSubject: `${TENANT}:oid-ada`,
    });
    const outcome = await t.signIn({
      sub: 'pairwise-sub',
      tid: TENANT,
      oid: 'oid-ada',
      preferred_username: 'ada.renamed@contoso.test',
      email: 'ada.renamed@contoso.test',
      name: 'Ada King',
    });
    expect(t.userIdOf(outcome)).toBe('ada');
    expect((await t.user('ada')).displayName).toBe('Ada King');
    expect(await t.users.find()).toHaveLength(1);
  });

  it('matches a provisioned user by preferred_username (the UPN), case-insensitively, and records the subject', async () => {
    const t = setup();
    await t.seed({
      id: 'grace',
      userName: 'grace@contoso.test',
      email: 'grace.hopper@contoso.test',
      displayName: 'Grace Hopper',
    });
    const outcome = await t.signIn({
      sub: 'sub-grace',
      tid: TENANT,
      oid: 'oid-grace',
      preferred_username: 'Grace@Contoso.TEST',
      email: 'grace.hopper@contoso.test',
      name: 'Grace B. Hopper',
    });
    expect(t.userIdOf(outcome)).toBe('grace');
    expect(await t.user('grace')).toMatchObject({
      oidcSubject: `${TENANT}:oid-grace`,
      displayName: 'Grace B. Hopper',
    });
  });

  it("never matches by the email claim: a spoofed email equal to another user's lands on a new user", async () => {
    const t = setup();
    await t.seed({
      id: 'admin',
      userName: 'admin@contoso.test',
      email: 'admin@contoso.test',
      displayName: 'Avery Admin',
    });
    const outcome = await t.signIn({
      sub: 'sub-mallory',
      preferred_username: 'mallory@contoso.test',
      email: 'ADMIN@contoso.test',
      name: 'Mallory',
    });
    const id = t.userIdOf(outcome);
    expect(id).not.toBe('admin');
    expect(await t.user(id)).toMatchObject({
      userName: 'mallory@contoso.test',
      source: 'jit',
      oidcSubject: 'sub-mallory',
    });
    // The other account is left exactly as it was.
    const admin = await t.user('admin');
    expect(admin.displayName).toBe('Avery Admin');
    expect(admin.oidcSubject).toBeUndefined();
    expect(admin.lastSignInAt).toBeUndefined();
  });

  it('never matches a user whose email (not user name) equals the email claim', async () => {
    const t = setup();
    await t.seed({
      id: 'grace',
      userName: 'grace.h@contoso.test',
      email: 'grace@contoso.test',
      displayName: 'Grace Hopper',
    });
    const outcome = await t.signIn({
      sub: 'sub-eve',
      preferred_username: 'eve@contoso.test',
      email: 'grace@contoso.test',
    });
    expect(t.userIdOf(outcome)).not.toBe('grace');
    expect((await t.user('grace')).oidcSubject).toBeUndefined();
  });

  it('a token without preferred_username matches by subject only; a new user takes the subject as user name', async () => {
    const t = setup();
    await t.seed({
      id: 'ada',
      userName: 'ada@contoso.test',
      email: 'ada@contoso.test',
      displayName: 'Ada Lovelace',
    });
    const outcome = await t.signIn({
      sub: 'Sub-Without-UPN',
      email: 'ada@contoso.test',
      name: 'Someone Else',
    });
    const id = t.userIdOf(outcome);
    expect(id).not.toBe('ada');
    expect(await t.user(id)).toMatchObject({
      userName: 'sub-without-upn',
      oidcSubject: 'Sub-Without-UPN',
    });
  });

  it('adds a person just in time with the UPN as user name and the email for display (R12)', async () => {
    const t = setup();
    const outcome = await t.signIn({
      sub: 'sub-grace',
      preferred_username: 'Grace@Contoso.test',
      email: 'Grace.Hopper@Contoso.test',
      name: 'Grace Hopper',
      given_name: 'Grace',
      family_name: 'Hopper',
    });
    expect(await t.user(t.userIdOf(outcome))).toMatchObject({
      userName: 'grace@contoso.test',
      email: 'grace.hopper@contoso.test',
      displayName: 'Grace Hopper',
      givenName: 'Grace',
      familyName: 'Hopper',
      source: 'jit',
      active: true,
    });
  });
});

describe('SignInService: the token tenant (admin R7)', () => {
  it("fails a token whose tid isn't the issuer's tenant, without an auth session or a user", async () => {
    const t = setup();
    const outcome = await t.signIn({
      sub: 'sub-x',
      tid: OTHER_TENANT,
      oid: 'oid-x',
      preferred_username: 'ada@contoso.test',
    });
    expect(outcome).toEqual({ ok: false, error: 'failed' });
    expect(t.sessions.create).not.toHaveBeenCalled();
    expect(await t.users.find()).toHaveLength(0);
  });

  it("accepts the issuer's tenant in any case", async () => {
    const t = setup();
    const outcome = await t.signIn({
      sub: 'sub-ada',
      tid: TENANT.toUpperCase(),
      oid: 'oid-ada',
      preferred_username: 'ada@contoso.test',
    });
    expect(outcome.ok).toBe(true);
  });

  it('skips the check when the issuer names no tenant id (a non-Entra issuer)', async () => {
    const t = setup({ issuer: 'http://127.0.0.1:4000/oidc', tenantId: null });
    const outcome = await t.signIn({
      sub: 'sub-ada',
      tid: OTHER_TENANT,
      oid: 'oid-ada',
      preferred_username: 'ada@contoso.test',
    });
    expect(outcome.ok).toBe(true);
  });
});
