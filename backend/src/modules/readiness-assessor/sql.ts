// The engine's statements: portable aggregates only (COUNT, COUNT DISTINCT via
// GROUP BY, MAX, NOT EXISTS, CAST AS DATE, DATE literals) that run unchanged
// on Postgres, Databricks and DuckDB (the `file` kind). Identifiers are quoted
// with the dialect writers' rule; nothing user-supplied is ever a literal.
import { writerFor } from '../synthetic-data/dialects';
import type { InventoryEntity } from './inventory';

function quoter(entity: Pick<InventoryEntity, 'kind'>): (n: string) => string {
  const writer = writerFor(
    entity.kind === 'databricks' ? 'databricks' : 'postgres',
  );
  return (name) => writer.quoteIdent(name);
}

/**
 * The entity's table reference. Postgres keys are `database.schema.table`
 * (api.md 108), queried as `"schema"."table"`; Databricks and the `file`
 * kind keep the three parts (catalog, or DuckDB's attached `file` catalog).
 */
export function tableRef(
  entity: Pick<InventoryEntity, 'kind' | 'datasetKey'>,
): string {
  const q = quoter(entity);
  let parts = entity.datasetKey.split('.').map((p) => p.trim());
  if (entity.kind === 'postgres' && parts.length === 3) parts = parts.slice(1);
  return parts.map(q).join('.');
}

export function columnRef(
  entity: Pick<InventoryEntity, 'kind'>,
  column: string,
  alias?: string,
): string {
  const q = quoter(entity);
  return alias ? `${alias}.${q(column)}` : q(column);
}

/** An ANSI date literal (`DATE 'YYYY-MM-DD'`), valid on the three engines. */
export function dateLiteral(day: Date): string {
  return `DATE '${day.toISOString().slice(0, 10)}'`;
}

/** The window predicate on a date column, or empty. */
export function sinceClause(
  entity: Pick<InventoryEntity, 'kind'>,
  window: { column: string; since: Date } | undefined,
  alias?: string,
): string {
  if (!window) return '';
  return `${columnRef(entity, window.column, alias)} >= ${dateLiteral(window.since)}`;
}

const where = (clause: string) => (clause ? ` WHERE ${clause}` : '');

export function countRowsSql(entity: InventoryEntity): string {
  return `SELECT COUNT(*) AS row_count FROM ${tableRef(entity)}`;
}

/** `MAX` of each date column, aliased `max_<i>`. */
export function maxDatesSql(
  entity: InventoryEntity,
  columns: string[],
): string {
  const parts = columns.map(
    (c, i) => `MAX(${columnRef(entity, c)}) AS max_${i}`,
  );
  return `SELECT ${parts.join(', ')} FROM ${tableRef(entity)}`;
}

/** Rows per day of `column` since `since` (one row per day that has data). */
export function dailyVolumeSql(
  entity: InventoryEntity,
  column: string,
  since: Date,
): string {
  const day = `CAST(${columnRef(entity, column)} AS DATE)`;
  return (
    `SELECT ${day} AS load_day, COUNT(*) AS row_count FROM ${tableRef(entity)}` +
    `${where(sinceClause(entity, { column, since }))} GROUP BY ${day} ORDER BY ${day}`
  );
}

/**
 * Rows, non-null count (`nn_<i>`) and, for text columns, blank count
 * (`blank_<i>`) of each column.
 */
export function nullCountsSql(
  entity: InventoryEntity,
  columns: { name: string; text: boolean }[],
  window?: { column: string; since: Date },
): string {
  const parts = ['COUNT(*) AS row_count'];
  columns.forEach((c, i) => {
    const ref = columnRef(entity, c.name);
    parts.push(`COUNT(${ref}) AS nn_${i}`);
    if (c.text) {
      parts.push(
        `SUM(CASE WHEN TRIM(${ref}) = '' THEN 1 ELSE 0 END) AS blank_${i}`,
      );
    }
  });
  return `SELECT ${parts.join(', ')} FROM ${tableRef(entity)}${where(sinceClause(entity, window))}`;
}

/** Distinct grain keys (`key_count`) and rows (`row_count`), NULLs grouped as one key. */
export function grainCountSql(
  entity: InventoryEntity,
  columns: string[],
  window?: { column: string; since: Date },
): string {
  const cols = columns.map((c) => columnRef(entity, c)).join(', ');
  return (
    `SELECT COUNT(*) AS key_count, SUM(n) AS row_count FROM ` +
    `(SELECT ${cols}, COUNT(*) AS n FROM ${tableRef(entity)}` +
    `${where(sinceClause(entity, window))} GROUP BY ${cols}) g`
  );
}

/** Non-null references (`checked`) and those with no parent row (`orphans`). */
export function orphansSql(
  child: InventoryEntity,
  column: string,
  parent: Pick<InventoryEntity, 'kind' | 'datasetKey'>,
  parentColumn: string,
  window?: { column: string; since: Date },
): string {
  const c = columnRef(child, column, 'c');
  const filters = [`${c} IS NOT NULL`, sinceClause(child, window, 'c')]
    .filter(Boolean)
    .join(' AND ');
  // The parent's keys deduplicated first, so a non-unique parent cannot fan out.
  const keys = `(SELECT DISTINCT ${columnRef(parent, parentColumn)} AS parent_key FROM ${tableRef(parent)})`;
  return (
    `SELECT COUNT(*) AS checked, SUM(CASE WHEN p.parent_key IS NULL THEN 1 ELSE 0 END) AS orphans ` +
    `FROM ${tableRef(child)} c LEFT JOIN ${keys} p ON ${c} = p.parent_key WHERE ${filters}`
  );
}
