/**
 * Snapshot the World Cup Postgres fixture into JSON files for the test REST API.
 *
 *   docker compose up -d                       # World Cup Postgres fixture
 *   npm run worldcup:api:dump
 *
 * Writes `data/<relation>.json` (a plain array of row objects, 2-space
 * indented so the snapshot diffs cleanly in git) plus `data/_meta.json`.
 * `serve.ts` loads those files; it never talks to Postgres.
 *
 * Connection defaults match `docker-compose.yml`; override with
 * WORLD_CUP_DB_HOST / _PORT / _DATABASE / _USER / _PASSWORD.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Client, types } from 'pg';

const SCHEMA = 'world_cup';
const DATA_DIR = join(__dirname, 'data');

/**
 * Relation -> ORDER BY, so a re-dump of unchanged data produces a byte-identical
 * file. Views have no key, so they order by their leading columns.
 */
const RELATIONS: Record<string, string> = {
  confederations: 'code',
  countries: 'code',
  teams: 'id',
  tournaments: 'id',
  tournament_teams: 'id',
  venues: 'id',
  players: 'id',
  squad_members: 'tournament_team_id, player_id',
  matches: 'id',
  match_team_statistics: 'match_id, team_id',
  goals: 'id',
  disciplinary_events: 'id',
  v_match_results: 'tournament_year, match_number',
  v_player_goal_totals: 'tournament_year, player, national_team',
};

/**
 * pg returns NUMERIC and INT8 as strings (they can exceed 2^53) and dates as
 * local-time `Date`s. Every value in this fixture is small, so numbers are
 * safe, and a JSON API should hand out ISO strings, not driver artefacts.
 */
function registerTypeParsers(): void {
  const toNumber = (value: string) => Number(value);
  types.setTypeParser(1700, toNumber); // NUMERIC
  types.setTypeParser(20, toNumber); // INT8 (bigint ids, count(), sum())
  types.setTypeParser(700, toNumber); // FLOAT4
  types.setTypeParser(701, toNumber); // FLOAT8
  // DATE stays the calendar string ("2022-12-18"); a Date would shift it by the local UTC offset.
  types.setTypeParser(1082, (value: string) => value);
  types.setTypeParser(1114, (value: string) =>
    new Date(`${value}Z`).toISOString(),
  ); // TIMESTAMP
  types.setTypeParser(1184, (value: string) => new Date(value).toISOString()); // TIMESTAMPTZ
}

async function main(): Promise<void> {
  registerTypeParsers();

  const config = {
    host: process.env.WORLD_CUP_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.WORLD_CUP_DB_PORT ?? 55432),
    database: process.env.WORLD_CUP_DB_DATABASE ?? 'world_cup',
    user: process.env.WORLD_CUP_DB_USER ?? 'world_cup',
    password: process.env.WORLD_CUP_DB_PASSWORD ?? 'world_cup_dev',
  };
  const client = new Client(config);
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach the World Cup fixture at ${config.host}:${config.port} ` +
        `(${error instanceof Error ? error.message : String(error)}). ` +
        'Start it with `docker compose up -d`.',
    );
  }

  mkdirSync(DATA_DIR, { recursive: true });
  const counts: Record<string, number> = {};
  try {
    for (const [name, order] of Object.entries(RELATIONS)) {
      const { rows } = await client.query(
        `SELECT * FROM "${SCHEMA}"."${name}" ORDER BY ${order}`,
      );
      writeFileSync(
        join(DATA_DIR, `${name}.json`),
        `${JSON.stringify(rows, null, 2)}\n`,
      );
      counts[name] = rows.length;
    }
  } finally {
    await client.end();
  }

  const meta = {
    dumpedAt: new Date().toISOString(),
    source: `postgres://${config.user}@${config.host}:${config.port}/${config.database}?schema=${SCHEMA}`,
    tables: counts,
  };
  writeFileSync(
    join(DATA_DIR, '_meta.json'),
    `${JSON.stringify(meta, null, 2)}\n`,
  );

  const width = Math.max(...Object.keys(counts).map((name) => name.length));
  console.log(
    `Dumped ${Object.keys(counts).length} relations to ${DATA_DIR}\n`,
  );
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  ${name.padEnd(width)}  ${String(count).padStart(5)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
