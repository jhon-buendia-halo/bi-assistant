import { MeView, PermissionId } from './auth.models';

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
