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
