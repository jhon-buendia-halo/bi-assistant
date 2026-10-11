import { parse, serialize, type SerializeOptions } from 'cookie';
import type { Request, Response } from 'express';

/** The auth-session cookie (api.md 1.9). */
export const SESSION_COOKIE = 'qti_session';
/** The sign-in round-trip cookie (api.md 1.9). */
export const OIDC_COOKIE = 'qti_oidc';
/** How long the round trip may take (admin R7). */
export const OIDC_COOKIE_MAX_AGE_S = 600;

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parse(header)[name] || undefined;
}

function base(secure: boolean, path: string): SerializeOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path };
}

/** Both cookies are `HttpOnly`, `SameSite=Lax`, `Secure` over https (R8). */
export function setCookie(
  res: Response,
  name: string,
  value: string,
  options: { secure: boolean; path: string; maxAge?: number },
): void {
  res.append(
    'Set-Cookie',
    serialize(name, value, {
      ...base(options.secure, options.path),
      ...(options.maxAge !== undefined ? { maxAge: options.maxAge } : {}),
    }),
  );
}

export function clearCookie(
  res: Response,
  name: string,
  options: { secure: boolean; path: string },
): void {
  setCookie(res, name, '', { ...options, maxAge: 0 });
}
