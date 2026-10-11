/**
 * The DSL's stable reference grammar (ADR-0006): every addressable element
 * of a `DataModel` — an entity, an attribute, a metric, a relationship —
 * has one textual address that survives round-tripping through YAML, a
 * prompt, or the Knowledge Store's mapping target (the ADR this is written
 * for). Keeping parse/resolve/list/format as four small, separately
 * testable functions is what lets each side of that round trip be checked
 * on its own: a malformed address (`parseRef` -> null) is a different
 * failure from a well-formed one that resolves to nothing (`resolveRef` ->
 * null).
 *
 *   <entity>                    an entity
 *   <entity>.<attribute path>   an attribute (the path may itself contain
 *                               dots, e.g. `teams.ratings[].score`)
 *   metric:<name>               a metric
 *   rel:<from>-><to>            a relationship, addressed by its endpoints
 *   rel:<name>                  a relationship, addressed by its own name
 */
import type {
  Attribute,
  DataModel,
  Entity,
  Metric,
  Relationship,
} from '../entities/data-model.entity';
import { findAttribute, splitEntityRef } from '../schema/data-model.schema';

const METRIC_PREFIX = 'metric:';
const REL_PREFIX = 'rel:';
const REL_ARROW = '->';

export type ParsedRef =
  | { kind: 'entity'; entity: string }
  | { kind: 'attribute'; entity: string; attribute: string }
  | { kind: 'metric'; name: string }
  | { kind: 'relationship'; name: string }
  | { kind: 'relationship'; from: string; to: string };

export type ResolvedRef =
  | { kind: 'entity'; ref: string; target: Entity }
  | {
      kind: 'attribute';
      ref: string;
      target: { entity: Entity; attribute: Attribute };
    }
  | { kind: 'metric'; ref: string; target: Metric }
  | { kind: 'relationship'; ref: string; target: Relationship };

/**
 * Syntax only: recognises the grammar's shape without knowing whether the
 * entity/attribute/metric/relationship named actually exists. `null` means
 * the string is not a reference at all (empty, or a malformed `metric:`/
 * `rel:` body) — not that it failed to resolve.
 */
export function parseRef(ref: string): ParsedRef | null {
  const trimmed = ref?.trim() ?? '';
  if (!trimmed) return null;

  if (trimmed.startsWith(METRIC_PREFIX)) {
    const name = trimmed.slice(METRIC_PREFIX.length).trim();
    return name ? { kind: 'metric', name } : null;
  }

  if (trimmed.startsWith(REL_PREFIX)) {
    const body = trimmed.slice(REL_PREFIX.length).trim();
    if (!body) return null;
    const arrow = body.indexOf(REL_ARROW);
    if (arrow < 0) return { kind: 'relationship', name: body };
    const from = body.slice(0, arrow).trim();
    const to = body.slice(arrow + REL_ARROW.length).trim();
    return from && to ? { kind: 'relationship', from, to } : null;
  }

  const attributeRef = splitEntityRef(trimmed);
  if (attributeRef) {
    return { kind: 'attribute', ...attributeRef };
  }
  return { kind: 'entity', entity: trimmed };
}

function findEntity(model: DataModel, name: string): Entity | undefined {
  const wanted = name.toLowerCase();
  return model.entities.find((e) => e.name.toLowerCase() === wanted);
}

function findMetric(model: DataModel, name: string): Metric | undefined {
  const wanted = name.toLowerCase();
  return model.metrics.find((m) => m.name.toLowerCase() === wanted);
}

function findRelationshipByName(
  model: DataModel,
  name: string,
): Relationship | undefined {
  const wanted = name.toLowerCase();
  return model.relationships.find((r) => r.name?.toLowerCase() === wanted);
}

function findRelationshipByEndpoints(
  model: DataModel,
  from: string,
  to: string,
): Relationship | undefined {
  const wantedFrom = from.toLowerCase();
  const wantedTo = to.toLowerCase();
  return model.relationships.find(
    (r) =>
      r.from.toLowerCase() === wantedFrom && r.to.toLowerCase() === wantedTo,
  );
}

/**
 * Parses and looks the reference up in `model`, case-insensitively
 * throughout (matching the DSL's general matching rule). Returns the
 * canonical form in `ref` — the casing actually stored in the model, not
 * whatever casing the caller typed.
 */
export function resolveRef(model: DataModel, ref: string): ResolvedRef | null {
  const parsed = parseRef(ref);
  if (!parsed) return null;

  switch (parsed.kind) {
    case 'entity': {
      const entity = findEntity(model, parsed.entity);
      return entity
        ? { kind: 'entity', ref: formatEntityRef(entity), target: entity }
        : null;
    }
    case 'attribute': {
      const entity = findEntity(model, parsed.entity);
      if (!entity) return null;
      const attribute = findAttribute(entity, parsed.attribute);
      if (!attribute) return null;
      return {
        kind: 'attribute',
        ref: formatAttributeRef(entity, attribute),
        target: { entity, attribute },
      };
    }
    case 'metric': {
      const metric = findMetric(model, parsed.name);
      return metric
        ? { kind: 'metric', ref: formatMetricRef(metric), target: metric }
        : null;
    }
    case 'relationship': {
      const relationship =
        'name' in parsed
          ? findRelationshipByName(model, parsed.name)
          : findRelationshipByEndpoints(model, parsed.from, parsed.to);
      return relationship
        ? {
            kind: 'relationship',
            ref: formatRelationshipRef(relationship),
            target: relationship,
          }
        : null;
    }
  }
}

export function formatEntityRef(entity: Entity): string {
  return entity.name;
}

export function formatAttributeRef(
  entity: Entity,
  attribute: Attribute,
): string {
  return `${entity.name}.${attribute.name}`;
}

export function formatMetricRef(metric: Metric): string {
  return `${METRIC_PREFIX}${metric.name}`;
}

/** Named relationships are addressed by name; unnamed ones by their endpoints. */
export function formatRelationshipRef(relationship: Relationship): string {
  if (relationship.name) return `${REL_PREFIX}${relationship.name}`;
  return `${REL_PREFIX}${relationship.from}${REL_ARROW}${relationship.to}`;
}

/** One canonical reference string per entity, attribute, metric, relationship. */
export function listRefs(model: DataModel): string[] {
  const refs: string[] = [];
  for (const entity of model.entities) {
    refs.push(formatEntityRef(entity));
    for (const attribute of entity.attributes) {
      refs.push(formatAttributeRef(entity, attribute));
    }
  }
  for (const metric of model.metrics) {
    refs.push(formatMetricRef(metric));
  }
  for (const relationship of model.relationships) {
    refs.push(formatRelationshipRef(relationship));
  }
  return refs;
}
