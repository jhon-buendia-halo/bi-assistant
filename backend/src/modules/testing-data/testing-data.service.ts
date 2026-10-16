import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { splitSqlStatements } from './sql-statements';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { Client } from 'pg';
import { DatasetsService } from '../datasets/datasets.service';
import { DatasourcesService } from '../datasources/datasources.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { MetricsService } from '../metrics/metrics.service';
import { getIntellifyApiInfo } from '../../intellify-api/api-info';
import type {
  CatalogInfo,
  PostgresConfig,
  RestApiConfig,
  RestEndpointDef,
} from '../datasources/entities/datasource.entity';
import type { DatasetEntitySnapshot } from '../datasets/repositories/datasets.repository';
import type { LoadTestingDataDto } from './dto/testing-data.dto';
import type { KnowledgeSnippetKind } from '../knowledge/entities/knowledge-snippet.entity';
import type { SeedKnowledgeEntry } from './fixtures/knowledge/types';
import {
  SAMPLE_FIXTURES,
  databricksSource,
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
  /** True for a REST sample whose API this app runs (no connection form). */
  selfRegistering: boolean;
  /** Self-registering samples: the URL of the API this app started, if any. */
  apiUrl?: string;
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
 * What creating a sample's knowledge seed did (testing-data R26): how many
 * knowledge entries and metrics it created, and, when one could not be saved,
 * why. The entries created before the failure stay.
 */
export interface KnowledgeSeedOutcome {
  knowledge: number;
  metrics: number;
  error?: string;
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
    private readonly knowledge: KnowledgeService,
    private readonly metrics: MetricsService,
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
      // Only a PostgreSQL datasource has a host:port/database to show.
      const connection =
        datasource.kind === 'postgres'
          ? connectionView(datasource.config)
          : undefined;
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
    if (fixture.selfRegistering) return this.loadSelfRegistering(fixture);
    if (fixture.datasourceKind === 'rest') {
      return {
        ok: false,
        message:
          `The ${fixture.name} sample is registered for evals only — create its ` +
          'datasource with scripts/setup-worldcup-rest.ts instead of loading it here.',
      };
    }
    if (fixture.datasourceKind === 'databricks') {
      // The panel is a PostgreSQL client; a Databricks sample is loaded into
      // Unity Catalog and registered by its own script (testing-data R23).
      const source = databricksSource(fixture)?.id ?? fixture.id;
      return {
        ok: false,
        message:
          `The ${fixture.name} sample is registered for evals only — load it into ` +
          `Databricks and register it with scripts/setup-fixture-databricks.ts --fixture ${source} ` +
          'instead of loading it here (runbook: docs/evals/databricks-vdi.md).',
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

    // The load has succeeded; the seed can only add to the message (R26).
    const seed = await this.createKnowledgeSeed(
      fixture,
      config.database,
      datasource.id,
    );

    return {
      ok: true,
      message:
        (seedable
          ? `Seeded ${fixture.schema} on ${target} and loaded ${entities.length} entities ` +
            `into dataset "${fixture.datasetName}"` +
            (createdDatabase ? ' — created the database' : '')
          : `Registered ${target}/${config.database} and loaded ${entities.length} entities ` +
            `into dataset "${fixture.datasetName}" — the ${fixture.name} sample ships no ` +
            'seed SQL, so nothing was written to the database') +
        knowledgeSeedSuffix(seed),
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

  /**
   * Register the REST API this app itself runs (R21): no connection, no
   * database writes. Reads the API's URL and key in-process, checks its health,
   * proposes its collection endpoints from its OpenAPI document and saves the
   * datasource and the dataset over them.
   */
  private async loadSelfRegistering(
    fixture: SampleFixture,
  ): Promise<LoadTestingDataResult> {
    const info = getIntellifyApiInfo();
    if (!info) {
      return {
        ok: false,
        message:
          'The Intellify API is not running in this app (INTELLIFY_API=off or it failed to start) — see the system logs.',
      };
    }
    const url = info.url.replace(/\/+$/, '');

    const health = await readHealth(url);
    if (!health.reachable) {
      return {
        ok: false,
        message:
          `The Intellify API at ${url} did not answer its health check ` +
          `(${health.detail}) — see the system logs.`,
      };
    }
    if (health.databaseDown) {
      return {
        ok: false,
        message:
          `The Intellify API cannot reach its database at ${intellifyDatabaseTarget()}. ` +
          'Load the "Intellify" sample into that database first.',
      };
    }

    const auth: RestApiConfig['auth'] = {
      type: 'api-key-header',
      headerName: 'X-API-Key',
      token: info.apiKey,
    };
    const endpoints = await this.collectionEndpoints(fixture, url, auth);

    const existing = await this.findDatasource(fixture);
    const datasource = await this.datasources.save({
      id: existing?.id,
      name: fixture.datasourceName,
      kind: 'rest',
      config: { baseUrl: url, auth, endpoints },
    });

    const { catalogs } = await this.datasources.inventory(datasource.id, true);
    const { entities, missing } = collectEntities(
      catalogs,
      requiredEntityKeys(fixture, 'api'),
    );
    if (missing.length > 0) {
      this.logger.warn(
        `${fixture.name} registering finished but the inventory is incomplete: ${missing.join(', ')}`,
      );
      return {
        ok: false,
        message:
          `Missing entities after registering: ${missing.join(', ')}. ` +
          'The Intellify API did not return everything the RFP Builder needs — check the system logs and load again.',
        datasourceId: datasource.id,
        seeded: false,
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
      message:
        `Registered the ${fixture.name} at ${url} and loaded ${entities.length} entities ` +
        `into dataset "${fixture.datasetName}"`,
      datasourceId: datasource.id,
      datasetName: fixture.datasetName,
      entityCount: entities.length,
      seeded: false,
    };
  }

  /**
   * The API's ten collection endpoints. They come from the OpenAPI document
   * through the datasources' REST discovery when it yields exactly the
   * required routes; otherwise (an older or partial document, or discovery
   * failing) they are built explicitly from the fixture's list so the
   * registration never depends on how a spec happens to be written.
   */
  private async collectionEndpoints(
    fixture: SampleFixture,
    url: string,
    auth: RestApiConfig['auth'],
  ): Promise<RestEndpointDef[]> {
    const expected = fixture.requiredTables.map((table) => ({
      table,
      path: `/v1/${table.replace(/_/g, '-')}`,
    }));
    try {
      const discovery = await this.datasources.discoverRestEndpoints(
        { baseUrl: url, auth, endpoints: [] },
        `${url}/openapi.json`,
      );
      const proposed = discovery.endpoints
        .filter((found) => found.listResponse && found.method === 'GET')
        .map((found) => found.endpoint);
      const byPath = new Map(
        proposed.map((endpoint) => [normalisePath(endpoint.path), endpoint]),
      );
      if (
        proposed.length === expected.length &&
        expected.every(({ path }) => byPath.has(path))
      ) {
        return expected.map(({ table, path }) => ({
          ...(byPath.get(path) as RestEndpointDef),
          name: table,
          group: 'intellify',
        }));
      }
      this.logger.warn(
        'Intellify API discovery did not propose exactly its ten collection routes; using the explicit endpoint list',
      );
    } catch (err) {
      this.logger.warn(
        `Intellify API discovery failed (${describeError(err)}); using the explicit endpoint list`,
      );
    }
    return expected.map(({ table, path }) => ({
      name: table,
      group: 'intellify',
      path,
      rowsPointer: '/data',
      pagination: {
        style: 'page',
        pageParam: 'page',
        sizeParam: 'per_page',
        pageSize: 100,
      },
    }));
  }

  private async findDatasource(fixture: SampleFixture) {
    const all = await this.datasources.list();
    return all.find((d) => d.name === fixture.datasourceName);
  }

  /**
   * Create the sample's knowledge seed (R26) through the normal knowledge and
   * metrics create: each knowledge entry scoped to the sample's dataset and
   * enabled, each metric on the loaded datasource, every entity named
   * `<database>.<schema>.<table>` on the database just loaded. An entry the
   * app already holds is left as it is: a knowledge entry of the same kind
   * and title scoped to that dataset, or a metric of the same name. Never
   * throws: a save that fails stops the seed and is reported in the outcome,
   * so the load it follows still succeeds.
   *
   * The knowledge block keeps only what fits its budget, newest-updated first
   * (knowledge R16, R17), so the entries are created in the reverse of the
   * order they should be sent in (`seedCreationOrder`), each one stamped
   * strictly later than the one before: the store breaks a tie by insertion
   * order, oldest first, which would put the terms ahead of the filters.
   */
  private async createKnowledgeSeed(
    fixture: SampleFixture,
    database: string,
    datasourceId: string,
  ): Promise<KnowledgeSeedOutcome> {
    const outcome: KnowledgeSeedOutcome = { knowledge: 0, metrics: 0 };
    const seed = fixture.knowledge;
    if (!seed) return outcome;
    const qualify = (entity: string) => `${database}.${entity}`;
    try {
      const heldEntries = new Set(
        (await this.knowledge.list({ datasetId: fixture.datasetName }))
          .filter((entry) => entry.scope?.datasetId === fixture.datasetName)
          .map((entry) => heldEntryKey(entry.kind, entry.title)),
      );
      let lastStamp: number | undefined;
      for (const entry of seedCreationOrder(seed.knowledge)) {
        const key = heldEntryKey(entry.kind, entry.title);
        if (heldEntries.has(key)) continue;
        if (lastStamp !== undefined) await waitPast(lastStamp);
        const saved = await this.knowledge.create({
          kind: entry.kind,
          scope: { datasetId: fixture.datasetName },
          title: entry.title,
          body: entry.body,
          ...(entry.synonyms?.length ? { synonyms: entry.synonyms } : {}),
          entities: entry.entities.map(qualify),
          enabled: true,
        });
        lastStamp = savedAt(saved?.updatedAt);
        heldEntries.add(key);
        outcome.knowledge += 1;
      }

      const heldMetrics = new Set(
        (await this.metrics.list()).map((metric) => heldMetricKey(metric.name)),
      );
      for (const metric of seed.metrics) {
        const key = heldMetricKey(metric.name);
        if (heldMetrics.has(key)) continue;
        await this.metrics.create({
          name: metric.name,
          label: metric.label,
          ...(metric.description ? { description: metric.description } : {}),
          entity: qualify(metric.entity),
          datasourceId,
          expression: metric.expression,
          ...(metric.dimensions?.length
            ? { dimensions: metric.dimensions }
            : {}),
        });
        heldMetrics.add(key);
        outcome.metrics += 1;
      }
    } catch (err) {
      const error = describeError(err);
      this.logger.warn(
        `${fixture.name} loaded, but its knowledge seed stopped after ` +
          `${outcome.knowledge} knowledge entries and ${outcome.metrics} metrics: ${error}`,
      );
      return { ...outcome, error };
    }
    if (outcome.knowledge || outcome.metrics) {
      this.logger.log(
        `${fixture.name} knowledge seed${knowledgeSeedSuffix(outcome)} ` +
          `(dataset "${fixture.datasetName}")`,
      );
    }
    return outcome;
  }
}

/**
 * The order a seed's entries should reach the assistant in when the
 * knowledge block cannot hold them all: the default filters, then the
 * instructions, then the terms, each group in the seed's own order.
 */
const SEND_ORDER: readonly KnowledgeSnippetKind[] = [
  'default_filter',
  'instruction',
  'term',
];

/**
 * The order the loader creates a seed's entries in: the reverse of the send
 * order (terms in reverse seed order first, default filters last), because
 * the block lists the newest-updated entry first (knowledge R16).
 */
export function seedCreationOrder(
  entries: readonly SeedKnowledgeEntry[],
): SeedKnowledgeEntry[] {
  return SEND_ORDER.flatMap((kind) =>
    entries.filter((entry) => entry.kind === kind),
  ).reverse();
}

/**
 * The millisecond an entry was stamped with: its stored `updatedAt`, never
 * later than now (so a malformed or future stamp cannot stall the wait).
 */
function savedAt(updatedAt: string | undefined): number {
  const now = Date.now();
  const stamp = Date.parse(updatedAt ?? '');
  return Number.isFinite(stamp) ? Math.min(stamp, now) : now;
}

/** Resolve once the clock has moved past `ms`, so the next stamp is later. */
async function waitPast(ms: number): Promise<void> {
  while (Date.now() <= ms) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/**
 * A knowledge entry is held (R26) when one of the same kind and title is
 * scoped to the sample's dataset. Titles compare trimmed and case-blind, as
 * the knowledge bootstrap compares them, so a title re-cased by hand is still
 * the same entry and is never duplicated.
 */
function heldEntryKey(kind: string, title: string): string {
  return `${kind}:${title.trim().toLowerCase()}`;
}

/** Metric names are stored trimmed and lowercased (metrics R2). */
function heldMetricKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The end of a successful load's message once the knowledge seed ran (R26):
 * ` — added <k> knowledge entries and <m> metrics`, singular for 1 and a part
 * with 0 left out; nothing when it created nothing; and when an entry could
 * not be saved, ` — could not add its knowledge seed: <detail>` instead.
 */
export function knowledgeSeedSuffix(outcome: KnowledgeSeedOutcome): string {
  if (outcome.error !== undefined) {
    return ` — could not add its knowledge seed: ${outcome.error}`;
  }
  const parts: string[] = [];
  if (outcome.knowledge > 0) {
    parts.push(
      `${outcome.knowledge} knowledge ${outcome.knowledge === 1 ? 'entry' : 'entries'}`,
    );
  }
  if (outcome.metrics > 0) {
    parts.push(
      `${outcome.metrics} ${outcome.metrics === 1 ? 'metric' : 'metrics'}`,
    );
  }
  return parts.length ? ` — added ${parts.join(' and ')}` : '';
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
    selfRegistering: Boolean(fixture.selfRegistering),
    ...(fixture.selfRegistering
      ? { apiUrl: getIntellifyApiInfo()?.url ?? undefined }
      : {}),
    defaults: { ...fixture.defaults },
    status,
  };
}

const HEALTH_TIMEOUT_MS = 8_000;

/** `GET <url>/health`: reachable, and whether the API's database is down. */
async function readHealth(
  url: string,
): Promise<{ reachable: boolean; databaseDown: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/health`, {
      signal: controller.signal,
    });
    let body: { ok?: unknown; database?: unknown } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // A non-JSON answer from a 503 still counts as unreachable below.
    }
    const databaseDown = body.database === 'down' || body.ok === false;
    if (!response.ok && !databaseDown) {
      return {
        reachable: false,
        databaseDown: false,
        detail: `HTTP ${response.status}`,
      };
    }
    return { reachable: true, databaseDown, detail: '' };
  } catch (err) {
    return {
      reachable: false,
      databaseDown: false,
      detail: describeError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** `host:port/db` the Intellify API reads, from the same variables it does. */
function intellifyDatabaseTarget(): string {
  const host = process.env.INTELLIFY_DB_HOST || '127.0.0.1';
  const port =
    process.env.INTELLIFY_DB_PORT || process.env.WORLD_CUP_DB_PORT || '55432';
  const name = process.env.INTELLIFY_DB_NAME || 'intellify_mercer_demo';
  return `${host}:${port}/${name}`;
}

function normalisePath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
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
