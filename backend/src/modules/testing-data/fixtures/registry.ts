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
   * `api.<schema>.<table>`.
   */
  datasourceKind?: 'postgres' | 'rest';
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

/** Every sample the app knows how to provision, in panel order. */
export const SAMPLE_FIXTURES: SampleFixture[] = [
  WORLD_CUP,
  FORMULA_1,
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
