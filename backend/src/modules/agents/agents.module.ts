import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { DatasourcesModule } from '../datasources/datasources.module';
import { SessionsModule } from '../sessions/sessions.module';
import { EngineModule } from '../engine/engine.module';
import { LlmModule } from '../llm/llm.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { EvalLogsService } from './eval-logs.service';
import { EvalRunsService } from './eval-runs.service';
import { EvalRunsRepository } from './repositories/eval-runs.repository';

@Module({
  // SessionsModule: every eval attempt is one `SessionsService.runTurn` in a
  // throwaway session — the production turn, context blocks included.
  // EngineModule + LlmModule: the run records the levers, reasoning effort
  // and judge pin it ran with (neither imports this module, so no cycle).
  imports: [
    MastraModule,
    DatasetsModule,
    DatasourcesModule,
    SessionsModule,
    EngineModule,
    LlmModule,
  ],
  controllers: [AgentsController],
  providers: [
    AgentsService,
    EvalRunsService,
    EvalRunsRepository,
    EvalLogsService,
  ],
})
export class AgentsModule {}
