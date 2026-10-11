/**
 * The logical query compiler (ADR-0007 §3): turns a resolved `LogicalQuery`
 * into dialect SQL. One function, three dialects — Postgres, Databricks SQL
 * and SQLite (the `rest` adapter's materialisation target) — so every
 * dialect quirk (quoting, date functions, bucket truncation) lives in this
 * one file instead of being re-derived per call site or, worse, by the
 * model itself.
 *
 * `compileLogicalQuery` always resolves the query first
 * (`resolveLogicalQuery`) and only emits SQL once every reference is sound —
 * a compile/semantic failure never reaches the database.
 */
import type { Predicate, PredicateOp } from '../entities/data-model.entity';
import type { SessionEntity, SessionModel } from '../session-model';
import {
  resolveLogicalQuery,
  type BucketUnit,
  type LogicalQuery,
  type LogicalQueryIssue,
  type ResolvedAttrRef,
  type ResolvedJoin,
  type ResolvedQuery,
  type ResolvedSelectItem,
} from './logical-query';

export type SqlDialect = 'postgres' | 'databricks' | 'sqlite';

export interface CompiledQuery {
  sql: string;
  datasourceId: string;
  entities: string[];
  notes: string[];
}

/** Thrown by `compileLogicalQuery` on a compile/semantic failure — carries
 * the same structured issues `resolveLogicalQuery` collected, so a caller
 * (the `query_entities` tool, `query-fixer`) can act on them without a
 * database round trip. */
export class LogicalQueryError extends Error {
  constructor(public readonly issues: LogicalQueryIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    this.name = 'LogicalQueryError';
  }
}

function fail(issue: LogicalQueryIssue): never {
  throw new LogicalQueryError([issue]);
}

function quoteIdentifier(dialect: SqlDialect, name: string): string {
  if (dialect === 'databricks') return `\`${name.replace(/`/g, '``')}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * An entity's physical table, quoted per segment where the dialect actually
 * has that many addressable segments. The DSL's binding key is always
 * `database.schema.table` (three dot-separated segments):
 * - postgres connects to one database already, so the leading database
 *   segment is dropped and the rest quoted as `"schema"."table"` — quoting
 *   the whole dotted string as one identifier (the bug this replaces) made
 *   Postgres look for a table literally named `database.schema.table`.
 * - databricks addresses all three levels (`catalog`.`schema`.`table`), so
 *   every segment is quoted and kept.
 * - sqlite (also the `rest` adapter's materialisation target) has no
 *   catalog/schema concept — the connector key for that table is the whole
 *   dotted string taken as one literal identifier.
 */
function quoteTableRef(dialect: SqlDialect, table: string): string {
  if (dialect === 'sqlite') return quoteIdentifier(dialect, table);
  const parts = table.split('.');
  const segments =
    dialect === 'postgres' && parts.length > 2 ? parts.slice(-2) : parts;
  return segments.map((p) => quoteIdentifier(dialect, p)).join('.');
}

/** Physical column for an attribute, via the entity's binding `columns`
 * override map, falling back to the attribute's own name. */
function columnOf(ref: ResolvedAttrRef): string {
  return (
    ref.entity.columns[ref.attribute.name.toLowerCase()] ?? ref.attribute.name
  );
}

function qualifiedColumn(dialect: SqlDialect, ref: ResolvedAttrRef): string {
  return `${quoteIdentifier(dialect, ref.alias)}.${quoteIdentifier(dialect, columnOf(ref))}`;
}

function bucketExpr(
  dialect: SqlDialect,
  unit: BucketUnit,
  column: string,
): string {
  if (unit === 'year') {
    if (dialect === 'postgres') return `EXTRACT(YEAR FROM ${column})::int`;
    if (dialect === 'databricks') return `year(${column})`;
    return `CAST(strftime('%Y', ${column}) AS INTEGER)`;
  }
  if (unit === 'quarter') {
    // Year-qualified (a date, not a bare 1-4) so two different years' Q1
    // never land in the same group_by bucket.
    if (dialect === 'postgres') return `date_trunc('quarter', ${column})::date`;
    if (dialect === 'databricks') return `date_trunc('QUARTER', ${column})`;
    // sqlite has no native quarter truncation; a "YYYY-Qn" string sorts and
    // groups correctly and is documented as a string bucket (not a date).
    return `(strftime('%Y', ${column}) || '-Q' || ((CAST(strftime('%m', ${column}) AS INTEGER) + 2) / 3))`;
  }
  if (unit === 'week') {
    if (dialect === 'postgres') return `date_trunc('week', ${column})::date`;
    if (dialect === 'databricks') return `date_trunc('WEEK', ${column})`;
    // Monday-start week boundary, matching Postgres/Databricks ISO weeks.
    return `date(${column}, 'weekday 0', '-6 days')`;
  }
  // month/day truncate to a date — the common "bucket boundary" shape.
  if (dialect === 'postgres') return `date_trunc('${unit}', ${column})::date`;
  if (dialect === 'databricks')
    return `date_trunc('${unit.toUpperCase()}', ${column})`;
  const format = unit === 'day' ? '%Y-%m-%d' : '%Y-%m-01';
  return `strftime('${format}', ${column})`;
}

/** Dialect-escaped string literal body (no surrounding quotes). Databricks
 * (its string literals come from a Scala/Spark lexer) treats `'` as an
 * escape introducer alongside `\`, so a lone `''` there is not a no-op the
 * way it is in Postgres/SQLite — both the backslash and the quote need a
 * backslash escape. Postgres/SQLite instead double the quote. */
function quoteStringLiteral(dialect: SqlDialect, value: string): string {
  if (dialect === 'databricks') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** String / numeric / boolean literal, per the portable predicate's value
 * and the dialect's boolean spelling (date/datetime literals are ISO
 * strings, which every dialect accepts as a quoted string in a comparison —
 * no per-dialect cast needed beyond that). */
function literal(dialect: SqlDialect, value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail({
        code: 'invalid_select',
        message: 'non-finite numeric literal',
        path: 'where',
      });
    }
    return String(value);
  }
  if (typeof value === 'boolean') {
    if (dialect === 'sqlite') return value ? '1' : '0';
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'string') return quoteStringLiteral(dialect, value);
  // Not a shape the DSL should ever produce (validated upstream) — stringify
  // safely rather than risk `String()`'s `[object Object]` on a stray object.
  return quoteStringLiteral(dialect, JSON.stringify(value));
}

function compareOp(
  op: Extract<PredicateOp, 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'>,
): string {
  return { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
}

type Resolver = (ref: string, path: string) => ResolvedAttrRef;

function compilePredicate(
  dialect: SqlDialect,
  predicate: Predicate,
  resolve: Resolver,
  path: string,
): string {
  if ('and' in predicate) {
    const parts = predicate.and.map((p, i) =>
      compilePredicate(dialect, p, resolve, `${path}.and[${i}]`),
    );
    return parts.length ? `(${parts.join(' AND ')})` : 'TRUE';
  }
  if ('or' in predicate) {
    const parts = predicate.or.map((p, i) =>
      compilePredicate(dialect, p, resolve, `${path}.or[${i}]`),
    );
    return parts.length ? `(${parts.join(' OR ')})` : 'FALSE';
  }
  if ('not' in predicate) {
    return `NOT (${compilePredicate(dialect, predicate.not, resolve, `${path}.not`)})`;
  }
  const column = qualifiedColumn(
    dialect,
    resolve(predicate.attr, `${path}.attr`),
  );
  switch (predicate.op) {
    case 'eq':
    case 'ne':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return `${column} ${compareOp(predicate.op)} ${literal(dialect, predicate.value)}`;
    case 'in':
    case 'not_in': {
      const values = Array.isArray(predicate.value)
        ? predicate.value
        : [predicate.value];
      const list = values.map((v) => literal(dialect, v)).join(', ');
      return `${column} ${predicate.op === 'in' ? 'IN' : 'NOT IN'} (${list})`;
    }
    case 'between': {
      const bounds: [unknown, unknown] = Array.isArray(predicate.value)
        ? [predicate.value[0], predicate.value[1]]
        : [undefined, undefined];
      const [lo, hi] = bounds;
      return `${column} BETWEEN ${literal(dialect, lo)} AND ${literal(dialect, hi)}`;
    }
    case 'is_null':
      return `${column} IS NULL`;
    case 'not_null':
      return `${column} IS NOT NULL`;
    case 'contains':
      return `LOWER(${column}) LIKE LOWER(${literal(dialect, `%${String(predicate.value)}%`)})`;
    case 'starts_with':
      return `LOWER(${column}) LIKE LOWER(${literal(dialect, `${String(predicate.value)}%`)})`;
  }
}

/** `AVG("attendance")`-shaped aggregate expression, `where` folding it into a
 * `CASE WHEN` so a conditional aggregate still scans the whole group. */
function aggregateExpr(
  agg: string,
  ofColumn: string | undefined,
  whereSql: string | undefined,
): string {
  const wrap = (expr: string) =>
    whereSql ? `CASE WHEN ${whereSql} THEN ${expr} END` : expr;
  switch (agg) {
    case 'count':
      return whereSql ? `COUNT(CASE WHEN ${whereSql} THEN 1 END)` : 'COUNT(*)';
    case 'count_distinct':
      return `COUNT(DISTINCT ${wrap(ofColumn!)})`;
    case 'sum':
      return `SUM(${wrap(ofColumn!)})`;
    case 'avg':
      return `AVG(${wrap(ofColumn!)})`;
    case 'min':
      return `MIN(${wrap(ofColumn!)})`;
    case 'max':
      return `MAX(${wrap(ofColumn!)})`;
    default:
      throw new Error(`aggregateExpr: unsupported agg "${agg}"`);
  }
}

/**
 * A metric's SQL, resolving attribute refs relative to the metric's OWN
 * entity (the DSL's rule — `metric.of`/`metric.where` are bare names on
 * `metric.entity`, never a join path) rather than the query's root. `ratio`
 * recurses into its two sibling metrics by name.
 */
function metricExpr(
  dialect: SqlDialect,
  model: SessionModel,
  metric: SessionModel['metrics'][number],
  aliasForEntity: (entityName: string) => string,
): string {
  if (metric.agg === 'ratio') {
    const sibling = (name: string) => {
      const found = model.metrics.find(
        (m) => m.name.toLowerCase() === name.toLowerCase(),
      );
      if (!found) {
        fail({
          code: 'unknown_metric',
          message: `ratio operand "${name}" is not a known metric`,
          path: 'select',
        });
      }
      return metricExpr(dialect, model, found, aliasForEntity);
    };
    return `(${sibling(metric.numerator!)}) * 1.0 / NULLIF(${sibling(metric.denominator!)}, 0)`;
  }
  const alias = aliasForEntity(metric.entity);
  const entity = model.entities.find((e) => e.name === metric.entity)!;
  const relative: Resolver = (ref, path) => {
    const attribute = entity.attributes.find(
      (a) => a.name.toLowerCase() === ref.toLowerCase(),
    );
    if (!attribute) {
      fail({
        code: 'unknown_attribute',
        message: `metric "${metric.name}" references unknown attribute "${ref}"`,
        path,
      });
    }
    return { alias, entity, attribute };
  };
  if (metric.agg) {
    const of = metric.of
      ? qualifiedColumn(dialect, relative(metric.of, 'metric.of'))
      : undefined;
    const where = metric.where
      ? compilePredicate(dialect, metric.where, relative, 'metric.where')
      : undefined;
    return aggregateExpr(metric.agg, of, where);
  }
  // Dialect-tagged escape hatch (ADR-0006): written against the binding's own
  // physical columns of this entity, inserted verbatim.
  return metric.expressions!.sql!;
}

function selectExpr(
  dialect: SqlDialect,
  model: SessionModel,
  item: ResolvedSelectItem,
  resolve: Resolver,
  aliasForEntity: (entityName: string) => string,
): string {
  if (item.kind === 'attr') {
    const column = qualifiedColumn(dialect, item.ref);
    const expr = item.bucket
      ? bucketExpr(dialect, item.bucket, column)
      : column;
    return `${expr} AS ${quoteIdentifier(dialect, item.alias)}`;
  }
  if (item.kind === 'metric') {
    const expr = metricExpr(dialect, model, item.metric, aliasForEntity);
    return `${expr} AS ${quoteIdentifier(dialect, item.alias)}`;
  }
  const of = item.of ? qualifiedColumn(dialect, item.of) : undefined;
  const where = item.where
    ? compilePredicate(
        dialect,
        item.where,
        resolve,
        `select.${item.alias}.where`,
      )
    : undefined;
  return `${aggregateExpr(item.agg, of, where)} AS ${quoteIdentifier(dialect, item.alias)}`;
}

/** One hop that fans rows out: the already-in-scope side sits on the "one"
 * side of the relationship and the newly joined side on the "many" side —
 * either a `one_to_many` walked forward (scope matches `relationship.from`)
 * or a `many_to_one` walked in reverse (scope matches `relationship.to`).
 * `many_to_many` and `one_to_one` are not flagged here: `one_to_one` never
 * duplicates rows, and `many_to_many` has no "one" side to compare against
 * either direction. */
interface FanOutHop {
  manyAlias: string;
  scopeAlias: string;
}

function fanOutHops(resolved: ResolvedQuery): FanOutHop[] {
  const hops: FanOutHop[] = [];
  for (const j of resolved.joins) {
    const isManySide =
      (j.relationship.cardinality === 'one_to_many' &&
        j.scopeSide === 'from') ||
      (j.relationship.cardinality === 'many_to_one' && j.scopeSide === 'to');
    if (isManySide) hops.push({ manyAlias: j.alias, scopeAlias: j.scopeAlias });
  }
  return hops;
}

/** Aliases safe to aggregate from given the fan-out hops present: each hop's
 * many side, plus anything joined off a many-side alias — multiplicity only
 * compounds downstream of a fan-out hop, it never resets. */
function manySideAliases(
  joins: ResolvedJoin[],
  hops: FanOutHop[],
): Set<string> {
  const many = new Set(hops.map((h) => h.manyAlias.toLowerCase()));
  let grew = true;
  while (grew) {
    grew = false;
    for (const j of joins) {
      if (
        many.has(j.scopeAlias.toLowerCase()) &&
        !many.has(j.alias.toLowerCase())
      ) {
        many.add(j.alias.toLowerCase());
        grew = true;
      }
    }
  }
  return many;
}

/** Joining a `one_to_many` relationship from the "one" side (or a
 * `many_to_one` relationship in reverse) fans a row out per match on the
 * "many" side — safe only for aggregates/metrics computed on the many side
 * itself (or something joined off it). A plain attribute selection is not
 * itself a fan-out bug — `SELECT customer.name, SUM(orders.amount) ...
 * GROUP BY customer.id` is ordinary SQL even though customer is the "one"
 * side; it is specifically an aggregate anchored to the wrong side that
 * silently inflates. */
function checkFanOut(resolved: ResolvedQuery): LogicalQueryIssue[] {
  const hops = fanOutHops(resolved);
  if (!hops.length) return [];
  const safe = manySideAliases(resolved.joins, hops);
  const scopeFor = (entityName: string): string | undefined => {
    const match = [resolved.root, ...resolved.joins].find(
      (s) => s.entity.name.toLowerCase() === entityName.toLowerCase(),
    );
    return match?.alias;
  };
  const issues: LogicalQueryIssue[] = [];
  resolved.select.forEach((item, i) => {
    let scopeAlias: string | undefined;
    if (item.kind === 'agg' && item.of) scopeAlias = item.of.alias;
    else if (item.kind === 'metric') scopeAlias = scopeFor(item.metric.entity);
    if (!scopeAlias) return; // unscoped, e.g. bare COUNT(*) — safe
    if (!safe.has(scopeAlias.toLowerCase())) {
      const hop = hops[0];
      issues.push({
        code: 'fan_out',
        message: `"${item.alias}" aggregates from "${scopeAlias}", but the join to "${hop.manyAlias}" is one-to-many from "${hop.scopeAlias}" — aggregate from "${hop.manyAlias}" instead, or filter with a sub-query`,
        path: `select[${i}]`,
      });
    }
  });
  return issues;
}

/** Every scope (root + joins) the resolved query touches, keyed by the alias
 * actually used in the generated SQL. */
function scopesByAlias(
  resolved: ResolvedQuery,
): Map<string, { alias: string; entity: SessionEntity }> {
  const map = new Map<string, { alias: string; entity: SessionEntity }>();
  map.set(resolved.root.alias.toLowerCase(), resolved.root);
  for (const join of resolved.joins) map.set(join.alias.toLowerCase(), join);
  return map;
}

/**
 * The compiler entry point. Resolves `query` against `model`, runs the
 * fan-out guard, and emits one `SELECT` statement in `dialect`. Throws
 * `LogicalQueryError` — never reaches a database call — when resolution or
 * the fan-out guard finds a problem.
 */
export function compileLogicalQuery(
  model: SessionModel,
  query: LogicalQuery,
  dialect: SqlDialect,
): CompiledQuery {
  const resolution = resolveLogicalQuery(model, query);
  if (!resolution.ok) throw new LogicalQueryError(resolution.issues);
  const resolved = resolution.query;

  const fanOutIssues = checkFanOut(resolved);
  if (fanOutIssues.length) throw new LogicalQueryError(fanOutIssues);

  const scopes = scopesByAlias(resolved);
  // Every reference in a *resolved* query already names a real scope alias
  // (root or a join) — this just looks the scope back up rather than
  // re-running path resolution.
  const resolveInScope: Resolver = (ref, path) => {
    const dot = ref.indexOf('.');
    const aliasPart = dot < 0 ? resolved.root.alias : ref.slice(0, dot);
    const attrName = dot < 0 ? ref : ref.slice(dot + 1);
    const scope = scopes.get(aliasPart.toLowerCase());
    if (!scope)
      fail({
        code: 'unknown_entity',
        message: `unknown alias "${aliasPart}"`,
        path,
      });
    const attribute = scope.entity.attributes.find(
      (a) => a.name.toLowerCase() === attrName.toLowerCase(),
    );
    if (!attribute) {
      fail({
        code: 'unknown_attribute',
        message: `entity "${scope.entity.name}" has no attribute "${attrName}"`,
        path,
      });
    }
    return { alias: scope.alias, entity: scope.entity, attribute };
  };
  // A metric's entity is always joined under its own name (root or
  // auto/explicit join), so the alias is just that scope's alias.
  const aliasForEntity = (entityName: string): string => {
    for (const scope of scopes.values()) {
      if (scope.entity.name.toLowerCase() === entityName.toLowerCase())
        return scope.alias;
    }
    fail({
      code: 'unknown_entity',
      message: `entity "${entityName}" is not reachable in this query`,
      path: 'select',
    });
  };

  const from = `${quoteTableRef(dialect, resolved.root.entity.table)} AS ${quoteIdentifier(dialect, resolved.root.alias)}`;
  const joinClauses = resolved.joins.map((j) => {
    const table = `${quoteTableRef(dialect, j.entity.table)} AS ${quoteIdentifier(dialect, j.alias)}`;
    const scopeAttr = resolveInScope(
      `${j.scopeAlias}.${j.scopeAttribute}`,
      'joins',
    );
    const targetAttr = resolveInScope(
      `${j.alias}.${j.targetAttribute}`,
      'joins',
    );
    return `JOIN ${table} ON ${qualifiedColumn(dialect, scopeAttr)} = ${qualifiedColumn(dialect, targetAttr)}`;
  });

  const selectSql = resolved.select
    .map((item) =>
      selectExpr(dialect, model, item, resolveInScope, aliasForEntity),
    )
    .join(', ');

  const whereSql = query.where
    ? ` WHERE ${compilePredicate(dialect, query.where, resolveInScope, 'where')}`
    : '';

  const groupBySql = resolved.groupBy.length
    ? ` GROUP BY ${resolved.groupBy
        .map((item) => {
          const column = qualifiedColumn(dialect, item.ref);
          return item.bucket
            ? bucketExpr(dialect, item.bucket, column)
            : column;
        })
        .join(', ')}`
    : '';

  const orderBySql = resolved.orderBy.length
    ? ` ORDER BY ${resolved.orderBy
        .map((o) => {
          const expr =
            o.kind === 'alias'
              ? quoteIdentifier(dialect, o.by)
              : qualifiedColumn(dialect, o.ref);
          return `${expr} ${o.dir.toUpperCase()}`;
        })
        .join(', ')}`
    : '';

  const sql =
    `SELECT ${selectSql} FROM ${from}` +
    (joinClauses.length ? ` ${joinClauses.join(' ')}` : '') +
    whereSql +
    groupBySql +
    orderBySql +
    ` LIMIT ${resolved.limit}`;

  const entities = Array.from(
    new Set([
      resolved.root.entity.name,
      ...resolved.joins.map((j) => j.entity.name),
    ]),
  );

  return {
    sql,
    datasourceId: resolved.root.entity.datasourceId,
    entities,
    notes: resolved.notes,
  };
}
