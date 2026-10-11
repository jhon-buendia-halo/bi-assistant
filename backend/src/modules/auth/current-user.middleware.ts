import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthSessionsService } from './auth-sessions.service';
import { CurrentUserService, LOCAL_USER } from './current-user.service';

/**
 * Runs the rest of each request (guards, handler, streamed response) as the
 * request's user (ADR-0011): the local user in local mode, the auth
 * session's user in org server mode. Without a user the request continues
 * outside any user; the permissions guard then answers 401 for non-public
 * routes.
 */
@Injectable()
export class CurrentUserMiddleware implements NestMiddleware {
  constructor(
    private readonly currentUser: CurrentUserService,
    private readonly sessions: AuthSessionsService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    if (this.currentUser.mode === 'local') {
      this.currentUser.runAs(LOCAL_USER, () => next());
      return;
    }
    const user = await this.sessions.userForRequest(req);
    if (!user) {
      next();
      return;
    }
    this.currentUser.runAs(user, () => next());
  }
}
