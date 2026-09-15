import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { DatasourcesService } from './datasources.service';
import type {
  SaveDatasourceDto,
  TestDatasourceDto,
} from './dto/datasource.dto';
import type { CatalogInfo, DatasourceView } from './entities/datasource.entity';

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
  ): Promise<{ ok: boolean; message?: string; catalogs?: CatalogInfo[] }> {
    try {
      return { ok: true, catalogs: await this.datasources.inventory(id) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }
}
