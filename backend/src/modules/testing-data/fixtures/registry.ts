/**
 * The catalogue of sample datasets the app can provision for itself.
 *
 * This file is the single source of truth for what a sample *is*: where its
 * seed SQL lives, which schema it owns, what it is called once registered, and
 * which entities it must expose. Everything else — the Testing Data panel, the
 * loader service and the assistant eval suite's data preflight — reads it from
 * here, so adding a sample is one SQL file plus one entry below.
 *
 * Deliberately dependency-free (no Nest, no `pg`, no fs): both a Nest service
 * and the DI-less Mastra eval modules import it, and it must stay cheap and
 * side-effect-free for either to do so. The knowledge seeds it carries are
 * plain data modules too (`./knowledge/`).
 */

import { FINANCE_KNOWLEDGE } from './knowledge/finance';
import { GENOMICS_KNOWLEDGE } from './knowledge/genomics';
import { HEALTH_INSURANCE_KNOWLEDGE } from './knowledge/health-insurance';
import { SUPPLY_CHAIN_KNOWLEDGE } from './knowledge/supply-chain';
import type { KnowledgeSeed } from './knowledge/types';

/** Coordinates the panel prefills for a sample. */
export interface SampleFixtureDefaults {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface SampleFixture {
  /** Stable id used in URLs and by the eval sets that depend on the sample. */
  id: string;
  name: string;
  description: string;
  /**
   * Bundled seed SQL, relative to this folder. Absent = register-only: the
   * panel can point at an existing database but cannot seed it.
   */
  seedFile?: string;
  /** The schema the sample owns — what `DROP SCHEMA` targets before a seed. */
  schema: string;
  defaults: SampleFixtureDefaults;
  /** Name of the datasource record the loader creates (and reuses). */
  datasourceName: string;
  /** Name of the dataset record the loader creates (and reuses). */
  datasetName: string;
  /** Unqualified table/view names the sample must expose. THE single source. */
  requiredTables: string[];
  /**
   * The kind of datasource the sample lives behind; absent = `'postgres'`.
   * `'rest'` fixtures are register-only for the eval suite: the loader cannot
   * provision them (their datasource is created by
   * `scripts/setup-worldcup-rest.ts`), and their entities are keyed
   * `api.<schema>.<table>`. `'databricks'` fixtures are register-only too:
   * `scripts/setup-fixture-databricks.ts` loads their rows into a Unity
   * Catalog schema and registers them, and their entities are keyed
   * `<catalog>.<schema>.<table>` (`evals.world_cup.matches`).
   */
  datasourceKind?: 'postgres' | 'rest' | 'databricks';
  /**
   * A `'rest'` sample whose API this app runs itself (the embedded Intellify
   * RFP API, ADR-0027): loading it takes no connection and the loader reads
   * the API's URL and key in-process instead.
   */
  selfRegistering?: boolean;
  /**
   * Knowledge entries and metrics about the sample's data, created by the
   * loader after a successful load from the panel (testing-data R26). Only
   * the Finance, Health Insurance, Genomics and Supply Chain samples carry
   * one; World Cup deliberately has none.
   */
  knowledge?: KnowledgeSeed;
}

const WORLD_CUP: SampleFixture = {
  id: 'world-cup',
  name: 'World Cup',
  description:
    'Men’s FIFA World Cup, 2018 and 2022 — tournaments, matches, ' +
    'teams, venues, players, goals and two reporting views.',
  seedFile: '001_world_cup.sql',
  schema: 'world_cup',
  defaults: {
    host: '127.0.0.1',
    port: Number(process.env.WORLD_CUP_DB_PORT ?? 55432),
    database: 'world_cup',
    user: 'world_cup',
    // A committed dev-fixture credential (see docker-compose.yml) — carried
    // here on purpose so the panel's form prefills. Saved datasources never
    // echo theirs.
    password: 'world_cup_dev',
    ssl: false,
  },
  datasourceName: 'World Cup PostgreSQL',
  datasetName: 'World Cup',
  requiredTables: [
    'tournaments',
    'teams',
    'matches',
    'venues',
    'players',
    'goals',
    'match_team_statistics',
    'disciplinary_events',
    'v_match_results',
    'v_player_goal_totals',
  ],
};

/**
 * Every sample lives in its own database on the same PostgreSQL server, so the
 * host and port are shared and only the database name differs.
 */
const SAMPLE_HOST = '127.0.0.1';
const SAMPLE_PORT = Number(process.env.WORLD_CUP_DB_PORT ?? 55432);
/**
 * The server's superuser, created by `docker-compose.yml` for the first
 * sample — it owns the whole server, so it is also what creates and seeds
 * every later sample's database.
 */
const SAMPLE_USER = 'world_cup';
const SAMPLE_PASSWORD = 'world_cup_dev';

const FORMULA_1: SampleFixture = {
  id: 'formula-1',
  name: 'Formula 1',
  description:
    'Formula One world championship, 1950 to 2026 — seasons, drivers, ' +
    'constructors, circuits, races, standings and per-session results.',
  // Shipped gzipped: the full dump is 51 MB of SQL but 4.4 MB compressed.
  seedFile: '002_formula_1.sql.gz',
  schema: 'formula1',
  defaults: {
    host: SAMPLE_HOST,
    port: SAMPLE_PORT,
    database: 'formula1',
    user: SAMPLE_USER,
    password: SAMPLE_PASSWORD,
    ssl: false,
  },
  datasourceName: 'Formula 1 PostgreSQL',
  datasetName: 'Formula 1',
  requiredTables: [
    'chassis',
    'circuit',
    'circuit_layout',
    'constructor',
    'constructor_chronology',
    'continent',
    'country',
    'driver',
    'driver_family_relationship',
    'driver_of_the_day_result',
    'engine',
    'engine_manufacturer',
    'entrant',
    'fastest_lap',
    'free_practice_1_result',
    'free_practice_2_result',
    'free_practice_3_result',
    'free_practice_4_result',
    'grand_prix',
    'pit_stop',
    'pre_qualifying_result',
    'qualifying_1_result',
    'qualifying_2_result',
    'qualifying_result',
    'race',
    'race_constructor_standing',
    'race_data',
    'race_driver_standing',
    'race_result',
    'season',
    'season_constructor',
    'season_constructor_standing',
    'season_driver',
    'season_driver_standing',
    'season_engine_manufacturer',
    'season_entrant',
    'season_entrant_chassis',
    'season_entrant_constructor',
    'season_entrant_driver',
    'season_entrant_engine',
    'season_entrant_tyre_manufacturer',
    'season_tyre_manufacturer',
    'sprint_qualifying_result',
    'sprint_race_result',
    'sprint_starting_grid_position',
    'starting_grid_position',
    'tyre_manufacturer',
    'warming_up_result',
  ],
};

const INTELLIFY: SampleFixture = {
  id: 'intellify',
  name: 'Intellify',
  description:
    'Intellify employee-benefits data model (Halo × Marsh), synthetic data — ' +
    'clients, lines of coverage, plan designs, policies and premiums, census, ' +
    'carrier credits and point solutions.',
  // Generated by scripts/generate-intellify-seed.py; regenerate, never hand-edit.
  seedFile: '003_intellify.sql.gz',
  schema: 'intellify',
  defaults: {
    host: SAMPLE_HOST,
    port: SAMPLE_PORT,
    database: 'intellify',
    user: SAMPLE_USER,
    password: SAMPLE_PASSWORD,
    ssl: false,
  },
  datasourceName: 'Intellify PostgreSQL',
  datasetName: 'Intellify',
  requiredTables: [
    'aggregated_census_answers',
    'broker_names',
    'broking_remuneration_types',
    'carrier_credit_notifications',
    'carrier_credit_types',
    'carrier_credit_types_validations',
    'carrier_credits',
    'census_answers',
    'census_hierarchies',
    'census_plans',
    'clients',
    'contacts',
    'contribution_questions',
    'countries',
    'data_types',
    'events',
    'funding_types',
    'insurer_categories',
    'insurers',
    'lad_ancillary_fee_types',
    'lad_ancillary_fees',
    'loc_statuses',
    'mercervip_categories',
    'mercervip_products',
    'mercervip_vendors',
    'migrations',
    'national_survey',
    'pbm_names',
    'plan_design_census_plans',
    'plan_design_header_dependencies',
    'plan_design_hierarchy_types',
    'plan_designs',
    'plan_eligibility_details',
    'plan_eligibility_types',
    'plan_financial_types',
    'plan_financial_types_validations',
    'plan_states',
    'plan_types',
    'point_solutions_products',
    'policies',
    'policy_coverages',
    'policy_financials',
    'product_groups',
    'products',
    'products_hierarchies',
    'renewal_kick_off_timings',
    'renewal_reminder_notifications',
    'wizard_alternate_plans',
    'wizards',
  ],
};

/**
 * The World Cup data again, served by a local REST API instead of PostgreSQL.
 * Same tables and views, exposed as endpoints `world_cup/<table>` and so keyed
 * `api.world_cup.<table>`. Register-only: nothing here is ever seeded or
 * connected to by the Testing Data loader, so `defaults` are placeholders.
 */
const WORLD_CUP_REST: SampleFixture = {
  id: 'world-cup-rest',
  name: 'World Cup (REST API)',
  description:
    'The World Cup sample over a local REST API ' +
    "('npm run worldcup:api' serves it on http://127.0.0.1:55080).",
  datasourceKind: 'rest',
  schema: 'world_cup',
  defaults: {
    host: '127.0.0.1',
    port: 55080,
    database: '',
    user: '',
    password: '',
    ssl: false,
  },
  datasourceName: 'World Cup REST API',
  datasetName: 'World Cup (REST)',
  requiredTables: WORLD_CUP.requiredTables,
};

/**
 * The Intellify sample through the embedded Intellify RFP API: the RFP Builder
 * agent's datasource. Its tables are the API's collection endpoints, keyed
 * `api.intellify.<name>` (hyphens become underscores). Self-registering: the
 * loader reads the API's URL and key in-process; `defaults` are placeholders.
 */
const INTELLIFY_API: SampleFixture = {
  id: 'intellify-api',
  name: 'Intellify RFP API',
  description:
    'The Intellify sample through the Intellify RFP API (the embedded service ' +
    "on INTELLIFY_API_PORT, default 3100): the RFP Builder agent's " +
    'datasource, and its collection endpoints as tables.',
  datasourceKind: 'rest',
  selfRegistering: true,
  schema: 'intellify',
  defaults: {
    host: '127.0.0.1',
    port: 3100,
    database: '',
    user: '',
    password: '',
    ssl: false,
  },
  datasourceName: 'Intellify RFP API',
  datasetName: 'Intellify RFP API',
  requiredTables: [
    'clients',
    'products',
    'funding_types',
    'plan_types',
    'carriers',
    'plan_designs',
    'policies',
    'financials',
    'census',
    'rfps',
  ],
};

/**
 * The synthetic domain samples (BA-185). Each is written by a seeded generator
 * in `docker/postgres/generate/` straight into this folder, owns one schema and
 * gets its own database on the shared server, and must expose every table and
 * view of its schema. Their rows are invented: see `docs/evals/domains/`.
 */
function domainDefaults(database: string): SampleFixtureDefaults {
  return {
    host: SAMPLE_HOST,
    port: SAMPLE_PORT,
    database,
    user: SAMPLE_USER,
    password: SAMPLE_PASSWORD,
    ssl: false,
  };
}

const FINANCE: SampleFixture = {
  id: 'finance',
  name: 'Finance',
  description:
    'Synthetic retail bank and wealth manager, 2024 and 2025 — customers, ' +
    'accounts, transactions, loans, portfolios, holdings, fees and fiscal ' +
    'periods; money in cents.',
  seedFile: '007_finance.sql',
  schema: 'finance',
  defaults: domainDefaults('finance'),
  datasourceName: 'Finance PostgreSQL',
  datasetName: 'Finance',
  requiredTables: [
    'regions',
    'branches',
    'customers',
    'account_types',
    'accounts',
    'cards',
    'fx_rates',
    'transactions',
    'loans',
    'loan_payments',
    'fiscal_periods',
    'securities',
    'portfolios',
    'holdings',
    'fees',
    'v_accounts',
    'v_transactions',
  ],
  knowledge: FINANCE_KNOWLEDGE,
};

const HEALTH_INSURANCE: SampleFixture = {
  id: 'health-insurance',
  name: 'Health Insurance',
  description:
    'Synthetic health insurer, claims of 2024 and 2025 — members, plans, ' +
    'providers, claims, claim lines and denials; money in cents.',
  seedFile: '004_health_insurance.sql',
  schema: 'health_insurance',
  defaults: domainDefaults('health_insurance'),
  datasourceName: 'Health Insurance PostgreSQL',
  datasetName: 'Health Insurance',
  requiredTables: [
    'countries',
    'states',
    'regions',
    'plans',
    'members',
    'providers',
    'denial_reasons',
    'claims',
    'claim_lines',
    'claim_denials',
    'v_claim_financials',
    'v_member_claim_totals',
  ],
  knowledge: HEALTH_INSURANCE_KNOWLEDGE,
};

const GENOMICS: SampleFixture = {
  id: 'genomics',
  name: 'Genomics',
  description:
    'Synthetic clinical-genomics cohort, samples of 2023 and 2024 — ' +
    'subjects, samples, genes, variants, variant calls, expression and ' +
    'phenotypes. Invented data, never for clinical use.',
  seedFile: '005_genomics.sql',
  schema: 'genomics',
  defaults: domainDefaults('genomics'),
  datasourceName: 'Genomics PostgreSQL',
  datasetName: 'Genomics',
  requiredTables: [
    'superpopulations',
    'ancestry_groups',
    'genes',
    'transcripts',
    'subjects',
    'samples',
    'variants',
    'variant_calls',
    'gene_expression',
    'phenotypes',
    'subject_phenotypes',
    'v_variant_calls',
    'v_sample_qc',
  ],
  knowledge: GENOMICS_KNOWLEDGE,
};

const SUPPLY_CHAIN: SampleFixture = {
  id: 'supply-chain',
  name: 'Supply Chain',
  description:
    'Synthetic industrial distributor, purchase orders of 2024 and 2025 — ' +
    'suppliers, products, warehouses, purchase orders, shipments, receipts ' +
    'and inventory; money in cents.',
  seedFile: '006_supply_chain.sql',
  schema: 'supply_chain',
  defaults: domainDefaults('supply_chain'),
  datasourceName: 'Supply Chain PostgreSQL',
  datasetName: 'Supply Chain',
  requiredTables: [
    'regions',
    'warehouses',
    'suppliers',
    'product_categories',
    'products',
    'carriers',
    'purchase_orders',
    'purchase_order_lines',
    'shipments',
    'receipts',
    'inventory_snapshots',
    'v_purchase_order_lines',
    'v_shipments',
    'v_receipts',
  ],
  knowledge: SUPPLY_CHAIN_KNOWLEDGE,
};

const MARKETING_ANALYTICS: SampleFixture = {
  id: 'marketing-analytics',
  name: 'Marketing Analytics',
  description:
    'Synthetic market-insight product for six insurance carriers, 2024 and ' +
    '2025 — policy sales by quarter, revenue by period, campaigns and a ' +
    'benchmark with masked competitors; money in cents.',
  seedFile: '008_marketing_analytics.sql',
  schema: 'marketing_analytics',
  defaults: domainDefaults('marketing_analytics'),
  datasourceName: 'Marketing Analytics PostgreSQL',
  datasetName: 'Marketing Analytics',
  requiredTables: [
    'regions',
    'states',
    'carriers',
    'lines_of_business',
    'products',
    'channels',
    'periods',
    'policy_sales',
    'revenue_by_period',
    'campaigns',
    'campaign_results',
    'market_benchmarks',
    'competitor_masks',
    'analyst_access',
  ],
};

/**
 * The finance and marketing-analytics samples again, served from their dumps
 * by the local REST API (`serve.ts --fixture <id>`, BA-187), so the same rows
 * sit behind PostgreSQL and REST (ADR-0015). Register-only like the World Cup
 * REST sample: `scripts/setup-fixture-rest.ts` creates the datasource and
 * dataset, and `defaults` are placeholders.
 */
function restDefaults(port: number): SampleFixtureDefaults {
  return {
    host: '127.0.0.1',
    port,
    database: '',
    user: '',
    password: '',
    ssl: false,
  };
}

const FINANCE_REST: SampleFixture = {
  id: 'finance-rest',
  name: 'Finance (REST API)',
  description:
    'The Finance sample over a local REST API ' +
    "('npm run finance:api' serves it on http://127.0.0.1:55081).",
  datasourceKind: 'rest',
  schema: FINANCE.schema,
  defaults: restDefaults(55081),
  datasourceName: 'Finance REST API',
  datasetName: 'Finance (REST)',
  requiredTables: FINANCE.requiredTables,
};

const MARKETING_ANALYTICS_REST: SampleFixture = {
  id: 'marketing-analytics-rest',
  name: 'Marketing Analytics (REST API)',
  description:
    'The Marketing Analytics sample over a local REST API ' +
    "('npm run marketing-analytics:api' serves it on http://127.0.0.1:55082).",
  datasourceKind: 'rest',
  schema: MARKETING_ANALYTICS.schema,
  defaults: restDefaults(55082),
  datasourceName: 'Marketing Analytics REST API',
  datasetName: 'Marketing Analytics (REST)',
  requiredTables: MARKETING_ANALYTICS.requiredTables,
};

/**
 * The World Cup REST API started with the `connector` profile (BA-187): the
 * REST-only eval set needs its extra endpoints, so they are required here and
 * the preflight refuses a dataset of the plain API. One server per paging
 * style (ports 55090 to 55093); the names are those of its `page` variant.
 */
const WORLD_CUP_REST_CONNECTOR: SampleFixture = {
  id: 'world-cup-rest-connector',
  name: 'World Cup (REST API, connector profile)',
  description:
    'The World Cup sample over a local REST API with the connector profile ' +
    "('REST_API_PROFILE=connector npm run worldcup:api', one server per paging style).",
  datasourceKind: 'rest',
  schema: WORLD_CUP.schema,
  defaults: restDefaults(55090),
  datasourceName: 'World Cup REST API (page)',
  datasetName: 'World Cup (REST page)',
  requiredTables: [
    ...WORLD_CUP.requiredTables,
    'tournament_teams',
    'squad_members',
    'matches_nested',
  ],
};

/**
 * The Unity Catalog catalog the Databricks samples live in by default, and the
 * one their reference queries name in the set files
 * (`` `evals`.world_cup.matches ``). A sample loaded into another catalog
 * still runs: the references are rewritten to the catalog of the selected
 * datasets when they run (agents-evals R192).
 */
export const DATABRICKS_FIXTURE_CATALOG = 'evals';

/**
 * World Cup, finance and marketing analytics again, in a Databricks Unity
 * Catalog schema (`evals.<schema>`), loaded from the same JSON dumps as the
 * REST samples so the rows are identical on every kind (ADR-0015, BA-186).
 * Register-only: `scripts/setup-fixture-databricks.ts --fixture <id>` loads
 * the rows and registers the datasource and dataset in a running backend;
 * the Testing Data panel refuses them, and `defaults` are placeholders (the
 * catalog as the database).
 */
function databricksFixture(source: SampleFixture): SampleFixture {
  return {
    id: `${source.id}-databricks`,
    name: `${source.name} (Databricks)`,
    description:
      `The ${source.name} sample in a Databricks Unity Catalog schema ` +
      `(${DATABRICKS_FIXTURE_CATALOG}.${source.schema}), loaded from its JSON dump by ` +
      `'npm run fixture:databricks -- --fixture ${source.id}'.`,
    datasourceKind: 'databricks',
    schema: source.schema,
    defaults: {
      host: '',
      port: 443,
      database: DATABRICKS_FIXTURE_CATALOG,
      user: '',
      password: '',
      ssl: true,
    },
    datasourceName: `${source.name} Databricks`,
    datasetName: `${source.name} (Databricks)`,
    requiredTables: source.requiredTables,
  };
}

const WORLD_CUP_DATABRICKS = databricksFixture(WORLD_CUP);
const FINANCE_DATABRICKS = databricksFixture(FINANCE);
const MARKETING_ANALYTICS_DATABRICKS = databricksFixture(MARKETING_ANALYTICS);

/** Every sample the app knows how to provision, in panel order. */
export const SAMPLE_FIXTURES: SampleFixture[] = [
  WORLD_CUP,
  FORMULA_1,
  INTELLIFY,
  WORLD_CUP_REST,
  INTELLIFY_API,
  FINANCE,
  HEALTH_INSURANCE,
  GENOMICS,
  SUPPLY_CHAIN,
  MARKETING_ANALYTICS,
  FINANCE_REST,
  MARKETING_ANALYTICS_REST,
  WORLD_CUP_REST_CONNECTOR,
  WORLD_CUP_DATABRICKS,
  FINANCE_DATABRICKS,
  MARKETING_ANALYTICS_DATABRICKS,
];

export function findFixture(id: string): SampleFixture | undefined {
  return SAMPLE_FIXTURES.find((fixture) => fixture.id === id);
}

/**
 * The PostgreSQL sample a Databricks sample is loaded from, whose dump and
 * seed hold its rows and types: `world-cup` for `world-cup-databricks`.
 * Undefined for any other sample.
 */
export function databricksSource(
  fixture: SampleFixture,
): SampleFixture | undefined {
  if (fixture.datasourceKind !== 'databricks') return undefined;
  return findFixture(fixture.id.replace(/-databricks$/, ''));
}

/**
 * The `schema.table` names a sample must expose. Datasets are compared on the
 * last two segments of a key, so this is the shape both the loader and the
 * eval preflight match against.
 */
export function requiredEntities(fixture: SampleFixture): string[] {
  return fixture.requiredTables.map((table) => `${fixture.schema}.${table}`);
}

/**
 * Fully qualified inventory keys for a sample in a given database. Postgres
 * inventory keys are `catalog.schema.table` and the catalog is the database
 * name — which the user chooses, so the keys are derived per load.
 */
export function requiredEntityKeys(
  fixture: SampleFixture,
  database: string,
): string[] {
  return requiredEntities(fixture).map((entity) => `${database}.${entity}`);
}
