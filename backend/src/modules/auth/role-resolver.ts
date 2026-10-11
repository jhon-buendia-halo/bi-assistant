import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ORG_SERVER_CONFIG,
  type OrgServerConfig,
} from '../../config/org-server.config';
import type { CurrentUser, HeldRole } from './entities/current-user.entity';
import type {
  GroupRoleMappingDoc,
  RoleAssignmentDoc,
  UserDoc,
} from './entities/directory.entity';
import { permissionsForRoles } from './permissions';
import { DirectoryRepository } from './repositories/directory.repository';
import { RolesRepository } from './repositories/roles.repository';

/**
 * Initials for the avatar (ui.md 1.3): the given and family names' first
 * letters; else the first two words of the display name; else the email's
 * first letter. Uppercase, at most two.
 */
export function initialsOf(user: {
  givenName?: string;
  familyName?: string;
  displayName?: string;
  email?: string | null;
}): string {
  const first = (value?: string) => value?.trim().charAt(0) ?? '';
  let initials = '';
  if (user.givenName?.trim() && user.familyName?.trim()) {
    initials = first(user.givenName) + first(user.familyName);
  } else {
    const words = (user.displayName ?? '').trim().split(/\s+/).filter(Boolean);
    initials = words.slice(0, 2).map(first).join('');
  }
  if (!initials) initials = first(user.email ?? '');
  return initials.toUpperCase().slice(0, 2);
}

/**
 * A user's held roles from what is stored (admin R20; api.md 2.13): the
 * implicit User role, Platform admin for a bootstrap admin, the direct
 * assignments, then the mappings of the user's groups. Pure, so the admin
 * screens resolve every user from one read of the directory.
 */
export function resolveHeldRoles(
  isBootstrap: boolean,
  assignments: readonly RoleAssignmentDoc[],
  groupMappings: readonly GroupRoleMappingDoc[],
): HeldRole[] {
  const held: HeldRole[] = [{ role: 'user', source: 'implicit' }];
  if (isBootstrap) held.push({ role: 'platform-admin', source: 'bootstrap' });
  for (const assignment of assignments) {
    const role: HeldRole = {
      role: assignment.role,
      source: 'direct',
      assignmentId: assignment.id,
    };
    if (assignment.datasourceId) role.datasourceId = assignment.datasourceId;
    held.push(role);
  }
  for (const mapping of groupMappings) {
    const role: HeldRole = {
      role: mapping.role,
      source: 'group',
      groupId: mapping.groupId,
    };
    if (mapping.datasourceId) role.datasourceId = mapping.datasourceId;
    held.push(role);
  }
  return held;
}

/**
 * A user's roles and permissions, resolved on every request (admin R18-R21;
 * api.md 2.13): the implicit User role, Platform admin for a bootstrap user
 * name, their direct assignments and the roles mapped to their groups.
 */
@Injectable()
export class RoleResolver {
  private readonly bootstrapAdmins: Set<string>;

  constructor(
    private readonly directory: DirectoryRepository,
    private readonly roles: RolesRepository,
    @Optional()
    @Inject(ORG_SERVER_CONFIG)
    config: OrgServerConfig | null = null,
  ) {
    this.bootstrapAdmins = new Set(config?.bootstrapAdmins ?? []);
  }

  /**
   * By user name (the UPN) only, case-insensitively, never by email: the
   * email can come from an unverified claim (admin R18; non-functional N77).
   */
  isBootstrapAdmin(user: Pick<UserDoc, 'userName'>): boolean {
    return this.bootstrapAdmins.has(user.userName.trim().toLowerCase());
  }

  async heldRoles(user: UserDoc): Promise<HeldRole[]> {
    const groupIds = await this.directory.groupIdsOf(user.id);
    return resolveHeldRoles(
      this.isBootstrapAdmin(user),
      await this.roles.assignmentsOf(user.id),
      await this.roles.mappingsOf(groupIds),
    );
  }

  /** The user a request runs as. */
  async currentUserFor(user: UserDoc): Promise<CurrentUser> {
    const roles = await this.heldRoles(user);
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email ?? null,
      initials: initialsOf(user),
      roles,
      permissions: permissionsForRoles(roles.map((r) => r.role)),
    };
  }
}
