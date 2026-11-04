import type { PostgresConfig } from '../../datasources/entities/datasource.entity';
import type { ProfilingConnector } from '../../datasources/connectors/profiling';
import type { AssessScope, SourceProfile } from '../engine/types';
import { buildSourceProfile } from './build-profile';
import { classifyType } from './classify';
import { POSTGRES_FORMAT_PATTERNS } from './format-rules';

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
  return buildSourceProfile(
    profiler,
    config,
    sourceId,
    {
      sourceType: 'postgres',
      classify: classifyType,
      formatPatterns: POSTGRES_FORMAT_PATTERNS,
    },
    scope,
  );
}
