import type { PermissionId, RoleId } from '../permissions';

/** The two server modes (admin R1); chosen at startup, never changed. */
export type AuthMode = 'local' | 'org';

/** One role a user holds, and why (api.md 2.13). */
export interface HeldRole {
  role: RoleId;
  source: 'implicit' | 'direct' | 'group' | 'bootstrap';
  /** Data owner only. */
  datasourceId?: string;
  /** Source `group` only. */
  groupId?: string;
  /** Source `direct` only; the id `DELETE /admin/role-assignments/:id` takes. */
  assignmentId?: string;
  /**
   * Admin detail only (api.md 84): a direct Data owner assignment whose
   * datasource no longer exists. It grants nothing (data-model 3.13), so
   * `GET /me` never lists it.
   */
  datasourceMissing?: true;
}

/** The user a request (and the work it starts) runs as. */
export interface CurrentUser {
  id: string;
  displayName: string;
  email: string | null;
  initials: string;
  roles: HeldRole[];
  /** Sorted, de-duplicated. */
  permissions: PermissionId[];
}

/** `GET /me` (api.md 2.13). */
export interface MeView {
  mode: AuthMode;
  user: Pick<CurrentUser, 'id' | 'displayName' | 'email' | 'initials'>;
  roles: HeldRole[];
  permissions: PermissionId[];
}
