import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { splitSqlStatements } from './sql-statements';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'pg';
import { DatasetsService } from '../datasets/datasets.service';
import { DatasourcesService } from '../datasources/datasources.service';
import type {
  CatalogInfo,
  PostgresConfig,
} from '../datasources/entities/datasource.entity';
import type { DatasetEntitySnapshot } from '../datasets/repositories/datasets.repository';
import type { LoadTestingDataDto } from './dto/testing-data.dto';
import {
  SAMPLE_FIXTURES,
  findFixture,
  requiredEntityKeys,
  type SampleFixture,
} from './fixtures/registry';

/** `pg` reports "database ... does not exist" with this SQLSTATE. */
const UNDEFINED_DATABASE = '3D000';

/** Maintenance database used to issue `CREATE DATABASE`. */
const MAINTENANCE_DATABASE = 'postgres';

/** The seed is a few hundred statements; give it room but not forever. */
const SEED_TIMEOUT_MS = 120_000;
const CONNECT_TIMEOUT_MS = 8_000;

/** Connection the panel submits. `password` never leaves the backend again. */
export interface TestingDataConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

/** Same connection minus the secret — safe to hand back to the renderer. */
export type TestingDataConnectionView = Omit<TestingDataConnection, 'password'>;

/** What the app currently holds for one sample. */
export interface SampleFixtureStatus {
  /** Both the datasource and its dataset exist, with all required entities. */
  loaded: boolean;
  datasourceId?: string;
  datasourceName?: string;
  datasetName?: string;
  entityCount?: number;
  /** How many entities a complete load produces — `requiredTables.length`. */
  requiredCount: number;
  /** Where the loaded datasource points. Never carries a password. */
  connection?: TestingDataConnectionView;
}

/** One sample as the panel sees it: its identity, its form prefill, its state. */
export interface SampleFixtureView {
  id: string;
  name: string;
  description: string;
  /** False for register-only samples: they ship no SQL and cannot be seeded. */
  seedable: boolean;
  schema: string;
  /** Prefill for the form: the sample's documented coordinates. */
  defaults: TestingDataConnection;
  status: SampleFixtureStatus;
}

export interface TestingDataStatus {
  fixtures: SampleFixtureView[];
}

export interface LoadTestingDataResult {
  ok: boolean;
  message: string;
  datasourceId?: string;
  datasetName?: string;
  entityCount?: number;
  /** True when the target database was absent and we created it. */
  createdDatabase?: boolean;
  /** False for a register-only sample: registered, but no SQL was run. */
  seeded?: boolean;
}

/**
 * One-call provisioning of a bundled sample against a PostgreSQL server the
 * user names: seed the sample's schema, register a datasource, and save the
 * dataset covering the entities the assistant evals need. Hand-doing all three
 * is the only thing between a fresh install and a runnable suite.
 *
 * Which samples exist — and what each one is called, owns and must expose —
 * comes entirely from `fixtures/registry.ts`; nothing below is specific to any
 * one of them.
 *
 * Seeding is destructive by design — it drops and recreates the sample's
 * schema on the target database — which is why the panel takes an explicit
 * connection instead of guessing one.
 */
@Injectable()
export class TestingDataService {
  private readonly logger = new Logger(TestingDataService.name);

  constructor(
    private readonly datasources: DatasourcesService,
    private readonly datasets: DatasetsService,
  ) {}

  /**
   * Every sample with nothing loaded — the registry alone, no store reads.
   * The controller falls back to this when the store is unreadable.
   */
  describe(): TestingDataStatus {
    return {
      fixtures: SAMPLE_FIXTURES.map((fixture) =>
        describeFixture(fixture, {
          loaded: false,
          requiredCount: fixture.requiredTables.length,
        }),
      ),
    };
  }

  async status(): Promise<TestingDataStatus> {
    const datasources = await this.datasources.list();
    // Read the datasets once, and only if some sample is actually registered.
    let datasets: Awaited<ReturnType<DatasetsService['list']>> | undefined;
    const fixtures: SampleFixtureView[] = [];

    for (const fixture of SAMPLE_FIXTURES) {
      const requiredCount = fixture.requiredTables.length;
      const datasource = datasources.find(
        (candidate) => candidate.name === fixture.datasourceName,
      );
      if (!datasource) {
        fixtures.push(
          describeFixture(fixture, { loaded: false, requiredCount }),
        );
        continue;
      }
      // `list()` hands back the masked view, so no password can leak from here.
      const connection = connectionView(datasource.config);
      datasets ??= await this.datasets.list();
      const dataset = datasets.find(
        (candidate) => candidate.name === fixture.datasetName,
      );
      if (!dataset) {
        fixtures.push(
          describeFixture(fixture, {
            loaded: false,
            datasourceId: datasource.id,
            datasourceName: datasource.name,
            requiredCount,
            connection,
          }),
        );
        continue;
      }
      const present = presentTables(fixture, dataset.tables ?? []);
      fixtures.push(
        describeFixture(fixture, {
          loaded: present.length === requiredCount,
          datasourceId: datasource.id,
          datasourceName: datasource.name,
          datasetName: dataset.name,
          entityCount: present.length,
          requiredCount,
          connection,
        }),
      );
    }

    return { fixtures };
  }

  /**
   * Seed the supplied database with a sample's bundled fixture and register
   * it. Nothing is written app-side until the seed has actually succeeded, so
   * a failed load never leaves a half-created datasource behind.
   *
   * A register-only sample (no `seedFile`) skips the SQL entirely: the user
   * points the app at a database that already carries the data.
   */
  async load(
    fixtureId: string,
    input: LoadTestingDataDto,
  ): Promise<LoadTestingDataResult> {
    const fixture = findFixture(fixtureId);
    if (!fixture) {
      return { ok: false, message: `Unknown sample fixture "${fixtureId}"` };
    }
    if (fixture.datasourceKind === 'rest') {
      return {
        ok: false,
        message:
          `The ${fixture.name} sample is registered for evals only — create its ` +
          'datasource with scripts/setup-worldcup-rest.ts instead of loading it here.',
      };
    }
    const parsed = parseConnection(input);
    if ('message' in parsed) return { ok: false, message: parsed.message };
    const config = parsed.config;
    const target = `${config.host}:${config.port}`;
    const seedable = Boolean(fixture.seedFile);

    let createdDatabase = false;
    let client: Client;
    try {
      client = await openClient(config, config.database);
    } catch (err) {
      if (sqlState(err) !== UNDEFINED_DATABASE) {
        return { ok: false, message: connectionFailure(fixture, config, err) };
      }
      if (!seedable) {
        // Creating an empty database would be pointless: without a seed there
        // is nothing to put in it, and the inventory would come back bare.
        return {
          ok: false,
          message:
            `Database "${config.database}" does not exist on ${target}, and the ` +
            `${fixture.name} sample ships no seed SQL — point this at a database ` +
            'that already carries the data.',
        };
      }
      // The database is simply absent — create it from the maintenance
      // database with the same credentials, then carry on.
      try {
        await createDatabase(config);
        createdDatabase = true;
        client = await openClient(config, config.database);
      } catch (createErr) {
        return {
          ok: false,
          message:
            `Database "${config.database}" does not exist on ${target} and the user ` +
            `"${config.user}" could not create it. Create the database yourself (or ` +
            'supply a user with CREATEDB rights) and load again. ' +
            `(${describeError(createErr)})`,
        };
      }
    }

    try {
      if (seedable) {
        this.logger.log(
          `Seeding ${fixture.schema} on ${target}/${config.database} as "${config.user}"` +
            (createdDatabase ? ' (database created)' : ''),
        );
        await client.query(`DROP SCHEMA IF EXISTS "${fixture.schema}" CASCADE`);
        await seedInBatches(client, readFixtureSql(fixture));
      } else {
        this.logger.log(
          `Registering ${fixture.name} on ${target}/${config.database} as ` +
            `"${config.user}" without seeding (no bundled SQL)`,
        );
      }
    } catch (err) {
      return {
        ok: false,
        message:
          `Could not seed the ${fixture.name} fixture into "${config.database}" on ${target} — ` +
          `${describeError(err)}`,
      };
    } finally {
      await client.end().catch(() => undefined);
    }

    const existing = await this.findDatasource(fixture);
    const datasource = await this.datasources.save({
      id: existing?.id,
      name: fixture.datasourceName,
      kind: 'postgres',
      config,
    });

    const { catalogs } = await this.datasources.inventory(datasource.id, true);
    const { entities, missing } = collectEntities(
      catalogs,
      requiredEntityKeys(fixture, config.database),
    );
    if (missing.length > 0) {
      const step = seedable ? 'seeding' : 'registering';
      this.logger.warn(
        `${fixture.name} ${step} finished but the inventory is incomplete: ${missing.join(', ')}`,
      );
      return {
        ok: false,
        message:
          `Missing entities after ${step}: ${missing.join(', ')}. ` +
          (seedable
            ? 'The fixture ran but did not produce everything the evals need — check the ' +
              'database for conflicting objects and load again.'
            : 'This sample ships no seed SQL, so the database must already carry them — ' +
              'check the connection points at the right database and load again.'),
        datasourceId: datasource.id,
        createdDatabase,
        seeded: seedable,
      };
    }

    await this.datasets.save({
      name: fixture.datasetName,
      tables: entities.map((entity) => entity.key),
      entities,
      datasourceId: datasource.id,
    });

    return {
      ok: true,
      message: seedable
        ? `Seeded ${fixture.schema} on ${target} and loaded ${entities.length} entities ` +
          `into dataset "${fixture.datasetName}"` +
          (createdDatabase ? ' — created the database' : '')
        : `Registered ${target}/${config.database} and loaded ${entities.length} entities ` +
          `into dataset "${fixture.datasetName}" — the ${fixture.name} sample ships no ` +
          'seed SQL, so nothing was written to the database',
      datasourceId: datasource.id,
      datasetName: fixture.datasetName,
      entityCount: entities.length,
      createdDatabase,
      seeded: seedable,
    };
  }

  /**
   * Forget one sample app-side. Deliberately does not touch the database: the
   * user owns that server, and dropping their schema on a "remove" click would
   * be an unpleasant surprise.
   */
  async clear(fixtureId: string): Promise<{ ok: boolean; message: string }> {
    const fixture = findFixture(fixtureId);
    if (!fixture) {
      return { ok: false, message: `Unknown sample fixture "${fixtureId}"` };
    }
    const datasource = await this.findDatasource(fixture);
    // Dataset first: it points at the datasource.
    const removedDatasets = await this.datasets.delete(fixture.datasetName);
    if (datasource) await this.datasources.delete(datasource.id);
    if (!datasource && !removedDatasets) {
      return {
        ok: true,
        message: 'Nothing to remove — the sample is not loaded',
      };
    }
    return {
      ok: true,
      message:
        `Removed the ${fixture.name} datasource and dataset from this app. ` +
        'The database itself was left untouched.',
    };
  }

  private async findDatasource(fixture: SampleFixture) {
    const all = await this.datasources.list();
    return all.find((d) => d.name === fixture.datasourceName);
  }
}

/** The registry entry as the API exposes it, around a computed status. */
function describeFixture(
  fixture: SampleFixture,
  status: SampleFixtureStatus,
): SampleFixtureView {
  return {
    id: fixture.id,
    name: fixture.name,
    description: fixture.description,
    seedable: Boolean(fixture.seedFile),
    schema: fixture.schema,
    defaults: { ...fixture.defaults },
    status,
  };
}

/**
 * Read at call time so a rebuilt/updated fixture is picked up without a
 * restart. The SQL ships next to the compiled service (`nest-cli.json` copies
 * `modules/testing-data/fixtures/**` into `dist`), so the same relative path
 * resolves from `src` under ts-jest and from `dist` in a packaged app.
 */
function readFixtureSql(fixture: SampleFixture): string {
  const seedFile = fixture.seedFile as string;
  const raw = readFileSync(join(__dirname, 'fixtures', seedFile));
  // Large samples ship gzipped — a full dump is an order of magnitude smaller
  // compressed, which keeps the repo and the packaged app reasonable.
  const sql = seedFile.endsWith('.gz')
    ? gunzipSync(raw).toString('utf8')
    : raw.toString('utf8');
  // pg_dump 16.14+ brackets its output with `\restrict`/`\unrestrict` psql
  // meta-commands. psql consumes them; `client.query` sees them as SQL and
  // fails on the backslash. Only these two are stripped — a blanket "drop
  // lines starting with a backslash" would corrupt multi-line string data.
  return sql.replace(/^\\(?:un)?restrict .*$/gm, '');
}

/**
 * Whether a statement is just transaction control. `pg_dump` brackets its
 * output with BEGIN/COMMIT and the loader runs its own transaction around
 * everything, so these must be dropped — the dump's COMMIT would otherwise
 * end the loader's transaction half-way through the seed.
 *
 * A statement keeps any comments that preceded it, so those are stripped
 * before matching; a bare `^BEGIN$` test silently misses a commented one.
 */
function isTransactionControl(statement: string): boolean {
  const bare = statement
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--[^\n]*$/gm, '')
    .trim();
  return /^(BEGIN|COMMIT|START TRANSACTION)$/i.test(bare);
}

/**
 * Statements per round-trip. A whole dump in one `query()` makes the server
 * parse megabytes at once and exhaust its shared memory; one statement per
 * round-trip would be thousands of round-trips. Batching keeps both bounded.
 */
const SEED_BATCH_STATEMENTS = 50;

/**
 * Replay a seed script in bounded batches, inside one transaction so a failure
 * part-way through leaves no half-built schema behind. `pg_dump` brackets its
 * own output with BEGIN/COMMIT, which would nest here — those are dropped and
 * the transaction is managed once, around everything.
 */
async function seedInBatches(client: Client, sql: string): Promise<void> {
  const statements = splitSqlStatements(sql).filter(
    (statement) => !isTransactionControl(statement),
  );
  await client.query('BEGIN');
  try {
    for (let i = 0; i < statements.length; i += SEED_BATCH_STATEMENTS) {
      const batch = statements.slice(i, i + SEED_BATCH_STATEMENTS);
      await client.query(`${batch.join(';\n')};`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

/** Validate and coerce the submitted connection. */
function parseConnection(
  input: LoadTestingDataDto,
): { config: TestingDataConnection } | { message: string } {
  const host = text(input?.host);
  const database = text(input?.database);
  const user = text(input?.user);
  const port = Number(input?.port);

  if (!host) return { message: 'Host is required' };
  if (!database) return { message: 'Database is required' };
  if (!user) return { message: 'User is required' };
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { message: 'Port must be a positive integer' };
  }
  // The database name is interpolated into CREATE DATABASE as a quoted
  // identifier; a name containing a double quote could break out of it.
  if (database.includes('"')) {
    return { message: 'Database name must not contain a double quote' };
  }

  const rawPassword: unknown = input?.password;
  const rawSsl: unknown = input?.ssl;
  return {
    config: {
      host,
      port,
      database,
      user,
      password: typeof rawPassword === 'string' ? rawPassword : '',
      ssl: rawSsl === true || rawSsl === 'true',
    },
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A connected `pg` client against `database`, using the supplied credentials. */
async function openClient(
  config: TestingDataConnection,
  database: string,
): Promise<Client> {
  const client = new Client({
    host: config.host,
    port: config.port,
    database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: SEED_TIMEOUT_MS,
  });
  try {
    await client.connect();
  } catch (err) {
    await client.end().catch(() => undefined);
    throw err;
  }
  return client;
}

/** `CREATE DATABASE` from the maintenance database with the same credentials. */
async function createDatabase(config: TestingDataConnection): Promise<void> {
  const admin = await openClient(config, MAINTENANCE_DATABASE);
  try {
    await admin.query(
      `CREATE DATABASE "${config.database.replace(/"/g, '""')}"`,
    );
  } finally {
    await admin.end().catch(() => undefined);
  }
}

/** SQLSTATE of a `pg` error, when it carries one. */
function sqlState(err: unknown): string | undefined {
  if (err instanceof AggregateError) {
    for (const inner of err.errors) {
      const code = sqlState(inner);
      if (code) return code;
    }
  }
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Actionable text for a failed connect — names the target, never the password. */
function connectionFailure(
  fixture: SampleFixture,
  config: TestingDataConnection,
  err: unknown,
): string {
  const target = `${config.host}:${config.port}`;
  const detail = describeError(err);
  if (sqlState(err) === 'ECONNREFUSED' || /ECONNREFUSED/i.test(detail)) {
    return (
      `Could not reach PostgreSQL at ${target} — nothing is listening there. ` +
      (fixture.seedFile
        ? `The bundled ${fixture.name} fixture starts with "docker compose up -d" from the repo root; `
        : '') +
      `otherwise check the host and port. (${detail})`
    );
  }
  return (
    `Could not connect to ${config.database} at ${target} as "${config.user}" — ` +
    `${detail}`
  );
}

/**
 * Flatten an error into a legible message. `pg` throws an `AggregateError`
 * (empty `.message`) when a host resolves to several addresses and every
 * attempt fails — e.g. `localhost` → both `::1` and `127.0.0.1`. Named fields
 * only: the error object is never stringified wholesale, since `pg` hangs the
 * client config (password included) off it.
 */
function describeError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length) {
    const parts = err.errors.map(describeError).filter(Boolean);
    if (parts.length) return Array.from(new Set(parts)).join('; ');
  }
  if (err instanceof Error) {
    const { code, detail, hint } = err as {
      code?: string;
      detail?: unknown;
      hint?: unknown;
    };
    const base = err.message || (code ? String(code) : err.constructor.name);
    const extras = [
      ['DETAIL', detail],
      ['HINT', hint],
    ]
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(
        ([label, value]) => `${label as string}: ${(value as string).trim()}`,
      );
    return [base, ...extras].join(' — ');
  }
  return String(err) || 'unknown error';
}

/** Host/port/database/user/ssl of a saved postgres datasource — no secret. */
function connectionView(
  config: unknown,
): TestingDataConnectionView | undefined {
  const pg = config as Partial<PostgresConfig> | undefined;
  if (!pg || typeof pg.host !== 'string') return undefined;
  return {
    host: pg.host,
    port: Number(pg.port) || 5432,
    database: String(pg.database ?? ''),
    user: String(pg.user ?? ''),
    ssl: pg.ssl === true,
  };
}

/**
 * Walk catalogs → schemas → tables and snapshot the required entities.
 * `sampleValues` and `references` are deliberately absent — `DatasetsService`
 * enriches those from a live sample and the join graph on save.
 */
function collectEntities(
  catalogs: CatalogInfo[],
  required: string[],
): {
  entities: DatasetEntitySnapshot[];
  missing: string[];
} {
  const found = new Map<string, DatasetEntitySnapshot>();
  for (const catalog of catalogs ?? []) {
    for (const schema of catalog.schemas ?? []) {
      for (const table of schema.tables ?? []) {
        const key = `${catalog.name}.${schema.name}.${table.name}`;
        found.set(qualify(key), {
          key,
          columns: (table.columns ?? []).map((column) => ({
            name: column.name,
            type: column.type,
            nullable: column.nullable,
          })),
        });
      }
    }
  }
  const entities: DatasetEntitySnapshot[] = [];
  const missing: string[] = [];
  for (const entity of required) {
    const snapshot = found.get(qualify(entity));
    if (snapshot) entities.push(snapshot);
    else missing.push(entity);
  }
  return { entities, missing };
}

/** Which of a sample's required tables a saved dataset already covers. */
function presentTables(fixture: SampleFixture, tables: string[]): string[] {
  const keys = new Set(tables.map((table) => qualify(table)));
  return fixture.requiredTables.filter((table) =>
    keys.has(qualify(`${fixture.schema}.${table}`)),
  );
}

/**
 * Compare on `schema.table`: the catalog segment is the database name, which
 * the user picks, and older snapshots omit it entirely — but a same-named
 * table in another schema must never count as a match.
 */
function qualify(entity: string): string {
  return entity.toLowerCase().split('.').slice(-2).join('.');
}
