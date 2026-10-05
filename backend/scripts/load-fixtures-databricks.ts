/**
 * Load the three eval fixtures (`world_cup`, `health_insurance`, `genomics`)
 * from the local Postgres fixture database into a Databricks catalog, for
 * `npm run eval:validate -- --dialect databricks` and Databricks-dialect
 * suite coverage (`docs/plans/improvement-loop-engineering.md` WS4).
 *
 * ****************************************************************
 * *** UNTESTED against a live Databricks workspace. Run with    ***
 * *** --dry-run first — it never connects to Databricks and      ***
 * *** never writes a file without --yes.                         ***
 * ****************************************************************
 *
 * Reads each schema's tables and column types from the running Postgres
 * fixture (`information_schema`), maps them to Databricks SQL types, and —
 * only with `--yes` and not `--dry-run` — connects with `@databricks/sql`'s
 * `DBSQLClient` directly (not the app's `DatabricksConnector`, which is
 * read-only and rejects DDL by design — `assertReadOnlySql` in
 * `src/modules/datasources/connectors/connector.ts`) to run
 * `CREATE SCHEMA IF NOT EXISTS` / `CREATE OR REPLACE TABLE` and batch
 * `INSERT` statements (≤ 500 rows each).
 *
 * Views (`v_*`) are translated best-effort (`::type` → `CAST(... AS type)`,
 * `FILTER (WHERE p)` → `CASE WHEN p THEN ... END`, double-quoted identifiers
 * → backticks; `ILIKE` is left as-is since Databricks SQL supports it; date
 * arithmetic is flagged, never auto-translated) and WRITTEN to
 * `docker/databricks/views-<schema>.sql` for manual review — this script
 * never applies a view itself.
 *
 * Usage:
 *   npx ts-node -T -P tsconfig.json scripts/load-fixtures-databricks.ts \
 *     --host https://<workspace>.cloud.databricks.com --warehouse <id> \
 *     --catalog eval_fixtures [--schemas world_cup,health_insurance,genomics] \
 *     [--register] [--yes] [--dry-run]
 *
 * `DATABRICKS_TOKEN` env supplies the personal access token (required unless
 * `--dry-run`). See `docker/databricks/README.md` for the full runbook.
 */
// Must stay the first import: see scripts/lib/use-isolated-observability.ts.
import './lib/use-isolated-observability';
import * as fs from 'fs';
import * as path from 'path';
import { Client as PgClient } from 'pg';
import type { INestApplicationContext, LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FIXTURE_SEMANTICS } from './fixture-semantics';

// `AppModule`'s full graph (mastra, datasources, databricks, ...) is only
// needed by `registerLive`'s `--register` path, and pulls in several
// transitively-ESM-only packages (`@mastra/core` → `@sindresorhus/slugify`,
// `@databricks/sql` → `thrift` → `uuid`) that break Jest's CommonJS
// transform for node_modules. `databricks-fixture-loader.spec.ts` imports
// this module for its pure exports (type mapping, DDL/literal emission,
// view translation) and must never trigger that graph — so these four are
// `require()`'d lazily, inside `registerLive`, instead of statically
// imported. `require()` (not a dynamic `import()`) specifically because
// ts-node's CommonJS resolution hook only intercepts `require` for `.ts`
// sources at this project's module/target settings — a dynamic
// `import('../src/app.module.js')` does not resolve back to the `.ts` file
// at runtime here, only `require('../src/app.module')` does. The type-only
// imports below are erased at compile time and carry no such risk; they
// give the `require()` casts below real types instead of `any`.
import type { AppModule as AppModuleType } from '../src/app.module';
import type { DatasourcesService as DatasourcesServiceType } from '../src/modules/datasources/datasources.service';
import type { DatasetsService as DatasetsServiceType } from '../src/modules/datasets/datasets.service';
import type { DatasetsRepository as DatasetsRepositoryType } from '../src/modules/datasets/repositories/datasets.repository';

// `@databricks/sql` itself is still a plain static import (used directly by
// `main()`'s own load path, not only by `registerLive`) — safe here because
// the spec neutralises it with `jest.mock('@databricks/sql', ...)` before
// importing this file, so the real package is never evaluated inside Jest.
import { DBSQLClient } from '@databricks/sql';
import type IDBSQLSession from '@databricks/sql/dist/contracts/IDBSQLSession';

/** A misconfiguration the operator must fix — reported without a stack trace. */
class LoaderSetupError extends Error {}

// ------------------------------------------------------------- constants

const DB_PORT = Number(process.env.WORLD_CUP_DB_PORT ?? 55432);
const DB_HOST = 'localhost';
const DB_NAME = 'world_cup';
const DB_USER = 'world_cup';
const DB_PASSWORD = 'world_cup_dev';

const ALL_SCHEMAS = [
  'world_cup',
  'health_insurance',
  'genomics',
  'supply_chain',
  'banking',
] as const;
type FixtureSchema = (typeof ALL_SCHEMAS)[number];

const REPO_ROOT = path.join(__dirname, '..', '..');
const VIEWS_DIR = path.join(REPO_ROOT, 'docker', 'databricks');

const MAX_INSERT_BATCH_ROWS = 500;
const DATABRICKS_DATASOURCE_NAME = 'Fixtures (Databricks)';

/** Display name for a schema, matching `fixture-semantics.ts`'s `datasetName`. */
function displayName(schema: string): string {
  return FIXTURE_SEMANTICS.find((f) => f.schema === schema)?.datasetName ?? schema;
}

// =============================================================================
// Pure: Postgres → Databricks type mapping
// =============================================================================

export interface PgColumnTypeInfo {
  /** `information_schema.columns.data_type` — already lower/mixed case as pg returns it. */
  dataType: string;
  udtName?: string | null;
  numericPrecision?: number | null;
  numericScale?: number | null;
}

/** `numeric` with no captured precision/scale (e.g. a bare `numeric` column). */
export const DEFAULT_DECIMAL = 'DECIMAL(38,6)';

/**
 * `smallint/int/integer`→`INT`, `bigint`→`BIGINT`, `numeric(p,s)`→
 * `DECIMAL(p,s)` (default `DECIMAL(38,6)`), `real/double`→`DOUBLE`,
 * `text/varchar/char/uuid`→`STRING`, `boolean`→`BOOLEAN`, `date`→`DATE`,
 * `timestamp*`→`TIMESTAMP`, arrays/json→`STRING`. Anything unrecognised
 * falls back to `STRING` — the safest choice for a best-effort loader.
 */
export function mapPgTypeToDatabricks(info: PgColumnTypeInfo): string {
  const dt = (info.dataType ?? '').toLowerCase().trim();
  const udt = (info.udtName ?? '').toLowerCase().trim();
  if (dt === 'smallint' || dt === 'integer') return 'INT';
  if (dt === 'bigint') return 'BIGINT';
  if (dt === 'numeric' || dt === 'decimal') {
    if (info.numericPrecision != null && info.numericScale != null) {
      return `DECIMAL(${info.numericPrecision},${info.numericScale})`;
    }
    return DEFAULT_DECIMAL;
  }
  if (dt === 'real' || dt === 'double precision') return 'DOUBLE';
  if (dt === 'boolean') return 'BOOLEAN';
  if (dt === 'date') return 'DATE';
  if (dt.startsWith('timestamp')) return 'TIMESTAMP';
  if (dt === 'array' || udt.startsWith('_')) return 'STRING';
  if (dt === 'json' || dt === 'jsonb') return 'STRING';
  if (
    dt === 'text' ||
    dt === 'character varying' ||
    dt === 'character' ||
    dt === 'char' ||
    dt === 'uuid'
  ) {
    return 'STRING';
  }
  return 'STRING';
}

// =============================================================================
// Pure: DDL emission
// =============================================================================

export interface ColumnDef {
  name: string;
  pgType: string;
  databricksType: string;
  nullable: boolean;
  ordinal: number;
}

/** Backtick-quote an identifier, doubling any embedded backtick. */
export function quoteIdent(ident: string): string {
  return `\`${ident.replace(/`/g, '``')}\``;
}

export function quoteFqTable(catalog: string, schema: string, table: string): string {
  return [catalog, schema, table].map(quoteIdent).join('.');
}

export function emitCreateSchemaDdl(catalog: string, schema: string): string {
  return `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(catalog)}.${quoteIdent(schema)};`;
}

export function emitCreateTableDdl(fqTable: string, columns: ColumnDef[]): string {
  const ordered = [...columns].sort((a, b) => a.ordinal - b.ordinal);
  const lines = ordered.map(
    (c) => `  ${quoteIdent(c.name)} ${c.databricksType}${c.nullable ? '' : ' NOT NULL'}`,
  );
  return `CREATE OR REPLACE TABLE ${fqTable} (\n${lines.join(',\n')}\n);`;
}

// =============================================================================
// Pure: literal formatting + batched INSERT emission
// =============================================================================

function escapeStringLiteral(value: string): string {
  // Spark/Databricks SQL string literal escaping: backslash escapes itself
  // and the quote character.
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().replace('T', ' ').replace('Z', '').slice(0, 23);
  }
  return String(value);
}

const NUMERIC_LITERAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Format one value as a Databricks SQL literal for `databricksType`. `pg`
 * returns `bigint`/`numeric` columns as JS strings (to avoid precision
 * loss) — those are emitted unquoted when they look numeric, and quoted
 * defensively otherwise rather than producing invalid SQL.
 */
export function formatLiteral(value: unknown, databricksType: string): string {
  if (value === null || value === undefined) return 'NULL';

  if (databricksType === 'BOOLEAN') {
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    const text = String(value).toLowerCase();
    return text === 't' || text === 'true' || text === '1' ? 'TRUE' : 'FALSE';
  }
  if (databricksType === 'DATE') return `DATE'${toIsoDate(value)}'`;
  if (databricksType === 'TIMESTAMP') return `TIMESTAMP'${toIsoTimestamp(value)}'`;
  if (
    databricksType === 'INT' ||
    databricksType === 'BIGINT' ||
    databricksType === 'DOUBLE' ||
    databricksType.startsWith('DECIMAL')
  ) {
    const text = typeof value === 'number' ? String(value) : String(value).trim();
    if (NUMERIC_LITERAL_RE.test(text)) return text;
    // Unexpected shape for a numeric column — quote defensively instead of
    // emitting something that fails to parse.
    return `'${escapeStringLiteral(text)}'`;
  }
  return `'${escapeStringLiteral(String(value))}'`;
}

/**
 * Multi-row `INSERT INTO ... VALUES (...), (...);` statements, at most
 * `batchSize` rows each (default 500, per the unit's spec).
 */
export function emitInsertBatches(
  fqTable: string,
  columns: ColumnDef[],
  rows: Record<string, unknown>[],
  batchSize: number = MAX_INSERT_BATCH_ROWS,
): string[] {
  if (!rows.length) return [];
  const columnList = columns.map((c) => quoteIdent(c.name)).join(', ');
  const statements: string[] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch
      .map(
        (row) =>
          '(' +
          columns.map((c) => formatLiteral(row[c.name], c.databricksType)).join(', ') +
          ')',
      )
      .join(',\n  ');
    statements.push(`INSERT INTO ${fqTable} (${columnList}) VALUES\n  ${values};`);
  }
  return statements;
}

// =============================================================================
// Pure: best-effort view translation (Postgres → Databricks SQL)
// =============================================================================

/** Backtick every double-quoted identifier — Postgres quotes reserved words like `"position"`. */
export function requoteIdentifiers(sql: string): string {
  return sql.replace(/"([^"]+)"/g, '`$1`');
}

const CAST_TYPE_MAP: Record<string, string> = {
  text: 'STRING',
  numeric: DEFAULT_DECIMAL,
  decimal: DEFAULT_DECIMAL,
  bigint: 'BIGINT',
  int8: 'BIGINT',
  integer: 'INT',
  int4: 'INT',
  smallint: 'INT',
  int2: 'INT',
  boolean: 'BOOLEAN',
  bool: 'BOOLEAN',
  date: 'DATE',
  'double precision': 'DOUBLE',
};

function mapCastType(raw: string): string {
  const key = raw.trim().toLowerCase();
  return CAST_TYPE_MAP[key] ?? key.toUpperCase();
}

/**
 * `::type` → `CAST(... AS TYPE)`. Postgres's own view-definition printer
 * (`pg_views.definition`) always parenthesizes a cast's left-hand side when
 * it is not a bare quoted literal (`(0)::numeric`), so a single-level,
 * non-nested `(expr)::type` regex — applied repeatedly until stable, to
 * unwind several casts in sequence — plus a `'literal'::type` regex for the
 * unparenthesized string-literal case covers what these views actually
 * contain. Not a general SQL parser.
 */
export function translateCasts(sql: string): string {
  let out = sql;
  out = out.replace(
    /'((?:[^'\\]|\\.)*)'::([A-Za-z_][\w ]*)/g,
    (_m, lit: string, type: string) => `CAST('${lit}' AS ${mapCastType(type)})`,
  );
  let previous: string;
  do {
    previous = out;
    out = out.replace(
      /\(([^()]*)\)::([A-Za-z_][\w ]*)/g,
      (_m, expr: string, type: string) => `CAST(${expr} AS ${mapCastType(type)})`,
    );
  } while (out !== previous);
  return out;
}

function findMatchingClose(sql: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findMatchingOpen(sql: string, closeIdx: number): number {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    if (sql[i] === ')') depth++;
    else if (sql[i] === '(') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * `func(args) FILTER (WHERE predicate)` → `func(CASE WHEN predicate THEN
 * argsOrOne END)` (`argsOrOne` is `1` when `args` is bare `*`, since `*`
 * cannot appear inside a `CASE` `THEN`). Databricks SQL has no `FILTER`
 * clause. Hand-rolled paren matching (not a pure regex) because the
 * predicate commonly nests one level of parens
 * (`FILTER (WHERE (a.b = 'x'::text))`), which a non-nested regex cannot
 * capture correctly. `flagged` is true when a `FILTER (WHERE` occurrence
 * could not be matched to a preceding function call — left untouched in
 * `sql` for manual review rather than mistranslated.
 */
export function translateFilterClauses(sql: string): { sql: string; flagged: boolean } {
  let out = sql;
  let flagged = false;
  const FILTER_RE = /FILTER\s*\(\s*WHERE\b/i;
  let guard = 0;
  while (guard++ < 500) {
    const match = FILTER_RE.exec(out);
    if (!match) break;
    const filterKwIdx = match.index;

    let i = filterKwIdx - 1;
    while (i >= 0 && /\s/.test(out[i])) i--;
    if (out[i] !== ')') {
      flagged = true;
      break;
    }
    const argsCloseIdx = i;
    const argsOpenIdx = findMatchingOpen(out, argsCloseIdx);
    if (argsOpenIdx < 0) {
      flagged = true;
      break;
    }
    let j = argsOpenIdx - 1;
    while (j >= 0 && /[A-Za-z0-9_]/.test(out[j])) j--;
    const funcName = out.slice(j + 1, argsOpenIdx);
    if (!funcName) {
      flagged = true;
      break;
    }
    const args = out.slice(argsOpenIdx + 1, argsCloseIdx);

    const afterFilter = out.indexOf('(', filterKwIdx);
    const filterCloseIdx = findMatchingClose(out, afterFilter);
    if (filterCloseIdx < 0) {
      flagged = true;
      break;
    }
    const inner = out.slice(afterFilter + 1, filterCloseIdx).trim();
    const predicate = inner.replace(/^WHERE\s+/i, '');
    const argsOrOne = args.trim() === '*' ? '1' : args;
    const replacement = `${funcName}(CASE WHEN ${predicate} THEN ${argsOrOne} END)`;
    out = out.slice(0, j + 1) + replacement + out.slice(filterCloseIdx + 1);
  }
  return { sql: out, flagged };
}

/** Detects date/time arithmetic this script does not attempt to translate — flag for manual review. */
export function flagsDateArithmetic(sql: string): boolean {
  return /\bINTERVAL\b|date_trunc\s*\(|now\(\)|\bCURRENT_DATE\b|\bCURRENT_TIMESTAMP\b/i.test(
    sql,
  );
}

export interface ViewTranslation {
  sql: string;
  flags: string[];
}

/** Compose the individual translations into one best-effort Databricks view body. */
export function translateViewDefinition(definition: string): ViewTranslation {
  const flags: string[] = [];
  // `pg_views.definition` already ends with its own trailing `;` — strip it
  // so the caller's own `${sql};` does not double up.
  let sql = requoteIdentifiers(definition.trim().replace(/;\s*$/, ''));

  const filterResult = translateFilterClauses(sql);
  sql = filterResult.sql;
  if (filterResult.flagged) {
    flags.push('a FILTER (WHERE ...) clause could not be auto-translated — rewrite by hand');
  }

  sql = translateCasts(sql);

  if (/\bILIKE\b/i.test(sql)) {
    flags.push('contains ILIKE — kept as-is, verify Databricks SQL support');
  }
  if (flagsDateArithmetic(sql)) {
    flags.push('contains date/time arithmetic — verify manually, not auto-translated');
  }
  return { sql, flags };
}

// =============================================================================
// CLI
// =============================================================================

interface LoaderArgs {
  host?: string;
  warehouse?: string;
  catalog?: string;
  schemas: FixtureSchema[];
  register: boolean;
  yes: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): LoaderArgs {
  const args: LoaderArgs = {
    schemas: [...ALL_SCHEMAS],
    register: false,
    yes: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--host') args.host = argv[++i];
    else if (arg === '--warehouse') args.warehouse = argv[++i];
    else if (arg === '--catalog') args.catalog = argv[++i];
    else if (arg === '--schemas') {
      args.schemas = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean) as FixtureSchema[];
    } else if (arg === '--register') args.register = true;
    else if (arg === '--yes') args.yes = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else throw new LoaderSetupError(`Unknown argument "${arg}" (try --help)`);
  }
  if (!args.host) throw new LoaderSetupError('--host is required (e.g. https://<workspace>.cloud.databricks.com)');
  if (!args.warehouse) throw new LoaderSetupError('--warehouse is required (SQL warehouse id)');
  if (!args.catalog) throw new LoaderSetupError('--catalog is required');
  const unknown = args.schemas.filter((s) => !(ALL_SCHEMAS as readonly string[]).includes(s));
  if (unknown.length) {
    throw new LoaderSetupError(
      `Unknown schema(s): ${unknown.join(', ')} — must be one of ${ALL_SCHEMAS.join(', ')}`,
    );
  }
  return args;
}

function printUsage(): void {
  console.log(
    [
      'Usage: npx ts-node -T -P tsconfig.json scripts/load-fixtures-databricks.ts \\',
      '         --host https://<workspace>.cloud.databricks.com --warehouse <id> \\',
      '         --catalog <catalog> [--schemas world_cup,health_insurance,genomics] \\',
      '         [--register] [--yes] [--dry-run]',
      '',
      '  --dry-run   print DDL + row counts from the running Postgres fixture,',
      '              never connects to Databricks and never writes a file.',
      '  --yes       required (with no --dry-run) to write docker/databricks/views-*.sql',
      '              and to connect to Databricks and load data. Without it the script',
      '              refuses to write or connect.',
      '  --register  after loading, register a Databricks datasource + one dataset per',
      '              schema in the app\'s own datastore (same code path bootstrap-fixtures.ts',
      '              uses). Without --register, prints the manual registration steps instead.',
      '',
      'Env: DATABRICKS_TOKEN (personal access token — required unless --dry-run),',
      '     WORLD_CUP_DB_PORT (Postgres source, default 55432).',
      '',
      '*** UNTESTED against a live Databricks workspace — run with --dry-run first. ***',
    ].join('\n'),
  );
}

function normalizeHost(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

// --------------------------------------------------------- Postgres reads

interface TableSpec {
  table: string;
  columns: ColumnDef[];
  rowCount: number;
}

async function readSchemaTables(pg: PgClient, schema: string): Promise<TableSpec[]> {
  const tablesRes = await pg.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schema],
  );
  const columnsRes = await pg.query(
    `SELECT table_name, column_name, ordinal_position, is_nullable, data_type,
            udt_name, numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_schema = $1
     ORDER BY table_name, ordinal_position`,
    [schema],
  );
  const columnsByTable = new Map<string, ColumnDef[]>();
  for (const row of columnsRes.rows as Record<string, unknown>[]) {
    const tableName = String(row.table_name);
    const cols = columnsByTable.get(tableName) ?? [];
    cols.push({
      name: String(row.column_name),
      pgType: String(row.data_type),
      databricksType: mapPgTypeToDatabricks({
        dataType: String(row.data_type),
        udtName: row.udt_name == null ? null : String(row.udt_name),
        numericPrecision:
          row.numeric_precision == null ? null : Number(row.numeric_precision),
        numericScale: row.numeric_scale == null ? null : Number(row.numeric_scale),
      }),
      nullable: row.is_nullable === 'YES',
      ordinal: Number(row.ordinal_position),
    });
    columnsByTable.set(tableName, cols);
  }

  const specs: TableSpec[] = [];
  for (const row of tablesRes.rows as { table_name: string }[]) {
    const table = row.table_name;
    const countRes = await pg.query(
      `SELECT count(*) AS n FROM "${schema}"."${table}"`,
    );
    specs.push({
      table,
      columns: columnsByTable.get(table) ?? [],
      rowCount: Number((countRes.rows[0] as { n: string }).n),
    });
  }
  return specs;
}

async function readTableRows(
  pg: PgClient,
  schema: string,
  table: string,
): Promise<Record<string, unknown>[]> {
  const res = await pg.query(`SELECT * FROM "${schema}"."${table}"`);
  return res.rows as Record<string, unknown>[];
}

interface ViewSpec {
  name: string;
  definition: string;
}

async function readViews(pg: PgClient, schema: string): Promise<ViewSpec[]> {
  const res = await pg.query(
    `SELECT viewname, definition FROM pg_views WHERE schemaname = $1 ORDER BY viewname`,
    [schema],
  );
  return (res.rows as { viewname: string; definition: string }[]).map((r) => ({
    name: r.viewname,
    definition: r.definition,
  }));
}

// ------------------------------------------------------- Databricks writes

async function execute(session: IDBSQLSession, sql: string): Promise<void> {
  const op = await session.executeStatement(sql);
  await op.fetchAll();
}

// -------------------------------------------------------------- --register

function printRegistrationSteps(
  host: string,
  warehouse: string,
  catalog: string,
  schemas: string[],
): void {
  console.log('');
  console.log('To register this catalog as a Databricks datasource in the app:');
  console.log('  1. Settings → Data sources → Add → Databricks');
  console.log(`       Workspace URL:  https://${normalizeHost(host)}`);
  console.log(`       SQL warehouse:  ${warehouse}`);
  console.log('       Personal access token:  <your DATABRICKS_TOKEN>');
  console.log('  2. Test connection, then save (e.g. as "Fixtures (Databricks)").');
  for (const schema of schemas) {
    console.log(
      `  3. Datasets → New dataset → select every table under ${catalog}.${schema} → ` +
        `save as "${displayName(schema)} (Databricks)".`,
    );
  }
  console.log('');
  console.log('  (Or re-run this script with --register to do this automatically —');
  console.log('   it uses the same DatasourcesService/DatasetsService the app itself does.)');
}

/**
 * Register a Databricks datasource + one dataset per loaded schema through
 * the app's own services (`DatasourcesService`/`DatasetsService`) — the
 * same code path `bootstrap-fixtures.ts` uses for the Postgres fixtures, so
 * the resulting dataset snapshot (sample values, column profiles, join
 * hints) is byte-identical to what a human would get clicking through the
 * UI. Boots a standalone Nest application context, exactly like
 * `bootstrap-fixtures.ts`. Best-effort: a single schema's registration
 * failure is reported and skipped rather than aborting the others.
 */
async function registerLive(
  host: string,
  token: string,
  warehouse: string,
  catalog: string,
  schemas: string[],
): Promise<void> {
  // See the module-doc comment above the type-only imports: lazy `require()`
  // so importing this file for its pure exports (the spec) never pulls in
  // AppModule's full graph.
  const { AppModule } = require('../src/app.module') as {
    AppModule: typeof AppModuleType;
  };
  const { DatasourcesService } = require('../src/modules/datasources/datasources.service') as {
    DatasourcesService: typeof DatasourcesServiceType;
  };
  const { DatasetsService } = require('../src/modules/datasets/datasets.service') as {
    DatasetsService: typeof DatasetsServiceType;
  };
  const { DatasetsRepository } = require('../src/modules/datasets/repositories/datasets.repository') as {
    DatasetsRepository: typeof DatasetsRepositoryType;
  };

  const logger: LogLevel[] = ['warn', 'error'];
  const app: INestApplicationContext = await NestFactory.createApplicationContext(
    AppModule,
    { logger },
  );
  try {
    const datasources = app.get(DatasourcesService);
    const datasets = app.get(DatasetsService);
    const datasetsRepo = app.get(DatasetsRepository);

    const config = { host: normalizeHost(host), token, warehouseId: warehouse };
    const existingDatasource = (await datasources.list()).find(
      (d) => d.name === DATABRICKS_DATASOURCE_NAME,
    );
    const datasourceId = existingDatasource
      ? existingDatasource.id
      : (
          await datasources.save({
            name: DATABRICKS_DATASOURCE_NAME,
            kind: 'databricks',
            config,
          })
        ).id;

    const catalogs = await datasources.connector('databricks').inventory(config);

    for (const schema of schemas) {
      try {
        const catalogEntry = catalogs.find((c) => c.name === catalog);
        const schemaEntry = catalogEntry?.schemas.find((s) => s.name === schema);
        if (!schemaEntry || !schemaEntry.tables.length) {
          console.warn(
            `  ! ${catalog}.${schema}: not visible in the Databricks inventory — skipping dataset registration`,
          );
          continue;
        }
        const name = `${displayName(schema)} (Databricks)`;
        const tables = schemaEntry.tables.map((t) => `${catalog}.${schema}.${t.name}`);
        const entities = schemaEntry.tables.map((t) => ({
          key: `${catalog}.${schema}.${t.name}`,
          columns: t.columns.map((c) => ({
            name: c.name,
            type: c.type,
            nullable: c.nullable,
          })),
        }));
        const [existingDataset] = await datasetsRepo.getByNames([name]);
        await datasets.save({ name, tables, entities, datasourceId });
        console.log(
          `  ${existingDataset ? 'Refreshed' : 'Created'} dataset "${name}" (${tables.length} tables).`,
        );
      } catch (err) {
        console.warn(`  ! ${catalog}.${schema}: registration failed — ${message(err)}`);
      }
    }
  } finally {
    await app.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- helpers

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ------------------------------------------------------------------ main

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  console.log('');
  console.log('*** UNTESTED against a live Databricks workspace — run with --dry-run first. ***');
  console.log('');

  const pg = new PgClient({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  });
  try {
    await pg.connect();
  } catch (err) {
    throw new LoaderSetupError(
      `Postgres at ${DB_HOST}:${DB_PORT}/${DB_NAME} is not reachable — ${message(err)}. ` +
        'Run `docker compose up -d` from the repo root and retry.',
    );
  }

  try {
    const catalog = args.catalog as string;
    const schemaSpecs: { schema: string; tables: TableSpec[]; views: ViewSpec[] }[] = [];
    for (const schema of args.schemas) {
      const tables = await readSchemaTables(pg, schema);
      const views = await readViews(pg, schema);
      schemaSpecs.push({ schema, tables, views });
    }

    // Always printed — this is the --dry-run acceptance surface, and useful
    // as a preview even when about to actually load.
    for (const { schema, tables } of schemaSpecs) {
      console.log(emitCreateSchemaDdl(catalog, schema));
      for (const table of tables) {
        console.log(emitCreateTableDdl(quoteFqTable(catalog, schema, table.table), table.columns));
        console.log(`-- ${table.rowCount} row(s)`);
      }
      console.log('');
    }

    const viewFiles = new Map<string, string>();
    for (const { schema, views } of schemaSpecs) {
      if (!views.length) continue;
      const lines: string[] = [
        `-- Best-effort Databricks translation of ${schema}'s views (Postgres source: docker/postgres/init).`,
        '-- GENERATED by scripts/load-fixtures-databricks.ts — review before applying.',
        '-- Never auto-applied: this script only writes this file, it does not run these statements.',
        '',
      ];
      for (const view of views) {
        const { sql, flags } = translateViewDefinition(view.definition);
        for (const flag of flags) lines.push(`-- FLAG: ${flag}`);
        lines.push(`CREATE OR REPLACE VIEW ${quoteFqTable(catalog, schema, view.name)} AS`);
        lines.push(`${sql};`);
        lines.push('');
      }
      viewFiles.set(schema, lines.join('\n'));
      console.log(
        `-- ${schema}: ${views.length} view(s) translated (preview) — ` +
          `see docker/databricks/views-${schema}.sql`,
      );
    }

    if (args.dryRun) {
      console.log('');
      console.log('[dry-run] No connection made to Databricks. No files written.');
      return 0;
    }

    if (!args.yes) {
      console.error(
        '\nRefusing to write docker/databricks/views-*.sql or connect to Databricks ' +
          'without --yes (pass --dry-run to preview only).\n',
      );
      return 1;
    }

    fs.mkdirSync(VIEWS_DIR, { recursive: true });
    for (const [schema, content] of viewFiles) {
      const file = path.join(VIEWS_DIR, `views-${schema}.sql`);
      fs.writeFileSync(file, content, 'utf8');
      console.log(`Wrote ${file}`);
    }

    const token = (process.env.DATABRICKS_TOKEN ?? '').trim();
    if (!token) {
      throw new LoaderSetupError('DATABRICKS_TOKEN env var is required (not running --dry-run)');
    }
    const host = normalizeHost(args.host as string);

    console.log('');
    console.log(`Connecting to Databricks: ${host}, warehouse ${args.warehouse}...`);
    const client = new DBSQLClient();
    await client.connect({
      host,
      path: `/sql/1.0/warehouses/${args.warehouse}`,
      authType: 'access-token',
      token,
    });
    try {
      const session = await client.openSession();
      try {
        for (const { schema, tables } of schemaSpecs) {
          await execute(session, emitCreateSchemaDdl(catalog, schema));
          for (const table of tables) {
            const fq = quoteFqTable(catalog, schema, table.table);
            await execute(session, emitCreateTableDdl(fq, table.columns));
            const rows = await readTableRows(pg, schema, table.table);
            const batches = emitInsertBatches(fq, table.columns, rows);
            for (const batch of batches) await execute(session, batch);
            console.log(
              `  Loaded ${schema}.${table.table}: ${rows.length} row(s) in ${batches.length} batch(es).`,
            );
          }
        }
      } finally {
        await session.close();
      }
    } finally {
      await client.close();
    }

    if (args.register) {
      console.log('');
      console.log('Registering Databricks datasource + datasets...');
      await registerLive(host, token, args.warehouse as string, catalog, args.schemas);
    } else {
      printRegistrationSteps(args.host as string, args.warehouse as string, catalog, args.schemas);
    }

    return 0;
  } finally {
    await pg.end().catch(() => undefined);
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      if (error instanceof LoaderSetupError) {
        console.error(`\n✖ ${error.message}\n`);
      } else {
        console.error('\n✖ Databricks fixture load crashed:');
        console.error(error);
      }
      process.exit(1);
    });
}
