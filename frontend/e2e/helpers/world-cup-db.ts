import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * The seeded World Cup PostgreSQL the suite queries. By default it is the
 * repository's compose database; `E2E_WORLD_CUP_DB_*` point the suite at
 * another one, such as a database created for a worktree (the Playwright
 * config loads them from `.env.e2e.local` at the repository root). See
 * specs/system/delivery.md.
 */
const env = process.env;

export const WORLD_CUP_DB = {
  host: env['E2E_WORLD_CUP_DB_HOST'] || '127.0.0.1',
  // Same override as docker-compose.yml, so a worktree can use its own stack.
  port: Number(
    env['E2E_WORLD_CUP_DB_PORT'] || env['WORLD_CUP_DB_PORT'] || 55432,
  ),
  database: env['E2E_WORLD_CUP_DB_NAME'] || 'world_cup',
  user: env['E2E_WORLD_CUP_DB_USER'] || 'world_cup',
  password: env['E2E_WORLD_CUP_DB_PASSWORD'] || 'world_cup_dev',
};

/** On PostgreSQL an entity's catalog segment is the database name. */
export const WORLD_CUP_CATALOG = WORLD_CUP_DB.database;

/** The fully-qualified key of a table in the `world_cup` schema. */
export function worldCupKey(table: string): string {
  return `${WORLD_CUP_CATALOG}.world_cup.${table}`;
}

interface PgClient {
  connect(): Promise<void>;
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

/** `pg` is a backend dependency; the frontend borrows it for test checks. */
const requireFromBackend = createRequire(
  path.resolve(__dirname, '../../../backend/package.json'),
);

/** Runs one read query against the World Cup database and returns its first value. */
export async function worldCupScalar(sql: string): Promise<unknown> {
  const { Client } = requireFromBackend('pg') as {
    Client: new (config: typeof WORLD_CUP_DB) => PgClient;
  };
  const client = new Client(WORLD_CUP_DB);
  await client.connect();
  try {
    const { rows } = await client.query(sql);
    return rows[0] ? Object.values(rows[0])[0] : undefined;
  } finally {
    await client.end();
  }
}
