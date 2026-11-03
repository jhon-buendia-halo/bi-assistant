import { mapWithConcurrency } from '../../datasources/connectors/connector';
import type {
  ColumnStats,
  FkEdge,
  KeyConstraint,
  ProfiledTable,
  ProfilingConnector,
} from '../../datasources/connectors/profiling';
import {
  inferJoinCandidates,
  MAX_INFERRED_JOIN_CANDIDATES,
} from '../engine/infer-joins';
import type {
  AssessScope,
  EntityProfile,
  FieldProfile,
  FormatRule,
  KeyProfile,
  RelationshipProfile,
  SemanticType,
  SourceProfile,
} from '../engine/types';
import { COMPARABLE_TYPES } from './classify';
import { detectFormatRule } from './format-rules';

/** Tables profiled at once; each table's own probes run one after another. */
export const PROFILE_CONCURRENCY = 4;

/** Consistency probe window on a text column's distinct count (spec R10). */
const CONSISTENCY_MIN_DISTINCT = 2;
const CONSISTENCY_MAX_DISTINCT = 1000;

export interface DialectRules {
  sourceType: 'postgres' | 'databricks';
  classify: (type: string) => SemanticType;
  formatPatterns: Record<FormatRule, string>;
}

/** A probe that fails leaves its statistic absent (spec R6). */
async function attempt<T>(probe: () => Promise<T>): Promise<T | undefined> {
  try {
    return await probe();
  } catch {
    return undefined;
  }
}

const tableKey = (schema: string, table: string): string =>
  `${schema}\u0000${table}`;

function inScope(t: ProfiledTable, scope?: AssessScope): boolean {
  if (scope?.namespace && t.schema !== scope.namespace) return false;
  if (scope?.entity && t.table !== scope.entity) return false;
  return true;
}

/**
 * Build a SourceProfile from aggregate profiling probes (spec R6–R11). Only an
 * unreachable datasource (the inventory call failing) throws; any other failing
 * probe leaves its statistic out and the profile carries on.
 */
export async function buildSourceProfile<TConfig>(
  profiler: ProfilingConnector<TConfig>,
  config: TConfig,
  sourceId: string,
  dialect: DialectRules,
  scope?: AssessScope,
): Promise<SourceProfile> {
  // Every table stays a join target; the scope narrows the child tables only.
  // Only the inventory call may reject; the other three never do (`attempt`).
  const [allTables, keyConstraints, foreignKeys, privileges] =
    await Promise.all([
      profiler.tables(config),
      attempt(() => profiler.keys(config)),
      attempt(() => profiler.foreignKeys(config)),
      attempt(() => profiler.tablePrivileges(config)),
    ]);
  const children = allTables.filter((t) => inScope(t, scope));
  const childKeys = new Set(children.map((t) => tableKey(t.schema, t.table)));
  const selectable = privileges
    ? new Set(
        privileges
          .filter((p) => p.selectable)
          .map((p) => tableKey(p.schema, p.table)),
      )
    : undefined;

  const entities: EntityProfile[] = new Array<EntityProfile>(children.length);
  await mapWithConcurrency(
    children.map((table, index) => ({ table, index })),
    PROFILE_CONCURRENCY,
    async ({ table, index }) => {
      entities[index] = await profileEntity(
        profiler,
        config,
        dialect,
        table,
        keyConstraints ?? [],
        selectable,
      );
    },
  );

  const declared = (foreignKeys ?? []).filter((e) =>
    childKeys.has(tableKey(e.schema, e.table)),
  );
  const relationships: RelationshipProfile[] = new Array<RelationshipProfile>(
    declared.length,
  );
  await mapWithConcurrency(
    declared.map((edge, index) => ({ edge, index })),
    PROFILE_CONCURRENCY,
    async ({ edge, index }) => {
      const orphanCount = await attempt(() =>
        profiler.orphanCount(config, edge),
      );
      relationships[index] = toRelationship(edge, 'declared', orphanCount);
    },
  );

  const declaredColumns = new Set(
    (foreignKeys ?? []).map((e) => `${e.schema} ${e.table} ${e.column}`),
  );
  const candidates = inferJoinCandidates(
    entities
      .filter((e) => e.readable !== false)
      .map((e) => ({
        namespace: e.namespace,
        name: e.name,
        columns: e.fields.map((f) => f.name),
      })),
    allTables.map((t) => ({
      namespace: t.schema,
      name: t.table,
      columns: t.columns.map((c) => c.name),
    })),
    declaredColumns,
  ).slice(0, MAX_INFERRED_JOIN_CANDIDATES);
  const inferred: (RelationshipProfile | undefined)[] = new Array<
    RelationshipProfile | undefined
  >(candidates.length);
  await mapWithConcurrency(
    candidates.map((edge, index) => ({ edge, index })),
    PROFILE_CONCURRENCY,
    async ({ edge, index }) => {
      // An inferred candidate is kept only once its orphan probe verifies it.
      const orphanCount = await attempt(() =>
        profiler.orphanCount(config, edge),
      );
      if (orphanCount !== undefined) {
        inferred[index] = toRelationship(edge, 'inferred', orphanCount);
      }
    },
  );
  for (const r of inferred) if (r) relationships.push(r);

  return {
    sourceId,
    sourceType: dialect.sourceType,
    entities,
    relationships,
  };
}

async function profileEntity<TConfig>(
  profiler: ProfilingConnector<TConfig>,
  config: TConfig,
  dialect: DialectRules,
  table: ProfiledTable,
  keyConstraints: KeyConstraint[],
  selectable: Set<string> | undefined,
): Promise<EntityProfile> {
  const { schema, table: name } = table;
  // Unknown privileges (probe failed) leave `readable` absent but still profile.
  const readable = selectable
    ? selectable.has(tableKey(schema, name))
    : undefined;
  const canRead = readable !== false;

  const columns = table.columns.map((c) => ({
    ...c,
    semanticType: dialect.classify(c.type),
  }));

  let stats: ColumnStats | undefined;
  if (canRead) {
    stats = await attempt(() =>
      profiler.columnStats(
        config,
        schema,
        name,
        columns.filter((c) => c.nullable).map((c) => c.name),
        columns.filter(hasEquality).map((c) => c.name),
        columns
          .filter((c) => COMPARABLE_TYPES.has(c.semanticType))
          .map((c) => c.name),
      ),
    );
  }

  const fields: FieldProfile[] = [];
  for (const c of columns) {
    const field: FieldProfile = {
      name: c.name,
      type: c.type,
      semanticType: c.semanticType,
      nullable: c.nullable,
    };
    if (stats) {
      // A NOT NULL column has 0 nulls; a nullable one the aggregate left out
      // stays unmeasured (spec R6).
      const nulls = c.nullable ? stats.nullCounts[c.name] : 0;
      if (nulls !== undefined) field.nullCount = nulls;
      const distinct = stats.distinctCounts[c.name];
      if (distinct !== undefined) field.distinctCount = distinct;
      const min = stats.minValues[c.name];
      if (min !== undefined) field.min = min;
      const max = stats.maxValues[c.name];
      if (max !== undefined) field.max = max;
    }

    if (canRead && c.semanticType === 'text') {
      const rule = detectFormatRule(c.name);
      if (rule) {
        field.formatRule = rule;
        const invalid = await attempt(() =>
          profiler.invalidFormatCount(
            config,
            schema,
            name,
            c.name,
            dialect.formatPatterns[rule],
          ),
        );
        if (invalid !== undefined) field.invalidFormatCount = invalid;
      }
      const distinct = field.distinctCount;
      if (
        distinct !== undefined &&
        distinct >= CONSISTENCY_MIN_DISTINCT &&
        distinct <= CONSISTENCY_MAX_DISTINCT
      ) {
        const normalized = await attempt(() =>
          profiler.normalizedDistinctCount(config, schema, name, c.name),
        );
        if (normalized !== undefined) {
          field.normalizedDistinctCount = normalized;
        }
      }
    }
    fields.push(field);
  }

  const keys: KeyProfile[] = [];
  for (const k of keyConstraints) {
    if (k.schema !== schema || k.table !== name) continue;
    const key: KeyProfile = { kind: k.kind, fields: k.columns };
    if (canRead) {
      const duplicates = await attempt(() =>
        profiler.duplicateCount(config, schema, name, k.columns),
      );
      if (duplicates !== undefined) key.duplicateCount = duplicates;
    }
    keys.push(key);
  }

  const entity: EntityProfile = {
    namespace: schema,
    name,
    rowCount: stats?.totalRows ?? 0,
    fields,
    keys,
  };
  if (readable !== undefined) entity.readable = readable;
  if (table.lastModifiedAt) entity.lastModifiedAt = table.lastModifiedAt;
  return entity;
}

function toRelationship(
  edge: FkEdge,
  origin: 'declared' | 'inferred',
  orphanCount: number | undefined,
): RelationshipProfile {
  const r: RelationshipProfile = {
    fromNamespace: edge.schema,
    fromEntity: edge.table,
    fromField: edge.column,
    toNamespace: edge.refSchema,
    toEntity: edge.refTable,
    toField: edge.refColumn,
    origin,
  };
  if (orphanCount !== undefined) r.orphanCount = orphanCount;
  return r;
}

/**
 * COUNT(DISTINCT) needs an equality operator: Postgres `json` and `xml` have
 * none, and one such column would fail the whole table's aggregate, losing all
 * its statistics (R6). Their distinct count is left out instead.
 */
function hasEquality(c: { type: string; semanticType: string }): boolean {
  return c.semanticType !== 'json' && !/^xml$/i.test(c.type.trim());
}
