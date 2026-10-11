import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  GROUP_ROLE_MAPPINGS_STORE,
  ROLE_ASSIGNMENTS_STORE,
} from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type {
  AssignableRoleId,
  GroupRoleMappingDoc,
  RoleAssignmentDoc,
} from '../entities/directory.entity';

/**
 * Direct role assignments and group mappings (data-model 3.14.4-3.14.5).
 * The implicit User role and bootstrap Platform admin are never stored.
 */
@Injectable()
export class RolesRepository {
  constructor(
    @Inject(ROLE_ASSIGNMENTS_STORE)
    private readonly assignments: DocStore<RoleAssignmentDoc>,
    @Inject(GROUP_ROLE_MAPPINGS_STORE)
    private readonly mappings: DocStore<GroupRoleMappingDoc>,
  ) {}

  assignmentsOf(userId: string): Promise<RoleAssignmentDoc[]> {
    return this.assignments.find({ userId }, { sort: { createdAt: 1 } });
  }

  assignmentById(id: string): Promise<RoleAssignmentDoc | null> {
    return this.assignments.findOne({ id });
  }

  /** The same direct assignment (for Data owner, on the same datasource). */
  async findAssignment(
    userId: string,
    role: AssignableRoleId,
    datasourceId?: string,
  ): Promise<RoleAssignmentDoc | null> {
    return (
      (await this.assignments.find({ userId, role })).find(
        (a) => (a.datasourceId ?? null) === (datasourceId ?? null),
      ) ?? null
    );
  }

  insertAssignment(
    assignment: Omit<RoleAssignmentDoc, 'id'>,
  ): Promise<RoleAssignmentDoc> {
    return this.assignments.insert({ ...assignment, id: randomUUID() });
  }

  deleteAssignment(id: string): Promise<number> {
    return this.assignments.deleteOne({ id });
  }

  async mappingsOf(groupIds: string[]): Promise<GroupRoleMappingDoc[]> {
    if (!groupIds.length) return [];
    const wanted = new Set(groupIds);
    return (await this.mappings.find({}, { sort: { createdAt: 1 } })).filter(
      (m) => wanted.has(m.groupId),
    );
  }

  /** A deleted group takes its mappings with it (admin R17). */
  async deleteMappingsOf(groupId: string): Promise<void> {
    await this.mappings.deleteMany({ groupId });
  }
}
