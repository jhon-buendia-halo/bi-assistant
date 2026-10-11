import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ORG_SERVER_CONFIG,
  type OrgServerConfig,
} from '../../config/org-server.config';
import { CONNECTIONS_STORE } from '../../infrastructure/database/doc-store';
import type { DocStore } from '../../infrastructure/database/doc-store';
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
 *
 * A Data owner assignment or mapping whose datasource no longer exists
 * grants nothing (data-model 3.13) and is left out. Only the admin detail
 * asks for the dangling direct assignments too (`includeDanglingAssignments`,
 * api.md 84), flagged `datasourceMissing`, so an admin can remove them.
 */
export function resolveHeldRoles(
  isBootstrap: boolean,
  assignments: readonly RoleAssignmentDoc[],
  groupMappings: readonly GroupRoleMappingDoc[],
  datasourceExists: (id: string) => boolean,
  options: { includeDanglingAssignments?: boolean } = {},
): HeldRole[] {
  const dangling = (datasourceId?: string) =>
    datasourceId !== undefined && !datasourceExists(datasourceId);
  const held: HeldRole[] = [{ role: 'user', source: 'implicit' }];
  if (isBootstrap) held.push({ role: 'platform-admin', source: 'bootstrap' });
  for (const assignment of assignments) {
    const missing = dangling(assignment.datasourceId);
    if (missing && !options.includeDanglingAssignments) continue;
    const role: HeldRole = {
      role: assignment.role,
      source: 'direct',
      assignmentId: assignment.id,
    };
    if (assignment.datasourceId) role.datasourceId = assignment.datasourceId;
    if (missing) role.datasourceMissing = true;
    held.push(role);
  }
  for (const mapping of groupMappings) {
    if (dangling(mapping.datasourceId)) continue;
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
    @Inject(CONNECTIONS_STORE)
    private readonly connections: DocStore<{ id: string }>,
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
    const assignments = await this.roles.assignmentsOf(user.id);
    const mappings = await this.roles.mappingsOf(groupIds);
    return resolveHeldRoles(
      this.isBootstrapAdmin(user),
      assignments,
      mappings,
      await this.datasourceCheck([...assignments, ...mappings]),
    );
  }

  /**
   * Whether a datasource exists, for the Data owner roles among `held`.
   * Reads the datasources only when one of them names one.
   */
  private async datasourceCheck(
    held: readonly { datasourceId?: string }[],
  ): Promise<(id: string) => boolean> {
    if (!held.some((r) => r.datasourceId)) return () => true;
    const ids = new Set((await this.connections.find()).map((c) => c.id));
    return (id) => ids.has(id);
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
