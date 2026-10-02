/**
 * Bootstraps a v1 `DataModel` from a dataset's physical snapshot (ADR-0006:
 * "v1 is bootstrapped from the physical snapshot automatically"). Pure and
 * side-effect free save for logging (`Logger.warn`/`.error` calls record
 * dropped data so a silent, lossy bootstrap is at least visible in the
 * server log) — the service layer (`data-models.service.ts`) owns when this
 * runs and how the result is persisted; this file only turns a `DatasetDoc`
 * + the legacy `metrics` table into a `DataModel`, and also exposes the
 * per-entity building blocks `mergeSnapshot` (dataset re-save merge, review
 * finding 1) reuses to add just the newly-included tables.
 */
import { Logger } from '@nestjs/common';
import type {
  Attribute,
  AttributeRole,
  AttributeType,
  Binding,
  DataModel,
  Entity,
  Metric,
  ModelIssue,
  Relationship,
} from './entities/data-model.entity';
import type {
  DatasetColumnSnapshot,
  DatasetDoc,
  DatasetEntitySnapshot,
} from '../datasets/repositories/datasets.repository';
import type { MetricDoc } from '../metrics/entities/metric.entity';
import { validateDataModel } from './schema/data-model.schema';

const logger = new Logger('data-models/bootstrap');

/** Prompt-grounding sample budget per attribute (ADR-0006's `Attribute.samples`). */
const MAX_SAMPLES = 6;

/** A column whose name alone implies it is an identity, not a measure. */
const KEY_NAME_PATTERN = /(^|_)(id|key|code)$/i;

/** Last segment of `catalog.schema.table`; tolerates a malformed key. */
export function lastSegment(key: string): string {
  const parts = (key ?? '').split('.').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : key;
}

/** Second-to-last segment (`schema`) of `catalog.schema.table`, if present. */
function schemaSegment(key: string): string {
  const parts = (key ?? '').split('.').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

/** Third-to-last segment (`catalog`) of `catalog.schema.table`, if present. */
function catalogSegment(key: string): string {
  const parts = (key ?? '').split('.').filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 3] : '';
}

/**
 * Normalizes any raw identifier (a column or table name) into a valid DSL
 * name: lowercased, every character outside `[a-z0-9_]` collapsed to a
 * single `_` (so `"Match Date"` and `"match--date"` both become
 * `match_date`, not `match___date`), prefixed with `c_` when the result
 * would not otherwise start with a letter (`ENTITY_NAME_PATTERN` /
 * `PATH_SEGMENT_PATTERN` in `schema/data-model.schema.ts` both require
 * that). Review finding 4 — bootstrap used to just `.toLowerCase()` a name
 * and silently produce an invalid model for anything with spaces, a
 * leading digit, or repeated punctuation.
 */
export function safeName(raw: string): string {
  const base = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_');
  return /^[a-z]/.test(base) ? base : `c_${base}`;
}

/** The `[table, schema_table, catalog_schema_table]` candidate chain a
 * colliding entity name escalates through (see `deriveEntityNames`). */
function entityNameChain(key: string): string[] {
  const base = safeName(lastSegment(key));
  const schema = schemaSegment(key);
  const catalog = catalogSegment(key);
  const chain = [base];
  if (schema) chain.push(`${safeName(schema)}_${base}`);
  if (schema && catalog) {
    chain.push(`${safeName(catalog)}_${safeName(schema)}_${base}`);
  }
  return chain;
}

/**
 * Entity name = lowercase, sanitized last segment of the table key
 * (`safeName`). On a collision inside the same dataset, every colliding
 * entity escalates together to the next rung of its name chain —
 * `<schema>_<table>`, then `<catalog>_<schema>_<table>` — so two tables
 * sharing a bare name both get the more specific form rather than one
 * keeping the short name and the other being disambiguated alone. A
 * collision that survives the whole chain (literally the same
 * `catalog.schema.table` twice, or a chain exhausted by missing segments)
 * falls back to a numeric suffix (review finding 4).
 */
export function deriveEntityNames(
  entities: DatasetEntitySnapshot[],
): Map<string, string> {
  const chains = entities.map((entity) => entityNameChain(entity.key));
  const maxLevel = chains.reduce((max, c) => Math.max(max, c.length - 1), 0);
  const resolved = entities.map(() => false);
  const names = new Map<string, string>();
  const used = new Set<string>();

  for (let level = 0; level <= maxLevel; level += 1) {
    const countAtLevel = new Map<string, number>();
    entities.forEach((_, i) => {
      if (resolved[i]) return;
      const name = chains[i][Math.min(level, chains[i].length - 1)];
      countAtLevel.set(name, (countAtLevel.get(name) ?? 0) + 1);
    });
    entities.forEach((entity, i) => {
      if (resolved[i]) return;
      const isLastRung = level >= chains[i].length - 1;
      const name = chains[i][Math.min(level, chains[i].length - 1)];
      if ((countAtLevel.get(name) ?? 0) !== 1 && !isLastRung) return;

      let final = name;
      if (used.has(final)) {
        let n = 2;
        while (used.has(`${name}_${n}`)) n += 1;
        final = `${name}_${n}`;
      }
      used.add(final);
      names.set(entity.key, final);
      resolved[i] = true;
    });
  }
  return names;
}

/**
 * SQL/warehouse type text -> the DSL's portable `AttributeType`. Checked by
 * prefix (dialects spell these out differently: `character varying(255)`,
 * `TIMESTAMP WITHOUT TIME ZONE`, …) with `timestamp`/`datetime` resolved
 * before the exact-match `date`, since both start differently from it but
 * `datetime` would otherwise be swallowed by a naive `date` prefix check.
 */
/** `int`/`integer`, optionally followed by a size like `int(11)` or `int4` —
 * deliberately not a bare `int*` prefix, which would also catch `interval`. */
const INTEGER_PATTERN = /^int(eger)?(\(|[0-9]|$)/;

export function inferAttributeType(rawType: string): AttributeType {
  const t = (rawType ?? '').trim().toLowerCase();
  if (!t) return 'unknown';
  if (
    INTEGER_PATTERN.test(t) ||
    t.startsWith('bigint') ||
    t.startsWith('smallint') ||
    t.startsWith('serial')
  ) {
    return 'integer';
  }
  if (
    t.startsWith('numeric') ||
    t.startsWith('decimal') ||
    t.startsWith('float') ||
    t.startsWith('double') ||
    t.startsWith('real') ||
    t.startsWith('money')
  ) {
    return 'number';
  }
  if (t.startsWith('bool')) return 'boolean';
  if (t.startsWith('timestamp') || t.startsWith('datetime')) return 'datetime';
  if (t === 'date') return 'date';
  if (t.startsWith('time')) return 'time';
  if (
    t.startsWith('json') ||
    t.startsWith('struct') ||
    t.startsWith('map') ||
    t.startsWith('array')
  ) {
    return 'json';
  }
  if (
    t.startsWith('text') ||
    t.startsWith('varchar') ||
    t.startsWith('char') ||
    t.startsWith('string') ||
    t.startsWith('uuid')
  ) {
    return 'string';
  }
  return 'unknown';
}

/** `key`/`time`/`measure`/`dimension` — see `Attribute.role`'s own doc. */
function roleFor(
  column: DatasetColumnSnapshot,
  type: AttributeType,
): AttributeRole {
  if (column.references || KEY_NAME_PATTERN.test(column.name ?? '')) {
    return 'key';
  }
  if (type === 'date' || type === 'datetime') return 'time';
  if (type === 'integer' || type === 'number') return 'measure';
  return 'dimension';
}

/**
 * A sampled value as text; coerced back to its typed form for prompt
 * grounding. An integer sample past `Number.MAX_SAFE_INTEGER` stays a
 * string — `Number(raw)` would silently round it, and a snowflake/bigint id
 * shown rounded is worse grounding than one shown as text (review finding 4).
 */
function coerceSample(
  raw: string,
  type: AttributeType,
): string | number | boolean {
  if (type === 'integer' || type === 'number') {
    const n = Number(raw);
    if (!Number.isNaN(n) && raw.trim() !== '') {
      if (type === 'integer' && Math.abs(n) > Number.MAX_SAFE_INTEGER) {
        return raw;
      }
      return n;
    }
  }
  if (type === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  }
  return raw;
}

export function mapAttribute(column: DatasetColumnSnapshot): Attribute {
  const type = inferAttributeType(column.type);
  const samples = (column.sampleValues ?? [])
    .slice(0, MAX_SAMPLES)
    .map((value) => coerceSample(value, type));
  return {
    name: safeName(column.name),
    type,
    role: roleFor(column, type),
    ...(column.nullable ? { nullable: true } : {}),
    ...(column.description ? { description: column.description } : {}),
    ...(samples.length ? { samples } : {}),
  };
}

/** `columns` override map: only the attributes whose sanitized name differs
 * from the physical column need an entry — same-name columns are implicit. */
function columnOverrides(
  columns: DatasetColumnSnapshot[],
): Record<string, string> | undefined {
  const overrides: Record<string, string> = {};
  for (const column of columns) {
    const attr = safeName(column.name);
    if (attr !== column.name) overrides[attr] = column.name;
  }
  return Object.keys(overrides).length ? overrides : undefined;
}

export function buildBinding(
  dataset: DatasetDoc,
  snapshot: DatasetEntitySnapshot,
): Binding {
  // A dataset saved with no datasource on record (pre-datasource-module
  // data, or a REST/legacy path that never set one) still needs an
  // addressable, non-empty `datasource` — the schema requires `min(1)` and
  // "default" is a clearer placeholder than silently emitting "".
  const datasource = dataset.datasourceId ?? 'default';
  const columns = columnOverrides(snapshot.columns);
  if (dataset.datasourceKind === 'rest') {
    // `rest.connector.ts`'s `resolve()` looks endpoints up by their full
    // `api.<group>.<name>` key, so the binding keeps the whole key rather
    // than splitting it the way a `sql` table name is addressed.
    return {
      kind: 'rest',
      datasource,
      endpoint: snapshot.key,
      ...(columns ? { columns } : {}),
    };
  }
  return {
    kind: 'sql',
    datasource,
    table: snapshot.key,
    ...(columns ? { columns } : {}),
  };
}

/** The binding's physical address — `table` for `sql`, `endpoint` for
 * `rest` — the one address shape `drift.ts` and the metrics bridge both
 * match a legacy metric's or a snapshot table's physical name against. */
export function bindingAddress(binding: Binding): string | null {
  if (binding.kind === 'sql') return binding.table;
  if (binding.kind === 'rest') return binding.endpoint;
  return null;
}

/**
 * Minimal re-implementation of `datasets/relationships.ts`'s private
 * `singularize` — that helper is not exported, and duplicating this much
 * smaller subset (enough for `<table>_id` key detection) is cheaper than
 * widening that module's surface for one caller.
 */
function singularize(word: string): string {
  const lower = word.toLowerCase();
  if (lower.length < 4) return lower;
  if (/(?:s|x|z|ch|sh)es$/.test(lower)) return lower.slice(0, -2);
  if (/[^aeiou]ies$/.test(lower)) return `${lower.slice(0, -3)}y`;
  if (/(?:ss|us|is)$/.test(lower)) return lower;
  if (/s$/.test(lower)) return lower.slice(0, -1);
  return lower;
}

/** `['id']`, or `['<singular entity name>_id']` when that attribute exists. */
export function deriveKey(
  entityName: string,
  attributes: Attribute[],
): string[] | undefined {
  const names = new Set(attributes.map((a) => a.name));
  if (names.has('id')) return ['id'];
  const candidate = `${singularize(entityName)}_id`;
  return names.has(candidate) ? [candidate] : undefined;
}

/**
 * Relationships declared by foreign-key columns, in both directions: a
 * column with `.references` on *either* side of the pair produces an edge
 * as long as both the owning table and the target table have a logical
 * name in `entityNames` — which is what lets `mergeSnapshot` reuse this
 * unchanged for "the new entity's relationships to what already existed,
 * and what already existed's relationships to the new entity" (review
 * finding 1) by simply passing a name map that covers old and new entities
 * together.
 */
export function buildRelationships(
  entities: DatasetEntitySnapshot[],
  entityNames: Map<string, string>,
): Relationship[] {
  const relationships: Relationship[] = [];
  for (const entity of entities) {
    const fromName = entityNames.get(entity.key);
    if (!fromName) continue;
    for (const column of entity.columns) {
      const ref = column.references;
      if (!ref) continue;
      // Target table not included in this dataset: not this model's concern.
      const toName = entityNames.get(ref.entity);
      if (!toName) continue;
      relationships.push({
        from: `${fromName}.${safeName(column.name)}`,
        to: `${toName}.${safeName(ref.column)}`,
        cardinality: 'many_to_one',
        source: ref.source,
      });
    }
  }
  return relationships;
}

/**
 * Maps a legacy metric's physical `dimensions` onto the entity's logical
 * attribute names where they match (case-insensitive); a dimension with no
 * matching attribute is dropped (not kept verbatim) and logged, since a
 * dimension referencing a column the model does not know about would fail
 * `validateDataModel`'s "resolves within the entity" check and block the
 * whole bootstrap (review finding 4). Shared between bootstrap's metric
 * import and the live metrics-panel sync (`DataModelsService.syncMetric`)
 * so both apply the exact same rule.
 */
export function mapDimensionNames(
  dimensions: string[],
  attributes: Attribute[],
  metricName?: string,
): string[] {
  const mapped: string[] = [];
  for (const dimension of dimensions) {
    const match = attributes.find(
      (attribute) => attribute.name.toLowerCase() === dimension.toLowerCase(),
    );
    if (match) {
      mapped.push(match.name);
    } else {
      logger.warn(
        `Dropping dimension "${dimension}"${
          metricName ? ` on metric "${metricName}"` : ''
        }: no matching attribute`,
      );
    }
  }
  return mapped;
}

/** A legacy `MetricDoc`, converted onto one entity already resolved to its
 * logical name/attributes — the single place both bootstrap's `mapMetrics`
 * and `DataModelsService.syncMetric` build a model `Metric` from the
 * legacy flat shape, so the two paths cannot drift apart. */
export function toModelMetric(
  legacy: MetricDoc,
  entityName: string,
  attributes: Attribute[],
): Metric {
  const dimensions = mapDimensionNames(
    legacy.dimensions ?? [],
    attributes,
    legacy.name,
  );
  return {
    name: legacy.name,
    label: legacy.label,
    ...(legacy.description ? { description: legacy.description } : {}),
    entity: entityName,
    expressions: { sql: legacy.expression },
    ...(dimensions.length ? { dimensions } : {}),
    ...(legacy.sourceVerifiedQueryId
      ? { sourceVerifiedQueryId: legacy.sourceVerifiedQueryId }
      : {}),
  };
}

function mapMetrics(
  legacyMetrics: MetricDoc[],
  entities: DatasetEntitySnapshot[],
  entityNames: Map<string, string>,
  attributesByEntityName: Map<string, Attribute[]>,
): Metric[] {
  const entityByTable = new Map(
    entities.map((entity) => [entity.key.toLowerCase(), entity]),
  );
  const metrics: Metric[] = [];
  for (const legacy of legacyMetrics) {
    const snapshot = entityByTable.get((legacy.entity ?? '').toLowerCase());
    if (!snapshot) continue; // metric's table is not part of this dataset
    const logicalName = entityNames.get(snapshot.key);
    if (!logicalName) continue;
    const attributes = attributesByEntityName.get(logicalName) ?? [];
    metrics.push(toModelMetric(legacy, logicalName, attributes));
  }
  return metrics;
}

/** One entity, built the same way regardless of whether it is part of a
 * fresh bootstrap or a `mergeSnapshot` addition. */
export function buildEntity(
  dataset: DatasetDoc,
  snapshot: DatasetEntitySnapshot,
  name: string,
): Entity {
  const attributes = snapshot.columns.map(mapAttribute);
  return {
    name,
    key: deriveKey(name, attributes),
    bindings: [buildBinding(dataset, snapshot)],
    attributes,
  };
}

/**
 * The bootstrap entry point: a dataset's physical snapshot + the legacy
 * metrics that apply to it, turned into a numbered `DataModel` version, and
 * validated before being handed back. The caller (`DataModelsService`)
 * decides the version number — 1 for a brand new model, or a later number
 * when `rebootstrap` refreshes an existing one — and refuses to persist a
 * model this returns with non-empty `issues` (review finding 4: a silently
 * invalid bootstrap used to be worse than a loud one).
 */
export function bootstrapFromSnapshot(
  dataset: DatasetDoc,
  legacyMetrics: MetricDoc[],
  version: number,
): { model: DataModel; issues: ModelIssue[] } {
  const snapshotEntities = dataset.entities ?? [];
  const entityNames = deriveEntityNames(snapshotEntities);
  const attributesByEntityName = new Map<string, Attribute[]>();

  const entities: Entity[] = snapshotEntities.map((snapshot) => {
    const name =
      entityNames.get(snapshot.key) ?? safeName(lastSegment(snapshot.key));
    const entity = buildEntity(dataset, snapshot, name);
    attributesByEntityName.set(name, entity.attributes);
    return entity;
  });

  const draft: DataModel = {
    model: dataset.name,
    version,
    entities,
    relationships: buildRelationships(snapshotEntities, entityNames),
    metrics: mapMetrics(
      legacyMetrics,
      snapshotEntities,
      entityNames,
      attributesByEntityName,
    ),
  };

  const validated = validateDataModel(draft);
  if (validated.model) return { model: validated.model, issues: [] };
  return { model: draft, issues: validated.issues };
}
