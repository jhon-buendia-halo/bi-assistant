import { Module } from '@nestjs/common';
import { getObservabilityDb } from '../../mastra/storage';
import { SessionsRepository } from '../sessions/repositories/sessions.repository';
import { WorkflowRunsRepository } from '../workflows/repositories/workflow-runs.repository';
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
    { provide: SPAN_EVENTS_DB, useFactory: getObservabilityDb },
  ],
})
export class MonitoringModule {}
