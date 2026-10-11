import {
  ForbiddenException,
  Inject,
  Injectable,
  NestMiddleware,
  Optional,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  ORG_SERVER_CONFIG,
  type OrgServerConfig,
} from '../../config/org-server.config';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * The CSRF check of org server mode (admin R27; api.md 1.9): a request that
 * can change data must come from a page of the app itself, by its `Origin`
 * header or, failing that, its `Referer`. SCIM is exempt (bearer token, no
 * cookie). Local mode checks nothing.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  constructor(
    @Optional()
    @Inject(ORG_SERVER_CONFIG)
    private readonly config: OrgServerConfig | null = null,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    if (!this.config || SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const path = req.originalUrl.split('?')[0];
    if (path === '/scim/v2' || path.startsWith('/scim/v2/')) {
      next();
      return;
    }
    const origin =
      typeof req.headers.origin === 'string' && req.headers.origin !== 'null'
        ? originOf(req.headers.origin)
        : originOf(req.headers.referer);
    if (origin !== this.config.publicOrigin) {
      throw new ForbiddenException('Cross-site request refused');
    }
    next();
  }
}
