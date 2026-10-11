import {
  AdminGroupsPage,
  AdminOverview,
  AdminUserDetail,
  AdminUserRow,
  AdminUsersPage,
} from '../models/admin.models';

/** Unit-test data for the Admin area (api.md 2.15 shapes). */

const today = () => new Date().toISOString();

/** Eight empty weeks, oldest first, ending with the current week. */
export function emptyWeeks(): AdminOverview['weeklyActiveUsers'] {
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return Array.from({ length: 8 }, (_, i) => {
    const week = new Date(monday);
    week.setUTCDate(monday.getUTCDate() - (7 - i) * 7);
    return { weekStart: week.toISOString().slice(0, 10), users: 0 };
  });
}

export function overview(patch: Partial<AdminOverview> = {}): AdminOverview {
  return {
    generatedAt: today(),
    activeUsers30d: 0,
    agentsLive: 0,
    attention: {
      ownerlessAgents: { count: 0, items: [] },
      erroredAgents: { count: 0, items: [] },
      inactiveMakers: { count: 0, items: [] },
    },
    weeklyActiveUsers: emptyWeeks(),
    recentActivity: [],
    ...patch,
  };
}

export function userRow(patch: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: 'u-ada',
    displayName: 'Ada Lovelace',
    email: 'ada@contoso.test',
    initials: 'AL',
    roles: ['maker'],
    groups: ['Analysts'],
    agentsOwned: 0,
    lastActiveAt: today(),
    status: 'active',
    ...patch,
  };
}

export function usersPage(
  items: AdminUserRow[],
  patch: Partial<AdminUsersPage> = {},
): AdminUsersPage {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 25,
    counts: {
      users: items.length,
      groups: 2,
      platformAdmins: 1,
      approvers: 0,
      dataOwners: 0,
      makers: 1,
      inactive: 1,
    },
    lastSyncAt: null,
    ...patch,
  };
}

export function groupsPage(
  items: AdminGroupsPage['items'],
  patch: Partial<AdminGroupsPage> = {},
): AdminGroupsPage {
  return { items, total: items.length, page: 1, pageSize: 25, ...patch };
}

export function userDetail(patch: Partial<AdminUserDetail> = {}): AdminUserDetail {
  return {
    ...userRow(),
    heldRoles: [
      { role: 'user', source: 'implicit' },
      { role: 'maker', source: 'direct', assignmentId: 'ra-maker' },
    ],
    groupList: [{ id: 'g-analysts', displayName: 'Analysts' }],
    agents: [],
    isSelf: false,
    isBootstrap: false,
    ...patch,
  };
}
