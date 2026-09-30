import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { DatasourcesService } from './datasources.service';
import type {
  DiscoverRestEndpointsDto,
  SaveDatasourceDto,
  TestDatasourceDto,
} from './dto/datasource.dto';
import type {
  CatalogInfo,
  DatasourceView,
  RestDiscovery,
} from './entities/datasource.entity';

@Controller('datasources')
export class DatasourcesController {
  constructor(private readonly datasources: DatasourcesService) {}

  @Get()
  async list(): Promise<{ datasources: DatasourceView[] }> {
    return { datasources: await this.datasources.list() };
  }

  @Post('test-connection')
  async testConnection(
    @Body() dto: TestDatasourceDto,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      await this.datasources.testConnection(dto.kind, dto.config, dto.id);
      return { ok: true, message: 'Connection successful' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Post('rest/discover')
  async discoverRestEndpoints(
    @Body() dto: DiscoverRestEndpointsDto,
  ): Promise<{ ok: boolean; message: string } & Partial<RestDiscovery>> {
    try {
      const result = await this.datasources.discoverRestEndpoints(
        dto.config,
        dto.specUrl,
        dto.id,
      );
      const count = result.endpoints.length;
      const source = result.title ? ` in "${result.title}"` : '';
      return {
        ok: true,
        message: `Found ${count} endpoint${count === 1 ? '' : 's'}${source}`,
        ...result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Post()
  async save(
    @Body() dto: SaveDatasourceDto,
  ): Promise<{ ok: boolean; message: string; datasource?: DatasourceView }> {
    try {
      const datasource = await this.datasources.save(dto);
      return {
        ok: true,
        message: `Datasource "${datasource.name}" saved`,
        datasource,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const removed = await this.datasources.delete(id);
      return { ok: true, message: `Datasource "${removed.name}" deleted` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Get(':id/inventory')
  async inventory(
    @Param('id') id: string,
    @Query('refresh') refresh?: string,
    @Query('cachedOnly') cachedOnly?: string,
  ): Promise<{
    ok: boolean;
    message?: string;
    catalogs?: CatalogInfo[];
    fetchedAt?: string;
    cached?: boolean;
  }> {
    try {
      if (cachedOnly === 'true') {
        // Snapshot-or-nothing: the caller decides whether to pay for a live walk.
        const snapshot = await this.datasources.cachedInventory(id);
        return snapshot
          ? { ok: true, ...snapshot }
          : { ok: true, cached: false };
      }
      const result = await this.datasources.inventory(id, refresh === 'true');
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }
}
