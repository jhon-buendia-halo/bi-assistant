import { mkdirSync } from 'fs';
import { join } from 'path';
import { LibSQLStore } from '@mastra/libsql';

export const mastraDataDir =
  process.env.APP_DATA_DIR ?? join(process.cwd(), 'data');
mkdirSync(mastraDataDir, { recursive: true });

/** Persistent Mastra runtime storage, colocated with the app's SQLite data. */
export const mastraStorage = new LibSQLStore({
  id: 'questions-to-insights-mastra',
  url: `file:${join(mastraDataDir, 'mastra.sqlite')}`,
});
