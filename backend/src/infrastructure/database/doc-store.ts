// Pluggable application-datastore seam, mirrored from data-readiness-agent
// (ADR-0027 there). `DocStore<T>` captures the small operation surface the
// repositories use: equality filters (incl. dotted paths and `$exists`),
// sort + take-first, patch/upsert, `$unset`-style field removal, and deletes.

/** `{ $exists: false }` — the one non-equality condition the repos use. */
export interface ExistsCondition {
  $exists: boolean;
}

export type FilterValue = string | number | boolean | ExistsCondition;

/** Equality filter; keys may be dotted paths (`scope.namespace`). */
export type DocFilter = Record<string, FilterValue>;

export type SortSpec = Record<string, 1 | -1>;

export interface FindOptions {
  sort?: SortSpec;
}

export interface UpdateOptions {
  /** Insert the patch as a new document when nothing matches. */
  upsert?: boolean;
  /** `$setOnInsert` semantics — when a document already matches, leave it untouched. */
  setOnInsertOnly?: boolean;
}

/**
 * Store of JSON-shaped documents for one collection. Adapters add/maintain
 * `createdAt` / `updatedAt` timestamps on every document.
 */
export interface DocStore<T extends object = Record<string, unknown>> {
  insert(doc: T): Promise<T>;
  find(filter?: DocFilter, options?: FindOptions): Promise<T[]>;
  findOne(filter: DocFilter, options?: FindOptions): Promise<T | null>;
  update(
    filter: DocFilter,
    patch: Partial<T>,
    options?: UpdateOptions,
  ): Promise<T | null>;
  unset(filter: DocFilter, field: string): Promise<T | null>;
  deleteOne(filter: DocFilter): Promise<number>;
  deleteMany(filter: DocFilter): Promise<number>;
}

/**
 * Runs several store writes as one unit (data-model 2.4): every write made
 * by `work` is applied, or none is. Used where the API promises "all or
 * nothing" (api.md 85, 86). `work` must only call stores: the adapter's
 * operations are synchronous under their promises, so nothing else runs on
 * the connection until `work` settles. Runs are serialised, not nested.
 */
export interface DocStoreTransactions {
  run<R>(work: () => Promise<R>): Promise<R>;
}

export const DOC_STORE_TRANSACTIONS = 'DOC_STORE_TRANSACTIONS';

/** One injection token per application collection. */
export const CONNECTIONS_STORE = 'DOC_STORE_connections';
export const SETTINGS_STORE = 'DOC_STORE_settings';
export const DATASETS_STORE = 'DOC_STORE_datasets';
export const SESSIONS_STORE = 'DOC_STORE_sessions';
export const DATASOURCE_INVENTORIES_STORE = 'DOC_STORE_datasource_inventories';
export const VERIFIED_QUERIES_STORE = 'DOC_STORE_verified_queries';
export const METRICS_STORE = 'DOC_STORE_metrics';
export const EVAL_RUNS_STORE = 'DOC_STORE_eval_runs';
export const KNOWLEDGE_STORE = 'DOC_STORE_knowledge';
export const AGENTS_STORE = 'DOC_STORE_agents';

/** Identity and access collections, org server mode only (data-model 3.14). */
export const USERS_STORE = 'DOC_STORE_users';
export const GROUPS_STORE = 'DOC_STORE_groups';
export const GROUP_MEMBERS_STORE = 'DOC_STORE_group_members';
export const ROLE_ASSIGNMENTS_STORE = 'DOC_STORE_role_assignments';
export const GROUP_ROLE_MAPPINGS_STORE = 'DOC_STORE_group_role_mappings';
export const AUTH_SESSIONS_STORE = 'DOC_STORE_auth_sessions';
export const ACTIVITY_EVENTS_STORE = 'DOC_STORE_activity_events';

/**
 * Owner-scoped views of the private collections (data-model 3.15): an
 * `OwnedDocStore` over the raw store, provided by the auth module.
 * Repositories of private collections inject these; the raw tokens above
 * stay for startup work that walks every owner's documents.
 */
export const OWNED_SESSIONS_STORE = 'OWNED_DOC_STORE_sessions';
export const OWNED_VERIFIED_QUERIES_STORE = 'OWNED_DOC_STORE_verified_queries';
export const OWNED_METRICS_STORE = 'OWNED_DOC_STORE_metrics';
export const OWNED_EVAL_RUNS_STORE = 'OWNED_DOC_STORE_eval_runs';
export const OWNED_KNOWLEDGE_STORE = 'OWNED_DOC_STORE_knowledge';
export const OWNED_AGENTS_STORE = 'OWNED_DOC_STORE_agents';

/** Each private collection's owned token and the raw store it wraps. */
export const PRIVATE_COLLECTIONS: { owned: string; raw: string }[] = [
  { owned: OWNED_SESSIONS_STORE, raw: SESSIONS_STORE },
  { owned: OWNED_VERIFIED_QUERIES_STORE, raw: VERIFIED_QUERIES_STORE },
  { owned: OWNED_METRICS_STORE, raw: METRICS_STORE },
  { owned: OWNED_EVAL_RUNS_STORE, raw: EVAL_RUNS_STORE },
  { owned: OWNED_KNOWLEDGE_STORE, raw: KNOWLEDGE_STORE },
  { owned: OWNED_AGENTS_STORE, raw: AGENTS_STORE },
];

export function isExistsCondition(v: FilterValue): v is ExistsCondition {
  return typeof v === 'object' && v !== null && '$exists' in v;
}

/** Read a dotted path off a plain object (`scope.namespace`). */
export function getPath(doc: Record<string, unknown>, path: string): unknown {
  let cur: unknown = doc;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Equality/$exists match of a document against a filter. */
export function matchesFilter(
  doc: Record<string, unknown>,
  filter: DocFilter,
): boolean {
  for (const [path, expected] of Object.entries(filter)) {
    const actual = getPath(doc, path);
    if (isExistsCondition(expected)) {
      if (expected.$exists !== (actual !== undefined)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/** Comparator for `SortSpec` over dotted paths; missing values sort last. */
export function compareBySort(sort: SortSpec) {
  const entries = Object.entries(sort);
  return (a: Record<string, unknown>, b: Record<string, unknown>): number => {
    for (const [path, dir] of entries) {
      const av = getPath(a, path);
      const bv = getPath(b, path);
      if (av === bv) continue;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      const cmp = av < bv ? -1 : 1;
      return dir === 1 ? cmp : -cmp;
    }
    return 0;
  };
}
