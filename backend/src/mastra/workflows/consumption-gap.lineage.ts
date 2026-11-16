/**
 * Lineage inference for Consumption Gap Analysis (agents.md 5.20, ADR-0051):
 * which column feeds which, layer to layer, when no lineage is declared.
 * Pure code, no framework import.
 *
 * 1. `lineageCandidates`: pairs of columns in adjacent layers (Landing →
 *    Normalized, Normalized → Consumption; Landing → Consumption only when
 *    the run has no Normalized table) whose normalised names match, with a
 *    compatible type family.
 * 2. `lineageQueries`: one read-only statement per candidate whose two
 *    entities share a datasource (Postgres or Databricks): how many of the
 *    target's distinct values are found in the source.
 * 3. `lineageFromChecks`: the edges kept, with method, confidence and overlap.
 */
import type {
  ColumnRef,
  Layer,
  LayerTable,
  Lineage,
  LineageEdge,
} from './consumption-gap-analysis.schemas';
import type {
  GapQuery,
  GapQueryResult,
} from './consumption-gap-analysis.steps';

/** The most candidate pairs checked by a query in one run. */
export const LINEAGE_MAX_CHECKS = 40;

/** The most distinct target values a lineage check compares. */
export const LINEAGE_TARGET_VALUES = 1000;
/** The most distinct source values a lineage check reads. */
export const LINEAGE_SOURCE_VALUES = 10000;

/** At or above this share of matched values, the edge is proven (`values`). */
export const LINEAGE_PROVEN_OVERLAP = 0.8;
/** Below this share of matched values, the edge is dropped. */
export const LINEAGE_DROP_OVERLAP = 0.2;
/** An unchecked (or failed) candidate is kept from this confidence on. */
export const LINEAGE_KEEP_CONFIDENCE = 0.7;
/** The least token overlap (Jaccard) of a `similar-name` pair. */
export const LINEAGE_SIMILAR_TOKENS = 0.5;

/** The result columns of a lineage check. */
export const LINEAGE_TARGET_COLUMN = 'target_values';
export const LINEAGE_MATCHED_COLUMN = 'matched_values';

/** A candidate edge before (or without) its value check. */
export interface LineageCandidate {
  from: ColumnRef;
  to: ColumnRef;
  method: 'name' | 'similar-name';
  /** 0 to 1, from the name match and the type families. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// SQL helpers shared with the probes (./consumption-gap.gaps.ts)

/** The dialects the gap analysis queries. */
export type GapDialect = 'postgres' | 'databricks';

/** The dialect of a datasource kind; undefined for one it cannot query. */
export function gapDialectOf(
  kind: string | null | undefined,
): GapDialect | undefined {
  const value = (kind ?? '').trim().toLowerCase();
  return value === 'postgres' || value === 'databricks' ? value : undefined;
}

/** An identifier quoted for the dialect. */
export function quoteIdentifier(name: string, dialect: GapDialect): string {
  return dialect === 'databricks'
    ? `\`${name.replace(/`/g, '``')}\``
    : `"${name.replace(/"/g, '""')}"`;
}

/**
 * The table an entity key names: on PostgreSQL `"schema"."table"` (the
 * catalog segment is the database), on Databricks
 * `` `catalog`.`schema`.`table` ``.
 */
export function tableReference(entity: string, dialect: GapDialect): string {
  const parts = entity.split('.').filter((part) => part.length > 0);
  const kept =
    dialect === 'postgres' && parts.length > 2 ? parts.slice(-2) : parts;
  return kept.map((part) => quoteIdentifier(part, dialect)).join('.');
}

/** The SQL text type of the dialect. */
export function textType(dialect: GapDialect): string {
  return dialect === 'databricks' ? 'STRING' : 'TEXT';
}

/** The last segment of an entity key (`fct_match_results`). */
export function shortEntity(entity: string): string {
  const parts = entity.split('.');
  return parts[parts.length - 1];
}

/** A value of a result row, by column name, without case. */
export function rowValue(
  row: Record<string, unknown> | undefined,
  column: string,
): unknown {
  if (!row) return undefined;
  if (column in row) return row[column];
  const lower = column.toLowerCase();
  const key = Object.keys(row).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : row[key];
}

/** A count read from a result cell (drivers return bigints as text). */
export function countOf(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Names and types

const PREFIXES = [
  'raw_',
  'stg_',
  'src_',
  'int_',
  'dim_',
  'fct_',
  'fact_',
  'agg_',
  'v_',
];
const SUFFIXES = ['_str', '_txt', '_raw', '_text'];

/**
 * A column or table name reduced to what it means: lower case, layer
 * prefixes (`raw_`, `stg_`, `src_`, `int_`, `dim_`, `fct_`, `fact_`, `agg_`,
 * `v_`) and storage suffixes (`_str`, `_txt`, `_raw`, `_text`) removed.
 */
export function normaliseName(name: string): string {
  let value = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of PREFIXES) {
      if (value.startsWith(prefix) && value.length > prefix.length) {
        value = value.slice(prefix.length);
        changed = true;
      }
    }
    for (const suffix of SUFFIXES) {
      if (value.endsWith(suffix) && value.length > suffix.length) {
        value = value.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return value;
}

function tokens(name: string): string[] {
  return normaliseName(name)
    .split('_')
    .filter((token) => token.length > 0);
}

/** A token without a plural `s` (`matches` → `match`). */
function singular(token: string): string {
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

/** Shared tokens over all tokens (Jaccard). */
function tokenOverlap(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  const shared = [...left].filter((token) => right.has(token)).length;
  const all = new Set([...left, ...right]).size;
  return all === 0 ? 0 : shared / all;
}

/** A column type's family. */
export type TypeFamily = 'number' | 'text' | 'date' | 'boolean' | 'other';

export function typeFamily(type: string): TypeFamily {
  const t = type.trim().toLowerCase();
  if (/^(bool|boolean)\b/.test(t)) return 'boolean';
  if (/(timestamp|date|time|interval)/.test(t)) return 'date';
  if (
    /(int|numeric|decimal|double|float|real|number|serial|money|long|short|byte)/.test(
      t,
    )
  ) {
    return 'number';
  }
  if (/(text|char|string|varchar|uuid|citext|enum)/.test(t)) return 'text';
  return 'other';
}

/**
 * How much the types let a column feed another: 1 for the same family,
 * 0.85 for text cast to a number or a date, 0.8 when a type is unknown,
 * 0 otherwise.
 */
function typeFactor(from: string, to: string): number {
  const a = typeFamily(from);
  const b = typeFamily(to);
  if (a === 'other' || b === 'other') return 0.8;
  if (a === b) return 1;
  if (a === 'text' && (b === 'number' || b === 'date')) return 0.85;
  return 0;
}

const LAYER_RANK: Record<Layer, number> = {
  landing: 0,
  normalized: 1,
  consumption: 2,
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Candidates

/**
 * Candidate edges, best first, at most `limit` (default 200). Confidence:
 * an exact normalised-name match starts at 0.75, a `similar-name` match
 * (token overlap at least 0.5) at 0.4 + 0.4 × overlap; plus 0.15 when the
 * normalised table names are equal, or 0.05 when they share a token; times
 * the type factor (see `typeFactor`), capped at 0.95.
 */
export function lineageCandidates(
  tables: readonly LayerTable[],
  limit = 200,
): LineageCandidate[] {
  const hasNormalized = tables.some((t) => t.layer === 'normalized');
  const pairs: Array<[LayerTable, LayerTable]> = [];
  for (const from of tables) {
    for (const to of tables) {
      const step = LAYER_RANK[to.layer] - LAYER_RANK[from.layer];
      const adjacent =
        step === 1 ||
        (step === 2 && !hasNormalized && from.layer === 'landing');
      if (adjacent) pairs.push([from, to]);
    }
  }
  const out: Array<LineageCandidate & { order: number }> = [];
  for (const [from, to] of pairs) {
    const fromTable = normaliseName(shortEntity(from.entity));
    const toTable = normaliseName(shortEntity(to.entity));
    const fromTableTokens = new Set(fromTable.split('_').map(singular));
    const tableBonus =
      fromTable === toTable
        ? 0.15
        : toTable
              .split('_')
              .map(singular)
              .some((token) => fromTableTokens.has(token))
          ? 0.05
          : 0;
    for (const target of to.columns) {
      const targetName = normaliseName(target.name);
      const targetTokens = tokens(target.name);
      for (const source of from.columns) {
        const factor = typeFactor(source.type, target.type);
        if (factor === 0) continue;
        let method: LineageCandidate['method'];
        let base: number;
        if (normaliseName(source.name) === targetName) {
          method = 'name';
          base = 0.75;
        } else {
          const overlap = tokenOverlap(tokens(source.name), targetTokens);
          if (overlap < LINEAGE_SIMILAR_TOKENS) continue;
          method = 'similar-name';
          base = 0.4 + 0.4 * overlap;
        }
        out.push({
          from: { entity: from.entity, column: source.name },
          to: { entity: to.entity, column: target.name },
          method,
          confidence: round(Math.min(0.95, (base + tableBonus) * factor)),
          order: out.length,
        });
      }
    }
  }
  out.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      (a.method === b.method ? 0 : a.method === 'name' ? -1 : 1) ||
      a.order - b.order,
  );
  return out.slice(0, Math.max(0, limit)).map((c) => ({
    from: c.from,
    to: c.to,
    method: c.method,
    confidence: c.confidence,
  }));
}

// ---------------------------------------------------------------------------
// Value checks

function tableOf(
  tables: readonly LayerTable[],
  entity: string,
): LayerTable | undefined {
  const key = entity.toLowerCase();
  return tables.find((t) => t.entity.toLowerCase() === key);
}

/** The statement of one value check, in one row. */
export function lineageCheckSql(
  candidate: LineageCandidate,
  dialect: GapDialect,
): string {
  const side = (ref: ColumnRef, cap: number): string => {
    const column = quoteIdentifier(ref.column, dialect);
    return `SELECT DISTINCT TRIM(CAST(${column} AS ${textType(dialect)})) AS v FROM ${tableReference(ref.entity, dialect)} WHERE ${column} IS NOT NULL LIMIT ${cap}`;
  };
  return `SELECT COUNT(t.v) AS ${LINEAGE_TARGET_COLUMN}, COUNT(s.v) AS ${LINEAGE_MATCHED_COLUMN} FROM (${side(candidate.to, LINEAGE_TARGET_VALUES)}) t LEFT JOIN (${side(candidate.from, LINEAGE_SOURCE_VALUES)}) s ON s.v = t.v`;
}

/**
 * The value-overlap statements for the candidates worth checking (at most
 * `LINEAGE_MAX_CHECKS`, best first), one per candidate whose two entities
 * share a Postgres or Databricks datasource. Each query's `id` is
 * `lineage-<n>`; its rationale names both columns in plain words.
 */
export function lineageQueries(
  candidates: readonly LineageCandidate[],
  tables: readonly LayerTable[],
): Array<GapQuery & { candidate: LineageCandidate }> {
  const out: Array<GapQuery & { candidate: LineageCandidate }> = [];
  for (const candidate of candidates) {
    if (out.length >= LINEAGE_MAX_CHECKS) break;
    const from = tableOf(tables, candidate.from.entity);
    const to = tableOf(tables, candidate.to.entity);
    if (!from || !to || !from.datasourceId) continue;
    if (from.datasourceId !== to.datasourceId) continue;
    const dialect = gapDialectOf(to.datasourceKind);
    if (!dialect || gapDialectOf(from.datasourceKind) !== dialect) continue;
    out.push({
      id: `lineage-${out.length + 1}`,
      datasourceId: from.datasourceId,
      sql: lineageCheckSql(candidate, dialect),
      rationale: `Checks whether the values of ${shortEntity(candidate.to.entity)}.${candidate.to.column} come from ${shortEntity(candidate.from.entity)}.${candidate.from.column}`,
      candidate,
    });
  }
  return out;
}

function pairKey(c: { from: ColumnRef; to: ColumnRef }): string {
  return [c.from.entity, c.from.column, c.to.entity, c.to.column]
    .map((part) => part.toLowerCase())
    .join('|');
}

/**
 * The edges kept once the checks have run. A check whose share of matched
 * values is at least 0.8 proves the edge (`values`, confidence 0.9 to 1);
 * under 0.2 drops it; in between keeps it with its name method and the
 * share. A candidate not checked, or whose check failed or found no target
 * value, is kept with its name method when its confidence is at least 0.7.
 */
export function lineageFromChecks(
  candidates: readonly LineageCandidate[],
  checks: ReadonlyArray<{
    query: GapQuery & { candidate: LineageCandidate };
    result: GapQueryResult | undefined;
  }>,
): Lineage {
  const byPair = new Map<string, GapQueryResult | undefined>();
  let checkedPairs = 0;
  let failedChecks = 0;
  for (const check of checks) {
    byPair.set(pairKey(check.query.candidate), check.result);
    if (!check.result) continue;
    checkedPairs += 1;
    if (check.result.error) failedChecks += 1;
  }
  const edges: LineageEdge[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = pairKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    const result = byPair.get(key);
    const row = result && !result.error ? result.rows[0] : undefined;
    const target = countOf(rowValue(row, LINEAGE_TARGET_COLUMN));
    const matched = countOf(rowValue(row, LINEAGE_MATCHED_COLUMN));
    const base = {
      from: { ...candidate.from },
      to: { ...candidate.to },
      expression: '',
    };
    if (target !== undefined && target > 0 && matched !== undefined) {
      const overlap = round(Math.min(1, matched / target));
      if (overlap < LINEAGE_DROP_OVERLAP) continue;
      if (overlap >= LINEAGE_PROVEN_OVERLAP) {
        edges.push({
          ...base,
          method: 'values',
          confidence: round(0.9 + (overlap - LINEAGE_PROVEN_OVERLAP) * 0.5),
          overlap,
        });
      } else {
        edges.push({
          ...base,
          method: candidate.method,
          confidence: candidate.confidence,
          overlap,
        });
      }
      continue;
    }
    if (candidate.confidence >= LINEAGE_KEEP_CONFIDENCE) {
      edges.push({
        ...base,
        method: candidate.method,
        confidence: candidate.confidence,
        overlap: null,
      });
    }
  }
  return { edges, checkedPairs, failedChecks };
}
