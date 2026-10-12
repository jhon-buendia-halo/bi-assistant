import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { Public } from '../../common/decorators/auth-requirement.decorators';
import { CurrentUserService } from './current-user.service';
import type {
  AuthMode,
  CurrentUser,
  MeView,
} from './entities/current-user.entity';

/** `GET /me`'s view of a user (api.md 2.13), also answered by local sign-in. */
export function toMeView(mode: AuthMode, user: CurrentUser): MeView {
  return {
    mode,
    user: {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      initials: user.initials,
    },
    roles: user.roles,
    permissions: user.permissions,
  };
}

/** `GET /me`: who the caller is, their roles and permissions (api.md 2.13). */
@Controller('me')
export class MeController {
  constructor(private readonly currentUser: CurrentUserService) {}

  /**
   * Public: it answers 401 itself when nobody is signed in, in both modes,
   * naming the mode so the renderer picks the sign-in page's variant
   * (api.md 1.9, 64).
   */
  @Get()
  @Public()
  me(): MeView {
    const user = this.currentUser.current();
    if (!user) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Sign in required',
        error: 'Unauthorized',
        mode: this.currentUser.mode,
      });
    }
    return toMeView(this.currentUser.mode, user);
  }
}
