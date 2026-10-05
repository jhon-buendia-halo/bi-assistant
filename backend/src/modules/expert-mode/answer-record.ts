import type { ToolDataRecord } from '../sessions/entities/session.entity';

/**
 * Which of a turn's queries is *the* query behind the answer.
 *
 * The naive rule — the last `run_readonly_sql` that did not fail — picks the
 * wrong statement whenever the assistant runs a supporting query after the
 * one that produced the figure (a `COUNT(*)` to say "over 38 employees", a
 * sanity check, a lookup for a label). Explaining, cross-checking or scoring
 * that supporting query misdescribes the answer.
 *
 * So the pick is evidence-based: every successful query is scored by how many
 * of its result values the answer text actually quotes, the best-supported one
 * wins, and the latest wins a tie (the old rule). A turn whose answer quotes
 * nothing from any result falls back to the last successful query unchanged.
 */
export function pickAnswerRecord(
  data: ToolDataRecord[] | undefined,
  answer: string | undefined,
): ToolDataRecord | undefined {
  const runs = (data ?? []).filter(
    (record) =>
      record.tool === 'run_readonly_sql' &&
      !record.error &&
      record.input?.trim(),
  );
  if (!runs.length) return undefined;
  const text = answer?.trim();
  if (!text || runs.length === 1) return runs.at(-1);

  const numbers = answerNumbers(text);
  const lowered = text.toLowerCase();
  const headline = headlineNumber(numbers);
  const scored = runs.map((record) => ({
    record,
    ...evidence(record, numbers, lowered, headline),
  }));
  // The first figure an answer states is its headline; the query that
  // produced it is the one to explain, even when a breakdown query that ran
  // alongside quotes more values in total. Only when no query produced the
  // headline does the most-quoted query win.
  const leaders = scored.some((s) => s.quotesHeadline)
    ? scored.filter((s) => s.quotesHeadline)
    : scored;
  let best = leaders.at(-1)!;
  // Latest first so an equal score keeps the latest — the previous rule.
  for (let i = leaders.length - 1; i >= 0; i--) {
    if (leaders[i].score > best.score) best = leaders[i];
  }
  return best.score > 0 ? best.record : runs.at(-1);
}

const MAX_ROWS_SCANNED = 50;

/**
 * How much of a result the answer quotes. A distinct value counts once;
 * specific values (decimals, large numbers, strings) weigh more than small
 * integers, which appear in prose for many reasons ("2025", "3 queries").
 */
export function evidenceScore(
  record: ToolDataRecord,
  numbers: number[],
  loweredAnswer: string,
): number {
  return evidence(record, numbers, loweredAnswer).score;
}

function evidence(
  record: ToolDataRecord,
  numbers: number[],
  loweredAnswer: string,
  headline?: number,
): { score: number; quotesHeadline: boolean } {
  const seen = new Set<string>();
  let score = 0;
  let quotesHeadline = false;
  for (const row of (record.rows ?? []).slice(0, MAX_ROWS_SCANNED)) {
    for (const cell of Object.values(row)) {
      const key = String(cell);
      if (cell === null || cell === undefined || seen.has(key)) continue;
      seen.add(key);
      const numeric = asNumber(cell);
      if (numeric !== undefined) {
        if (numbers.some((n) => numbersMatch(n, numeric))) {
          score += numberSpecificity(numeric);
        }
        if (headline !== undefined && numbersMatch(headline, numeric)) {
          quotesHeadline = true;
        }
        continue;
      }
      if (typeof cell === 'string') {
        const value = cell.trim().toLowerCase();
        if (value.length >= 3 && loweredAnswer.includes(value)) {
          // Three-letter codes (USD, EUR, GBP) turn up in prose for many
          // reasons; a name or a date is far better evidence.
          score += value.length >= 4 ? 2 : 1;
        }
      }
    }
  }
  return { score, quotesHeadline };
}

/** The first number in the answer that is not a year — the figure it leads with. */
function headlineNumber(numbers: number[]): number | undefined {
  return numbers.find((n) => !(Number.isInteger(n) && n >= 1900 && n <= 2100));
}

/**
 * How much a matched number proves. A decimal is almost certainly the
 * figure the answer reports; a large integer probably is; a small integer
 * ("12 promotions", "3 queries") is weak; a year-like integer (2025) proves
 * nothing, since the question itself names the year.
 */
function numberSpecificity(value: number): number {
  if (!Number.isInteger(value)) return 3;
  if (value >= 1900 && value <= 2100) return 0;
  return Math.abs(value) >= 1000 ? 2 : 1;
}

/** Every number the answer mentions, commas stripped: "$127,520.61" → 127520.61. */
export function answerNumbers(answer: string): number[] {
  const out: number[] = [];
  for (const match of answer.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
    const value = Number(match[0].replace(/,/g, ''));
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

function asNumber(cell: unknown): number | undefined {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : undefined;
  if (typeof cell === 'bigint') return Number(cell);
  if (typeof cell === 'string' && /^-?\d+(?:\.\d+)?$/.test(cell.trim())) {
    return Number(cell.trim());
  }
  return undefined;
}

/**
 * The answer may round ("$127,521"), show a ratio as a percentage (0.1154 →
 * 11.54%) or keep two decimals — all of those count as quoting the value.
 */
function numbersMatch(quoted: number, value: number): boolean {
  const candidates = [value, value * 100];
  return candidates.some((v) => {
    if (Number.isInteger(quoted) && Number.isInteger(v)) return quoted === v;
    const tolerance = Math.max(Math.abs(v) * 0.005, 0.5);
    return Math.abs(quoted - v) <= tolerance;
  });
}
