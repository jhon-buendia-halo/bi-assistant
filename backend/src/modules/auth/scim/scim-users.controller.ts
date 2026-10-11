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
  Put,
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
  type ScimListQuery,
  type ScimListResponse,
  ScimService,
  type ScimUserResource,
} from './scim.service';

/** SCIM `Users` (api.md 65-73): the bearer token, no auth session. */
@Controller('scim/v2/Users')
@ScimAuth()
@OrgServerOnly()
@UseFilters(ScimErrorFilter)
export class ScimUsersController {
  constructor(private readonly scim: ScimService) {}

  @Get()
  @Header('Content-Type', SCIM_CONTENT_TYPE)
  list(
    @Query() query: ScimListQuery,
  ): Promise<ScimListResponse<ScimUserResource>> {
    return this.scim.listUsers(query);
  }

  @Post()
  @Header('Content-Type', SCIM_CONTENT_TYPE)
  async create(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ScimUserResource> {
    const user = await this.scim.createUser(body);
    res.location(user.meta.location);
    return user;
  }

  @Get(':id')
  @Header('Content-Type', SCIM_CONTENT_TYPE)
  get(@Param('id') id: string): Promise<ScimUserResource> {
    return this.scim.getUser(id);
  }

  @Put(':id')
  @Header('Content-Type', SCIM_CONTENT_TYPE)
  replace(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ScimUserResource> {
    return this.scim.replaceUser(id, body);
  }

  @Patch(':id')
  @Header('Content-Type', SCIM_CONTENT_TYPE)
  patch(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ScimUserResource> {
    return this.scim.patchUser(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.scim.deleteUser(id);
  }
}
