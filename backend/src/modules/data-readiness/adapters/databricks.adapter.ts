import type { DatabricksConfig } from '../../datasources/entities/datasource.entity';
import type { ProfilingConnector } from '../../datasources/connectors/profiling';
import type { AssessScope, SourceProfile } from '../engine/types';
import { buildSourceProfile } from './build-profile';
import { classifyDatabricksType } from './classify';
import { DATABRICKS_FORMAT_PATTERNS } from './format-rules';

/**
 * Build a SourceProfile for a Databricks datasource from its profiler (unit 7,
 * BA-258). Probe failures on one table are recorded, not fatal. Schemas are
 * the connector's flattened `catalog.schema` names.
 */
export async function profileDatabricks(
  profiler: ProfilingConnector<DatabricksConfig>,
  config: DatabricksConfig,
  sourceId: string,
  scope?: AssessScope,
): Promise<SourceProfile> {
  return buildSourceProfile(
    profiler,
    config,
    sourceId,
    {
      sourceType: 'databricks',
      classify: classifyDatabricksType,
      formatPatterns: DATABRICKS_FORMAT_PATTERNS,
    },
    scope,
  );
}
