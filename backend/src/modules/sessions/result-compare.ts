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
 *
 * Rounding is the other difference the eval harness has to forgive: a
 * hand-written reference that rounds (`ROUND(x, 4)` → `0.4847`) and an answer
 * whose SQL did not (`0.48466…`) state the same fact, yet differ at six
 * significant figures. `precisionTolerant` accepts that — see `numbersAgree`
 * for the exact rule. It is off by default, so careful mode's cross-check (two
 * queries the engine wrote itself, neither a rounded reference) keeps its
 * verdicts.
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
    const index = unused.findIndex((candidate) =>
      rowContains(candidate, values),
    );
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
  /**
   * Treat two numbers as the same figure when they agree to the decimals the
   * coarser one shows, as long as it still carries three significant figures
   * (`numbersAgree`). Rows are then paired one by one instead of by exact
   * key. Off by default: without it the comparison is exactly the
   * six-significant-figure one.
   */
  precisionTolerant?: boolean;
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
    const contained = options.precisionTolerant
      ? containsAllRowsTolerant(wide, narrow)
      : containsAllRows(wide, narrow);
    if (contained) {
      return { match: true, reason: '', shapeDiffers: true };
    }
    return {
      match: false,
      reason: `the figures differ (compared ${expectedWidth} columns against ${actualWidth})`,
    };
  }
  if (options.precisionTolerant) return compareRowsTolerant(expected, actual);
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
  return {
    match: false,
    reason: differenceReason(expected.length, actual.length, missing, extra),
  };
}

/** `N expected rows vs M returned; missing […]; unexpected […]`. */
function differenceReason(
  expectedRows: number,
  actualRows: number,
  missing: string[],
  extra: string[],
): string {
  const parts: string[] = [];
  if (expectedRows !== actualRows) {
    parts.push(`${expectedRows} expected rows vs ${actualRows} returned`);
  }
  if (missing.length) parts.push(`missing ${preview(missing)}`);
  if (extra.length) parts.push(`unexpected ${preview(extra)}`);
  return parts.join('; ');
}

function preview(keys: string[]): string {
  const shown = keys
    .slice(0, 2)
    .map((key) => `[${key}]`)
    .join(' ');
  return keys.length > 2 ? `${shown} (+${keys.length - 2} more)` : shown;
}

/* ------------------------------------------------------- precision tolerance */

/**
 * Decimal places a value "shows" are read from its own text, capped here:
 * past ten, a float's representation noise (`0.30000000000000004`) would pose
 * as precision the figure never had.
 */
const MAX_DECIMAL_PLACES = 10;

/**
 * The coarser of two values must keep this many significant figures for a
 * rounding match. Three bounds the forgiven difference at half a unit in the
 * third figure (under 0.5 %), so `0.48` cannot pass for `0.4847`.
 */
const MIN_ROUNDED_SIGNIFICANT = 3;

/** A number exactly as its text states it: `digits × 10^-places`. */
interface ExactDecimal {
  digits: bigint;
  places: number;
}

const EXACT_NUMBER = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/**
 * The value's own text form, read exactly — numeric strings as the connector
 * returned them (Postgres `numeric` keeps its trailing zeros: `0.2840` shows
 * four places), JS numbers through their shortest representation. Parsing
 * the text instead of the float keeps rounding decisions off binary noise:
 * `0.48465` must round like the decimal it is, not like 0.48464999….
 */
function exactDecimal(value: unknown): ExactDecimal | undefined {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    text = String(value);
  } else if (typeof value === 'bigint') {
    text = value.toString();
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return undefined;
  }
  const match = EXACT_NUMBER.exec(text);
  if (!match) return undefined;
  const [, sign, whole, fraction = '', exponent = '0'] = match;
  let places = fraction.length - Number(exponent);
  let digits = whole + fraction;
  if (places < 0) {
    digits += '0'.repeat(-places);
    places = 0;
  }
  return { digits: BigInt(sign + digits), places };
}

/**
 * `value` rounded to `places` decimals (as a scaled integer), half away from
 * zero — Postgres `ROUND(numeric)` and Spark `ROUND`. An exact tie also yields
 * the other neighbour: an engine that rounds half-to-even lands there, and
 * both are honest roundings of the same number.
 */
function roundedTo(value: ExactDecimal, places: number): bigint[] {
  if (value.places <= places) {
    return [value.digits * 10n ** BigInt(places - value.places)];
  }
  const unit = 10n ** BigInt(value.places - places);
  const negative = value.digits < 0n;
  const magnitude = negative ? -value.digits : value.digits;
  const down = magnitude / unit;
  const twice = (magnitude % unit) * 2n;
  const nearest =
    twice > unit ? [down + 1n] : twice < unit ? [down] : [down + 1n, down];
  return nearest.map((candidate) => (negative ? -candidate : candidate));
}

function significantFigures(scaled: bigint): number {
  if (scaled === 0n) return 0;
  return (scaled < 0n ? -scaled : scaled).toString().length;
}

/**
 * The precision-tolerant rule, for two numbers that already differ at six
 * significant figures: round both to the fewer decimal places either one
 * shows and compare. `19.83` agrees with `19.8316`, `561.62` with
 * `561.6152`. The rounded figure must still carry `MIN_ROUNDED_SIGNIFICANT`
 * significant figures, or coarse rounding would pass for agreement — `0.48`
 * against `0.4847`, or `0` against `0.4`, is a different answer, not the same
 * one rounded. Two integers show no decimals, so between them nothing is
 * forgiven: they still compare exactly.
 */
function numbersAgree(a: ExactDecimal, b: ExactDecimal): boolean {
  const places = Math.min(MAX_DECIMAL_PLACES, a.places, b.places);
  const right = roundedTo(b, places);
  const shared = roundedTo(a, places).find((scaled) => right.includes(scaled));
  return (
    shared !== undefined &&
    significantFigures(shared) >= MIN_ROUNDED_SIGNIFICANT
  );
}

interface Cell {
  /** `normalizeValue` — equal keys are the same fact under the exact rule. */
  key: string;
  /** Numbers only: the value as its text states it. */
  exact?: ExactDecimal;
  /** Numbers only: the value as a float, for ordering candidates. */
  approx?: number;
}

interface NumericCell extends Cell {
  exact: ExactDecimal;
  approx: number;
}

function isNumericCell(cell: Cell): cell is NumericCell {
  return cell.exact !== undefined;
}

function cellOf(value: unknown): Cell {
  const exact = exactDecimal(value);
  return {
    key: normalizeValue(value),
    ...(exact ? { exact, approx: Number(value) } : {}),
  };
}

function cellsOf(row: Record<string, unknown>): Cell[] {
  return Object.values(row).map(cellOf);
}

const byValue = (a: NumericCell, b: NumericCell) => a.approx - b.approx;

/**
 * Can every cell of `inner` be paired with a distinct cell of `outer`?
 * Equal canonical forms pair first — they need no judgement — and only the
 * numbers left over go through `numbersAgree`, smallest first against the
 * smallest spare that agrees. Sorting by value (not by text, as `rowKey`
 * does) matters here: `10` (a rounded `9.996`) sorts before `5.2` as text.
 */
function cellsFit(inner: Cell[], outer: Cell[]): boolean {
  if (inner.length > outer.length) return false;
  const slots = new Map<string, number[]>();
  outer.forEach((cell, index) => {
    const list = slots.get(cell.key);
    if (list) list.push(index);
    else slots.set(cell.key, [index]);
  });
  const taken = new Set<number>();
  const loose: NumericCell[] = [];
  for (const cell of inner) {
    const index = slots.get(cell.key)?.pop();
    if (index !== undefined) taken.add(index);
    else if (isNumericCell(cell)) loose.push(cell);
    else return false;
  }
  if (!loose.length) return true;
  const spare = outer
    .filter((cell, index) => !taken.has(index))
    .filter(isNumericCell)
    .sort(byValue);
  for (const cell of loose.sort(byValue)) {
    const index = spare.findIndex((candidate) =>
      numbersAgree(cell.exact, candidate.exact),
    );
    if (index === -1) return false;
    spare.splice(index, 1);
  }
  return true;
}

/**
 * `containsAllRows` under the precision-tolerant rule. Still greedy: rows that
 * agree within rounding are near-identical, and a pick that strands another
 * row can only cost a match — it never manufactures one.
 */
function containsAllRowsTolerant(
  wide: Record<string, unknown>[],
  narrow: Record<string, unknown>[],
): boolean {
  if (narrow.length !== wide.length) return false;
  const unused = wide.map(cellsOf);
  for (const row of narrow) {
    const cells = cellsOf(row);
    const index = unused.findIndex((candidate) => cellsFit(cells, candidate));
    if (index === -1) return false;
    unused.splice(index, 1);
  }
  return true;
}

/** `key x3`, in first-seen order — the preview format the exact path uses. */
function tally(keys: string[]): string[] {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].map(
    ([key, count]) => `${key}${count > 1 ? ` x${count}` : ''}`,
  );
}

/**
 * Same-width comparison under the precision-tolerant rule. Rounding breaks
 * exact row keys, so rows are paired one by one: identical rows first, by key
 * (the common case, and linear), then each remaining expected row greedily
 * with an unused returned row whose cells all agree. What is left unpaired on
 * either side is reported exactly like the exact path's difference.
 */
function compareRowsTolerant(
  expected: Record<string, unknown>[],
  actual: Record<string, unknown>[],
): ResultComparison {
  const want = expected.map(cellsOf);
  const got = actual.map(cellsOf);
  const keyOf = (cells: Cell[]) =>
    cells
      .map((cell) => cell.key)
      .sort()
      .join(' | ');
  const spare = new Map<string, number[]>();
  got.forEach((cells, index) => {
    const key = keyOf(cells);
    const list = spare.get(key);
    if (list) list.push(index);
    else spare.set(key, [index]);
  });
  const taken = new Set<number>();
  const unpaired: number[] = [];
  want.forEach((cells, index) => {
    const match = spare.get(keyOf(cells))?.shift();
    if (match === undefined) unpaired.push(index);
    else taken.add(match);
  });
  const free = got.map((_, index) => index).filter((i) => !taken.has(i));
  const missing: number[] = [];
  for (const index of unpaired) {
    const at = free.findIndex(
      (candidate) =>
        got[candidate].length === want[index].length &&
        cellsFit(want[index], got[candidate]),
    );
    if (at === -1) missing.push(index);
    else free.splice(at, 1);
  }
  if (!missing.length && !free.length) return { match: true, reason: '' };
  return {
    match: false,
    reason: differenceReason(
      expected.length,
      actual.length,
      tally(missing.map((index) => keyOf(want[index]))),
      tally(free.map((index) => keyOf(got[index]))),
    ),
  };
}
