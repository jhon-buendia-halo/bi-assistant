/**
 * Export a loaded sample fixture to gzipped JSON: one file per table and view.
 *
 *   npm run fixture:dump -- --fixture finance
 *   npm run fixture:dump -- --fixture finance --database ba9_finance
 *
 * Reads the fixture's schema and relations (`requiredTables`) from the fixture
 * registry, connects with the fixture's default coordinates (each overridable
 * with --host, --port, --database, --user, --password), and writes
 * `scripts/fixtures/<id>/data/<relation>.json.gz` (a compact JSON array of row
 * objects, gzipped) plus a plain `_meta.json`. The rows are the ones the World
 * Cup REST dump (`scripts/worldcup-rest-api/data/`) would hold, compressed;
 * `_meta.json` has that dump's fields plus each relation's columns and types,
 * for loaders that create typed tables. The dump is the one source the REST
 * server (Step 3) and the Databricks loader (Step 2) read, so the rows are
 * identical on every datasource kind (ADR-0015). `gunzip -c` shows a file.
 *
 * Rows are ordered by the primary key, or by every column for a view, and the
 * gzip header carries no timestamp, so a re-dump of unchanged data is
 * byte-identical apart from `dumpedAt`.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';
import { Client, types } from 'pg';
import {
  SAMPLE_FIXTURES,
  findFixture,
  type SampleFixture,
} from '../src/modules/testing-data/fixtures/registry';

interface Options {
  fixture: SampleFixture;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

interface Column {
  name: string;
  type: string;
  nullable: boolean;
}

const USAGE =
  'Usage: npm run fixture:dump -- --fixture <id> [--database <db>] [--host <h>] [--port <p>] [--user <u>] [--password <pw>]';

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (
      !flag.startsWith('--') ||
      value === undefined ||
      value.startsWith('--')
    ) {
      throw new Error(`Unexpected argument "${flag}". ${USAGE}`);
    }
    flags.set(flag.slice(2), value);
    i++;
  }
  const known = ['fixture', 'host', 'port', 'database', 'user', 'password'];
  const unknown = [...flags.keys()].filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown flag(s) ${unknown.map((k) => `--${k}`).join(', ')}. ${USAGE}`,
    );
  }
  const id = flags.get('fixture');
  const dumpable = SAMPLE_FIXTURES.filter(
    (sample) => (sample.datasourceKind ?? 'postgres') === 'postgres',
  ).map((sample) => sample.id);
  if (!id)
    throw new Error(`--fixture is required (${dumpable.join(', ')}). ${USAGE}`);
  const fixture = findFixture(id);
  if (!fixture) {
    throw new Error(`Unknown fixture "${id}". Known: ${dumpable.join(', ')}.`);
  }
  if ((fixture.datasourceKind ?? 'postgres') !== 'postgres') {
    throw new Error(
      `Fixture "${id}" is not a PostgreSQL sample; dump its PostgreSQL source instead (${dumpable.join(', ')}).`,
    );
  }
  const port = Number(flags.get('port') ?? fixture.defaults.port);
  if (!Number.isInteger(port) || port <= 0)
    throw new Error('--port must be a positive integer');
  return {
    fixture,
    host: flags.get('host') ?? fixture.defaults.host,
    port,
    database: flags.get('database') ?? fixture.defaults.database,
    user: flags.get('user') ?? fixture.defaults.user,
    password: flags.get('password') ?? fixture.defaults.password,
  };
}

/**
 * JSON numbers for NUMERIC, BIGINT and FLOAT (as the World Cup dump does), the
 * calendar string for DATE, ISO 8601 UTC for timestamps. A BIGINT beyond
 * 2^53 would lose digits as a JSON number, so it fails the dump instead.
 */
function registerTypeParsers(): void {
  const toNumber = (value: string) => Number(value);
  const toSafeInteger = (value: string) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
      throw new Error(`BIGINT ${value} does not fit a JSON number exactly`);
    }
    return number;
  };
  types.setTypeParser(1700, toNumber); // NUMERIC
  types.setTypeParser(20, toSafeInteger); // INT8
  types.setTypeParser(700, toNumber); // FLOAT4
  types.setTypeParser(701, toNumber); // FLOAT8
  types.setTypeParser(1082, (value: string) => value); // DATE
  types.setTypeParser(1114, (value: string) =>
    new Date(`${value}Z`).toISOString(),
  ); // TIMESTAMP
  types.setTypeParser(1184, (value: string) => new Date(value).toISOString()); // TIMESTAMPTZ
}

async function columnsOf(
  client: Client,
  schema: string,
  relation: string,
): Promise<Column[]> {
  const { rows } = await client.query<{
    name: string;
    type: string;
    nullable: string;
  }>(
    `SELECT column_name AS name, data_type AS type, is_nullable AS nullable
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [schema, relation],
  );
  return rows.map((row) => ({
    name: row.name,
    type: row.type,
    nullable: row.nullable === 'YES',
  }));
}

async function primaryKeyOf(
  client: Client,
  schema: string,
  relation: string,
): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT attribute.attname AS name
       FROM pg_index idx
       JOIN pg_class rel ON rel.oid = idx.indrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
       JOIN unnest(idx.indkey) WITH ORDINALITY AS key(attnum, position) ON true
       JOIN pg_attribute attribute ON attribute.attrelid = rel.oid AND attribute.attnum = key.attnum
      WHERE idx.indisprimary AND ns.nspname = $1 AND rel.relname = $2
      ORDER BY key.position`,
    [schema, relation],
  );
  return rows.map((row) => row.name);
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { fixture } = options;
  registerTypeParsers();
  const client = new Client({
    host: options.host,
    port: options.port,
    database: options.database,
    user: options.user,
    password: options.password,
  });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach the ${fixture.name} fixture at ${options.host}:${options.port}/${options.database} ` +
        `(${error instanceof Error ? error.message : String(error)}). Load it from Settings, Testing Data ` +
        '(or pass --database for a copy you loaded elsewhere).',
    );
  }

  const dataDir = join(__dirname, 'fixtures', fixture.id, 'data');
  const tables: Record<string, number> = {};
  const columns: Record<string, Column[]> = {};
  const bytes: Record<string, number> = {};
  try {
    const missing: string[] = [];
    for (const relation of fixture.requiredTables) {
      const relationColumns = await columnsOf(client, fixture.schema, relation);
      if (relationColumns.length === 0) missing.push(relation);
      columns[relation] = relationColumns;
    }
    if (missing.length > 0) {
      throw new Error(
        `${options.database} has no ${missing.map((name) => `${fixture.schema}.${name}`).join(', ')}; load the ${fixture.name} sample first.`,
      );
    }
    mkdirSync(dataDir, { recursive: true });
    // A relation dropped from the registry, or a dump in the old plain
    // format, must not linger as a stale file.
    for (const file of readdirSync(dataDir).filter(
      (name) => name.endsWith('.json') || name.endsWith('.json.gz'),
    )) {
      rmSync(join(dataDir, file));
    }
    for (const relation of fixture.requiredTables) {
      const key = await primaryKeyOf(client, fixture.schema, relation);
      const order = (
        key.length > 0 ? key : columns[relation].map((column) => column.name)
      )
        .map(quote)
        .join(', ');
      const { rows } = await client.query(
        `SELECT * FROM ${quote(fixture.schema)}.${quote(relation)} ORDER BY ${order}`,
      );
      const file = `${relation}.json.gz`;
      const compressed = gzipSync(`${JSON.stringify(rows)}\n`, { level: 9 });
      writeFileSync(join(dataDir, file), compressed);
      tables[relation] = rows.length;
      bytes[relation] = compressed.length;
    }
  } finally {
    await client.end();
  }

  const meta = {
    dumpedAt: new Date().toISOString(),
    source: `postgres://${options.user}@${options.host}:${options.port}/${options.database}?schema=${fixture.schema}`,
    fixture: fixture.id,
    schema: fixture.schema,
    /** Each relation is `<relation>.json.gz`: a compact JSON array, gzipped. */
    format: 'json.gz',
    tables,
    columns,
  };
  writeFileSync(
    join(dataDir, '_meta.json'),
    `${JSON.stringify(meta, null, 2)}\n`,
  );

  const width = Math.max(...Object.keys(tables).map((name) => name.length));
  console.log(
    `Dumped ${Object.keys(tables).length} relations of ${fixture.id} to ${dataDir}\n`,
  );
  for (const [name, count] of Object.entries(tables)) {
    console.log(
      `  ${name.padEnd(width)}  ${String(count).padStart(6)} rows  ${String(Math.ceil(bytes[name] / 1024)).padStart(5)} KB`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
