import type { Request, Response } from 'express';
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
    const middleware = new CurrentUserMiddleware(service);
    const store = await new Promise<unknown>((resolve) => {
      middleware.use({} as Request, {} as Response, () => {
        setImmediate(() => resolve(service.storedUser()));
      });
    });
    expect(store).toBe(LOCAL_USER);
  });
});
