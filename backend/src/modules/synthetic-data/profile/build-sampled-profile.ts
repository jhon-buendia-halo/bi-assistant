// Sampled profile builder (plan 2.2, U-PROFILE). Pure: no I/O, no clock, no
// randomness. Raw sampled values go in; statistics, key shapes and character-class
// patterns come out. The only data values in the result are the `topValues` of
// categorical columns (values seen at least 3 times, never key columns).

import {
  classifyDatabricksType,
  classifyType,
} from '../../data-readiness/adapters/classify';
import { detectFormatRule } from '../../data-readiness/adapters/format-rules';
import { inferJoinCandidates } from '../../data-readiness/engine/infer-joins';
import type { FormatRule } from '../../data-readiness/engine/types';
import type {
  FkEdge,
  KeyConstraint,
  ProfiledTable,
} from '../../datasources/connectors/profiling';
import { PROFILE_TTL_MS } from '../limits';
import type {
  SampleMethod,
  SampledColumn,
  SampledProfile,
  SampledRelationship,
  SampledTable,
  SyntheticDialect,
} from '../types';
import {
  CATEGORICAL_MIN_COUNT,
  classifyColumn,
  CATEGORICAL_MAX_DISTINCT,
} from './classify-column';
import { buildShapes } from './shapes';
import {
  compareStrings,
  decimalScale,
  granularityOf,
  lengthStats,
  parseBoolean,
  parseNumber,
  parseTemporal,
  quantiles11,
  round,
  round4,
  type ParsedTemporal,
} from './stats';

/** What the sampler returns for one table (structurally a `SampleOutcome`). */
export interface ProfileSample {
  rowCountEstimate: number | null;
  method: SampleMethod;
  /** Raw text values; a missing key counts as NULL. Never leaves the service. */
  rows: Record<string, string | null | undefined>[];
  durationMs: number;
  error?: string;
}

export interface ProfileTableInput {
  /** Entity key as stored in the dataset. */
  key: string;
  /** Catalog: `schema` is the namespace (Databricks: `catalog.schema`). */
  table: ProfiledTable;
  sample: ProfileSample;
}

export interface BuildProfileInput {
  dataset: { name: string };
  datasource: { id: string; name: string; kind: SyntheticDialect };
  /** In the order requested. */
  tables: ProfileTableInput[];
  /** Declared key constraints of the datasource (any tables; filtered here). */
  keys: KeyConstraint[];
  /** Declared foreign-key edges of the datasource (any tables; filtered here). */
  foreignKeys: FkEdge[];
  /** Rows requested per table. */
  sampleSize: number;
  now: Date;
}

const FORMAT_CHECKS: Record<FormatRule, RegExp> = {
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  phone: /^[+0-9().\s-]{7,}$/,
  url: /^https?:\/\//i,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'date-string': /^\d{4}-\d{2}-\d{2}/,
};

const tkey = (ns: string, name: string): string => `${ns}\u0000${name}`;

export function buildSampledProfile(
  input: BuildProfileInput,
): Omit<SampledProfile, 'profileId'> {
  const { tables, keys, foreignKeys } = input;
  const byRef = new Map<string, ProfileTableInput>();
  // An unresolved entry (no catalog columns) never takes part in relationships.
  for (const t of tables)
    if (t.table.columns.length > 0)
      byRef.set(tkey(t.table.schema, t.table.table), t);

  const keysOf = (t: ProfiledTable): KeyConstraint[] =>
    keys.filter((k) => k.schema === t.schema && k.table === t.table);
  const primaryOf = (t: ProfiledTable): string[] =>
    keysOf(t).find((k) => k.kind === 'primary')?.columns ?? [];
  const uniquesOf = (t: ProfiledTable): string[][] =>
    keysOf(t)
      .filter((k) => k.kind === 'unique')
      .map((k) => k.columns);

  const relationships = buildRelationships(input, byRef, primaryOf, uniquesOf);

  const out: SampledTable[] = tables.map((t) => {
    const primaryKey = primaryOf(t.table);
    const uniqueKeys = uniquesOf(t.table);
    const keyColumns = new Set([...primaryKey, ...uniqueKeys.flat()]);
    // Every declared FK edge whose child is this table marks its column a foreign key,
    // whether or not the parent is in the profile (an unpicked parent still makes it an id).
    const fkColumns = new Set([
      ...input.foreignKeys
        .filter((e) => e.schema === t.table.schema && e.table === t.table.table)
        .map((e) => e.column),
      ...relationships
        .filter((r) => r.fromTable === t.key)
        .flatMap((r) => r.fromColumns),
    ]);
    // Only relationships (both ends in the profile) are usable for generation.
    const usableFkColumns = new Set(
      relationships
        .filter((r) => r.fromTable === t.key)
        .flatMap((r) => r.fromColumns),
    );
    const rows = t.sample.rows;
    return {
      key: t.key,
      namespace: t.table.schema,
      name: t.table.table,
      rowCountEstimate: t.sample.rowCountEstimate,
      sampledRows: rows.length,
      method: t.sample.method,
      durationMs: t.sample.durationMs,
      ...(t.sample.error !== undefined ? { error: t.sample.error } : {}),
      primaryKey,
      uniqueKeys,
      columns: t.table.columns.map((c) =>
        buildColumn(
          c,
          rows.map((r) => r[c.name] ?? null),
          input.datasource.kind,
          keyColumns.has(c.name),
          primaryKey.includes(c.name),
          fkColumns.has(c.name),
          usableFkColumns.has(c.name),
        ),
      ),
    };
  });

  return {
    version: 1,
    datasetName: input.dataset.name,
    datasourceId: input.datasource.id,
    datasourceName: input.datasource.name,
    dialect: input.datasource.kind,
    generatedAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + PROFILE_TTL_MS).toISOString(),
    sampleSize: input.sampleSize,
    tables: out,
    relationships,
  };
}

function buildRelationships(
  input: BuildProfileInput,
  byRef: Map<string, ProfileTableInput>,
  primaryOf: (t: ProfiledTable) => string[],
  uniquesOf: (t: ProfiledTable) => string[][],
): SampledRelationship[] {
  const rels: SampledRelationship[] = [];
  const seen = new Set<string>();
  const hasColumn = (t: ProfileTableInput, c: string): boolean =>
    t.table.columns.some((x) => x.name === c);
  const add = (
    child: ProfileTableInput,
    column: string,
    parent: ProfileTableInput,
    refColumn: string,
    origin: 'declared' | 'inferred',
  ): void => {
    if (!hasColumn(child, column) || !hasColumn(parent, refColumn)) return;
    const id = `${child.key}|${column}|${parent.key}|${refColumn}`;
    if (seen.has(id)) return;
    seen.add(id);
    rels.push({
      fromTable: child.key,
      fromColumns: [column],
      toTable: parent.key,
      toColumns: [refColumn],
      origin,
    });
  };

  for (const e of input.foreignKeys) {
    const child = byRef.get(tkey(e.schema, e.table));
    const parent = byRef.get(tkey(e.refSchema, e.refTable));
    if (child && parent) add(child, e.column, parent, e.refColumn, 'declared');
  }

  const declared = new Set(
    input.foreignKeys.map((e) => `${e.schema} ${e.table} ${e.column}`),
  );
  const shapes = input.tables.map((t) => ({
    namespace: t.table.schema,
    name: t.table.table,
    columns: t.table.columns.map((c) => c.name),
  }));
  for (const cand of inferJoinCandidates(shapes, shapes, declared)) {
    const child = byRef.get(tkey(cand.schema, cand.table));
    const parent = byRef.get(tkey(cand.refSchema, cand.refTable));
    if (!child || !parent) continue;
    const isKey =
      (primaryOf(parent.table).length === 1 &&
        primaryOf(parent.table)[0] === cand.refColumn) ||
      uniquesOf(parent.table).some(
        (u) => u.length === 1 && u[0] === cand.refColumn,
      );
    if (isKey) add(child, cand.column, parent, cand.refColumn, 'inferred');
  }
  return rels;
}

function buildColumn(
  col: { name: string; type: string; nullable: boolean },
  values: (string | null)[],
  dialect: SyntheticDialect,
  inKey: boolean,
  inPrimaryKey: boolean,
  isForeignKey: boolean,
  foreignKeyUsable: boolean,
): SampledColumn {
  const semanticType =
    dialect === 'databricks'
      ? classifyDatabricksType(col.type)
      : classifyType(col.type);
  const nonNullValues = values.filter((v): v is string => v !== null);
  const nonNull = nonNullValues.length;
  const counts = new Map<string, number>();
  for (const v of nonNullValues) counts.set(v, (counts.get(v) ?? 0) + 1);
  const distinct = counts.size;

  // Numeric / temporal / boolean parses, only for the matching semantic type.
  const nums =
    semanticType === 'numeric'
      ? nonNullValues.flatMap((v) => {
          const n = parseNumber(v, col.type);
          return n === null ? [] : [{ n, scale: decimalScale(v, col.type) }];
        })
      : [];
  const temporals: ParsedTemporal[] =
    semanticType === 'temporal'
      ? nonNullValues.flatMap((v) => {
          const p = parseTemporal(v);
          return p ? [p] : [];
        })
      : [];
  const bools =
    semanticType === 'boolean'
      ? nonNullValues.flatMap((v) => {
          const b = parseBoolean(v);
          return b === null ? [] : [b];
        })
      : [];
  const parsed = nums.length > 0 || temporals.length > 0 || bools.length > 0;

  // Format rule: by name, kept only when the sample agrees (>= 80% of values match).
  let formatRule: FormatRule | undefined;
  if (semanticType === 'text' && nonNull > 0) {
    const rule = detectFormatRule(col.name);
    if (rule) {
      const ok = nonNullValues.filter((v) =>
        FORMAT_CHECKS[rule].test(v.trim()),
      ).length;
      if (ok / nonNull >= 0.8) formatRule = rule;
    }
  }

  const frequent = [...counts.entries()]
    .filter(([, n]) => n >= CATEGORICAL_MIN_COUNT)
    .sort((a, b) => b[1] - a[1] || compareStrings(a[0], b[0]));
  const meanLength =
    semanticType === 'text' && nonNull > 0
      ? lengthStats(nonNullValues).mean
      : 0;

  const cls = classifyColumn(
    {
      name: col.name,
      type: col.type,
      semanticType,
      nullable: col.nullable,
      nonNull,
      distinct,
      inKey,
      inPrimaryKey,
      isForeignKey,
      foreignKeyUsable,
      formatRule,
      frequentValues: Math.min(frequent.length, CATEGORICAL_MAX_DISTINCT),
      parsed,
    },
    meanLength,
  );

  const column: SampledColumn = {
    name: col.name,
    type: col.type,
    semanticType,
    nullable: col.nullable,
    kind: cls.kind,
    strategy: cls.strategy,
    nullFraction:
      values.length === 0
        ? 0
        : round4((values.length - nonNull) / values.length),
    distinctCount: distinct,
    distinctRatio: nonNull === 0 ? 0 : round4(distinct / nonNull),
  };
  if (cls.note) column.note = cls.note;

  const hasData =
    nonNull > 0 &&
    cls.kind !== 'unsupported' &&
    cls.strategy !== 'null-only' &&
    cls.strategy !== 'constant';
  if (!hasData) return column;

  // Value statistics (extremes, quantiles) only for real numeric / temporal columns;
  // identifier columns keep counts, null share, distinct count and shapes (privacy).
  // A `unique-range` integer keeps its range too: it is generated inside it (plan 10).
  if (
    (cls.kind === 'numeric' || cls.strategy === 'unique-range') &&
    nums.length > 0
  ) {
    const sorted = nums.map((x) => x.n).sort((a, b) => a - b);
    const scale = Math.max(...nums.map((x) => x.scale));
    column.numeric = {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length, 6),
      quantiles: quantiles11(sorted),
      integer: scale === 0 && sorted.every(Number.isInteger),
      scale,
    };
  }
  if (cls.kind === 'temporal' && temporals.length > 0) {
    const sorted = temporals.map((p) => p.ms).sort((a, b) => a - b);
    const iso = (ms: number): string => new Date(ms).toISOString();
    column.temporal = {
      min: iso(sorted[0]),
      max: iso(sorted[sorted.length - 1]),
      quantiles: quantiles11(sorted).map(iso),
      granularity: granularityOf(col.type, temporals),
    };
  }
  if (bools.length > 0) {
    column.boolean = {
      trueFraction: round4(bools.filter(Boolean).length / bools.length),
    };
  }

  // A numeric or temporal identifier that is not a sequence, uuid or usable FK is generated
  // from its raw text shape: patterns and length only (shapes carry class tokens, no data).
  if (
    cls.kind === 'identifier' &&
    cls.strategy === 'unique-pattern' &&
    (semanticType === 'numeric' || semanticType === 'temporal')
  ) {
    column.length = lengthStats(nonNullValues);
    column.patterns = buildShapes(nonNullValues);
  }

  if (semanticType === 'text') {
    column.length = lengthStats(nonNullValues);
    if (cls.kind === 'categorical') {
      const top = frequent.slice(0, CATEGORICAL_MAX_DISTINCT);
      const topSet = new Set(top.map(([v]) => v));
      column.topValues = top.map(([value, n]) => ({
        value,
        fraction: round4(n / nonNull),
      }));
      const topCount = top.reduce((s, [, n]) => s + n, 0);
      column.otherFraction = round4((nonNull - topCount) / nonNull);
      const rare = nonNullValues.filter((v) => !topSet.has(v));
      const patterns = buildShapes(rare);
      if (patterns.length > 0) column.patterns = patterns;
    } else {
      column.patterns = buildShapes(nonNullValues);
    }
    if (cls.kind === 'formatted' && formatRule) column.formatRule = formatRule;
    if (cls.strategy === 'uuid' && formatRule) column.formatRule = formatRule;
  }
  return column;
}
