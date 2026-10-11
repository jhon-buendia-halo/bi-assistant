import type { HeldRole } from '../../auth/entities/current-user.entity';
import type {
  AssignableRoleId,
  GroupRoleMappingDoc,
} from '../../auth/entities/directory.entity';

/**
 * The wire shapes of the admin API (api.md 2.15). Nothing here is stored:
 * every figure is derived when an endpoint is called (data-model 3.14.8).
 */

/** Admin R39. */
export type UserStatus =
  'active' | 'inactive' | 'not-signed-in' | 'deactivated';

export interface UserRef {
  id: string;
  displayName: string;
}

/** One row of the users table (admin R52; api.md 83). */
export interface AdminUserRow {
  id: string;
  displayName: string;
  email: string | null;
  initials: string;
  /** Distinct, every source, in badge order; `[]` = the User role only. */
  roles: AssignableRoleId[];
  /** Group display names, sorted. */
  groups: string[];
  agentsOwned: number;
  /** Admin R39; `null` = never signed in. */
  lastActiveAt: string | null;
  status: UserStatus;
}

/** A held role with the names the panel shows (api.md 2.15). */
export interface AdminHeldRole extends HeldRole {
  /** Data owner only: the datasource's current name, or its id if gone. */
  datasourceName?: string;
  /** Source `group`: every group that maps this role (and datasource). */
  groupNames?: string[];
}

/** `GET /admin/users/:id` (api.md 84). */
export interface AdminUserDetail extends AdminUserRow {
  heldRoles: AdminHeldRole[];
  groupList: UserRef[];
  agents: { id: string; name: string; status: 'live' | 'draft' }[];
  isSelf: boolean;
  isBootstrap: boolean;
}

export interface AdminUsersPage {
  items: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: {
    users: number;
    groups: number;
    platformAdmins: number;
    approvers: number;
    dataOwners: number;
    makers: number;
    inactive: number;
  };
  lastSyncAt: string | null;
}

export interface AdminGroupMappingRef {
  role: AssignableRoleId;
  datasourceId?: string;
  datasourceName?: string;
}

export interface AdminGroupRow {
  id: string;
  displayName: string;
  members: number;
  mappings: AdminGroupMappingRef[];
}

export interface AdminGroupsPage {
  items: AdminGroupRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** `GET /admin/role-mappings` (api.md 88). */
export type GroupRoleMappingView = GroupRoleMappingDoc & {
  groupName: string;
  datasourceName?: string;
};

/** One Recent activity line (admin R47). */
export interface ActivityItem {
  id: string;
  type: string;
  at: string;
  text: string;
}

export interface WeeklyActiveUsers {
  /** The Monday, `YYYY-MM-DD` (UTC). */
  weekStart: string;
  users: number;
}

/** `GET /admin/overview` (api.md 81). */
export interface AdminOverview {
  generatedAt: string;
  activeUsers30d: number;
  agentsLive: number;
  attention: {
    ownerlessAgents: {
      count: number;
      items: {
        agentId: string;
        agentName: string;
        formerOwner: UserRef | null;
      }[];
    };
    erroredAgents: {
      count: number;
      items: {
        agentId: string;
        agentName: string;
        owner: UserRef;
        errors: number;
        lastErrorAt: string;
        lastErrorMessage: string;
      }[];
    };
    inactiveMakers: {
      count: number;
      items: {
        user: UserRef;
        lastActiveAt: string;
        makerAssignmentId: string | null;
        makerGroups: string[];
      }[];
    };
  };
  weeklyActiveUsers: WeeklyActiveUsers[];
  recentActivity: ActivityItem[];
}
