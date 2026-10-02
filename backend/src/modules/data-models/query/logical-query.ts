/**
 * The logical query layer's input shape (ADR-0007): the assistant never
 * writes SQL, it writes a `LogicalQuery` against the session's composed
 * model (`../session-model.ts`). `logicalQuerySchema` is both the Zod parser
 * for the API (`POST /datasets/:name/model/compile`) and the tool input
 * schema for `query_entities` — the same JSON Schema that constrains the
 * model's tool call also drives the structured validation here, so the two
 * can never disagree about what counts as a well-formed query.
 *
 * `resolveLogicalQuery` is the single reference-resolution pass: given a
 * well-formed (Zod-parsed) query and a `SessionModel`, it either returns a
 * `ResolvedQuery` the compiler can turn directly into SQL, or a list of
 * structured `{ code, message, path }` issues a fixer agent can act on.
 * Compilation (`compile-sql.ts`) always resolves first and never partially
 * compiles a query with unresolved references.
 */
import { z } from 'zod';
import {
  adHocAggregationSchema,
  predicateSchema,
} from '../schema/data-model.schema';
import type {
  Aggregation,
  Attribute,
  Predicate,
  Relationship,
} from '../entities/data-model.entity';
import type { SessionEntity, SessionModel } from '../session-model';

const BUCKET_UNITS = ['year', 'quarter', 'month', 'week', 'day'] as const;
export type BucketUnit = (typeof BUCKET_UNITS)[number];

const selectAttrItemSchema = z.strictObject({
  attr: z
    .string()
    .min(1)
    .describe(
      'Attribute ref, e.g. "matches.date" or bare "date" on the root entity',
    ),
  alias: z
    .string()
    .min(1)
    .optional()
    .describe('Column name in the result; defaults to "attr"'),
  bucket: z
    .enum(BUCKET_UNITS)
    .optional()
    .describe(
      'Truncate a date/datetime attribute, e.g. "month" for a monthly trend',
    ),
});

const selectMetricItemSchema = z.strictObject({
  metric: z
    .string()
    .min(1)
    .describe('A metric name from the session model, e.g. "total_revenue"'),
  alias: z
    .string()
    .min(1)
    .optional()
    .describe('Column name in the result; defaults to the metric name'),
});

const selectAggItemSchema = z.strictObject({
  agg: adHocAggregationSchema.describe(
    'Ad-hoc aggregation, e.g. "count" or "avg" — use a named metric instead when one already exists',
  ),
  of: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Attribute to aggregate, e.g. "matches.attendance"; not needed for "count"',
    ),
  alias: z
    .string()
    .min(1)
    .describe('Column name in the result, e.g. "match_count"'),
  where: predicateSchema
    .optional()
    .describe(
      'Restrict the aggregate to rows matching this predicate (a conditional aggregate)',
    ),
});

const selectItemSchema = z.union([
  selectAttrItemSchema,
  selectMetricItemSchema,
  selectAggItemSchema,
]);

/**
 * Declared by hand rather than `z.infer`-ed: `predicateSchema` is typed as a
 * loose `z.ZodType` (see `data-model.schema.ts`'s own comment on why its
 * recursive `z.lazy` cannot carry a precise generic), so inference through it
 * would widen every `where` field to `unknown`. `data-model.schema.ts` faces
 * the same gap and resolves it the same way: parse with Zod for validation,
 * then trust the real `Predicate` type for everything downstream.
 */
export type SelectItem =
  | { attr: string; alias?: string; bucket?: BucketUnit }
  | { metric: string; alias?: string }
  | { agg: Aggregation; of?: string; alias: string; where?: Predicate };

const joinSchema = z.strictObject({
  via: z
    .string()
    .min(1)
    .describe(
      'Relationship name, or "entity.attr->entity.attr" when more than one path connects two entities, e.g. "matches.home_team_id->teams.team_id"',
    ),
  as: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Alias for the joined entity; required to self-join an entity to itself',
    ),
});

const orderBySchema = z.strictObject({
  by: z
    .string()
    .min(1)
    .describe(
      'A select alias, or an attribute ref, e.g. "total_revenue" or "matches.date"',
    ),
  dir: z.enum(['asc', 'desc']).optional().describe('Defaults to "asc"'),
});

/** The tool input schema and the API schema — one definition, so the model's
 * tool call and the `/model/compile` endpoint are constrained identically. */
export const logicalQuerySchema = z.strictObject({
  from: z.string().min(1).describe('The entity to start from, e.g. "matches"'),
  joins: z
    .array(joinSchema)
    .optional()
    .describe(
      'Explicit joins; omit when exactly one relationship path connects the entities you reference',
    ),
  select: z
    .array(selectItemSchema)
    .min(1)
    .describe('One or more attribute, metric or ad-hoc aggregation items'),
  where: predicateSchema.optional().describe('Row-level filter predicate'),
  group_by: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Attribute refs or select aliases to group by; auto-filled from the plain attributes in select when omitted and select mixes attributes with aggregations',
    ),
  order_by: z
    .array(orderBySchema)
    .optional()
    .describe('How to sort the result'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(100)
    .describe('Row cap, 1-500, defaults to 100'),
});

/** See the `SelectItem` comment above — declared by hand for the same reason. */
export interface LogicalQuery {
  from: string;
  joins?: { via: string; as?: string }[];
  select: SelectItem[];
  where?: Predicate;
  group_by?: string[];
  order_by?: { by: string; dir?: 'asc' | 'desc' }[];
  /** Always present after parsing — `logicalQuerySchema` defaults it to 100. */
  limit: number;
}

/** `logicalQuerySchema.parse(input) as LogicalQuery` in one place, so every
 * caller gets the precise hand-written type instead of Zod's widened one. */
export function parseLogicalQuery(input: unknown): LogicalQuery {
  return logicalQuerySchema.parse(input) as unknown as LogicalQuery;
}

export type LogicalQueryIssueCode =
  | 'unknown_entity'
  | 'unknown_attribute'
  | 'unknown_metric'
  | 'unknown_relationship'
  | 'ambiguous_path'
  | 'no_path'
  | 'invalid_order_by'
  | 'invalid_select'
  | 'mixed_datasources'
  | 'bucket_on_non_date'
  | 'fan_out';

/** A compile/semantic failure, precise enough for a fixer agent to act on
 * without re-deriving what went wrong from prose. */
export interface LogicalQueryIssue {
  code: LogicalQueryIssueCode;
  message: string;
  path: string;
}

function issue(
  code: LogicalQueryIssueCode,
  message: string,
  path: string,
): LogicalQueryIssue {
  return { code, message, path };
}

function lower(value: string): string {
  return value.toLowerCase();
}

function findEntity(
  model: SessionModel,
  name: string,
): SessionEntity | undefined {
  const wanted = lower(name);
  return model.entities.find((e) => lower(e.name) === wanted);
}

function findAttribute(
  entity: SessionEntity,
  name: string,
): Attribute | undefined {
  const wanted = lower(name);
  return entity.attributes.find((a) => lower(a.name) === wanted);
}

function isDateLike(attribute: Attribute): boolean {
  return attribute.type === 'date' || attribute.type === 'datetime';
}

/** One entity reachable in the query's join graph, under the alias it was
 * joined (or qualified) as. */
export interface ResolvedScope {
  alias: string;
  entity: SessionEntity;
}

/** A join the compiler must emit, with enough of the relationship kept
 * around for the fan-out guard (compile-sql.ts) to inspect. */
export interface ResolvedJoin extends ResolvedScope {
  relationship: Relationship;
  /** Alias already in scope that this join attaches to. */
  scopeAlias: string;
  /** Attribute on the scope side the join condition equates. */
  scopeAttribute: string;
  /** Attribute on the newly joined side the join condition equates. */
  targetAttribute: string;
  /** Which side of `relationship` the already-in-scope alias sat on — `from`
   * when the scope matches `relationship.from` (so this join walks
   * from->to), `to` when it matches `relationship.to` (walking to->from).
   * The fan-out guard (compile-sql.ts) combines this with `cardinality` to
   * tell "the one side" from "the many side" of the hop. */
  scopeSide: 'from' | 'to';
}

export interface ResolvedAttrRef {
  alias: string;
  entity: SessionEntity;
  attribute: Attribute;
}

export type ResolvedSelectItem =
  | { kind: 'attr'; alias: string; ref: ResolvedAttrRef; bucket?: BucketUnit }
  | { kind: 'metric'; alias: string; metric: SessionModel['metrics'][number] }
  | {
      kind: 'agg';
      alias: string;
      agg: Aggregation;
      of?: ResolvedAttrRef;
      where?: Predicate;
    };

/** A resolved `group_by` entry — carries the bucket along so the compiler
 * groups by the same truncated expression it selects, never the raw
 * column (grouping by the raw timestamp while selecting a monthly bucket
 * would put every row in its own group). */
export interface ResolvedGroupByItem {
  ref: ResolvedAttrRef;
  bucket?: BucketUnit;
}

export type ResolvedOrderByItem =
  | { kind: 'alias'; by: string; dir: 'asc' | 'desc' }
  | { kind: 'ref'; ref: ResolvedAttrRef; dir: 'asc' | 'desc' };

export interface ResolvedQuery {
  root: ResolvedScope;
  joins: ResolvedJoin[];
  select: ResolvedSelectItem[];
  where?: Predicate;
  groupBy: ResolvedGroupByItem[];
  orderBy: ResolvedOrderByItem[];
  limit: number;
  /** Non-fatal observations worth surfacing to the caller (auto-filled
   * group_by, auto-added joins) — never an error. */
  notes: string[];
}

export type ResolveResult =
  | { ok: true; query: ResolvedQuery }
  | { ok: false; issues: LogicalQueryIssue[] };

/**
 * One resolution pass over a Zod-parsed `LogicalQuery`: builds the join
 * graph (explicit `joins[]` plus any attribute reference resolved by
 * auto-path), resolves every attribute/metric reference against the
 * `SessionModel`, and auto-fills `group_by` when the selection mixes plain
 * attributes with aggregations. Collects every issue it finds rather than
 * stopping at the first, so a fixer sees the whole picture in one pass.
 */
export function resolveLogicalQuery(
  model: SessionModel,
  query: LogicalQuery,
): ResolveResult {
  const issues: LogicalQueryIssue[] = [];
  const notes: string[] = [];

  const rootLookup = findEntity(model, query.from);
  if (!rootLookup) {
    return {
      ok: false,
      issues: [
        issue('unknown_entity', `unknown entity "${query.from}"`, 'from'),
      ],
    };
  }
  // A plain `const` narrowed by the check above so every nested function
  // below (which TS does not narrow a closed-over variable through) still
  // sees a definite `SessionEntity`, not `SessionEntity | undefined`.
  const root: SessionEntity = rootLookup;

  // alias (lowercased) -> scope. Seeded with the root entity under its own
  // name; explicit and auto-path joins extend it as the query is resolved.
  const scopes = new Map<string, ResolvedScope>([
    [lower(root.name), { alias: root.name, entity: root }],
  ]);
  const joins: ResolvedJoin[] = [];

  /** Every scope whose ENTITY (not alias) matches `entityName` — plural
   * because a self-join or two separate relationships can both reach the
   * same entity under different aliases. Looking this up by entity name
   * (rather than assuming alias === entity name) is what lets a second hop
   * reuse an earlier join that was given a custom `as`. */
  function scopesForEntity(entityName: string): ResolvedScope[] {
    const wanted = lower(entityName);
    return [...scopes.values()].filter((s) => lower(s.entity.name) === wanted);
  }

  function relationshipByVia(via: string): Relationship | undefined {
    const arrow = via.indexOf('->');
    if (arrow >= 0) {
      const from = lower(via.slice(0, arrow).trim());
      const to = lower(via.slice(arrow + 2).trim());
      return model.relationships.find(
        (r) => lower(r.from) === from && lower(r.to) === to,
      );
    }
    const wanted = lower(via);
    return model.relationships.find((r) => r.name && lower(r.name) === wanted);
  }

  /** Relationships connecting any in-scope alias to `entityName`, from
   * either direction — the candidate set `ambiguous_path` counts. */
  function pathsTo(entityName: string): Relationship[] {
    const wanted = lower(entityName);
    return model.relationships.filter((r) => {
      const fromEntity = lower(r.from.split('.')[0]);
      const toEntity = lower(r.to.split('.')[0]);
      if (toEntity === wanted && scopesForEntity(fromEntity).length)
        return true;
      if (fromEntity === wanted && scopesForEntity(toEntity).length)
        return true;
      return false;
    });
  }

  function addJoin(
    relationship: Relationship,
    alias: string,
    path: string,
  ): ResolvedScope | undefined {
    const fromEntity = relationship.from.split('.')[0];
    const fromAttr = relationship.from.split('.').slice(1).join('.');
    const toEntity = relationship.to.split('.')[0];
    const toAttr = relationship.to.split('.').slice(1).join('.');
    const isSelfJoin = lower(fromEntity) === lower(toEntity);
    const fromScope = scopesForEntity(fromEntity)[0];
    const toScope = isSelfJoin ? undefined : scopesForEntity(toEntity)[0];
    let scopeAlias: string;
    let scopeAttribute: string;
    let scopeSide: 'from' | 'to';
    let targetEntityName: string;
    let targetAttribute: string;
    if (isSelfJoin) {
      // Both ends name the same entity — there is no name-based way to tell
      // "the copy already in scope" from "the new copy", so the caller must
      // give the new side a distinct alias; the already-in-scope copy is
      // whichever one `resolveLogicalQuery` already created for this entity.
      if (!fromScope) {
        issues.push(
          issue(
            'unknown_relationship',
            `self-relationship on "${fromEntity}" has no in-scope copy to join from`,
            path,
          ),
        );
        return undefined;
      }
      if (!alias || lower(alias) === lower(fromScope.alias)) {
        issues.push(
          issue(
            'unknown_relationship',
            `self-join on "${fromEntity}" needs a distinct joins[].as alias`,
            path,
          ),
        );
        return undefined;
      }
      scopeAlias = fromScope.alias;
      scopeAttribute = fromAttr;
      scopeSide = 'from';
      targetEntityName = toEntity;
      targetAttribute = toAttr;
    } else if (fromScope && !toScope) {
      scopeAlias = fromScope.alias;
      scopeAttribute = fromAttr;
      scopeSide = 'from';
      targetEntityName = toEntity;
      targetAttribute = toAttr;
    } else if (toScope && !fromScope) {
      scopeAlias = toScope.alias;
      scopeAttribute = toAttr;
      scopeSide = 'to';
      targetEntityName = fromEntity;
      targetAttribute = fromAttr;
    } else {
      issues.push(
        issue(
          'unknown_relationship',
          `relationship "${relationship.from}->${relationship.to}" does not connect to anything in scope`,
          path,
        ),
      );
      return undefined;
    }
    const targetEntity = findEntity(model, targetEntityName);
    if (!targetEntity) {
      issues.push(
        issue(
          'unknown_entity',
          `relationship names unknown entity "${targetEntityName}"`,
          path,
        ),
      );
      return undefined;
    }
    const resolvedAlias = alias || targetEntity.name;
    const scope: ResolvedScope = { alias: resolvedAlias, entity: targetEntity };
    scopes.set(lower(resolvedAlias), scope);
    joins.push({
      ...scope,
      relationship,
      scopeAlias,
      scopeAttribute,
      targetAttribute,
      scopeSide,
    });
    return scope;
  }

  (query.joins ?? []).forEach((j, i) => {
    const path = `joins[${i}].via`;
    const relationship = relationshipByVia(j.via);
    if (!relationship) {
      issues.push(
        issue('unknown_relationship', `unknown relationship "${j.via}"`, path),
      );
      return;
    }
    addJoin(relationship, j.as ?? '', path);
  });

  /** Resolves an `AttrRef`, auto-joining along exactly one relationship path
   * when the prefix names an entity not yet in scope. */
  function resolveAttrRef(
    ref: string,
    path: string,
  ): ResolvedAttrRef | undefined {
    const dot = ref.indexOf('.');
    if (dot < 0) {
      const attr = findAttribute(root, ref);
      if (!attr) {
        issues.push(
          issue(
            'unknown_attribute',
            `entity "${root.name}" has no attribute "${ref}"`,
            path,
          ),
        );
        return undefined;
      }
      return { alias: root.name, entity: root, attribute: attr };
    }
    const prefix = ref.slice(0, dot);
    const attrName = ref.slice(dot + 1);
    // Scope lookups here are intentionally alias-keyed (not entity-name
    // keyed): the user names a *scope* by whatever alias it was joined
    // under, including a custom `as` from a second hop or a self-join.
    const existing = scopes.get(lower(prefix));
    if (existing) {
      const attr = findAttribute(existing.entity, attrName);
      if (!attr) {
        issues.push(
          issue(
            'unknown_attribute',
            `entity "${existing.entity.name}" has no attribute "${attrName}"`,
            path,
          ),
        );
        return undefined;
      }
      return {
        alias: existing.alias,
        entity: existing.entity,
        attribute: attr,
      };
    }
    const candidate = findEntity(model, prefix);
    if (!candidate) {
      issues.push(
        issue('unknown_attribute', `unknown reference "${ref}"`, path),
      );
      return undefined;
    }
    const paths = pathsTo(candidate.name);
    if (paths.length === 0) {
      issues.push(
        issue(
          'no_path',
          `no declared relationship reaches "${candidate.name}" from the current query — add an explicit join`,
          path,
        ),
      );
      return undefined;
    }
    if (paths.length > 1) {
      issues.push(
        issue(
          'ambiguous_path',
          `more than one relationship connects the current query to "${candidate.name}" — use joins[].via`,
          path,
        ),
      );
      return undefined;
    }
    const scope = addJoin(paths[0], candidate.name, path);
    if (!scope) return undefined;
    notes.push(
      `auto-joined "${candidate.name}" via its only relationship path`,
    );
    const attr = findAttribute(scope.entity, attrName);
    if (!attr) {
      issues.push(
        issue(
          'unknown_attribute',
          `entity "${scope.entity.name}" has no attribute "${attrName}"`,
          path,
        ),
      );
      return undefined;
    }
    return { alias: scope.alias, entity: scope.entity, attribute: attr };
  }

  function resolvePredicate(predicate: Predicate, path: string): void {
    if ('and' in predicate) {
      predicate.and.forEach((p, i) => resolvePredicate(p, `${path}.and[${i}]`));
    } else if ('or' in predicate) {
      predicate.or.forEach((p, i) => resolvePredicate(p, `${path}.or[${i}]`));
    } else if ('not' in predicate) {
      resolvePredicate(predicate.not, `${path}.not`);
    } else {
      resolveAttrRef(predicate.attr, `${path}.attr`);
    }
  }

  /** Metric membership needs its owning entity in scope — same auto-path
   * rule as an attribute reference, driven through a one-segment "ref". */
  function ensureEntityInScope(entityName: string, path: string): boolean {
    if (scopesForEntity(entityName).length) return true;
    const candidate = findEntity(model, entityName);
    if (!candidate) return false;
    const paths = pathsTo(candidate.name);
    if (paths.length !== 1) return false;
    return !!addJoin(paths[0], candidate.name, path);
  }

  const resolvedSelect: ResolvedSelectItem[] = [];
  query.select.forEach((item, i) => {
    const path = `select[${i}]`;
    if ('attr' in item) {
      const ref = resolveAttrRef(item.attr, `${path}.attr`);
      if (!ref) return;
      if (item.bucket && !isDateLike(ref.attribute)) {
        issues.push(
          issue(
            'bucket_on_non_date',
            `bucket "${item.bucket}" needs a date/datetime attribute, but "${item.attr}" is "${ref.attribute.type}"`,
            `${path}.bucket`,
          ),
        );
        return;
      }
      resolvedSelect.push({
        kind: 'attr',
        alias: item.alias ?? item.attr,
        ref,
        bucket: item.bucket,
      });
    } else if ('metric' in item) {
      const metric = model.metrics.find(
        (m) => lower(m.name) === lower(item.metric),
      );
      if (!metric) {
        issues.push(
          issue(
            'unknown_metric',
            `unknown metric "${item.metric}"`,
            `${path}.metric`,
          ),
        );
        return;
      }
      if (!ensureEntityInScope(metric.entity, path)) {
        issues.push(
          issue(
            'unknown_metric',
            `metric "${metric.name}" is defined on entity "${metric.entity}", which this query does not reach`,
            `${path}.metric`,
          ),
        );
        return;
      }
      resolvedSelect.push({
        kind: 'metric',
        alias: item.alias ?? metric.name,
        metric,
      });
    } else {
      const of = item.of ? resolveAttrRef(item.of, `${path}.of`) : undefined;
      if (item.agg !== 'count' && !item.of) {
        issues.push(
          issue(
            'invalid_select',
            `agg "${item.agg}" needs "of"`,
            `${path}.agg`,
          ),
        );
        return;
      }
      if (item.where) resolvePredicate(item.where, `${path}.where`);
      resolvedSelect.push({
        kind: 'agg',
        alias: item.alias,
        agg: item.agg,
        of,
        where: item.where,
      });
    }
  });

  if (query.where) resolvePredicate(query.where, 'where');

  const plainAttrItems = resolvedSelect.filter(
    (s): s is Extract<ResolvedSelectItem, { kind: 'attr' }> =>
      s.kind === 'attr',
  );
  const aggregatedItems = resolvedSelect.filter((s) => s.kind !== 'attr');

  // group_by may name a select alias (reusing that item's bucket, so the
  // GROUP BY expression always matches the SELECT expression) or a bare
  // attribute ref.
  const selectAttrByAlias = new Map<
    string,
    { ref: ResolvedAttrRef; bucket?: BucketUnit }
  >();
  for (const item of resolvedSelect) {
    if (item.kind === 'attr')
      selectAttrByAlias.set(item.alias, { ref: item.ref, bucket: item.bucket });
  }
  function resolveGroupByRef(
    raw: string,
    path: string,
  ): ResolvedGroupByItem | undefined {
    const bySelectAlias = selectAttrByAlias.get(raw);
    if (bySelectAlias) return bySelectAlias;
    const ref = resolveAttrRef(raw, path);
    if (!ref) return undefined;
    return { ref };
  }

  let groupBy: ResolvedGroupByItem[] = [];
  if (query.group_by) {
    groupBy = query.group_by
      .map((ref, i) => resolveGroupByRef(ref, `group_by[${i}]`))
      .filter((r): r is ResolvedGroupByItem => !!r);
  } else if (plainAttrItems.length && aggregatedItems.length) {
    groupBy = plainAttrItems.map((item) => ({
      ref: item.ref,
      bucket: item.bucket,
    }));
    notes.push(
      `group_by inferred from the selected attributes: ${plainAttrItems
        .map((item) => item.alias)
        .join(', ')}`,
    );
  }

  const selectKeys = new Set(resolvedSelect.map((item) => item.alias));
  const orderBy: ResolvedOrderByItem[] = [];
  (query.order_by ?? []).forEach((o, i) => {
    const path = `order_by[${i}].by`;
    const dir = o.dir ?? ('asc' as const);
    if (selectKeys.has(o.by)) {
      orderBy.push({ kind: 'alias', by: o.by, dir });
      return;
    }
    // Not a select alias — try it as a plain attribute ref (possibly
    // auto-joining, same as a select/where reference) before giving up.
    const before = issues.length;
    const ref = resolveAttrRef(o.by, path);
    if (!ref) {
      if (issues.length === before) {
        issues.push(
          issue(
            'invalid_order_by',
            `order_by names "${o.by}", which is not in select and not a known attribute`,
            path,
          ),
        );
      }
      return;
    }
    orderBy.push({ kind: 'ref', ref, dir });
  });

  if (resolvedSelect.length === 0 && query.select.length > 0) {
    issues.push(issue('invalid_select', 'no select item resolved', 'select'));
  }

  const scopeEntities = [
    { alias: root.name, entity: root },
    ...joins.map((j) => ({ alias: j.alias, entity: j.entity })),
  ];
  const datasources = new Set(scopeEntities.map((s) => s.entity.datasourceId));
  if (datasources.size > 1) {
    issues.push(
      issue(
        'mixed_datasources',
        'this query reaches entities on more than one datasource — query one datasource at a time',
        'from',
      ),
    );
  }

  if (issues.length) return { ok: false, issues };

  return {
    ok: true,
    query: {
      root: { alias: root.name, entity: root },
      joins,
      select: resolvedSelect,
      where: query.where,
      groupBy,
      orderBy,
      limit: query.limit,
      notes,
    },
  };
}
