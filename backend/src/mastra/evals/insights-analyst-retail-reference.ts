/**
 * The reference data of the `insights-analyst-retail` set (agents.md 8.1;
 * docs/plans/insights-analyst-complex-evals.md, section 2): for every case,
 * the group it belongs to, what the run must end on, its difficulty, the
 * trusted reference SQL that reads the truth from the Retail Ops sample and,
 * where the case is built to catch a wrong query, the naive SQL that gives
 * the wrong figure. The set file takes its SQL from here, the smoke test of
 * the fixture runs it (reference returns at least one row without NULL; the
 * naive SQL differs from it by the plan's margin), and the future Agent
 * quality tab reads `expected` for clarification precision, recall and the
 * refusal rate. Plain data: no framework import.
 */

/** `<database>.<schema>`, as `edge_cases.edge_cases` in the edge set. */
export const S = 'retail_ops.retail_ops';

/** CL: completed lines with their order. */
export const CL =
  `FROM ${S}.order_lines l JOIN ${S}.orders o ON o.order_id = l.order_id ` +
  `AND o.status = 'completed'`;

/** The calendar year 2024 by the UTC order date. */
export const Y2024 = `o.order_date BETWEEN date '2024-01-01' AND date '2024-12-31'`;

/** A year of the order date, as a predicate on `o`. */
function yearOf(year: number): string {
  return `o.order_date BETWEEN date '${year}-01-01' AND date '${year}-12-31'`;
}

/** Lines to their product and the three levels of the category tree. */
const DEPARTMENT_OF_LINE =
  `JOIN ${S}.products p USING (product_id) ` +
  `JOIN ${S}.product_categories c3 ON c3.category_id = p.category_id ` +
  `JOIN ${S}.product_categories c2 ON c2.category_id = c3.parent_category_id ` +
  `JOIN ${S}.product_categories d ON d.category_id = c2.parent_category_id`;

/** Net revenue in USD of completed orders in `year`, by store code. */
function attainmentSql(storeCode: string, year: number, alias: string): string {
  return (
    `round(100.0 * (SELECT sum(l.net_amount_usd) ${CL} ` +
    `JOIN ${S}.stores s USING (store_id) WHERE s.store_code = '${storeCode}' ` +
    `AND ${yearOf(year)}) / (SELECT sum(t.target_usd) FROM ${S}.store_targets t ` +
    `JOIN ${S}.stores s USING (store_id) WHERE s.store_code = '${storeCode}' ` +
    `AND t.target_month BETWEEN date '${year}-01-01' AND date '${year}-12-01'), 1) AS ${alias}`
  );
}

export type IarGroup =
  | 'lookup'
  | 'aggregation'
  | 'join'
  | 'period'
  | 'top-n'
  | 'tie'
  | 'ratio'
  | 'cohort-funnel'
  | 'distinct'
  | 'null-empty'
  | 'duplicates'
  | 'refunds'
  | 'fiscal'
  | 'naive-wrong'
  | 'multi-step'
  | 'clear-twin'
  | 'clarify'
  | 'coverage';

export interface IarCase {
  group: IarGroup;
  /** What the run must end on. */
  expected: 'answer' | 'clarification' | 'not-covered';
  difficulty: 'easy' | 'medium' | 'hard';
  /** Trusted read-only SQL, `retail_ops.retail_ops.`-qualified. */
  referenceSql?: string;
  /** The wrong query the case is built to catch. */
  naiveSql?: string;
  /** The ambiguous case this one is the clear twin of. */
  twinOf?: string;
}

const NET_2024_BY_STORE =
  `SELECT s.store_name, round(sum(l.net_amount_usd), 2) AS net ${CL} ` +
  `JOIN ${S}.stores s USING (store_id) WHERE ${Y2024} ` +
  `GROUP BY s.store_id, s.store_name ORDER BY sum(l.net_amount_usd) DESC LIMIT 1`;

export const IAR_CASES: Record<string, IarCase> = {
  // A. Simple lookups
  'iar-lookup-stores-germany': {
    group: 'lookup',
    expected: 'answer',
    difficulty: 'easy',
    referenceSql:
      `SELECT count(*) AS stores FROM ${S}.stores s JOIN ${S}.countries c ` +
      `USING (country_code) WHERE c.country_name = 'Germany'`,
  },
  'iar-lookup-price-on-date': {
    group: 'lookup',
    expected: 'answer',
    difficulty: 'easy',
    referenceSql:
      `SELECT h.list_price_usd AS price FROM ${S}.product_price_history h ` +
      `JOIN ${S}.products p USING (product_id) WHERE p.sku = 'SKU-0009' ` +
      `AND h.valid_from <= date '2023-03-15' ` +
      `AND (h.valid_to IS NULL OR h.valid_to >= date '2023-03-15')`,
    naiveSql: `SELECT list_price_usd AS price FROM ${S}.products WHERE sku = 'SKU-0009'`,
  },
  // B. Aggregations
  'iar-agg-net-revenue-2024': {
    group: 'aggregation',
    expected: 'answer',
    difficulty: 'medium',
    referenceSql: `SELECT round(sum(l.net_amount_usd), 2) AS net ${CL} WHERE ${Y2024}`,
    // Local currencies added as if they were dollars.
    naiveSql: `SELECT round(sum(l.net_amount), 2) AS net ${CL} WHERE ${Y2024}`,
  },
  'iar-agg-orders-per-status': {
    group: 'aggregation',
    expected: 'answer',
    difficulty: 'easy',
    referenceSql: `SELECT status, count(*) AS orders FROM ${S}.orders GROUP BY 1 ORDER BY 1`,
  },
  // C. Joins across 3 or more tables
  'iar-join-top-region-2024': {
    group: 'join',
    expected: 'answer',
    difficulty: 'medium',
    referenceSql:
      `SELECT r.region_name, round(sum(l.net_amount_usd), 2) AS net ${CL} ` +
      `JOIN ${S}.stores s USING (store_id) JOIN ${S}.countries c USING (country_code) ` +
      `JOIN ${S}.regions r USING (region_id) WHERE ${Y2024} GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
  },
  'iar-join-top-department-units-2024': {
    group: 'join',
    expected: 'answer',
    difficulty: 'medium',
    referenceSql:
      `SELECT d.category_name AS department, sum(l.quantity) AS units ${CL} ` +
      `${DEPARTMENT_OF_LINE} WHERE ${Y2024} GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
    twinOf: 'iar-clarify-strongest-category',
  },
  // D. Period over period
  'iar-pop-yoy-net-revenue': {
    group: 'period',
    expected: 'answer',
    difficulty: 'medium',
    referenceSql:
      `SELECT round(100.0 * (sum(l.net_amount_usd) FILTER (WHERE o.order_date >= date '2024-01-01') / ` +
      `sum(l.net_amount_usd) FILTER (WHERE o.order_date < date '2024-01-01') - 1), 1) AS growth_pct ` +
      `${CL} WHERE o.order_date >= date '2023-01-01'`,
  },
  'iar-pop-orders-nov-dec-2024': {
    group: 'period',
    expected: 'answer',
    difficulty: 'medium',
    referenceSql:
      `SELECT count(*) FILTER (WHERE order_date < date '2024-12-01') AS november, ` +
      `count(*) FILTER (WHERE order_date >= date '2024-12-01') AS december ` +
      `FROM ${S}.orders WHERE status = 'completed' ` +
      `AND order_date BETWEEN date '2024-11-01' AND date '2024-12-31'`,
    // December's pending orders counted.
    naiveSql:
      `SELECT count(*) FILTER (WHERE order_date < date '2024-12-01') AS november, ` +
      `count(*) FILTER (WHERE order_date >= date '2024-12-01') AS december ` +
      `FROM ${S}.orders WHERE status IN ('completed', 'pending') ` +
      `AND order_date BETWEEN date '2024-11-01' AND date '2024-12-31'`,
  },
  // E. Top N per group
  'iar-topn-product-per-department-2024': {
    group: 'top-n',
    expected: 'answer',
    difficulty: 'hard',
    referenceSql:
      `SELECT department, product_name FROM (SELECT d.category_name AS department, p.product_name, ` +
      `rank() OVER (PARTITION BY d.category_id ORDER BY sum(l.net_amount_usd) DESC) AS rk ` +
      `${CL} ${DEPARTMENT_OF_LINE} WHERE ${Y2024} ` +
      `GROUP BY d.category_id, d.category_name, p.product_name) t WHERE rk = 1 ORDER BY 1`,
  },
  // F. Ranking ties
  'iar-tie-top-3-products-units-2024': {
    group: 'tie',
    expected: 'answer',
    difficulty: 'hard',
    referenceSql:
      `SELECT product_name, units FROM (SELECT p.product_name, sum(l.quantity) AS units, ` +
      `rank() OVER (ORDER BY sum(l.quantity) DESC) AS rk ${CL} ` +
      `JOIN ${S}.products p USING (product_id) WHERE ${Y2024} GROUP BY 1) t WHERE rk <= 3 ORDER BY units DESC, product_name`,
    // LIMIT 3 drops the fourth, tied product.
    naiveSql:
      `SELECT p.product_name, sum(l.quantity) AS units ${CL} ` +
      `JOIN ${S}.products p USING (product_id) WHERE ${Y2024} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 3`,
    twinOf: 'iar-clarify-top-products',
  },
  'iar-tie-most-used-promotion': {
    group: 'tie',
    expected: 'answer',
    difficulty: 'hard',
    referenceSql:
      `SELECT promotion_name, orders FROM (SELECT pr.promotion_name, count(*) AS orders, ` +
      `rank() OVER (ORDER BY count(*) DESC) AS rk FROM ${S}.order_promotions op ` +
      `JOIN ${S}.promotions pr USING (promotion_id) GROUP BY 1) t WHERE rk = 1 ORDER BY 1`,
  },
  // G. Ratios and shares
  'iar-share-online-2024': {
    group: 'ratio',
    expected: 'answer',
    difficulty: 'medium',
    referenceSql:
      `SELECT round(100.0 * sum(l.net_amount_usd) FILTER (WHERE s.channel = 'online') / ` +
      `sum(l.net_amount_usd), 1) AS share_pct ${CL} JOIN ${S}.stores s USING (store_id) WHERE ${Y2024}`,
  },
  'iar-ratio-cancelled-orders': {
    group: 'ratio',
    expected: 'answer',
    difficulty: 'easy',
    referenceSql:
      `SELECT round(100.0 * count(*) FILTER (WHERE status = 'cancelled') / count(*), 1) AS cancelled_pct ` +
      `FROM ${S}.orders`,
  },
  'iar-ratio-target-attainment-us-01-2024': {
    group: 'ratio',
    expected: 'answer',
    difficulty: 'hard',
    referenceSql: `SELECT ${attainmentSql('US-01', 2024, 'attainment_pct')}`,
    // Lines joined to the 12 target rows before summing: 12 times the revenue.
    naiveSql:
      `SELECT round(100.0 * sum(l.net_amount_usd) / sum(t.target_usd), 1) AS attainment_pct ${CL} ` +
      `JOIN ${S}.stores s USING (store_id) JOIN ${S}.store_targets t ON t.store_id = s.store_id ` +
      `AND t.target_month BETWEEN date '2024-01-01' AND date '2024-12-01' ` +
      `WHERE s.store_code = 'US-01' AND ${Y2024}`,
  },
  // H. Cohort and funnel
  'iar-cohort-2022-retained-2024': {
    group: 'cohort-funnel',
    expected: 'answer',
    difficulty: 'hard',
    referenceSql:
      `WITH f AS (SELECT customer_id, min(order_date) AS first_date FROM ${S}.orders ` +
      `WHERE status = 'completed' GROUP BY 1) SELECT count(*) AS retained FROM f ` +
      `WHERE first_date < date '2023-01-01' AND EXISTS (SELECT 1 FROM ${S}.orders o ` +
      `WHERE o.customer_id = f.customer_id AND o.status = 'completed' AND o.order_date >= date '2024-01-01')`,
  },
  'iar-funnel-cart-to-purchase-2024': {
    group: 'cohort-funnel',
    expected: 'answer',
    difficulty: 'hard',
    referenceSql:
      `SELECT round(100.0 * count(DISTINCT e.session_id) FILTER (WHERE e.stage = 'purchase') / ` +
      `count(DISTINCT e.session_id) FILTER (WHERE e.stage = 'add_to_cart'), 1) AS conversion_pct ` +
      `FROM ${S}.funnel_events e JOIN ${S}.web_sessions w USING (session_id) ` +
      `WHERE w.started_at >= timestamptz '2024-01-01 00:00:00+00' AND w.started_at < timestamptz '2025-01-01 00:00:00+00'`,
    // Event rows instead of sessions: the duplicated add_to_cart rows count twice.
    naiveSql:
      `SELECT round(100.0 * count(*) FILTER (WHERE e.stage = 'purchase') / ` +
      `count(*) FILTER (WHERE e.stage = 'add_to_cart'), 1) AS conversion_pct ` +
      `FROM ${S}.funnel_events e JOIN ${S}.web_sessions w USING (session_id) ` +
      `WHERE w.started_at >= timestamptz '2024-01-01 00:00:00+00' AND w.started_at < timestamptz '2025-01-01 00:00:00+00'`,
  },
  // I. Distinct-count traps
  'iar-distinct-buyers-2024': {
    group: 'distinct',
    expected: 'answer',
    difficulty: 'medium',
    referenceSql:
      `SELECT count(DISTINCT customer_id) AS buyers FROM ${S}.orders WHERE status = 'completed' ` +
      `AND order_date BETWEEN date '2024-01-01' AND date '2024-12-31'`,
    naiveSql:
      `SELECT count(customer_id) AS buyers FROM ${S}.orders WHERE status = 'completed' ` +
      `AND order_date BETWEEN date '2024-01-01' AND date '2024-12-31'`,
  },
  'iar-distinct-emails-ignoring-case': {
    group: 'distinct',
    expected: 'answer',
    difficulty: 'medium',
    referenceSql: `SELECT count(DISTINCT lower(trim(email))) AS emails FROM ${S}.customers WHERE email IS NOT NULL`,
    naiveSql: `SELECT count(DISTINCT email) AS emails FROM ${S}.customers WHERE email IS NOT NULL`,
  },
  // J. NULLs and an empty table
  'iar-null-products-without-cost': {
    group: 'null-empty',
    expected: 'answer',
    difficulty: 'easy',
    referenceSql: `SELECT count(*) AS products FROM ${S}.products WHERE NOT is_deleted AND unit_cost_usd IS NULL`,
  },
  'iar-empty-loyalty-redemptions': {
    group: 'null-empty',
    expected: 'answer',
    difficulty: 'easy',
    referenceSql: `SELECT count(*) AS redemptions FROM ${S}.loyalty_redemptions`,
  },
  // K. Case and whitespace duplicates
  'iar-dupes-acme-net-revenue-2024': {
    group: 'duplicates',
    expected: 'answer',
    difficulty: 'medium',
    referenceSql:
      `SELECT round(sum(l.net_amount_usd), 2) AS net ${CL} JOIN ${S}.products p USING (product_id) ` +
      `WHERE lower(trim(p.brand)) = 'acme' AND ${Y2024}`,
    naiveSql:
      `SELECT round(sum(l.net_amount_usd), 2) AS net ${CL} JOIN ${S}.products p USING (product_id) ` +
      `WHERE p.brand = 'Acme' AND ${Y2024}`,
  },
  // L. Refunds
  'iar-refunds-net-after-returns-2024': {
    group: 'refunds',
    expected: 'answer',
    difficulty: 'hard',
    referenceSql:
      `SELECT round((SELECT sum(l.net_amount_usd) ${CL} WHERE ${Y2024}) - ` +
      `(SELECT coalesce(sum(r.refund_amount_usd), 0) FROM ${S}.returns r ` +
      `JOIN ${S}.order_lines l USING (line_id) JOIN ${S}.orders o USING (order_id) ` +
      `WHERE o.status = 'completed' AND ${Y2024}), 2) AS net_after_refunds`,
    // The total before refunds: refunds are 2.7% of it, which the 0.4% tolerance of the check tells apart.
    naiveSql: `SELECT round(sum(l.net_amount_usd), 2) AS net_after_refunds ${CL} WHERE ${Y2024}`,
  },
  // M. Fiscal calendar
  'iar-fiscal-net-revenue-fy2023': {
    group: 'fiscal',
    expected: 'answer',
    difficulty: 'medium',
    referenceSql:
      `SELECT round(sum(l.net_amount_usd), 2) AS net ${CL} ` +
      `JOIN ${S}.calendar c ON c.date_key = o.order_date WHERE c.fiscal_year = 2023`,
    naiveSql: `SELECT round(sum(l.net_amount_usd), 2) AS net ${CL} WHERE ${yearOf(2023)}`,
  },
  // N. Naive SQL gives a wrong answer
  'iar-naive-tokyo-local-december-2024': {
    group: 'naive-wrong',
    expected: 'answer',
    difficulty: 'hard',
    referenceSql:
      `SELECT count(*) AS orders FROM ${S}.orders o JOIN ${S}.stores s USING (store_id) ` +
      `WHERE s.store_name = 'Tokyo Ginza' AND o.status = 'completed' ` +
      `AND (o.ordered_at AT TIME ZONE s.time_zone)::date BETWEEN date '2024-12-01' AND date '2024-12-31'`,
    naiveSql:
      `SELECT count(*) AS orders FROM ${S}.orders o JOIN ${S}.stores s USING (store_id) ` +
      `WHERE s.store_name = 'Tokyo Ginza' AND o.status = 'completed' ` +
      `AND o.order_date BETWEEN date '2024-12-01' AND date '2024-12-31'`,
  },
  'iar-naive-net-revenue-with-promotion': {
    group: 'naive-wrong',
    expected: 'answer',
    difficulty: 'hard',
    referenceSql:
      `SELECT round(sum(l.net_amount_usd), 2) AS net ${CL} WHERE EXISTS ` +
      `(SELECT 1 FROM ${S}.order_promotions op WHERE op.order_id = o.order_id)`,
    // The join repeats the lines of an order with two promotions.
    naiveSql:
      `SELECT round(sum(l.net_amount_usd), 2) AS net ${CL} ` +
      `JOIN ${S}.order_promotions op ON op.order_id = o.order_id`,
  },
  // O. Multi-step
  'iar-multistep-top-store-then-product-2024': {
    group: 'multi-step',
    expected: 'answer',
    difficulty: 'hard',
    referenceSql:
      `WITH top AS (SELECT o.store_id ${CL} WHERE ${Y2024} GROUP BY 1 ` +
      `ORDER BY sum(l.net_amount_usd) DESC LIMIT 1) ` +
      `SELECT s.store_name, p.product_name ${CL} JOIN top USING (store_id) ` +
      `JOIN ${S}.stores s USING (store_id) JOIN ${S}.products p USING (product_id) ` +
      `WHERE ${Y2024} GROUP BY 1, 2 ORDER BY sum(l.quantity) DESC LIMIT 1`,
  },
  'iar-multistep-stores-above-average-2024': {
    group: 'multi-step',
    expected: 'answer',
    difficulty: 'hard',
    referenceSql:
      `WITH r AS (SELECT o.store_id, sum(l.net_amount_usd) AS net ${CL} ` +
      `JOIN ${S}.stores s USING (store_id) WHERE s.channel = 'retail' AND ${Y2024} GROUP BY 1) ` +
      `SELECT count(*) AS stores FROM r WHERE net > (SELECT avg(net) FROM r)`,
  },
  // P. Clear twins of the ambiguous questions
  'iar-noclarify-top-store-net-revenue-2024': {
    group: 'clear-twin',
    expected: 'answer',
    difficulty: 'medium',
    referenceSql: NET_2024_BY_STORE,
    twinOf: 'iar-clarify-best-store',
  },
  'iar-noclarify-top-5-customers-net-revenue': {
    group: 'clear-twin',
    expected: 'answer',
    difficulty: 'medium',
    referenceSql:
      `SELECT c.full_name ${CL} JOIN ${S}.customers c USING (customer_id) ` +
      `GROUP BY c.customer_id, c.full_name ORDER BY sum(l.net_amount_usd) DESC LIMIT 5`,
    twinOf: 'iar-clarify-most-valuable-customers',
  },
  // Q. Ambiguous: must clarify
  'iar-clarify-best-store': {
    group: 'clarify',
    expected: 'clarification',
    difficulty: 'easy',
  },
  'iar-clarify-most-valuable-customers': {
    group: 'clarify',
    expected: 'clarification',
    difficulty: 'easy',
  },
  'iar-clarify-strongest-category': {
    group: 'clarify',
    expected: 'clarification',
    difficulty: 'easy',
  },
  'iar-clarify-top-products': {
    group: 'clarify',
    expected: 'clarification',
    difficulty: 'easy',
  },
  // R. Out of coverage: must say so
  'iar-coverage-net-revenue-2021': {
    group: 'coverage',
    expected: 'not-covered',
    difficulty: 'medium',
    // The 2022 total, which the answer must not present for 2021.
    referenceSql: `SELECT round(sum(l.net_amount_usd), 2) AS net ${CL} WHERE ${yearOf(2022)}`,
  },
  'iar-coverage-targets-2022': {
    group: 'coverage',
    expected: 'not-covered',
    difficulty: 'medium',
    // The attainment of the two years that have targets, which the answer must not give for 2022.
    referenceSql: `SELECT ${attainmentSql('US-01', 2023, 'attainment_2023')}, ${attainmentSql('US-01', 2024, 'attainment_2024')}`,
  },
  'iar-coverage-marketing-spend': {
    group: 'coverage',
    expected: 'not-covered',
    difficulty: 'medium',
  },
};

/** The attainment SQL of a year, for the coverage case's own check. */
export { attainmentSql, yearOf };
