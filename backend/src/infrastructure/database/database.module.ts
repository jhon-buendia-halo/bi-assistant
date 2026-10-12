import { Global, Module, Provider } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { loadOrgServerConfig } from '../../config/org-server.config';
import {
  ACTIVITY_EVENTS_STORE,
  AGENTS_STORE,
  AUTH_SESSIONS_STORE,
  GROUP_MEMBERS_STORE,
  GROUP_ROLE_MAPPINGS_STORE,
  GROUPS_STORE,
  ROLE_ASSIGNMENTS_STORE,
  USERS_STORE,
  CONNECTIONS_STORE,
  DATASOURCE_INVENTORIES_STORE,
  DOC_STORE_TRANSACTIONS,
  METRICS_STORE,
  EVAL_RUNS_STORE,
  KNOWLEDGE_STORE,
  SESSIONS_STORE,
  DATASETS_STORE,
  DATA_MODELS_STORE,
  PRIVATE_COLLECTIONS,
  SETTINGS_STORE,
  VERIFIED_QUERIES_STORE,
} from './doc-store';
import { SqliteDocStore } from './sqlite-doc-store';
import { SqliteTransactions } from './sqlite-transactions';

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
  { token: AGENTS_STORE, table: 'agents' },
  { token: USERS_STORE, table: 'users' },
  { token: GROUPS_STORE, table: 'groups' },
  { token: GROUP_MEMBERS_STORE, table: 'group_members' },
  { token: ROLE_ASSIGNMENTS_STORE, table: 'role_assignments' },
  { token: GROUP_ROLE_MAPPINGS_STORE, table: 'group_role_mappings' },
  { token: AUTH_SESSIONS_STORE, table: 'auth_sessions' },
  { token: ACTIVITY_EVENTS_STORE, table: 'activity_events' },
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
    if (isLocalMode()) backfillLocalOwners(db);
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

/**
 * Local mode only: no org server configuration. A partial configuration is
 * the auth module's startup error to report, so it counts as org here and
 * M13 never runs on what may be an org server's data.
 */
function isLocalMode(): boolean {
  try {
    return loadOrgServerConfig() === null;
  } catch {
    return false;
  }
}

/** The private collections' tables (data-model 3.15), for M13. */
const PRIVATE_TABLES: string[] = PRIVATE_COLLECTIONS.map(
  (p) => COLLECTIONS.find((c) => c.token === p.raw)!.table,
);

/** Demo User's id: local data from before sign-in becomes theirs (M13). */
const DEMO_USER_ID = 'local';

/** The per-user `settings` keys local mode stored without a user suffix. */
const LEGACY_SETTINGS_KEYS = ['ui-preferences', 'builtin-agent-pins'];

/**
 * M13 (data-model 6; ADR-0012): local data stored before local mode had
 * sign-in belongs to Demo User. Gives every ownerless document of the
 * private collections `ownerId: "local"`, and renames the bare per-user
 * settings keys to Demo User's, each only when the suffixed key is absent.
 * Raw SQL, so `updatedAt` is not restamped; idempotent. Run in local mode
 * only, so ownerless documents on an org server stay invisible (3.15).
 */
export function backfillLocalOwners(
  db: import('better-sqlite3').Database,
): void {
  for (const table of PRIVATE_TABLES) {
    if (!tableExists(db, table)) continue;
    db.prepare(
      `UPDATE "${table}"
          SET doc = json_set(doc, '$.ownerId', ?)
        WHERE json_extract(doc, '$.ownerId') IS NULL`,
    ).run(DEMO_USER_ID);
  }
  if (!tableExists(db, 'settings')) return;
  for (const key of LEGACY_SETTINGS_KEYS) {
    const suffixed = `${key}:${DEMO_USER_ID}`;
    db.prepare(
      `UPDATE settings
          SET doc = json_set(doc, '$.key', ?)
        WHERE json_extract(doc, '$.key') = ?
          AND NOT EXISTS (
            SELECT 1 FROM settings WHERE json_extract(doc, '$.key') = ?
          )`,
    ).run(suffixed, key, suffixed);
  }
}

const storeProviders: Provider[] = COLLECTIONS.map((c) => ({
  provide: c.token,
  inject: [SQLITE_DB],
  useFactory: (db: import('better-sqlite3').Database) =>
    new SqliteDocStore(db, c.table),
}));

/** Several writes as one unit, across collections (data-model 2.4). */
const transactionsProvider: Provider = {
  provide: DOC_STORE_TRANSACTIONS,
  inject: [SQLITE_DB],
  useFactory: (db: import('better-sqlite3').Database) =>
    new SqliteTransactions(db),
};

@Global()
@Module({
  providers: [sqliteDbProvider, ...storeProviders, transactionsProvider],
  exports: [...COLLECTIONS.map((c) => c.token), DOC_STORE_TRANSACTIONS],
})
export class DatabaseModule {}
