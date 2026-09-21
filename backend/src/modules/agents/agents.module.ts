import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { EvalRunsService } from './eval-runs.service';
import { EvalRunsRepository } from './repositories/eval-runs.repository';

@Module({
  imports: [MastraModule, DatasetsModule, DatasourcesModule],
  controllers: [AgentsController],
  providers: [AgentsService, EvalRunsService, EvalRunsRepository],
})
export class AgentsModule {}
