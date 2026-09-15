import { Module } from '@nestjs/common';
import { DatabricksController } from './databricks.controller';
import { DatabricksService } from './databricks.service';
import { ConnectionsRepository } from './repositories/connections.repository';

@Module({
  controllers: [DatabricksController],
  providers: [DatabricksService, ConnectionsRepository],
  exports: [DatabricksService],
})
export class DatabricksModule {}
