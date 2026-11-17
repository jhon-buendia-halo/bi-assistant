/**
 * The `excelExtension` option every caller of the importer passes
 * (`detectSheets`, `importFiles`; ADR-0052, plan m1-31 section 9).
 *
 * Until story 1.31.2 ships the extension with the app, this answers
 * `'installed'`: `LOAD excel` from DuckDB's own extension directory, which
 * works only where the extension was installed before (development).
 * Story 1.31.2 owns this function's body and replaces it with the path of
 * the shipped `excel.duckdb_extension`; callers never build the option
 * themselves.
 */
export function excelExtension(): string {
  return 'installed';
}
