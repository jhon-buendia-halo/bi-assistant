import { ALL_PERMISSIONS, MeView, PermissionId } from './auth.models';

/** Test data for unit specs: an org server user with these permissions. */
export function orgMe(
  permissions: PermissionId[],
  user: Partial<MeView['user']> = {},
): MeView {
  return {
    mode: 'org',
    user: {
      id: 'u-ada',
      displayName: 'Ada Lovelace',
      email: 'ada@contoso.test',
      initials: 'AL',
      ...user,
    },
    roles: [{ role: 'user', source: 'implicit' }],
    permissions: [...permissions].sort(),
  };
}

/** Ada holding the User and Maker roles. */
export const ORG_MAKER: MeView = orgMe([
  'create-agents',
  'request-publishing',
  'share-agents-team',
  'use-agents',
]);

/**
 * Test data for unit specs: a local-mode persona (admin R69). By default
 * Demo User, the bootstrap Platform admin holding every permission.
 */
export function localMe(
  permissions: readonly PermissionId[] = ALL_PERMISSIONS,
  user: Partial<MeView['user']> = {},
): MeView {
  const admin = permissions.includes('manage-users');
  return {
    mode: 'local',
    user: {
      id: 'local',
      displayName: 'Demo User',
      email: 'demo@local.test',
      initials: 'DU',
      ...user,
    },
    roles: [
      { role: 'user', source: 'implicit' },
      ...(admin
        ? [{ role: 'platform-admin' as const, source: 'bootstrap' as const }]
        : []),
    ],
    permissions: [...permissions].sort(),
  };
}

/** Uma User: a local persona with the User role only. */
export const LOCAL_UMA: MeView = localMe(['use-agents'], {
  id: 'local-uma',
  displayName: 'Uma User',
  email: 'uma@local.test',
  initials: 'UU',
});
