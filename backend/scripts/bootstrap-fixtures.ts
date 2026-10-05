/**
 * One-command eval-fixture bootstrap.
 *
 * The eval harnesses (`scripts/run-eval.ts`, `scripts/check-answers.ts`, the
 * in-app Mastra suites) read the SAME local datastore the desktop app uses
 * (`APP_DATA_DIR`, default `<cwd>/data`). A fresh machine has no datasource
 * and no datasets in that store, so every harness fails its preflight before
 * it ever asks the assistant a question. This script does, in one command,
 * everything a human would otherwise click through in the app:
 *
 *   1. Register (or reuse) a Postgres datasource pointed at the dev
 *      `docker compose` database (see `docker-compose.yml`, port 55432).
 *   2. Save one dataset per fixture schema (`world_cup`, `health_insurance`,
 *      `genomics`, `supply_chain`, `banking`), discovering the entity list
 *      from the datasource's own inventory rather than hard-coding table
 *      names.
 *   3. Seed the FULL business-semantics document per fixture — every
 *      knowledge snippet and metric in `fixture-semantics.ts`, plus each
 *      dataset's operator-written description — not just the handful of
 *      trap-specific entries the pre-U2-D version of this script seeded.
 *
 * Run with `npm run fixtures:register` from `backend/`.
 *
 * Boots the backend as a Nest standalone application context (no HTTP),
 * exactly like `run-eval.ts` — see that file for the pattern this mirrors.
 *
 * Flags (see `printUsage`): `--dry-run`, `--force-refresh` (dataset
 * re-snapshot), `--reprofile` (also recompute column profiles),
 * `--descriptions` (set dataset descriptions only — skip knowledge/metric
 * seeding), `--semantics-only` (skip datasource/dataset creation — seed
 * knowledge/metrics/descriptions against datasets already registered by a
 * prior run). With no flags, today's behaviour is unchanged except that the
 * full semantics set is now seeded (not just the four trap-specific
 * entries) and dataset descriptions are set alongside it.
 */
// Must stay the first import: see scripts/lib/use-isolated-observability.ts.
import './lib/use-isolated-observability';
import type { INestApplicationContext, LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DatasourcesService } from '../src/modules/datasources/datasources.service';
import type {
  CatalogInfo,
  PostgresConfig,
} from '../src/modules/datasources/entities/datasource.entity';
import { DatasetsService } from '../src/modules/datasets/datasets.service';
import { DatasetsRepository } from '../src/modules/datasets/repositories/datasets.repository';
import type {
  DatasetDoc,
  DatasetEntitySnapshot,
} from '../src/modules/datasets/repositories/datasets.repository';
import { KnowledgeService } from '../src/modules/knowledge/knowledge.service';
import type {
  KnowledgeSnippet,
  KnowledgeSnippetInput,
} from '../src/modules/knowledge/entities/knowledge-snippet.entity';
import { MetricsService } from '../src/modules/metrics/metrics.service';
import type { MetricDoc, MetricInput } from '../src/modules/metrics/entities/metric.entity';
import {
  FIXTURE_SEMANTICS,
  type FixtureSemantics,
  type SemanticKnowledgeSnippet,
  type SemanticMetric,
} from './fixture-semantics';

/** A misconfiguration the operator must fix — reported without a stack trace. */
class SetupError extends Error {}

// ------------------------------------------------------------- constants

const DATASOURCE_NAME = 'Fixtures (local Postgres)';
// Mirrors docker-compose.yml exactly: same default port, same override var,
// same fixed dev credentials (never a secret worth protecting further). Also
// the catalog segment `fixture-semantics.ts`'s two-segment `schema.table`
// entity names get qualified with — one Postgres database, three schemas.
const DB_PORT = Number(process.env.WORLD_CUP_DB_PORT ?? 55432);
const DB_HOST = 'localhost';
const DB_NAME = 'world_cup';
const DB_USER = 'world_cup';
const DB_PASSWORD = 'world_cup_dev';

interface FixtureDataset {
  /** Saved dataset name. */
  name: string;
  /** Postgres schema this dataset scopes to, one table/view each. */
  schema: string;
}

const FIXTURE_DATASETS: FixtureDataset[] = [
  { name: 'World Cup', schema: 'world_cup' },
  { name: 'Health Insurance', schema: 'health_insurance' },
  { name: 'Genomics', schema: 'genomics' },
  { name: 'Supply Chain', schema: 'supply_chain' },
  { name: 'Banking', schema: 'banking' },
];

// ------------------------------------------------------------------ cli

interface Options {
  dryRun: boolean;
  forceRefresh: boolean;
  /** Also call `DatasetsService.reprofile(name)` for each fixture dataset. */
  reprofile: boolean;
  /** Set dataset descriptions only — skip knowledge/metric seeding entirely. */
  descriptionsOnly: boolean;
  /** Skip datasource/dataset creation — seed semantics against existing datasets. */
  semanticsOnly: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    dryRun: false,
    forceRefresh: false,
    reprofile: false,
    descriptionsOnly: false,
    semanticsOnly: false,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force-refresh') options.forceRefresh = true;
    else if (arg === '--reprofile') options.reprofile = true;
    else if (arg === '--descriptions') options.descriptionsOnly = true;
    else if (arg === '--semantics-only') options.semanticsOnly = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else throw new SetupError(`Unknown argument "${arg}" (try --help)`);
  }
  return options;
}

function printUsage(): void {
  console.log(
    [
      'Usage: npm run fixtures:register -- [options]',
      '',
      '  --dry-run         print what would change, touch nothing',
      '  --force-refresh   re-snapshot datasets that already exist',
      '  --reprofile       also recompute column profiles for each fixture dataset',
      '  --descriptions    set dataset descriptions only — skip knowledge/metric seeding',
      '  --semantics-only  skip datasource/dataset creation — seed knowledge/metrics/',
      '                    descriptions against datasets a prior run already registered',
      '',
      'With no flags: register the datasource, save/refresh every fixture',
      'dataset, seed the full semantics document per fixture (knowledge +',
      'metrics), and set each dataset\'s description.',
      '',
      'Env: WORLD_CUP_DB_PORT (default 55432),',
      '     APP_DATA_DIR (datastore location — must match the desktop app).',
    ].join('\n'),
  );
}

// -------------------------------------------------------------- summary

interface DatasetSummary {
  name: string;
  status: 'created' | 'refreshed' | 'up-to-date' | 'skipped' | 'would-create';
  entityCount: number;
  detail?: string;
}

/** One row of the semantics summary table — description, knowledge, metric or reprofile. */
interface SemanticsRow {
  fixture: string;
  item: string;
  status:
    | 'created'
    | 'updated'
    | 'unchanged'
    | 'would-create'
    | 'would-update'
    | 'reprofiled'
    | 'would-reprofile'
    | 'skipped';
  detail?: string;
}

// -------------------------------------------------------- datasource step

/**
 * Ensure the shared fixtures datasource exists (or would, under --dry-run),
 * and verify it is actually reachable — reusing an unreachable datasource
 * silently is worse than failing loudly here, before any dataset/knowledge
 * work is attempted.
 */
async function ensureDatasource(
  datasources: DatasourcesService,
  options: Options,
): Promise<{ id: string; created: boolean }> {
  const config: PostgresConfig = {
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    ssl: false,
  };

  // Read-only `SELECT 1` — safe to run in --dry-run too, and it is the only
  // way to give the operator an actionable error instead of a stack trace.
  try {
    await datasources.testConnection('postgres', config);
  } catch (error) {
    throw new SetupError(
      `Postgres at ${DB_HOST}:${DB_PORT}/${DB_NAME} is not reachable — ${message(error)}. ` +
        'Run `docker compose up -d` from the repo root and retry.',
    );
  }

  const existing = (await datasources.list()).find(
    (d) => d.name === DATASOURCE_NAME,
  );
  if (existing) return { id: existing.id, created: false };

  if (options.dryRun) {
    return { id: '(dry-run: not created)', created: true };
  }
  const saved = await datasources.save({
    name: DATASOURCE_NAME,
    kind: 'postgres',
    config,
  });
  return { id: saved.id, created: true };
}

// ------------------------------------------------------------ dataset step

/**
 * Walk the datasource's own inventory (never hard-coded table names) so a
 * regenerated fixture — e.g. the two new schemas landing from a parallel
 * unit — stays in sync automatically. Called through the connector directly
 * (not `DatasourcesService.inventory`) so it works even before the datasource
 * is persisted (--dry-run) and never touches the inventory cache table.
 */
async function loadCatalogs(
  datasources: DatasourcesService,
  config: PostgresConfig,
): Promise<CatalogInfo[]> {
  return datasources.connector('postgres').inventory(config);
}

function findSchema(catalogs: CatalogInfo[], schemaName: string) {
  for (const catalog of catalogs) {
    const schema = catalog.schemas.find((s) => s.name === schemaName);
    if (schema) return { catalogName: catalog.name, schema };
  }
  return undefined;
}

/**
 * Ensure one fixture dataset exists, scoped to every table/view in its
 * schema. Skips (warns, does not fail) when the schema is not present yet.
 */
async function ensureDataset(
  datasets: DatasetsService,
  datasetsRepo: DatasetsRepository,
  catalogs: CatalogInfo[],
  datasourceId: string,
  fixture: FixtureDataset,
  options: Options,
): Promise<DatasetSummary> {
  const found = findSchema(catalogs, fixture.schema);
  if (!found || found.schema.tables.length === 0) {
    return {
      name: fixture.name,
      status: 'skipped',
      entityCount: 0,
      detail: `schema "${fixture.schema}" does not exist yet in ${DB_NAME} — skipping`,
    };
  }

  const tables = found.schema.tables.map(
    (table) => `${found.catalogName}.${fixture.schema}.${table.name}`,
  );
  const [existing] = await datasetsRepo.getByNames([fixture.name]);

  if (existing && !options.forceRefresh) {
    return {
      name: fixture.name,
      status: 'up-to-date',
      entityCount: existing.tables.length,
      detail: 'already registered — pass --force-refresh to re-snapshot',
    };
  }

  // Reachable only when there is no existing dataset, or --force-refresh was
  // passed (the up-to-date, no-flag case already returned above).
  if (options.dryRun) {
    return {
      name: fixture.name,
      status: 'would-create',
      entityCount: tables.length,
      detail: existing ? 'would refresh snapshot' : 'would create',
    };
  }

  // Initial entities carry columns only — `DatasetsService.save` is the same
  // code path the UI's "save dataset" action calls, and it is what adds
  // sample values (a live row read) and join hints. Reusing it here means
  // this script produces byte-identical snapshots to a human doing it by
  // hand, and any future change to enrichment logic applies here for free.
  const initialEntities: DatasetEntitySnapshot[] = found.schema.tables.map(
    (table) => ({
      key: `${found.catalogName}.${fixture.schema}.${table.name}`,
      columns: table.columns.map((column) => ({
        name: column.name,
        type: column.type,
        nullable: column.nullable,
      })),
    }),
  );

  await datasets.save({
    name: fixture.name,
    tables,
    entities: initialEntities,
    datasourceId,
  });

  return {
    name: fixture.name,
    status: existing ? 'refreshed' : 'created',
    entityCount: tables.length,
  };
}

// ---------------------------------------------------------- semantics step

/** Prefix a `schema.table` entity name with the catalog (`DB_NAME` — one Postgres database, three schemas). */
function qualifyEntity(entity: string): string {
  return `${DB_NAME}.${entity}`;
}

function qualifyEntities(entities: string[]): string[] {
  return entities.map(qualifyEntity);
}

/** Idempotent-by-`(scope.datasetId, title)` create/update of one knowledge snippet. */
async function seedKnowledgeSnippet(
  knowledge: KnowledgeService,
  existing: KnowledgeSnippet[],
  fixture: FixtureSemantics,
  snippet: SemanticKnowledgeSnippet,
  options: Options,
): Promise<SemanticsRow> {
  const item = `knowledge: ${snippet.title}`;
  const match = existing.find(
    (k) =>
      k.scope?.datasetId === fixture.datasetName && k.title === snippet.title,
  );
  const entities = qualifyEntities(snippet.entities);
  const input: KnowledgeSnippetInput = {
    kind: snippet.kind,
    scope: { datasetId: fixture.datasetName },
    title: snippet.title,
    body: snippet.body,
    ...(snippet.synonyms?.length ? { synonyms: snippet.synonyms } : {}),
    entities,
    ...(snippet.column ? { column: snippet.column } : {}),
  };

  if (!match) {
    if (options.dryRun) {
      return { fixture: fixture.datasetName, item, status: 'would-create' };
    }
    try {
      await knowledge.create(input);
      return { fixture: fixture.datasetName, item, status: 'created' };
    } catch (err) {
      return { fixture: fixture.datasetName, item, status: 'skipped', detail: message(err) };
    }
  }

  const unchanged =
    match.kind === input.kind &&
    match.body === input.body &&
    JSON.stringify(match.synonyms ?? []) === JSON.stringify(input.synonyms ?? []) &&
    JSON.stringify(match.entities ?? []) === JSON.stringify(input.entities ?? []) &&
    (match.column ?? undefined) === (input.column ?? undefined);
  if (unchanged) return { fixture: fixture.datasetName, item, status: 'unchanged' };
  if (options.dryRun) {
    return { fixture: fixture.datasetName, item, status: 'would-update' };
  }
  try {
    // Deliberately omit `enabled` from the update patch — a snippet a human
    // disabled in the app should stay disabled across re-seeding.
    await knowledge.update(match.id, input);
    return { fixture: fixture.datasetName, item, status: 'updated' };
  } catch (err) {
    return { fixture: fixture.datasetName, item, status: 'skipped', detail: message(err) };
  }
}

/** Idempotent-by-`name` create/update of one metric. */
async function seedMetric(
  metrics: MetricsService,
  existing: MetricDoc[],
  fixture: FixtureSemantics,
  metric: SemanticMetric,
  datasourceId: string | undefined,
  options: Options,
): Promise<SemanticsRow> {
  const item = `metric: ${metric.name}`;
  const match = existing.find((m) => m.name === metric.name);
  const input: MetricInput = {
    name: metric.name,
    label: metric.label,
    description: metric.description,
    entity: qualifyEntity(metric.entity),
    expression: metric.expression,
    ...(metric.dimensions?.length ? { dimensions: metric.dimensions } : {}),
    ...(datasourceId ? { datasourceId } : {}),
  };

  if (!match) {
    if (options.dryRun) {
      return { fixture: fixture.datasetName, item, status: 'would-create' };
    }
    try {
      await metrics.create(input);
      return { fixture: fixture.datasetName, item, status: 'created' };
    } catch (err) {
      return { fixture: fixture.datasetName, item, status: 'skipped', detail: message(err) };
    }
  }

  const unchanged =
    match.label === input.label &&
    (match.description ?? '') === (input.description ?? '') &&
    match.entity === input.entity &&
    match.expression === input.expression &&
    JSON.stringify(match.dimensions ?? []) === JSON.stringify(input.dimensions ?? []);
  if (unchanged) return { fixture: fixture.datasetName, item, status: 'unchanged' };
  if (options.dryRun) {
    return { fixture: fixture.datasetName, item, status: 'would-update' };
  }
  try {
    await metrics.update(match.id, input);
    return { fixture: fixture.datasetName, item, status: 'updated' };
  } catch (err) {
    return { fixture: fixture.datasetName, item, status: 'skipped', detail: message(err) };
  }
}

/** Set (idempotently) the operator-written dataset description. */
async function seedDescription(
  datasets: DatasetsService,
  currentDoc: DatasetDoc | undefined,
  fixture: FixtureSemantics,
  options: Options,
): Promise<SemanticsRow> {
  const item = 'description';
  if (!currentDoc) {
    return {
      fixture: fixture.datasetName,
      item,
      status: 'skipped',
      detail: 'dataset not registered — run without --semantics-only first',
    };
  }
  if ((currentDoc.description ?? '') === fixture.description) {
    return { fixture: fixture.datasetName, item, status: 'unchanged' };
  }
  const hadDescription = Boolean(currentDoc.description);
  if (options.dryRun) {
    return {
      fixture: fixture.datasetName,
      item,
      status: hadDescription ? 'would-update' : 'would-create',
    };
  }
  try {
    await datasets.updateDescription(fixture.datasetName, fixture.description);
    return {
      fixture: fixture.datasetName,
      item,
      status: hadDescription ? 'updated' : 'created',
    };
  } catch (err) {
    return { fixture: fixture.datasetName, item, status: 'skipped', detail: message(err) };
  }
}

/** Recompute column profiles for one fixture dataset (`--reprofile`). */
async function reprofileFixture(
  datasets: DatasetsService,
  currentDoc: DatasetDoc | undefined,
  fixture: FixtureSemantics,
  options: Options,
): Promise<SemanticsRow> {
  const item = 'reprofile';
  if (!currentDoc) {
    return {
      fixture: fixture.datasetName,
      item,
      status: 'skipped',
      detail: 'dataset not registered — run without --semantics-only first',
    };
  }
  if (options.dryRun) {
    return { fixture: fixture.datasetName, item, status: 'would-reprofile' };
  }
  try {
    await datasets.reprofile(fixture.datasetName);
    return { fixture: fixture.datasetName, item, status: 'reprofiled' };
  } catch (err) {
    return { fixture: fixture.datasetName, item, status: 'skipped', detail: message(err) };
  }
}

/**
 * Seed the full semantics document (`fixture-semantics.ts`) for every
 * fixture: description always; knowledge + metrics unless `--descriptions`
 * restricts the run to descriptions only; reprofile only when `--reprofile`
 * is passed. Every write is wrapped so a NotFoundException (dataset not
 * registered — the `--semantics-only` case) is reported as a `skipped` row
 * instead of aborting the whole run.
 */
async function seedAllSemantics(
  knowledge: KnowledgeService,
  metrics: MetricsService,
  datasets: DatasetsService,
  datasetsRepo: DatasetsRepository,
  datasourceId: string | undefined,
  options: Options,
): Promise<SemanticsRow[]> {
  const [existingKnowledge, existingMetrics, currentDocs] = await Promise.all([
    knowledge.list(),
    metrics.list(),
    datasetsRepo.getByNames(FIXTURE_SEMANTICS.map((f) => f.datasetName)),
  ]);
  const docByName = new Map(currentDocs.map((d) => [d.name, d]));

  const rows: SemanticsRow[] = [];
  for (const fixture of FIXTURE_SEMANTICS) {
    const currentDoc = docByName.get(fixture.datasetName);
    rows.push(await seedDescription(datasets, currentDoc, fixture, options));

    if (!options.descriptionsOnly) {
      for (const snippet of fixture.knowledge) {
        rows.push(
          await seedKnowledgeSnippet(knowledge, existingKnowledge, fixture, snippet, options),
        );
      }
      for (const metric of fixture.metrics) {
        rows.push(
          await seedMetric(metrics, existingMetrics, fixture, metric, datasourceId, options),
        );
      }
    }

    if (options.reprofile) {
      rows.push(await reprofileFixture(datasets, currentDoc, fixture, options));
    }
  }
  return rows;
}

// ---------------------------------------------------------------- helpers

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------- output

function printSummary(
  datasourceId: string,
  datasetSummaries: DatasetSummary[],
  options: Options,
): void {
  console.log('');
  console.log(`${options.dryRun ? '[dry-run] ' : ''}Datasource: ${DATASOURCE_NAME} (${datasourceId})`);
  if (datasetSummaries.length) {
    console.log('');
    console.log('Datasets:');
    for (const d of datasetSummaries) {
      console.log(
        `  - ${d.name}: ${d.status}${d.entityCount ? ` (${d.entityCount} entities)` : ''}` +
          (d.detail ? ` — ${d.detail}` : ''),
      );
    }
  } else {
    console.log('  (dataset step skipped — --semantics-only)');
  }
}

/** created/updated/unchanged (+ skipped/would-*) counts, then one line per item. */
function printSemanticsSummary(rows: SemanticsRow[], options: Options): void {
  console.log('');
  console.log(
    `${options.dryRun ? '[dry-run] ' : ''}Semantics (descriptions` +
      `${options.descriptionsOnly ? ' only' : ' + knowledge + metrics'}` +
      `${options.reprofile ? ' + reprofile' : ''}):`,
  );
  const counts = new Map<SemanticsRow['status'], number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  const summaryLine = Array.from(counts.entries())
    .map(([status, n]) => `${status}: ${n}`)
    .join(', ');
  console.log(`  ${summaryLine || '(nothing to seed)'}`);
  console.log('');

  let lastFixture: string | undefined;
  for (const row of rows) {
    if (row.fixture !== lastFixture) {
      console.log(`  ${row.fixture}:`);
      lastFixture = row.fixture;
    }
    console.log(`    - ${row.item}: ${row.status}${row.detail ? ` — ${row.detail}` : ''}`);
  }
  console.log('');
}

// ------------------------------------------------------------------ main

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  const logger: LogLevel[] = ['warn', 'error'];
  const app: INestApplicationContext = await NestFactory.createApplicationContext(
    AppModule,
    { logger },
  );
  try {
    const datasources = app.get(DatasourcesService);
    const datasets = app.get(DatasetsService);
    const datasetsRepo = app.get(DatasetsRepository);
    const knowledge = app.get(KnowledgeService);
    const metrics = app.get(MetricsService);

    let datasourceId: string | undefined;
    const datasetSummaries: DatasetSummary[] = [];

    if (!options.semanticsOnly) {
      const { id } = await ensureDatasource(datasources, options);
      datasourceId = id;

      const config: PostgresConfig = {
        host: DB_HOST,
        port: DB_PORT,
        database: DB_NAME,
        user: DB_USER,
        password: DB_PASSWORD,
        ssl: false,
      };
      const catalogs = await loadCatalogs(datasources, config);

      for (const fixture of FIXTURE_DATASETS) {
        const summary = await ensureDataset(
          datasets,
          datasetsRepo,
          catalogs,
          datasourceId,
          fixture,
          options,
        );
        datasetSummaries.push(summary);
        if (summary.status === 'skipped') {
          console.warn(`! ${summary.name}: ${summary.detail}`);
        }
      }
    } else {
      // Best-effort provenance for new metrics — reuse the datasource id if
      // it already exists, but never create or connect to one: the whole
      // point of --semantics-only is to work without touching Postgres.
      const existingDatasource = (await datasources.list()).find(
        (d) => d.name === DATASOURCE_NAME,
      );
      datasourceId = existingDatasource?.id;
    }

    const semanticsRows = await seedAllSemantics(
      knowledge,
      metrics,
      datasets,
      datasetsRepo,
      datasourceId,
      options,
    );

    printSummary(datasourceId ?? '(none — Postgres datasource not found)', datasetSummaries, options);
    printSemanticsSummary(semanticsRows, options);
    return 0;
  } finally {
    await app.close().catch(() => undefined);
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      if (error instanceof SetupError) {
        console.error(`\n✖ ${error.message}\n`);
      } else {
        console.error('\n✖ Fixture bootstrap crashed:');
        console.error(error);
      }
      process.exit(1);
    });
}
