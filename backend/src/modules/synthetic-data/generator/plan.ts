// ScriptRequest → GenerationPlan (plan 2.4, 3.2, 10). Pure. The first error that applies
// is thrown as a ScriptRequestError with the exact API text.

import {
  DEFAULT_SEED,
  DEFAULT_TARGET_SCHEMA,
  ROWS_PER_TABLE_DEFAULT,
  ROWS_PER_TABLE_MAX,
  SCRIPT_ROWS_MAX,
  TARGET_SCHEMA_PATTERN,
} from '../limits';
import type {
  ExportFormat,
  SampledProfile,
  SampledRelationship,
} from '../types';
import { ScriptRequestError, type GenerationPlan } from './contract';
import { analyseTable } from './keys';

export const FORMATS: readonly ExportFormat[] = ['sql', 'csv', 'xlsx'];
export const SEED_MAX = 2147483647;

export const ERR_FORMAT = 'format must be sql, csv or xlsx';
export const ERR_ROWS = 'Row counts must be whole numbers from 1 to 10,000';
export const ERR_TOTAL = 'A script holds at most 200,000 rows';
export const ERR_SEED = 'seed must be a whole number from 0 to 2147483647';
export const ERR_SCHEMA_PG =
  'targetSchema must be a plain identifier (letters, digits, underscores)';
export const ERR_SCHEMA_DBX =
  'targetSchema must be schema or catalog.schema (letters, digits, underscores)';
export const errUnknownTable = (key: string): string =>
  `"${key}" is not a table of this profile`;

const isRowCount = (n: unknown): n is number =>
  typeof n === 'number' &&
  Number.isInteger(n) &&
  n >= 1 &&
  n <= ROWS_PER_TABLE_MAX;

export function validTargetSchema(
  dialect: SampledProfile['dialect'],
  schema: string,
): boolean {
  if (TARGET_SCHEMA_PATTERN.test(schema)) return true;
  if (dialect !== 'databricks') return false;
  const parts = schema.split('.');
  return (
    parts.length === 2 && parts.every((p) => TARGET_SCHEMA_PATTERN.test(p))
  );
}

/**
 * Target table names: the source name, or `<schema>_<table>` for every table whose
 * name is shared by another selected table in a different namespace (dots in a
 * Databricks `catalog.schema` namespace become `_`).
 */
export function targetNames(profile: SampledProfile): Map<string, string> {
  const count = new Map<string, number>();
  for (const t of profile.tables)
    count.set(t.name, (count.get(t.name) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const t of profile.tables) {
    out.set(
      t.key,
      (count.get(t.name) ?? 0) > 1
        ? `${t.namespace.replace(/\./g, '_')}_${t.name}`
        : t.name,
    );
  }
  return out;
}

export function validateScriptRequest(
  profile: SampledProfile,
  request: unknown,
): GenerationPlan {
  const r = (request && typeof request === 'object' ? request : {}) as Record<
    string,
    unknown
  >;

  // format
  const format = r.format === undefined ? 'sql' : r.format;
  if (typeof format !== 'string' || !FORMATS.includes(format as ExportFormat)) {
    throw new ScriptRequestError(ERR_FORMAT);
  }

  // row counts
  const keys = new Set(profile.tables.map((t) => t.key));
  const defaultRows =
    r.defaultRowCount === undefined
      ? ROWS_PER_TABLE_DEFAULT
      : r.defaultRowCount;
  if (!isRowCount(defaultRows)) throw new ScriptRequestError(ERR_ROWS);
  const rowCounts = r.rowCounts === undefined ? {} : r.rowCounts;
  if (!rowCounts || typeof rowCounts !== 'object' || Array.isArray(rowCounts)) {
    throw new ScriptRequestError(ERR_ROWS);
  }
  for (const [key, n] of Object.entries(rowCounts as Record<string, unknown>)) {
    if (!keys.has(key)) throw new ScriptRequestError(errUnknownTable(key));
    if (!isRowCount(n)) throw new ScriptRequestError(ERR_ROWS);
  }
  const requested = new Map<string, number>(
    profile.tables.map((t) => [
      t.key,
      (rowCounts as Record<string, number>)[t.key] ?? defaultRows,
    ]),
  );
  let total = 0;
  for (const n of requested.values()) total += n;
  if (total > SCRIPT_ROWS_MAX) throw new ScriptRequestError(ERR_TOTAL);

  // seed
  const seed = r.seed === undefined ? DEFAULT_SEED : r.seed;
  if (
    typeof seed !== 'number' ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > SEED_MAX
  ) {
    throw new ScriptRequestError(ERR_SEED);
  }

  // targetSchema
  const targetSchema =
    r.targetSchema === undefined ? DEFAULT_TARGET_SCHEMA : r.targetSchema;
  if (
    typeof targetSchema !== 'string' ||
    !validTargetSchema(profile.dialect, targetSchema)
  ) {
    throw new ScriptRequestError(
      profile.dialect === 'databricks' ? ERR_SCHEMA_DBX : ERR_SCHEMA_PG,
    );
  }

  const includeConstraints = r.includeConstraints !== false;

  const { relationships, droppedRelationships } = splitRelationships(profile);
  const rows = clampRows(profile, relationships, requested);
  const names = targetNames(profile);

  return {
    seed,
    targetSchema,
    includeConstraints,
    format: format as ExportFormat,
    tables: profile.tables.map((t) => {
      const want = requested.get(t.key)!;
      const got = rows.get(t.key)!;
      return {
        key: t.key,
        targetName: names.get(t.key)!,
        rows: got,
        ...(got < want ? { clampedFrom: want } : {}),
      };
    }),
    relationships,
    droppedRelationships,
  };
}

/** Relationships with both ends (and their columns) in the profile, and the rest. */
export function splitRelationships(profile: SampledProfile): {
  relationships: SampledRelationship[];
  droppedRelationships: SampledRelationship[];
} {
  const byKey = new Map(profile.tables.map((t) => [t.key, t]));
  const relationships: SampledRelationship[] = [];
  const droppedRelationships: SampledRelationship[] = [];
  for (const rel of profile.relationships) {
    const from = byKey.get(rel.fromTable);
    const to = byKey.get(rel.toTable);
    const ok =
      from !== undefined &&
      to !== undefined &&
      rel.fromColumns.length === rel.toColumns.length &&
      rel.fromColumns.every((c) => from.columns.some((x) => x.name === c)) &&
      rel.toColumns.every((c) => to.columns.some((x) => x.name === c));
    (ok ? relationships : droppedRelationships).push(rel);
  }
  return { relationships, droppedRelationships };
}

/**
 * A key made only of foreign-key columns holds at most the product of its parents'
 * row counts distinct tuples; a table asking for more is clamped to that number.
 * Parents may be clamped too, so this runs to a fixed point (counts only decrease).
 */
export function clampRows(
  profile: SampledProfile,
  relationships: SampledRelationship[],
  requested: Map<string, number>,
): Map<string, number> {
  const rows = new Map(requested);
  const plans = profile.tables.map((t) => ({
    key: t.key,
    plan: analyseTable(t, relationships),
  }));
  for (let pass = 0; pass <= profile.tables.length; pass++) {
    let changed = false;
    for (const { key, plan } of plans) {
      let limit = rows.get(key)!;
      for (const g of plan.groups) {
        let space = 1;
        for (const u of g.units)
          space *= rows.get(plan.units[u].rel.toTable) ?? 0;
        if (space < limit) limit = space;
      }
      if (limit < rows.get(key)!) {
        rows.set(key, limit);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rows;
}
