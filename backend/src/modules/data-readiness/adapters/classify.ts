import type { SemanticType } from '../engine/types';

/** Semantic types whose values have an order, so MIN/MAX is meaningful. */
export const COMPARABLE_TYPES: ReadonlySet<SemanticType> =
  new Set<SemanticType>(['numeric', 'temporal', 'text']);

/** Map a Postgres `format_type` string to a semantic type (spec R8). */
export function classifyType(type: string): SemanticType {
  const t = type.toLowerCase().trim();
  if (t.includes('[]')) return 'other';
  if (t === 'boolean' || t === 'bool') return 'boolean';
  if (t === 'uuid') return 'uuid';
  if (t === 'json' || t === 'jsonb') return 'json';
  if (
    /^(small|big)?int(eger)?$/.test(t) ||
    t === 'numeric' ||
    t === 'decimal' ||
    t.startsWith('numeric(') ||
    t.startsWith('decimal(') ||
    t === 'real' ||
    t === 'double precision' ||
    t === 'money'
  ) {
    return 'numeric';
  }
  if (
    t === 'date' ||
    t.startsWith('interval') ||
    t.startsWith('time') ||
    t.startsWith('timestamp')
  ) {
    return 'temporal';
  }
  if (
    t === 'text' ||
    t.startsWith('character varying') ||
    t.startsWith('varchar') ||
    t.startsWith('character') ||
    t.startsWith('char')
  ) {
    return 'text';
  }
  return 'other';
}

/**
 * Map a Databricks type (`information_schema.columns.full_data_type`) to a
 * semantic type (spec R8): `map`/`struct` are `json`, arrays and binary `other`.
 */
export function classifyDatabricksType(type: string): SemanticType {
  const t = type.toLowerCase().trim();
  // `string collate <name>` is still text.
  if (
    t === 'string' ||
    t.startsWith('string ') ||
    t.startsWith('varchar') ||
    t.startsWith('char')
  ) {
    return 'text';
  }
  if (
    t === 'int' ||
    t === 'integer' ||
    t === 'bigint' ||
    t === 'smallint' ||
    t === 'tinyint' ||
    t === 'double' ||
    t === 'float' ||
    t === 'decimal' ||
    t.startsWith('decimal(')
  ) {
    return 'numeric';
  }
  if (
    t === 'date' ||
    t === 'timestamp' ||
    t === 'timestamp_ntz' ||
    t.startsWith('interval')
  ) {
    return 'temporal';
  }
  if (t === 'boolean') return 'boolean';
  if (t.startsWith('map') || t.startsWith('struct')) return 'json';
  return 'other';
}
