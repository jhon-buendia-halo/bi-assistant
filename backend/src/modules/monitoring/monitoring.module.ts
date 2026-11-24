import { Module } from '@nestjs/common';
import { getObservabilityDb } from '../../mastra/storage';
import { EvalRunsRepository } from '../agents/repositories/eval-runs.repository';
import { SessionsRepository } from '../sessions/repositories/sessions.repository';
import { WorkflowRunsRepository } from '../workflows/repositories/workflow-runs.repository';
import {
  AGENT_QUALITY_CATALOGUE,
  buildAgentQualityCatalogue,
} from './agent-quality.catalogue';
import { AgentQualityService } from './agent-quality.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import {
  SPAN_EVENTS_DB,
  SpanEventsRepository,
} from './repositories/span-events.repository';

/**
 * Monitoring reads Mastra's trace store (`observability.duckdb`,
 * `span_events`) in-process, through the same DuckDB instance the app writes
 * it with; session names come from the `sessions` collection.
 */
@Module({
  controllers: [MonitoringController],
  providers: [
    MonitoringService,
    SpanEventsRepository,
    SessionsRepository,
    WorkflowRunsRepository,
    EvalRunsRepository,
    AgentQualityService,
    {
      provide: AGENT_QUALITY_CATALOGUE,
      useFactory: buildAgentQualityCatalogue,
    },
    { provide: SPAN_EVENTS_DB, useFactory: getObservabilityDb },
  ],
})
export class MonitoringModule {}
