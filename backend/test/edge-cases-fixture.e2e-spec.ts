/**
 * Live smoke test of the Edge Cases sample (`005_edge_cases.sql`).
 *
 * Seeds the sample into a real PostgreSQL database through the loader's own
 * path (`readFixtureSql` + `seedInBatches`: the statement splitter, batches of
 * 50, one transaction, the 120 s statement timeout), times the load, then
 * counts every edge case the testing-data spec documents ("The Edge Cases
 * sample"). The figures are pinned: the seed is deterministic, so a change to
 * it that moves a count must update this file and the spec together.
 *
 * Opt-in, because it writes a million rows: set `EDGE_CASES_SMOKE=1`.
 *   EDGE_CASES_SMOKE=1 npx jest --config ./test/jest-e2e.json edge-cases-fixture
 * It drops and recreates schema `edge_cases` in database `edge_cases` (created
 * when missing) on the sample server — `EDGE_CASES_SMOKE_DB` names another
 * database. Nothing else on the server is touched.
 */

jest.mock('../src/modules/datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../src/modules/datasets/datasets.service', () => ({
  DatasetsService: class {},
}));

import { Client } from 'pg';
import { POSTGRES_FORMAT_PATTERNS } from '../src/modules/synthetic-data/profile/format-rules';
import { findFixture } from '../src/modules/testing-data/fixtures/registry';
import {
  SEED_TIMEOUT_MS,
  readFixtureSql,
  seedInBatches,
} from '../src/modules/testing-data/testing-data.service';

const fixture = findFixture('edge-cases')!;
const database =
  process.env['EDGE_CASES_SMOKE_DB'] ?? fixture.defaults.database;
const connection = {
  host: process.env['WORLD_CUP_DB_HOST'] ?? fixture.defaults.host,
  port: fixture.defaults.port,
  user: fixture.defaults.user,
  password: fixture.defaults.password,
  statement_timeout: SEED_TIMEOUT_MS,
};

const describeSmoke =
  process.env['EDGE_CASES_SMOKE'] === '1' ? describe : describe.skip;

interface Check {
  /** The edge case, as the spec's table names it. */
  edgeCase: string;
  /** `table.column` (or `table`) where it lives. */
  where: string;
  /** One row, one column `n`. `$1`… bind to `params`. */
  sql: string;
  params?: unknown[];
  expected: string | number;
}

const S = 'edge_cases';
const rows = (table: string): string =>
  `SELECT count(*) AS n FROM ${S}.${table}`;
const nulls = (table: string, column: string): string =>
  `SELECT count(*) FILTER (WHERE ${column} IS NULL) AS n FROM ${S}.${table}`;
const column = (table: string, name: string): Check => ({
  edgeCase: `column named ${name}`,
  where: `${table}.${name}`,
  sql:
    'SELECT count(*) AS n FROM information_schema.columns ' +
    'WHERE table_schema = $1 AND table_name = $2 AND column_name = $3',
  params: [S, table, name],
  expected: 1,
});
const invalid = (
  table: string,
  col: string,
  rule: keyof typeof POSTGRES_FORMAT_PATTERNS,
  expected: number,
): Check => ({
  edgeCase: `invalid ${rule} (readiness validity rule)`,
  where: `${table}.${col}`,
  sql: `SELECT count(*) FILTER (WHERE ${col} IS NOT NULL AND ${col}::text !~* $1) AS n FROM ${S}.${table}`,
  params: [POSTGRES_FORMAT_PATTERNS[rule]],
  expected,
});
const collapsed = (table: string, col: string, expected: number): Check => ({
  edgeCase: 'same value spelled with other case or spaces',
  where: `${table}.${col}`,
  sql: `SELECT count(DISTINCT ${col}) - count(DISTINCT lower(btrim(${col}))) AS n FROM ${S}.${table}`,
  expected,
});

const ROW_COUNTS: Array<[string, number]> = [
  ['store_settings', 1],
  ['gift_cards', 0],
  ['categories', 70],
  ['customers', 50_000],
  ['customer_profile_wide', 20_000],
  ['products', 5_000],
  ['promotions', 40],
  ['orders', 300_000],
  ['order_lines', 1_000_000],
  ['payments', 262_500],
  ['shipments', 250_000],
  ['returns', 15_000],
  ['reviews', 40_000],
  ['inventory_snapshots', 60_000],
  ['"LegacyOrders"', 5_250],
  ['mv_daily_sales', 2_129],
];

const CHECKS: Check[] = [
  // Shapes
  {
    edgeCase: 'wide table (columns)',
    where: 'customer_profile_wide',
    sql: "SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = 'edge_cases' AND table_name = 'customer_profile_wide'",
    expected: 65,
  },
  {
    edgeCase: 'regular views',
    where: 'v_order_totals, v_customer_ltv, v_product_revenue',
    sql: "SELECT count(*) AS n FROM information_schema.views WHERE table_schema = 'edge_cases'",
    expected: 3,
  },
  {
    edgeCase: 'materialized view, populated',
    where: 'mv_daily_sales',
    sql: "SELECT count(*) AS n FROM pg_matviews WHERE schemaname = 'edge_cases' AND matviewname = 'mv_daily_sales' AND ispopulated",
    expected: 1,
  },
  {
    edgeCase: 'table without a primary key',
    where: 'LegacyOrders',
    sql: `SELECT count(*) AS n FROM pg_constraint WHERE conrelid = '${S}."LegacyOrders"'::regclass AND contype = 'p'`,
    expected: 0,
  },
  {
    edgeCase: 'composite primary key (columns)',
    where: 'inventory_snapshots',
    sql: `SELECT cardinality(conkey) AS n FROM pg_constraint WHERE conrelid = '${S}.inventory_snapshots'::regclass AND contype = 'p'`,
    expected: 3,
  },
  {
    edgeCase: 'self-referencing foreign key (child categories)',
    where: 'categories.parent_category_id',
    sql: `SELECT count(parent_category_id) AS n FROM ${S}.categories`,
    expected: 62,
  },
  {
    edgeCase: 'MixedCase table name',
    where: 'LegacyOrders',
    sql: "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'edge_cases' AND table_name = 'LegacyOrders'",
    expected: 1,
  },
  // Names
  column('orders', 'Order Notes'),
  column('customers', 'CustomerTier'),
  column('orders', 'order'),
  column('categories', 'group'),
  column('products', 'select'),
  column('orders', 'user'),
  column('orders', 'año'),
  column('customers', 'región'),
  column('orders', 'discount_%'),
  column('promotions', 'discount_%'),
  column('orders', 'ship-to'),
  column('products', 'matching_rows'),
  column('LegacyOrders', 'OrderTotal'),
  {
    edgeCase: 'a column named id in several tables',
    where:
      'customers, products, orders, order_lines, payments, reviews, store_settings, gift_cards',
    sql: "SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = 'edge_cases' AND column_name = 'id'",
    expected: 8,
  },
  // NULL rates
  {
    edgeCase: 'NULL rate 0% (nullable column)',
    where: 'customers.first_name',
    sql: nulls('customers', 'first_name'),
    expected: 0,
  },
  {
    edgeCase: 'NULL rate 5%',
    where: 'customers.phone',
    sql: nulls('customers', 'phone'),
    expected: 2_500,
  },
  {
    edgeCase: 'NULL rate 50%',
    where: 'customers.middle_name',
    sql: nulls('customers', 'middle_name'),
    expected: 25_000,
  },
  {
    edgeCase: 'NULL rate 100%',
    where: 'customers.fax',
    sql: nulls('customers', 'fax'),
    expected: 50_000,
  },
  {
    edgeCase: 'NULL rate 49.5% in a name with spaces',
    where: 'orders."Order Notes"',
    sql: nulls('orders', '"Order Notes"'),
    expected: 148_500,
  },
  {
    edgeCase: 'boolean with NULLs',
    where: 'customers.is_vip',
    sql: nulls('customers', 'is_vip'),
    expected: 5_000,
  },
  // Text values
  {
    edgeCase: 'text containing %',
    where: 'products.name',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE strpos(name, '%') > 0`,
    expected: 2,
  },
  {
    edgeCase: 'text containing _',
    where: 'products.name',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE strpos(name, '_') > 0`,
    expected: 2,
  },
  {
    edgeCase: 'text containing a backslash',
    where: 'products.name',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE strpos(name, chr(92)) > 0`,
    expected: 1,
  },
  {
    edgeCase: 'text containing a single quote',
    where: 'products.name',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE strpos(name, chr(39)) > 0`,
    expected: 2,
  },
  {
    edgeCase: 'text containing a double quote',
    where: 'products.name',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE strpos(name, chr(34)) > 0`,
    expected: 1,
  },
  {
    edgeCase: 'text containing emoji',
    where: 'products.name',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE strpos(name, '🚀') > 0`,
    expected: 1,
  },
  {
    edgeCase: 'text containing a newline',
    where: 'products.name',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE strpos(name, chr(10)) > 0`,
    expected: 1,
  },
  {
    edgeCase: 'leading/trailing spaces',
    where: 'products.name',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE name <> btrim(name)`,
    expected: 1,
  },
  {
    edgeCase: 'empty string (not NULL)',
    where: 'products.name',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE name = ''`,
    expected: 1,
  },
  {
    edgeCase: 'NULL (not empty string)',
    where: 'products.name',
    sql: nulls('products', 'name'),
    expected: 1,
  },
  {
    edgeCase: 'text over 10,000 characters',
    where: 'orders."Order Notes"',
    sql: `SELECT count(*) AS n FROM ${S}.orders WHERE length("Order Notes") > 10000`,
    expected: 3,
  },
  {
    edgeCase: 'text over 10,000 characters',
    where: 'reviews.body',
    sql: `SELECT count(*) AS n FROM ${S}.reviews WHERE length(body) > 10000`,
    expected: 3,
  },
  {
    edgeCase: 'empty and blank strings',
    where: 'order_lines.gift_message',
    sql: `SELECT count(*) FILTER (WHERE gift_message IS NOT NULL AND btrim(gift_message) = '') AS n FROM ${S}.order_lines`,
    expected: 20_000,
  },
  // Numbers
  {
    edgeCase: 'bigint at its maximum',
    where: 'order_lines.event_sequence',
    sql: `SELECT max(event_sequence)::text AS n FROM ${S}.order_lines`,
    expected: '9223372036854775807',
  },
  {
    edgeCase: 'numeric(38,10) at full precision',
    where: 'products.cost',
    sql: `SELECT max(cost)::text AS n FROM ${S}.products`,
    expected: '1234567890123456789012345678.1234567890',
  },
  {
    edgeCase: 'negative quantities',
    where: 'order_lines.quantity',
    sql: `SELECT count(*) AS n FROM ${S}.order_lines WHERE quantity < 0`,
    expected: 500,
  },
  {
    edgeCase: 'zero quantities',
    where: 'order_lines.quantity',
    sql: `SELECT count(*) AS n FROM ${S}.order_lines WHERE quantity = 0`,
    expected: 200,
  },
  {
    edgeCase: 'zero prices',
    where: 'order_lines.unit_price',
    sql: `SELECT count(*) AS n FROM ${S}.order_lines WHERE unit_price = 0`,
    expected: 123,
  },
  {
    edgeCase: 'NaN in a double column',
    where: 'products.weight_kg',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE weight_kg = 'NaN'`,
    expected: 5,
  },
  {
    edgeCase: 'Infinity in a double column',
    where: 'products.weight_kg',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE weight_kg = 'Infinity'`,
    expected: 1,
  },
  {
    edgeCase: 'half-cent amounts (rounding)',
    where: 'orders.discount_amount',
    sql: `SELECT count(*) AS n FROM ${S}.orders WHERE mod(discount_amount * 1000, 10) = 5`,
    expected: 200_000,
  },
  {
    edgeCase: 'negative amounts',
    where: 'returns.refund_amount',
    sql: `SELECT count(*) AS n FROM ${S}.returns WHERE refund_amount < 0`,
    expected: 15_000,
  },
  {
    edgeCase: 'integer at its maximum',
    where: 'reviews.helpful_votes',
    sql: `SELECT max(helpful_votes) AS n FROM ${S}.reviews`,
    expected: 2_147_483_647,
  },
  // Dates and times
  {
    edgeCase: 'timestamptz entered in several time zones',
    where: 'orders.ordered_at (zone in orders.ordered_tz)',
    sql: `SELECT count(DISTINCT ordered_tz) AS n FROM ${S}.orders`,
    expected: 8,
  },
  {
    edgeCase: 'DST gap (02:30 that does not exist in New York)',
    where: 'orders.ordered_at, id 1',
    sql: `SELECT to_char(ordered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS n FROM ${S}.orders WHERE id = 1`,
    expected: '2024-03-10 07:30',
  },
  {
    edgeCase: 'DST overlap (01:30 that happens twice in New York)',
    where: 'orders.ordered_at, id 2',
    sql: `SELECT to_char(ordered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS n FROM ${S}.orders WHERE id = 2`,
    expected: '2024-11-03 06:30',
  },
  {
    edgeCase: 'far future date (2999)',
    where: 'orders.expected_delivery_date',
    sql: `SELECT count(*) AS n FROM ${S}.orders WHERE expected_delivery_date = '2999-12-31'`,
    expected: 3,
  },
  {
    edgeCase: 'far past dates (1899, 1900)',
    where: 'customers.birth_date',
    sql: `SELECT count(*) AS n FROM ${S}.customers WHERE birth_date <= '1900-01-01'`,
    expected: 2,
  },
  {
    edgeCase: 'date stored as text, not ISO',
    where: 'customers.signup_date',
    sql: `SELECT count(*) AS n FROM ${S}.customers WHERE signup_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    expected: 67,
  },
  {
    edgeCase: 'date stored as text, ISO-shaped but impossible',
    where: 'customers.signup_date',
    sql: `SELECT count(*) AS n FROM ${S}.customers WHERE signup_date IN ('2024-02-30', '2024-13-01')`,
    expected: 33,
  },
  // Other types
  {
    edgeCase: 'nested JSONB (three levels)',
    where: 'customers.preferences',
    sql: `SELECT count(*) AS n FROM ${S}.customers WHERE preferences #> '{address,geo,lat}' IS NOT NULL`,
    expected: 49_850,
  },
  {
    edgeCase: 'text[] holding a NULL element',
    where: 'products.tags',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE array_position(tags, NULL) IS NOT NULL`,
    expected: 50,
  },
  {
    edgeCase: 'UUID',
    where: 'orders.order_uuid',
    sql: `SELECT count(DISTINCT order_uuid) AS n FROM ${S}.orders`,
    expected: 300_000,
  },
  {
    edgeCase: 'ENUM values in use',
    where: 'orders.status (type order_status)',
    sql: `SELECT count(DISTINCT status) AS n FROM ${S}.orders`,
    expected: 6,
  },
  {
    edgeCase: 'IPv6 addresses in an inet column',
    where: 'customers.last_login_ip',
    sql: `SELECT count(*) AS n FROM ${S}.customers WHERE family(last_login_ip) = 6`,
    expected: 172,
  },
  // Data quality (what the readiness engine scores)
  {
    edgeCase: 'exact duplicate rows',
    where: 'LegacyOrders',
    sql: `SELECT count(*) AS n FROM (SELECT * FROM ${S}."LegacyOrders" EXCEPT ALL SELECT DISTINCT * FROM ${S}."LegacyOrders") d`,
    expected: 200,
  },
  {
    edgeCase: 'duplicate values in an id-like column (no key declared)',
    where: 'LegacyOrders.legacy_order_id',
    sql: `SELECT count(*) - count(DISTINCT legacy_order_id) AS n FROM ${S}."LegacyOrders"`,
    expected: 250,
  },
  {
    edgeCase: 'orphans behind a declared NOT VALID foreign key',
    where: 'order_lines.order_id → orders.id',
    sql: `SELECT count(*) AS n FROM ${S}.order_lines l WHERE NOT EXISTS (SELECT 1 FROM ${S}.orders o WHERE o.id = l.order_id)`,
    expected: 20,
  },
  {
    edgeCase: 'orphans behind an inferred join (no foreign key)',
    where: 'order_lines.product_id → products.id',
    sql: `SELECT count(*) AS n FROM ${S}.order_lines l WHERE NOT EXISTS (SELECT 1 FROM ${S}.products p WHERE p.id = l.product_id)`,
    expected: 25,
  },
  {
    edgeCase: 'orphans behind an inferred join (no foreign key)',
    where: 'LegacyOrders.customer_id → customers.id',
    sql: `SELECT count(*) AS n FROM ${S}."LegacyOrders" l WHERE NOT EXISTS (SELECT 1 FROM ${S}.customers c WHERE c.id = l.customer_id)`,
    expected: 52,
  },
  invalid('customers', 'email', 'email', 1_000),
  invalid('payments', 'payer_email', 'email', 750),
  invalid('customers', 'phone', 'phone', 500),
  invalid('shipments', 'tracking_url', 'url', 800),
  invalid('"LegacyOrders"', 'legacy_uuid', 'uuid', 20),
  invalid('customers', 'signup_date', 'date-string', 67),
  {
    edgeCase: 'postal codes that are not five digits (no readiness rule)',
    where: 'shipments.postal_code',
    sql: `SELECT count(*) AS n FROM ${S}.shipments WHERE postal_code !~ '^[0-9]{5}$'`,
    expected: 800,
  },
  collapsed('customers', 'country', 6),
  collapsed('shipments', 'country', 3),
  collapsed('products', 'color', 5),
  collapsed('payments', 'method', 3),
  {
    edgeCase: 'price outlier (1e9)',
    where: 'products.unit_price',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE unit_price >= 1000000000`,
    expected: 1,
  },
  {
    edgeCase: 'negative price',
    where: 'products.unit_price',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE unit_price < 0`,
    expected: 1,
  },
  {
    edgeCase: 'percentage above 100',
    where: 'products.margin_pct',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE margin_pct > 100`,
    expected: 5,
  },
  {
    edgeCase: 'end before start (some rows)',
    where: 'shipments.delivered_at < shipped_at',
    sql: `SELECT count(*) AS n FROM ${S}.shipments WHERE delivered_at < shipped_at`,
    expected: 3_000,
  },
  {
    edgeCase: 'end before start (every row: columns look swapped)',
    where: 'promotions.end_date < start_date',
    sql: `SELECT count(*) AS n FROM ${S}.promotions WHERE end_date < start_date`,
    expected: 40,
  },
  {
    edgeCase: 'stale table (newest row in 2015)',
    where: 'LegacyOrders.placed_at',
    sql: `SELECT to_char(max(placed_at), 'YYYY-MM-DD') AS n FROM ${S}."LegacyOrders"`,
    expected: '2015-02-19',
  },
  {
    edgeCase: 'ranking tie: products sharing the top revenue',
    where: 'v_product_revenue.revenue',
    sql: `SELECT count(*) AS n FROM ${S}.v_product_revenue WHERE revenue = (SELECT max(revenue) FROM ${S}.v_product_revenue)`,
    expected: 5,
  },
  {
    edgeCase: 'ranking tie: the tied revenue',
    where: 'v_product_revenue.revenue',
    sql: `SELECT max(revenue)::text AS n FROM ${S}.v_product_revenue`,
    expected: '50000000.00',
  },
  {
    edgeCase: 'duplicate product names',
    where: 'products.name',
    sql: `SELECT count(*) AS n FROM ${S}.products WHERE name = 'Classic Mug'`,
    expected: 5,
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

describeSmoke('Edge Cases sample, seeded on a live server', () => {
  jest.setTimeout(10 * 60_000);
  let client: Client;
  let loadMs = 0;

  beforeAll(async () => {
    await ensureDatabase();
    client = new Client({ ...connection, database });
    await client.connect();
    const started = Date.now();
    await client.query(`DROP SCHEMA IF EXISTS "${fixture.schema}" CASCADE`);
    await seedInBatches(client, readFixtureSql(fixture));
    loadMs = Date.now() - started;
    console.log(`Edge Cases seed loaded in ${(loadMs / 1000).toFixed(1)} s`);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('loads well within the seed timeout', () => {
    expect(loadMs).toBeLessThan(SEED_TIMEOUT_MS);
  });

  it('creates every required table and view', async () => {
    const result = await client.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'v', 'm')`,
      [fixture.schema],
    );
    const names = result.rows.map((row) => row.name).sort();
    expect(names).toEqual([...fixture.requiredTables].sort());
  });

  it.each(ROW_COUNTS)('%s holds %d rows', async (table, expected) => {
    const result = await client.query<{ n: string }>(rows(table));
    expect(Number(result.rows[0].n)).toBe(expected);
  });

  it('holds every documented edge case', async () => {
    const report: Array<Check & { actual: string }> = [];
    for (const check of CHECKS) {
      const result = await client.query<{ n: unknown }>(
        check.sql,
        check.params,
      );
      report.push({ ...check, actual: String(result.rows[0]?.n) });
    }
    console.log(
      report.map((r) => `${r.edgeCase} | ${r.where} | ${r.actual}`).join('\n'),
    );
    const wrong = report
      .filter((r) => r.actual !== String(r.expected))
      .map((r) => `${r.edgeCase} @ ${r.where}: ${r.actual} ≠ ${r.expected}`);
    expect(wrong).toEqual([]);
  });
});
