import { HeldRole, RoleId } from '../../../core/auth/auth.models';

/**
 * The admin API's shapes (api.md 2.15) and the fixed role and permission
 * copy of the Admin area (admin R19, R21, R39; ui.md 4.18).
 */

/** A role that can be assigned or mapped: every role but the implicit User. */
export type AssignableRole = Exclude<RoleId, 'user'>;

export type UserStatus = 'active' | 'inactive' | 'not-signed-in' | 'deactivated';

export interface UserRef {
  id: string;
  displayName: string;
}

export interface AdminUserRow {
  id: string;
  displayName: string;
  email: string | null;
  initials: string;
  /** Distinct, from every source, in the order of `ROLE_BADGE_ORDER`; [] = User only. */
  roles: AssignableRole[];
  groups: string[];
  agentsOwned: number;
  lastActiveAt: string | null;
  status: UserStatus;
}

export interface AdminHeldRole extends HeldRole {
  /** Data owner only: the datasource's current name, or its id once deleted. */
  datasourceName?: string;
  /** Data owner only: the datasource was deleted, so the role grants nothing. */
  datasourceMissing?: boolean;
  groupNames?: string[];
}

export interface ActivityItem {
  id: string;
  type: string;
  at: string;
  text: string;
}

export interface OwnerlessAgent {
  agentId: string;
  agentName: string;
  formerOwner: UserRef | null;
}

export interface ErroredAgent {
  agentId: string;
  agentName: string;
  owner: UserRef;
  errors: number;
  lastErrorAt: string;
  lastErrorMessage: string;
}

export interface InactiveMaker {
  user: UserRef;
  lastActiveAt: string;
  makerAssignmentId: string | null;
  makerGroups: string[];
}

export interface WeeklyActiveUsers {
  /** The Monday, `YYYY-MM-DD` (UTC). */
  weekStart: string;
  users: number;
}

/** `GET /admin/overview` (api 81). */
export interface AdminOverview {
  generatedAt: string;
  activeUsers30d: number;
  agentsLive: number;
  attention: {
    ownerlessAgents: { count: number; items: OwnerlessAgent[] };
    erroredAgents: { count: number; items: ErroredAgent[] };
    inactiveMakers: { count: number; items: InactiveMaker[] };
  };
  weeklyActiveUsers: WeeklyActiveUsers[];
  recentActivity: ActivityItem[];
}

export type UsersFilter =
  | 'all'
  | 'platform-admin'
  | 'approver'
  | 'data-owner'
  | 'maker'
  | 'inactive';

export interface DirectoryCounts {
  users: number;
  groups: number;
  platformAdmins: number;
  approvers: number;
  dataOwners: number;
  makers: number;
  inactive: number;
}

/** `GET /admin/users` (api 83). */
export interface AdminUsersPage {
  items: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: DirectoryCounts;
  lastSyncAt: string | null;
}

export interface AdminUsersQuery {
  q?: string;
  filter?: UsersFilter;
  page?: number;
  pageSize?: number;
  excludeDeactivated?: boolean;
}

export interface UserAgent {
  id: string;
  name: string;
  status: 'live' | 'draft';
}

/** `GET /admin/users/:id` (api 84). */
export interface AdminUserDetail extends AdminUserRow {
  heldRoles: AdminHeldRole[];
  groupList: UserRef[];
  agents: UserAgent[];
  isSelf: boolean;
  isBootstrap: boolean;
}

/** One direct assignment as `PUT /admin/users/:id/roles` takes it (api 85). */
export interface RoleGrant {
  role: AssignableRole;
  datasourceId?: string;
}

export interface OkResult {
  ok: boolean;
  message: string;
}

export interface SaveRolesResult extends OkResult {
  added: number;
  removed: number;
  heldRoles: AdminHeldRole[];
}

export interface TransferResult extends OkResult {
  transferred: number;
}

export interface GroupMappingSummary {
  role: AssignableRole;
  datasourceId?: string;
  datasourceName?: string;
}

export interface AdminGroupRow {
  id: string;
  displayName: string;
  members: number;
  mappings: GroupMappingSummary[];
}

/** `GET /admin/groups` (api 87). */
export interface AdminGroupsPage {
  items: AdminGroupRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** A group mapping as `GET /admin/role-mappings` lists it (api 88). */
export interface GroupRoleMapping {
  id: string;
  groupId: string;
  groupName: string;
  role: AssignableRole;
  datasourceId?: string;
  datasourceName?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AssignRoleResult extends OkResult {
  assignment: { id: string };
}

export interface AddMappingResult extends OkResult {
  mapping: GroupRoleMapping;
}

// ---------------------------------------------------------------- copy

export const ROLE_LABELS: Record<RoleId, string> = {
  user: 'User',
  maker: 'Maker',
  'data-owner': 'Data owner',
  approver: 'Approver',
  'platform-admin': 'Platform admin',
};

/** Badge order in the users table (admin R52). */
export const ROLE_BADGE_ORDER: readonly AssignableRole[] = [
  'platform-admin',
  'approver',
  'data-owner',
  'maker',
];

/** The roles the Role selects offer, in this order (ui.md 4.18.1). */
export const ASSIGNABLE_ROLES: readonly AssignableRole[] = [
  'maker',
  'data-owner',
  'approver',
  'platform-admin',
];

/** Role badge styles (ui.md 4.18.1). */
export const ROLE_CHIPS: Record<RoleId, string> = {
  'platform-admin': 'chip-danger',
  approver: 'chip-warning',
  'data-owner': 'chip-success',
  maker: 'chip-info',
  user: 'chip-neutral',
};

export const STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  'not-signed-in': 'Not signed in',
  deactivated: 'Deactivated',
};

export const STATUS_CHIPS: Record<UserStatus, string> = {
  active: 'chip-success',
  inactive: 'chip-danger',
  'not-signed-in': 'chip-neutral',
  deactivated: 'chip-warning',
};

export const AGENT_STATUS: Record<UserAgent['status'], { label: string; chip: string }> = {
  live: { label: 'Live', chip: 'chip-success' },
  draft: { label: 'Draft', chip: 'chip-neutral' },
};

/** The role descriptions of the user detail panel (ui.md 4.18.4). */
export const ROLE_DESCRIPTIONS: Record<AssignableRole, string> = {
  'platform-admin': 'Manage users, roles, policies and settings',
  approver: 'Approve org-wide publishing',
  maker: 'Create, test and share agents with their team',
  'data-owner': 'Approves access requests to this data source',
};

/** The matrix's columns (admin R65). */
export const MATRIX_ROLES: readonly RoleId[] = [
  'user',
  'maker',
  'data-owner',
  'approver',
  'platform-admin',
];

/** The fixed permission matrix (admin R21), in its order. */
export const PERMISSION_MATRIX: readonly { name: string; roles: readonly RoleId[] }[] = [
  { name: 'Use agents in the gallery and chat', roles: MATRIX_ROLES },
  { name: 'Create, test and version agents', roles: ['maker', 'platform-admin'] },
  { name: 'Share agents with own team', roles: ['maker', 'platform-admin'] },
  { name: 'Request org-wide publishing', roles: ['maker', 'platform-admin'] },
  { name: 'Approve org-wide publishing', roles: ['approver', 'platform-admin'] },
  { name: 'Approve access to a data source', roles: ['data-owner', 'platform-admin'] },
  { name: 'Manage users, roles and group mappings', roles: ['platform-admin'] },
  { name: 'Edit policies and templates', roles: ['platform-admin'] },
  { name: 'View audit log', roles: ['approver', 'platform-admin'] },
  { name: 'Manage datasources and datasets', roles: ['platform-admin'] },
  { name: 'Manage LLM configuration', roles: ['platform-admin'] },
];

/** The empty-directory copy (admin R57, R67). */
export const NO_GROUPS_YET = 'No groups yet. Groups arrive from Entra ID through SCIM.';
/** Its local-mode variant: local mode has no groups (admin R74, ui.md 4.18.6). */
export const NO_GROUPS_LOCAL = 'No groups in local mode.';

/** The empty-directory copy for the server's mode. */
export const noGroupsYet = (isOrg: boolean): string =>
  isOrg ? NO_GROUPS_YET : NO_GROUPS_LOCAL;

/** The label of a role badge: `Data owner · <datasource>` names its datasource. */
export function roleBadgeLabel(role: RoleId, datasourceName?: string): string {
  return role === 'data-owner' && datasourceName
    ? `${ROLE_LABELS[role]} · ${datasourceName}`
    : ROLE_LABELS[role];
}
