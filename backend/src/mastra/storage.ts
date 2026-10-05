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

// DuckDB allows one writer per file. The desktop app's backend holds this one
// for as long as it runs, so a second process on the same APP_DATA_DIR — the
// eval CLI or `fixtures:register` pointed at the app's store while the app is
// open — fails every agent call with "Could not set lock on file". Scripts set
// MASTRA_OBSERVABILITY_PATH to a per-process file instead (see
// `scripts/lib/isolated-observability.ts`); the server keeps the shared file
// so Mastra Studio still sees the app's traces.
const observabilityStorage = new DuckDBStore({
  id: 'questions-to-insights-observability',
  path:
    process.env.MASTRA_OBSERVABILITY_PATH?.trim() ||
    join(mastraDataDir, 'observability.duckdb'),
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
