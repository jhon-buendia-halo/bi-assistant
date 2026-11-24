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
  /** `M`, `K`, `bn`, `million`…: what the written digits are multiplied by. */
  scale: number;
  /** Hedged (`about 5,000`, `almost 4,000`, `roughly 300 to 420`): rounded on purpose. */
  approximate: boolean;
  /** Written like a year: four digits from 1900 to 2099, nothing else. */
  year: boolean;
  /** Its line says it was worked out: a gap, a lead, a total, the rest. */
  worked: boolean;
}

/**
 * Words that say a number was worked out from two others or a column
 * (R115): only then may a sum, a difference or a total ground it, so an
 * invented `4-2` score is not grounded by chance.
 */
const WORKED =
  /\b(?:by|ahead|behind|more|fewer|less|gap|difference|differ\w*|leads?|led|margin|total|totals|together|combined|in all|altogether|between them|other|rest|remaining|of the|out of|apart|sum|add(?:s|ed)? up|left out|excluded?|excluding|plus|minus|than)\b/i;

/**
 * A number not glued to a letter, digit, underscore or dot on its left, nor
 * to a letter, digit or underscore on its right: `F1`, `1st`, `2x` and
 * `1970s` are not read. Thousands with commas (`88,966`) read whole; a
 * trailing `%` or ` percent` marks a percentage.
 */
const NUMBER =
  /(?<![\p{L}\p{N}_.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(bn|[KkMB]|million|billion|thousand)(?![\p{L}\p{N}_]))?(?![\p{L}\p{N}_])(\s?%|\s+percent\b)?/gu;

/** What a magnitude suffix multiplies the written digits by. */
const SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

/** A hedge right before a number: it was rounded on purpose (R115). */
const HEDGE =
  /(?:\b(?:about|around|approximately|approx\.?|roughly|nearly|almost|close to|some|over|more than|under|less than|an estimated|estimated)|[~≈])[\s*_]*$/i;

/** Between the two ends of a hedged range: `about 2,700 to 3,000`, `350–400`. */
const RANGE_JOIN = /^\s*(?:to|–|—|-|and)\s*$/;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The numbers an answer states (R115): fenced code, inline code, ordered-list
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
  let previousEnd = -1;
  let previousApproximate = false;
  for (const match of prose.matchAll(NUMBER)) {
    const whole = match[1];
    const fraction = match[2];
    const grouped = whole.includes(',');
    const scale = match[3] ? (SCALE[match[3].toLowerCase()] ?? 1) : 1;
    const start = match.index ?? 0;
    const approximate: boolean =
      HEDGE.test(prose.slice(Math.max(0, start - 30), start)) ||
      (previousApproximate && RANGE_JOIN.test(prose.slice(previousEnd, start)));
    const lineStart = prose.lastIndexOf('\n', start) + 1;
    const lineEnd = prose.indexOf('\n', start);
    const around = prose.slice(
      Math.max(lineStart, start - 60),
      Math.min(
        lineEnd === -1 ? prose.length : lineEnd,
        start + match[0].length + 40,
      ),
    );
    const worked = WORKED.test(around);
    previousEnd = start + match[0].length;
    previousApproximate = approximate;
    const value =
      Number(
        `${whole.replace(/,/g, '')}${fraction !== undefined ? `.${fraction}` : ''}`,
      ) * scale;
    const values = [value];
    // `88.966` may be a European thousands separator: try it as 88966 too
    // (never `0.871`, since a thousands group does not start with 0).
    if (
      !grouped &&
      scale === 1 &&
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
      percent: match[4] !== undefined,
      scale,
      approximate,
      worked,
      year:
        !grouped &&
        fraction === undefined &&
        scale === 1 &&
        match[4] === undefined &&
        /^(?:19|20)\d{2}$/.test(whole),
    });
  }
  return found;
}

/**
 * Stage names whose number is not a figure (R115): `round of 16` in any case,
 * its words joined by spaces, hyphens or underscores; and `last 16` or
 * `last-16`, but only when a singular stage word follows (`the last 16
 * stage`, `a last-16 tie`) or the sentence or line ends (`reached the last
 * 16.`), so `the last 16 matches` and `the last 16 years` stay counts.
 */
const STAGE_NAMES = [
  /\bround[\s_-]+of[\s_-]+\d+(?![\p{L}\p{N}_]|[.,]\d)/giu,
  /\blast[\s-]+\d+(?=[\s-]+(?:stage|round|phase|tie|match|game)\b|[*_]*[ \t]*(?:[.!?](?!\d)|$))/gimu,
];

/** The answer without the numbers of its stage names (R115). */
export function withoutStageNames(text: string): string {
  return STAGE_NAMES.reduce(
    (prose, pattern) => prose.replace(pattern, ' '),
    text ?? '',
  );
}

const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';

/**
 * Numbers that name a time or a unit, not a figure (R115): dates
 * (`2025-12-31`, `31 Dec`, `Dec 31`), years (`2023`, not `2,023`) and the
 * fixed sizes of units (`24 hours`, `90 minutes`, `divided by 24`, `100%`).
 */
const NON_FIGURES = [
  /\b(?:24\s*hours?|60\s*(?:minutes|seconds)|(?:90|120)[\s-]?(?:minutes?|mins?)\b|divided by (?:7|12|24|60|100|365)\b|per 100\b)/gi,
  // A match clock mark (`after minute 90`, `the 120th minute`) names a rule, not a figure.
  /\b(?:minute\s+(?:45|90|105|120)|(?:45|90|105|120)(?:st|th)\s+minute)\b/gi,
  /(?<![\p{N}.,])100\s?(?:%|percent\b)/gu,
];

/** A table's first cell that only ranks its rows: `1`, `4=`, `4 (tie)`. */
const RANK_CELL =
  /^(\s*\*{0,2})(\d+)(\s*(?:=|\((?:tie|tied|ties)\))?\*{0,2}\s*)$/;

/**
 * The rank column of a markdown table is not a figure (R115): a first column
 * whose numbered cells run 1, 2, 3 (ties repeat) and never pass the row count.
 */
function withoutRankColumns(text: string): string {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trimStart().startsWith('|')) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end].trimStart().startsWith('|')) {
      end += 1;
    }
    const body = lines
      .slice(i, end)
      .map((line, k) => ({ line, at: i + k }))
      .filter(({ line }) => !/^\s*\|[\s:|-]+\|?\s*$/.test(line))
      .slice(1);
    const ranked = body
      .map(({ line, at }) => {
        const cell = line.trimStart().slice(1).split('|')[0] ?? '';
        const m = RANK_CELL.exec(cell);
        return m ? { at, cell, rank: Number(m[2]) } : undefined;
      })
      .filter((r): r is { at: number; cell: string; rank: number } => !!r);
    const ranks = ranked.map((r) => r.rank);
    const isRanking =
      ranks.length >= 2 &&
      ranks[0] === 1 &&
      ranks.every((r, k) => k === 0 || r >= ranks[k - 1]) &&
      ranks[ranks.length - 1] <= body.length;
    if (isRanking) {
      for (const r of ranked) {
        lines[r.at] = lines[r.at].replace(r.cell, r.cell.replace(/\d+/, ' '));
      }
    }
    i = end;
  }
  return lines.join('\n');
}

/** A period boundary: the first or the last days of a month (28 to 31). */
const boundary = (day: string) => Number(day) === 1 || Number(day) >= 28;

/**
 * Dates that bound a period (`2025-12-31`, `1 Jan`, `Dec 31`) name the
 * period, not a figure; any other day (`16 July`) is still checked.
 */
const DATES: [RegExp, (match: string, ...groups: string[]) => string][] = [
  [
    /\b\d{4}-\d{2}-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?/g,
    (m, day) => (boundary(day) ? ' ' : m),
  ],
  [
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+${MONTH}(?![\\p{L}])`,
      'giu',
    ),
    (m, day) => (boundary(day) ? ' ' : m),
  ],
  [
    new RegExp(`\\b${MONTH}[\\s-]+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'giu'),
    (m, day) => (boundary(day) ? ' ' : m),
  ],
];

/** The answer without its stage names, period dates, years, unit sizes and rank column (R115). */
export function withoutNonFigures(text: string): string {
  const dated = DATES.reduce(
    (prose, [pattern, keep]) => prose.replace(pattern, keep),
    withoutRankColumns(withoutStageNames(text)),
  );
  return NON_FIGURES.reduce(
    (prose, pattern) => prose.replace(pattern, ' '),
    dated,
  );
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
  } else if (value instanceof Date) {
    // A live result's timestamp is a Date (the driver parses it), which has
    // no own fields: read it as the stored record writes it, so the day,
    // month and hour of "15 July 2018, 15:00" ground as they do offline.
    if (!Number.isNaN(value.getTime())) {
      collectNumbers(value.toISOString(), into);
    }
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
  /** Pairs a share may be computed from: one row's numbers, one column, or scalars. */
  ratioGroups: number[][];
  /** Sums and differences of two numbers of one group, and column totals. */
  combined: number[];
  /** The numbers of the rows alone (not the SQL or notes a result echoes). */
  cells: number[];
}

/** A cell that is a plain number (a driver may return `numeric` as text). */
function cellNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return undefined;
}

/** At most this many numbers of one group are paired (sums and differences). */
const PAIR_LIMIT = 300;

/**
 * Differences of two numbers of a group and, for a column or the one-row
 * results (`sums`), their sums and the total. One row's numbers sit in
 * different columns, so they only subtract (attempted − completed).
 */
function combine(group: number[], into: number[], sums: boolean): void {
  const g = group.slice(0, PAIR_LIMIT);
  for (let i = 0; i < g.length; i += 1) {
    for (let j = i + 1; j < g.length; j += 1) {
      into.push(Math.abs(g[i] - g[j]));
      if (sums) into.push(Math.abs(g[i] + g[j]));
    }
  }
  if (sums && group.length > 2) {
    into.push(Math.abs(group.reduce((a, b) => a + b, 0)));
  }
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
  const combined: number[] = [];
  const cells: number[] = [];
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
    const columns = new Map<string, { numbers: number[]; seen: Set<string> }>();
    for (const row of rows) {
      const rowValues: number[] = [];
      collectNumbers(row, rowValues);
      cells.push(...rowValues);
      if (rows.length === 1) scalars.push(...rowValues);
      else {
        ratioGroups.push(rowValues);
        combine(rowValues, combined, false);
      }
      if (!row || typeof row !== 'object') continue;
      for (const [key, cell] of Object.entries(row)) {
        const column = columns.get(key) ?? { numbers: [], seen: new Set() };
        columns.set(key, column);
        if (cell !== null && cell !== undefined) {
          column.seen.add(JSON.stringify(cell));
        }
        const n = cellNumber(cell);
        if (n !== undefined) column.numbers.push(Math.abs(n));
      }
    }
    if (rows.length > 1) {
      for (const column of columns.values()) {
        // How many different values a column holds: `7 of the 16 matches`.
        values.push(column.seen.size);
        if (column.numbers.length < 2) continue;
        combine(column.numbers, combined, true);
        const total = column.numbers.reduce((a, b) => a + b, 0);
        ratioGroups.push([...column.numbers.slice(0, PAIR_LIMIT), total]);
        // A whole column's total is what the rows say together (`the data
        // holds 16 matches` over a per-stage count): grounded without a
        // "total" word, unlike a sum of two cells (fixed 2026-11-23).
        values.push(total);
      }
    }
  }
  if (scalars.length) {
    ratioGroups.push(scalars);
    combine(scalars, combined, true);
  }
  return { values, ratioGroups, combined, cells };
}

/** Half the place of a number's last non-zero digit: 2,700 → 50, 3,000 → 500. */
function hedgeTolerance(value: number): number {
  if (value === 0) return 0;
  let place = 1;
  if (Number.isInteger(value)) {
    while (value % (place * 10) === 0) place *= 10;
  } else {
    place = 10 ** -(String(value).split('.')[1] ?? '').length;
  }
  return place / 2;
}

function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** Is one stated number grounded (R115)? */
export function isGrounded(
  stated: StatedNumber,
  questionNumbers: number[],
  pool: GroundingPool,
): boolean {
  // Half a unit of the last digit written, plus float slack; a hedged number
  // (`about 2,700`) is rounded to its last non-zero digit.
  const written = 0.5 * 10 ** -stated.decimals * stated.scale;
  const derived = stated.percent || stated.decimals > 0 || stated.approximate;
  return stated.values.some((value) => {
    const tolerance =
      Math.max(written, stated.approximate ? hedgeTolerance(value) : 0) + 1e-9;
    if (questionNumbers.some((n) => n === value)) return true;
    if (pool.values.some((n) => near(value, n, tolerance))) return true;
    if (stated.worked && pool.combined.some((n) => near(value, n, tolerance))) {
      return true;
    }
    if (!derived) return false;
    if (pool.values.some((n) => near(value, 100 * n, tolerance))) return true;
    if (
      stated.worked &&
      pool.combined.some((n) => near(value, 100 * n, tolerance))
    ) {
      return true;
    }
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
 * The years a turn may name without a query holding them (R115): any year
 * from the earliest to the latest the result rows hold, and this year and the
 * last (`last year`). The question's own years ground only themselves, so a
 * year outside the data (a World Cup it does not hold) is still checked.
 */
export function yearSpan(
  pool: GroundingPool,
  now = new Date(),
): (year: number) => boolean {
  const seen = pool.cells.filter(
    (n) => Number.isInteger(n) && n >= 1900 && n <= 2099,
  );
  const current = now.getFullYear();
  const low = seen.length ? Math.min(...seen) : current;
  const high = seen.length ? Math.max(...seen) : current;
  return (year) =>
    (year >= low && year <= high) || year === current || year === current - 1;
}

/**
 * `numbersGrounded` (agents-evals R115, criterion G1): every number in the
 * answer is in the question or follows from what a tool returned this turn.
 * It catches an invented figure; it cannot catch a real figure given to the
 * wrong subject (research 2.3). The number of a stage name in the answer
 * (`round of 16`) is not a figure; in the question or a result it still
 * grounds, as any number there does.
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
    const stated = statedNumbers(withoutNonFigures(turn.answer), args.ignore);
    if (stated.length === 0) return PASS;
    const questionNumbers = statedNumbers(turn.question).flatMap(
      (number) => number.values,
    );
    const pool = groundingPool(turn);
    const inSpan = yearSpan(pool);
    const ungrounded = stated.filter((number) =>
      number.year
        ? // A year is checked against the span, never a sum or difference.
          !inSpan(number.values[0]) &&
          !questionNumbers.includes(number.values[0]) &&
          !pool.values.includes(number.values[0])
        : !isGrounded(number, questionNumbers, pool),
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
