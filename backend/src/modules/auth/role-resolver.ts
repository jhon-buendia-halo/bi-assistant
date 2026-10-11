import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ORG_SERVER_CONFIG,
  type OrgServerConfig,
} from '../../config/org-server.config';
import type { CurrentUser, HeldRole } from './entities/current-user.entity';
import type { UserDoc } from './entities/directory.entity';
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
 * A user's roles and permissions, resolved on every request (admin R18-R21;
 * api.md 2.13): the implicit User role, Platform admin for a bootstrap email,
 * their direct assignments and the roles mapped to their groups.
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

  isBootstrapAdmin(user: Pick<UserDoc, 'email' | 'userName'>): boolean {
    return [user.email, user.userName].some(
      (value) => !!value && this.bootstrapAdmins.has(value.toLowerCase()),
    );
  }

  async heldRoles(user: UserDoc): Promise<HeldRole[]> {
    const held: HeldRole[] = [{ role: 'user', source: 'implicit' }];
    if (this.isBootstrapAdmin(user)) {
      held.push({ role: 'platform-admin', source: 'bootstrap' });
    }
    for (const assignment of await this.roles.assignmentsOf(user.id)) {
      const role: HeldRole = {
        role: assignment.role,
        source: 'direct',
        assignmentId: assignment.id,
      };
      if (assignment.datasourceId) role.datasourceId = assignment.datasourceId;
      held.push(role);
    }
    const groupIds = await this.directory.groupIdsOf(user.id);
    for (const mapping of await this.roles.mappingsOf(groupIds)) {
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
