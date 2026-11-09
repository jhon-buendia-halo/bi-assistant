import { mapWithConcurrency } from '../../datasources/connectors/connector';
import type {
  ColumnStats,
  ColumnStatsExtras,
  FkEdge,
  KeyConstraint,
  ProfiledTable,
  ProfilingConnector,
  ScopedProfiler,
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
import {
  MAX_PROFILED_ROWS,
  PROFILE_CONCURRENCY_BY_DIALECT,
  type ReadinessProgress,
  type ReadinessProgressListener,
} from '../progress';
import { COMPARABLE_TYPES } from './classify';
import { detectFormatRule } from './format-rules';

/** Consistency probe window on a text column's distinct count (spec R10). */
const CONSISTENCY_MIN_DISTINCT = 2;
const CONSISTENCY_MAX_DISTINCT = 1000;

const inConsistencyWindow = (distinct: number | undefined): boolean =>
  distinct !== undefined &&
  distinct >= CONSISTENCY_MIN_DISTINCT &&
  distinct <= CONSISTENCY_MAX_DISTINCT;

export interface DialectRules {
  sourceType: 'postgres' | 'databricks';
  classify: (type: string) => SemanticType;
  formatPatterns: Record<FormatRule, string>;
}

export interface BuildProfileOptions {
  /** Aborts the assessment: statements are cancelled, the AbortError propagates. */
  signal?: AbortSignal;
  /** Live progress; a throwing listener never breaks profiling. */
  onProgress?: ReadinessProgressListener;
}

const isAbortError = (e: unknown): boolean =>
  e instanceof Error && e.name === 'AbortError';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const e = new Error('The assessment was aborted');
    e.name = 'AbortError';
    throw e;
  }
}

/** A statement the 15 s timeout cancelled (PostgreSQL 57014, Databricks). */
function isTimeout(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : '';
  return code === '57014' || /timed out|statement timeout/i.test(message);
}

/**
 * A probe that fails leaves its statistic absent (spec R6). An abort is not a
 * failed probe: it propagates.
 */
async function attempt<T>(
  probe: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T | undefined> {
  try {
    return await probe();
  } catch (e) {
    if (isAbortError(e)) throw e;
    throwIfAborted(signal);
    return undefined;
  }
}

const tableKey = (schema: string, table: string): string =>
  `${schema}\u0000${table}`;

/** The scope as a table predicate; every field given must match. */
function scopeFilter(scope?: AssessScope): (t: ProfiledTable) => boolean {
  const set = scope?.entities
    ? new Set(scope.entities.map((e) => tableKey(e.namespace, e.name)))
    : undefined;
  return (t) => {
    if (scope?.namespace && t.schema !== scope.namespace) return false;
    if (scope?.entity && t.table !== scope.entity) return false;
    if (set && !set.has(tableKey(t.schema, t.table))) return false;
    return true;
  };
}

const ZONED_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * A temporal min/max as host-independent ISO text (R23): a date-time with no
 * offset (PostgreSQL `timestamp`, Databricks `TIMESTAMP_NTZ`) is read as UTC,
 * and a short offset (`+00`, `+0530`) is spelled `+00:00`. Anything else (a
 * date alone, which ECMAScript already reads as UTC, a time, an interval) is
 * returned unchanged.
 */
export function utcTemporal(value: string): string {
  const m = ZONED_TIMESTAMP.exec(value.trim());
  if (!m) return value;
  const [, date, time, offset] = m;
  if (!offset || offset.toUpperCase() === 'Z') return `${date}T${time}Z`;
  const digits = offset.slice(1).replace(':', '');
  return `${date}T${time}${offset[0]}${digits.slice(0, 2)}:${digits.slice(2) || '00'}`;
}

/**
 * Build a SourceProfile from aggregate profiling probes (spec R6–R11). Only an
 * unreachable datasource (the inventory call failing) or an abort throws; any
 * other failing probe leaves its statistic out and the profile carries on.
 */
export async function buildSourceProfile<TConfig>(
  profiler: ProfilingConnector<TConfig>,
  config: TConfig,
  sourceId: string,
  dialect: DialectRules,
  scope?: AssessScope,
  options: BuildProfileOptions = {},
): Promise<SourceProfile> {
  const { signal } = options;
  const emit = (p: ReadinessProgress): void => {
    try {
      options.onProgress?.(p);
    } catch {
      // A listener only observes; it never breaks profiling.
    }
  };
  const width = PROFILE_CONCURRENCY_BY_DIALECT[dialect.sourceType];

  return profiler.withSessions(config, width, signal, async (scoped) => {
    throwIfAborted(signal);
    emit({ phase: 'inventory', message: 'Listing tables…' });
    // Every table stays a join target; the scope narrows the child tables only,
    // and only children are profiled. The inferred-join cap below is applied
    // once, to the narrowed children's candidates (R11).
    // Only the inventory call may reject; the other three never do (`attempt`).
    const [allTables, keyConstraints, foreignKeys, privileges] =
      await Promise.all([
        scoped.tables(config),
        attempt(() => scoped.keys(config), signal),
        attempt(() => scoped.foreignKeys(config), signal),
        attempt(() => scoped.tablePrivileges(config), signal),
      ]);
    const children = allTables.filter(scopeFilter(scope));
    const childKeys = new Set(children.map((t) => tableKey(t.schema, t.table)));
    const selectable = privileges
      ? new Set(
          privileges
            .filter((p) => p.selectable)
            .map((p) => tableKey(p.schema, p.table)),
        )
      : undefined;

    const entities: EntityProfile[] = new Array<EntityProfile>(children.length);
    let profiled = 0;
    await mapWithConcurrency(
      children.map((table, index) => ({ table, index })),
      width,
      async ({ table, index }) => {
        throwIfAborted(signal);
        entities[index] = await profileEntity(
          scoped,
          config,
          dialect,
          table,
          keyConstraints ?? [],
          selectable,
          signal,
        );
        profiled += 1;
        const entity = `${table.schema}.${table.table}`;
        emit({
          phase: 'profiling',
          done: profiled,
          total: children.length,
          entity,
          message: `Profiling ${entity} (${profiled}/${children.length})…`,
        });
      },
    );

    const declared = (foreignKeys ?? []).filter((e) =>
      childKeys.has(tableKey(e.schema, e.table)),
    );
    const relationships: RelationshipProfile[] = new Array<RelationshipProfile>(
      declared.length,
    );
    emit({
      phase: 'relationships',
      message: 'Checking relationships…',
      done: 0,
      total: declared.length,
    });
    await mapWithConcurrency(
      declared.map((edge, index) => ({ edge, index })),
      width,
      async ({ edge, index }) => {
        throwIfAborted(signal);
        const orphanCount = await attempt(
          () => scoped.orphanCount(config, edge),
          signal,
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
    if (candidates.length > 0) {
      emit({
        phase: 'relationships',
        message: 'Checking relationships…',
        done: declared.length,
        total: declared.length + candidates.length,
      });
    }
    await mapWithConcurrency(
      candidates.map((edge, index) => ({ edge, index })),
      width,
      async ({ edge, index }) => {
        throwIfAborted(signal);
        // An inferred candidate is kept only once its orphan probe verifies it.
        const orphanCount = await attempt(
          () => scoped.orphanCount(config, edge),
          signal,
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
  });
}

async function profileEntity<TConfig>(
  profiler: ScopedProfiler<TConfig>,
  config: TConfig,
  dialect: DialectRules,
  table: ProfiledTable,
  keyConstraints: KeyConstraint[],
  selectable: Set<string> | undefined,
  signal: AbortSignal | undefined,
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
  const formatRules = new Map<string, FormatRule>();
  for (const c of columns) {
    if (c.semanticType !== 'text') continue;
    const rule = detectFormatRule(c.name);
    if (rule) formatRules.set(c.name, rule);
  }

  // Row count first (ADR-0033): a table above the cap is never column-profiled.
  // A failing count leaves the gate open, as before.
  const counted = canRead
    ? await attempt(() => profiler.rowCount(config, schema, name), signal)
    : undefined;
  const tooLarge = counted !== undefined && counted > MAX_PROFILED_ROWS;

  let stats: ColumnStats | undefined;
  let notProfiled: 'too-large' | 'timed-out' | undefined = tooLarge
    ? 'too-large'
    : undefined;
  // True when the per-column probes must run (the folded statement failed).
  let perColumnProbes = false;
  if (canRead && !tooLarge) {
    const nullable = columns.filter((c) => c.nullable).map((c) => c.name);
    const all = columns.filter(hasEquality).map((c) => c.name);
    const comparable = columns
      .filter((c) => COMPARABLE_TYPES.has(c.semanticType))
      .map((c) => c.name);
    // Only the cheap format predicates ride on the statistics statement.
    // Normalized distinct counts are costly on near-unique text columns (a
    // 30 M-row table went from 0.5 s to 6.3 s with them folded for every text
    // column), so they run afterwards, in one statement, for the R10 window
    // columns only — exactly the columns the per-column path probed.
    const extras: ColumnStatsExtras = {
      formats: [...formatRules].map(([column, rule]) => ({
        column,
        pattern: dialect.formatPatterns[rule],
      })),
    };
    try {
      stats = await profiler.columnStats(
        config,
        schema,
        name,
        nullable,
        all,
        comparable,
        extras,
      );
    } catch (e) {
      if (isAbortError(e)) throw e;
      throwIfAborted(signal);
      if (isTimeout(e)) {
        notProfiled = 'timed-out';
      } else {
        // A column that breaks the wide statement must not cost the table's
        // statistics: fall back to the plain statement and per-column probes.
        perColumnProbes = true;
        stats = await attempt(
          () =>
            profiler.columnStats(
              config,
              schema,
              name,
              nullable,
              all,
              comparable,
            ),
          signal,
        );
      }
    }
  }
  const skipProbes = notProfiled !== undefined;

  // Second statement: normalized distinct counts for the text columns whose
  // distinct count is inside the R10 window, folded together. If it fails for
  // any reason but an abort, those columns fall back to per-column probes.
  let normalizedCounts: Record<string, number> | undefined;
  let perColumnNormalized = perColumnProbes;
  if (canRead && stats && !skipProbes && !perColumnProbes) {
    const window = columns
      .filter((c) => c.semanticType === 'text')
      .map((c) => c.name)
      .filter((n) => inConsistencyWindow(stats?.distinctCounts[n]));
    if (window.length > 0) {
      try {
        const folded = await profiler.columnStats(
          config,
          schema,
          name,
          [],
          [],
          [],
          { normalizedDistinct: window },
        );
        normalizedCounts = folded.normalizedDistinctCounts ?? {};
      } catch (e) {
        if (isAbortError(e)) throw e;
        throwIfAborted(signal);
        perColumnNormalized = true;
      }
    }
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
      const temporal = c.semanticType === 'temporal';
      const min = stats.minValues[c.name];
      if (min !== undefined) field.min = temporal ? utcTemporal(min) : min;
      const max = stats.maxValues[c.name];
      if (max !== undefined) field.max = temporal ? utcTemporal(max) : max;
    }

    if (canRead && c.semanticType === 'text') {
      const rule = formatRules.get(c.name);
      if (rule) field.formatRule = rule;
      if (!skipProbes) {
        if (rule) {
          const invalid = perColumnProbes
            ? await attempt(
                () =>
                  profiler.invalidFormatCount(
                    config,
                    schema,
                    name,
                    c.name,
                    dialect.formatPatterns[rule],
                  ),
                signal,
              )
            : stats?.invalidFormatCounts?.[c.name];
          if (invalid !== undefined) field.invalidFormatCount = invalid;
        }
        if (inConsistencyWindow(field.distinctCount)) {
          const normalized = perColumnNormalized
            ? await attempt(
                () =>
                  profiler.normalizedDistinctCount(
                    config,
                    schema,
                    name,
                    c.name,
                  ),
                signal,
              )
            : normalizedCounts?.[c.name];
          if (normalized !== undefined) {
            field.normalizedDistinctCount = normalized;
          }
        }
      }
    }
    fields.push(field);
  }

  const keys: KeyProfile[] = [];
  for (const k of keyConstraints) {
    if (k.schema !== schema || k.table !== name) continue;
    const key: KeyProfile = { kind: k.kind, fields: k.columns };
    if (canRead && !skipProbes) {
      const duplicates = await attempt(
        () => profiler.duplicateCount(config, schema, name, k.columns),
        signal,
      );
      if (duplicates !== undefined) key.duplicateCount = duplicates;
    }
    keys.push(key);
  }

  const entity: EntityProfile = {
    namespace: schema,
    name,
    // A not-profiled entity carries no statistics: rowCount stays 0 so the
    // engine's completeness/uniqueness checks (which run when rowCount > 0)
    // never count its missing nullCounts as zero nulls.
    rowCount: notProfiled || !stats ? 0 : stats.totalRows,
    fields,
    keys,
  };
  if (notProfiled) entity.notProfiled = notProfiled;
  if (tooLarge) entity.profiledRowCount = counted;
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
