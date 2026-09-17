/**
 * Result-set equality, shared by the golden-set eval harness
 * (`scripts/run-eval.ts`) and careful mode's independent cross-check.
 *
 * Two queries "agree" when they return the same facts, regardless of column
 * naming, column order, row order or connector-specific cell typing.
 *
 * Column *count* is the one shape difference that cannot be forgiven blindly:
 * a wider result may carry supporting figures the narrower one never computed.
 * The eval harness compares queries written against the same expected shape, so
 * it holds width strictly. Careful mode's verifier is told to project nothing
 * beyond the question, while the analysis agent selects the context columns its
 * answer and visuals need, so identical facts routinely arrive at different
 * widths — `widthTolerant` lets it ask whether the narrower result's facts are
 * present in the wider one instead of rejecting on shape alone.
 */

const NUMERIC = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const SIGNIFICANT_DIGITS = 6;

/**
 * Cell values arrive typed differently per connector (Databricks returns some
 * numerics as strings, dates as Date objects), so compare on a canonical form:
 * numbers at 6 significant figures, strings trimmed, whitespace-collapsed and
 * case-folded.
 */
export function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return normalizeNumber(Number(value));
  if (typeof value === 'number') return normalizeNumber(value);
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (text && NUMERIC.test(text)) return normalizeNumber(Number(text));
  return text.toLowerCase();
}

function normalizeNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(Number(value.toPrecision(SIGNIFICANT_DIGITS)));
}

/**
 * One row as an order-independent key: values are sorted, so a query that
 * returns the same facts under different column names or in a different column
 * order still matches.
 */
export function rowKey(row: Record<string, unknown>): string {
  return Object.values(row).map(normalizeValue).sort().join(' | ');
}

function multiset(rows: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = rowKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Values of one row, normalized and sorted — the multiset a row contributes. */
function rowValues(row: Record<string, unknown>): string[] {
  return Object.values(row).map(normalizeValue).sort();
}

/**
 * Is every value of `narrow` present in `wide`, counting duplicates? Used only
 * when the two results have different widths: the narrower row must be a
 * projection of the wider one for the facts to corroborate.
 */
function rowContains(wide: string[], narrow: string[]): boolean {
  const pool = new Map<string, number>();
  for (const value of wide) pool.set(value, (pool.get(value) ?? 0) + 1);
  for (const value of narrow) {
    const left = pool.get(value) ?? 0;
    if (left === 0) return false;
    pool.set(value, left - 1);
  }
  return true;
}

/**
 * Pair every narrow row with a distinct wide row that contains it. Greedy is
 * enough here: rows that contain the same values are interchangeable, so a
 * wrong pick cannot strand a row a different pick would have matched.
 */
function containsAllRows(
  wide: Record<string, unknown>[],
  narrow: Record<string, unknown>[],
): boolean {
  if (narrow.length !== wide.length) return false;
  const unused = wide.map(rowValues);
  for (const row of narrow) {
    const values = rowValues(row);
    const index = unused.findIndex((candidate) => rowContains(candidate, values));
    if (index === -1) return false;
    unused.splice(index, 1);
  }
  return true;
}

export interface ResultComparison {
  match: boolean;
  /** Why they differ — empty when they match. */
  reason: string;
  /**
   * The results agree on the facts but not on the column count — the narrower
   * one is a projection of the wider. Only ever set when `widthTolerant`.
   */
  shapeDiffers?: boolean;
}

export interface CompareOptions {
  /**
   * Compare the facts when the column counts differ instead of rejecting on
   * width. A narrower result that is a projection of the wider one matches,
   * with `shapeDiffers` set; anything else still reports the value difference.
   */
  widthTolerant?: boolean;
}

export function compareResults(
  expected: Record<string, unknown>[],
  actual: Record<string, unknown>[],
  options: CompareOptions = {},
): ResultComparison {
  const expectedWidth = Object.keys(expected[0] ?? {}).length;
  const actualWidth = Object.keys(actual[0] ?? {}).length;
  if (expected.length && actual.length && expectedWidth !== actualWidth) {
    if (!options.widthTolerant) {
      return {
        match: false,
        reason: `column count differs (expected ${expectedWidth}, got ${actualWidth})`,
      };
    }
    // Width alone says nothing, so ask the question that matters: are the
    // narrower result's figures all present in the wider one? Reporting the
    // width here would bury a real disagreement under a shape complaint.
    const [wide, narrow] =
      expectedWidth > actualWidth ? [expected, actual] : [actual, expected];
    if (containsAllRows(wide, narrow)) {
      return { match: true, reason: '', shapeDiffers: true };
    }
    return {
      match: false,
      reason: `the figures differ (compared ${expectedWidth} columns against ${actualWidth})`,
    };
  }
  const want = multiset(expected);
  const got = multiset(actual);
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [key, count] of want) {
    const delta = count - (got.get(key) ?? 0);
    if (delta > 0) missing.push(`${key}${delta > 1 ? ` x${delta}` : ''}`);
  }
  for (const [key, count] of got) {
    const delta = count - (want.get(key) ?? 0);
    if (delta > 0) extra.push(`${key}${delta > 1 ? ` x${delta}` : ''}`);
  }
  if (!missing.length && !extra.length) return { match: true, reason: '' };
  const parts: string[] = [];
  if (expected.length !== actual.length) {
    parts.push(`${expected.length} expected rows vs ${actual.length} returned`);
  }
  if (missing.length) parts.push(`missing ${preview(missing)}`);
  if (extra.length) parts.push(`unexpected ${preview(extra)}`);
  return { match: false, reason: parts.join('; ') };
}

function preview(keys: string[]): string {
  const shown = keys
    .slice(0, 2)
    .map((key) => `[${key}]`)
    .join(' ');
  return keys.length > 2 ? `${shown} (+${keys.length - 2} more)` : shown;
}
