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
