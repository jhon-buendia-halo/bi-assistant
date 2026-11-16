import type { EvalCustomCheck } from './assistant.evals';
import { derivedFigures, matchesRounded } from './derived-figures';

/**
 * The custom checks of the `answer-writer` eval set (agents.md 8.1, 2.11;
 * roadmap 1.29.3): deterministic checks over the answer Jessica's Write
 * answer call returns (the scored answer is `{ headline, answer }` as JSON).
 * A check answers `undefined` when it passes and the reason when it fails.
 */

export interface WrittenAnswer {
  headline: string;
  answer: string;
}

/** The written answer in an eval answer, or the reason it is not one. */
export function writtenOf(answer: string): WrittenAnswer | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return 'the answer is not JSON';
  }
  const raw = parsed as Record<string, unknown> | null;
  if (
    !raw ||
    typeof raw['headline'] !== 'string' ||
    typeof raw['answer'] !== 'string'
  ) {
    return 'the answer has no headline and answer text';
  }
  return { headline: raw['headline'], answer: raw['answer'] };
}

function writerCheck(
  id: string,
  description: string,
  run: (written: WrittenAnswer) => string | undefined,
): EvalCustomCheck {
  return {
    id: `aw-${id}`,
    description,
    run: ({ answer }) => {
      const written = writtenOf(answer);
      return typeof written === 'string' ? written : run(written);
    },
  };
}

/** The whole text a reader sees: the headline and the answer. */
export function textOf(written: WrittenAnswer): string {
  return `${written.headline}\n${written.answer}`;
}

/** The reply is the answer object, its answer starting with its headline. */
export function answerParses(): EvalCustomCheck {
  return writerCheck('parses', 'The reply is { headline, answer }', (w) =>
    w.headline.trim() ? undefined : 'the headline is empty',
  );
}

/** Numbers as written: `1,204.50`, `-3`, `50000000.00`, `15.3%`. */
function numbersIn(
  text: string,
): { raw: string; value: number; decimals: number }[] {
  // Row-table markers ([[rows:2]]) and list numbering are not figures.
  const cleaned = text
    .replace(/\[\[rows:[^\]]*\]\]/g, ' ')
    .replace(/^\s*\d+[.)]\s/gm, ' ');
  return [...cleaned.matchAll(/(?<![\w.])-?\d[\d,]*(?:\.\d+)?/g)].map((m) => {
    const raw = m[0];
    const plain = raw.replace(/,/g, '');
    const decimals = plain.includes('.') ? plain.split('.')[1].length : 0;
    return { raw, value: Number(plain), decimals };
  });
}

/** Every number a row cell holds (strings that read as numbers too). */
function rowNumbers(rows: readonly Record<string, unknown>[]): number[] {
  const out: number[] = [];
  for (const row of rows) {
    for (const cell of Object.values(row)) {
      if (typeof cell === 'number' && Number.isFinite(cell)) out.push(cell);
      else if (
        typeof cell === 'string' &&
        /^-?\d+(?:\.\d+)?$/.test(cell.trim())
      ) {
        out.push(Number(cell));
      }
    }
  }
  return out;
}

/**
 * Every figure of the answer comes from the frozen rows (rounded to the
 * decimals it is written with), a sum or count the case allows, the question,
 * or a small whole number (ranks, list counts under 10).
 */
export function figuresFromRows(
  rows: readonly Record<string, unknown>[],
  allow: number[] = [],
  question = '',
): EvalCustomCheck {
  // Cells, column sums, differences and shares: the writer may derive
  // figures (its rules round "averages, ratios and other derived figures").
  const known = derivedFigures(rows, [
    ...rowNumbers(rows),
    ...allow,
    ...numbersIn(question).map((n) => n.value),
  ]);
  return writerCheck(
    'figures-from-rows',
    'Every figure of the answer is in the rows it was given',
    (w) => {
      const stray = numbersIn(textOf(w)).filter(({ raw, value, decimals }) => {
        if (Number.isInteger(value) && Math.abs(value) < 10) return false;
        if (matchesRounded(value, decimals, known)) return false;
        // Spanish thousands: "37.941" is 37,941.
        return !(
          /^-?\d{1,3}(?:\.\d{3})+$/.test(raw) &&
          matchesRounded(Number(raw.replace(/\./g, '')), 0, known)
        );
      });
      return stray.length
        ? `figures not in the rows: ${stray.map((s) => s.raw).join(', ')}`
        : undefined;
    },
  );
}

/** The answer says `pattern` (e.g. that five products tie). */
export function says(
  pattern: RegExp,
  label: string,
  id: string,
): EvalCustomCheck {
  return writerCheck(id, `The answer ${label}`, (w) =>
    pattern.test(textOf(w)) ? undefined : `the answer does not say it ${label}`,
  );
}

/** The answer never says `pattern` (e.g. NaN as a figure). */
export function neverSays(
  pattern: RegExp,
  label: string,
  id: string,
): EvalCustomCheck {
  return writerCheck(id, `The answer never ${label}`, (w) => {
    const hit = pattern.exec(textOf(w));
    return hit ? `the answer ${label}: "${hit[0]}"` : undefined;
  });
}
