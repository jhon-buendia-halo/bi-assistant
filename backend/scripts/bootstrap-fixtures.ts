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
 *      `genomics`, `hr`, `retail`), discovering the entity list from the
 *      datasource's own inventory rather than hard-coding table names.
 *   3. Seed the curated knowledge/metric entries that traps H9/H10 (health
 *      insurance), G9/G10 (genomics) and HR1-HR10 (hr) explicitly depend on
 *      existing, and the retail glossary — which deliberately leaves out the
 *      two facts the learning demo teaches (see `retailKnowledge`).
 *
 * Run with `npm run fixtures:register` from `backend/`.
 *
 * Boots the backend as a Nest standalone application context (no HTTP),
 * exactly like `run-eval.ts` — see that file for the pattern this mirrors.
 */
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
import type { DatasetEntitySnapshot } from '../src/modules/datasets/repositories/datasets.repository';
import { KnowledgeService } from '../src/modules/knowledge/knowledge.service';
import type { KnowledgeSnippetInput } from '../src/modules/knowledge/entities/knowledge-snippet.entity';
import { MetricsService } from '../src/modules/metrics/metrics.service';
import type { MetricInput } from '../src/modules/metrics/entities/metric.entity';

/** A misconfiguration the operator must fix — reported without a stack trace. */
class SetupError extends Error {}

// ------------------------------------------------------------- constants

const DATASOURCE_NAME = 'Fixtures (local Postgres)';
// Mirrors docker-compose.yml exactly: same default port, same override var,
// same fixed dev credentials (never a secret worth protecting further).
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
  { name: 'HR', schema: 'hr' },
  { name: 'Retail', schema: 'retail' },
];

// ------------------------------------------------------- HR curated context

/** Saved dataset name the HR knowledge is scoped to (`scope.datasetId`). */
const HR_DATASET = 'HR';

/**
 * The HR fixture's business glossary (traps HR1-HR10 in
 * docs/evals/synthetic-domains.md). Facts about the data and the company's
 * definitions only — never a hint that answers one eval question.
 *
 * Budget: `KnowledgeService.contextFor` gives the whole knowledge block 8,000
 * chars (default filters first, then learned lessons) and skips an entry that
 * does not fit; these seven lines are ~1,150 chars as formatted (`- [kind]
 * title: body; synonyms: …; entities: …`), well inside it.
 */
function hrKnowledge(db: string): KnowledgeSnippetInput[] {
  const scope = { datasetId: HR_DATASET };
  return [
    {
      kind: 'default_filter',
      scope,
      title: 'Employees only',
      body:
        "Headcount and pay figures cover employment_type = 'employee'; " +
        'exclude contractor and intern rows unless asked.',
      entities: [`${db}.hr.employees`],
    },
    {
      kind: 'default_filter',
      scope,
      title: 'Active as of a date',
      body:
        'Headcount at a date = hired_on <= date AND (terminated_on IS NULL ' +
        'OR terminated_on > date).',
      entities: [`${db}.hr.employees`],
    },
    {
      kind: 'term',
      scope,
      title: 'Tech employees',
      body:
        'Employees whose department is in the Technology division ' +
        '(Engineering, Data Platform, IT & Security); job family does not ' +
        'define it.',
      synonyms: ['tech', 'technology'],
    },
    {
      kind: 'term',
      scope,
      title: 'Salary',
      body:
        'Annual base pay from salary_history only, bonuses excluded. A ' +
        "year's salary is the row effective on 31 December: effective_from " +
        '<= date AND (effective_to IS NULL OR effective_to > date).',
      entities: [`${db}.hr.salary_history`],
    },
    {
      kind: 'term',
      scope,
      title: 'Local currency',
      body:
        "Amounts are in the employee's location currency; convert with " +
        "exchange_rates.rate_to_usd for the same year (a bonus's " +
        'fiscal_year) to report USD.',
      entities: [`${db}.hr.exchange_rates`],
    },
    {
      kind: 'term',
      scope,
      title: 'Top performer',
      body: 'Performance rating 4 or 5 on the 1-5 scale (5 is best).',
    },
    {
      kind: 'term',
      scope,
      title: 'Total compensation',
      body: 'Base salary for the year plus bonuses paid for that fiscal year.',
    },
  ];
}

/** The HR fixture's governed metrics; `datasourceId` is filled in at seed time. */
function hrMetrics(db: string): Omit<MetricInput, 'datasourceId'>[] {
  return [
    {
      name: 'avg_base_salary_usd',
      label: 'Average base salary (USD)',
      description:
        'One salary_history row per employee: the row effective on ' +
        '31 December of the year, joined to exchange_rates on currency and ' +
        'that year. Bonuses excluded.',
      entity: `${db}.hr.salary_history`,
      expression:
        'AVG(salary_history.annual_base_amount * exchange_rates.rate_to_usd)',
    },
    {
      name: 'attrition_rate',
      label: 'Attrition rate',
      description:
        'Employees terminated during the year divided by active headcount ' +
        'on 1 January of that year (:year_start). A ratio; multiply by 100 ' +
        'for a percentage.',
      entity: `${db}.hr.employees`,
      expression:
        'COUNT(*) FILTER (WHERE terminated_on >= :year_start AND terminated_on < :next_year_start)::numeric / ' +
        'NULLIF(COUNT(*) FILTER (WHERE hired_on <= :year_start AND (terminated_on IS NULL OR terminated_on > :year_start)), 0)',
    },
    {
      name: 'total_compensation_usd',
      label: 'Total compensation (USD)',
      description:
        'Per employee and year: the salary_history row effective on ' +
        '31 December plus fy_bonus.amount = SUM(bonus_payments.amount) for ' +
        "that fiscal_year, converted at exchange_rates for the employee's " +
        'currency and that year. Aggregate with AVG or SUM as asked.',
      entity: `${db}.hr.salary_history`,
      expression:
        '(salary_history.annual_base_amount + COALESCE(fy_bonus.amount, 0)) * exchange_rates.rate_to_usd',
    },
  ];
}

// --------------------------------------------------- Retail curated context

/** Saved dataset name the Retail knowledge is scoped to (`scope.datasetId`). */
const RETAIL_DATASET = 'Retail';

/**
 * The Retail fixture's glossary: facts about the data only. It deliberately
 * says nothing about the fiscal calendar or what "net revenue" means, and no
 * metric is seeded — those two facts are the tribal knowledge the learning
 * demo's reviewer notes teach (`learningScenario` on `net-revenue-fy2025` in
 * `suites/retail.json`). Seeding either would answer the trap question before
 * anyone taught it, which is the overfitting rule's failure in reverse.
 */
function retailKnowledge(db: string): KnowledgeSnippetInput[] {
  const scope = { datasetId: RETAIL_DATASET };
  return [
    {
      kind: 'default_filter',
      scope,
      title: 'Completed orders only',
      body:
        "Revenue, order counts and units cover orders with status = 'completed'; " +
        'cancelled orders never count unless the question is about cancellations.',
      entities: [`${db}.retail.orders`],
    },
    {
      kind: 'term',
      scope,
      title: 'Order date',
      body:
        'ordered_at is the date the order was placed — the only date on an ' +
        'order and the one every period question uses.',
    },
    {
      kind: 'term',
      scope,
      title: 'Units',
      body: 'order_lines.quantity; an order has one line per product.',
      entities: [`${db}.retail.order_lines`],
    },
    {
      kind: 'term',
      scope,
      title: 'Line discount',
      body:
        'order_lines.discount_amount is the money taken off that line at ' +
        'checkout, 0 when none.',
    },
    {
      kind: 'instruction',
      scope,
      title: 'Coverage',
      body: 'Orders run from 2024-01-01 to 2026-03-31; every amount is in USD.',
    },
  ];
}

// ------------------------------------------------------------------ cli

interface Options {
  dryRun: boolean;
  forceRefresh: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { dryRun: false, forceRefresh: false };
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force-refresh') options.forceRefresh = true;
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
      '  --dry-run        print what would change, touch nothing',
      '  --force-refresh  re-snapshot datasets that already exist',
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

interface KnowledgeSummary {
  label: string;
  status: 'created' | 'skipped' | 'would-create';
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
): Promise<{ id: string; created: boolean; repointed: boolean }> {
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
  if (existing) {
    // Reusing by name alone would keep a datasource that points at a stack
    // that is no longer there — another WORLD_CUP_DB_PORT, or an isolated
    // `docker compose -p …` project — and every snapshot below would then
    // silently lose its sample values. Repoint it at the database just
    // verified instead.
    const current = existing.config as Partial<PostgresConfig>;
    const moved =
      existing.kind !== 'postgres' ||
      current.host !== config.host ||
      Number(current.port) !== config.port ||
      current.database !== config.database;
    if (!moved || options.dryRun) {
      return { id: existing.id, created: false, repointed: moved };
    }
    await datasources.save({
      id: existing.id,
      name: DATASOURCE_NAME,
      kind: 'postgres',
      config,
    });
    return { id: existing.id, created: false, repointed: true };
  }

  if (options.dryRun) {
    return { id: '(dry-run: not created)', created: true, repointed: false };
  }
  const saved = await datasources.save({
    name: DATASOURCE_NAME,
    kind: 'postgres',
    config,
  });
  return { id: saved.id, created: true, repointed: false };
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
 * schema. Skips (warns, does not fail) when the schema is not present yet —
 * the health-insurance and genomics generators are a parallel unit's work
 * and may not have run when this is first tried.
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

// ----------------------------------------------------------- knowledge step

interface CuratedEntry {
  label: string;
  /** Which existing-entries pool `matches` should be checked against. */
  pool: 'metric' | 'knowledge';
  datasetReady: boolean;
  /** True when an equivalent entry (by kind + scope + title) already exists. */
  matches: (existing: { kind: string; title: string; scope: unknown }) => boolean;
  create: () => Promise<void>;
}

function sameScope(
  a: { datasetId?: string } | null | undefined,
  datasetId: string,
): boolean {
  return (a?.datasetId ?? '') === datasetId;
}

/** Create (or report as already present / would-create) one curated entry. */
async function ensureEntry(
  entry: CuratedEntry,
  existingList: { kind: string; title: string; scope: unknown }[],
  options: Options,
): Promise<KnowledgeSummary> {
  const already = existingList.some((e) => entry.matches(e));
  if (already) return { label: entry.label, status: 'skipped' };
  if (options.dryRun) return { label: entry.label, status: 'would-create' };
  await entry.create();
  return { label: entry.label, status: 'created' };
}

/**
 * Seed the curated knowledge/metrics the health-insurance, genomics and HR
 * trap catalogues (H9/H10, G9/G10, HR1-HR10 in
 * docs/evals/synthetic-domains.md) explicitly depend on, plus the Retail
 * glossary (facts only — see `retailKnowledge`). Column names are taken from that design doc: at the time this
 * script was written, `docker/postgres/init/002_health_insurance.sql` and
 * `003_genomics.sql` did not exist yet (a parallel unit generates them), so
 * these names should be re-checked against the real init scripts once they
 * land — see the report for exactly which ones to verify.
 */
async function seedCuratedContext(
  knowledge: KnowledgeService,
  metrics: MetricsService,
  datasourceId: string,
  db: string,
  datasetReady: {
    healthInsurance: boolean;
    genomics: boolean;
    hr: boolean;
    retail: boolean;
  },
  options: Options,
): Promise<KnowledgeSummary[]> {
  const [existingKnowledge, existingMetrics] = await Promise.all([
    knowledge.list(),
    metrics.list(),
  ]);
  const existingMetricRows = existingMetrics.map((m) => ({
    kind: 'metric',
    title: m.name,
    scope: { datasetId: m.entity },
  }));

  const entries: CuratedEntry[] = [
    // --- Health Insurance (H9: metric definition, H10: default filter) ---
    {
      label: 'metric: net paid (Health Insurance)',
      pool: 'metric',
      datasetReady: datasetReady.healthInsurance,
      matches: (e) => e.kind === 'metric' && e.title === 'net_paid',
      create: async () => {
        const input: MetricInput = {
          name: 'net_paid',
          label: 'Net paid',
          description:
            'Gross paid minus reversed claims. REVERSED rows carry a positive ' +
            'paid_amount_cents that must be subtracted, not summed.',
          entity: `${db}.health_insurance.claims`,
          datasourceId,
          expression:
            "SUM(paid_amount_cents) FILTER (WHERE status='PAID') - SUM(paid_amount_cents) FILTER (WHERE status='REVERSED')",
        };
        await metrics.create(input);
      },
    },
    {
      label: 'knowledge: exclude test claims (Health Insurance)',
      pool: 'knowledge',
      datasetReady: datasetReady.healthInsurance,
      matches: (e) =>
        e.kind === 'default_filter' &&
        e.title === 'Exclude test claims' &&
        sameScope(e.scope as { datasetId?: string }, 'Health Insurance'),
      create: async () => {
        const input: KnowledgeSnippetInput = {
          kind: 'default_filter',
          scope: { datasetId: 'Health Insurance' },
          title: 'Exclude test claims',
          body:
            'Unless the question explicitly asks about test data, exclude ' +
            'claims where is_test = true from every claims aggregate.',
          entities: [`${db}.health_insurance.claims`],
        };
        await knowledge.create(input);
      },
    },
    {
      label: 'knowledge: amounts are in cents (Health Insurance)',
      pool: 'knowledge',
      datasetReady: datasetReady.healthInsurance,
      matches: (e) =>
        e.kind === 'term' &&
        e.title === 'Amounts are stored in cents' &&
        sameScope(e.scope as { datasetId?: string }, 'Health Insurance'),
      create: async () => {
        const input: KnowledgeSnippetInput = {
          kind: 'term',
          scope: { datasetId: 'Health Insurance' },
          title: 'Amounts are stored in cents',
          body:
            'billed_amount_cents, allowed_amount_cents, paid_amount_cents and ' +
            'member_responsibility_cents are integer cents, not dollars — ' +
            'divide by 100 to report a dollar figure.',
          synonyms: ['cents', 'dollars'],
          entities: [`${db}.health_insurance.claims`],
        };
        await knowledge.create(input);
      },
    },
    // --- Genomics (G9: metric definition, G10: default filter) ---
    {
      label: 'metric: allele fraction (Genomics)',
      pool: 'metric',
      datasetReady: datasetReady.genomics,
      matches: (e) => e.kind === 'metric' && e.title === 'allele_fraction',
      create: async () => {
        const input: MetricInput = {
          name: 'allele_fraction',
          label: 'Allele fraction',
          description:
            'Mean fraction of reads supporting the alternate allele, restricted ' +
            "to confidently-called genotypes (filter_status='PASS', depth >= 20).",
          entity: `${db}.genomics.variant_calls`,
          datasourceId,
          expression:
            "AVG(alt_read_count::numeric / NULLIF(total_read_count, 0)) FILTER (WHERE filter_status = 'PASS' AND total_read_count >= 20)",
        };
        await metrics.create(input);
      },
    },
    {
      label: 'knowledge: exclude control samples (Genomics)',
      pool: 'knowledge',
      datasetReady: datasetReady.genomics,
      matches: (e) =>
        e.kind === 'default_filter' &&
        e.title === 'Exclude control samples' &&
        sameScope(e.scope as { datasetId?: string }, 'Genomics'),
      create: async () => {
        const input: KnowledgeSnippetInput = {
          kind: 'default_filter',
          scope: { datasetId: 'Genomics' },
          title: 'Exclude control samples',
          body:
            'Unless the question explicitly asks about control samples, ' +
            'exclude samples where is_control = true from cohort counts and ' +
            'aggregates.',
          entities: [`${db}.genomics.samples`],
        };
        await knowledge.create(input);
      },
    },
    {
      label: 'knowledge: genotype 0/0 is not a carrier (Genomics)',
      pool: 'knowledge',
      datasetReady: datasetReady.genomics,
      matches: (e) =>
        e.kind === 'term' &&
        e.title === 'Genotype 0/0 is not a carrier' &&
        sameScope(e.scope as { datasetId?: string }, 'Genomics'),
      create: async () => {
        const input: KnowledgeSnippetInput = {
          kind: 'term',
          scope: { datasetId: 'Genomics' },
          title: 'Genotype 0/0 is not a carrier',
          body:
            'variant_calls.genotype = \'0/0\' is homozygous reference — the ' +
            'sample does NOT carry the variant. Only genotypes with at least ' +
            'one alt allele (e.g. 0/1, 1/1) count as carrying it.',
          synonyms: ['carrier', 'homozygous reference'],
          entities: [`${db}.genomics.variant_calls`],
        };
        await knowledge.create(input);
      },
    },
    // --- HR (HR1-HR10: division vs job family, the 31 December salary row,
    // employees-only and active-at-date filters, currency conversion) ---
    ...hrKnowledge(db).map(
      (input): CuratedEntry => ({
        label: `knowledge: ${input.title.toLowerCase()} (HR)`,
        pool: 'knowledge',
        datasetReady: datasetReady.hr,
        matches: (e) =>
          e.kind === input.kind &&
          e.title === input.title &&
          sameScope(e.scope as { datasetId?: string }, HR_DATASET),
        create: async () => {
          await knowledge.create(input);
        },
      }),
    ),
    ...hrMetrics(db).map(
      (input): CuratedEntry => ({
        label: `metric: ${input.name} (HR)`,
        pool: 'metric',
        datasetReady: datasetReady.hr,
        matches: (e) => e.kind === 'metric' && e.title === input.name,
        create: async () => {
          await metrics.create({ ...input, datasourceId });
        },
      }),
    ),
    // --- Retail (facts only; the fiscal year and net revenue are taught) ---
    ...retailKnowledge(db).map(
      (input): CuratedEntry => ({
        label: `knowledge: ${input.title.toLowerCase()} (Retail)`,
        pool: 'knowledge',
        datasetReady: datasetReady.retail,
        matches: (e) =>
          e.kind === input.kind &&
          e.title === input.title &&
          sameScope(e.scope as { datasetId?: string }, RETAIL_DATASET),
        create: async () => {
          await knowledge.create(input);
        },
      }),
    ),
  ];

  const results: KnowledgeSummary[] = [];
  for (const entry of entries) {
    if (!entry.datasetReady) {
      results.push({ label: entry.label, status: 'skipped' });
      continue;
    }
    const pool =
      entry.pool === 'metric'
        ? existingMetricRows
        : existingKnowledge.map((k) => ({
            kind: k.kind,
            title: k.title,
            scope: k.scope,
          }));
    results.push(await ensureEntry(entry, pool, options));
  }
  return results;
}

// ---------------------------------------------------------------- helpers

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------- output

function printSummary(
  datasourceId: string,
  datasetSummaries: DatasetSummary[],
  knowledgeSummaries: KnowledgeSummary[],
  options: Options,
): void {
  console.log('');
  console.log(`${options.dryRun ? '[dry-run] ' : ''}Datasource: ${DATASOURCE_NAME} (${datasourceId})`);
  console.log('');
  console.log('Datasets:');
  for (const d of datasetSummaries) {
    console.log(
      `  - ${d.name}: ${d.status}${d.entityCount ? ` (${d.entityCount} entities)` : ''}` +
        (d.detail ? ` — ${d.detail}` : ''),
    );
  }
  console.log('');
  console.log('Curated context:');
  for (const k of knowledgeSummaries) {
    console.log(`  - ${k.label}: ${k.status}`);
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

    const { id: datasourceId, repointed } = await ensureDatasource(
      datasources,
      options,
    );
    if (repointed) {
      console.log(
        `${options.dryRun ? '[dry-run] would repoint' : 'Repointed'} ${DATASOURCE_NAME} at ` +
          `${DB_HOST}:${DB_PORT}/${DB_NAME}; re-snapshotting its datasets.`,
      );
      // Snapshots taken against the old location carry its sample values
      // (or none, if it was unreachable), so they are refreshed too.
      options.forceRefresh = true;
    }

    const config: PostgresConfig = {
      host: DB_HOST,
      port: DB_PORT,
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASSWORD,
      ssl: false,
    };
    const catalogs = await loadCatalogs(datasources, config);

    const datasetSummaries: DatasetSummary[] = [];
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

    const datasetReady = {
      healthInsurance:
        datasetSummaries.find((d) => d.name === 'Health Insurance')
          ?.status !== 'skipped',
      genomics:
        datasetSummaries.find((d) => d.name === 'Genomics')?.status !==
        'skipped',
      hr:
        datasetSummaries.find((d) => d.name === HR_DATASET)?.status !==
        'skipped',
      retail:
        datasetSummaries.find((d) => d.name === RETAIL_DATASET)?.status !==
        'skipped',
    };

    const knowledgeSummaries = await seedCuratedContext(
      knowledge,
      metrics,
      datasourceId,
      DB_NAME,
      datasetReady,
      options,
    );

    printSummary(datasourceId, datasetSummaries, knowledgeSummaries, options);
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
