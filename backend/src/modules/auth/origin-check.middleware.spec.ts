import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OriginCheckMiddleware } from './origin-check.middleware';

const config = { publicOrigin: 'https://insights.contoso.com' } as never;

function run(
  middleware: OriginCheckMiddleware,
  req: Partial<Request> & { headers?: Record<string, string> },
): boolean {
  const next = jest.fn();
  middleware.use(
    { originalUrl: '/sessions', headers: {}, ...req } as Request,
    {} as Response,
    next,
  );
  return next.mock.calls.length === 1;
}

describe('OriginCheckMiddleware (admin R27)', () => {
  const middleware = new OriginCheckMiddleware(config);

  it('checks nothing in local mode or for GET and HEAD', () => {
    expect(run(new OriginCheckMiddleware(null), { method: 'POST' })).toBe(true);
    expect(run(middleware, { method: 'GET' })).toBe(true);
    expect(run(middleware, { method: 'HEAD' })).toBe(true);
  });

  it('accepts the public origin, by Origin or else Referer', () => {
    expect(
      run(middleware, {
        method: 'POST',
        headers: { origin: 'https://insights.contoso.com' },
      }),
    ).toBe(true);
    expect(
      run(middleware, {
        method: 'DELETE',
        headers: { referer: 'https://insights.contoso.com/agents' },
      }),
    ).toBe(true);
  });

  it('refuses another origin, or none, with 403', () => {
    expect(() =>
      run(middleware, {
        method: 'POST',
        headers: { origin: 'https://evil.test' },
      }),
    ).toThrow(new ForbiddenException('Cross-site request refused'));
    expect(() => run(middleware, { method: 'PUT' })).toThrow(
      ForbiddenException,
    );
  });

  it('exempts SCIM', () => {
    expect(
      run(middleware, { method: 'POST', originalUrl: '/scim/v2/Users' }),
    ).toBe(true);
  });
});
