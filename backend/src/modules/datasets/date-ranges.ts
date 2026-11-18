/**
 * The range of each date column of a table (agents.md 5.11 *Data dates*;
 * data-model 3.3 `range`): one `MIN`/`MAX` statement per table, read over
 * the whole table when the dataset is saved, in the datasource's dialect.
 * Pure: the service runs the statement.
 */
import {
  DATE_RANGE_COLUMNS_MAX,
  isDateType,
  isoDay,
  type DateRange,
} from '../../mastra/data-dates';
import type { DatasourceKind } from '../datasources/entities/datasource.entity';

/** How a dialect quotes, names a table and casts a date to text. */
interface Dialect {
  quote: (name: string) => string;
  table: (parts: [string, string, string]) => string;
  text: string;
}

const doubleQuoted = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** The dialects that can read a range; a REST datasource cannot. */
const DIALECTS: Partial<Record<DatasourceKind, Dialect>> = {
  // `database.schema.table`: the connection is the database.
  postgres: {
    quote: doubleQuoted,
    table: ([, schema, table]) =>
      `${doubleQuoted(schema)}.${doubleQuoted(table)}`,
    text: 'TEXT',
  },
  // `file.schema.table` in the datasource's DuckDB database.
  file: {
    quote: doubleQuoted,
    table: ([catalog, schema, table]) =>
      `${catalog}.${doubleQuoted(schema)}.${doubleQuoted(table)}`,
    text: 'VARCHAR',
  },
  databricks: {
    quote: (name) => `\`${name.replace(/`/g, '``')}\``,
    table: (parts) =>
      parts.map((p) => `\`${p.replace(/`/g, '``')}\``).join('.'),
    text: 'STRING',
  },
};

/** The date columns a range is read for, at most `DATE_RANGE_COLUMNS_MAX`. */
export function dateColumns(
  columns: readonly { name: string; type: string }[],
): string[] {
  return columns
    .filter((column) => isDateType(column.type))
    .slice(0, DATE_RANGE_COLUMNS_MAX)
    .map((column) => column.name);
}

/**
 * The statement that reads the first and last date of each column, as
 * text (`min_0`, `max_0`, …), or null when the kind cannot run one, the key
 * is not `catalog.schema.table` or there is no date column.
 */
export function dateRangeSql(
  kind: DatasourceKind,
  entity: string,
  columns: readonly string[],
): string | null {
  const dialect = DIALECTS[kind];
  const parts = entity.split('.');
  if (!dialect || parts.length !== 3 || !columns.length) return null;
  const reads = columns.flatMap((name, i) => [
    `CAST(MIN(${dialect.quote(name)}) AS ${dialect.text}) AS min_${i}`,
    `CAST(MAX(${dialect.quote(name)}) AS ${dialect.text}) AS max_${i}`,
  ]);
  return `SELECT ${reads.join(', ')} FROM ${dialect.table(parts as [string, string, string])}`;
}

/** Each column's range from the statement's one row; a column with no date is left out. */
export function rangesOf(
  columns: readonly string[],
  row: Record<string, unknown> | undefined,
): Map<string, DateRange> {
  const ranges = new Map<string, DateRange>();
  columns.forEach((name, i) => {
    const min = isoDay(row?.[`min_${i}`]);
    const max = isoDay(row?.[`max_${i}`]);
    if (min && max) ranges.set(name, { min, max });
  });
  return ranges;
}
