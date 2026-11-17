# M1-31 — Excel and CSV files as datasources: plan and contract

Requested on 2026-11-17 (Free style): "research how we can support Excel files as datasets and data sources", then "let's use DuckDB", "let's go with your plan" and option B of three wireframes (review dialog). Decision: ADR-0052. Epic spec: [specs/epics/M1-31/spec.md](../../specs/epics/M1-31/spec.md). Wireframes (not in the repo): `.context/wireframes/B-closed-light.png`, `.context/wireframes/B-open-light.png` of the workspace that wrote this plan.

## 1. What the user gets

In Settings → Datasource Configuration, **New datasource** with Kind **Excel / CSV** shows a drop zone ("Drop .xlsx or .csv files here", Browse…). Each uploaded file lists its sheets (a CSV has one), each with its row and column count, header row and range, a check box to include it, and a warning chip when something looks off. **Review** opens a wide dialog with the sheet as a grid (row numbers, column letters), where the user picks the header row, changes the range, excludes a trailing total row or reads every column as text, and sees each column's detected type. **Import and check** (the kind's test) imports every included sheet; **Save datasource** is enabled after it passes. A dataset then picks the sheets in the catalog browser like tables, and the agents query them with SQL.

## 2. Facts measured on 2026-11-17 (DuckDB 1.5.2, macOS arm64)

- `read_csv` is built in and detects types (`BIGINT`, `VARCHAR`, `DOUBLE`).
- `read_xlsx` (extension `excel`, about 8 MB compressed for `windows_amd64`) read an 8 MB, 200,000 × 6 sheet in 0.44 s; `CREATE TABLE AS` took 0.45 s; a `GROUP BY` on the table 1 ms. exceljs's streaming reader read the same file in 1.07 s.
- A formula cell reads its cached value. A trailing "Total" row is read as data.
- Header detection failed on a file written by exceljs's streaming writer (columns `A1`…`F1`); `header=true` with an explicit `range` fixed it. So the importer always passes `header` and `range` explicitly, from the detection of section 5 or the user's choice.
- Whole numbers read as `DOUBLE`; a column's type comes from the first data row.
- `ATTACH '<db>' AS file (READ_ONLY)` makes `file.<schema>.<table>` resolve; a `CREATE` on it is refused. `SET enable_external_access = false` then refuses `read_csv('/etc/hosts')` and any other `ATTACH`, and cannot be set back while running; `SET lock_configuration = true` refuses every later `SET`.

## 3. Shapes (backend `datasource.entity.ts`, frontend `datasource.model.ts`)

```ts
export type DatasourceKind = 'databricks' | 'postgres' | 'rest' | 'file';

export interface FileDatasourceConfig {
  files: SourceFile[];
}

export interface SourceFile {
  id: string;              // uuid, stable across Replace file
  name: string;            // original file name, e.g. "sales_2026.xlsx"
  format: 'xlsx' | 'csv';
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;      // ISO
  schema: string;          // entity schema segment, e.g. "sales_2026" (section 4)
  sheets: SheetImport[];
  uploadId?: string;       // set only while the file is not saved yet (section 6)
}

export interface SheetImport {
  sheet: string;           // workbook sheet name; for a CSV, the file name without extension
  table: string;           // entity table segment, e.g. "region" (section 4)
  include: boolean;
  headerRow: number;       // 1-based row of the column names
  range: string;           // A1 range of header + data, e.g. "A3:H12482"
  excludeLastRow: boolean;
  allText: boolean;
  rowCount?: number;       // data rows imported, set by the import
  columns?: { name: string; type: string }[]; // set by the import
  warnings?: SheetWarning[];
}

export type SheetWarning =
  | { code: 'total-row'; row: number }       // "Last row looks like a total"
  | { code: 'no-table' }                     // "No table found" (sheet skipped)
  | { code: 'header-guessed'; row: number }  // "Header found on row <n>"
  | { code: 'duplicate-columns'; names: string[] }; // renamed "<name>_2"

export interface SheetPreview {
  sheet: string;
  headerRow: number;
  range: string;
  totalRows: number;                       // rows in range below the header
  columns: { letter: string; name: string; type: string }[];
  rows: { row: number; cells: (string | number | boolean | null)[] }[]; // first 7 + last 2 sheet rows
  warnings: SheetWarning[];
}
```

No secret field: `mask()` returns the config unchanged and `withSecrets` gets an explicit `file` branch that does nothing.

## 4. Entity keys

`file.<schema>.<table>`. `<schema>` is the file name without extension and `<table>` the sheet name, each lower-cased, every run of characters outside `[a-z0-9_]` replaced by one `_`, leading and trailing `_` removed, a leading digit prefixed with `_`, cut to 63 characters, empty → `file` / `sheet`. A duplicate in the same datasource gets `_2`, `_3`. A CSV's `<table>` equals its `<schema>`. Keys are kept on Replace file when the sheet name is unchanged, so datasets keep working.

## 5. Detection (proposal for each sheet)

- `.csv`: header row 1, the whole file, DuckDB's `read_csv` sniffing.
- `.xlsx`: read the sheet's used range with `all_varchar = true`, `header = false`; the header row is the first row in the first 20 whose non-empty cells are all text and number at least half of the widest row's; the range runs from that row to the last non-empty row and across the non-empty columns. No such row → `no-table`, `include: false`.
- `total-row`: the last data row's first non-empty cell matches `^(grand )?(total|totals|sum|subtotal)\b` (case-insensitive) → `excludeLastRow: true` by default.
- Duplicate or empty column names become `<name>_2`, `column_<letter>`.

## 6. Lifecycle and storage

- `<dataDir>/files/uploads/<uploadId>/<name>`: an uploaded file not yet saved. Deleted when saved, when the form is cancelled (`DELETE` 158), and at backend start for uploads older than 24 hours.
- `<dataDir>/files/<datasourceId>/originals/<fileId>.<ext>`: the saved copy.
- `<dataDir>/files/<datasourceId>/data.duckdb`: the imported tables, one schema per file. Saving builds it into `data.duckdb.tmp` and renames it, so a failed import leaves the previous database in place.
- Test (16) on a `file` config imports into a throwaway database under `uploads/` and answers `{ ok: true, message: "Imported <n> tables · <rows> rows" }` or the first failure, `{ ok: false, message: "<file> · <sheet>: <cause>" }`.
- Save (18) with `uploadId`s moves the files, imports, writes the document, refreshes the inventory snapshot, and drops `uploadId`.
- Delete (19) also removes `files/<datasourceId>/`.

## 7. Endpoints (api.md 2.2; numbers 156 to 158 belong to this epic)

| # | Method + path | Purpose |
|---|---|---|
| 156 | `POST /datasources/files/uploads` | Upload one file. Raw body (`application/octet-stream`), header `X-File-Name` (URI-encoded). Streamed to disk, never through the JSON parser; 200 MB cap (`413`, `File is larger than 200 MB`). Unknown extension → `400` `Only .xlsx and .csv files can be imported`; `.xls` → `400` `.xls files are not supported — save the workbook as .xlsx`. Answers `201 { uploadId, file: SourceFile }` with the detected `sheets` (section 5). |
| 157 | `POST /datasources/files/preview` | Body `{ uploadId?, datasourceId?, fileId, sheet, headerRow?, range?, excludeLastRow?, allText? }`; one of `uploadId` or `datasourceId` names where the file is. Answers `200 SheetPreview` for those options (omitted ones: the detection). Bad range → `400` `Range must look like A1:H200`. |
| 158 | `DELETE /datasources/files/uploads/:uploadId` | Drop an unsaved upload. `204`. |

Style A like the rest of 2.2 for 16 and 18 (`{ ok, message }`); 156 to 158 are Style B (real statuses).

## 8. The connector (`file.connector.ts`)

- One `DuckDBInstance` per call, `:memory:`, with `autoinstall_known_extensions` and `autoload_known_extensions` false; `ATTACH '<data.duckdb>' AS file (READ_ONLY)`; `SET enable_external_access = false`; `SET lock_configuration = true`; then the statement. Closed after the call.
- `inventory`: one catalog `file`, schemas and tables from `information_schema` of the attached database, column types as DuckDB names them.
- `sampleRows`, `runReadOnlySql` (R33 guard first, the R37 limit after), `runPagedSql` with a new `duckdb` entry in `paged-sql.ts` (identifiers in `"…"`, `$n` parameters, text cast `VARCHAR`).
- No `foreignKeys`: datasets fall back to naming inference.
- `summary`: `<n> files · <m> tables` (e.g. `2 files · 3 tables`).
- The importer (`file-import.ts`) is separate from the connector: it opens `data.duckdb.tmp` read-write with external access on, `LOAD`s the `excel` extension from its shipped path, runs `CREATE SCHEMA` and `CREATE TABLE … AS SELECT * FROM read_xlsx(…, sheet, range, header = true, all_varchar)` or `read_csv(…)`, drops the last row when asked, and reports row counts and column types.

## 9. The extension in the build

- `scripts/fetch-duckdb-extensions.mjs <platform> <outDir>`: reads the DuckDB version from `backend/package-lock.json` (`node_modules/@duckdb/node-bindings`), downloads `https://extensions.duckdb.org/v<version>/<platform>/excel.duckdb_extension.gz`, unzips it to `<outDir>/v<version>/<platform>/excel.duckdb_extension`. Platforms: `windows_amd64`, `osx_arm64`, `osx_amd64`, `linux_amd64`.
- `bootstrap.mjs` runs it for the host into `backend/vendor/duckdb-extensions/` (gitignored); `stage-backend.sh` runs it for `windows_amd64` into the staged backend; the npm package's `prepack` adds the four platforms.
- The importer resolves `<backend>/vendor/duckdb-extensions/v<version>/<platform>/excel.duckdb_extension`, with `<version>` read from the loaded DuckDB (`SELECT version()`); missing → import fails with `Excel support is missing from this installation (DuckDB <version>, <platform>)`. CSV import does not need it.
- A unit test fails when the lockfile's DuckDB version differs from the extension version the build scripts would fetch.

## 10. Agents

- `sqlDialectOf`: `file` → `duckdb`. `assistant-prompt.ts`, `system-prompts.ts` (fixer, verifier), `dataset.tools.ts` (`run_readonly_sql` description), `query-explainer.prompts.ts` labels and `skills/sql-analysis/SKILL.md` get a DuckDB line or section. Evals of the assistant and the two workflows' SQL agents run on base and branch (lessons: hash `getInstructions()` first).
- Workflow inputs: `InputDatasourceKind` and the zod descriptions add `file`.
- Refusals by allow-list: Data Readiness (`READINESS_KINDS`, the workflow catalogue's `datasourceKinds`, `builtin-sessions.ts`), synthetic data (`synthetic-data.service.ts`, and the panel's `kind !== 'rest'` becomes an allow-list), Consumption Gap (`gapDialectOf` already returns undefined). The message names the kind: `Data Readiness supports PostgreSQL and Databricks datasources; "<name>" is an Excel / CSV datasource.`
- Silent fallbacks become errors: `datasources.service.ts` `connector()` (`default` → Databricks), `withSecrets` (→ Postgres), the form's `startEdit` (→ REST), `sqlDialectOf` passthrough.

## 11. UI (ui.md, the datasource form)

- Kind option `Excel / CSV` (value `file`). The kind label `Excel / CSV` everywhere a kind is named (list chip, catalog browser, dataset list, workflow inputs, query inspector). The catalog browser's `postgres ? "PostgreSQL" : "Databricks"` becomes the shared label.
- Form, top to bottom: Name, Kind, drop zone, one card per file (icon, name, size, sheet count, Replace file, remove), one row per sheet (check box, name, warning chip, `rows · columns · Header row n · range` in mono, **Review**; a `no-table` sheet shows `Skipped`), then the import status chip and **Cancel** / **Save datasource**. **Test connection** reads **Import and check** for this kind.
- Review dialog (`.menu`, 1120 px, `role="dialog"`, Escape and Cancel close it): title `Review sheets — <file>`, the table key in mono at the right; left, the file's sheets with check boxes; right, the warning chips, Header row (select), Range (text), Exclude the last row, Read every column as text, the grid (first 7 and last 2 rows, struck-through rows are not imported, header row in primary-soft with a type chip under each name), the note `First 7 and last 2 rows of <n>. Click a row number to make it the header; edit Range to change the rows and columns read. Struck-through rows are not imported.`, then Cancel / Apply.
- Test ids: `file-drop-zone`, `file-browse`, `file-card` (`data-file`), `file-replace`, `file-remove`, `sheet-row` (`data-sheet`), `sheet-include`, `sheet-review`, `sheet-warning`, `file-import-status`, `sheet-review-dialog`, `sheet-review-header-row`, `sheet-review-range`, `sheet-review-exclude-last`, `sheet-review-all-text`, `sheet-review-grid`, `sheet-review-row` (`data-row`, `data-excluded`), `sheet-review-apply`, `sheet-review-cancel`.

## 12. Testing data

A **World Cup Excel** sample: `world_cup.xlsx` (sheets `Matches`, `Teams`, `Goals`, with a title row above the header on `Matches` and a total row on `Goals`) and `players.csv`, built from the World Cup seed by a script and committed under `backend/src/modules/testing-data/fixtures/world-cup-excel/`. `setup-local` loads it as the datasource "World Cup Excel" and the dataset "World Cup Excel".

## 13. Stories, their sections, order and parallel units

- **1.31.1** — DuckDB connector and importer: sections 2, 3, 4, 5 and 8.
- **1.31.2** — The `excel` extension ships with the app: section 9.
- **1.31.3** — Upload, preview and storage: sections 6 and 7.
- **1.31.4** — The form and the review dialog: sections 1 and 11.
- **1.31.5** — The `duckdb` dialect in the agents: section 10 (Agents, first two bullets).
- **1.31.6** — Allow-list refusals and no silent fallbacks: section 10 (last two bullets).
- **1.31.7** — World Cup Excel sample and E2E: section 12.

1.31.1 (connector and import) first; then 1.31.2 (build), 1.31.3 (upload API) and 1.31.5 (agents) in parallel; 1.31.4 (form) after 1.31.3; 1.31.6 (refusals) any time; 1.31.7 (sample and E2E) last. The Angular prototype of the form (1.31.4, on mock data) comes before every other story.
