import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';

/**
 * Connection to the World Cup Postgres fixture (`docker compose up -d`).
 * Integration specs run against real data because the faults these guards
 * exist to catch — a metric constant at 1, a group key blank on most rows —
 * are properties of real result sets, not of hand-written fixtures.
 */
export const WORLD_CUP_CONNECTION = {
  host: process.env['WORLD_CUP_DB_HOST'] ?? 'localhost',
  port: Number(process.env['WORLD_CUP_DB_PORT'] ?? 55432),
  database: 'world_cup',
  user: 'world_cup',
  password: 'world_cup_dev',
};

export function worldCupPool(): Pool {
  return new Pool({ ...WORLD_CUP_CONNECTION, max: 2 });
}

/** Is the fixture up? Specs skip rather than fail when it is not. */
export async function worldCupReachable(): Promise<boolean> {
  const pool = new Pool({ ...WORLD_CUP_CONNECTION, max: 1 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Rows as the connectors hand them over: plain objects keyed by column. */
export async function runSql(
  pool: Pool,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const result = await pool.query(sql);
  return result.rows as Record<string, unknown>[];
}

/**
 * Is the fixture up, asked synchronously? `describe.skip` is decided while
 * jest collects a file, long before any async hook could await
 * `worldCupReachable()`, so the probe runs in a child process with the same
 * connection settings. Gating in `beforeAll` instead would report a
 * docker-less run as a suite of passing tests, which is worse than a
 * visible skip.
 */
export function worldCupIsUp(): boolean {
  const probe = `
    const { Pool } = require(${JSON.stringify(require.resolve('pg'))});
    const pool = new Pool({ ...${JSON.stringify(WORLD_CUP_CONNECTION)}, max: 1, connectionTimeoutMillis: 3000 });
    pool.query('SELECT 1')
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  `;
  try {
    execFileSync(process.execPath, ['-e', probe], {
      stdio: 'ignore',
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}
