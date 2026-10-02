/**
 * Structural validation (Zod) for the data model DSL, plus the semantic
 * checks Zod's shape-only parsing cannot express — a field can be the right
 * *type* and still reference something that does not exist (an attribute, a
 * metric, a table). Both run through `validateDataModel`, the single entry
 * point `dsl/yaml.ts` and the repository layer call; neither of them talks
 * to Zod directly, so the conversion from Zod's issue shape to our
 * `ModelIssue.path` syntax lives in exactly one place.
 *
 * Each sub-schema carries a `meta({ id })` so `z.toJSONSchema` extracts it
 * into `$defs` instead of inlining it — the JSON Schema is meant to be read
 * (an editor's autocomplete, a docs page), and a flat wall of inlined
 * `anyOf`s is not.
 */
import { z } from 'zod';
import type {
  DataModel,
  ModelIssue,
  Predicate,
} from '../entities/data-model.entity';

const attributeTypeSchema = z.enum([
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'datetime',
  'time',
  'json',
  'unknown',
]);

const attributeRoleSchema = z.enum(['key', 'dimension', 'measure', 'time']);

/**
 * `Attribute.name` is intentionally just `z.string()` here: it is a path
 * (`ratings[].score`), not a simple identifier, and its per-segment grammar
 * is a semantic check (`checkAttributePaths`) so the failure can point at
 * the exact malformed segment instead of a generic Zod regex mismatch.
 */
const attributeSchema = z
  .strictObject({
    name: z.string().min(1),
    type: attributeTypeSchema,
    role: attributeRoleSchema.optional(),
    nullable: z.boolean().optional(),
    description: z.string().optional(),
    samples: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .meta({ id: 'Attribute' });

const columnsSchema = z.record(z.string(), z.string());

const sqlBindingSchema = z
  .strictObject({
    kind: z.literal('sql'),
    datasource: z.string().min(1),
    table: z.string().min(1),
    columns: columnsSchema.optional(),
  })
  .meta({ id: 'SqlBinding' });

const restBindingSchema = z
  .strictObject({
    kind: z.literal('rest'),
    datasource: z.string().min(1),
    endpoint: z.string().min(1),
    recordPath: z.string().optional(),
    columns: columnsSchema.optional(),
  })
  .meta({ id: 'RestBinding' });

const mongoBindingSchema = z
  .strictObject({
    kind: z.literal('mongo'),
    datasource: z.string().min(1),
    collection: z.string().min(1),
  })
  .meta({ id: 'MongoBinding' });

const fileBindingSchema = z
  .strictObject({
    kind: z.literal('file'),
    datasource: z.string().optional(),
    path: z.string().min(1),
    format: z.enum(['csv', 'json', 'ndjson']),
    recordPath: z.string().optional(),
  })
  .meta({ id: 'FileBinding' });

const bindingSchema = z
  .discriminatedUnion('kind', [
    sqlBindingSchema,
    restBindingSchema,
    mongoBindingSchema,
    fileBindingSchema,
  ])
  .meta({ id: 'Binding' });

const entitySchema = z
  .strictObject({
    name: z.string().min(1),
    label: z.string().optional(),
    description: z.string().optional(),
    key: z.array(z.string()).optional(),
    // Every entity needs at least one physical binding — an entity the
    // model cannot locate anywhere is not queryable, so it is rejected at
    // the schema level rather than surfacing as a confusing runtime error
    // later (review finding 5).
    bindings: z.array(bindingSchema).min(1),
    attributes: z.array(attributeSchema),
  })
  .meta({ id: 'Entity' });

const cardinalitySchema = z.enum([
  'one_to_one',
  'many_to_one',
  'one_to_many',
  'many_to_many',
]);

const relationshipSchema = z
  .strictObject({
    name: z.string().optional(),
    from: z.string().min(1),
    to: z.string().min(1),
    cardinality: cardinalitySchema,
    source: z.enum(['declared', 'inferred', 'user']),
    description: z.string().optional(),
  })
  .meta({ id: 'Relationship' });

const predicateOpSchema = z.enum([
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
]);

/**
 * Recursive, so it needs `z.lazy` — each branch is its own strict object
 * (rather than one object with every key optional) so e.g. `{ and, attr }`
 * on the same node is rejected instead of silently picking one.
 */
const predicateSchema: z.ZodType = z
  .lazy(() =>
    z.union([
      z.strictObject({ and: z.array(predicateSchema) }),
      z.strictObject({ or: z.array(predicateSchema) }),
      z.strictObject({ not: predicateSchema }),
      z.strictObject({
        attr: z.string().min(1),
        op: predicateOpSchema,
        value: z.unknown().optional(),
      }),
    ]),
  )
  .meta({ id: 'Predicate' });

const aggregationSchema = z.enum([
  'sum',
  'count',
  'count_distinct',
  'avg',
  'min',
  'max',
  'ratio',
]);

/** `name` is the handle used in prompts and other metrics' ratio operands. */
const METRIC_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

const metricSchema = z
  .strictObject({
    name: z.string().regex(METRIC_NAME_PATTERN, {
      message: 'must be lowercase, start with a letter: ^[a-z][a-z0-9_]*$',
    }),
    label: z.string().min(1),
    description: z.string().optional(),
    entity: z.string().min(1),
    agg: aggregationSchema.optional(),
    of: z.string().optional(),
    numerator: z.string().optional(),
    denominator: z.string().optional(),
    where: predicateSchema.optional(),
    dimensions: z.array(z.string()).optional(),
    expressions: z.strictObject({ sql: z.string().optional() }).optional(),
    sourceVerifiedQueryId: z.string().optional(),
  })
  .meta({ id: 'Metric' });

export const dataModelSchema = z
  .strictObject({
    model: z.string().min(1),
    version: z.number().int().positive(),
    description: z.string().optional(),
    entities: z.array(entitySchema),
    relationships: z.array(relationshipSchema),
    metrics: z.array(metricSchema),
  })
  .meta({ id: 'DataModel' });

/** JSON Schema (2020-12), `$defs`-split per the `meta({ id })` above. */
export function dataModelJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(dataModelSchema, {
    target: 'draft-2020-12',
  });
}

/** A Zod issue path segment is a string key or an array index. */
type PathSegment = string | number;

/** `['entities', 0, 'attributes', 2, 'type']` -> `entities[0].attributes[2].type`. */
export function formatPath(path: readonly PathSegment[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else {
      out += out ? `.${segment}` : segment;
    }
  }
  return out;
}

/** Inverse of `formatPath` — used by `dsl/yaml.ts` to locate the source node. */
export function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const pattern = /([^.[\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(path))) {
    segments.push(match[1] !== undefined ? match[1] : Number(match[2]));
  }
  return segments;
}

type ValidationResult =
  | { model: DataModel; issues: [] }
  | { model?: undefined; issues: ModelIssue[] };

const ENTITY_NAME_PATTERN = /^[a-z][a-z0-9_]*$/i;
const PATH_SEGMENT_PATTERN = /^[a-z][a-z0-9_]*(\[\])?$/i;

/** Lowercased for case-insensitive lookups throughout the semantic checks. */
function lower(value: string): string {
  return value.toLowerCase();
}

/** Every segment of an attribute path matches the DSL's segment grammar. */
function isValidAttributePath(path: string): boolean {
  if (!path) return false;
  return path.split('.').every((segment) => PATH_SEGMENT_PATTERN.test(segment));
}

/**
 * Splits a `<entity>.<attribute path>` reference on the *first* dot, since
 * the attribute side can itself contain dots (`ratings[].score`). Exported
 * for `dsl/references.ts`, which parses the same `<entity>.<attribute>`
 * shape inside the wider `metric:`/`rel:` reference grammar.
 */
export function splitEntityRef(
  ref: string,
): { entity: string; attribute: string } | null {
  const dot = ref.indexOf('.');
  if (dot <= 0 || dot === ref.length - 1) return null;
  return { entity: ref.slice(0, dot), attribute: ref.slice(dot + 1) };
}

/** Case-insensitive attribute lookup by path. Exported for `dsl/references.ts`. */
export function findAttribute(
  entity: DataModel['entities'][number],
  attributePath: string,
) {
  const wanted = lower(attributePath);
  return entity.attributes.find((a) => lower(a.name) === wanted);
}

/**
 * Walks a metric's `where` predicate tree and checks every leaf's `attr`
 * resolves on the metric's own entity (review finding 5) — a `where`
 * clause is otherwise the one part of a metric Zod's shape check accepts
 * regardless of content, since `attr` is just `z.string()`.
 */
function checkPredicateAttrs(
  predicate: Predicate,
  entity: DataModel['entities'][number],
  metricName: string,
  path: string,
  issues: ModelIssue[],
): void {
  if ('and' in predicate) {
    predicate.and.forEach((child, i) =>
      checkPredicateAttrs(
        child,
        entity,
        metricName,
        `${path}.and[${i}]`,
        issues,
      ),
    );
    return;
  }
  if ('or' in predicate) {
    predicate.or.forEach((child, i) =>
      checkPredicateAttrs(
        child,
        entity,
        metricName,
        `${path}.or[${i}]`,
        issues,
      ),
    );
    return;
  }
  if ('not' in predicate) {
    checkPredicateAttrs(
      predicate.not,
      entity,
      metricName,
      `${path}.not`,
      issues,
    );
    return;
  }
  if (!findAttribute(entity, predicate.attr)) {
    issues.push({
      path: `${path}.attr`,
      message: `metric "${metricName}" where-clause references unknown attribute "${predicate.attr}" on entity "${entity.name}"`,
    });
  }
}

/**
 * Semantic checks beyond Zod's shape validation: uniqueness, and every
 * cross-reference (relationship endpoints, metric operands, binding
 * columns) actually resolving inside the model. Zod guarantees the shape is
 * right; this guarantees the content is coherent.
 */
function checkSemantics(model: DataModel): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const entityByName = new Map<string, DataModel['entities'][number]>();

  // Entity names: unique (case-insensitive) and valid identifiers.
  model.entities.forEach((entity, i) => {
    const path = `entities[${i}].name`;
    if (!ENTITY_NAME_PATTERN.test(entity.name)) {
      issues.push({
        path,
        message: `entity name "${entity.name}" must match ^[a-z][a-z0-9_]*$ (case-insensitive)`,
      });
    }
    const key = lower(entity.name);
    if (entityByName.has(key)) {
      issues.push({
        path,
        message: `duplicate entity name "${entity.name}" (case-insensitive)`,
      });
    } else {
      entityByName.set(key, entity);
    }
  });

  // Per-entity: attribute paths valid + unique, keys resolve, binding columns resolve.
  model.entities.forEach((entity, i) => {
    const attributeNames = new Set<string>();
    entity.attributes.forEach((attribute, j) => {
      const path = `entities[${i}].attributes[${j}].name`;
      if (!isValidAttributePath(attribute.name)) {
        issues.push({
          path,
          message: `attribute path "${attribute.name}" must be segments matching ^[a-z][a-z0-9_]*(\\[\\])?$`,
        });
      }
      const key = lower(attribute.name);
      if (attributeNames.has(key)) {
        issues.push({
          path,
          message: `duplicate attribute "${attribute.name}" (case-insensitive)`,
        });
      } else {
        attributeNames.add(key);
      }
    });

    (entity.key ?? []).forEach((keyAttr, k) => {
      if (!findAttribute(entity, keyAttr)) {
        issues.push({
          path: `entities[${i}].key[${k}]`,
          message: `key attribute "${keyAttr}" is not declared on entity "${entity.name}"`,
        });
      }
    });

    entity.bindings.forEach((binding, j) => {
      if (binding.kind === 'sql') {
        const segments = binding.table.split('.');
        const valid =
          segments.length === 3 && segments.every((s) => s.length > 0);
        if (!valid) {
          issues.push({
            path: `entities[${i}].bindings[${j}].table`,
            message: `sql binding table "${binding.table}" must be "catalog.schema.table" (exactly three non-empty segments)`,
          });
        }
      }
      if (binding.kind === 'sql' || binding.kind === 'rest') {
        for (const attr of Object.keys(binding.columns ?? {})) {
          if (!findAttribute(entity, attr)) {
            issues.push({
              path: `entities[${i}].bindings[${j}].columns.${attr}`,
              message: `binding column maps attribute "${attr}", which is not declared on entity "${entity.name}"`,
            });
          }
        }
      }
    });
  });

  // Relationships: both endpoints resolve to <entity>.<attribute>.
  model.relationships.forEach((relationship, i) => {
    for (const [field, ref] of [
      ['from', relationship.from],
      ['to', relationship.to],
    ] as const) {
      const parsed = splitEntityRef(ref);
      const path = `relationships[${i}].${field}`;
      if (!parsed) {
        issues.push({
          path,
          message: `"${ref}" must be "<entity>.<attribute path>"`,
        });
        continue;
      }
      const entity = entityByName.get(lower(parsed.entity));
      if (!entity) {
        issues.push({
          path,
          message: `"${ref}" references unknown entity "${parsed.entity}"`,
        });
        continue;
      }
      if (!findAttribute(entity, parsed.attribute)) {
        issues.push({
          path,
          message: `"${ref}" references unknown attribute "${parsed.attribute}" on entity "${entity.name}"`,
        });
      }
    }
  });

  // Metrics: name unique (case-insensitive), entity resolves, of/dimensions/
  // where resolve within it, agg rules hold.
  const metricByName = new Map<string, DataModel['metrics'][number]>();
  model.metrics.forEach((metric, i) => {
    const key = lower(metric.name);
    if (metricByName.has(key)) {
      issues.push({
        path: `metrics[${i}].name`,
        message: `duplicate metric name "${metric.name}" (case-insensitive)`,
      });
    } else {
      metricByName.set(key, metric);
    }
  });

  model.metrics.forEach((metric, i) => {
    const entity = entityByName.get(lower(metric.entity));
    if (!entity) {
      issues.push({
        path: `metrics[${i}].entity`,
        message: `metric "${metric.name}" references unknown entity "${metric.entity}"`,
      });
    } else {
      if (metric.of !== undefined && !findAttribute(entity, metric.of)) {
        issues.push({
          path: `metrics[${i}].of`,
          message: `metric "${metric.name}" references unknown attribute "${metric.of}" on entity "${entity.name}"`,
        });
      }
      (metric.dimensions ?? []).forEach((dim, d) => {
        if (!findAttribute(entity, dim)) {
          issues.push({
            path: `metrics[${i}].dimensions[${d}]`,
            message: `metric "${metric.name}" references unknown attribute "${dim}" on entity "${entity.name}"`,
          });
        }
      });
      if (metric.where) {
        checkPredicateAttrs(
          metric.where,
          entity,
          metric.name,
          `metrics[${i}].where`,
          issues,
        );
      }
    }

    if (metric.agg === 'ratio') {
      for (const field of ['numerator', 'denominator'] as const) {
        const operand = metric[field];
        const path = `metrics[${i}].${field}`;
        if (!operand) {
          issues.push({
            path,
            message: `metric "${metric.name}" has agg "ratio" and needs "${field}"`,
          });
          continue;
        }
        if (lower(operand) === lower(metric.name)) {
          issues.push({
            path,
            message: `metric "${metric.name}" cannot use itself as its own ${field}`,
          });
          continue;
        }
        if (!metricByName.has(lower(operand))) {
          issues.push({
            path,
            message: `metric "${metric.name}" references unknown metric "${operand}" as its ${field}`,
          });
        }
      }
    } else if (metric.agg && metric.agg !== 'count') {
      if (!metric.of) {
        issues.push({
          path: `metrics[${i}].agg`,
          message: `metric "${metric.name}" has agg "${metric.agg}" and needs "of"`,
        });
      }
    }

    if (!metric.agg && !metric.expressions?.sql) {
      issues.push({
        path: `metrics[${i}]`,
        message: `metric "${metric.name}" needs "agg" or "expressions.sql"`,
      });
    }
  });

  return issues;
}

/**
 * Converts a Zod issue (its own path array) into our `path` string syntax.
 * Zod's path type allows `symbol` (for exotic key types we never produce,
 * since every schema here is string/number keyed) — cast narrows it back
 * to what `formatPath` actually handles.
 */
function zodIssueToModelIssue(issue: {
  path: readonly PropertyKey[];
  message: string;
}): ModelIssue {
  return {
    path: formatPath(issue.path as PathSegment[]),
    message: issue.message,
  };
}

/**
 * The single validation entry point: Zod structural parse, then the
 * semantic checks above, run only once the shape is sound (a model that
 * failed structural parsing cannot be typed well enough to resolve
 * references against).
 */
export function validateDataModel(input: unknown): ValidationResult {
  const parsed = dataModelSchema.safeParse(input);
  if (!parsed.success) {
    return { issues: parsed.error.issues.map(zodIssueToModelIssue) };
  }
  const model = parsed.data as DataModel;
  const issues = checkSemantics(model);
  if (issues.length) return { issues };
  return { model, issues: [] };
}

/** A physical snapshot's shape, as read from a datasource introspection. */
export interface SnapshotTable {
  table: string;
  columns: string[];
}

/** Case-insensitive `attribute name -> physical column name` lookup built
 * from a binding's `columns` override map (finding 11 — a plain object
 * index here would miss an override whose key differs only in case). */
function columnOverrideLookup(
  columns: Record<string, string> | undefined,
): Map<string, string> {
  return new Map(
    Object.entries(columns ?? {}).map(([attr, column]) => [
      lower(attr),
      column,
    ]),
  );
}

/**
 * Drift check against a physical snapshot (ADR-0006: "later snapshots
 * produce a drift report, never an overwrite"). A `sql`/`rest` binding
 * whose table/endpoint is not in the snapshot *at all* is rejected outright
 * (review finding 5) — unlike `drift.ts`, which tracks an established
 * model's table disappearing over time as informational drift, this
 * function guards a user's YAML edit against the dataset's current live
 * snapshot, so a binding naming a table that was never part of the dataset
 * is a mistake to reject, not drift to report.
 */
export function validateAgainstSnapshot(
  model: DataModel,
  snapshot: SnapshotTable[],
): ModelIssue[] {
  const columnsByTable = new Map<string, Set<string>>();
  for (const table of snapshot) {
    columnsByTable.set(lower(table.table), new Set(table.columns.map(lower)));
  }

  const issues: ModelIssue[] = [];
  model.entities.forEach((entity, i) => {
    entity.bindings.forEach((binding, j) => {
      // mongo/file: no comparable snapshot shape (unchanged from before).
      if (binding.kind !== 'sql' && binding.kind !== 'rest') return;
      const address = binding.kind === 'sql' ? binding.table : binding.endpoint;
      const field = binding.kind === 'sql' ? 'table' : 'endpoint';
      const columns = columnsByTable.get(lower(address));
      if (!columns) {
        issues.push({
          path: `entities[${i}].bindings[${j}].${field}`,
          message: `"${address}" is not part of dataset "${model.model}"`,
        });
        return;
      }

      const overrides = columnOverrideLookup(binding.columns);
      entity.attributes.forEach((attribute, k) => {
        const mappedColumn = overrides.get(lower(attribute.name));
        const physicalColumn = mappedColumn ?? attribute.name;
        if (columns.has(lower(physicalColumn))) return;

        issues.push(
          mappedColumn !== undefined
            ? {
                path: `entities[${i}].bindings[${j}].columns.${attribute.name}`,
                message: `column "${physicalColumn}" mapped from attribute "${attribute.name}" does not exist on "${address}"`,
              }
            : {
                path: `entities[${i}].attributes[${k}].name`,
                message: `attribute "${attribute.name}" has no matching column on "${address}"`,
              },
        );
      });
    });
  });

  return issues;
}
