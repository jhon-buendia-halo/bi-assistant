import { Body, Controller, Get, Post } from '@nestjs/common';
import { CatalogInfo, DatabricksService } from './databricks.service';
import { TestConnectionDto } from './dto/test-connection.dto';
import { ConnectionsRepository } from './repositories/connections.repository';
import { DatabricksConnection } from './entities/databricks-connection.entity';

@Controller('databricks')
export class DatabricksController {
  constructor(
    private readonly databricksService: DatabricksService,
    private readonly connectionsRepository: ConnectionsRepository,
  ) {}

  @Post('test-connection')
  async testConnection(
    @Body() dto: TestConnectionDto,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      await this.databricksService.testConnection(dto);
      return { ok: true, message: 'Connection successful' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Get('inventory')
  async inventory(): Promise<{
    ok: boolean;
    message?: string;
    catalogs?: CatalogInfo[];
  }> {
    try {
      const catalogs = await this.databricksService.inventory();
      return { ok: true, catalogs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  @Get('connection')
  async getConnection(): Promise<DatabricksConnection | null> {
    return this.connectionsRepository.get();
  }

  @Post('connection')
  async saveConnection(
    @Body() dto: TestConnectionDto,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      await this.connectionsRepository.save({
        host: dto.host,
        token: dto.token,
        warehouseId: dto.warehouseId,
      });
      return { ok: true, message: 'Connection saved' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }
}
