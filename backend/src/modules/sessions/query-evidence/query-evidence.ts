/**
 * An answer's query evidence, derived from its stored records (plan
 * docs/plans/m1-25-query-inspector.md 2.1), and the CSV of a re-run's rows
 * (api.md 143). Pure, no framework imports.
 */
import type { ToolDataRecord } from '../entities/session.entity';
import { coverageOf, outerLimitOf } from './query-coverage';
import type { QueryEvidence, QueryFacts } from './query-evidence.types';

/** The tools whose records carry evidence. */
export const EVIDENCE_TOOLS: ReadonlySet<string> = new Set([
  'run_readonly_sql',
  'sample_rows',
]);

/** The facts a tool passed beside one record's result, when there are any. */
export type FactsOf = (
  record: ToolDataRecord,
  index: number,
) => QueryFacts | undefined;

/**
 * One entry per `run_readonly_sql` or `sample_rows` record, failed ones
 * included (with no coverage), in `data` order; `index` is the record's
 * position in `data`. Without facts (an answer stored before 1.25) the
 * coverage falls back to the cap the rows ran into.
 */
export function evidenceOf(
  data: readonly ToolDataRecord[],
  factsOf?: FactsOf,
): QueryEvidence[] {
  const evidence: QueryEvidence[] = [];
  data.forEach((record, index) => {
    if (!EVIDENCE_TOOLS.has(record.tool)) return;
    const facts = factsOf?.(record, index);
    const known = {
      ...(facts?.datasourceId ? { datasourceId: facts.datasourceId } : {}),
      ...(typeof facts?.totalRows === 'number'
        ? { totalRows: facts.totalRows }
        : {}),
      ...(typeof facts?.rowLimit === 'number'
        ? { rowLimit: facts.rowLimit }
        : {}),
    };
    if (record.error) {
      evidence.push({ index, ...known });
      return;
    }
    const outerLimit =
      record.tool === 'run_readonly_sql' && record.input
        ? outerLimitOf(record.input)
        : undefined;
    evidence.push({
      index,
      coverage: coverageOf({
        tool: record.tool,
        sql: record.input,
        rowCount: record.rowCount ?? record.rows?.length ?? 0,
        totalRows: known.totalRows,
        rowLimit: known.rowLimit,
        truncated: record.truncated,
      }),
      ...(outerLimit !== undefined ? { outerLimit } : {}),
      ...known,
    });
  });
  return evidence;
}

function csvCell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'bigint') text = value.toString();
  else if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    text = String(value);
  else text = JSON.stringify(value) ?? '';
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180: a header row of the columns, CRLF line ends, quoted where needed. */
export function csvOf(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
