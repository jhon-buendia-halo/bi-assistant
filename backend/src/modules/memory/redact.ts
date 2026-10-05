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
 * A categorical code such as `own_goal`, `round_of_16` or `open_play`:
 * lowercase letters and digits joined by at least one underscore, no spaces.
 * These are schema vocabulary (enum values, stage names), not row values —
 * a name, an email or a phone number never looks like this — and a rule
 * that loses them ("exclude goal_type = '?'") is useless to the next turn.
 */
const SNAKE_CASE_CODE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

/**
 * Replace each single-quoted string literal with `'?'` unless its text
 * (case-insensitive, ignoring `LIKE` wildcards at either end) appears in
 * `question`, or it is a snake_case code.
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
    return !text || asked.includes(text) || SNAKE_CASE_CODE.test(text)
      ? literal
      : "'?'";
  });
}

/** `text` cut to `max` characters, the cut marked with `…`. */
export function clip(text: string, max: number): string {
  const value = text ?? '';
  return value.length <= max
    ? value
    : `${value.slice(0, Math.max(0, max - 1))}…`;
}
