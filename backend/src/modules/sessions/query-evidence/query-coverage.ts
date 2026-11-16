/**
 * How much of the data one query's result stands for (plan
 * docs/plans/m1-25-query-inspector.md 2.1, api.md 139 and 143). Pure: it
 * reads only the SQL, with literals and comments masked, at bracket depth 0.
 */
import { outerLimit, topLevel } from '../../datasources/connectors/sql-text';
import { capOf, maskLiterals } from '../result-guards';
import type { QueryCoverage } from './query-evidence.types';

// Moved to the datasources connectors (the paged read raises the same
// LIMIT, datasources R52); re-exported so callers are unchanged.
export {
  outerLimitOf,
  withExportLimit,
} from '../../datasources/connectors/sql-text';

/** Rows a CSV download keeps (api.md 143); the statement fetches one more to tell a cut. */
export const EXPORT_ROWS = 50_000;

export interface CoverageInput {
  /** `run_readonly_sql` or `sample_rows`. */
  tool: string;
  /** The statement that ran (`ToolDataRecord.input`). */
  sql?: string;
  /** Rows the tool returned. */
  rowCount: number;
  /** Rows the statement produced before the tool's cap; absent on records stored before 1.25. */
  totalRows?: number;
  /** The tool's cap for this call. */
  rowLimit?: number;
  /** The bridge's flag: the rows filled the tool's limit. */
  truncated?: boolean;
}

/** Whether a top-level ORDER BY comes before the outer limit. */
function rankedBefore(sql: string, at: number): boolean {
  const top = topLevel(maskLiterals(sql)).slice(0, at);
  return /\border\s+by\b/i.test(top);
}

/**
 * The coverage rules of plan 2.1, in order: `sample_rows` is a sample; rows
 * cut by the tool's cap are partial; the statement's own LIMIT, reached, is
 * a top-n with a sort before it and a sample without; anything else read the
 * whole result.
 */
export function coverageOf(input: CoverageInput): QueryCoverage {
  if (input.tool === 'sample_rows') return 'sample';
  const sql = input.sql ?? '';
  const limit = outerLimit(sql);
  const reachedOwnLimit = limit !== undefined && input.rowCount >= limit.value;
  const cut =
    typeof input.totalRows === 'number'
      ? input.totalRows > input.rowCount
      : // Stored before the facts existed: the cap the rows ran into, unless
        // it is the statement's own LIMIT (that is the ranking, not a cut).
        !reachedOwnLimit &&
        (input.truncated === true ||
          capOf(maskLiterals(sql), input.rowCount, input.rowLimit) !== null);
  if (cut) return 'partial';
  if (limit && reachedOwnLimit) {
    return rankedBefore(sql, limit.at) ? 'top-n' : 'sample';
  }
  return 'whole-table';
}
