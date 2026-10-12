import type { RoleId } from '../permissions';

/**
 * The identity and access documents (data-model 3.14), written in both
 * modes: on an org server by sign-in, SCIM and the admin area; in local mode
 * by the persona seeding (admin R69), local sign-in and the admin area.
 */

/** A role that can be assigned or mapped: every role but the implicit User. */
export type AssignableRoleId = Exclude<RoleId, 'user'>;

/** `users` (data-model 3.14.1). */
export interface UserDoc {
  id: string;
  /** Lowercased; unique. */
  userName: string;
  /** Lowercased. */
  email?: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  externalId?: string;
  /** `<tid>:<oid>` for Entra ID, else the `sub` claim. Never changed once set. */
  oidcSubject?: string;
  /**
   * The former `userName` of a user SCIM released because a different person
   * (another `externalId`) got the name (admin R16; data-model 3.14.1). Their
   * `userName` is then `released:<id>` and lookups by user name skip them.
   */
  releasedUserName?: string;
  active: boolean;
  scimDeleted?: boolean;
  /** `local`: a local persona seeded at startup (admin R69). */
  source: 'scim' | 'jit' | 'local';
  lastSignInAt?: string;
  lastActiveAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `groups` (data-model 3.14.2). */
export interface GroupDoc {
  id: string;
  displayName: string;
  externalId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `group_members` (data-model 3.14.3). */
export interface GroupMemberDoc {
  id: string;
  groupId: string;
  userId: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `role_assignments` (data-model 3.14.4): direct assignments only. */
export interface RoleAssignmentDoc {
  id: string;
  userId: string;
  role: AssignableRoleId;
  /** Data owner only. */
  datasourceId?: string;
  assignedBy: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `group_role_mappings` (data-model 3.14.5). */
export interface GroupRoleMappingDoc {
  id: string;
  groupId: string;
  role: AssignableRoleId;
  /** Data owner only. */
  datasourceId?: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `auth_sessions` (data-model 3.14.6). */
export interface AuthSessionDoc {
  /** SHA-256 hex of the cookie token; the token itself is never stored. */
  id: string;
  userId: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** The `activity_events` types (data-model 3.14.7). */
export type ActivityEventType =
  | 'sign-in'
  | 'sign-in.refused'
  | 'sign-out'
  | 'user.active'
  | 'scim.request'
  | 'role.assigned'
  | 'role.removed'
  | 'user.deactivated'
  | 'user.reactivated'
  | 'mapping.added'
  | 'mapping.removed'
  | 'agent.transferred'
  | 'agent.turn-failed';

/** `activity_events` (data-model 3.14.7); append-only. */
export interface ActivityEventDoc {
  id: string;
  type: ActivityEventType;
  at: string;
  actorId?: string;
  subjectId?: string;
  details?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}
