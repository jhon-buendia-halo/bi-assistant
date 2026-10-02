/**
 * The storage-neutral data model DSL (ADR-0006): a logical description of a
 * dataset's entities, relationships and metrics that the assistant reasons
 * over, kept independent of the physical store it happens to be bound to
 * today. One `DataModel` document per dataset; versions are immutable and a
 * current pointer selects the active one (persistence lives in the
 * repository layer, not here — this file is the pure shape).
 */

/**
 * The attribute's logical shape. Kept small and portable (not a dialect's
 * column type) so the same model describes a Postgres `numeric`, a Mongo
 * `Decimal128` or a REST API's JSON number identically. `unknown` is a
 * deliberate escape hatch for bootstrap: a snapshot column the inferencer
 * could not classify still gets an attribute instead of being dropped.
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

/**
 * What an attribute is *for*, not just its type — this is what lets a query
 * layer or prompt tell "the thing you group by" from "the thing you sum"
 * without re-deriving it from naming heuristics every turn. `key` marks
 * identity columns (joinable, not aggregatable); `time` marks the attribute
 * used for date-range filtering/bucketing.
 */
export type AttributeRole = 'key' | 'dimension' | 'measure' | 'time';

/**
 * One field of an entity, addressed by a path rather than a bare name so
 * nested/array-shaped sources (a REST payload, a Mongo document) describe
 * their shape without flattening it first. A path is segments joined by
 * `.`; a segment may end in `[]` to mean "one level of array here" — e.g.
 * `ratings[].score` is "the `score` field of each element of the `ratings`
 * array". Each segment matches `/^[a-z][a-z0-9_]*(\[\])?$/i`; matching
 * against a path elsewhere in the model (bindings, relationships, metrics)
 * is case-insensitive throughout the DSL.
 *
 * `samples` exists for prompt grounding: a handful of real values do more to
 * stop the assistant guessing a date format or an enum's casing than the
 * type name alone.
 */
export interface Attribute {
  name: string;
  type: AttributeType;
  role?: AttributeRole;
  nullable?: boolean;
  description?: string;
  samples?: (string | number | boolean)[];
}

/**
 * Where an entity's rows physically live, one variant per datasource kind.
 * An entity can carry more than one binding (e.g. a `sql` primary source
 * plus a `file` export) — the DSL does not pick one, the adapter resolving
 * a query does. `columns` is only needed when the physical name differs
 * from the attribute's own name; omitting it means "same name".
 *
 * Only `sql` and `rest` have adapters in the beta (ADR-0006); `mongo` and
 * `file` are accepted so a model can describe a dataset ahead of its
 * adapter landing, without a breaking shape change later.
 */
export type Binding =
  | {
      kind: 'sql';
      datasource: string;
      /** `catalog.schema.table` — always three dot-separated segments. */
      table: string;
      columns?: Record<string, string>;
    }
  | {
      kind: 'rest';
      datasource: string;
      endpoint: string;
      /** Dot path into the response body where the record array lives. */
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
      /** Omitted for a path the app resolves itself (e.g. an export). */
      datasource?: string;
      path: string;
      format: 'csv' | 'json' | 'ndjson';
      recordPath?: string;
    };

/**
 * A logical table/collection the assistant can query. `key` names the
 * attribute(s) that uniquely identify a row — used for join inference and
 * for telling a dimension from an identity column — and is independent of
 * what the physical store happens to call its primary key.
 */
export interface Entity {
  name: string;
  label?: string;
  description?: string;
  key?: string[];
  bindings: Binding[];
  attributes: Attribute[];
}

/**
 * Join multiplicity, spelled out rather than inferred at query time — the
 * same asymmetry as `datasets/relationships.ts`: a wrong cardinality is
 * followed confidently into a silently-wrong fan-out, so it is recorded
 * once, with provenance, rather than re-guessed per question.
 */
export type Cardinality =
  'one_to_one' | 'many_to_one' | 'one_to_many' | 'many_to_many';

/**
 * An edge between two attributes. `from`/`to` are `<entity>.<attribute
 * path>` references (see `dsl/references.ts`). `source` is provenance, not
 * configuration: `declared` came from the datasource's own foreign keys,
 * `inferred` from naming heuristics (ported from `datasets/relationships.ts`
 * onto the model), `user` from a person confirming or correcting one —
 * the same three-way distinction `applyReferences` already makes, now
 * recorded against the logical model instead of the physical snapshot.
 */
export interface Relationship {
  name?: string;
  from: string;
  to: string;
  cardinality: Cardinality;
  source: 'declared' | 'inferred' | 'user';
  description?: string;
}

/**
 * Comparison operators for a portable predicate (below). Deliberately a
 * closed set rather than "any SQL expression" — this is what keeps a
 * predicate dialect-neutral and safe to compile against Postgres,
 * Databricks SQL or an in-process filter alike (ADR-0007's logical query
 * layer is the consumer).
 */
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

/**
 * A boolean filter tree over attributes, portable across datasource kinds.
 * Metrics' `where` and the future logical query layer's filters share this
 * one shape so a predicate written once compiles the same way everywhere.
 */
export type Predicate =
  | { and: Predicate[] }
  | { or: Predicate[] }
  | { not: Predicate }
  | { attr: string; op: PredicateOp; value?: unknown };

/**
 * How a metric's number is produced. `ratio` is its own case (rather than
 * `sum`-of-a-division) because its operands are two *other* metrics, not
 * two attributes — composing existing business meaning instead of
 * re-deriving it.
 */
export type Aggregation =
  'sum' | 'count' | 'count_distinct' | 'avg' | 'min' | 'max' | 'ratio';

/**
 * The semantic layer entry, migrated here from the standalone `metrics`
 * table (ADR-0006) so a metric is addressed through the model instead of a
 * separate `catalog.schema.table` string. `agg`/`of` cover the common
 * aggregation shape; `expressions.sql` is the dialect-tagged escape hatch
 * for anything the portable core cannot express yet — both may be present
 * (the SQL as a faster or richer path, the portable form kept for compiled
 * query layers that do not read SQL).
 */
export interface Metric {
  name: string;
  label: string;
  description?: string;
  entity: string;
  agg?: Aggregation;
  /** Attribute the aggregation runs over; not used by `count` or `ratio`. */
  of?: string;
  /** Other metric's name — only for `agg: 'ratio'`. */
  numerator?: string;
  /** Other metric's name — only for `agg: 'ratio'`. */
  denominator?: string;
  where?: Predicate;
  dimensions?: string[];
  expressions?: { sql?: string };
  /** Promotion provenance — the verified query this metric was lifted from. */
  sourceVerifiedQueryId?: string;
}

/**
 * The document itself: one per dataset, versioned and immutable once
 * written (the repository layer appends a new version rather than
 * mutating this shape in place).
 */
export interface DataModel {
  model: string;
  version: number;
  description?: string;
  entities: Entity[];
  relationships: Relationship[];
  metrics: Metric[];
}

/**
 * A single validation failure, precise enough to point an editor or a UI
 * at the exact offending node. `path` mirrors the shape it names, e.g.
 * `entities[0].bindings[0].columns.attendance` or
 * `entities[0].attributes[2].type` — array indices in brackets, object keys
 * dot-separated, matching how `dsl/yaml.ts` locates the source node for
 * `line`/`col`. Those are only set once a YAML source is available
 * (`parseDataModelYaml`/`attachPositions`); schema-only validation
 * (`validateDataModel`) leaves them undefined.
 */
export interface ModelIssue {
  path: string;
  message: string;
  line?: number;
  col?: number;
}
