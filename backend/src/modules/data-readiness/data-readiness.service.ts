import { Injectable } from '@nestjs/common';
import { DatasourcesService } from '../datasources/datasources.service';
import { PostgresProfiler } from '../datasources/connectors/postgres-profiling';
import { DatabricksProfiler } from '../datasources/connectors/databricks-profiling';
import { DataReadinessRepository } from './data-readiness.repository';
import type { AssessDto } from './dto/assess.dto';
import type { ReadinessReport, ReadinessReportSummary } from './engine/types';
import { notImplemented } from './engine/not-implemented';

/**
 * Orchestrates an assessment: datasource → profiler → adapter → engine → store
 * (unit 8, BA-259). Throws NotFoundException for an unknown datasource or
 * report and BadRequestException for an unsupported datasource kind.
 */
@Injectable()
export class DataReadinessService {
  constructor(
    private readonly datasources: DatasourcesService,
    private readonly postgres: PostgresProfiler,
    private readonly databricks: DatabricksProfiler,
    private readonly repository: DataReadinessRepository,
  ) {}

  /** `now` is injectable for tests; defaults to the current time. */
  assess(input: AssessDto, now?: Date): Promise<ReadinessReport> {
    void input;
    void now;
    return Promise.resolve(notImplemented('DataReadinessService.assess'));
  }

  list(datasourceId: string): Promise<ReadinessReportSummary[]> {
    void datasourceId;
    return Promise.resolve(notImplemented('DataReadinessService.list'));
  }

  get(id: string): Promise<ReadinessReport> {
    void id;
    return Promise.resolve(notImplemented('DataReadinessService.get'));
  }
}
