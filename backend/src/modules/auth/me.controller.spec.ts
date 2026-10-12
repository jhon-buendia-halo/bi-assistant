import { UnauthorizedException } from '@nestjs/common';
import { CurrentUserService, LOCAL_USER } from './current-user.service';
import { MeController, toMeView } from './me.controller';

/** `GET /me` in both modes (api.md 64; admin R11, R70). */
describe('MeController', () => {
  it.each([
    ['local', undefined],
    ['org', {} as never],
  ] as const)(
    'answers 401 naming the mode (%s) when nobody is signed in',
    (mode, config) => {
      const controller = new MeController(new CurrentUserService(config));
      let thrown: unknown;
      try {
        controller.me();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(UnauthorizedException);
      expect((thrown as UnauthorizedException).getResponse()).toEqual({
        statusCode: 401,
        message: 'Sign in required',
        error: 'Unauthorized',
        mode,
      });
    },
  );

  it('answers the signed-in persona with mode local', () => {
    const users = new CurrentUserService();
    const controller = new MeController(users);
    expect(users.runAs(LOCAL_USER, () => controller.me())).toEqual({
      mode: 'local',
      user: {
        id: 'local',
        displayName: 'Demo User',
        email: 'demo@local.test',
        initials: 'DU',
      },
      roles: [
        { role: 'user', source: 'implicit' },
        { role: 'platform-admin', source: 'bootstrap' },
      ],
      permissions: LOCAL_USER.permissions,
    });
    expect(toMeView('local', LOCAL_USER)).toEqual(
      users.runAs(LOCAL_USER, () => controller.me()),
    );
  });
});
