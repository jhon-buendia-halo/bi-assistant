import { BadRequestException, Injectable } from '@nestjs/common';
import { ActivityService } from '../auth/activity.service';
import type { AssignableRoleId } from '../auth/entities/directory.entity';
import { AdminDirectoryReader } from './admin-directory.reader';
import { byName, ROLE_BADGE_ORDER } from './admin-figures';
import type {
  AdminGroupMappingRef,
  AdminGroupsPage,
  AdminUserRow,
  AdminUsersPage,
} from './entities/admin-views.entity';

/** The Users view's filter chips (admin R51; api.md 83). */
const USER_FILTERS = [
  'all',
  'platform-admin',
  'approver',
  'data-owner',
  'maker',
  'inactive',
] as const;
type UserFilter = (typeof USER_FILTERS)[number];

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** A query parameter as one string (a repeated one counts as its first). */
function param(value: unknown): string | undefined {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : undefined;
}

/** `page` (1-based) and `pageSize` (1-100), as api.md 83 validates them. */
function paging(query: Record<string, unknown>): {
  page: number;
  pageSize: number;
} {
  const page = param(query.page);
  const pageSize = param(query.pageSize);
  if (page && !(/^\d+$/.test(page) && Number(page) >= 1)) {
    throw new BadRequestException('page must be a positive integer');
  }
  if (
    pageSize &&
    !(
      /^\d+$/.test(pageSize) &&
      Number(pageSize) >= 1 &&
      Number(pageSize) <= MAX_PAGE_SIZE
    )
  ) {
    throw new BadRequestException(
      `pageSize must be between 1 and ${MAX_PAGE_SIZE}`,
    );
  }
  return {
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Number(pageSize) : DEFAULT_PAGE_SIZE,
  };
}

/** The trimmed, lowercased search; `''` for none (admin R50). */
const search = (query: Record<string, unknown>) =>
  (param(query.q) ?? '').trim().toLowerCase();

function pageOf<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice((page - 1) * pageSize, page * pageSize);
}

const roleOrder = (role: AssignableRoleId) => ROLE_BADGE_ORDER.indexOf(role);

/**
 * The admin area's reads of the directory (admin R49-R60, R66; api.md 83,
 * 84, 87, 88). Every figure is derived on each call (data-model 3.14.8).
 */
@Injectable()
export class AdminReadService {
  constructor(
    private readonly reader: AdminDirectoryReader,
    private readonly activity: ActivityService,
  ) {}

  /** 83. */
  async listUsers(query: Record<string, unknown>): Promise<AdminUsersPage> {
    const filter = (param(query.filter) || 'all') as UserFilter;
    if (!USER_FILTERS.includes(filter)) {
      throw new BadRequestException(`Unknown filter: ${filter}`);
    }
    const { page, pageSize } = paging(query);
    const q = search(query);
    const excludeDeactivated = param(query.excludeDeactivated) === 'true';

    const snapshot = await this.reader.load();
    const rows = snapshot.users
      .map((user) => snapshot.row(user))
      .sort(
        (a, b) =>
          byName(a.displayName, b.displayName) ||
          byName(a.email ?? '', b.email ?? '') ||
          byName(a.id, b.id),
      );
    const holding = (role: AssignableRoleId) => (row: AdminUserRow) =>
      row.roles.includes(role);
    const inactive = (row: AdminUserRow) => row.status === 'inactive';
    const keep: Record<UserFilter, (row: AdminUserRow) => boolean> = {
      all: () => true,
      'platform-admin': holding('platform-admin'),
      approver: holding('approver'),
      'data-owner': holding('data-owner'),
      maker: holding('maker'),
      inactive,
    };
    const matches = (row: AdminUserRow) =>
      !q ||
      [row.displayName, row.email ?? '', ...row.groups].some((text) =>
        text.toLowerCase().includes(q),
      );
    const listed = rows.filter(
      (row) =>
        (!excludeDeactivated || row.status !== 'deactivated') &&
        keep[filter](row) &&
        matches(row),
    );
    return {
      items: pageOf(listed, page, pageSize),
      total: listed.length,
      page,
      pageSize,
      counts: {
        users: rows.length,
        groups: snapshot.groups.length,
        platformAdmins: rows.filter(keep['platform-admin']).length,
        approvers: rows.filter(keep.approver).length,
        dataOwners: rows.filter(keep['data-owner']).length,
        makers: rows.filter(keep.maker).length,
        inactive: rows.filter(inactive).length,
      },
      lastSyncAt: await this.activity.newestAt('scim.request'),
    };
  }

  /** 87. */
  async listGroups(query: Record<string, unknown>): Promise<AdminGroupsPage> {
    const { page, pageSize } = paging(query);
    const q = search(query);
    const snapshot = await this.reader.load();
    const listed = snapshot.groups
      .filter((g) => !q || g.displayName.toLowerCase().includes(q))
      .map((group) => ({
        id: group.id,
        displayName: group.displayName,
        members: snapshot.memberCount(group.id),
        mappings: snapshot.mappings
          .filter((m) => m.groupId === group.id)
          .map((m): AdminGroupMappingRef => ({
            role: m.role,
            ...(m.datasourceId
              ? {
                  datasourceId: m.datasourceId,
                  datasourceName: snapshot.datasourceName(m.datasourceId),
                }
              : {}),
          }))
          .sort(
            (a, b) =>
              roleOrder(a.role) - roleOrder(b.role) ||
              byName(a.datasourceName ?? '', b.datasourceName ?? ''),
          ),
      }));
    return {
      items: pageOf(listed, page, pageSize),
      total: listed.length,
      page,
      pageSize,
    };
  }
}
