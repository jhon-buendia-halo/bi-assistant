import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CurrentUserService } from './current-user.service';

/**
 * Runs the rest of each request (guards, handler, streamed response) as the
 * request's user (ADR-0011). Without a user the request continues outside
 * any user; the permissions guard then answers 401 for non-public routes.
 */
@Injectable()
export class CurrentUserMiddleware implements NestMiddleware {
  constructor(private readonly currentUser: CurrentUserService) {}

  use(_req: Request, _res: Response, next: NextFunction): void {
    const user = this.currentUser.resolveRequestUser();
    if (!user) {
      next();
      return;
    }
    this.currentUser.runAs(user, () => next());
  }
}
