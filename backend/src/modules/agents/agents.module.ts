import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { SessionsModule } from '../sessions/sessions.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MetricsModule } from '../metrics/metrics.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { EvalRunsService } from './eval-runs.service';
import { EvalRunsRepository } from './repositories/eval-runs.repository';

@Module({
  // SessionsModule: EvalRunsService creates a throwaway session per eval run
  // so create_visual/update_visual work the way they do in a real chat turn.
  // KnowledgeModule: same curated-knowledge block a real chat turn gets.
  // MetricsModule: the `legacy` eval path's curated-metrics block (ADR-0007
  // §7) — the `model` path gets metrics from the rendered model block.
  imports: [
    MastraModule,
    DatasetsModule,
    DatasourcesModule,
    SessionsModule,
    KnowledgeModule,
    MetricsModule,
  ],
  controllers: [AgentsController],
  providers: [AgentsService, EvalRunsService, EvalRunsRepository],
})
export class AgentsModule {}
