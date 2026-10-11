import {
  PERMISSION_IDS,
  ROLE_IDS,
  ROLE_PERMISSIONS,
  isPermissionId,
  permissionsForRoles,
  type PermissionId,
  type RoleId,
} from './permissions';

/** The exact matrix of admin R21, one row per permission. */
const MATRIX: Record<PermissionId, RoleId[]> = {
  'use-agents': ['user', 'maker', 'data-owner', 'approver', 'platform-admin'],
  'create-agents': ['maker', 'platform-admin'],
  'share-agents-team': ['maker', 'platform-admin'],
  'request-publishing': ['maker', 'platform-admin'],
  'approve-publishing': ['approver', 'platform-admin'],
  'approve-datasource-access': ['data-owner', 'platform-admin'],
  'manage-users': ['platform-admin'],
  'edit-policies': ['platform-admin'],
  'view-audit-log': ['approver', 'platform-admin'],
  'manage-datasources': ['platform-admin'],
  'manage-llm': ['platform-admin'],
};

describe('permission matrix', () => {
  it('has the eleven permissions and five roles of admin R19 and R21', () => {
    expect(PERMISSION_IDS).toHaveLength(11);
    expect([...PERMISSION_IDS].sort()).toEqual(Object.keys(MATRIX).sort());
    expect(ROLE_IDS).toEqual([
      'user',
      'maker',
      'data-owner',
      'approver',
      'platform-admin',
    ]);
  });

  it.each(PERMISSION_IDS.map((permission) => [permission]))(
    '%s is granted by exactly the roles of the matrix',
    (permission) => {
      const granting = ROLE_IDS.filter((role) =>
        ROLE_PERMISSIONS[role].includes(permission),
      );
      expect(granting).toEqual(MATRIX[permission]);
    },
  );

  it('unions roles into a sorted, de-duplicated permission list', () => {
    expect(permissionsForRoles(['user'])).toEqual(['use-agents']);
    expect(permissionsForRoles(['user', 'maker', 'approver'])).toEqual([
      'approve-publishing',
      'create-agents',
      'request-publishing',
      'share-agents-team',
      'use-agents',
      'view-audit-log',
    ]);
    expect(permissionsForRoles(['platform-admin'])).toEqual(
      [...PERMISSION_IDS].sort(),
    );
    expect(permissionsForRoles([])).toEqual([]);
  });

  it('recognises permission ids', () => {
    expect(isPermissionId('manage-llm')).toBe(true);
    expect(isPermissionId('manage-everything')).toBe(false);
    expect(isPermissionId(undefined)).toBe(false);
  });
});
