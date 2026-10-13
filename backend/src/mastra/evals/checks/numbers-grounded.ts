import { fail, PASS, quotedList, stringListProblem } from './check';
import type { DeterministicCheck } from './check';
import type { CheckToolCall, CheckTurn } from './turn';

export interface NumbersGroundedArgs {
  /** Phrases removed from the answer before its numbers are read. */
  ignore?: string[];
}

/** One number as the answer writes it. */
export interface StatedNumber {
  /** As written, for the reason (`88,966`, `87.13%`). */
  text: string;
  /** The values it may stand for: one, or two for `88.966`. */
  values: number[];
  /** Digits after the decimal point: the precision it was rounded to. */
  decimals: number;
  percent: boolean;
}

/**
 * A number not glued to a letter, digit, underscore or dot on its left, nor
 * to a letter, digit or underscore on its right: `F1`, `1st`, `2x` and
 * `1970s` are not read. Thousands with commas (`88,966`) read whole; a
 * trailing `%` or ` percent` marks a percentage.
 */
const NUMBER =
  /(?<![\p{L}\p{N}_.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![\p{L}\p{N}_])(\s?%|\s+percent\b)?/gu;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The numbers an answer states (R71): fenced code, inline code, ordered-list
 * markers and the `ignore` phrases removed first; signs ignored.
 */
export function statedNumbers(
  text: string,
  ignore: readonly string[] = [],
): StatedNumber[] {
  let prose = (text ?? '')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/^[ \t>*-]*\d+[.)](?=\s)/gm, ' ');
  for (const phrase of ignore) {
    prose = prose.replace(new RegExp(escape(phrase), 'gi'), ' ');
  }
  const found: StatedNumber[] = [];
  for (const match of prose.matchAll(NUMBER)) {
    const whole = match[1];
    const fraction = match[2];
    const grouped = whole.includes(',');
    const value = Number(
      `${whole.replace(/,/g, '')}${fraction !== undefined ? `.${fraction}` : ''}`,
    );
    const values = [value];
    // `88.966` may be a European thousands separator: try it as 88966 too
    // (never `0.871`, since a thousands group does not start with 0).
    if (
      !grouped &&
      fraction?.length === 3 &&
      whole.length <= 3 &&
      !whole.startsWith('0')
    ) {
      values.push(Number(`${whole}${fraction}`));
    }
    found.push({
      text: match[0].trim(),
      values,
      decimals: fraction?.length ?? 0,
      percent: match[3] !== undefined,
    });
  }
  return found;
}

/** A datasource or row id: its digit runs are not figures. */
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Every number inside a value: numbers, numeric text, numbers in text. */
function collectNumbers(value: unknown, into: number[]): void {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) into.push(Math.abs(value));
  } else if (typeof value === 'bigint') {
    into.push(Math.abs(Number(value)));
  } else if (typeof value === 'string') {
    // `2022-12-18T00:00:00.000Z`: split the date from the time, so the day
    // is read. Only the plain reading of each number grounds, never the
    // thousands reading an answer's `88.966` also gets.
    const text = value.replace(UUID, ' ').replace(/(\d)T(\d)/g, '$1 $2');
    for (const stated of statedNumbers(text)) {
      into.push(stated.values[0]);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, into);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectNumbers(item, into);
  }
}

/** What the turn's successful tool calls returned, as numbers to ground on. */
export interface GroundingPool {
  /** Every number of every successful result, row counts included. */
  values: number[];
  /** Pairs a share may be computed from: one row's numbers, or scalars. */
  ratioGroups: number[][];
}

function rowsOf(result: unknown): unknown[] | undefined {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows : undefined;
  }
  return undefined;
}

/**
 * The tools whose results hold the data: what a query returned, sampled rows
 * and the stored sample values `describe_entity` shows. `list_entities`
 * (column counts, datasource ids) and the visual and clarification tools
 * (text the model wrote) ground nothing.
 */
export const DATA_TOOLS = [
  'run_readonly_sql',
  'sample_rows',
  'describe_entity',
];

export function groundingPool(turn: CheckTurn): GroundingPool {
  const values: number[] = [];
  const ratioGroups: number[][] = [];
  const scalars: number[] = [];
  const succeeded = turn.toolCalls.filter(
    (call: CheckToolCall) =>
      call.error === undefined && DATA_TOOLS.includes(call.name),
  );
  for (const call of succeeded) {
    if (call.result === undefined) {
      // A stored result clipped past parsing: read what the clip left.
      if (call.resultText) collectNumbers(call.resultText, values);
      continue;
    }
    collectNumbers(call.result, values);
    const rows = rowsOf(call.result);
    if (!rows) continue;
    values.push(rows.length);
    for (const row of rows) {
      const rowValues: number[] = [];
      collectNumbers(row, rowValues);
      if (rows.length === 1) scalars.push(...rowValues);
      else ratioGroups.push(rowValues);
    }
  }
  if (scalars.length) ratioGroups.push(scalars);
  return { values, ratioGroups };
}

function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** Is one stated number grounded (R71)? */
export function isGrounded(
  stated: StatedNumber,
  questionNumbers: number[],
  pool: GroundingPool,
): boolean {
  // Half a unit of the last digit written, plus float slack.
  const tolerance = 0.5 * 10 ** -stated.decimals + 1e-9;
  const derived = stated.percent || stated.decimals > 0;
  return stated.values.some((value) => {
    if (questionNumbers.some((n) => n === value)) return true;
    if (pool.values.some((n) => near(value, n, tolerance))) return true;
    if (!derived) return false;
    if (pool.values.some((n) => near(value, 100 * n, tolerance))) return true;
    return pool.ratioGroups.some((group) =>
      group.some((x, i) =>
        group.some(
          (y, j) =>
            i !== j &&
            y !== 0 &&
            (near(value, x / y, tolerance) ||
              near(value, (100 * x) / y, tolerance)),
        ),
      ),
    );
  });
}

/**
 * `numbersGrounded` (agents-evals R71, criterion G1): every number in the
 * answer is in the question or follows from what a tool returned this turn.
 * It catches an invented figure; it cannot catch a real figure given to the
 * wrong subject (research 2.3).
 */
export const numbersGrounded: DeterministicCheck<NumbersGroundedArgs> = {
  type: 'numbersGrounded',
  id: 'check-numbers-grounded',
  name: 'Numbers Grounded Check',
  criterion: 'G1',
  args: { required: [], optional: ['ignore'] },
  validateArgs: (args) => stringListProblem(args, 'ignore'),
  describe: (args) =>
    args.ignore
      ? `Checks that every number in the answer comes from a tool result (ignoring ${quotedList(args.ignore)})`
      : 'Checks that every number in the answer comes from a tool result',
  evaluate: (turn, args) => {
    const stated = statedNumbers(turn.answer, args.ignore);
    if (stated.length === 0) return PASS;
    const questionNumbers = statedNumbers(turn.question).flatMap(
      (number) => number.values,
    );
    const pool = groundingPool(turn);
    const ungrounded = stated.filter(
      (number) => !isGrounded(number, questionNumbers, pool),
    );
    if (ungrounded.length === 0) return PASS;
    const listed = Array.from(new Set(ungrounded.map((n) => n.text)));
    const shown =
      listed.slice(0, 5).join(', ') +
      (listed.length > 5 ? ` and ${listed.length - 5} more` : '');
    const fetched = turn.toolCalls.some(
      (call) => call.error === undefined && DATA_TOOLS.includes(call.name),
    );
    return fail(
      fetched
        ? `the answer states ${shown}, which no tool result of this turn holds or rounds to`
        : `the answer states ${shown}, but no tool call of this turn returned data`,
    );
  },
};
