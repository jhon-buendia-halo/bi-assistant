import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DbService } from './db/db.service';
import { Public } from './public.decorator';

export const INTELLIFY_API_VERSION = Symbol('INTELLIFY_API_VERSION');

/** `GET /health` (api.md 2.16.1 I1); `/openapi.json` is served by `mountOpenApi`. */
@ApiTags('service')
@Controller()
export class ServiceController {
  constructor(
    private readonly db: DbService,
    @Inject(INTELLIFY_API_VERSION) private readonly version: string,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness and database status' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        version: { type: 'string' },
        database: { type: 'string', enum: ['up', 'down'] },
        schema: { type: 'string', enum: ['intellify'] },
        rfpSchemaVersion: { type: 'integer', nullable: true },
      },
    },
  })
  async health() {
    const { database, rfpSchemaVersion } = await this.db.health();
    return {
      ok: database === 'up',
      version: this.version,
      database,
      schema: 'intellify' as const,
      rfpSchemaVersion,
    };
  }
}
