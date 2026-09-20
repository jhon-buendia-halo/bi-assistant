import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { SandboxModule } from '../sandbox/sandbox.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { LlmModule } from '../llm/llm.module';
import { VerifiedQueriesModule } from '../verified-queries/verified-queries.module';
import { MetricsModule } from '../metrics/metrics.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionsRepository } from './repositories/sessions.repository';
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
  controllers: [SessionsController],
  providers: [SessionsService, SessionsRepository, VisualizationService],
  exports: [SessionsService],
})
export class SessionsModule {}
