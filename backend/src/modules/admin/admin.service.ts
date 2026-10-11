import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CONNECTIONS_STORE } from '../../infrastructure/database/doc-store';
import type { DocStore } from '../../infrastructure/database/doc-store';
import { ActivityService } from '../auth/activity.service';
import type {
  AssignableRoleId,
  RoleAssignmentDoc,
} from '../auth/entities/directory.entity';
import { ROLE_IDS } from '../auth/permissions';
import { DirectoryRepository } from '../auth/repositories/directory.repository';
import { RolesRepository } from '../auth/repositories/roles.repository';
import type { AssignRoleDto } from './dto/assign-role.dto';

/**
 * The admin area's writes (admin R22, R61; api.md 2.15). The admin module
 * reads the raw, not owner-scoped, stores (data-model 3.14.8).
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly directory: DirectoryRepository,
    private readonly roles: RolesRepository,
    private readonly activity: ActivityService,
    @Inject(CONNECTIONS_STORE)
    private readonly connections: DocStore<{ id: string }>,
  ) {}

  /** `created: false` when the user already held the same assignment. */
  async assignRole(
    dto: AssignRoleDto,
    adminId: string,
  ): Promise<{ created: boolean; assignment: RoleAssignmentDoc }> {
    const role = dto?.role;
    if (!(ROLE_IDS as readonly unknown[]).includes(role)) {
      throw new BadRequestException(`Unknown role: ${String(role)}`);
    }
    if (role === 'user') {
      throw new BadRequestException('The User role is implicit');
    }
    const datasourceId =
      typeof dto.datasourceId === 'string' && dto.datasourceId.trim()
        ? dto.datasourceId.trim()
        : undefined;
    if (role === 'data-owner' && !datasourceId) {
      throw new BadRequestException('Data owner needs a datasource');
    }
    if (role !== 'data-owner' && datasourceId) {
      throw new BadRequestException('Only Data owner takes a datasource');
    }
    const userId = typeof dto.userId === 'string' ? dto.userId : '';
    if (!userId || !(await this.directory.userById(userId))) {
      throw new NotFoundException(`User ${String(dto.userId)} not found`);
    }
    if (
      datasourceId &&
      !(await this.connections.findOne({ id: datasourceId }))
    ) {
      throw new NotFoundException(`Datasource ${datasourceId} not found`);
    }

    const assignable = role as AssignableRoleId;
    const existing = await this.roles.findAssignment(
      userId,
      assignable,
      datasourceId,
    );
    if (existing) return { created: false, assignment: existing };

    const assignment = await this.roles.insertAssignment({
      userId,
      role: assignable,
      ...(datasourceId ? { datasourceId } : {}),
      assignedBy: adminId,
    });
    await this.activity.record('role.assigned', {
      actorId: adminId,
      subjectId: userId,
      details: { role: assignable, ...(datasourceId ? { datasourceId } : {}) },
    });
    return { created: true, assignment };
  }

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
    await this.roles.deleteAssignment(id);
    await this.activity.record('role.removed', {
      actorId: adminId,
      subjectId: assignment.userId,
      details: {
        role: assignment.role,
        ...(assignment.datasourceId
          ? { datasourceId: assignment.datasourceId }
          : {}),
      },
    });
  }
}
