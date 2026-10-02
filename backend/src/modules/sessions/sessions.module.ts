import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { LlmModule } from '../llm/llm.module';
import { VerifiedQueriesModule } from '../verified-queries/verified-queries.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { DataModelsModule } from '../data-models/data-models.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionsRepository } from './repositories/sessions.repository';
import { VisualizationService } from './visualization.service';

@Module({
  imports: [
    MastraModule,
    DatasetsModule,
    DatasourcesModule,
    LlmModule,
    VerifiedQueriesModule,
    KnowledgeModule,
    DataModelsModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService, SessionsRepository, VisualizationService],
  exports: [SessionsService],
})
export class SessionsModule {}
