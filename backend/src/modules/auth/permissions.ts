/**
 * The fixed roles and permissions of the app (specs/capabilities/admin/spec.md
 * R19-R21; ids and wire shapes in specs/system/api.md 2.13). The matrix is
 * not configurable: roles cannot be added, renamed or removed.
 */

export const PERMISSION_IDS = [
  'use-agents',
  'create-agents',
  'share-agents-team',
  'request-publishing',
  'approve-publishing',
  'approve-datasource-access',
  'manage-users',
  'edit-policies',
  'view-audit-log',
  'manage-datasources',
  'manage-llm',
] as const;

export type PermissionId = (typeof PERMISSION_IDS)[number];

export const ROLE_IDS = [
  'user',
  'maker',
  'data-owner',
  'approver',
  'platform-admin',
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

/** Human labels, in the order of the matrix (admin R21). */
export const PERMISSION_LABELS: Readonly<Record<PermissionId, string>> = {
  'use-agents': 'Use agents in the gallery and chat',
  'create-agents': 'Create, test and version agents',
  'share-agents-team': 'Share agents with own team',
  'request-publishing': 'Request org-wide publishing',
  'approve-publishing': 'Approve org-wide publishing',
  'approve-datasource-access': 'Approve access to a data source',
  'manage-users': 'Manage users, roles and group mappings',
  'edit-policies': 'Edit policies and templates',
  'view-audit-log': 'View audit log',
  'manage-datasources': 'Manage datasources and datasets',
  'manage-llm': 'Manage LLM configuration',
};

export const ROLE_LABELS: Readonly<Record<RoleId, string>> = {
  user: 'User',
  maker: 'Maker',
  'data-owner': 'Data owner',
  approver: 'Approver',
  'platform-admin': 'Platform admin',
};

/** The permission matrix (admin R21): which permissions each role grants. */
export const ROLE_PERMISSIONS: Readonly<
  Record<RoleId, readonly PermissionId[]>
> = {
  user: ['use-agents'],
  maker: [
    'use-agents',
    'create-agents',
    'share-agents-team',
    'request-publishing',
  ],
  'data-owner': ['use-agents', 'approve-datasource-access'],
  approver: ['use-agents', 'approve-publishing', 'view-audit-log'],
  'platform-admin': [...PERMISSION_IDS],
};

export function isPermissionId(value: unknown): value is PermissionId {
  return (
    typeof value === 'string' &&
    (PERMISSION_IDS as readonly string[]).includes(value)
  );
}

/**
 * The union of the given roles' permissions, sorted and de-duplicated (the
 * order `GET /me` answers with). Roles are additive (admin R20).
 */
export function permissionsForRoles(roles: Iterable<RoleId>): PermissionId[] {
  const held = new Set<PermissionId>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) held.add(permission);
  }
  return [...held].sort();
}
