import {
  AdminHeldRole,
  AdminUserDetail,
  AssignableRole,
  ROLE_DESCRIPTIONS,
  RoleGrant,
  roleBadgeLabel,
} from '../models/admin.models';

/**
 * The role checkboxes of the user detail panel and the direct assignments
 * they save (admin R59-R62, ui.md 4.18.4).
 */

/** One role checkbox: a role, or Data owner of one datasource. */
export interface RoleRow {
  /** `maker`, … or `data-owner:<datasource id>`. */
  key: string;
  role: AssignableRole;
  datasourceId?: string;
  label: string;
  description: string;
  /** The user holds it as a direct assignment (stored, api 79). */
  direct: boolean;
  /**
   * Held another way (a group mapping, the bootstrap list), or the
   * caller's own Platform admin: ticked, disabled, with `reason`.
   */
  locked: boolean;
  reason: string | null;
}

export const BOOTSTRAP_REASON = 'Bootstrap admin, set in the server configuration.';
/** Demo User's locked Platform admin in local mode (admin R60, R69, R74). */
export const LOCAL_BOOTSTRAP_REASON = 'Always a Platform admin in local mode.';
export const OWN_ADMIN_REASON = "You can't remove your own Platform admin role.";
export const NO_DATASOURCE_REASON = 'No other datasource to own.';
/** A Data owner assignment whose datasource was deleted (ui.md 4.18.4). */
export const REMOVED_DATASOURCE_LABEL = 'Data owner · datasource removed';
export const REMOVED_DATASOURCE_DESCRIPTION =
  'Its datasource no longer exists, so this role grants nothing. Untick it to remove it.';

/** The roles with one checkbox each, in panel order. */
const FIXED_ROLES: readonly AssignableRole[] = ['platform-admin', 'approver', 'maker'];

export const grantKey = (grant: RoleGrant): string =>
  grant.role === 'data-owner' ? `data-owner:${grant.datasourceId}` : grant.role;

function rowFor(
  role: AssignableRole,
  held: AdminHeldRole[],
  detail: AdminUserDetail,
  local: boolean,
  datasourceId?: string,
): RoleRow {
  const direct = held.some((h) => h.source === 'direct');
  const groups = [
    ...new Set(held.filter((h) => h.source === 'group').flatMap((h) => h.groupNames ?? [])),
  ].sort((a, b) => a.localeCompare(b));
  const fromGroup = held.some((h) => h.source === 'group');
  const reason = held.some((h) => h.source === 'bootstrap')
    ? local
      ? LOCAL_BOOTSTRAP_REASON
      : BOOTSTRAP_REASON
    : fromGroup
      ? `From group ${groups.join(', ')}`
      : role === 'platform-admin' && detail.isSelf && direct
        ? OWN_ADMIN_REASON
        : null;
  const datasourceName = held.find((h) => h.datasourceName)?.datasourceName ?? datasourceId;
  const missing = role === 'data-owner' && held.some((h) => h.datasourceMissing);
  return {
    key: grantKey({ role, datasourceId }),
    role,
    datasourceId,
    label: missing ? REMOVED_DATASOURCE_LABEL : roleBadgeLabel(role, datasourceName),
    description: missing ? REMOVED_DATASOURCE_DESCRIPTION : ROLE_DESCRIPTIONS[role],
    direct,
    locked: reason !== null,
    reason,
  };
}

/**
 * The checkboxes for a user: Platform admin, Approver and Maker, then one
 * `Data owner · <datasource>` per datasource they own from any source,
 * sorted by name (admin R59, R60, R61). `local`: the server runs in local
 * mode, where the bootstrap admin reads as Demo User's (R74).
 */
export function roleRows(detail: AdminUserDetail, local = false): RoleRow[] {
  const rows = FIXED_ROLES.map((role) =>
    rowFor(
      role,
      detail.heldRoles.filter((h) => h.role === role),
      detail,
      local,
    ),
  );
  const owned = detail.heldRoles.filter((h) => h.role === 'data-owner' && h.datasourceId);
  const datasourceIds = [...new Set(owned.map((h) => h.datasourceId!))];
  const dataOwner = datasourceIds
    .map((id) =>
      rowFor(
        'data-owner',
        owned.filter((h) => h.datasourceId === id),
        detail,
        local,
        id,
      ),
    )
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...rows, ...dataOwner];
}

/** What each checkbox shows when the panel opens: ticked when held at all. */
export function initialTicks(rows: readonly RoleRow[]): Set<string> {
  return new Set(rows.filter((row) => row.direct || row.locked).map((row) => row.key));
}

const grantOf = (row: RoleRow): RoleGrant =>
  row.role === 'data-owner'
    ? { role: row.role, datasourceId: row.datasourceId }
    : { role: row.role };

/** The direct assignments stored now. */
export function storedGrants(rows: readonly RoleRow[]): RoleGrant[] {
  return rows.filter((row) => row.direct).map(grantOf);
}

/**
 * The direct assignments **Save changes** sends (api 85): every unlocked
 * ticked row, every locked row's stored direct assignment, unchanged (R60),
 * and the new Data owner datasource when one is chosen.
 */
export function desiredGrants(
  rows: readonly RoleRow[],
  ticks: ReadonlySet<string>,
  newDatasourceId: string | null,
): RoleGrant[] {
  const grants = rows
    .filter((row) => (row.locked ? row.direct : ticks.has(row.key)))
    .map(grantOf);
  if (newDatasourceId) {
    const grant: RoleGrant = { role: 'data-owner', datasourceId: newDatasourceId };
    if (!grants.some((g) => grantKey(g) === grantKey(grant))) grants.push(grant);
  }
  return grants;
}

/** Whether two sets of grants are the same, whatever their order. */
export function sameGrants(a: readonly RoleGrant[], b: readonly RoleGrant[]): boolean {
  const keys = new Set(a.map(grantKey));
  return keys.size === new Set(b.map(grantKey)).size && b.every((g) => keys.has(grantKey(g)));
}

/**
 * Why **Save changes** is disabled, or null when it is enabled (R62):
 * a ticked Data owner without a datasource, or nothing changed.
 */
export function saveBlocker(
  rows: readonly RoleRow[],
  ticks: ReadonlySet<string>,
  addDataOwner: boolean,
  newDatasourceId: string,
): string | null {
  if (addDataOwner && !newDatasourceId) return 'Choose a datasource for Data owner';
  const desired = desiredGrants(rows, ticks, addDataOwner ? newDatasourceId : null);
  return sameGrants(desired, storedGrants(rows)) ? 'No changes to save' : null;
}
