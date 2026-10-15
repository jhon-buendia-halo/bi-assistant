/**
 * The line-per-row inputs of the RFP tools (agents.md 3.10, "Scalar
 * inputs"): one string, one row per line, ` | ` between fields. Parsed before
 * any HTTP call, so a malformed row never reaches the API.
 */

/** A leading list marker the model may add: `-`, `*`, `•`, `1.` or `1)`. */
const LIST_MARKER = /^(?:[-*•]|\d+[.)])\s+/;

/** The separator between fields. */
export const FIELD_SEPARATOR = ' | ';

export type ParsedRows = { rows: string[][] } | { error: string };

/**
 * Split `text` into rows of exactly `fieldCount` trimmed fields. Each line is
 * trimmed, a leading list marker dropped, blank lines ignored. A row with
 * another field count answers
 * `Row <n> "<text>": expected <k> fields separated by " | "`, where `<n>` is
 * the row's 1-based place among the non-blank lines.
 */
export function parseRows(text: string, fieldCount: number): ParsedRows {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(LIST_MARKER, '').trim())
    .filter(Boolean);
  const rows: string[][] = [];
  for (const [index, line] of lines.entries()) {
    const fields = line.split('|').map((field) => field.trim());
    if (fields.length !== fieldCount) {
      return {
        error: `Row ${index + 1} "${line}": expected ${fieldCount} fields separated by "${FIELD_SEPARATOR}"`,
      };
    }
    rows.push(fields);
  }
  return { rows };
}

/** An optional field: `-` or empty means absent. */
export function optionalField(value: string): string | undefined {
  const text = value.trim();
  return text === '' || text === '-' ? undefined : text;
}

/** A comma-separated list field; `-` or empty gives `[]`. */
export function listField(value: string): string[] {
  const text = optionalField(value);
  if (!text) return [];
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * A yes/no field, with an optional leading word (`incumbent yes`,
 * `required no`). Undefined when it is neither.
 */
export function yesNoField(value: string): boolean | undefined {
  const word = value.trim().toLowerCase().split(/\s+/).pop() ?? '';
  if (['yes', 'y', 'true'].includes(word)) return true;
  if (['no', 'n', 'false'].includes(word)) return false;
  return undefined;
}
