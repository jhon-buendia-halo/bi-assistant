import { Injectable } from '@nestjs/common';
import type { DatabricksConfig } from '../entities/datasource.entity';
import type {
  ColumnStats,
  FkEdge,
  KeyConstraint,
  ProfiledTable,
  ProfilingConnector,
  TablePrivilege,
} from './profiling';

const todo = (m: string): never => {
  throw new Error(
    `DatabricksProfiler.${m} is not implemented yet (BA-251 scaffold)`,
  );
};

/** Databricks profiling queries (unit 6, BA-257). */
@Injectable()
export class DatabricksProfiler implements ProfilingConnector<DatabricksConfig> {
  readonly kind = 'databricks' as const;

  tables(): Promise<ProfiledTable[]> {
    return todo('tables');
  }
  columnStats(): Promise<ColumnStats> {
    return todo('columnStats');
  }
  keys(): Promise<KeyConstraint[]> {
    return todo('keys');
  }
  foreignKeys(): Promise<FkEdge[]> {
    return todo('foreignKeys');
  }
  duplicateCount(): Promise<number> {
    return todo('duplicateCount');
  }
  orphanCount(): Promise<number> {
    return todo('orphanCount');
  }
  invalidFormatCount(): Promise<number> {
    return todo('invalidFormatCount');
  }
  normalizedDistinctCount(): Promise<number> {
    return todo('normalizedDistinctCount');
  }
  tablePrivileges(): Promise<TablePrivilege[]> {
    return todo('tablePrivileges');
  }
}
