/**
 * The rows behind a readiness finding (roadmap 1.28.11; data-readiness R34):
 * one read-only statement per finding, built from its check kind in the
 * datasource's dialect, that the Assess Data Readiness workflow's Rows
 * behind findings step runs and records as a source of the answer.
 *
 * Pure, no framework import. A statement is one SELECT, never a CTE and
 * never a LIMIT: the run caps the rows it keeps and the query inspector
 * pages the whole result (api.md 152). Where the finding is a count of rows
 * (empty values, orphans, invalid formats, negatives, swapped ranges), the
 * statement adds that count as `matching_rows`, so the figure is in the
 * result. A finding with no table or column, an accessibility finding and
 * one whose shape the builder cannot read build nothing.
 */
import {
  DATABRICKS_FORMAT_PATTERNS,
  POSTGRES_FORMAT_PATTERNS,
} from './adapters/format-rules';
import type { Finding, FormatRule } from './engine/types';

/** The dialects data readiness assesses. */
export type FindingRowsDialect = 'postgres' | 'databricks';

/** One finding's statement and the business sentence it is shown with. */
export interface FindingRowsQuery {
  sql: string;
  rationale: string;
}

/** The column that carries the count of the rows the finding measured. */
export const MATCHING_ROWS_COLUMN = 'matching_rows';

const MATCHING = `CAST(COUNT(*) OVER () AS INTEGER) AS ${MATCHING_ROWS_COLUMN}`;

/** The statement of the rows behind one finding, or undefined. */
export function findingRowsQuery(
  finding: Finding,
  dialect: FindingRowsDialect,
): FindingRowsQuery | undefined {
  if (!finding.entity || !finding.field) return undefined;
  const sql = new Dialect(dialect);
  const table = sql.table(finding.namespace, finding.entity);
  const label = finding.namespace
    ? `${finding.namespace}.${finding.entity}`
    : finding.entity;
  const fields = finding.field.split(', ');
  const [first] = fields;
  const column = sql.ident(first);
  switch (finding.dimension) {
    case 'completeness':
      return {
        sql: `SELECT *, ${MATCHING} FROM ${table} WHERE ${column} IS NULL`,
        rationale: `Rows where ${first} is empty in ${label}`,
      };
    case 'uniqueness': {
      const columns = fields.map((f) => sql.ident(f)).join(', ');
      // An id-like column's duplicates leave out its empty values, as the
      // check counts them; a declared key's are whole rows.
      const where = /duplicate value/.test(String(finding.measured ?? ''))
        ? ` WHERE ${column} IS NOT NULL`
        : '';
      return {
        sql: `SELECT ${columns}, COUNT(*) AS occurrences FROM ${table}${where} GROUP BY ${columns} HAVING COUNT(*) > 1 ORDER BY occurrences DESC, ${columns}`,
        rationale: `Values of ${finding.field} that repeat in ${label}`,
      };
    }
    case 'integrity': {
      const parent = parentOf(finding.description);
      if (!parent) return undefined;
      const key = sql.ident(parent.field);
      return {
        sql: `SELECT c.*, ${MATCHING} FROM ${table} c LEFT JOIN ${sql.table(parent.namespace, parent.entity)} p ON c.${column} = p.${key} WHERE c.${column} IS NOT NULL AND p.${key} IS NULL`,
        rationale: `Rows of ${label} whose ${first} has no match in ${parent.namespace}.${parent.entity}`,
      };
    }
    case 'reasonability':
      return reasonability(finding, sql, table, label, fields);
    case 'timeliness':
      // The table's last change is no column to sort on.
      if (first.startsWith('(')) return undefined;
      return {
        sql: `SELECT * FROM ${table} WHERE ${column} IS NOT NULL ORDER BY ${column} DESC`,
        rationale: `The newest rows of ${label} by ${first}`,
      };
    case 'consistency': {
      const norm = `LOWER(TRIM(CAST(${column} AS ${sql.text})))`;
      return {
        sql: `SELECT ${column}, COUNT(*) AS occurrences FROM ${table} WHERE ${norm} IN (SELECT ${norm} FROM ${table} GROUP BY ${norm} HAVING COUNT(DISTINCT ${column}) > 1) GROUP BY ${column} ORDER BY ${norm}, ${column}`,
        rationale: `Values of ${first} in ${label} that differ only by case or spaces`,
      };
    }
    case 'validity': {
      const rule = formatRuleOf(finding.measured);
      if (!rule) return undefined;
      return {
        sql: `SELECT *, ${MATCHING} FROM ${table} WHERE ${column} IS NOT NULL AND ${sql.invalid(column, rule)}`,
        rationale: `Rows where ${first} is not a valid ${rule} in ${label}`,
      };
    }
    default:
      return undefined;
  }
}

function reasonability(
  finding: Finding,
  sql: Dialect,
  table: string,
  label: string,
  fields: string[],
): FindingRowsQuery | undefined {
  const [first] = fields;
  const column = sql.ident(first);
  if (fields.length === 2) {
    // A start/end pair whose whole ranges are swapped.
    const [start, end] = fields;
    return {
      sql: `SELECT *, ${MATCHING} FROM ${table} WHERE ${sql.ident(end)} < ${sql.ident(start)}`,
      rationale: `Rows of ${label} where ${end} comes before ${start}`,
    };
  }
  if (/negative values/.test(finding.description)) {
    return {
      sql: `SELECT *, ${MATCHING} FROM ${table} WHERE ${column} < 0 ORDER BY ${column} ASC`,
      rationale: `Rows where ${first} is negative in ${label}`,
    };
  }
  const measured = String(finding.measured ?? '');
  const low = measured.startsWith('min = ');
  if (!low && !measured.startsWith('max = ')) return undefined;
  const temporal = /future-dated|implausibly old/.test(finding.description);
  const end = low
    ? temporal
      ? 'earliest'
      : 'lowest'
    : temporal
      ? 'latest'
      : 'highest';
  return {
    sql: `SELECT * FROM ${table} WHERE ${column} IS NOT NULL ORDER BY ${column} ${low ? 'ASC' : 'DESC'}`,
    rationale: `Rows of ${label} with the ${end} ${first}`,
  };
}

/**
 * The parent an integrity finding names (its description, as the integrity
 * check writes it: `… with no matching "<namespace>.<table>.<column>"`).
 */
function parentOf(
  description: string,
): { namespace: string; entity: string; field: string } | undefined {
  const match = /with no matching "([^"]+)"/.exec(description);
  const parts = match?.[1].split('.') ?? [];
  if (parts.length < 3 || parts.some((part) => !part)) return undefined;
  return {
    namespace: parts.slice(0, -2).join('.'),
    entity: parts[parts.length - 2],
    field: parts[parts.length - 1],
  };
}

/** The format rule a validity finding measured (`… fail <rule> format`). */
function formatRuleOf(measured: Finding['measured']): FormatRule | undefined {
  const rule = /fail (\S+) format/.exec(String(measured ?? ''))?.[1];
  return rule && rule in POSTGRES_FORMAT_PATTERNS
    ? (rule as FormatRule)
    : undefined;
}

/** Identifier quoting, the text type and the format predicate of a dialect. */
class Dialect {
  constructor(private readonly kind: FindingRowsDialect) {}

  get text(): string {
    return this.kind === 'databricks' ? 'STRING' : 'TEXT';
  }

  ident(name: string): string {
    return this.kind === 'databricks'
      ? `\`${name.replace(/`/g, '``')}\``
      : `"${name.replace(/"/g, '""')}"`;
  }

  /**
   * A table as profiling names it: on PostgreSQL `"schema"."table"`, on
   * Databricks `` `catalog`.`schema`.`table` `` (its namespace is
   * `catalog.schema`).
   */
  table(namespace: string | undefined, name: string): string {
    const space = !namespace
      ? []
      : this.kind === 'databricks'
        ? namespace.split('.')
        : [namespace];
    return [...space, name].map((part) => this.ident(part)).join('.');
  }

  /**
   * True when the value does not match the rule, as the profiler counts it:
   * PostgreSQL `!~*`, Databricks `regexp_like` with `(?i)`.
   */
  invalid(column: string, rule: FormatRule): string {
    if (this.kind === 'databricks') {
      return `NOT regexp_like(CAST(${column} AS STRING), r'(?i)${DATABRICKS_FORMAT_PATTERNS[rule]}')`;
    }
    const pattern = POSTGRES_FORMAT_PATTERNS[rule].replace(/'/g, "''");
    return `CAST(${column} AS TEXT) !~* '${pattern}'`;
  }
}
