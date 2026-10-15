import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

export const INTELLIFY_API_KEYS = Symbol('INTELLIFY_API_KEYS');

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * The Intellify API's only access control (api.md 2.16): `X-API-Key` must
 * equal one of the configured keys. Comparison is over fixed-length digests in
 * constant time and visits every key, so timing leaks neither a key's content
 * nor its length nor which key matched.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly digests: Buffer[];

  constructor(
    private readonly reflector: Reflector,
    @Inject(INTELLIFY_API_KEYS) keys: string[],
  ) {
    this.digests = keys.map(digest);
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const header = context.switchToHttp().getRequest<Request>().headers[
      'x-api-key'
    ];
    const supplied = Array.isArray(header) ? header[0] : header;
    let ok = false;
    if (supplied) {
      const candidate = digest(supplied);
      for (const known of this.digests) {
        if (timingSafeEqual(candidate, known)) ok = true;
      }
    }
    if (!ok) throw new UnauthorizedException('API key required');
    return true;
  }
}
