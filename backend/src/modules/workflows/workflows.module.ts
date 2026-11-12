import { Module } from '@nestjs/common';
import { MastraModule } from '../../mastra/mastra.module';
import { AgentsModule } from '../agents/agents.module';
import { DatasetsModule } from '../datasets/datasets.module';
import { SessionsModule } from '../sessions/sessions.module';
import { WorkflowRunsService } from './workflow-runs.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

/**
 * The workflow catalogue (ADR-0040) and runs (ADR-0041). Built from the
 * agent catalogue, so it imports AgentsModule; SessionsModule must never
 * import this module (AgentsModule imports SessionsModule): sessions resolve
 * workflows from the pure catalogue instead, and a run's agent turn runs on
 * a SessionsService run host. MastraModule runs the code-only workflows
 * (api.md 118, 119); DatasetsModule checks `dataset` inputs.
 */
@Module({
  imports: [AgentsModule, MastraModule, SessionsModule, DatasetsModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowRunsService],
})
export class WorkflowsModule {}
