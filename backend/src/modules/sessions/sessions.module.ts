import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { LlmModule } from '../llm/llm.module';
import { VerifiedQueriesModule } from '../verified-queries/verified-queries.module';
import { MetricsModule } from '../metrics/metrics.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { EngineModule } from '../engine/engine.module';
import { ExpertModeModule } from '../expert-mode/expert-mode.module';
import { AnswerPinsModule } from '../answer-pins/answer-pins.module';
import { LearningModule } from '../learning/learning.module';
import { MemoryModule } from '../memory/memory.module';
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
    MetricsModule,
    KnowledgeModule,
    // Settings → Engine levers: the production defaults every turn resolves.
    EngineModule,
    ExpertModeModule,
    AnswerPinsModule,
    LearningModule,
    // Hindsight learning memory: recall in the turn, signals from feedback.
    MemoryModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService, SessionsRepository, VisualizationService],
  exports: [SessionsService],
})
export class SessionsModule {}
