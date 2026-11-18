import type { LearningSignalKind } from './learning-store.port';

/**
 * What a signal says, as the memory stores it (knowledge R32, R33). Pure
 * module.
 *
 * A signal carries the question, the SQL and a note, and SQL can carry row
 * values in its literals (`WHERE email = 'ana@…'`). A literal the user typed
 * into the question is already in the signal, so it stays; a category code
 * is schema vocabulary, so it stays; every other string literal becomes
 * `'?'`. Numbers stay: they are limits, years and thresholds far more often
 * than personal data.
 */

/** Longest SQL a signal carries. */
export const SIGNAL_SQL_CHARS = 2_000;
/** Longest note a signal carries. */
export const SIGNAL_NOTE_CHARS = 1_000;

/**
 * A single-quoted SQL string literal: `''` (standard) and `\'` (Databricks,
 * MySQL) escapes stay inside it.
 */
const STRING_LITERAL = /'(?:[^'\\]|\\.|'')*'/g;

/**
 * A category code such as `completed`, `RECEIVED`, `own_goal` or `DF`: one
 * token, all lowercase or all uppercase, letters and digits with optional
 * underscores, at most 24 characters. A person's name is capitalised, an
 * email has an `@`, so neither is one.
 */
const CATEGORY_CODE =
  /^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)$/;
const CATEGORY_CODE_MAX = 24;

/**
 * Replace each single-quoted string literal with `'?'` unless its text
 * (ignoring case and `LIKE` wildcards at either end) appears in `question`,
 * or it is a category code.
 */
export function redactSqlLiterals(sql: string, question: string): string {
  const asked = (question ?? '').toLowerCase();
  return (sql ?? '').replace(STRING_LITERAL, (literal) => {
    const raw = literal.slice(1, -1);
    const text = raw
      .replace(/''/g, "'")
      .replace(/\\(.)/g, '$1')
      .replace(/^[%_]+|[%_]+$/g, '')
      .trim()
      .toLowerCase();
    const isCode = raw.length <= CATEGORY_CODE_MAX && CATEGORY_CODE.test(raw);
    return !text || asked.includes(text) || isCode ? literal : "'?'";
  });
}

/** `text` cut to `max` characters, the cut marked with `…`. */
export function clip(text: string, max: number): string {
  const value = text ?? '';
  return value.length <= max
    ? value
    : `${value.slice(0, Math.max(0, max - 1))}…`;
}

export interface SignalTextInput {
  kind: LearningSignalKind;
  /** ISO time of the rated or noted answer; its UTC day is the date. */
  occurredAt: string;
  question: string;
  /** The answer's SQL as it ran; redacted and clipped here. */
  sql: string;
  /** A correction's note, or a rejection's note when it has one. */
  note?: string;
}

/** `YYYY-MM-DD` of an ISO time, in UTC. */
export function utcDay(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time)
    ? iso.slice(0, 10)
    : new Date(time).toISOString().slice(0, 10);
}

/** The SQL line's label: only an approval's SQL is ever to be reused. */
const SQL_LABEL: Record<LearningSignalKind, string> = {
  verified_query: 'Approved SQL',
  correction: 'Corrected SQL (do not reuse)',
  rejection: 'Rejected SQL (do not reuse)',
};

/**
 * The signal exactly as the memory stores it (knowledge R33). The SQL of a
 * correction is the SQL that was wrong, so it is never labelled approved or
 * final. A rejection has its note line only when it has a note.
 */
export function signalText(input: SignalTextInput): string {
  const question = input.question.trim();
  const sql = clip(
    redactSqlLiterals(input.sql.trim(), question),
    SIGNAL_SQL_CHARS,
  );
  const note = clip((input.note ?? '').trim(), SIGNAL_NOTE_CHARS);
  const lines = [
    `[${input.kind} · ${utcDay(input.occurredAt)}]`,
    `Question: ${question}`,
    `${SQL_LABEL[input.kind]}: ${sql}`,
  ];
  if (input.kind === 'correction' || (input.kind === 'rejection' && note)) {
    lines.push(`Analyst note: ${note}`);
  }
  return lines.join('\n');
}
