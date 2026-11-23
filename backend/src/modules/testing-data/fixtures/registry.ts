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
 * side-effect-free for either to do so.
 */

/** Coordinates the panel prefills for a sample. */
export interface SampleFixtureDefaults {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

/** One schema of a multi-schema sample, with the layer it plays. */
export interface SampleLayerSchema {
  name: string;
  layer: 'landing' | 'normalized' | 'consumption';
  description: string;
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
  /**
   * Optional: a sample that owns several schemas (a medallion sample). The
   * loader drops every one before seeding, registers every entity of them and
   * saves a schema note (layer and description) per schema. `requiredTables`
   * is then qualified (`schema.table`), and `schema` names the primary one.
   * Absent = the sample owns just `schema`, exactly as before.
   */
  layerSchemas?: SampleLayerSchema[];
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
   * `api.<schema>.<table>`.
   */
  datasourceKind?: 'postgres' | 'rest' | 'file';
  /**
   * A `'file'` sample: the files it copies into the app, in a folder next to
   * this one. Loaded through the upload (api.md 156) and save (18) code path,
   * so no database server is involved. `requiredTables` are then qualified
   * `<file schema>.<table>` (the file name without its extension, then the
   * sheet's table), keyed `file.<schema>.<table>`.
   */
  files?: { dir: string; names: string[] };
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
    'Intellify employee-benefits data model, synthetic data — ' +
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
    'marketplace_categories',
    'marketplace_products',
    'marketplace_vendors',
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

const US_HEALTH: SampleFixture = {
  id: 'us-health',
  name: 'US Health',
  description:
    'A US health & benefits consultancy, synthetic data — clients and ' +
    'consulting revenue, plans and renewals, members and claims, benchmarks, ' +
    'employee surveys, life/absence/disability and strategy.',
  // Generated by scripts/generate-us-health-seed.py; regenerate, never hand-edit.
  seedFile: '004_us_health.sql.gz',
  schema: 'us_health',
  defaults: {
    host: SAMPLE_HOST,
    port: SAMPLE_PORT,
    database: 'us_health',
    user: SAMPLE_USER,
    password: SAMPLE_PASSWORD,
    ssl: false,
  },
  datasourceName: 'US Health PostgreSQL',
  datasetName: 'US Health',
  requiredTables: [
    'offices',
    'service_lines',
    'colleagues',
    'clients',
    'engagements',
    'revenue',
    'deliverables',
    'carriers',
    'plans',
    'plan_provisions',
    'plan_rates',
    'renewals',
    'stop_loss_contracts',
    'employees',
    'members',
    'enrollments',
    'medical_claims',
    'rx_claims',
    'benchmark_sources',
    'peer_groups',
    'benchmark_measures',
    'benchmark_values',
    'surveys',
    'survey_questions',
    'survey_respondents',
    'survey_responses',
    'survey_comments',
    'survey_norms',
    'lad_programs',
    'lad_experience',
    'disability_claims',
    'leave_cases',
    'state_leave_laws',
    'client_leave_policies',
    'client_goals',
    'trend_assumptions',
    'strategy_options',
    'roadmap_items',
    'point_solutions',
    'client_point_solutions',
    'data_feeds',
    'v_monthly_cost',
    'v_large_claimants',
    'v_lad_loss_ratio',
    'v_client_revenue',
  ],
};

/**
 * A retail store built to break things: a million-row table, awkward names,
 * awkward values and every data-quality problem the readiness engine scores.
 * Each edge case and where it lives is listed in the testing-data spec.
 */
const EDGE_CASES: SampleFixture = {
  id: 'edge-cases',
  name: 'Edge Cases',
  description:
    'An e-commerce store built to break things, synthetic data — ' +
    '1,000,000 order lines, a 65-column table, an empty and a one-row table, ' +
    'odd column names (spaces, MixedCase, reserved words, accents, %), ' +
    'NULLs, NaN, huge numbers, far dates, duplicates, orphans, invalid ' +
    'emails and phones, inconsistent spellings, outliers and ranking ties.',
  // Plain SQL that generates its rows with generate_series and md5-based
  // expressions, so every load holds the same data; hand-maintained.
  seedFile: '005_edge_cases.sql',
  schema: 'edge_cases',
  defaults: {
    host: SAMPLE_HOST,
    port: SAMPLE_PORT,
    database: 'edge_cases',
    user: SAMPLE_USER,
    password: SAMPLE_PASSWORD,
    ssl: false,
  },
  datasourceName: 'Edge Cases PostgreSQL',
  datasetName: 'Edge Cases',
  requiredTables: [
    'store_settings',
    'categories',
    'customers',
    'customer_profile_wide',
    'products',
    'promotions',
    'orders',
    'order_lines',
    'payments',
    'shipments',
    'returns',
    'reviews',
    'inventory_snapshots',
    'gift_cards',
    'LegacyOrders',
    'v_order_totals',
    'v_customer_ltv',
    'v_product_revenue',
    'mv_daily_sales',
  ],
};

/**
 * An omnichannel retailer built to evaluate the Insights Analyst on a complex
 * dataset: a fiscal calendar, currencies, a price history, a category tree,
 * refunds, targets and a web funnel, with planted traps (ties, duplicates,
 * closed stores, a time zone boundary, an empty table). Every trap is listed in
 * the testing-data spec. Hand-maintained plain SQL, deterministic.
 */
const RETAIL_OPS: SampleFixture = {
  id: 'retail-ops',
  name: 'Retail Ops',
  description:
    'An omnichannel retailer in 8 countries and 6 currencies, synthetic data, ' +
    '2022 to 2024 — orders and lines, returns and refunds, promotions, price ' +
    'history, revenue targets, a fiscal calendar and a web funnel.',
  seedFile: '007_retail_ops.sql',
  schema: 'retail_ops',
  defaults: {
    host: SAMPLE_HOST,
    port: SAMPLE_PORT,
    database: 'retail_ops',
    user: SAMPLE_USER,
    password: SAMPLE_PASSWORD,
    ssl: false,
  },
  datasourceName: 'Retail Ops PostgreSQL',
  datasetName: 'Retail Ops',
  requiredTables: [
    'calendar',
    'currencies',
    'fx_rates',
    'regions',
    'countries',
    'stores',
    'product_categories',
    'products',
    'product_price_history',
    'customers',
    'promotions',
    'orders',
    'order_lines',
    'order_promotions',
    'returns',
    'store_targets',
    'web_sessions',
    'funnel_events',
    'loyalty_redemptions',
  ],
};

/**
 * A medallion sample on the World Cup data: three schemas, one per layer, with
 * deliberate gaps (2018 missing from Consumption, columns only in Normalized,
 * raw text only in Landing, cards in no layer). Hand-maintained.
 */
const WORLD_CUP_MEDALLION: SampleFixture = {
  id: 'world-cup-medallion',
  name: 'World Cup Medallion',
  description:
    'The World Cup 2018 and 2022 as a medallion lakehouse — raw Landing text, ' +
    'typed Normalized tables and a Consumption layer with known gaps.',
  seedFile: '006_world_cup_medallion.sql',
  schema: 'wc_consumption',
  layerSchemas: [
    {
      name: 'wc_landing',
      layer: 'landing',
      description: 'Raw files as delivered: every value is text.',
    },
    {
      name: 'wc_normalized',
      layer: 'normalized',
      description: 'Cleaned, typed and keyed tables.',
    },
    {
      name: 'wc_consumption',
      layer: 'consumption',
      description: 'Reporting tables for dashboards.',
    },
  ],
  defaults: { ...WORLD_CUP.defaults },
  datasourceName: 'World Cup Medallion PostgreSQL',
  datasetName: 'World Cup Medallion',
  requiredTables: [
    'wc_landing.raw_matches',
    'wc_landing.raw_goals',
    'wc_landing.raw_match_stats',
    'wc_landing.raw_teams',
    'wc_normalized.matches',
    'wc_normalized.teams',
    'wc_normalized.goals',
    'wc_normalized.match_team_statistics',
    'wc_consumption.fct_match_results',
    'wc_consumption.agg_team_tournament',
    'wc_consumption.agg_player_goals',
  ],
};

/**
 * The World Cup data as an Excel workbook and a CSV file: the sample for the
 * `file` datasource kind (M1-31). `fixtures/world-cup-excel/build.cjs`
 * generates the files from the World Cup seed. The workbook has a title row
 * and a blank row above the header of `Matches` and a `Total` row under
 * `Goals`, so detection and the total-row exclusion have something to do.
 */
const WORLD_CUP_EXCEL: SampleFixture = {
  id: 'world-cup-excel',
  name: 'World Cup Excel',
  description:
    'The World Cup 2018 and 2022 as files — an Excel workbook with the ' +
    'sheets Matches (a title row above its header), Teams and Goals (a ' +
    'trailing Total row) and a players CSV.',
  datasourceKind: 'file',
  files: { dir: 'world-cup-excel', names: ['world_cup.xlsx', 'players.csv'] },
  schema: 'world_cup',
  // Placeholders: nothing connects anywhere; the panel shows no form.
  defaults: {
    host: '',
    port: 0,
    database: '',
    user: '',
    password: '',
    ssl: false,
  },
  datasourceName: 'World Cup Excel',
  datasetName: 'World Cup Excel',
  requiredTables: [
    'world_cup.matches',
    'world_cup.teams',
    'world_cup.goals',
    'players.players',
  ],
};

/** Every sample the app knows how to provision, in panel order. */
export const SAMPLE_FIXTURES: SampleFixture[] = [
  WORLD_CUP,
  FORMULA_1,
  INTELLIFY,
  US_HEALTH,
  EDGE_CASES,
  WORLD_CUP_MEDALLION,
  RETAIL_OPS,
  WORLD_CUP_EXCEL,
  WORLD_CUP_REST,
];

export function findFixture(id: string): SampleFixture | undefined {
  return SAMPLE_FIXTURES.find((fixture) => fixture.id === id);
}

/**
 * The `schema.table` names a sample must expose. Datasets are compared on the
 * last two segments of a key, so this is the shape both the loader and the
 * eval preflight match against.
 */
export function requiredEntities(fixture: SampleFixture): string[] {
  return fixture.requiredTables.map((table) => qualifiedTable(fixture, table));
}

/**
 * A required table as `schema.table`: a multi-schema or file sample lists its
 * tables already qualified, every other sample's belong to its one schema.
 */
export function qualifiedTable(fixture: SampleFixture, table: string): string {
  return fixture.layerSchemas || fixture.files
    ? table
    : `${fixture.schema}.${table}`;
}

/** Every schema a sample owns: the loader drops all of them before seeding. */
export function ownedSchemas(fixture: SampleFixture): string[] {
  return fixture.layerSchemas
    ? fixture.layerSchemas.map((entry) => entry.name)
    : [fixture.schema];
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
