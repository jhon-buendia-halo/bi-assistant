import { Inject, Injectable } from '@nestjs/common';
import { CONNECTIONS_STORE } from '../../infrastructure/database/doc-store';
import type { DocStore } from '../../infrastructure/database/doc-store';
import type { HeldRole } from '../auth/entities/current-user.entity';
import type {
  AssignableRoleId,
  GroupDoc,
  GroupMemberDoc,
  GroupRoleMappingDoc,
  RoleAssignmentDoc,
  UserDoc,
} from '../auth/entities/directory.entity';
import { DirectoryRepository } from '../auth/repositories/directory.repository';
import { RolesRepository } from '../auth/repositories/roles.repository';
import {
  initialsOf,
  resolveHeldRoles,
  RoleResolver,
} from '../auth/role-resolver';
import type { UserAgentDoc } from '../user-agents/entities/user-agent.entity';
import type { ActivityNames } from './activity-sentences';
import {
  agentNameOf,
  byName,
  lastActiveAtOf,
  ROLE_BADGE_ORDER,
  statusOf,
} from './admin-figures';
import type {
  AdminHeldRole,
  AdminUserRow,
  GroupRoleMappingView,
} from './entities/admin-views.entity';
import { AllOwnersAgentsRepository } from './repositories/all-owners-agents.repository';

/** What the admin screens read of a datasource: its name. */
export interface DatasourceRef {
  id: string;
  name?: string;
}

interface SnapshotInput {
  now: Date;
  users: UserDoc[];
  groups: GroupDoc[];
  memberships: GroupMemberDoc[];
  assignments: RoleAssignmentDoc[];
  mappings: GroupRoleMappingDoc[];
  /** Agents that have an owner (admin R33). */
  agents: UserAgentDoc[];
  datasources: DatasourceRef[];
  isBootstrap: (user: UserDoc) => boolean;
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/**
 * The directory, roles and agents as one read, with the derivations of
 * data-model 3.14.8 over it. Each admin request loads one and answers from
 * it, so a page of users costs one read of each collection, not one per row.
 */
export class AdminSnapshot {
  readonly now: Date;
  readonly users: UserDoc[];
  /** Sorted by name. */
  readonly groups: GroupDoc[];
  readonly mappings: GroupRoleMappingDoc[];
  readonly agents: UserAgentDoc[];
  private readonly usersById: Map<string, UserDoc>;
  private readonly groupsById: Map<string, GroupDoc>;
  private readonly agentsById: Map<string, UserAgentDoc>;
  private readonly groupIdsByUser = new Map<string, string[]>();
  private readonly memberCounts = new Map<string, number>();
  private readonly assignmentsByUser = new Map<string, RoleAssignmentDoc[]>();
  private readonly agentsByOwner = new Map<string, UserAgentDoc[]>();
  private readonly datasourceNames: Map<string, string>;
  private readonly bootstrap: (user: UserDoc) => boolean;
  private readonly held = new Map<string, HeldRole[]>();

  constructor(input: SnapshotInput) {
    this.now = input.now;
    this.users = input.users;
    this.groups = [...input.groups].sort((a, b) =>
      byName(a.displayName, b.displayName),
    );
    this.mappings = input.mappings;
    this.agents = input.agents;
    this.bootstrap = input.isBootstrap;
    this.usersById = new Map(input.users.map((u) => [u.id, u]));
    this.groupsById = new Map(input.groups.map((g) => [g.id, g]));
    this.agentsById = new Map(input.agents.map((a) => [a.id, a]));
    this.datasourceNames = new Map(
      input.datasources.map((d) => [d.id, d.name ?? d.id]),
    );
    for (const m of input.memberships) {
      if (!this.groupsById.has(m.groupId)) continue;
      push(this.groupIdsByUser, m.userId, m.groupId);
      this.memberCounts.set(
        m.groupId,
        (this.memberCounts.get(m.groupId) ?? 0) + 1,
      );
    }
    for (const a of input.assignments)
      push(this.assignmentsByUser, a.userId, a);
    for (const a of input.agents) push(this.agentsByOwner, a.ownerId!, a);
  }

  user(id: string | undefined): UserDoc | undefined {
    return id === undefined ? undefined : this.usersById.get(id);
  }

  group(id: string | undefined): GroupDoc | undefined {
    return id === undefined ? undefined : this.groupsById.get(id);
  }

  agent(id: string | undefined): UserAgentDoc | undefined {
    return id === undefined ? undefined : this.agentsById.get(id);
  }

  /** The user's groups, sorted by name. */
  groupsOf(userId: string): GroupDoc[] {
    return (this.groupIdsByUser.get(userId) ?? [])
      .map((id) => this.groupsById.get(id)!)
      .sort((a, b) => byName(a.displayName, b.displayName));
  }

  memberCount(groupId: string): number {
    return this.memberCounts.get(groupId) ?? 0;
  }

  assignmentsOf(userId: string): RoleAssignmentDoc[] {
    return this.assignmentsByUser.get(userId) ?? [];
  }

  /** The user's agents, sorted by name. */
  agentsOf(userId: string): UserAgentDoc[] {
    return [...(this.agentsByOwner.get(userId) ?? [])].sort((a, b) =>
      byName(agentNameOf(a), agentNameOf(b)),
    );
  }

  isBootstrap(user: UserDoc): boolean {
    return this.bootstrap(user);
  }

  /** The datasource's current name, or its id when it no longer exists. */
  datasourceName(id: string): string {
    return this.datasourceNames.get(id) ?? id;
  }

  /** As `GET /me` resolves them (admin R20). */
  heldRoles(user: UserDoc): HeldRole[] {
    let held = this.held.get(user.id);
    if (!held) {
      const groupIds = new Set(this.groupIdsByUser.get(user.id) ?? []);
      held = resolveHeldRoles(
        this.bootstrap(user),
        this.assignmentsOf(user.id),
        this.mappings.filter((m) => groupIds.has(m.groupId)),
        (id) => this.datasourceNames.has(id),
      );
      this.held.set(user.id, held);
    }
    return held;
  }

  /**
   * Held roles with their names (api.md 84). A role mapped from several of
   * the user's groups appears once per role and datasource, with every
   * group's name; its `groupId` is the first of them by name. A direct Data
   * owner assignment whose datasource is gone is listed with
   * `datasourceMissing`, though it grants nothing.
   */
  adminHeldRoles(user: UserDoc): AdminHeldRole[] {
    const out: AdminHeldRole[] = [];
    const fromGroups = new Map<
      string,
      { entry: AdminHeldRole; groups: GroupDoc[] }
    >();
    // Unlike `heldRoles`, also the direct Data owner assignments whose
    // datasource is gone, flagged, so the admin can remove them (api.md 84).
    const groupIds = new Set(this.groupIdsByUser.get(user.id) ?? []);
    const listed = resolveHeldRoles(
      this.bootstrap(user),
      this.assignmentsOf(user.id),
      this.mappings.filter((m) => groupIds.has(m.groupId)),
      (id) => this.datasourceNames.has(id),
      { includeDanglingAssignments: true },
    );
    for (const held of listed) {
      const entry: AdminHeldRole = { ...held };
      if (held.datasourceId) {
        entry.datasourceName = this.datasourceName(held.datasourceId);
      }
      if (held.source !== 'group') {
        out.push(entry);
        continue;
      }
      const group = this.group(held.groupId) ?? {
        id: held.groupId!,
        displayName: held.groupId!,
      };
      const key = `${held.role}|${held.datasourceId ?? ''}`;
      const seen = fromGroups.get(key);
      if (seen) {
        seen.groups.push(group);
        continue;
      }
      fromGroups.set(key, { entry, groups: [group] });
      out.push(entry);
    }
    for (const { entry, groups } of fromGroups.values()) {
      groups.sort((a, b) => byName(a.displayName, b.displayName));
      entry.groupId = groups[0].id;
      entry.groupNames = groups.map((g) => g.displayName);
    }
    return out;
  }

  /** Every role held but User, each once, in badge order (admin R52). */
  roleIds(user: UserDoc): AssignableRoleId[] {
    const held = new Set(this.heldRoles(user).map((r) => r.role));
    return ROLE_BADGE_ORDER.filter((role) => held.has(role));
  }

  holds(user: UserDoc, role: AssignableRoleId): boolean {
    return this.heldRoles(user).some((r) => r.role === role);
  }

  row(user: UserDoc): AdminUserRow {
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email ?? null,
      initials: initialsOf(user),
      roles: this.roleIds(user),
      groups: this.groupsOf(user.id).map((g) => g.displayName),
      agentsOwned: this.agentsByOwner.get(user.id)?.length ?? 0,
      lastActiveAt: lastActiveAtOf(user),
      status: statusOf(user, this.now),
    };
  }

  mappingView(mapping: GroupRoleMappingDoc): GroupRoleMappingView {
    return {
      ...mapping,
      groupName: this.group(mapping.groupId)?.displayName ?? 'a deleted group',
      ...(mapping.datasourceId
        ? { datasourceName: this.datasourceName(mapping.datasourceId) }
        : {}),
    };
  }

  /** How ids read in Recent activity (data-model 3.14.7). */
  names(): ActivityNames {
    return {
      user: (id) => this.user(id)?.displayName ?? 'a deleted user',
      group: (id) => this.group(id)?.displayName ?? 'a deleted group',
      agent: (id, fallback) => {
        const agent = this.agent(id);
        return agent ? agentNameOf(agent) : fallback || 'a deleted agent';
      },
      datasource: (id) => (id ? this.datasourceName(id) : ''),
    };
  }
}

/** Loads an `AdminSnapshot`: one read of each collection the admin area needs. */
@Injectable()
export class AdminDirectoryReader {
  constructor(
    private readonly directory: DirectoryRepository,
    private readonly roles: RolesRepository,
    private readonly agents: AllOwnersAgentsRepository,
    @Inject(CONNECTIONS_STORE)
    private readonly connections: DocStore<DatasourceRef>,
    private readonly resolver: RoleResolver,
  ) {}

  async load(now = new Date()): Promise<AdminSnapshot> {
    const [
      users,
      groups,
      memberships,
      assignments,
      mappings,
      agents,
      datasources,
    ] = await Promise.all([
      this.directory.allUsers(),
      this.directory.allGroups(),
      this.directory.allMemberships(),
      this.roles.allAssignments(),
      this.roles.allMappings(),
      this.agents.owned(),
      this.connections.find(),
    ]);
    return new AdminSnapshot({
      now,
      users,
      groups,
      memberships,
      assignments,
      mappings,
      agents,
      datasources,
      isBootstrap: (user) => this.resolver.isBootstrapAdmin(user),
    });
  }

  /** The datasource with this id, if it exists. */
  datasource(id: string): Promise<DatasourceRef | null> {
    return this.connections.findOne({ id });
  }
}
