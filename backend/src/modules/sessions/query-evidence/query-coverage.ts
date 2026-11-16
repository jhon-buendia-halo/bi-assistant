/**
 * How much of the data one query's result stands for (plan
 * docs/plans/m1-25-query-inspector.md 2.1, api.md 139 and 143). Pure: it
 * reads only the SQL, with literals and comments masked, at bracket depth 0.
 */
import { capOf, maskLiterals } from '../result-guards';
import type { QueryCoverage } from './query-evidence.types';

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

interface OuterLimit {
  value: number;
  /** Offsets of the count's digits in the SQL. */
  start: number;
  end: number;
  /** Offset of the LIMIT / FETCH keyword. */
  at: number;
}

/**
 * The masked SQL with everything inside brackets blanked, offsets kept, so
 * only the statement's own clauses are left to scan.
 */
function topLevel(mask: string): string {
  let depth = 0;
  let out = '';
  for (const ch of mask) {
    if (ch === '(') {
      depth += 1;
      out += ' ';
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      out += ' ';
    } else {
      out += depth > 0 ? (ch === '\n' ? '\n' : ' ') : ch;
    }
  }
  return out;
}

function outerLimit(sql: string): OuterLimit | undefined {
  const top = topLevel(maskLiterals(sql));
  let found: OuterLimit | undefined;
  for (const m of top.matchAll(/\blimit\s+(\d+)(\s*,\s*(\d+))?/gi)) {
    // SQLite's `LIMIT offset, count`: the count is the second number.
    const digits = m[3] ?? m[1];
    const start =
      m.index +
      (m[3] !== undefined ? m[0].length - digits.length : m[0].indexOf(digits));
    found = {
      value: Number(digits),
      start,
      end: start + digits.length,
      at: m.index,
    };
  }
  for (const m of top.matchAll(
    /\bfetch\s+(?:first|next)\s+(\d+)\s+rows?\s+only\b/gi,
  )) {
    if (found && found.at > m.index) continue;
    const start = m.index + m[0].indexOf(m[1], 'fetch'.length);
    found = {
      value: Number(m[1]),
      start,
      end: start + m[1].length,
      at: m.index,
    };
  }
  return found;
}

/** The statement's own top-level LIMIT or FETCH FIRST n, if any. */
export function outerLimitOf(sql: string): number | undefined {
  return outerLimit(sql)?.value;
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

/**
 * The statement for a CSV download (api.md 143): its top-level LIMIT (or
 * FETCH FIRST n) raised to `EXPORT_ROWS + 1`, or that LIMIT appended. A
 * trailing semicolon or comment is dropped first.
 */
export function withExportLimit(sql: string, rows = EXPORT_ROWS + 1): string {
  const mask = maskLiterals(sql);
  let end = mask.length;
  while (end > 0 && /[\s;]/.test(mask[end - 1])) end -= 1;
  const body = sql.slice(0, end);
  const limit = outerLimit(body);
  if (limit) {
    return `${body.slice(0, limit.start)}${rows}${body.slice(limit.end)}`;
  }
  return `${body}\nLIMIT ${rows}`;
}
