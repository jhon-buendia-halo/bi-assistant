/**
 * Loading a sample fixture's JSON dump into a Databricks Unity Catalog schema
 * (BA-9 Step 2, BA-186; ADR-0015). The pure core of
 * `backend/scripts/setup-fixture-databricks.ts`: it reads the dump, decides
 * each column's Databricks type, writes the SQL, runs it through any
 * `SqlRunner` and checks the row counts. The script supplies the real
 * `@databricks/sql` session; the unit tests supply a fake one.
 *
 * What is loaded: every relation of the dump, the views included, as a Delta
 * table with `CREATE OR REPLACE TABLE`, so a second run replaces the rows
 * instead of adding to them. Views are loaded as tables, not recreated from
 * their PostgreSQL definition: the dump already holds their rows, the rows are
 * then identical to the PostgreSQL sample by construction, and no view SQL has
 * to be translated to Databricks SQL.
 *
 * Column types come, in this order, from the sample's seed SQL (`CREATE TABLE`
 * declares the precise type, `numeric(5,2)` rather than `numeric`), from the
 * dump's `_meta.json` (the views of the generated domains), or from the values
 * themselves (the World Cup dump has no column list; only its two views get
 * here). Any column type the loader cannot map stops it before it connects.
 *
 * No Nest, no driver, no network: safe to import from a script or a test.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  databricksSource,
  findFixture,
  SAMPLE_FIXTURES,
  type SampleFixture,
} from '../fixtures/registry';

/** A column as the dump's `_meta.json` lists it (PostgreSQL `data_type`). */
export interface DumpColumn {
  name: string;
  type: string;
  nullable: boolean;
}

/** One table or view of a dump, with its rows. */
export interface DumpRelation {
  name: string;
  rows: Record<string, unknown>[];
  /** Columns from `_meta.json`, when the dump records them. */
  columns?: DumpColumn[];
}

/** A fixture's dump as read from disk. */
export interface FixtureDump {
  directory: string;
  dumpedAt?: string;
  relations: DumpRelation[];
}

/** A column as the loader creates it. */
export interface LoadColumn {
  name: string;
  /** The PostgreSQL type it comes from (seed, dump or inferred). */
  sourceType: string;
  /** Where `sourceType` was read. */
  typeFrom: 'seed' | 'dump' | 'values';
  /** The Databricks SQL type it is created with. */
  type: string;
  nullable: boolean;
}

/** Where the loader writes. */
export interface LoadTarget {
  catalog: string;
  schema: string;
}

/** Statement size limits for the INSERTs. */
export interface BatchLimits {
  /** Rows per INSERT at most. */
  rows: number;
  /** Characters per INSERT at most (a single row longer than this still goes alone). */
  chars: number;
}

/**
 * 500 rows or 256 KiB per INSERT: the largest relation (finance transactions,
 * 5,400 rows) takes 11 statements, and no statement comes near the size where
 * a warehouse parses slowly.
 */
export const DEFAULT_BATCH_LIMITS: BatchLimits = { rows: 500, chars: 262_144 };

/** One relation's statements. */
export interface RelationPlan {
  name: string;
  /** Backticked three-part name. */
  qualifiedName: string;
  columns: LoadColumn[];
  rowCount: number;
  create: string;
  inserts: string[];
}

/** Everything the loader will run, in order. */
export interface LoadPlan {
  fixture: SampleFixture;
  source: SampleFixture;
  target: LoadTarget;
  dumpDirectory: string;
  dumpedAt?: string;
  createSchema: string;
  relations: RelationPlan[];
  /** One query returning `relation` and `row_count` for every relation. */
  verify: string;
}

/** Runs one Databricks SQL statement and returns its rows. */
export interface SqlRunner {
  run(sql: string): Promise<Record<string, unknown>[]>;
}

/** Any problem with the dump, the types or the load. Its message is the report. */
export class FixtureLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixtureLoadError';
  }
}

// ------------------------------------------------------------- the fixtures

/**
 * The Databricks sample and the PostgreSQL sample it is loaded from, given
 * either id: `world-cup` or `world-cup-databricks`.
 */
export function resolveDatabricksFixture(id: string): {
  fixture: SampleFixture;
  source: SampleFixture;
} {
  const wanted = id.trim();
  const named = findFixture(wanted);
  const fixture =
    named?.datasourceKind === 'databricks'
      ? named
      : findFixture(`${wanted}-databricks`);
  const source = fixture ? databricksSource(fixture) : undefined;
  if (!fixture || !source) {
    throw new FixtureLoadError(
      `No Databricks sample for "${wanted}". Known: ${databricksFixtureSources().join(', ')}.`,
    );
  }
  return { fixture, source };
}

/** The ids `--fixture` takes: the source sample of every Databricks sample. */
export function databricksFixtureSources(): string[] {
  return SAMPLE_FIXTURES.filter(
    (fixture) => fixture.datasourceKind === 'databricks',
  )
    .map((fixture) => databricksSource(fixture)?.id)
    .filter((id): id is string => Boolean(id));
}

/**
 * Where a sample's dump may live, in the order the loader looks: the domain
 * dumps of `npm run fixture:dump` (`scripts/fixtures/<id>/data`), then, for
 * World Cup, the dump the local REST API serves.
 */
export function dumpDirectoryCandidates(
  backendRoot: string,
  sourceId: string,
): string[] {
  const candidates = [
    join(backendRoot, 'scripts', 'fixtures', sourceId, 'data'),
  ];
  if (sourceId === 'world-cup') {
    candidates.push(join(backendRoot, 'scripts', 'worldcup-rest-api', 'data'));
  }
  return candidates;
}

/** The first candidate holding a `_meta.json`. */
export function findDumpDirectory(
  backendRoot: string,
  sourceId: string,
): string {
  const candidates = dumpDirectoryCandidates(backendRoot, sourceId);
  const found = candidates.find((dir) => existsSync(join(dir, '_meta.json')));
  if (!found) {
    throw new FixtureLoadError(
      `No dump for "${sourceId}": none of ${candidates.join(', ')} has a _meta.json. ` +
        `Write one with: npm run fixture:dump -- --fixture ${sourceId}`,
    );
  }
  return found;
}

// --------------------------------------------------------------- the dump

interface DumpMeta {
  dumpedAt?: string;
  tables?: Record<string, number>;
  columns?: Record<string, DumpColumn[]>;
}

/**
 * Read a dump: `_meta.json` lists the relations in load order with their row
 * counts; each relation is `<name>.json.gz` (the domain dumps) or
 * `<name>.json` (the World Cup REST dump). A file whose row count differs
 * from `_meta.json` stops the load before anything is written.
 */
export function readFixtureDump(directory: string): FixtureDump {
  const metaPath = join(directory, '_meta.json');
  if (!existsSync(metaPath)) {
    throw new FixtureLoadError(`${metaPath} does not exist`);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as DumpMeta;
  const tables = meta.tables ?? {};
  const names = Object.keys(tables);
  if (names.length === 0) {
    throw new FixtureLoadError(`${metaPath} lists no tables`);
  }
  const relations = names.map((name): DumpRelation => {
    const gz = join(directory, `${name}.json.gz`);
    const plain = join(directory, `${name}.json`);
    let text: string;
    if (existsSync(gz)) text = gunzipSync(readFileSync(gz)).toString('utf8');
    else if (existsSync(plain)) text = readFileSync(plain, 'utf8');
    else {
      throw new FixtureLoadError(
        `${directory} has no ${name}.json.gz or ${name}.json, which _meta.json lists`,
      );
    }
    const rows = JSON.parse(text) as unknown;
    if (!Array.isArray(rows)) {
      throw new FixtureLoadError(`${name} in ${directory} is not a JSON array`);
    }
    if (rows.length !== tables[name]) {
      throw new FixtureLoadError(
        `${name} in ${directory} holds ${rows.length} rows; _meta.json says ${tables[name]}`,
      );
    }
    return {
      name,
      rows: rows as Record<string, unknown>[],
      ...(meta.columns?.[name] ? { columns: meta.columns[name] } : {}),
    };
  });
  return { directory, dumpedAt: meta.dumpedAt, relations };
}

// ---------------------------------------------------------- the seed's DDL

/** The keywords that end a column's type in a column definition. */
const COLUMN_CONSTRAINT =
  /^(?:NOT|NULL|DEFAULT|PRIMARY|REFERENCES|CHECK|UNIQUE|GENERATED|CONSTRAINT|COLLATE)$/i;
/** The words that open a table constraint instead of a column. */
const TABLE_CONSTRAINT =
  /^(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|EXCLUDE|LIKE)\b/i;

/** Split on commas outside parentheses and quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = undefined;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The body between the parenthesis at `open` and its match. */
function parenthesised(sql: string, open: number): string | undefined {
  let depth = 0;
  let quote: string | undefined;
  for (let i = open; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) quote = undefined;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return sql.slice(open + 1, i);
    }
  }
  return undefined;
}

function unquote(name: string): string {
  return name.replace(/^"(.*)"$/, '$1');
}

/**
 * The columns each `CREATE TABLE` of a seed declares, in order, with the
 * declared PostgreSQL type and whether it may be NULL. A column is NOT NULL
 * when it says so or is (part of) the primary key. Views are not read.
 */
export function seedTableColumns(sql: string): Map<string, DumpColumn[]> {
  const tables = new Map<string, DumpColumn[]>();
  const withoutComments = sql.replace(/--[^\n]*/g, '');
  const header =
    /CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?\w+"?\.)?("?\w+"?)\s*\(/gi;
  for (const match of withoutComments.matchAll(header)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const body = parenthesised(withoutComments, open);
    if (body === undefined) continue;
    const columns: DumpColumn[] = [];
    const keyColumns = new Set<string>();
    for (const element of splitTopLevel(body)) {
      if (TABLE_CONSTRAINT.test(element)) {
        const key = /^PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(element);
        if (key) {
          for (const name of key[1].split(',')) {
            keyColumns.add(unquote(name.trim()));
          }
        }
        continue;
      }
      const words = element.split(/\s+/);
      const name = unquote(words[0]);
      const typeWords: string[] = [];
      for (const word of words.slice(1)) {
        if (COLUMN_CONSTRAINT.test(word)) break;
        typeWords.push(word);
      }
      columns.push({
        name,
        type: typeWords.join(' ').toLowerCase(),
        nullable: !/\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b/i.test(element),
      });
    }
    for (const column of columns) {
      if (keyColumns.has(column.name)) column.nullable = false;
    }
    tables.set(unquote(match[1]).toLowerCase(), columns);
  }
  return tables;
}

/** The seed SQL of a sample, from the registry's folder. */
export function readSeedSql(
  fixturesDir: string,
  source: SampleFixture,
): string {
  if (!source.seedFile) return '';
  const raw = readFileSync(join(fixturesDir, source.seedFile));
  return source.seedFile.endsWith('.gz')
    ? gunzipSync(raw).toString('utf8')
    : raw.toString('utf8');
}

// ---------------------------------------------------------------- the types

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * A PostgreSQL type for a column the dump does not describe, read from its
 * values: whole numbers `bigint`, other numbers `double precision`, ISO dates
 * `date`, ISO timestamps with a zone `timestamp with time zone`, booleans
 * `boolean`, anything else (or only NULLs) `text`. Mixed kinds stop the load.
 */
export function inferSourceType(values: readonly unknown[]): string {
  const present = values.filter(
    (value) => value !== null && value !== undefined,
  );
  if (present.length === 0) return 'text';
  const kinds = new Set(present.map((value) => typeof value));
  if (kinds.size > 1) {
    throw new FixtureLoadError(
      `values of mixed kinds (${Array.from(kinds).join(', ')}) cannot be given one type`,
    );
  }
  const [kind] = kinds;
  if (kind === 'boolean') return 'boolean';
  if (kind === 'number') {
    return present.every((value) => Number.isSafeInteger(value))
      ? 'bigint'
      : 'double precision';
  }
  if (kind === 'string') {
    const strings = present as string[];
    if (strings.every((value) => ISO_DATE.test(value))) return 'date';
    if (strings.every((value) => ISO_TIMESTAMP.test(value))) {
      return 'timestamp with time zone';
    }
    return 'text';
  }
  if (kind === 'object') return 'jsonb';
  throw new FixtureLoadError(`values of kind ${kind} have no type`);
}

/** The most digits after the decimal point among `values`. */
function observedScale(values: readonly unknown[]): number {
  let scale = 0;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const [, fraction = ''] = String(value).split('e')[0].split('.');
    scale = Math.max(scale, fraction.length);
  }
  return scale;
}

/**
 * The Databricks SQL type for a PostgreSQL type. `numeric(p,s)` keeps its
 * precision and scale; a bare `numeric` (a view column) becomes
 * `DECIMAL(38,s)` with `s` the most decimals in its values. A type with no
 * mapping throws, so the load stops before it connects.
 */
export function databricksType(
  sourceType: string,
  values: readonly unknown[] = [],
): string {
  const type = sourceType.trim().toLowerCase().replace(/\s+/g, ' ');
  const decimal =
    /^(?:numeric|decimal)\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/.exec(type);
  if (decimal) {
    const precision = Number(decimal[1]);
    const scale = Number(decimal[2] ?? 0);
    if (precision < 1 || precision > 38 || scale > precision) {
      throw new FixtureLoadError(
        `${sourceType} does not fit a Databricks DECIMAL (precision 1 to 38)`,
      );
    }
    return `DECIMAL(${precision},${scale})`;
  }
  if (type === 'numeric' || type === 'decimal') {
    return `DECIMAL(38,${Math.min(observedScale(values), 18)})`;
  }
  if (
    /^(?:character varying|varchar|character|char|bpchar)(?:\s*\(\d+\))?$/.test(
      type,
    )
  ) {
    return 'STRING';
  }
  switch (type) {
    case 'smallint':
    case 'int2':
      return 'SMALLINT';
    case 'integer':
    case 'int':
    case 'int4':
      return 'INT';
    case 'bigint':
    case 'int8':
      return 'BIGINT';
    case 'real':
    case 'float4':
      return 'FLOAT';
    case 'double precision':
    case 'float8':
      return 'DOUBLE';
    case 'text':
    case 'uuid':
    case 'citext':
    case 'name':
    case 'json':
    case 'jsonb':
      return 'STRING';
    case 'boolean':
    case 'bool':
      return 'BOOLEAN';
    case 'date':
      return 'DATE';
    case 'timestamp with time zone':
    case 'timestamptz':
      return 'TIMESTAMP';
    case 'timestamp':
    case 'timestamp without time zone':
      return 'TIMESTAMP_NTZ';
    default:
      throw new FixtureLoadError(
        `no Databricks type for the PostgreSQL type "${sourceType}"`,
      );
  }
}

/**
 * The columns a relation is created with: from the seed's `CREATE TABLE`,
 * else from the dump's `_meta.json`, else inferred from the rows. When the
 * seed and the dump both list the columns they must agree on the names and
 * their order. Every row must carry exactly those columns.
 */
export function resolveColumns(
  relation: DumpRelation,
  seedColumns: DumpColumn[] | undefined,
): LoadColumn[] {
  const where = `relation ${relation.name}`;
  let declared: DumpColumn[];
  let typeFrom: LoadColumn['typeFrom'];
  if (seedColumns) {
    declared = seedColumns;
    typeFrom = 'seed';
    if (relation.columns) {
      const fromDump = relation.columns.map((column) => column.name).join(', ');
      const fromSeed = seedColumns.map((column) => column.name).join(', ');
      if (fromDump !== fromSeed) {
        throw new FixtureLoadError(
          `${where}: the dump lists the columns ${fromDump}, the seed ${fromSeed}`,
        );
      }
    }
  } else if (relation.columns) {
    declared = relation.columns;
    typeFrom = 'dump';
  } else {
    const names = Object.keys(relation.rows[0] ?? {});
    if (names.length === 0) {
      throw new FixtureLoadError(
        `${where}: the dump records no columns and holds no rows to read them from`,
      );
    }
    declared = names.map((name) => {
      try {
        return {
          name,
          type: inferSourceType(relation.rows.map((row) => row[name])),
          nullable: true,
        };
      } catch (err) {
        throw new FixtureLoadError(
          `${where}, column ${name}: ${(err as Error).message}`,
        );
      }
    });
    typeFrom = 'values';
  }

  const expected = declared.map((column) => column.name);
  relation.rows.forEach((row, index) => {
    const keys = Object.keys(row);
    if (
      keys.length !== expected.length ||
      !expected.every((name) => Object.prototype.hasOwnProperty.call(row, name))
    ) {
      throw new FixtureLoadError(
        `${where}, row ${index + 1}: has the columns ${keys.join(', ')}; expected ${expected.join(', ')}`,
      );
    }
  });

  return declared.map((column) => {
    const values = relation.rows.map((row) => row[column.name]);
    let type: string;
    try {
      type = databricksType(column.type, values);
    } catch (err) {
      throw new FixtureLoadError(
        `${where}, column ${column.name}: ${(err as Error).message}`,
      );
    }
    return {
      name: column.name,
      sourceType: column.type,
      typeFrom,
      type,
      nullable: column.nullable,
    };
  });
}

// ------------------------------------------------------------- the literals

/** A Unity Catalog identifier in backticks, a backtick doubled. */
export function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

/** `catalog`.`schema`.`table`, each part backticked. */
export function qualifiedName(target: LoadTarget, relation: string): string {
  return [target.catalog, target.schema, relation].map(quoteIdent).join('.');
}

/**
 * A Databricks SQL string literal. Databricks reads a backslash as an escape
 * and two adjacent literals as one (`'It''s'` is `Its`), so a quote is
 * escaped as `\'`, never doubled; a backslash as `\\`; control characters as
 * `\n`, `\r`, `\t` or `\uXXXX`.
 */
export function stringLiteral(value: string): string {
  // Control characters are matched on purpose: they are what gets escaped.
  // eslint-disable-next-line no-control-regex
  const escaped = value.replace(/[\\'\u0000-\u001f\u007f]/g, (ch) => {
    switch (ch) {
      case '\\':
        return '\\\\';
      case "'":
        return "\\'";
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      default:
        return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
    }
  });
  return `'${escaped}'`;
}

const INTEGER_RANGES: Record<string, [number, number]> = {
  SMALLINT: [-32_768, 32_767],
  INT: [-2_147_483_648, 2_147_483_647],
  BIGINT: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
};

/** A JSON number as a DECIMAL(p,s) literal, refusing one that would lose digits. */
function decimalLiteral(value: number, type: string): string {
  const [, p, s] = /^DECIMAL\((\d+),(\d+)\)$/.exec(type) ?? [];
  const precision = Number(p);
  const scale = Number(s);
  if (Math.abs(value) >= 1e21) throw new Error(`${value} is too large`);
  const text = value.toFixed(scale);
  if (Number(text) !== value) {
    throw new Error(`${value} has more than ${scale} decimals`);
  }
  const digits = text.replace(/^-/, '').split('.')[0].replace(/^0+/, '');
  if (digits.length > precision - scale) {
    throw new Error(
      `${value} has more than ${precision - scale} integer digits`,
    );
  }
  return text;
}

/**
 * One value as a literal of its column's type: NULL; TRUE or FALSE; a whole
 * number checked against the integer type's range; a decimal with exactly the
 * column's scale; a plain number for DOUBLE and FLOAT; `DATE'…'`;
 * `TIMESTAMP'…Z'` for an instant, `TIMESTAMP_NTZ'…'` for a wall-clock time;
 * an escaped string otherwise (JSON values as their JSON text). A value that
 * does not fit throws, naming the column.
 */
export function sqlLiteral(value: unknown, column: LoadColumn): string {
  const fail = (why: string): never => {
    throw new FixtureLoadError(
      `column ${column.name} (${column.type}): ${why}`,
    );
  };
  if (value === null || value === undefined) {
    if (!column.nullable) fail('NULL in a NOT NULL column');
    return 'NULL';
  }
  const type = column.type;
  if (type === 'BOOLEAN') {
    if (typeof value !== 'boolean')
      fail(`${JSON.stringify(value)} is not a boolean`);
    return value ? 'TRUE' : 'FALSE';
  }
  if (type in INTEGER_RANGES) {
    const [min, max] = INTEGER_RANGES[type];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      fail(`${JSON.stringify(value)} is not a whole number`);
    }
    const n = value as number;
    if (n < min || n > max) fail(`${n} is out of range`);
    return String(n);
  }
  if (type.startsWith('DECIMAL(')) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(`${JSON.stringify(value)} is not a number`);
    }
    try {
      return decimalLiteral(value as number, type);
    } catch (err) {
      return fail((err as Error).message);
    }
  }
  if (type === 'DOUBLE' || type === 'FLOAT') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fail(`${JSON.stringify(value)} is not a finite number`);
    }
    return String(value);
  }
  if (type === 'DATE') {
    if (typeof value !== 'string' || !ISO_DATE.test(value)) {
      fail(`${JSON.stringify(value)} is not a YYYY-MM-DD date`);
    }
    return `DATE'${value as string}'`;
  }
  if (type === 'TIMESTAMP' || type === 'TIMESTAMP_NTZ') {
    const time = typeof value === 'string' ? Date.parse(value) : NaN;
    if (Number.isNaN(time)) fail(`${JSON.stringify(value)} is not a timestamp`);
    const iso = new Date(time).toISOString();
    return type === 'TIMESTAMP'
      ? `TIMESTAMP'${iso}'`
      : `TIMESTAMP_NTZ'${iso.replace('T', ' ').replace(/Z$/, '')}'`;
  }
  if (type === 'STRING') {
    if (typeof value === 'string') return stringLiteral(value);
    if (typeof value === 'number' || typeof value === 'boolean') {
      return stringLiteral(String(value));
    }
    return stringLiteral(JSON.stringify(value));
  }
  return fail('no literal for this type');
}

// ------------------------------------------------------------ the statements

/** `CREATE OR REPLACE TABLE` with every column, NOT NULL where the source has it. */
export function createTableSql(
  qualified: string,
  columns: readonly LoadColumn[],
): string {
  const lines = columns.map(
    (column) =>
      `  ${quoteIdent(column.name)} ${column.type}${column.nullable ? '' : ' NOT NULL'}`,
  );
  return `CREATE OR REPLACE TABLE ${qualified} (\n${lines.join(',\n')}\n)`;
}

/**
 * The INSERTs for `rows`, one row per line, each statement within `limits`.
 * No statement for no rows.
 */
export function insertStatements(
  qualified: string,
  columns: readonly LoadColumn[],
  rows: readonly Record<string, unknown>[],
  limits: BatchLimits = DEFAULT_BATCH_LIMITS,
): string[] {
  if (limits.rows < 1 || limits.chars < 1) {
    throw new FixtureLoadError('batch limits must be positive');
  }
  const head = `INSERT INTO ${qualified} (${columns
    .map((column) => quoteIdent(column.name))
    .join(', ')}) VALUES\n`;
  const statements: string[] = [];
  let batch: string[] = [];
  let size = head.length;
  const flush = () => {
    if (batch.length) statements.push(head + batch.join(',\n'));
    batch = [];
    size = head.length;
  };
  rows.forEach((row, index) => {
    let line: string;
    try {
      line = `  (${columns.map((column) => sqlLiteral(row[column.name], column)).join(', ')})`;
    } catch (err) {
      throw new FixtureLoadError(`row ${index + 1}, ${(err as Error).message}`);
    }
    // Rows are joined by ",\n": two characters before every row but the first.
    if (
      batch.length &&
      (batch.length >= limits.rows || size + 2 + line.length > limits.chars)
    ) {
      flush();
    }
    size += (batch.length ? 2 : 0) + line.length;
    batch.push(line);
  });
  flush();
  return statements;
}

/** Every relation's row count in one statement: `relation`, `row_count`. */
export function rowCountSql(
  target: LoadTarget,
  relations: readonly string[],
): string {
  return relations
    .map(
      (name) =>
        `SELECT ${stringLiteral(name)} AS relation, COUNT(*) AS row_count FROM ${qualifiedName(target, name)}`,
    )
    .join('\nUNION ALL\n');
}

/**
 * Everything the loader will run for a dump: the schema, then per relation
 * its table and its INSERTs, then one row-count query. Built in full before
 * anything connects, so a dump, type or value problem never leaves a
 * half-loaded schema behind.
 */
export function buildLoadPlan(input: {
  fixture: SampleFixture;
  source: SampleFixture;
  dump: FixtureDump;
  seedSql: string;
  target: LoadTarget;
  limits?: BatchLimits;
}): LoadPlan {
  const { fixture, source, dump, target } = input;
  if (!target.catalog.trim() || !target.schema.trim()) {
    throw new FixtureLoadError('the catalog and the schema must not be empty');
  }
  const seed = seedTableColumns(input.seedSql);
  const relations = dump.relations.map((relation): RelationPlan => {
    const columns = resolveColumns(
      relation,
      seed.get(relation.name.toLowerCase()),
    );
    const qualified = qualifiedName(target, relation.name);
    let inserts: string[];
    try {
      inserts = insertStatements(
        qualified,
        columns,
        relation.rows,
        input.limits,
      );
    } catch (err) {
      throw new FixtureLoadError(
        `relation ${relation.name}, ${(err as Error).message}`,
      );
    }
    return {
      name: relation.name,
      qualifiedName: qualified,
      columns,
      rowCount: relation.rows.length,
      create: createTableSql(qualified, columns),
      inserts,
    };
  });
  const missing = fixture.requiredTables.filter(
    (table) => !relations.some((relation) => relation.name === table),
  );
  if (missing.length) {
    throw new FixtureLoadError(
      `the dump in ${dump.directory} lacks ${missing.join(', ')}, which the ${fixture.name} sample requires`,
    );
  }
  return {
    fixture,
    source,
    target,
    dumpDirectory: dump.directory,
    dumpedAt: dump.dumpedAt,
    createSchema: `CREATE SCHEMA IF NOT EXISTS ${[target.catalog, target.schema]
      .map(quoteIdent)
      .join('.')}`,
    relations,
    verify: rowCountSql(
      target,
      relations.map((relation) => relation.name),
    ),
  };
}

/** Every statement of a plan, in the order the loader runs them. */
export function planStatements(plan: LoadPlan): string[] {
  return [
    plan.createSchema,
    ...plan.relations.flatMap((relation) => [
      relation.create,
      ...relation.inserts,
    ]),
    plan.verify,
  ];
}

/**
 * The plan as SQL text, for `--dry-run`. With `full: false` each INSERT shows
 * its first `shownRows` rows and says how many it leaves out; the statements,
 * their order and their count are the real ones.
 */
export function formatPlan(
  plan: LoadPlan,
  options: { full?: boolean; shownRows?: number } = {},
): string {
  const shown = options.shownRows ?? 2;
  const statements = planStatements(plan);
  const totalRows = plan.relations.reduce((sum, r) => sum + r.rowCount, 0);
  const header = [
    `-- Databricks load plan for the ${plan.fixture.name} sample (${plan.fixture.id})`,
    `-- dump: ${plan.dumpDirectory}${plan.dumpedAt ? ` (dumped ${plan.dumpedAt})` : ''}`,
    `-- target: ${plan.target.catalog}.${plan.target.schema}`,
    `-- ${plan.relations.length} relations, ${totalRows} rows, ${statements.length} statements` +
      (options.full
        ? ''
        : `; INSERTs abbreviated to ${shown} rows (--full prints them whole)`),
    '-- column types (Databricks <- PostgreSQL, from seed | dump | values):',
    ...plan.relations.map(
      (relation) =>
        `--   ${relation.name} (${relation.rowCount} rows): ` +
        relation.columns
          .map((c) => `${c.name} ${c.type} <- ${c.sourceType} (${c.typeFrom})`)
          .join('; '),
    ),
    '',
  ];
  const body = statements.map((statement) => {
    if (options.full || !statement.startsWith('INSERT INTO '))
      return `${statement};`;
    const lines = statement.split('\n');
    const rows = lines.slice(1);
    if (rows.length <= shown) return `${statement};`;
    // Each row line but the last ends with the comma that joins it to the next.
    const kept = rows.slice(0, shown).join('\n').replace(/,$/, '');
    return (
      `${lines[0]}\n${kept}\n` +
      `  -- … ${rows.length - shown} more rows in this statement (${statement.length} characters in all);`
    );
  });
  return `${header.join('\n')}\n${body.join('\n\n')}\n`;
}

// --------------------------------------------------------------- the load

/** What a load did. */
export interface LoadReport {
  statements: number;
  relations: { name: string; rows: number }[];
}

/** A count as the driver returns it: number, bigint or numeric text. */
function asCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim()))
    return Number(value);
  return NaN;
}

/**
 * The relations whose count on the warehouse differs from the dump, as
 * `<name>: expected <n>, found <m>` (or `missing`). Empty when all agree.
 */
export function rowCountProblems(
  plan: LoadPlan,
  counted: readonly Record<string, unknown>[],
): string[] {
  const found = new Map<string, number>();
  for (const row of counted) {
    found.set(String(row['relation']), asCount(row['row_count']));
  }
  const problems: string[] = [];
  for (const relation of plan.relations) {
    const count = found.get(relation.name);
    if (count === undefined)
      problems.push(`${relation.name}: missing from the count`);
    else if (count !== relation.rowCount) {
      problems.push(
        `${relation.name}: expected ${relation.rowCount} rows, found ${count}`,
      );
    }
  }
  return problems;
}

/**
 * Run a plan statement by statement, then check every relation's row count
 * against the dump. Throws `FixtureLoadError` naming the statement that
 * failed, or every relation whose count is off.
 */
export async function runLoadPlan(
  plan: LoadPlan,
  runner: SqlRunner,
  log: (line: string) => void = () => undefined,
): Promise<LoadReport> {
  let statements = 0;
  const run = async (sql: string, what: string) => {
    try {
      statements++;
      return await runner.run(sql);
    } catch (err) {
      throw new FixtureLoadError(
        `${what} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  await run(
    plan.createSchema,
    `creating schema ${plan.target.catalog}.${plan.target.schema}`,
  );
  log(`✔ schema ${plan.target.catalog}.${plan.target.schema}`);
  for (const relation of plan.relations) {
    await run(relation.create, `creating ${relation.qualifiedName}`);
    for (const [index, insert] of relation.inserts.entries()) {
      await run(
        insert,
        `inserting batch ${index + 1} of ${relation.inserts.length} into ${relation.qualifiedName}`,
      );
    }
    log(
      `✔ ${relation.name}: ${relation.rowCount} rows in ${relation.inserts.length} INSERT${relation.inserts.length === 1 ? '' : 's'}`,
    );
  }
  const counted = await run(plan.verify, 'counting the rows');
  const problems = rowCountProblems(plan, counted);
  if (problems.length) {
    throw new FixtureLoadError(
      `the row counts on Databricks differ from the dump:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
  log(`✔ row counts match the dump for all ${plan.relations.length} relations`);
  return {
    statements,
    relations: plan.relations.map((relation) => ({
      name: relation.name,
      rows: relation.rowCount,
    })),
  };
}
