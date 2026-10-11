import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { Public } from '../../common/decorators/auth-requirement.decorators';
import { CurrentUserService } from './current-user.service';
import type { MeView } from './entities/current-user.entity';

/** `GET /me`: who the caller is, their roles and permissions (api.md 2.13). */
@Controller('me')
export class MeController {
  constructor(private readonly currentUser: CurrentUserService) {}

  /** Public: it answers 401 itself when nobody is signed in (api.md 1.9). */
  @Get()
  @Public()
  me(): MeView {
    const user = this.currentUser.current();
    if (!user) throw new UnauthorizedException('Sign in required');
    return {
      mode: this.currentUser.mode,
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
}
