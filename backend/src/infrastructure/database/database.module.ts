import { Global, Module, Provider } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { join } from 'path';
import {
  CONNECTIONS_STORE,
  DATASOURCE_INVENTORIES_STORE,
  METRICS_STORE,
  EVAL_RUNS_STORE,
  KNOWLEDGE_STORE,
  SESSIONS_STORE,
  DATASETS_STORE,
  DATA_MODELS_STORE,
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
  { token: DATASETS_STORE, table: 'datasets' },
  { token: SESSIONS_STORE, table: 'sessions' },
  { token: DATASOURCE_INVENTORIES_STORE, table: 'datasource_inventories' },
  { token: VERIFIED_QUERIES_STORE, table: 'verified_queries' },
  { token: METRICS_STORE, table: 'metrics' },
  { token: EVAL_RUNS_STORE, table: 'eval_runs' },
  { token: KNOWLEDGE_STORE, table: 'knowledge_snippets' },
  { token: DATA_MODELS_STORE, table: 'data_models' },
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
    renameLegacyFields(db);
    return db;
  },
};

/**
 * Tables renamed after the `projects` → `sessions` and `sandbox` → `dataset`
 * renames. `SqliteDocStore` creates a table when missing, so without this an
 * existing install would silently start over with an empty collection.
 */
const LEGACY_TABLE_NAMES: { from: string; to: string }[] = [
  { from: 'projects', to: 'sessions' },
  { from: 'sandbox_selections', to: 'datasets' },
];

/**
 * Persisted document keys renamed along with the collections. Rewritten in
 * raw SQL rather than through a repository so the migration does not restamp
 * `updatedAt` — the session list is sorted by it, and a repository-side
 * rewrite would flatten every existing session to the same recency.
 */
const LEGACY_DOC_FIELDS: { table: string; from: string; to: string }[] = [
  { table: 'sessions', from: 'sandboxes', to: 'datasets' },
];

function tableExists(
  db: import('better-sqlite3').Database,
  table: string,
): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table) !== undefined
  );
}

export function renameLegacyTables(
  db: import('better-sqlite3').Database,
): void {
  for (const { from, to } of LEGACY_TABLE_NAMES) {
    if (tableExists(db, from) && !tableExists(db, to)) {
      db.prepare(`ALTER TABLE "${from}" RENAME TO "${to}"`).run();
    }
  }
}

export function renameLegacyFields(
  db: import('better-sqlite3').Database,
): void {
  for (const { table, from, to } of LEGACY_DOC_FIELDS) {
    if (!tableExists(db, table)) continue;
    // `json()` around the extracted value keeps arrays/objects structured —
    // without it `json_set` would store the child as a JSON string.
    db.prepare(
      `UPDATE "${table}"
          SET doc = json_remove(
                      json_set(doc, '$.${to}', json(json_extract(doc, '$.${from}'))),
                      '$.${from}')
        WHERE json_extract(doc, '$.${from}') IS NOT NULL
          AND json_extract(doc, '$.${to}') IS NULL`,
    ).run();
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
