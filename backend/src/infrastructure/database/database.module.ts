import { Global, Module, Provider } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { join } from 'path';
import {
  CONNECTIONS_STORE,
  DATASOURCE_INVENTORIES_STORE,
  METRICS_STORE,
  SESSIONS_STORE,
  SANDBOX_SELECTIONS_STORE,
  SETTINGS_STORE,
  VERIFIED_QUERIES_STORE,
} from './doc-store';
import { SqliteDocStore } from './sqlite-doc-store';

/**
 * Embedded SQLite application datastore, mirrored from data-readiness-agent's
 * DatabaseModule (sqlite mode). The data directory comes from `APP_DATA_DIR`
 * (set by the Electron main process to the app's userData folder) and falls
 * back to `<cwd>/data` for standalone backend runs.
 */
export const DATA_DIR = process.env.APP_DATA_DIR ?? join(process.cwd(), 'data');

const SQLITE_DB = 'DATASTORE_SQLITE_DB';

/** The application collections and their store tokens. */
const COLLECTIONS = [
  { token: CONNECTIONS_STORE, table: 'connections' },
  { token: SETTINGS_STORE, table: 'settings' },
  { token: SANDBOX_SELECTIONS_STORE, table: 'sandbox_selections' },
  { token: SESSIONS_STORE, table: 'sessions' },
  { token: DATASOURCE_INVENTORIES_STORE, table: 'datasource_inventories' },
  { token: VERIFIED_QUERIES_STORE, table: 'verified_queries' },
  { token: METRICS_STORE, table: 'metrics' },
];

const sqliteDbProvider: Provider = {
  provide: SQLITE_DB,
  useFactory: () => {
    const BetterSqlite3 =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('better-sqlite3') as typeof import('better-sqlite3');
    mkdirSync(DATA_DIR, { recursive: true });
    const db = new BetterSqlite3(join(DATA_DIR, 'app.sqlite'));
    renameLegacyTables(db);
    return db;
  },
};

/**
 * Tables renamed after the `projects` → `sessions` rename. `SqliteDocStore`
 * creates a table when missing, so without this an existing install would
 * silently start over with an empty collection.
 */
const LEGACY_TABLE_NAMES: { from: string; to: string }[] = [
  { from: 'projects', to: 'sessions' },
];

function renameLegacyTables(db: import('better-sqlite3').Database): void {
  const exists = (table: string) =>
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table) !== undefined;

  for (const { from, to } of LEGACY_TABLE_NAMES) {
    if (exists(from) && !exists(to)) {
      db.prepare(`ALTER TABLE "${from}" RENAME TO "${to}"`).run();
    }
  }
}

const storeProviders: Provider[] = COLLECTIONS.map((c) => ({
  provide: c.token,
  inject: [SQLITE_DB],
  useFactory: (db: import('better-sqlite3').Database) =>
    new SqliteDocStore(db, c.table),
}));

@Global()
@Module({
  providers: [sqliteDbProvider, ...storeProviders],
  exports: COLLECTIONS.map((c) => c.token),
})
export class DatabaseModule {}
