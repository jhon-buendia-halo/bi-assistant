import { Global, Logger, Module, Provider } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { SUPER_ADMIN } from '../../common/super-admin';
import { resolveSkillLinkNames } from '../../mastra/agent-links';
import { ORCHESTRATOR_MICHAEL_INSTRUCTIONS } from '../../mastra/workflows/orchestrated-answer-michael.prompts';
import {
  AGENTS_STORE,
  CONNECTIONS_STORE,
  DATASOURCE_INVENTORIES_STORE,
  DOC_STORE_TRANSACTIONS,
  METRICS_STORE,
  EVAL_RUNS_STORE,
  ONTOLOGY_STORE,
  SESSIONS_STORE,
  DATASETS_STORE,
  SETTINGS_STORE,
  SKILLS_STORE,
  AGENT_PROMPT_OVERRIDES_STORE,
  READINESS_REPORTS_STORE,
  SKILL_OVERRIDES_STORE,
  VERIFIED_QUERIES_STORE,
  WORKFLOW_RUNS_STORE,
  WORKFLOW_RUN_NODE_CHATS_STORE,
  ARTIFACTS_STORE,
  CONVERSATION_EXPORTS_STORE,
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
  { token: ONTOLOGY_STORE, table: 'ontology_items' },
  { token: AGENTS_STORE, table: 'agents' },
  { token: SKILLS_STORE, table: 'skills' },
  { token: SKILL_OVERRIDES_STORE, table: 'skill_overrides' },
  { token: AGENT_PROMPT_OVERRIDES_STORE, table: 'agent_prompt_overrides' },
  { token: READINESS_REPORTS_STORE, table: 'readiness_reports' },
  { token: WORKFLOW_RUNS_STORE, table: 'workflow_runs' },
  { token: WORKFLOW_RUN_NODE_CHATS_STORE, table: 'workflow_run_node_chats' },
  { token: ARTIFACTS_STORE, table: 'artifacts' },
  { token: CONVERSATION_EXPORTS_STORE, table: 'conversation_exports' },
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
    migrateKnowledgeToOntology(db);
    renameLegacyAgentIds(db);
    dropRemovedCollections(db);
    dropStaleChiefOfStaffPrompt(db);
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
  // Pre-M15 installs: M14 runs first, so the snippets M15 copies are owned.
  'knowledge_snippets',
  'ontology_items',
  'user_personas',
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

const LEGACY_KNOWLEDGE_TABLE = 'knowledge_snippets';
const RETIRED_KNOWLEDGE_TABLE = 'knowledge_snippets_legacy';
const ONTOLOGY_TABLE = 'ontology_items';

/** A legacy string list as stored: strings only, blanks dropped. */
function legacyList(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).filter(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  );
}

/**
 * M15's mapping of one legacy knowledge snippet to an ontology item
 * (docs/plans/ba-320-dataset-ontology.md, "Storage"); `null` for a document
 * that is not a snippet of a known kind. Kept free of the ontology module's
 * types: infrastructure never depends on a feature module.
 *
 * - `term` → `concept` (title → name, body → description, synonyms kept,
 *   each entity → a mapping `{ entity }` in the same order);
 * - `default_filter` → `constraint` (body → predicate, description `''`);
 * - `instruction` → `instruction` (body → description).
 * - `scope.datasetId` → `dataset`; no scope → shared; a scope with only
 *   `datasourceId` → shared **and** disabled.
 * - `id`, `enabled`, `source`, `ownerId`, `createdAt`, `updatedAt` as they are.
 */
export function legacySnippetToOntologyItem(
  snippet: Record<string, unknown>,
): Record<string, unknown> | null {
  const kind =
    snippet.kind === 'term'
      ? 'concept'
      : snippet.kind === 'default_filter'
        ? 'constraint'
        : snippet.kind === 'instruction'
          ? 'instruction'
          : null;
  if (!kind || typeof snippet.id !== 'string') return null;
  const scope =
    snippet.scope && typeof snippet.scope === 'object'
      ? (snippet.scope as Record<string, unknown>)
      : null;
  const datasetId =
    typeof scope?.datasetId === 'string' && scope.datasetId
      ? scope.datasetId
      : null;
  const datasourceOnly =
    !datasetId &&
    typeof scope?.datasourceId === 'string' &&
    scope.datasourceId !== '';
  const title = typeof snippet.title === 'string' ? snippet.title : '';
  const body = typeof snippet.body === 'string' ? snippet.body : '';
  const synonyms = legacyList(snippet.synonyms);
  const entities = legacyList(snippet.entities);
  const item: Record<string, unknown> = {
    id: snippet.id,
    dataset: datasetId,
    kind,
    name: title,
    description: kind === 'constraint' ? '' : body,
    enabled: datasourceOnly ? false : snippet.enabled,
    source: snippet.source,
  };
  if (kind === 'concept') {
    if (synonyms.length) item.synonyms = synonyms;
    if (entities.length) item.mappings = entities.map((entity) => ({ entity }));
  } else {
    if (kind === 'constraint') item.predicate = body;
    if (entities.length) item.entities = entities;
  }
  for (const key of ['ownerId', 'createdAt', 'updatedAt']) {
    if (snippet[key] !== undefined) item[key] = snippet[key];
  }
  return item;
}

/**
 * M15 (data-model 6; ADR-0036): knowledge snippets become ontology items.
 * Runs after M14 and before any store is built. Raw SQL, so timestamps are
 * not restamped; idempotent; one transaction. When `knowledge_snippets`
 * exists: create `ontology_items` if missing, copy each snippet whose id is
 * not there yet, then rename `knowledge_snippets` to
 * `knowledge_snippets_legacy` (kept one release) when that name is free —
 * otherwise both stay and a warning is logged.
 */
export function migrateKnowledgeToOntology(
  db: Db,
  logger: Pick<Logger, 'warn'> = new Logger('DatabaseModule'),
): void {
  if (!tableExists(db, LEGACY_KNOWLEDGE_TABLE)) return;
  db.transaction(() => {
    db.prepare(
      `CREATE TABLE IF NOT EXISTS "${ONTOLOGY_TABLE}" (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)`,
    ).run();
    const present = new Set(
      (
        db
          .prepare(
            `SELECT json_extract(doc, '$.id') AS id FROM "${ONTOLOGY_TABLE}"`,
          )
          .all() as { id: unknown }[]
      ).map((r) => r.id),
    );
    const rows = db
      .prepare(`SELECT doc FROM "${LEGACY_KNOWLEDGE_TABLE}" ORDER BY rid`)
      .all() as { doc: string }[];
    const insert = db.prepare(
      `INSERT INTO "${ONTOLOGY_TABLE}" (doc) VALUES (?)`,
    );
    for (const { doc } of rows) {
      let snippet: Record<string, unknown>;
      try {
        snippet = JSON.parse(doc) as Record<string, unknown>;
      } catch {
        continue;
      }
      const item = legacySnippetToOntologyItem(snippet);
      if (!item || present.has(item.id)) continue;
      insert.run(JSON.stringify(item));
      present.add(item.id);
    }
    if (tableExists(db, RETIRED_KNOWLEDGE_TABLE)) {
      logger.warn(
        `M15: "${RETIRED_KNOWLEDGE_TABLE}" already exists, so "${LEGACY_KNOWLEDGE_TABLE}" was copied but not renamed`,
      );
      return;
    }
    db.prepare(
      `ALTER TABLE "${LEGACY_KNOWLEDGE_TABLE}" RENAME TO "${RETIRED_KNOWLEDGE_TABLE}"`,
    ).run();
  })();
}

/**
 * M16 (data-model 6): the ids renamed on 2026-11-15. The agent of the
 * Analyse step was `assistant-v2` ("Questions to Insights v2") and the
 * workflow Answer a Business Question was `qti-v2-turn`; both names
 * outlived the design they described. Answer a Business Question was
 * removed since (M18): M16 still renames its old id, and M18 then deletes
 * the runs that hold it.
 */
export const LEGACY_AGENT_KEY = {
  from: 'assistant-v2',
  to: 'insights-analyst',
};
export const LEGACY_AGENT_NAME = {
  from: 'Questions to Insights v2',
  to: 'Insights Analyst',
};
export const LEGACY_WORKFLOW_ID = {
  from: 'qti-v2-turn',
  to: 'answer-business-question',
};

/** Each stored field that holds one of the renamed values. */
const LEGACY_ID_FIELDS: {
  table: string;
  path: string;
  rename: { from: string; to: string };
}[] = [
  { table: 'sessions', path: '$.agentKey', rename: LEGACY_AGENT_KEY },
  { table: 'sessions', path: '$.agentName', rename: LEGACY_AGENT_NAME },
  { table: 'sessions', path: '$.workflowId', rename: LEGACY_WORKFLOW_ID },
  { table: 'workflow_runs', path: '$.agentKey', rename: LEGACY_AGENT_KEY },
  { table: 'workflow_runs', path: '$.agentName', rename: LEGACY_AGENT_NAME },
  { table: 'workflow_runs', path: '$.workflowId', rename: LEGACY_WORKFLOW_ID },
  { table: 'eval_runs', path: '$.agentKey', rename: LEGACY_AGENT_KEY },
  { table: 'agent_prompt_overrides', path: '$.key', rename: LEGACY_AGENT_KEY },
];

/**
 * M16: rewrite the stored ids `assistant-v2` and `qti-v2-turn` (and the
 * agent's stored display name) to their new names, so no reader needs an
 * alias. Raw SQL so `updatedAt` is untouched (sessions and runs are listed
 * by recency); idempotent; tables not created yet are skipped.
 */
export function renameLegacyAgentIds(db: Db): void {
  db.transaction(() => {
    for (const { table, path, rename } of LEGACY_ID_FIELDS) {
      if (!tableExists(db, table)) continue;
      db.prepare(
        `UPDATE "${table}" SET doc = json_set(doc, '${path}', ?)
          WHERE json_extract(doc, '${path}') = ?`,
      ).run(rename.to, rename.from);
    }
    // The pinned built-in agents (data-model 3.2): one key in a list.
    if (tableExists(db, 'settings')) {
      db.prepare(
        `UPDATE "settings"
            SET doc = json_set(doc, '$.pinned', (
              SELECT json_group_array(CASE value WHEN @from THEN @to ELSE value END)
                FROM json_each(doc, '$.pinned')))
          WHERE json_extract(doc, '$.key') = 'builtin-agent-pins'
            AND EXISTS (SELECT 1 FROM json_each(doc, '$.pinned') WHERE value = @from)`,
      ).run(LEGACY_AGENT_KEY);
    }
  })();
}

/** The tables of removed features (data-model 6, M17). */
const REMOVED_TABLES = ['user_personas', 'visual_charts', 'site_signins'];

/** The `settings` keys of removed features (data-model 6, M17). */
const REMOVED_SETTINGS_KEYS = ['personas-seed', 'visuals-seed'];

/**
 * M17: the user personas and the visuals library were removed with the
 * Context area (2026-11-15), and Review a Website's saved sign-ins
 * (`site_signins`) with that workflow (2026-11-26). Their tables and seed
 * markers are dropped so nothing is left that no code reads. Idempotent;
 * one transaction.
 */
export function dropRemovedCollections(db: Db): void {
  db.transaction(() => {
    for (const table of REMOVED_TABLES) {
      db.prepare(`DROP TABLE IF EXISTS "${table}"`).run();
    }
    if (tableExists(db, 'settings')) {
      const marks = REMOVED_SETTINGS_KEYS.map(() => '?').join(', ');
      db.prepare(
        `DELETE FROM settings WHERE json_extract(doc, '$.key') IN (${marks})`,
      ).run(...REMOVED_SETTINGS_KEYS);
    }
  })();
}

/**
 * M18b (data-model 6): Avery's shipped prompt became Answer a Business
 * Question (Avery + Michael)'s when her whole-team workflow was removed
 * (2026-11-23). An in-app edit of her prompt was an edit of the whole
 * team's, which names tools she no longer has, so it is deleted and she
 * runs on her shipped prompt. Idempotent: a later edit is kept, since it is
 * made from the new prompt (its `baseHash` is the new prompt's).
 */
export function dropStaleChiefOfStaffPrompt(
  db: Db,
  shippedHash: string = createHash('sha256')
    .update(ORCHESTRATOR_MICHAEL_INSTRUCTIONS)
    .digest('hex'),
): void {
  if (!tableExists(db, 'agent_prompt_overrides')) return;
  db.prepare(
    `DELETE FROM agent_prompt_overrides
      WHERE json_extract(doc, '$.key') = 'chief-of-staff'
        AND COALESCE(json_extract(doc, '$.baseHash'), '') <> ?`,
  ).run(shippedHash);
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
