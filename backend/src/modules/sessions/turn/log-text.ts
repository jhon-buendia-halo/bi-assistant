// No framework imports: Jest cannot load Mastra's ESM, so this stays testable.

/** Character budget for a failed statement or message written into the warn log (ships in diagnostics reports). */
export const SQL_LOG_CHARS = 500;

/** One-line, length-capped text for warn-level logs: SQL statements and engine error messages alike. */
export function logSql(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SQL_LOG_CHARS
    ? `${flat.slice(0, SQL_LOG_CHARS - 1)}…`
    : flat;
}
