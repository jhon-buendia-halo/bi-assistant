/** The current user's identity and rights, as `GET /me` answers (api.md 2.13). */

export type AuthMode = 'local' | 'org';

export type RoleId =
  'user' | 'maker' | 'data-owner' | 'approver' | 'platform-admin';

/** The permission ids of the fixed matrix (admin R21). */
export type PermissionId =
  | 'use-agents'
  | 'create-agents'
  | 'share-agents-team'
  | 'request-publishing'
  | 'approve-publishing'
  | 'approve-datasource-access'
  | 'manage-users'
  | 'edit-policies'
  | 'view-audit-log'
  | 'manage-datasources'
  | 'manage-llm';

export const ALL_PERMISSIONS: readonly PermissionId[] = [
  'approve-datasource-access',
  'approve-publishing',
  'create-agents',
  'edit-policies',
  'manage-datasources',
  'manage-llm',
  'manage-users',
  'request-publishing',
  'share-agents-team',
  'use-agents',
  'view-audit-log',
];

export interface HeldRole {
  role: RoleId;
  source: 'implicit' | 'direct' | 'group' | 'bootstrap';
  datasourceId?: string;
  groupId?: string;
  assignmentId?: string;
}

export interface MeView {
  mode: AuthMode;
  user: {
    id: string;
    displayName: string;
    email: string | null;
    initials: string;
  };
  roles: HeldRole[];
  permissions: PermissionId[];
}

/**
 * The local user (admin R2), as local mode's `GET /me` answers it. The app
 * falls back to it when `GET /me` can't be reached, so a backend that is
 * still starting behaves exactly as before org server mode existed.
 */
export const LOCAL_ME: MeView = {
  mode: 'local',
  user: { id: 'local', displayName: 'Demo User', email: null, initials: 'D' },
  roles: [
    { role: 'user', source: 'implicit' },
    { role: 'platform-admin', source: 'implicit' },
  ],
  permissions: [...ALL_PERMISSIONS],
};

/** The toast for any HTTP 403 (admin R24, ui.md 1.6). */
export const PERMISSION_DENIED_MESSAGE =
  "You don't have permission to do this.";

/** `signInError` values the sign-in callback redirects with (api.md 62). */
export type SignInError = 'failed' | 'deactivated';

export const SIGN_IN_ERROR_MESSAGES: Record<SignInError, string> = {
  failed: 'Sign-in failed. Try again.',
  deactivated: 'Your account is deactivated. Contact your administrator.',
};
