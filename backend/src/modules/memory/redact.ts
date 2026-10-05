/**
 * What may leave the app for the memory server. Pure module.
 *
 * A signal carries the question, the SQL and a note — and SQL can carry row
 * values in its literals (`WHERE email = 'ana@…'`). A literal the user typed
 * into the question is already in the signal, so it stays; every other
 * string literal becomes `'?'`. Numbers stay: they are limits, years and
 * thresholds far more often than personal data, and the rule needs them.
 */

/** Longest SQL a signal carries. */
export const SIGNAL_SQL_CHARS = 2_000;

/**
 * A single-quoted SQL string literal: `''` (standard) and `\'` (Databricks,
 * MySQL) escapes stay inside it.
 */
const STRING_LITERAL = /'(?:[^'\\]|\\.|'')*'/g;

/**
 * A categorical code such as `completed`, `RECEIVED`, `own_goal` or
 * `round_of_16`: one token, all lowercase or all uppercase, letters and
 * digits with optional underscores, at most 24 characters. These are schema
 * vocabulary (statuses, enum values, stage names), not row values — a person's
 * name is capitalised, an email has an `@`, a phone number is digits with
 * spaces — and a rule that loses them ("status = '?'") is useless to the next
 * turn. Capitalised words (`Croatia`, `Garcia`) are redacted on purpose.
 */
const CATEGORY_CODE = /^(?:[a-z][a-z0-9]*|[A-Z][A-Z0-9]*)(?:_[A-Za-z0-9]+)*$/;
const CATEGORY_CODE_MAX = 24;

/**
 * Replace each single-quoted string literal with `'?'` unless its text
 * (case-insensitive, ignoring `LIKE` wildcards at either end) appears in
 * `question`, or it is a category code (see `CATEGORY_CODE`).
 */
export function redactSqlLiterals(sql: string, question: string): string {
  const asked = (question ?? '').toLowerCase();
  return (sql ?? '').replace(STRING_LITERAL, (literal) => {
    const text = literal
      .slice(1, -1)
      .replace(/''/g, "'")
      .replace(/\\(.)/g, '$1')
      .replace(/^%+|%+$/g, '')
      .trim()
      .toLowerCase();
    const raw = literal.slice(1, -1);
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
