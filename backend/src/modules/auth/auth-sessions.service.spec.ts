import BetterSqlite3 from 'better-sqlite3';
import type { Request } from 'express';
import type { OrgServerConfig } from '../../config/org-server.config';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { ActivityService } from './activity.service';
import {
  AuthSessionsService,
  hashToken,
  LOCAL_SESSION_MAX_MS,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
} from './auth-sessions.service';
import type { AuthSessionDoc, UserDoc } from './entities/directory.entity';
import { AuthSessionsRepository } from './repositories/auth-sessions.repository';
import type { DirectoryRepository } from './repositories/directory.repository';
import type { RoleResolver } from './role-resolver';

/**
 * Auth sessions in both modes (admin R8, R9, R71; data-model 3.14.6): the
 * token travels in the `qti_session` cookie on an org server and as
 * `Authorization: Bearer` in local mode; a local session has no idle limit
 * and ends 30 days after sign-in.
 */
const DEMO: UserDoc = {
  id: 'local',
  userName: 'demo@local.test',
  displayName: 'Demo User',
  active: true,
  source: 'local',
};

function setup(config: OrgServerConfig | null) {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<AuthSessionDoc>(db, 'auth_sessions');
  const repository = new AuthSessionsRepository(store);
  const service = new AuthSessionsService(
    repository,
    {} as DirectoryRepository,
    {} as RoleResolver,
    {} as ActivityService,
    config,
  );
  return { db, store, service };
}

const request = (headers: Record<string, string>) =>
  ({ headers }) as unknown as Request;

const ORG = { secureCookies: false } as unknown as OrgServerConfig;

describe('AuthSessionsService', () => {
  let ctx: ReturnType<typeof setup>;
  afterEach(() => ctx.db.close());

  describe('in local mode', () => {
    beforeEach(() => (ctx = setup(null)));

    it('reads the bearer token and ignores the cookie (admin R71)', async () => {
      const token = await ctx.service.create(DEMO);
      expect(ctx.service.tokenOf(request({}))).toBeUndefined();
      expect(
        ctx.service.tokenOf(request({ authorization: `Bearer ${token}` })),
      ).toBe(token);
      expect(
        ctx.service.tokenOf(request({ authorization: `bearer  ${token} ` })),
      ).toBe(token);
      expect(
        ctx.service.tokenOf(request({ cookie: `qti_session=${token}` })),
      ).toBeUndefined();
      await expect(
        ctx.service.sessionOf(request({ authorization: `Bearer ${token}` })),
      ).resolves.toMatchObject({ id: hashToken(token), userId: 'local' });
    });

    it('stores only the hash, ending 30 days after sign-in', async () => {
      const before = Date.now();
      const token = await ctx.service.create(DEMO);
      const [stored] = await ctx.store.find();
      expect(stored.id).toBe(hashToken(token));
      expect(JSON.stringify(stored)).not.toContain(token);
      const lifetime = Date.parse(stored.expiresAt) - before;
      expect(lifetime).toBeGreaterThanOrEqual(LOCAL_SESSION_MAX_MS - 1000);
      expect(lifetime).toBeLessThanOrEqual(LOCAL_SESSION_MAX_MS + 1000);
    });

    it('has no idle limit, but sweeps an expired session at startup', async () => {
      const idle = await ctx.service.create(DEMO);
      await ctx.store.update(
        { id: hashToken(idle) },
        {
          lastSeenAt: new Date(Date.now() - SESSION_IDLE_MS * 10).toISOString(),
        },
      );
      const expired = await ctx.service.create(DEMO);
      await ctx.store.update(
        { id: hashToken(expired) },
        { expiresAt: new Date(Date.now() - 1000).toISOString() },
      );

      await ctx.service.onModuleInit();

      expect((await ctx.store.find()).map((s) => s.id)).toEqual([
        hashToken(idle),
      ]);
      await expect(
        ctx.service.sessionOf(request({ authorization: `Bearer ${idle}` })),
      ).resolves.not.toBeNull();
    });
  });

  describe('on an org server', () => {
    beforeEach(() => (ctx = setup(ORG)));

    it('reads the cookie and ignores a bearer token', async () => {
      const token = await ctx.service.create(DEMO);
      expect(
        ctx.service.tokenOf(request({ cookie: `qti_session=${token}` })),
      ).toBe(token);
      expect(
        ctx.service.tokenOf(request({ authorization: `Bearer ${token}` })),
      ).toBeUndefined();
    });

    it('ends a session after 7 days or 8 hours idle (admin R9)', async () => {
      const before = Date.now();
      const token = await ctx.service.create(DEMO);
      const [stored] = await ctx.store.find();
      const lifetime = Date.parse(stored.expiresAt) - before;
      expect(lifetime).toBeGreaterThanOrEqual(SESSION_MAX_MS - 1000);
      expect(lifetime).toBeLessThanOrEqual(SESSION_MAX_MS + 1000);

      await ctx.store.update(
        { id: hashToken(token) },
        {
          lastSeenAt: new Date(
            Date.now() - SESSION_IDLE_MS - 1000,
          ).toISOString(),
        },
      );
      await expect(
        ctx.service.sessionOf(request({ cookie: `qti_session=${token}` })),
      ).resolves.toBeNull();
      expect(await ctx.store.find()).toEqual([]);
    });
  });
});
