import type { Request, Response } from 'express';
import type { AuthSessionsService } from './auth-sessions.service';
import { CurrentUserMiddleware } from './current-user.middleware';
import { CurrentUserService, LOCAL_USER } from './current-user.service';
import type { CurrentUser } from './entities/current-user.entity';
import { PERMISSION_IDS } from './permissions';

const ADA: CurrentUser = {
  id: 'u1',
  displayName: 'Ada Lovelace',
  email: 'ada@contoso.test',
  initials: 'AL',
  roles: [{ role: 'user', source: 'implicit' }],
  permissions: ['use-agents'],
};

describe('CurrentUserService', () => {
  it('runs in local mode', () => {
    expect(new CurrentUserService().mode).toBe('local');
  });

  it('answers the local user outside any request in local mode', () => {
    expect(new CurrentUserService().current()).toBe(LOCAL_USER);
  });

  it('answers the user a callback runs as, across awaits', async () => {
    const service = new CurrentUserService();
    const seen = await service.runAs(ADA, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return service.current();
    });
    expect(seen).toBe(ADA);
    expect(service.current()).toBe(LOCAL_USER);
  });

  it('runs in org server mode with a configuration, with nobody outside a request', () => {
    const service = new CurrentUserService({} as never);
    expect(service.mode).toBe('org');
    expect(service.current()).toBeUndefined();
    expect(() => service.ownerKey()).toThrow('Sign in required');
    expect(service.runAs(ADA, () => service.ownerScope())).toBe('u1');
  });

  it('describes the local user as api.md 2.13 GET /me does', () => {
    expect(LOCAL_USER).toEqual({
      id: 'local',
      displayName: 'Demo User',
      email: null,
      initials: 'D',
      roles: [
        { role: 'user', source: 'implicit' },
        { role: 'platform-admin', source: 'implicit' },
      ],
      permissions: [...PERMISSION_IDS].sort(),
    });
  });
});

describe('CurrentUserMiddleware', () => {
  it('runs the rest of the request as the local user in local mode', async () => {
    const service = new CurrentUserService();
    const middleware = new CurrentUserMiddleware(
      service,
      {} as AuthSessionsService,
    );
    const store = await new Promise<unknown>((resolve) => {
      void middleware.use({} as Request, {} as Response, () => {
        setImmediate(() => resolve(service.storedUser()));
      });
    });
    expect(store).toBe(LOCAL_USER);
  });

  it("runs the request as its auth session's user in org server mode", async () => {
    const service = new CurrentUserService({} as never);
    const sessions = {
      userForRequest: jest.fn((req: { signedIn: boolean }) =>
        Promise.resolve(req.signedIn ? ADA : null),
      ),
    } as unknown as AuthSessionsService;
    const middleware = new CurrentUserMiddleware(service, sessions);
    const seen = (signedIn: boolean) =>
      new Promise<unknown>((resolve) => {
        void middleware.use(
          { signedIn } as unknown as Request,
          {} as Response,
          () => setImmediate(() => resolve(service.current())),
        );
      });
    expect(await seen(true)).toBe(ADA);
    expect(await seen(false)).toBeUndefined();
  });
});
