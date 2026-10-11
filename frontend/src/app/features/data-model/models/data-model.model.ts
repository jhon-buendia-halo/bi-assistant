/**
 * The storage-neutral data model DSL (ADR-0006), mirrored from
 * `backend/src/modules/data-models/entities/data-model.entity.ts`. Copied
 * rather than imported across the frontend/backend boundary (there is no
 * shared package) — keep this file's shapes in lockstep with the backend
 * by hand when the DSL changes.
 */

export type AttributeType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'time'
  | 'json'
  | 'unknown';

export const ATTRIBUTE_TYPES: AttributeType[] = [
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'datetime',
  'time',
  'json',
  'unknown',
];

export type AttributeRole = 'key' | 'dimension' | 'measure' | 'time';

export const ATTRIBUTE_ROLES: AttributeRole[] = [
  'key',
  'dimension',
  'measure',
  'time',
];

export interface Attribute {
  name: string;
  type: AttributeType;
  role?: AttributeRole;
  nullable?: boolean;
  description?: string;
  samples?: (string | number | boolean)[];
}

export type Binding =
  | {
      kind: 'sql';
      datasource: string;
      table: string;
      columns?: Record<string, string>;
    }
  | {
      kind: 'rest';
      datasource: string;
      endpoint: string;
      recordPath?: string;
      columns?: Record<string, string>;
    }
  | {
      kind: 'mongo';
      datasource: string;
      collection: string;
    }
  | {
      kind: 'file';
      datasource?: string;
      path: string;
      format: 'csv' | 'json' | 'ndjson';
      recordPath?: string;
    };

export interface Entity {
  name: string;
  label?: string;
  description?: string;
  key?: string[];
  bindings: Binding[];
  attributes: Attribute[];
}

export type Cardinality =
  | 'one_to_one'
  | 'many_to_one'
  | 'one_to_many'
  | 'many_to_many';

export const CARDINALITIES: Cardinality[] = [
  'one_to_one',
  'many_to_one',
  'one_to_many',
  'many_to_many',
];

export interface Relationship {
  name?: string;
  from: string;
  to: string;
  cardinality: Cardinality;
  source: 'declared' | 'inferred' | 'user';
  description?: string;
}

export type PredicateOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'between'
  | 'is_null'
  | 'not_null'
  | 'contains'
  | 'starts_with';

export const PREDICATE_OPS: PredicateOp[] = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'between',
  'is_null',
  'not_null',
  'contains',
  'starts_with',
];

/** A single `{ attr, op, value }` leaf — the model-metrics panel's `where`
 * builder only offers one leaf at a time (no and/or nesting), a deliberate
 * scope reduction from the DSL's full boolean tree (see this feature's
 * README note in `model-metrics-panel.ts`). */
export type Predicate =
  | { and: Predicate[] }
  | { or: Predicate[] }
  | { not: Predicate }
  | { attr: string; op: PredicateOp; value?: unknown };

export type Aggregation =
  | 'sum'
  | 'count'
  | 'count_distinct'
  | 'avg'
  | 'min'
  | 'max'
  | 'ratio';

export const AGGREGATIONS: Aggregation[] = [
  'sum',
  'count',
  'count_distinct',
  'avg',
  'min',
  'max',
  'ratio',
];

export interface Metric {
  name: string;
  label: string;
  description?: string;
  entity: string;
  agg?: Aggregation;
  of?: string;
  numerator?: string;
  denominator?: string;
  where?: Predicate;
  dimensions?: string[];
  expressions?: { sql?: string };
  sourceVerifiedQueryId?: string;
}

export interface DataModel {
  model: string;
  version: number;
  description?: string;
  entities: Entity[];
  relationships: Relationship[];
  metrics: Metric[];
}

export interface ModelIssue {
  path: string;
  message: string;
  line?: number;
  col?: number;
}

export interface DataModelVersion {
  version: number;
  createdAt: string;
  source: 'bootstrap' | 'user' | 'import';
  yaml: string;
  model: DataModel;
  note?: string;
}

export interface DriftReport {
  checkedAt: string;
  snapshotOf: number;
  added: string[];
  removed: string[];
  changed: { ref: string; from: string; to: string }[];
  entitiesAdded: string[];
  entitiesRemoved: string[];
}

export interface ResolveResult {
  ref: string;
  resolved: boolean;
  kind?: 'entity' | 'attribute' | 'metric' | 'relationship';
  target?: unknown;
}

export interface MetricCandidate {
  verifiedQueryId: string;
  name: string;
  label: string;
  entity: string;
  datasourceId?: string;
  sql: string;
}

/** `GET /datasets/:name/model`. */
export interface ModelResponse {
  dataset: string;
  currentVersion: number;
  version: DataModelVersion;
}

/** The `{ ok, version }` / `{ ok: false, errors }` shape shared by every
 * model write endpoint (`PUT`/`import`/model-metrics create-update-delete). */
export interface ModelSaveResult {
  ok: boolean;
  version?: number;
  currentVersion?: number;
  errors?: ModelIssue[];
}
