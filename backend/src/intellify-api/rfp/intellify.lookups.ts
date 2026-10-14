import type { PoolClient } from 'pg';
import type { InsurerRef, PlanDesignRef, ProductRef } from './rfp.rules';

/**
 * The few Intellify reads the RFP routes need to check a write (api.md
 * 2.16.4). Run them inside `DbService.readOnly`; `schema` is
 * `DbService.schema`, the only value interpolated into SQL. Rows flagged
 * deleted are left out.
 */

/** Undefined-table / undefined-schema: the Intellify sample isn't loaded. */
const MISSING_RELATION = new Set(['42P01', '3F000']);

export function isMissingRelation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && MISSING_RELATION.has(code);
}

export async function findClient(
  client: PoolClient,
  schema: string,
  oneCode: string,
): Promise<{ oneCode: string; name: string } | null> {
  try {
    const { rows } = await client.query<{ one_code: string; name: string }>(
      `SELECT one_code, name FROM ${schema}.clients
        WHERE one_code = $1 AND deleted IS NOT TRUE LIMIT 1`,
      [oneCode],
    );
    return rows[0] ? { oneCode: rows[0].one_code, name: rows[0].name } : null;
  } catch (error) {
    if (isMissingRelation(error)) return null; // the sample isn't loaded
    throw error;
  }
}

/**
 * Which of `oneCodes` are live clients. A missing `intellify` schema (the
 * sample is being reloaded) means none is.
 */
export async function existingClients(
  client: PoolClient,
  schema: string,
  oneCodes: string[],
): Promise<Set<string>> {
  if (!oneCodes.length) return new Set();
  try {
    await client.query('SAVEPOINT existing_clients');
    const { rows } = await client.query<{ one_code: string }>(
      `SELECT one_code FROM ${schema}.clients
        WHERE one_code = ANY($1::text[]) AND deleted IS NOT TRUE`,
      [oneCodes],
    );
    await client.query('RELEASE SAVEPOINT existing_clients');
    return new Set(rows.map((row) => row.one_code));
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    await client.query('ROLLBACK TO SAVEPOINT existing_clients');
    return new Set();
  }
}

/** The lines of coverage, in display order. */
export async function listProducts(
  client: PoolClient,
  schema: string,
): Promise<ProductRef[]> {
  const { rows } = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM ${schema}.products
      WHERE deleted IS NOT TRUE ORDER BY display_order, name`,
  );
  return rows.map((row) => ({ id: row.id.trim(), name: row.name }));
}

/** The client's plan designs with their line. */
export async function listClientPlanDesigns(
  client: PoolClient,
  schema: string,
  oneCode: string,
): Promise<PlanDesignRef[]> {
  const { rows } = await client.query<{ id: string; line: string }>(
    `SELECT pd.id, p.name AS line
       FROM ${schema}.plan_designs pd
       JOIN ${schema}.clients c ON c.id = pd.client_client_id
       JOIN ${schema}.products p ON p.id = pd.loc_product_id
      WHERE c.one_code = $1 AND c.deleted IS NOT TRUE AND pd.deleted IS NOT TRUE`,
    [oneCode],
  );
  return rows.map((row) => ({ id: row.id.trim(), line: row.line }));
}

/** The carriers, by name. */
export async function listInsurers(
  client: PoolClient,
  schema: string,
): Promise<InsurerRef[]> {
  const { rows } = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM ${schema}.insurers
      WHERE deleted IS NOT TRUE ORDER BY name`,
  );
  return rows.map((row) => ({ id: row.id.trim(), name: row.name }));
}
