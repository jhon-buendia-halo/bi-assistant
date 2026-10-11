import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  OrgServerOnly,
  RequirePermission,
} from '../../common/decorators/auth-requirement.decorators';
import { CurrentUserService } from '../auth/current-user.service';
import type { RoleAssignmentDoc } from '../auth/entities/directory.entity';
import { AdminReadService } from './admin-read.service';
import { AdminService } from './admin.service';
import type { AssignRoleDto } from './dto/assign-role.dto';
import type {
  AdminGroupsPage,
  AdminUsersPage,
} from './entities/admin-views.entity';

/**
 * The admin API (api.md 2.15): `manage-users` on every route, org server
 * mode only. Errors are Style B; successful writes answer an `ok` body.
 */
@Controller('admin')
@RequirePermission('manage-users')
@OrgServerOnly()
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly reads: AdminReadService,
    private readonly currentUser: CurrentUserService,
  ) {}

  /** 79: 201 when assigned, 200 when the user already held it. */
  @Post('role-assignments')
  async assignRole(
    @Body() dto: AssignRoleDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; message: string; assignment: RoleAssignmentDoc }> {
    const { created, assignment } = await this.admin.assignRole(
      dto ?? ({} as AssignRoleDto),
      this.currentUser.ownerKey(),
    );
    if (!created) {
      res.status(200);
      return { ok: true, message: 'Role already assigned', assignment };
    }
    return { ok: true, message: 'Role assigned', assignment };
  }

  /** 80. */
  @Delete('role-assignments/:id')
  async removeAssignment(
    @Param('id') id: string,
  ): Promise<{ ok: true; message: string }> {
    await this.admin.removeAssignment(id, this.currentUser.ownerKey());
    return { ok: true, message: 'Role removed' };
  }

  /** 83. */
  @Get('users')
  users(@Query() query: Record<string, unknown>): Promise<AdminUsersPage> {
    return this.reads.listUsers(query ?? {});
  }

  /** 87. */
  @Get('groups')
  groups(@Query() query: Record<string, unknown>): Promise<AdminGroupsPage> {
    return this.reads.listGroups(query ?? {});
  }
}
