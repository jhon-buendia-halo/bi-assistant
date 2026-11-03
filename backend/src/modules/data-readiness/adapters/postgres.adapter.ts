import type { PostgresConfig } from '../../datasources/entities/datasource.entity';
import type { ProfilingConnector } from '../../datasources/connectors/profiling';
import type { AssessScope, SourceProfile } from '../engine/types';
import { notImplemented } from '../engine/not-implemented';

/**
 * Build a SourceProfile for a Postgres datasource from its profiler (unit 7,
 * BA-258). Probe failures on one table are recorded, not fatal.
 */
export async function profilePostgres(
  profiler: ProfilingConnector<PostgresConfig>,
  config: PostgresConfig,
  sourceId: string,
  scope?: AssessScope,
): Promise<SourceProfile> {
  void profiler;
  void config;
  void sourceId;
  void scope;
  return Promise.resolve(notImplemented('profilePostgres'));
}
