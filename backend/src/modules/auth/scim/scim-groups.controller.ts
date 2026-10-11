import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  OrgServerOnly,
  ScimAuth,
} from '../../../common/decorators/auth-requirement.decorators';
import { SCIM_CONTENT_TYPE, ScimErrorFilter } from './scim-error';
import {
  type ScimGroupResource,
  type ScimListQuery,
  type ScimListResponse,
  ScimService,
} from './scim.service';

/** SCIM `Groups` (api.md 74-78): the bearer token, no auth session. */
@Controller('scim/v2/Groups')
@ScimAuth()
@OrgServerOnly()
@UseFilters(ScimErrorFilter)
export class ScimGroupsController {
  constructor(private readonly scim: ScimService) {}

  @Get()
  @Header('Content-Type', SCIM_CONTENT_TYPE)
  list(
    @Query() query: ScimListQuery,
  ): Promise<ScimListResponse<ScimGroupResource>> {
    return this.scim.listGroups(query);
  }

  @Post()
  @Header('Content-Type', SCIM_CONTENT_TYPE)
  async create(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ScimGroupResource> {
    const group = await this.scim.createGroup(body);
    res.location(group.meta.location);
    return group;
  }

  @Get(':id')
  @Header('Content-Type', SCIM_CONTENT_TYPE)
  get(
    @Param('id') id: string,
    @Query('excludedAttributes') excludedAttributes?: string,
  ): Promise<ScimGroupResource> {
    return this.scim.getGroup(id, excludedAttributes);
  }

  @Patch(':id')
  @Header('Content-Type', SCIM_CONTENT_TYPE)
  patch(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ScimGroupResource> {
    return this.scim.patchGroup(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.scim.deleteGroup(id);
  }
}
