/**
 * The logical query layer's one entry point for "what can the assistant see
 * this turn" (ADR-0007): composes the union of a session's dataset models
 * into one `SessionModel`, and renders it as the single system block that
 * replaces `entityOrientationLines` + `joinHintBlock` +
 * `metrics.definitionBlock`. Pure — no Nest DI, no I/O — so `SessionsService`,
 * the eval harness and a unit test can all build the same thing from plain
 * `DataModel` documents.
 *
 * Composition never exposes a physical table name, a datasource id/kind or a
 * SQL dialect word to the model: `SessionEntity.table`/`datasourceId` exist
 * only for the compiler (`query/compile-sql.ts`) to resolve, and
 * `renderModelBlock` never prints them.
 */
import type {
  Attribute,
  DataModel,
  Entity,
  Metric,
  Relationship,
} from './entities/data-model.entity';
import { bindingAddress } from './bootstrap';
import { splitEntityRef } from './schema/data-model.schema';

/** One queryable logical entity, the union of every dataset that binds it. */
export interface SessionEntity {
  /** Logical name as the assistant sees it — unique within the session. */
  name: string;
  label?: string;
  description?: string;
  /** Every dataset that contributes this entity (>1 only when deduped). */
  datasets: string[];
  /** The binding's datasource — compiler-only, never rendered. */
  datasourceId: string;
  /** Storage kind of the binding actually used — compiler-only. */
  kind: 'sql' | 'rest';
  /** Physical table (`sql`) or endpoint (`rest`) — compiler-only. */
  table: string;
  /** Lowercased attribute name -> physical column name. Compiler-only. */
  columns: Record<string, string>;
  key?: string[];
  attributes: Attribute[];
  /** True when the name was qualified (`<dataset>__<entity>`) to resolve a
   * same-name-different-table collision across this session's datasets. */
  qualified: boolean;
}

export interface SessionModel {
  entities: SessionEntity[];
  /** `from`/`to` rewritten to the final (possibly qualified) entity names. */
  relationships: Relationship[];
  /** `entity` rewritten the same way; `name` qualified on collision. */
  metrics: Metric[];
  /** Human-readable notes about collisions this composition resolved —
   * surfaced in the rendered block so a reader knows why a name changed. */
  notes: string[];
}

function lower(value: string): string {
  return value.toLowerCase();
}

/** Identifier-safe fragment of a dataset name, for qualifying collisions. */
function datasetSlug(dataset: string): string {
  const slug = dataset
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'dataset';
}

/** The entity's first `sql`/`rest` binding — the only kinds with a compiler
 * (ADR-0007; mongo/file are schema-only in the beta and are skipped here,
 * never surfaced as queryable). */
function queryableBinding(entity: Entity): {
  kind: 'sql' | 'rest';
  datasource: string;
  address: string;
  columns?: Record<string, string>;
} | null {
  const binding = entity.bindings.find(
    (b) => b.kind === 'sql' || b.kind === 'rest',
  );
  if (!binding || (binding.kind !== 'sql' && binding.kind !== 'rest')) {
    return null;
  }
  const address = bindingAddress(binding);
  if (!address) return null;
  return {
    kind: binding.kind,
    datasource: binding.datasource,
    address,
    columns: binding.columns,
  };
}

function columnsMap(
  entity: Entity,
  overrides?: Record<string, string>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const attribute of entity.attributes) {
    map[lower(attribute.name)] = overrides?.[attribute.name] ?? attribute.name;
  }
  return map;
}

interface DatasetEntity {
  dataset: string;
  entity: Entity;
  binding: ReturnType<typeof queryableBinding>;
}

/**
 * Builds one session entity from a group of (dataset, entity) pairs that all
 * ended up resolving to the same final name — either a single contributor or
 * several that dedupe because they bind the exact same physical address.
 */
function mergeEntity(
  name: string,
  group: DatasetEntity[],
  qualified: boolean,
): SessionEntity {
  const first = group[0];
  const binding = first.binding!;
  return {
    name,
    label: first.entity.label,
    description: first.entity.description,
    datasets: Array.from(new Set(group.map((g) => g.dataset))),
    datasourceId: binding.datasource,
    kind: binding.kind,
    table: binding.address,
    columns: columnsMap(first.entity, binding.columns),
    key: first.entity.key,
    attributes: first.entity.attributes,
    qualified,
  };
}

/**
 * The union of a session's current dataset models (ADR-0007 §1). Entities
 * keep their logical name when unique, or when every dataset binding that
 * name points at the same physical address (deduped into one entity
 * remembering every contributing dataset); when two datasets bind the same
 * logical name to *different* addresses, each copy is qualified
 * `<datasetSlug>__<entity>` and a note records why.
 */
export function composeSessionModel(
  models: { dataset: string; model: DataModel }[],
): SessionModel {
  const notes: string[] = [];
  const byName = new Map<string, DatasetEntity[]>();

  for (const { dataset, model } of models) {
    for (const entity of model.entities) {
      const binding = queryableBinding(entity);
      if (!binding) continue; // mongo/file: not queryable in the beta.
      const key = lower(entity.name);
      const group = byName.get(key) ?? [];
      group.push({ dataset, entity, binding });
      byName.set(key, group);
    }
  }

  const entities: SessionEntity[] = [];
  // `<dataset>:<original logical name>` -> final (possibly qualified) name,
  // used below to rewrite relationships and metrics.
  const rename = new Map<string, string>();

  for (const [, group] of byName) {
    const addresses = new Set(
      group.map(
        (g) =>
          `${g.binding!.kind}:${g.binding!.datasource}:${g.binding!.address}`,
      ),
    );
    if (addresses.size === 1) {
      const name = group[0].entity.name;
      entities.push(mergeEntity(name, group, false));
      for (const g of group)
        rename.set(`${g.dataset}:${lower(g.entity.name)}`, name);
      continue;
    }
    // Same logical name, different physical tables — qualify every copy.
    const originalName = group[0].entity.name;
    notes.push(
      `"${originalName}" is bound to different tables across datasets ` +
        `(${group.map((g) => g.dataset).join(', ')}); qualified per dataset.`,
    );
    for (const g of group) {
      const qualifiedName = `${datasetSlug(g.dataset)}__${g.entity.name}`;
      entities.push(mergeEntity(qualifiedName, [g], true));
      rename.set(`${g.dataset}:${lower(g.entity.name)}`, qualifiedName);
    }
  }

  const relationships: Relationship[] = [];
  const seenRelationships = new Set<string>();

  for (const { dataset, model } of models) {
    const renameInDataset = (ref: string): string | null => {
      const parsed = splitEntityRef(ref);
      if (!parsed) return null;
      const finalName = rename.get(`${dataset}:${lower(parsed.entity)}`);
      return finalName ? `${finalName}.${parsed.attribute}` : null;
    };

    for (const relationship of model.relationships) {
      const from = renameInDataset(relationship.from);
      const to = renameInDataset(relationship.to);
      if (!from || !to) continue; // one endpoint's entity was not queryable.
      const dedupeKey = `${from}->${to}:${relationship.cardinality}`;
      if (seenRelationships.has(dedupeKey)) continue;
      seenRelationships.add(dedupeKey);
      relationships.push({ ...relationship, from, to });
    }
  }

  // Metrics, in two passes: a ratio's `numerator`/`denominator` name another
  // metric *in the same source dataset*, by its original (pre-qualification)
  // name — so the final rewrite can only happen once every metric's fate
  // (kept as-is, or qualified on collision) is known, not while still
  // deciding it. `metricFinalName` is that decision, keyed by
  // `<dataset>:<original name, lowercased>` -> the name this composition
  // gives it.
  const metricFinalName = new Map<string, string>();
  const metricEntityByName = new Map<string, string>();
  const metricSource = new Map<string, { dataset: string; metric: Metric }>();

  for (const { dataset, model } of models) {
    for (const metric of model.metrics) {
      const finalEntity = rename.get(`${dataset}:${lower(metric.entity)}`);
      if (!finalEntity) continue; // metric's entity was not queryable.
      const nameLower = lower(metric.name);
      const owner = metricEntityByName.get(nameLower);
      let finalName: string;
      if (owner === undefined) {
        metricEntityByName.set(nameLower, finalEntity);
        finalName = metric.name;
        metricSource.set(lower(finalName), { dataset, metric });
      } else if (owner === finalEntity) {
        // Same metric, same entity — already present (or a legitimate
        // duplicate from a merge); keep the first copy's name, nothing new
        // to record in `metricSource`.
        finalName = metric.name;
      } else {
        finalName = `${datasetSlug(dataset)}__${metric.name}`;
        notes.push(
          `metric "${metric.name}" is defined on more than one entity across ` +
            `this session's datasets; "${dataset}"'s copy is addressed as "${finalName}".`,
        );
        metricSource.set(lower(finalName), { dataset, metric });
      }
      metricFinalName.set(`${dataset}:${nameLower}`, finalName);
    }
  }

  const metrics: Metric[] = [];
  for (const { dataset, metric } of metricSource.values()) {
    const finalEntity = rename.get(`${dataset}:${lower(metric.entity)}`)!;
    const finalName = metricFinalName.get(`${dataset}:${lower(metric.name)}`)!;
    const rewriteOperand = (operand?: string): string | undefined =>
      operand
        ? (metricFinalName.get(`${dataset}:${lower(operand)}`) ?? operand)
        : operand;
    const ratioFields =
      metric.agg === 'ratio'
        ? {
            numerator: rewriteOperand(metric.numerator),
            denominator: rewriteOperand(metric.denominator),
          }
        : {};
    metrics.push({
      ...metric,
      ...ratioFields,
      name: finalName,
      entity: finalEntity,
    });
  }

  return { entities, relationships, metrics, notes };
}

/** Sample values rendered inline, each clipped so one outlier cannot blow
 * the attribute line's budget. */
const MAX_SAMPLE_CHARS = 40;

function formatSample(value: string | number | boolean): string {
  const text = String(value);
  return text.length > MAX_SAMPLE_CHARS
    ? `${text.slice(0, MAX_SAMPLE_CHARS - 1)}…`
    : text;
}

/** The relationship whose `from` side is exactly `<entityName>.<attrName>`,
 * if any — rendered inline on the attribute so a reader sees the join target
 * without a separate hint block. */
function outgoingRelationship(
  relationships: Relationship[],
  entityName: string,
  attrName: string,
): Relationship | undefined {
  const ref = `${lower(entityName)}.${lower(attrName)}`;
  return relationships.find((r) => lower(r.from) === ref);
}

function formatMetricFormula(metric: Metric): string {
  if (metric.agg === 'ratio') {
    return `${metric.numerator} / ${metric.denominator}`;
  }
  if (metric.agg === 'count') {
    return 'count(*)';
  }
  if (metric.agg && metric.of) {
    return `${metric.agg}(${metric.of})`;
  }
  // Portable form unavailable — the dialect-tagged escape hatch (ADR-0006)
  // is written against a binding's own physical columns, so the raw SQL
  // text is exactly the kind of physical detail this block must never show
  // the assistant (ADR-0007 §4); say only that it exists.
  return metric.expressions?.sql ? '(custom expression)' : '(no formula)';
}

function entityLines(
  model: SessionModel,
  entity: SessionEntity,
  options: { samples: number; descriptions: boolean },
): string[] {
  const lines: string[] = [];
  const datasetLabel =
    entity.datasets.length > 1
      ? `datasets ${entity.datasets.map((d) => `"${d}"`).join(', ')}`
      : `dataset "${entity.datasets[0]}"`;
  const description =
    options.descriptions && entity.description
      ? ` — ${entity.description}`
      : '';
  lines.push(`- ${entity.name} (${datasetLabel})${description}`);
  if (entity.key?.length) {
    lines.push(`    key: ${entity.key.join(', ')}`);
  }

  const attrParts = entity.attributes.map((attribute) => {
    const parts = [
      attribute.name,
      attribute.role ?? 'dimension',
      attribute.type,
    ];
    const rel = outgoingRelationship(
      model.relationships,
      entity.name,
      attribute.name,
    );
    if (rel) {
      // The exact `via` ref `joins[].via` needs (ADR-0007): "declared" uses a
      // solid arrow, "inferred"/"user" a tilde to hint at confidence, and the
      // relationship's own `name` (when set) is the shorter alternative to
      // the same `via`.
      const arrow = rel.source === 'declared' ? '->' : '~>';
      const named = rel.name ? `, named "${rel.name}"` : '';
      parts.push(
        `via ${rel.from}${arrow}${rel.to} (${rel.cardinality}${named})`,
      );
    }
    const samples = options.samples
      ? (attribute.samples ?? []).slice(0, options.samples)
      : [];
    const joined = parts.join(' ');
    return samples.length
      ? `${joined} [e.g. ${samples.map(formatSample).join(', ')}]`
      : joined;
  });
  lines.push(`    attributes: ${attrParts.join('; ')}`);

  const entityMetrics = model.metrics.filter((m) => m.entity === entity.name);
  if (entityMetrics.length) {
    const metricParts = entityMetrics.map(
      (m) => `${m.name} (${m.label}) = ${formatMetricFormula(m)}`,
    );
    lines.push(`    metrics: ${metricParts.join('; ')}`);
  }
  return lines;
}

const HEADER =
  'Entities in this session (logical names; query them with query_entities):';
const DEFAULT_BUDGET_CHARS = 8_000;
const DEFAULT_SAMPLES = 3;

/**
 * The ONE system block the assistant gets about the data model — replaces
 * `entityOrientationLines` + `joinHintBlock` + `metrics.definitionBlock`
 * (ADR-0007). Whole model, no pruning, within budget: samples are dropped
 * first, then descriptions, then the entity list itself is truncated with a
 * pointer at `describe_entity`. Never emits a physical table name, a
 * datasource id/kind or a dialect word.
 */
export function renderModelBlock(
  model: SessionModel,
  options: { budgetChars?: number; samples?: number } = {},
): string {
  const budgetChars = options.budgetChars ?? DEFAULT_BUDGET_CHARS;
  const samples = options.samples ?? DEFAULT_SAMPLES;

  const stages: { samples: number; descriptions: boolean }[] = [
    { samples, descriptions: true },
    { samples: 0, descriptions: true },
    { samples: 0, descriptions: false },
  ];

  for (const stage of stages) {
    const body = [
      HEADER,
      ...model.entities.flatMap((e) => entityLines(model, e, stage)),
      ...model.notes.map((n) => `Note: ${n}`),
    ].join('\n');
    if (body.length <= budgetChars) return body;
  }

  // Even the leanest rendering of every entity overflows the budget — keep as
  // many whole entities as fit and say how many were dropped.
  const stage = stages[stages.length - 1];
  const lines = [HEADER];
  let used = HEADER.length;
  let included = 0;
  for (const entity of model.entities) {
    const block = entityLines(model, entity, stage).join('\n');
    const addedLength = block.length + 1;
    if (used + addedLength > budgetChars) break;
    lines.push(block);
    used += addedLength;
    included += 1;
  }
  const remaining = model.entities.length - included;
  if (remaining > 0) {
    lines.push(`(… ${remaining} more entities; call describe_entity)`);
  }
  return lines.join('\n');
}
