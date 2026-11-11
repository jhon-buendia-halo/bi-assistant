import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

/**
 * The workflow catalogue (ADR-0040). Built from the agent catalogue, so it
 * imports AgentsModule; SessionsModule must never import this module
 * (AgentsModule imports SessionsModule): sessions resolve workflows from the
 * pure catalogue instead.
 */
@Module({
  imports: [AgentsModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
})
export class WorkflowsModule {}
