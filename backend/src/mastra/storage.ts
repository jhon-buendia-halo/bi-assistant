import { mkdirSync } from 'fs';
import { join } from 'path';
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';
import { LibSQLStore } from '@mastra/libsql';

// Mastra Studio changes process.cwd() to its public directory after bundling,
// while PWD/INIT_CWD still point at the directory the CLI was launched from.
const launchDir = process.env.INIT_CWD ?? process.env.PWD ?? process.cwd();
export const mastraDataDir =
  process.env.APP_DATA_DIR ?? join(launchDir, 'data');
mkdirSync(mastraDataDir, { recursive: true });

const runtimeStorage = new LibSQLStore({
  id: 'questions-to-insights-mastra',
  url: `file:${join(mastraDataDir, 'mastra.sqlite')}`,
});

const observabilityStorage = new DuckDBStore({
  id: 'questions-to-insights-observability',
  path: join(mastraDataDir, 'observability.duckdb'),
  memoryLimit: '512MB',
  threads: 2,
});

/**
 * Keep transactional runtime data in LibSQL and route Studio's traces,
 * metrics, and logs to DuckDB's columnar observability domain.
 */
export const mastraStorage = new MastraCompositeStore({
  id: 'questions-to-insights-storage',
  default: runtimeStorage,
  domains: {
    observability: observabilityStorage.observability,
  },
});
