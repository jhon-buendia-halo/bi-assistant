import { Global, Module, Provider } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { SUPER_ADMIN } from '../../common/super-admin';
import { resolveSkillLinkNames } from '../../mastra/agent-links';
import {
  AGENTS_STORE,
  CONNECTIONS_STORE,
  DATASOURCE_INVENTORIES_STORE,
  DOC_STORE_TRANSACTIONS,
  METRICS_STORE,
  EVAL_RUNS_STORE,
  KNOWLEDGE_STORE,
  SESSIONS_STORE,
  DATASETS_STORE,
  SETTINGS_STORE,
  SKILLS_STORE,
  AGENT_PROMPT_OVERRIDES_STORE,
  SKILL_OVERRIDES_STORE,
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
  { token: SKILLS_STORE, table: 'skills' },
  { token: SKILL_OVERRIDES_STORE, table: 'skill_overrides' },
  { token: AGENT_PROMPT_OVERRIDES_STORE, table: 'agent_prompt_overrides' },
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
    consolidateOwners(db);
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

/** The collections whose documents carry an `ownerId` (data-model 3.15). */
const PRIVATE_TABLES = [
  'sessions',
  'verified_queries',
  'metrics',
  'eval_runs',
  'knowledge_snippets',
  'agents',
  'skills',
];

/** The per-user `settings` keys, kept as one bare-key document each. */
const PER_USER_SETTINGS_KEYS = ['ui-preferences', 'builtin-agent-pins'];

/** The identity and access tables of the removed org / local-persona modes. */
const IDENTITY_TABLES = [
  'users',
  'groups',
  'group_members',
  'role_assignments',
  'group_role_mappings',
  'auth_sessions',
  'activity_events',
];

const SKILL_NAME_MAX = 64;

type Db = import('better-sqlite3').Database;

/**
 * M14 (data-model 6; ADR-0030): one built-in super admin owns everything.
 * Replaces M13. Raw SQL, so `updatedAt` is not restamped; idempotent; one
 * transaction.
 *
 * 1. A skill whose name another owner already holds under `local` is renamed
 *    `<name>-2`, `-3`... (names are unique per collection now), and
 *    `[[skill:<old>]]` links in the draft and live instructions of its former
 *    owner's agents (and the name in their Live skill copies) follow it.
 * 2. Every document of the private collections gets `ownerId: "local"`.
 * 3. `ui-preferences:local` / `builtin-agent-pins:local` become the bare keys
 *    when the bare key is absent; every other user's copy is deleted.
 * 4. The seven identity tables are dropped.
 */
export function consolidateOwners(db: Db): void {
  db.transaction(() => {
    renameClashingSkills(db);
    for (const table of PRIVATE_TABLES) {
      if (!tableExists(db, table)) continue;
      db.prepare(
        `UPDATE "${table}"
            SET doc = json_set(doc, '$.ownerId', ?)
          WHERE json_extract(doc, '$.ownerId') IS NULL
             OR json_extract(doc, '$.ownerId') != ?`,
      ).run(SUPER_ADMIN.id, SUPER_ADMIN.id);
    }
    consolidateSettings(db);
    for (const table of IDENTITY_TABLES) {
      db.prepare(`DROP TABLE IF EXISTS "${table}"`).run();
    }
  })();
}

function consolidateSettings(db: Db): void {
  if (!tableExists(db, 'settings')) return;
  for (const key of PER_USER_SETTINGS_KEYS) {
    db.prepare(
      `UPDATE settings
          SET doc = json_set(doc, '$.key', ?)
        WHERE json_extract(doc, '$.key') = ?
          AND NOT EXISTS (
            SELECT 1 FROM settings WHERE json_extract(doc, '$.key') = ?
          )`,
    ).run(key, `${key}:${SUPER_ADMIN.id}`, key);
    db.prepare(
      `DELETE FROM settings WHERE json_extract(doc, '$.key') LIKE ? ESCAPE '\\'`,
    ).run(`${key}:%`);
  }
}

function renameClashingSkills(db: Db): void {
  if (!tableExists(db, 'skills')) return;
  const rows = db
    .prepare(
      `SELECT rid,
              json_extract(doc, '$.id') AS id,
              json_extract(doc, '$.name') AS name,
              json_extract(doc, '$.ownerId') AS owner
         FROM skills
        ORDER BY json_extract(doc, '$.createdAt'), rid`,
    )
    .all() as {
    rid: number;
    id: string;
    name: string;
    owner: string | null;
  }[];
  const taken = new Set<string>();
  for (const row of rows) {
    if (typeof row.name !== 'string') continue;
    if (row.owner === null || row.owner === SUPER_ADMIN.id) {
      taken.add(row.name);
    }
  }
  // Former owner -> old name -> new name.
  const renames = new Map<string, Map<string, string>>();
  const renamedIds = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.name !== 'string') continue;
    if (row.owner === null || row.owner === SUPER_ADMIN.id) continue;
    if (!taken.has(row.name)) {
      taken.add(row.name);
      continue;
    }
    let next = row.name;
    for (let n = 2; taken.has(next) || next === row.name; n++) {
      const suffix = `-${n}`;
      next = row.name.slice(0, SKILL_NAME_MAX - suffix.length) + suffix;
    }
    taken.add(next);
    db.prepare(
      `UPDATE skills SET doc = json_set(doc, '$.name', ?) WHERE rid = ?`,
    ).run(next, row.rid);
    if (!renames.has(row.owner)) renames.set(row.owner, new Map());
    renames.get(row.owner)!.set(row.name, next);
    renamedIds.set(`${row.owner}/${row.id}`, next);
  }
  if (!renames.size || !tableExists(db, 'agents')) return;
  const agents = db.prepare(`SELECT rid, doc FROM agents`).all() as {
    rid: number;
    doc: string;
  }[];
  for (const { rid, doc } of agents) {
    const agent = JSON.parse(doc) as {
      ownerId?: string;
      draft?: { instructions?: string };
      live?: { instructions?: string };
      liveSkills?: { id: string; name: string }[];
    };
    const renamed = agent.ownerId ? renames.get(agent.ownerId) : undefined;
    if (!renamed) continue;
    let changed = false;
    for (const config of [agent.draft, agent.live]) {
      if (typeof config?.instructions !== 'string') continue;
      const text = resolveSkillLinkNames(config.instructions, renamed);
      if (text !== config.instructions) {
        config.instructions = text;
        changed = true;
      }
    }
    for (const copy of agent.liveSkills ?? []) {
      const next = renamedIds.get(`${agent.ownerId}/${copy.id}`);
      if (next && copy.name !== next) {
        copy.name = next;
        changed = true;
      }
    }
    if (changed) {
      db.prepare(`UPDATE agents SET doc = ? WHERE rid = ?`).run(
        JSON.stringify(agent),
        rid,
      );
    }
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
