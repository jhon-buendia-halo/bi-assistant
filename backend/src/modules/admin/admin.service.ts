import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CONNECTIONS_STORE,
  DOC_STORE_TRANSACTIONS,
} from '../../infrastructure/database/doc-store';
import type {
  DocStore,
  DocStoreTransactions,
} from '../../infrastructure/database/doc-store';
import { ActivityService } from '../auth/activity.service';
import type {
  AssignableRoleId,
  RoleAssignmentDoc,
  UserDoc,
} from '../auth/entities/directory.entity';
import { ROLE_IDS } from '../auth/permissions';
import { DirectoryRepository } from '../auth/repositories/directory.repository';
import { RolesRepository } from '../auth/repositories/roles.repository';
import type { UserAgentDoc } from '../user-agents/entities/user-agent.entity';
import {
  AdminDirectoryReader,
  type DatasourceRef,
} from './admin-directory.reader';
import { agentNameOf, countOf, isDeactivated } from './admin-figures';
import type { AssignRoleDto } from './dto/assign-role.dto';
import type { SaveUserRolesDto } from './dto/save-user-roles.dto';
import type { TransferAgentsDto } from './dto/transfer-agents.dto';
import type { AdminHeldRole } from './entities/admin-views.entity';
import { AllOwnersAgentsRepository } from './repositories/all-owners-agents.repository';

/** A role to assign or map, validated (api.md 79). */
interface RoleSpec {
  role: AssignableRoleId;
  datasourceId?: string;
}

const MAX_TRANSFER = 100;

const specKey = (spec: { role: string; datasourceId?: string }) =>
  `${spec.role}|${spec.datasourceId ?? ''}`;

const specDetails = (spec: RoleSpec) => ({
  role: spec.role,
  ...(spec.datasourceId ? { datasourceId: spec.datasourceId } : {}),
});

/**
 * The rules every assignment and mapping follow (api.md 79, 85, 89): a known
 * role but the implicit User, and a datasource for Data owner only.
 */
function roleSpecOf(input: {
  role?: unknown;
  datasourceId?: unknown;
}): RoleSpec {
  const role = input?.role;
  if (!(ROLE_IDS as readonly unknown[]).includes(role)) {
    throw new BadRequestException(`Unknown role: ${String(role)}`);
  }
  if (role === 'user') {
    throw new BadRequestException('The User role is implicit');
  }
  const datasourceId =
    typeof input.datasourceId === 'string' && input.datasourceId.trim()
      ? input.datasourceId.trim()
      : undefined;
  if (role === 'data-owner' && !datasourceId) {
    throw new BadRequestException('Data owner needs a datasource');
  }
  if (role !== 'data-owner' && datasourceId) {
    throw new BadRequestException('Only Data owner takes a datasource');
  }
  return {
    role: role as AssignableRoleId,
    ...(datasourceId ? { datasourceId } : {}),
  };
}

/**
 * The admin area's writes (admin R22, R45, R61-R64; api.md 79, 80, 85,
 * 86). Each validates everything before it writes, then writes and records
 * its activity events in one transaction, so a request changes all it
 * should or nothing.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly directory: DirectoryRepository,
    private readonly roles: RolesRepository,
    private readonly activity: ActivityService,
    @Inject(CONNECTIONS_STORE)
    private readonly connections: DocStore<DatasourceRef>,
    private readonly agents: AllOwnersAgentsRepository,
    @Inject(DOC_STORE_TRANSACTIONS)
    private readonly transactions: DocStoreTransactions,
    private readonly reader: AdminDirectoryReader,
  ) {}

  /** 79. `created: false` when the user already held the same assignment. */
  async assignRole(
    dto: AssignRoleDto,
    adminId: string,
  ): Promise<{ created: boolean; assignment: RoleAssignmentDoc }> {
    const spec = roleSpecOf(dto);
    const userId = typeof dto.userId === 'string' ? dto.userId : '';
    if (!userId || !(await this.directory.userById(userId))) {
      throw new NotFoundException(`User ${String(dto.userId)} not found`);
    }
    if (spec.datasourceId) await this.requireDatasource(spec.datasourceId);

    const existing = await this.roles.findAssignment(
      userId,
      spec.role,
      spec.datasourceId,
    );
    if (existing) return { created: false, assignment: existing };

    const assignment = await this.transactions.run(async () => {
      const inserted = await this.roles.insertAssignment({
        userId,
        ...specDetails(spec),
        assignedBy: adminId,
      });
      await this.activity.record('role.assigned', {
        actorId: adminId,
        subjectId: userId,
        details: specDetails(spec),
      });
      return inserted;
    });
    return { created: true, assignment };
  }

  /** 80. */
  async removeAssignment(id: string, adminId: string): Promise<void> {
    const assignment = await this.roles.assignmentById(id);
    if (!assignment) {
      throw new NotFoundException(`Role assignment ${id} not found`);
    }
    // Decided with the user on 2026-10-10 (admin R61).
    if (assignment.userId === adminId && assignment.role === 'platform-admin') {
      throw new BadRequestException(
        "You can't remove your own Platform admin role",
      );
    }
    await this.transactions.run(async () => {
      await this.roles.deleteAssignment(id);
      await this.activity.record('role.removed', {
        actorId: adminId,
        subjectId: assignment.userId,
        details: specDetails(assignment),
      });
    });
  }

  /**
   * 85: replace the user's direct assignments with `dto.roles`, all at once
   * (admin R62). Roles from groups or the bootstrap list are not touched.
   * A Data owner assignment already stored is kept even when its datasource
   * is gone; only a new one must name an existing datasource.
   */
  async saveUserRoles(
    userId: string,
    dto: SaveUserRolesDto,
    adminId: string,
  ): Promise<{
    message: string;
    added: number;
    removed: number;
    heldRoles: AdminHeldRole[];
  }> {
    const user = await this.requireUser(userId);
    const entries: unknown = dto?.roles;
    if (!Array.isArray(entries)) {
      throw new BadRequestException('roles must be a list');
    }
    const wanted = new Map<string, RoleSpec>();
    for (const entry of entries) {
      const spec = roleSpecOf(entry as { role?: unknown });
      wanted.set(specKey(spec), spec);
    }
    const current = await this.roles.assignmentsOf(user.id);
    const currentKeys = new Set(current.map(specKey));
    const toAdd = [...wanted.values()].filter(
      (spec) => !currentKeys.has(specKey(spec)),
    );
    const toRemove = current.filter((a) => !wanted.has(specKey(a)));
    for (const spec of toAdd) {
      if (spec.datasourceId) await this.requireDatasource(spec.datasourceId);
    }
    // Decided with the user on 2026-10-10 (admin R61).
    if (
      user.id === adminId &&
      toRemove.some((a) => a.role === 'platform-admin')
    ) {
      throw new BadRequestException(
        "You can't remove your own Platform admin role",
      );
    }

    if (toAdd.length || toRemove.length) {
      await this.transactions.run(async () => {
        for (const assignment of toRemove) {
          await this.roles.deleteAssignment(assignment.id);
          await this.activity.record('role.removed', {
            actorId: adminId,
            subjectId: user.id,
            details: specDetails(assignment),
          });
        }
        for (const spec of toAdd) {
          await this.roles.insertAssignment({
            userId: user.id,
            ...specDetails(spec),
            assignedBy: adminId,
          });
          await this.activity.record('role.assigned', {
            actorId: adminId,
            subjectId: user.id,
            details: specDetails(spec),
          });
        }
      });
    }
    const snapshot = await this.reader.load();
    return {
      message:
        toAdd.length || toRemove.length
          ? `Roles saved for ${user.displayName}`
          : 'No changes',
      added: toAdd.length,
      removed: toRemove.length,
      heldRoles: snapshot.adminHeldRoles(snapshot.user(user.id) ?? user),
    };
  }

  /**
   * 86: move user agents of any owner to `toUserId`, all at once (admin
   * R43, R64). Each keeps its draft, Live version and publish time and is
   * unpinned. The former owner's sessions keep their `agentId`; since the
   * owner-scoped agents store no longer finds it for them, they behave as
   * for a deleted agent (sessions-chat R59).
   */
  async transferAgents(
    dto: TransferAgentsDto,
    adminId: string,
  ): Promise<{ message: string; transferred: number }> {
    const ids = [
      ...new Set(
        (Array.isArray(dto?.agentIds)
          ? (dto.agentIds as unknown[])
          : []
        ).filter((id): id is string => typeof id === 'string' && id !== ''),
      ),
    ];
    if (!ids.length) throw new BadRequestException('Choose at least one agent');
    if (ids.length > MAX_TRANSFER) {
      throw new BadRequestException(`Choose at most ${MAX_TRANSFER} agents`);
    }
    const toUser = await this.requireUser(dto.toUserId);
    if (isDeactivated(toUser)) {
      throw new BadRequestException(`${toUser.displayName} is deactivated`);
    }
    const moving: UserAgentDoc[] = [];
    for (const id of ids) {
      const agent = await this.agents.ownedById(id);
      if (!agent) throw new NotFoundException(`Agent ${id} not found`);
      moving.push(agent);
    }
    for (const agent of moving) {
      if (agent.ownerId === toUser.id) {
        throw new BadRequestException(
          `"${agentNameOf(agent)}" already belongs to ${toUser.displayName}`,
        );
      }
    }
    // Names are unique per owner, ignoring case (admin R31; agents-evals R43).
    const taken = new Set<string>();
    const namesOf = (agent: UserAgentDoc) =>
      [agent.live?.name, agent.draft?.name].filter(
        (name): name is string => !!name,
      );
    for (const agent of await this.agents.owned()) {
      if (agent.ownerId !== toUser.id) continue;
      for (const name of namesOf(agent)) taken.add(name.toLowerCase());
    }
    for (const agent of moving) {
      const clash = namesOf(agent).find((name) =>
        taken.has(name.toLowerCase()),
      );
      if (clash) {
        throw new ConflictException(
          `${toUser.displayName} already has an agent named "${clash}"`,
        );
      }
      for (const name of namesOf(agent)) taken.add(name.toLowerCase());
    }

    await this.transactions.run(async () => {
      for (const agent of moving) {
        await this.agents.moveTo(agent.id, toUser.id);
        await this.activity.record('agent.transferred', {
          actorId: adminId,
          subjectId: agent.id,
          details: {
            agentName: agentNameOf(agent),
            fromUserId: agent.ownerId,
            toUserId: toUser.id,
          },
        });
      }
    });
    return {
      message: `Transferred ${countOf(moving.length, 'agent')} to ${toUser.displayName}`,
      transferred: moving.length,
    };
  }

  private async requireUser(id: unknown): Promise<UserDoc> {
    const user =
      typeof id === 'string' && id ? await this.directory.userById(id) : null;
    if (!user) throw new NotFoundException(`User ${String(id)} not found`);
    return user;
  }

  private async requireDatasource(id: string): Promise<DatasourceRef> {
    const datasource = await this.connections.findOne({ id });
    if (!datasource) throw new NotFoundException(`Datasource ${id} not found`);
    return datasource;
  }
}
