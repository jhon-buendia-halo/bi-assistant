import type { EvalCustomCheck } from './assistant.evals';
import {
  endsOnClarifyingQuestion,
  numbersInText,
} from './insights-analyst-eval-checks';
import type {
  SqlTruthComparator,
  SqlTruthRows,
  SqlTruthValue,
} from './sql-truth-check';

/**
 * Checks of the `insights-analyst-retail` set (agents.md 8.1): Michael through
 * the whole Answer a Business Question workflow on Retail Ops. Two kinds the
 * other sets lack: "this answer case was answered, not turned into a
 * question" (clarification precision), and a money figure compared the way a
 * reader states it (`$3.04 million`).
 */

/**
 * The run answered instead of asking a clarifying question: fails when the
 * answer is one question line with 2 to 4 `- ` option lines (what
 * `endsOnClarifyingQuestion` accepts) or when the run called
 * `ask_clarification`. It makes a false clarification visible as a check of
 * its own, not only as a failed figure.
 */
export function answersWithoutClarifying(): EvalCustomCheck {
  return {
    id: 'answers-without-clarifying',
    description: 'The run answered instead of asking a clarifying question',
    run: async (input) => {
      if (input.toolCalls.some((call) => call.name === 'ask_clarification')) {
        return 'the run called ask_clarification instead of answering';
      }
      const clarified =
        (await endsOnClarifyingQuestion().run(input)) === undefined;
      if (!clarified) return undefined;
      const first =
        input.answer
          .split('\n')
          .map((line) => line.trim())
          .find(Boolean) ?? '';
      return `the run ended on a clarifying question: "${first}"`;
    },
  };
}

const SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

/**
 * Every reading of a text: each number, plus a number directly followed
 * (one optional space) by a scale token read at its scale (`3.04 million`,
 * `3.04M`, `3,041k`). A one-letter token must end at a word boundary, so
 * `5 months` is not 5 million.
 */
function readingsOf(text: string): number[] {
  const scaled = [
    ...text.matchAll(
      /(\d[\d,]*(?:\.\d+)?) ?(thousand|million|billion|mm|mn|bn|k|m|b)\b/gi,
    ),
  ].map((m) => Number(m[1].replace(/,/g, '')) * SCALE[m[2].toLowerCase()]);
  return [...numbersInText(text), ...scaled];
}

function cellOf(rows: SqlTruthRows, pick: SqlTruthValue | undefined): unknown {
  if (typeof pick === 'function') return pick(rows);
  const first = rows[0];
  if (!first) return undefined;
  return pick === undefined ? Object.values(first)[0] : first[pick];
}

function labelOf(rows: SqlTruthRows, pick: SqlTruthValue | undefined): string {
  if (typeof pick === 'function') return 'the picked value';
  return pick ?? Object.keys(rows[0] ?? {})[0] ?? 'the first column';
}

function figureOf(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * The money counterpart of `answerHasNumber`: the answer states the SQL value
 * as a figure, in digits or scaled (`$3.04 million`), within
 * `max(absolute, relative * |expected|)`. `relative` defaults to 1%.
 */
export function answerHasFigure(
  value?: SqlTruthValue,
  options: { relative?: number; absolute?: number } = {},
): SqlTruthComparator {
  return (rows, { answer }) => {
    const label = labelOf(rows, value);
    const expected = figureOf(cellOf(rows, value));
    if (expected === undefined) {
      return `the reference SQL gave no number for ${label}`;
    }
    const allowed = Math.max(
      options.absolute ?? 0,
      (options.relative ?? 0.01) * Math.abs(expected),
    );
    const readings = readingsOf(answer);
    if (readings.some((r) => Math.abs(r - expected) <= allowed + 1e-9)) {
      return undefined;
    }
    return `expected the answer to state about ${expected} (${label} from the reference SQL); the figures in it are ${[...new Set(readings)].slice(0, 12).join(', ') || 'none'}`;
  };
}
