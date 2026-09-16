import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { SandboxModule } from '../sandbox/sandbox.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { LlmModule } from '../llm/llm.module';
import { VerifiedQueriesModule } from '../verified-queries/verified-queries.module';
import { MetricsModule } from '../metrics/metrics.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectsRepository } from './repositories/projects.repository';
import { VisualizationService } from './visualization.service';

@Module({
  imports: [
    MastraModule,
    SandboxModule,
    DatasourcesModule,
    LlmModule,
    VerifiedQueriesModule,
    MetricsModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository, VisualizationService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
