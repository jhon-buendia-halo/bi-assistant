import { SetMetadata } from '@nestjs/common';
import type { PermissionId } from '../../modules/auth/permissions';

/**
 * What a route needs before its handler runs (admin R23; per-route list in
 * specs/system/api.md 1.9). Exactly one per route: a handler's marker wins
 * over its controller's. A route with none stops the server from starting.
 */
export type AuthRequirement =
  | { kind: 'permission'; permission: PermissionId }
  | { kind: 'public' }
  | { kind: 'scim' };

export const AUTH_REQUIREMENT_KEY = 'qti:auth-requirement';

/** The caller must hold `permission` (403 otherwise, 401 when signed out). */
export const RequirePermission = (permission: PermissionId) =>
  SetMetadata<string, AuthRequirement>(AUTH_REQUIREMENT_KEY, {
    kind: 'permission',
    permission,
  });

/** No auth session or permission needed (sign-in routes, `GET /me`). */
export const Public = () =>
  SetMetadata<string, AuthRequirement>(AUTH_REQUIREMENT_KEY, {
    kind: 'public',
  });

/** Authenticated by the SCIM bearer token instead of an auth session. */
export const ScimAuth = () =>
  SetMetadata<string, AuthRequirement>(AUTH_REQUIREMENT_KEY, {
    kind: 'scim',
  });
