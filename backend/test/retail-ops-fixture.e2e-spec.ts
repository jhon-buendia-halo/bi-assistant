/**
 * Live smoke test of the Retail Ops sample (`007_retail_ops.sql`).
 *
 * Seeds the sample into a real PostgreSQL database through the loader's own
 * path (`readFixtureSql` + `seedInBatches`: the statement splitter, batches of
 * 50, one transaction, the 120 s statement timeout), times the load, then
 * counts every table and every planted trap of the insights-analyst-retail
 * plan (docs/plans/insights-analyst-complex-evals.md, section 1). The figures
 * are pinned: the seed is deterministic, so a change to it that moves a count
 * must update this file and the spec together. A second load must hold the
 * same data, checked with an md5 over every table.
 *
 * Opt-in: set `RETAIL_OPS_SMOKE=1`.
 *   RETAIL_OPS_SMOKE=1 npx jest --config ./test/jest-e2e.json retail-ops-fixture
 * It drops and recreates schema `retail_ops` in database `retail_ops` (created
 * when missing) on the sample server — `RETAIL_OPS_SMOKE_DB` names another
 * database. Nothing else on the server is touched.
 */

jest.mock('../src/modules/datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../src/modules/datasets/datasets.service', () => ({
  DatasetsService: class {},
}));

import { Client } from 'pg';
import { IAR_CASES } from '../src/mastra/evals/insights-analyst-retail-reference';
import { findFixture } from '../src/modules/testing-data/fixtures/registry';
import {
  SEED_TIMEOUT_MS,
  readFixtureSql,
  seedInBatches,
} from '../src/modules/testing-data/testing-data.service';

const fixture = findFixture('retail-ops')!;
const database =
  process.env['RETAIL_OPS_SMOKE_DB'] ?? fixture.defaults.database;
const connection = {
  host: process.env['WORLD_CUP_DB_HOST'] ?? fixture.defaults.host,
  port: fixture.defaults.port,
  user: fixture.defaults.user,
  password: fixture.defaults.password,
  statement_timeout: SEED_TIMEOUT_MS,
};

const describeSmoke =
  process.env['RETAIL_OPS_SMOKE'] === '1' ? describe : describe.skip;

interface Check {
  /** The planted trap, as the plan names it. */
  trap: string;
  /** `table.column` (or `table`) where it lives. */
  where: string;
  /** One row, one column `n`. */
  sql: string;
  expected: string | number;
}

const S = 'retail_ops';
const CL =
  `FROM ${S}.order_lines l JOIN ${S}.orders o ON o.order_id = l.order_id ` +
  `AND o.status = 'completed'`;
const Y2024 = `o.order_date BETWEEN date '2024-01-01' AND date '2024-12-31'`;
const rows = (table: string): string =>
  `SELECT count(*) AS n FROM ${S}.${table}`;

const ROW_COUNTS: Array<[string, number]> = [
  ['calendar', 1_096],
  ['currencies', 6],
  ['fx_rates', 216],
  ['regions', 3],
  ['countries', 8],
  ['stores', 28],
  ['product_categories', 30],
  ['products', 104],
  ['product_price_history', 148],
  ['customers', 2_015],
  ['promotions', 12],
  ['orders', 12_373],
  ['order_lines', 30_277],
  ['order_promotions', 2_688],
  ['returns', 1_137],
  ['store_targets', 576],
  ['web_sessions', 6_000],
  ['funnel_events', 13_503],
  ['loyalty_redemptions', 0],
];

const CHECKS: Check[] = [
  {
    trap: 'ranking tie: promotion 11 orders',
    where: 'order_promotions',
    sql: `SELECT count(*) AS n FROM ${S}.order_promotions WHERE promotion_id = 11`,
    expected: 400,
  },
  {
    trap: 'ranking tie: promotion 12 orders',
    where: 'order_promotions',
    sql: `SELECT count(*) AS n FROM ${S}.order_promotions WHERE promotion_id = 12`,
    expected: 400,
  },
  {
    trap: 'every regular promotion is below the tied pair',
    where: 'order_promotions',
    sql: `SELECT max(c) < 400 AS n FROM (SELECT count(*) AS c FROM ${S}.order_promotions WHERE promotion_id <= 10 GROUP BY promotion_id) t`,
    expected: 'true',
  },
  {
    trap: 'fan-out: orders with two promotions exist',
    where: 'order_promotions',
    sql: `SELECT count(*) > 0 AS n FROM (SELECT order_id FROM ${S}.order_promotions GROUP BY order_id HAVING count(*) > 1) t`,
    expected: 'true',
  },
  {
    trap: 'hero units 2024 (completed): grinder, kettle, press, dripper',
    where: 'order_lines.quantity',
    sql: `SELECT string_agg(u::text, ',' ORDER BY product_id) AS n FROM (SELECT l.product_id, sum(l.quantity) AS u ${CL} WHERE ${Y2024} AND l.product_id > 100 GROUP BY l.product_id) t`,
    expected: '900,850,800,800',
  },
  {
    trap: 'no generated product reaches 800 units in 2024 (completed)',
    where: 'order_lines.quantity',
    sql: `SELECT max(u) < 800 AS n FROM (SELECT sum(l.quantity) AS u ${CL} WHERE ${Y2024} AND l.product_id <= 100 GROUP BY l.product_id) t`,
    expected: 'true',
  },
  {
    trap: 'NULL unit cost on products that are not deleted',
    where: 'products.unit_cost_usd',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE NOT is_deleted AND unit_cost_usd IS NULL`,
    expected: 5,
  },
  {
    trap: 'soft-deleted products',
    where: 'products.is_deleted',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE is_deleted`,
    expected: 6,
  },
  {
    trap: 'soft-deleted products keep their order lines',
    where: 'order_lines.product_id',
    sql: `SELECT count(DISTINCT l.product_id) AS n FROM ${S}.order_lines l JOIN ${S}.products p USING (product_id) WHERE p.is_deleted`,
    expected: 6,
  },
  {
    trap: 'brand Acme spelled four ways',
    where: 'products.brand',
    sql: `SELECT count(DISTINCT brand) AS n FROM ${S}.products WHERE lower(btrim(brand)) = 'acme'`,
    expected: 4,
  },
  {
    trap: 'brand Acme, exact spelling Acme (about a quarter)',
    where: 'products.brand',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE brand = 'Acme'`,
    expected: 3,
  },
  {
    trap: 'NULL customer email',
    where: 'customers.email',
    sql: `SELECT count(*) AS n FROM ${S}.customers WHERE email IS NULL`,
    expected: 100,
  },
  {
    trap: 'distinct emails ignoring case',
    where: 'customers.email',
    sql: `SELECT count(DISTINCT lower(btrim(email))) AS n FROM ${S}.customers`,
    expected: 1_900,
  },
  {
    trap: 'distinct emails as stored',
    where: 'customers.email',
    sql: `SELECT count(DISTINCT email) AS n FROM ${S}.customers`,
    expected: 1_915,
  },
  {
    trap: 'full_name unique for ids 1-2000',
    where: 'customers.full_name',
    sql: `SELECT count(DISTINCT full_name) AS n FROM ${S}.customers WHERE customer_id <= 2000`,
    expected: 2_000,
  },
  {
    trap: 'customers who never ordered',
    where: 'customers',
    sql: `SELECT count(*) AS n FROM ${S}.customers c WHERE NOT EXISTS (SELECT 1 FROM ${S}.orders o WHERE o.customer_id = c.customer_id)`,
    expected: 115,
  },
  {
    trap: 'store with no order at all',
    where: 'stores / orders',
    sql: `SELECT count(*) AS n FROM ${S}.orders WHERE store_id = 28`,
    expected: 0,
  },
  {
    trap: 'no order after a store closed',
    where: 'stores.closed_on / orders.order_date',
    sql: `SELECT count(*) AS n FROM ${S}.orders o JOIN ${S}.stores s USING (store_id) WHERE o.order_date > s.closed_on`,
    expected: 0,
  },
  {
    trap: 'closed stores sold before they closed',
    where: 'stores.closed_on / orders',
    sql: `SELECT count(DISTINCT store_id) AS n FROM ${S}.orders WHERE store_id IN (6, 17)`,
    expected: 2,
  },
  {
    trap: 'empty table',
    where: 'loyalty_redemptions',
    sql: `SELECT count(*) AS n FROM ${S}.loyalty_redemptions`,
    expected: 0,
  },
  {
    trap: 'time zone: Tokyo orders on 1 December local (UTC 30 November)',
    where: 'orders.ordered_at',
    sql: `SELECT count(*) AS n FROM ${S}.orders WHERE order_id BETWEEN 12366 AND 12370 AND store_id = 19 AND status = 'completed' AND (ordered_at AT TIME ZONE 'Asia/Tokyo')::date = date '2024-12-01' AND order_date = date '2024-11-30'`,
    expected: 5,
  },
  {
    trap: 'time zone: Tokyo orders on 1 January local (UTC 31 December)',
    where: 'orders.ordered_at',
    sql: `SELECT count(*) AS n FROM ${S}.orders WHERE order_id BETWEEN 12371 AND 12373 AND store_id = 19 AND status = 'completed' AND (ordered_at AT TIME ZONE 'Asia/Tokyo')::date = date '2025-01-01' AND order_date = date '2024-12-31'`,
    expected: 3,
  },
  {
    trap: 'order_date is the UTC date of ordered_at',
    where: 'orders.order_date',
    sql: `SELECT count(*) AS n FROM ${S}.orders WHERE order_date <> (ordered_at AT TIME ZONE 'UTC')::date`,
    expected: 0,
  },
  {
    trap: 'look-alike price: products.list_price_usd is the is_current history row',
    where: 'products.list_price_usd',
    sql: `SELECT count(*) AS n FROM ${S}.products p JOIN ${S}.product_price_history h ON h.product_id = p.product_id AND h.is_current WHERE p.list_price_usd <> h.list_price_usd`,
    expected: 0,
  },
  {
    trap: 'every product has exactly one current price row',
    where: 'product_price_history.is_current',
    sql: `SELECT count(*) AS n FROM ${S}.products p WHERE (SELECT count(*) FROM ${S}.product_price_history h WHERE h.product_id = p.product_id AND h.is_current) <> 1`,
    expected: 0,
  },
  {
    trap: 'price history: a changed price before and after 2024-07-01 (SKU-0009)',
    where: 'product_price_history',
    sql: `SELECT count(DISTINCT list_price_usd) AS n FROM ${S}.product_price_history WHERE product_id = 9`,
    expected: 3,
  },
  {
    trap: 'net_amount follows quantity * unit_price - discount',
    where: 'order_lines.net_amount',
    sql: `SELECT count(*) AS n FROM ${S}.order_lines WHERE net_amount <> quantity * unit_price - discount_amount`,
    expected: 0,
  },
  {
    trap: 'net_amount_usd follows net_amount * the month rate',
    where: 'order_lines.net_amount_usd',
    sql: `SELECT count(*) AS n FROM ${S}.order_lines l JOIN ${S}.orders o USING (order_id) JOIN ${S}.fx_rates f ON f.currency_code = o.currency_code AND f.rate_month = date_trunc('month', o.order_date)::date WHERE l.net_amount_usd <> round(l.net_amount * f.usd_per_unit, 2)`,
    expected: 0,
  },
  {
    trap: 'mixed currencies: summing local amounts is far from USD',
    where: 'order_lines.net_amount',
    sql: `SELECT abs(sum(l.net_amount) / sum(l.net_amount_usd) - 1) > 0.05 AS n ${CL} WHERE ${Y2024}`,
    expected: 'true',
  },
  {
    trap: 'growth 2023 to 2024 is positive',
    where: 'orders / order_lines',
    sql: `SELECT sum(l.net_amount_usd) FILTER (WHERE o.order_date >= date '2024-01-01') > sum(l.net_amount_usd) FILTER (WHERE o.order_date < date '2024-01-01') AS n ${CL} WHERE o.order_date >= date '2023-01-01'`,
    expected: 'true',
  },
  {
    trap: 'cancelled orders (percent, one decimal)',
    where: 'orders.status',
    sql: `SELECT round(100.0 * count(*) FILTER (WHERE status = 'cancelled') / count(*), 0) AS n FROM ${S}.orders`,
    expected: 5,
  },
  {
    trap: 'pending orders only from December 2024',
    where: 'orders.status',
    sql: `SELECT count(*) AS n FROM ${S}.orders WHERE status = 'pending' AND order_date < date '2024-12-01'`,
    expected: 0,
  },
  {
    trap: 'pending orders exist in December 2024',
    where: 'orders.status',
    sql: `SELECT count(*) > 0 AS n FROM ${S}.orders WHERE status = 'pending'`,
    expected: 'true',
  },
  {
    trap: 'fiscal year 2023 starts on 2023-02-01',
    where: 'calendar.fiscal_year',
    sql: `SELECT min(date_key)::text || ' ' || max(date_key)::text AS n FROM ${S}.calendar WHERE fiscal_year = 2023`,
    expected: '2023-02-01 2024-01-31',
  },
  {
    trap: 'fiscal year 2021 holds January 2022 only',
    where: 'calendar.fiscal_year',
    sql: `SELECT count(*) AS n FROM ${S}.calendar WHERE fiscal_year = 2021`,
    expected: 31,
  },
  {
    trap: 'fiscal year 2024 holds 11 months',
    where: 'calendar.fiscal_year',
    sql: `SELECT count(DISTINCT calendar_month) AS n FROM ${S}.calendar WHERE fiscal_year = 2024`,
    expected: 11,
  },
  {
    trap: 'repeated category name: two Accessories subcategories',
    where: 'product_categories.category_name',
    sql: `SELECT count(*) AS n FROM ${S}.product_categories WHERE category_name = 'Accessories' AND level = 3`,
    expected: 2,
  },
  {
    trap: 'refunds change a 2024 total by more than 1%',
    where: 'returns.refund_amount_usd',
    sql: `SELECT (SELECT coalesce(sum(r.refund_amount_usd), 0) FROM ${S}.returns r JOIN ${S}.order_lines l USING (line_id) JOIN ${S}.orders o USING (order_id) WHERE ${Y2024}) / (SELECT sum(l.net_amount_usd) ${CL} WHERE ${Y2024}) > 0.01 AS n`,
    expected: 'true',
  },
  {
    trap: 'refunds never exceed the line amount',
    where: 'returns.refund_amount_usd',
    sql: `SELECT count(*) AS n FROM ${S}.returns r JOIN ${S}.order_lines l USING (line_id) WHERE r.refund_amount_usd > l.net_amount_usd`,
    expected: 0,
  },
  {
    trap: 'refund year differs from order year (some returns)',
    where: 'returns.returned_at',
    sql: `SELECT count(*) > 0 AS n FROM ${S}.returns r JOIN ${S}.order_lines l USING (line_id) JOIN ${S}.orders o USING (order_id) WHERE extract(year FROM r.returned_at) <> extract(year FROM o.order_date)`,
    expected: 'true',
  },
  {
    trap: 'NULL return reason',
    where: 'returns.reason',
    sql: `SELECT count(*) > 0 AS n FROM ${S}.returns WHERE reason IS NULL`,
    expected: 'true',
  },
  {
    trap: 'target coverage gap: no 2022 targets',
    where: 'store_targets',
    sql: `SELECT count(*) AS n FROM ${S}.store_targets WHERE target_month < date '2023-01-01'`,
    expected: 0,
  },
  {
    trap: 'target coverage gap: only the 24 shops',
    where: 'store_targets.store_id',
    sql: `SELECT count(DISTINCT store_id) AS n FROM ${S}.store_targets WHERE store_id <= 24`,
    expected: 24,
  },
  {
    trap: 'funnel duplicates: events exceed distinct sessions at add_to_cart',
    where: 'funnel_events',
    sql: `SELECT count(*) > count(DISTINCT session_id) AS n FROM ${S}.funnel_events WHERE stage = 'add_to_cart'`,
    expected: 'true',
  },
  {
    trap: 'funnel duplicates: events exceed distinct sessions at product_view',
    where: 'funnel_events',
    sql: `SELECT count(*) > count(DISTINCT session_id) AS n FROM ${S}.funnel_events WHERE stage = 'product_view'`,
    expected: 'true',
  },
  {
    trap: 'every session has a visit',
    where: 'funnel_events',
    sql: `SELECT count(DISTINCT session_id) AS n FROM ${S}.funnel_events WHERE stage = 'visit'`,
    expected: 6_000,
  },
  {
    trap: 'anonymous web sessions (NULL customer_id, about 60%)',
    where: 'web_sessions.customer_id',
    sql: `SELECT 100.0 * count(*) FILTER (WHERE customer_id IS NULL) / count(*) BETWEEN 57 AND 63 AS n FROM ${S}.web_sessions`,
    expected: 'true',
  },
  {
    trap: 'orders rise through the years (2022 < 2023 < 2024)',
    where: 'orders.order_date',
    sql: `SELECT count(*) FILTER (WHERE order_date < date '2023-01-01') < count(*) FILTER (WHERE order_date BETWEEN date '2023-01-01' AND date '2023-12-31') AND count(*) FILTER (WHERE order_date BETWEEN date '2023-01-01' AND date '2023-12-31') < count(*) FILTER (WHERE order_date >= date '2024-01-01') AS n FROM ${S}.orders`,
    expected: 'true',
  },
  {
    trap: 'server time zone is UTC',
    where: 'SHOW timezone',
    sql: `SELECT current_setting('TimeZone') IN ('UTC', 'Etc/UTC') AS n`,
    expected: 'true',
  },
];

async function ensureDatabase(): Promise<void> {
  const admin = new Client({ ...connection, database: 'postgres' });
  await admin.connect();
  try {
    const found = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database],
    );
    if (found.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }
}

async function load(client: Client): Promise<number> {
  const started = Date.now();
  await client.query(`DROP SCHEMA IF EXISTS "${fixture.schema}" CASCADE`);
  await seedInBatches(client, readFixtureSql(fixture));
  return Date.now() - started;
}

/** md5 of every table's rows in a stable order, keyed by table. */
async function fingerprint(client: Client): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of fixture.requiredTables) {
    const result = await client.query<{ n: string }>(
      `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS n FROM ${S}.${table} t`,
    );
    out[table] = result.rows[0].n;
  }
  return out;
}

describeSmoke('Retail Ops sample, seeded on a live server', () => {
  jest.setTimeout(10 * 60_000);
  let client: Client;
  let loadMs = 0;

  beforeAll(async () => {
    await ensureDatabase();
    client = new Client({ ...connection, database });
    await client.connect();
    loadMs = await load(client);
    console.log(`Retail Ops seed loaded in ${(loadMs / 1000).toFixed(1)} s`);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('loads well within the seed timeout', () => {
    expect(loadMs).toBeLessThan(SEED_TIMEOUT_MS);
  });

  it('creates every required table, and the helper is gone', async () => {
    const result = await client.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'v', 'm')`,
      [fixture.schema],
    );
    expect(result.rows.map((row) => row.name).sort()).toEqual(
      [...fixture.requiredTables].sort(),
    );
    const fns = await client.query(
      `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1`,
      [fixture.schema],
    );
    expect(fns.rowCount).toBe(0);
  });

  it('puts a comment on every table', async () => {
    const result = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_class c
         JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = $1 AND c.relkind = 'r'
          AND obj_description(c.oid, 'pg_class') IS NULL`,
      [fixture.schema],
    );
    expect(Number(result.rows[0].n)).toBe(0);
  });

  it.each(ROW_COUNTS)('%s holds %d rows', async (table, expected) => {
    const result = await client.query<{ n: string }>(rows(table));
    expect(Number(result.rows[0].n)).toBe(expected);
  });

  it('holds every planted trap', async () => {
    const report: Array<Check & { actual: string }> = [];
    for (const check of CHECKS) {
      const result = await client.query<{ n: unknown }>(check.sql);
      report.push({ ...check, actual: String(result.rows[0]?.n) });
    }
    console.log(
      report.map((r) => `${r.trap} | ${r.where} | ${r.actual}`).join('\n'),
    );
    const wrong = report
      .filter((r) => r.actual !== String(r.expected))
      .map((r) => `${r.trap} @ ${r.where}: ${r.actual} ≠ ${r.expected}`);
    expect(wrong).toEqual([]);
  });

  describe('the reference SQL of the insights-analyst-retail set', () => {
    /** The eval SQL names `database.schema.table`; the smoke database may differ. */
    const local = (sql: string): string =>
      sql.split('retail_ops.retail_ops.').join('retail_ops.');
    const query = async (sql: string) =>
      (await client.query(local(sql))).rows as Record<string, unknown>[];
    const numeric = (value: unknown): number | undefined =>
      value !== null && value !== '' && Number.isFinite(Number(value))
        ? Number(value)
        : undefined;
    const withReference = Object.entries(IAR_CASES).filter(
      ([, c]) => c.referenceSql,
    );
    const values: Record<string, Record<string, unknown>[]> = {};

    it.each(withReference)(
      '%s: the reference SQL returns a row with no NULL',
      async (id, c) => {
        const result = await query(c.referenceSql!);
        values[id] = result;
        console.log(`REF ${id} ${JSON.stringify(result).slice(0, 400)}`);
        expect(result.length).toBeGreaterThanOrEqual(1);
        for (const row of result) {
          for (const [column, cell] of Object.entries(row)) {
            expect({ id, column, isNull: cell === null }).toEqual({
              id,
              column,
              isNull: false,
            });
          }
        }
      },
    );

    it.each(withReference.filter(([, c]) => c.naiveSql))(
      '%s: the naive SQL differs from the reference by the plan margin',
      async (id, c) => {
        const reference = values[id] ?? (await query(c.referenceSql!));
        const naive = await query(c.naiveSql!);
        console.log(`NAIVE ${id} ${JSON.stringify(naive).slice(0, 400)}`);
        if (reference.length !== naive.length) return;
        // A column differs by 5% (money), 2 points (a percentage) or 1 (a count).
        const differs = Object.keys(reference[0]).some((column) => {
          const a = numeric(reference[0][column]);
          const b = numeric(naive[0][column]);
          if (a === undefined || b === undefined) return false;
          const gap = Math.abs(a - b);
          if (/_pct$/.test(column)) return gap >= 2;
          if (Number.isInteger(a) && Number.isInteger(b)) return gap >= 1;
          // The refunds case is graded at 0.4%: the naive total only has to clear 1%.
          const margin =
            id === 'iar-refunds-net-after-returns-2024' ? 0.01 : 0.05;
          return gap >= margin * Math.abs(a);
        });
        expect({ id, differs }).toEqual({ id, differs: true });
      },
    );

    it('holds the per-case assert notes of the plan', async () => {
      const read = async (id: string) =>
        values[id] ?? (await query(IAR_CASES[id].referenceSql!));
      const first = async (id: string, name: string) =>
        (await read(id))[0][name];
      const netOf2024 = `FROM retail_ops.order_lines l JOIN retail_ops.orders o ON o.order_id = l.order_id AND o.status = 'completed' WHERE o.order_date BETWEEN date '2024-01-01' AND date '2024-12-31'`;
      const notes: Record<string, unknown> = {};

      notes['topn rows'] = (
        await read('iar-topn-product-per-department-2024')
      ).length;
      const tie = await read('iar-tie-top-3-products-units-2024');
      notes['tie rows'] = tie.length;
      notes['tie units'] = tie
        .map((r) => `${String(r.product_name)}=${String(r.units)}`)
        .join(', ');
      const promos = await read('iar-tie-most-used-promotion');
      notes['promotions'] = promos
        .map((r) => `${String(r.promotion_name)}=${String(r.orders)}`)
        .join(', ');
      const stores = await query(
        `SELECT sum(l.net_amount_usd) AS net ${netOf2024} GROUP BY o.store_id ORDER BY 1 DESC LIMIT 2`,
      );
      notes['top store gap'] = Number(stores[0].net) > Number(stores[1].net);
      const storeProducts = await query(
        `WITH top AS (SELECT o.store_id ${netOf2024} GROUP BY 1 ORDER BY sum(l.net_amount_usd) DESC LIMIT 1) SELECT sum(l.quantity) AS units ${netOf2024} AND o.store_id = (SELECT store_id FROM top) GROUP BY l.product_id ORDER BY 1 DESC LIMIT 2`,
      );
      notes['top store product gap'] =
        Number(storeProducts[0].units) > Number(storeProducts[1].units);
      const customers = await query(
        `SELECT sum(l.net_amount_usd) AS net FROM retail_ops.order_lines l JOIN retail_ops.orders o ON o.order_id = l.order_id AND o.status = 'completed' GROUP BY o.customer_id ORDER BY 1 DESC LIMIT 6`,
      );
      notes['5th and 6th customer differ'] =
        Number(customers[4].net) !== Number(customers[5].net);
      const net = Number(await first('iar-agg-net-revenue-2024', 'net'));
      const after = Number(
        await first('iar-refunds-net-after-returns-2024', 'net_after_refunds'),
      );
      notes['refund share'] = (net - after) / net;
      const before = await query(
        `SELECT count(*) AS n FROM retail_ops.orders WHERE order_date < date '2022-01-01'`,
      );
      notes['orders before 2022'] = Number(before[0].n);
      const targets = await query(
        `SELECT count(*) AS n FROM retail_ops.store_targets WHERE target_month < date '2023-01-01'`,
      );
      notes['targets before 2023'] = Number(targets[0].n);
      console.log(JSON.stringify(notes, null, 1));

      expect(notes['topn rows']).toBe(3);
      expect(notes['tie rows']).toBe(4);
      expect(promos).toHaveLength(2);
      expect(promos.map((r) => Number(r.orders))).toEqual([400, 400]);
      expect(notes['top store gap']).toBe(true);
      expect(notes['top store product gap']).toBe(true);
      expect(notes['5th and 6th customer differ']).toBe(true);
      expect(notes['refund share']).toBeGreaterThan(0.01);
      expect(notes['orders before 2022']).toBe(0);
      expect(notes['targets before 2023']).toBe(0);
    });
  });

  it('holds the same data after a second load', async () => {
    const first = await fingerprint(client);
    await load(client);
    const second = await fingerprint(client);
    expect(second).toEqual(first);
  });
});
