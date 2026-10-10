import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { SessionsModule } from '../sessions/sessions.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { UserAgentsModule } from '../user-agents/user-agents.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { EvalRunsService } from './eval-runs.service';
import { EvalRunsRepository } from './repositories/eval-runs.repository';

@Module({
  // SessionsModule: EvalRunsService creates a throwaway session per eval run
  // so create_visual/update_visual work the way they do in a real chat turn.
  // KnowledgeModule: same curated-knowledge block a real chat turn gets.
  // UserAgentsModule: user-agent storage, merged into the agent catalogue.
  imports: [
    MastraModule,
    DatasetsModule,
    DatasourcesModule,
    SessionsModule,
    KnowledgeModule,
    UserAgentsModule,
  ],
  controllers: [AgentsController],
  providers: [AgentsService, EvalRunsService, EvalRunsRepository],
})
export class AgentsModule {}
