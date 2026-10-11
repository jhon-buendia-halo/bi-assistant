import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
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
import { AdminOverviewService } from './admin-overview.service';
import { AdminReadService } from './admin-read.service';
import { AdminService } from './admin.service';
import type { AddMappingDto } from './dto/add-mapping.dto';
import type { AssignRoleDto } from './dto/assign-role.dto';
import type { SaveUserRolesDto } from './dto/save-user-roles.dto';
import type { TransferAgentsDto } from './dto/transfer-agents.dto';
import type {
  AdminGroupsPage,
  AdminHeldRole,
  AdminOverview,
  AdminUserDetail,
  AdminUsersPage,
  GroupRoleMappingView,
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
    private readonly overviews: AdminOverviewService,
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

  /** 81. */
  @Get('overview')
  overview(): Promise<AdminOverview> {
    return this.overviews.overview();
  }

  /** 82: a CSV download named after the UTC date. */
  @Get('overview/export')
  async exportOverview(@Res() res: Response): Promise<void> {
    const { fileName, csv } = await this.overviews.exportCsv();
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
      .send(Buffer.from(csv, 'utf8'));
  }

  /** 83. */
  @Get('users')
  users(@Query() query: Record<string, unknown>): Promise<AdminUsersPage> {
    return this.reads.listUsers(query ?? {});
  }

  /** 84. */
  @Get('users/:id')
  user(@Param('id') id: string): Promise<AdminUserDetail> {
    return this.reads.userDetail(id, this.currentUser.ownerKey());
  }

  /** 85. */
  @Put('users/:id/roles')
  async saveRoles(
    @Param('id') id: string,
    @Body() dto: SaveUserRolesDto,
  ): Promise<{
    ok: true;
    message: string;
    added: number;
    removed: number;
    heldRoles: AdminHeldRole[];
  }> {
    const saved = await this.admin.saveUserRoles(
      id,
      dto ?? ({} as SaveUserRolesDto),
      this.currentUser.ownerKey(),
    );
    return { ok: true, ...saved };
  }

  /** 86: 200, not 201: nothing is created. */
  @Post('agents/transfer')
  @HttpCode(200)
  async transferAgents(
    @Body() dto: TransferAgentsDto,
  ): Promise<{ ok: true; message: string; transferred: number }> {
    const result = await this.admin.transferAgents(
      dto ?? ({} as TransferAgentsDto),
      this.currentUser.ownerKey(),
    );
    return { ok: true, ...result };
  }

  /** 87. */
  @Get('groups')
  groups(@Query() query: Record<string, unknown>): Promise<AdminGroupsPage> {
    return this.reads.listGroups(query ?? {});
  }

  /** 88. */
  @Get('role-mappings')
  mappings(): Promise<{ mappings: GroupRoleMappingView[] }> {
    return this.reads.listMappings();
  }

  /** 89: 201 when added, 200 when it already existed. */
  @Post('role-mappings')
  async addMapping(
    @Body() dto: AddMappingDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true; message: string; mapping: GroupRoleMappingView }> {
    const { created, mapping } = await this.admin.addMapping(
      dto ?? ({} as AddMappingDto),
      this.currentUser.ownerKey(),
    );
    if (!created) {
      res.status(200);
      return { ok: true, message: 'Mapping already exists', mapping };
    }
    return { ok: true, message: 'Mapping added', mapping };
  }

  /** 90. */
  @Delete('role-mappings/:id')
  async removeMapping(
    @Param('id') id: string,
  ): Promise<{ ok: true; message: string }> {
    await this.admin.removeMapping(id, this.currentUser.ownerKey());
    return { ok: true, message: 'Mapping removed' };
  }
}
