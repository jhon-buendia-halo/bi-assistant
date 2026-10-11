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

/** One persona of the local sign-in dropdown (`GET /auth/local/users`, api.md 91). */
export interface LocalSignInUser {
  id: string;
  displayName: string;
  email: string | null;
  initials: string;
  /** Roles other than User, in badge order; [] = User only. */
  roles: RoleId[];
}

/** What `POST /auth/local/sign-in` answers (api.md 92). */
export interface LocalSignInResult {
  ok: boolean;
  message: string;
  token: string;
  me: MeView;
}

/**
 * Where local mode keeps the auth session token (the raw string; admin R71,
 * ui.md 1.6). Sent as `Authorization: Bearer <token>` on every API call.
 */
export const LOCAL_SESSION_STORAGE_KEY = 'questions-to-insights:local-session';

/** Role names as the local sign-in dropdown shows them (admin R70). */
const LOCAL_ROLE_LABELS: Record<RoleId, string> = {
  user: 'User',
  'platform-admin': 'Platform admin',
  approver: 'Approver',
  'data-owner': 'Data owner',
  maker: 'Maker',
};

const LOCAL_ROLE_ORDER: readonly RoleId[] = [
  'platform-admin',
  'approver',
  'data-owner',
  'maker',
];

/**
 * A dropdown option: `<display name> · <roles>`, the roles other than User
 * joined with ", ", or "User" when there are none (admin R70, ui.md 4.17.1).
 */
export function localUserOptionLabel(user: LocalSignInUser): string {
  const roles = LOCAL_ROLE_ORDER.filter((role) => user.roles.includes(role));
  const names = roles.length
    ? roles.map((role) => LOCAL_ROLE_LABELS[role]).join(', ')
    : LOCAL_ROLE_LABELS.user;
  return `${user.displayName} · ${names}`;
}

/** Copy of the sign-in page (ui.md 4.17, 4.17.1). */
export const BACKEND_UNREACHABLE_MESSAGE = 'Backend unreachable';
export const LOCAL_SIGN_IN_FAILED_MESSAGE = 'Sign-in failed. Try again.';

/** The toast for any HTTP 403 (admin R24, ui.md 1.6). */
export const PERMISSION_DENIED_MESSAGE =
  "You don't have permission to do this.";

/** `signInError` values the sign-in callback redirects with (api.md 62). */
export type SignInError = 'failed' | 'deactivated';

export const SIGN_IN_ERROR_MESSAGES: Record<SignInError, string> = {
  failed: 'Sign-in failed. Try again.',
  deactivated: 'Your account is deactivated. Contact your administrator.',
};
