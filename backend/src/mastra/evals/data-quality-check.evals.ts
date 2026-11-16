import type { AssistantEvalSet } from './assistant.evals';
import { isolatedCase } from './isolated-call-target';
import type { DataQualityEvalInput } from './isolated-call-targets';
import {
  findingsInRange,
  noChatReply,
  picksExactly,
  replyIsIssues,
} from './data-quality-check-eval-checks';

/**
 * The eval set of Sarah's Check data quality call (agents.md 8.1, 5.11,
 * epic M1-29 story 1.29.4), run on the `data-readiness:check-data-quality`
 * target over the Edge Cases sample. A case is the frozen request Sarah gets
 * in the Answer a Business Question workflow: the question, the tables, the
 * SQL (no rows) and the engine's numbered findings. The findings are written
 * as the readiness checks write them (`engine/checks/*.check.ts`) with the
 * counts the sample holds (testing-data R24), most severe first.
 *
 * Border cases: the columns the SQL uses against the ones it does not; no
 * findings; 30 findings with two relevant; a finding number outside the list;
 * a question that is no readiness question (Sarah is served her chat prompt,
 * agents.md 5.11: she must still answer JSON); an awkward column name; a
 * duplicate key on a table the SQL aggregates.
 */

export const DATA_QUALITY_CHECK_EVAL_FIXTURE_ID = 'edge-cases';

type EngineFinding = DataQualityEvalInput['findings'][number];

const SEVERITY_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
};

/** One catalogue finding, as the engine's check words it. */
const finding = (
  severity: string,
  dimension: string,
  entity: string,
  field: string | undefined,
  description: string,
): EngineFinding => ({
  severity,
  dimension,
  entity: `edge_cases.${entity}`,
  ...(field ? { field } : {}),
  description,
});

/** The findings the Edge Cases sample's checks produce (counts: R24). */
const FINDINGS = {
  orphanOrderLines: finding(
    'high',
    'integrity',
    'order_lines',
    'order_id',
    '"edge_cases.order_lines.order_id" has 20 value(s) with no matching "edge_cases.orders.id".',
  ),
  orphanProductLines: finding(
    'medium',
    'integrity',
    'order_lines',
    'product_id',
    '"edge_cases.order_lines.product_id" has 25 value(s) with no matching "edge_cases.products.id" (inferred relationship — no FK is declared; matched by naming convention).',
  ),
  orphanLegacyCustomer: finding(
    'medium',
    'integrity',
    'LegacyOrders',
    'customer_id',
    '"edge_cases.LegacyOrders.customer_id" has 52 value(s) with no matching "edge_cases.customers.id" (inferred relationship — no FK is declared; matched by naming convention).',
  ),
  faxEmpty: finding(
    'high',
    'completeness',
    'customers',
    'fax',
    'Column "fax" is missing values in 50000 of 50000 rows.',
  ),
  emailInvalid: finding(
    'medium',
    'validity',
    'customers',
    'email',
    'Column "email" has 1000 value(s) that don\'t match a valid email.',
  ),
  phoneInvalid: finding(
    'medium',
    'validity',
    'customers',
    'phone',
    'Column "phone" has 500 value(s) that don\'t match a valid phone.',
  ),
  middleNameNulls: finding(
    'medium',
    'completeness',
    'customers',
    'middle_name',
    'Column "middle_name" is missing values in 25000 of 50000 rows.',
  ),
  birthDateOld: finding(
    'medium',
    'reasonability',
    'customers',
    'birth_date',
    'Column "birth_date" has implausibly old values (earliest year 1899).',
  ),
  orderNotesNulls: finding(
    'medium',
    'completeness',
    'orders',
    'Order Notes',
    'Column "Order Notes" is missing values in 148500 of 300000 rows.',
  ),
  deliveryFuture: finding(
    'medium',
    'reasonability',
    'orders',
    'expected_delivery_date',
    'Column "expected_delivery_date" has future-dated values (latest year 2999).',
  ),
  trackingUrlInvalid: finding(
    'medium',
    'validity',
    'shipments',
    'tracking_url',
    'Column "tracking_url" has 800 value(s) that don\'t match a valid url.',
  ),
  payerEmailInvalid: finding(
    'medium',
    'validity',
    'payments',
    'payer_email',
    'Column "payer_email" has 750 value(s) that don\'t match a valid email.',
  ),
  legacyIdDuplicates: finding(
    'medium',
    'uniqueness',
    'LegacyOrders',
    'legacy_order_id',
    'Column "legacy_order_id" looks like an identifier (inferred — no key is declared) but carries 250 duplicate value(s).',
  ),
  legacyStale: finding(
    'medium',
    'timeliness',
    'LegacyOrders',
    'order_date',
    'The most recent record in "LegacyOrders" is 812 days old (by "order_date").',
  ),
};

type Key = keyof typeof FINDINGS;

/** Filler findings on the wide table: 26 columns, most severe first. */
const WIDE_FILLERS: EngineFinding[] = Array.from({ length: 26 }, (_, i) => {
  const column = `attr_${String(i + 1).padStart(2, '0')}`;
  const nulls = 1000 + i * 350;
  return finding(
    i < 8 ? 'medium' : 'low',
    'completeness',
    'customer_profile_wide',
    column,
    `Column "${column}" is missing values in ${nulls} of 20000 rows.`,
  );
});

/** A request's findings, most severe first (ties keep their order). */
function sortedFindings(items: EngineFinding[]): EngineFinding[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.item.severity] - SEVERITY_RANK[b.item.severity] ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

/** The number (from 1) of a finding in a request's list. */
function numberOf(list: EngineFinding[], key: Key): number {
  return list.indexOf(FINDINGS[key]) + 1;
}

interface Scenario {
  id: string;
  intent: string;
  question: string;
  tables: string[];
  sql: string[];
  findings: EngineFinding[];
  /** The findings that affect the answer. */
  relevant: Key[];
  /** Judge: what the impact sentences must say. */
  impactRule?: string;
}

/** One pass condition, as every rubric states it. */
const impactRubric = (question: string, rule: string) =>
  `The reply lists engine findings that affect the answer to: "${question}". ` +
  `Score pass=true only if every impact sentence says how its finding changes or limits THIS answer (${rule}), ` +
  'not a generic data-quality remark. Score pass=false if an impact is generic, ' +
  'repeats the finding without tying it to the question, or is empty.';

const SCENARIOS: Scenario[] = (() => {
  const topCustomers = sortedFindings([
    FINDINGS.emailInvalid,
    FINDINGS.faxEmpty,
    FINDINGS.orphanOrderLines,
    FINDINGS.legacyStale,
    FINDINGS.phoneInvalid,
  ]);
  const faxList = sortedFindings([
    FINDINGS.faxEmpty,
    FINDINGS.emailInvalid,
    FINDINGS.orphanOrderLines,
  ]);
  const wide = sortedFindings([
    ...WIDE_FILLERS,
    FINDINGS.emailInvalid,
    FINDINGS.birthDateOld,
    FINDINGS.phoneInvalid,
    FINDINGS.orphanLegacyCustomer,
  ]);
  const small = sortedFindings([
    FINDINGS.trackingUrlInvalid,
    FINDINGS.payerEmailInvalid,
    FINDINGS.deliveryFuture,
  ]);
  const unrelated = sortedFindings([
    FINDINGS.emailInvalid,
    FINDINGS.orphanProductLines,
    FINDINGS.phoneInvalid,
  ]);
  const notes = sortedFindings([
    FINDINGS.faxEmpty,
    FINDINGS.orderNotesNulls,
    FINDINGS.deliveryFuture,
  ]);
  const legacy = sortedFindings([
    FINDINGS.orphanLegacyCustomer,
    FINDINGS.emailInvalid,
    FINDINGS.legacyIdDuplicates,
  ]);
  return [
    {
      id: 'dq-picks-used-columns-only',
      intent:
        'Findings on the columns the SQL selects, joins and groups by are picked (customers.email, the order_lines orphans); the 100% null fax, the phone and LegacyOrders staleness, which the SQL never touches, are not.',
      question: 'Which 10 customers spent the most, with their email?',
      tables: [
        'edge_cases.customers',
        'edge_cases.orders',
        'edge_cases.order_lines',
      ],
      sql: [
        'SELECT c.id, c.email, SUM(ol.quantity * ol.unit_price) AS spent FROM edge_cases.customers c JOIN edge_cases.orders o ON o.customer_id = c.id JOIN edge_cases.order_lines ol ON ol.order_id = o.id GROUP BY c.id, c.email ORDER BY spent DESC LIMIT 10',
      ],
      findings: topCustomers,
      relevant: ['emailInvalid', 'orphanOrderLines'],
      impactRule:
        'the email shown for a top customer may be invalid; revenue of order lines without an order is missing from the totals',
    },
    {
      id: 'dq-fully-null-column-used',
      intent:
        'A column that is 100% null (customers.fax) is exactly what the SQL counts: its finding is the one that explains the answer, the email and orphan findings are not.',
      question: 'How many customers have a fax number?',
      tables: ['edge_cases.customers'],
      sql: ['SELECT COUNT(fax) AS with_fax FROM edge_cases.customers'],
      findings: faxList,
      relevant: ['faxEmpty'],
      impactRule:
        'the fax column is empty in every row, so the count is 0 because nothing was recorded',
    },
    {
      id: 'dq-no-findings',
      intent:
        'The engine found nothing on the tables: the list is empty and Sarah invents no issue.',
      question: 'How many products are in each category?',
      tables: ['edge_cases.products', 'edge_cases.categories'],
      sql: [
        'SELECT cat.name, COUNT(*) AS products FROM edge_cases.products p JOIN edge_cases.categories cat ON cat.id = p.category_id GROUP BY cat.name',
      ],
      findings: [],
      relevant: [],
    },
    {
      id: 'dq-thirty-findings-two-relevant',
      intent:
        'The cap of 30 findings: 26 are on a wide table the SQL never reads; only the email filter and the birth_date aggregate matter, wherever they sit in the list.',
      question:
        'What is the average age of customers with a valid email, by tier?',
      tables: ['edge_cases.customers'],
      sql: [
        'SELECT c."CustomerTier" AS tier, COUNT(*) AS customers, AVG(EXTRACT(year FROM age(c.birth_date))) AS average_age FROM edge_cases.customers c WHERE c.email LIKE \'%@%\' GROUP BY c."CustomerTier"',
      ],
      findings: wide,
      relevant: ['emailInvalid', 'birthDateOld'],
      impactRule:
        'invalid emails slip through the filter; birth dates as old as 1899 pull the average age',
    },
    {
      id: 'dq-small-list-numbers-in-range',
      intent:
        'A list of three findings: a finding number must be one of 1 to 3 (no 0, no 4); only the future-dated delivery column, which the SQL filters on, matters.',
      question: 'How many orders are expected to arrive after 2030?',
      tables: ['edge_cases.orders'],
      sql: [
        "SELECT COUNT(*) AS late_orders FROM edge_cases.orders WHERE expected_delivery_date > DATE '2030-01-01'",
      ],
      findings: small,
      relevant: ['deliveryFuture'],
      impactRule:
        'the far-future delivery dates (year 2999) are placeholders that inflate the count',
    },
    {
      id: 'dq-non-readiness-question',
      intent:
        'A business question that is no readiness question: Sarah, served her chat prompt, must still answer JSON issues (never decline, never prose) and pick the product orphans, which drop revenue from a join.',
      question: 'What are the top 5 products by revenue?',
      tables: ['edge_cases.products', 'edge_cases.order_lines'],
      sql: [
        'SELECT p.name, SUM(ol.quantity * ol.unit_price) AS revenue FROM edge_cases.order_lines ol JOIN edge_cases.products p ON p.id = ol.product_id GROUP BY p.name ORDER BY revenue DESC LIMIT 5',
      ],
      findings: unrelated,
      relevant: ['orphanProductLines'],
      impactRule:
        'order lines whose product does not exist are dropped by the join, so their revenue is missing',
    },
    {
      id: 'dq-awkward-column-name',
      intent:
        'A column name with a space ("Order Notes"): its finding matches the quoted column in the SQL; the fax finding does not.',
      question: 'How many orders have no notes?',
      tables: ['edge_cases.orders'],
      sql: [
        'SELECT COUNT(*) AS without_notes FROM edge_cases.orders WHERE "Order Notes" IS NULL',
      ],
      findings: notes,
      relevant: ['orderNotesNulls'],
      impactRule:
        'about half of the orders have no notes, which is what the count measures',
    },
    {
      id: 'dq-duplicate-key-aggregated-table',
      intent:
        'LegacyOrders has no key and 250 duplicate legacy_order_id values; the SQL counts and sums its rows, so the duplicate finding is relevant. The customer orphans and the email finding are on joins and tables it does not use.',
      question: 'What is the total value and the number of legacy orders?',
      tables: ['edge_cases.LegacyOrders'],
      sql: [
        'SELECT COUNT(*) AS orders, SUM("OrderTotal") AS total FROM edge_cases."LegacyOrders"',
      ],
      findings: legacy,
      relevant: ['legacyIdDuplicates'],
      impactRule:
        'duplicate legacy order ids mean the count and the total may count an order more than once',
    },
  ] satisfies Scenario[];
})();

/** The finding numbers each case expects, by case id (the set's truth). */
export const DATA_QUALITY_EXPECTED_PICKS: Record<string, number[]> =
  Object.fromEntries(
    SCENARIOS.map((s) => [
      s.id,
      s.relevant.map((key) => numberOf(s.findings, key)),
    ]),
  );

export const DATA_QUALITY_CHECK_EVAL_CASES = SCENARIOS.map((s) =>
  isolatedCase<DataQualityEvalInput>({
    id: s.id,
    question: s.question,
    intent: s.intent,
    scorers: [],
    customChecks: [
      replyIsIssues(),
      findingsInRange(s.findings.length),
      picksExactly(DATA_QUALITY_EXPECTED_PICKS[s.id]),
      noChatReply(),
    ],
    ...(s.impactRule
      ? { judgeRubric: impactRubric(s.question, s.impactRule) }
      : {}),
    input: {
      question: s.question,
      tables: s.tables,
      sql: s.sql,
      findings: s.findings,
    },
  }),
);

export const DATA_QUALITY_CHECK_EVAL_SET: AssistantEvalSet = {
  id: 'data-quality-check',
  name: 'Check data quality',
  description:
    "Sarah's Check data quality call in Answer a Business Question over the " +
    'Edge Cases sample: one request per case (question, tables, SQL, numbered ' +
    'engine findings), answered with the findings that affect the answer. ' +
    'Load the "Edge Cases" sample in Settings → Testing Data and run against ' +
    'its datasource.',
  fixtureId: DATA_QUALITY_CHECK_EVAL_FIXTURE_ID,
  agentKey: 'data-readiness',
  target: 'data-readiness:check-data-quality',
  cases: DATA_QUALITY_CHECK_EVAL_CASES,
};
