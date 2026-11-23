import { checks } from '@mastra/evals/checks';
import type {
  AssistantEvalCase,
  AssistantEvalSet,
  EvalCustomCheck,
} from './assistant.evals';
import {
  answerSaysNoRows,
  answerStatesEachCount,
} from './insights-analyst-edge-checks';
import {
  endsOnClarifyingQuestion,
  hasMarkdownTable,
  ranSuccessfulSql,
  answerStatesNone,
} from './insights-analyst-eval-checks';
import {
  answerHasFigure,
  answersWithoutClarifying,
} from './insights-analyst-retail-checks';
import { IAR_CASES } from './insights-analyst-retail-reference';
import {
  answerHasNumber,
  answerMentionsAll,
  sqlTruthCheck,
  type SqlTruthComparator,
} from './sql-truth-check';

/**
 * The `insights-analyst-retail` eval set (agents.md 8.1; plan
 * docs/plans/insights-analyst-complex-evals.md): Michael through the whole
 * Answer a Business Question workflow on the Retail Ops sample, 36 questions
 * in 18 groups. Every figure is read with live SQL at eval time
 * (`sqlTruthCheck` over the reference SQL of `IAR_CASES`); 29 cases must be
 * answered, 4 must end on a clarifying question and 3 must say the data does
 * not cover the question. Judges only grade the 3 out-of-coverage cases.
 */

/** The reference SQL of a case, from the shared data. */
function referenceOf(id: string): string {
  const sql = IAR_CASES[id]?.referenceSql;
  if (!sql) throw new Error(`${id} has no reference SQL`);
  return sql;
}

/** A truth check named `<case id>-<column>` over the case's reference SQL. */
function truth(
  id: string,
  column: string,
  description: string,
  compare: SqlTruthComparator,
  sql: string = referenceOf(id),
): EvalCustomCheck {
  return sqlTruthCheck({ id: `${id}-${column}`, description, sql, compare });
}

/** N(col): the exact number. */
const exact = (id: string, column: string, what: string) =>
  truth(
    id,
    column,
    `The answer states the ${what} the data holds`,
    answerHasNumber(column),
  );
/** P(col): a percentage the reference rounds to one decimal. */
const percent = (id: string, column: string, what: string) =>
  truth(
    id,
    column,
    `The answer states the ${what} the data holds (within 0.6 points)`,
    answerHasNumber(column, { tolerance: 0.6 }),
  );
/** F(col): a money figure, in digits or scaled. */
const figure = (
  id: string,
  column: string,
  what: string,
  options?: { relative?: number },
) =>
  truth(
    id,
    column,
    `The answer states the ${what} the data holds (within ${(options?.relative ?? 0.01) * 100}%)`,
    answerHasFigure(column, options),
  );
/** M(col): every value of the column named. */
const mentions = (id: string, column: string, what: string) =>
  truth(id, column, `The answer names ${what}`, answerMentionsAll(column));

/** An answer case: no tool error, a query ran, and the run did not turn into a question. */
function answerCase(
  id: string,
  question: string,
  intent: string,
  customChecks: EvalCustomCheck[],
): AssistantEvalCase {
  return {
    id,
    question,
    intent,
    scorers: [checks.noToolErrors()],
    customChecks: [
      ranSuccessfulSql(),
      answersWithoutClarifying(),
      ...customChecks,
    ],
  };
}

/** A clarification case: the run asks, runs no query. */
function clarifyCase(
  id: string,
  question: string,
  intent: string,
): AssistantEvalCase {
  return {
    id,
    question,
    intent,
    scorers: [checks.didNotCall('run_readonly_sql'), checks.noToolErrors()],
    customChecks: [endsOnClarifyingQuestion()],
  };
}

/**
 * Added to every coverage rubric. The workflow hands Plan the dataset catalog,
 * so "no such table or column" needs no tool call; and a refusal may end by
 * offering other measures as a question (baseline 2026-11-22: Opus 5.5 did so
 * 3 of 3 on the ROAS case, giving no figure).
 */
const COVERAGE_RUBRIC_NOTE =
  'The workflow is given the data catalog, so a claim that the data lacks a table or column needs no tool call. Ending with a question that offers other measures is fine.';

/**
 * An out-of-coverage case: the answer says so, with one pass condition for the
 * judge. No `answersWithoutClarifying`: a refusal that offers alternatives as
 * a question is a correct outcome here.
 */
function coverageCase(
  id: string,
  question: string,
  intent: string,
  codeChecks: EvalCustomCheck[],
  rubric: string,
): AssistantEvalCase {
  return {
    id,
    question,
    intent,
    scorers: [checks.noToolErrors()],
    customChecks: codeChecks,
    judgeRubric: `${rubric} ${COVERAGE_RUBRIC_NOTE}`,
  };
}

const CASES: AssistantEvalCase[] = [
  // A. Simple lookups
  answerCase(
    'iar-lookup-stores-germany',
    'How many stores do we have in Germany?',
    'A one-query count through a join to countries.',
    [exact('iar-lookup-stores-germany', 'stores', 'store count')],
  ),
  answerCase(
    'iar-lookup-price-on-date',
    'What was the list price in USD of the product with SKU SKU-0009 on 15 March 2023?',
    'A price on a date comes from the price history, not from the current list price in the product table.',
    [
      truth(
        'iar-lookup-price-on-date',
        'price',
        'The answer states the price in effect on that date, not the current one',
        answerHasNumber('price', { tolerance: 0.005 }),
      ),
    ],
  ),
  // B. Aggregations
  answerCase(
    'iar-agg-net-revenue-2024',
    'What was our net revenue in USD from completed orders in 2024?',
    'A total in USD: net_amount_usd, not the local-currency net_amount, and completed orders only.',
    [figure('iar-agg-net-revenue-2024', 'net', 'net revenue')],
  ),
  answerCase(
    'iar-agg-orders-per-status',
    'How many orders are there in each status?',
    'A count per status: cancelled, completed and pending.',
    [
      truth(
        'iar-agg-orders-per-status',
        'orders',
        'Every status count of the answer equals the data',
        answerStatesEachCount('status', 'orders'),
      ),
    ],
  ),
  // C. Joins across 3 or more tables
  answerCase(
    'iar-join-top-region-2024',
    'Which region had the highest net revenue in USD from completed orders in 2024, and how much was it?',
    'Lines to orders to stores to countries to regions: the top region and its revenue.',
    [
      mentions('iar-join-top-region-2024', 'region_name', 'the top region'),
      figure('iar-join-top-region-2024', 'net', 'revenue of the top region'),
    ],
  ),
  answerCase(
    'iar-join-top-department-units-2024',
    'Which top-level product category sold the most units in completed orders in 2024?',
    'Three joins up the category tree to the department; the clear twin of the best-category clarification.',
    [
      mentions(
        'iar-join-top-department-units-2024',
        'department',
        'the top department',
      ),
      exact('iar-join-top-department-units-2024', 'units', 'unit count'),
    ],
  ),
  // D. Period over period
  answerCase(
    'iar-pop-yoy-net-revenue',
    'By what percentage did net revenue in USD from completed orders grow from 2023 to 2024?',
    'Two years of one measure in a single growth percentage.',
    [percent('iar-pop-yoy-net-revenue', 'growth_pct', 'growth percentage')],
  ),
  answerCase(
    'iar-pop-orders-nov-dec-2024',
    'How many completed orders were placed in November 2024 and how many in December 2024?',
    "Two months of completed orders: December's pending orders are not counted.",
    [
      exact('iar-pop-orders-nov-dec-2024', 'november', 'November count'),
      exact('iar-pop-orders-nov-dec-2024', 'december', 'December count'),
    ],
  ),
  // E. Top N per group
  answerCase(
    'iar-topn-product-per-department-2024',
    'For each top-level product category, which product had the highest net revenue in USD from completed orders in 2024?',
    'One winner per department (window function over the category roll-up), in a table of three rows.',
    [
      mentions(
        'iar-topn-product-per-department-2024',
        'product_name',
        'the best product of each department',
      ),
      hasMarkdownTable(3),
    ],
  ),
  // F. Ranking ties
  answerCase(
    'iar-tie-top-3-products-units-2024',
    'Which are the top 3 products by units sold in completed orders in 2024?',
    'Third place is a tie of two products: all four are named (LIMIT 3 would drop one); the clear twin of the top-products clarification.',
    [
      mentions(
        'iar-tie-top-3-products-units-2024',
        'product_name',
        'all four products of the top three, ties included',
      ),
    ],
  ),
  answerCase(
    'iar-tie-most-used-promotion',
    'Which promotion was used on the most orders, and on how many?',
    'Two promotions tie at the top: both are named, with the shared count.',
    [
      mentions(
        'iar-tie-most-used-promotion',
        'promotion_name',
        'both tied promotions',
      ),
      exact('iar-tie-most-used-promotion', 'orders', 'order count'),
    ],
  ),
  // G. Ratios and shares
  answerCase(
    'iar-share-online-2024',
    'What share of our 2024 net revenue in USD from completed orders came from the online channel?',
    'A share of a total through the stores table: online over all, completed orders only.',
    [percent('iar-share-online-2024', 'share_pct', 'online share')],
  ),
  answerCase(
    'iar-ratio-cancelled-orders',
    'What percentage of our orders were cancelled?',
    'A fuzzy scope (no period): the whole data, never a question back.',
    [percent('iar-ratio-cancelled-orders', 'cancelled_pct', 'cancelled share')],
  ),
  answerCase(
    'iar-ratio-target-attainment-us-01-2024',
    'What percentage of its 2024 revenue target did store US-01 reach, measured as net revenue in USD from completed orders?',
    'Revenue over the sum of 12 target rows: each side is summed apart, so the lines are never joined to the targets.',
    [
      percent(
        'iar-ratio-target-attainment-us-01-2024',
        'attainment_pct',
        'target attainment',
      ),
    ],
  ),
  // H. Cohort and funnel
  answerCase(
    'iar-cohort-2022-retained-2024',
    'Of the customers whose first completed order was in 2022, how many also placed a completed order in 2024?',
    'A cohort by first completed order, then a second condition on the same customers.',
    [
      exact(
        'iar-cohort-2022-retained-2024',
        'retained',
        'retained customer count',
      ),
    ],
  ),
  answerCase(
    'iar-funnel-cart-to-purchase-2024',
    'Of the web sessions started in 2024 that added a product to the cart, what percentage went on to purchase?',
    'A funnel over distinct sessions: duplicated add_to_cart events are not counted twice.',
    [
      percent(
        'iar-funnel-cart-to-purchase-2024',
        'conversion_pct',
        'cart-to-purchase conversion',
      ),
    ],
  ),
  // I. Distinct-count traps
  answerCase(
    'iar-distinct-buyers-2024',
    'How many different customers placed at least one completed order in 2024?',
    'A distinct count of customers, not a count of orders.',
    [exact('iar-distinct-buyers-2024', 'buyers', 'buyer count')],
  ),
  answerCase(
    'iar-distinct-emails-ignoring-case',
    'How many distinct customer email addresses do we hold, ignoring letter case? Leave out customers with no email.',
    'Fifteen duplicate customers repeat an email in upper case: lower-case it before counting, and skip the NULLs.',
    [
      exact(
        'iar-distinct-emails-ignoring-case',
        'emails',
        'distinct email count',
      ),
    ],
  ),
  // J. NULLs and an empty table
  answerCase(
    'iar-null-products-without-cost',
    'How many products that are not deleted have no unit cost recorded?',
    'A NULL test on a column, with the soft-deleted products left out.',
    [exact('iar-null-products-without-cost', 'products', 'product count')],
  ),
  answerCase(
    'iar-empty-loyalty-redemptions',
    'How many loyalty redemptions were made in 2024, and how many points were redeemed?',
    'The table is empty: the answer says there are none and invents no figure.',
    [answerSaysNoRows('loyalty redemptions')],
  ),
  // K. Case and whitespace duplicates
  answerCase(
    'iar-dupes-acme-net-revenue-2024',
    'What was the net revenue in USD from completed orders of the brand Acme in 2024? The brand is not always typed the same way in the product list.',
    'The brand is stored as Acme, ACME, " acme" and "Acme ": look the values up, then match them all.',
    [
      figure(
        'iar-dupes-acme-net-revenue-2024',
        'net',
        'net revenue of the brand',
      ),
    ],
  ),
  // L. Refunds
  answerCase(
    'iar-refunds-net-after-returns-2024',
    'What was the net revenue in USD from completed orders placed in 2024 after subtracting the refunds for returns of those orders?',
    'Revenue minus the refunds of the same orders: the total before refunds (2.7% higher) is a wrong answer.',
    [
      figure(
        'iar-refunds-net-after-returns-2024',
        'net_after_refunds',
        'net revenue after refunds',
        { relative: 0.004 },
      ),
    ],
  ),
  // M. Fiscal calendar
  answerCase(
    'iar-fiscal-net-revenue-fy2023',
    'What was our net revenue in USD from completed orders in fiscal year 2023?',
    'The fiscal year starts on 1 February: the calendar table, not calendar 2023.',
    [figure('iar-fiscal-net-revenue-fy2023', 'net', 'fiscal-year revenue')],
  ),
  // N. Naive SQL gives a wrong answer
  answerCase(
    'iar-naive-tokyo-local-december-2024',
    "How many completed orders did the Tokyo Ginza store take in December 2024, counting each order on the store's local date?",
    "Orders are stored in UTC: the store's local date moves 5 orders out of December and 3 into it.",
    [
      exact(
        'iar-naive-tokyo-local-december-2024',
        'orders',
        'local-date order count',
      ),
    ],
  ),
  answerCase(
    'iar-naive-net-revenue-with-promotion',
    'What net revenue in USD came from completed orders that used at least one promotion?',
    'An order with two promotions must not count its lines twice: filter with EXISTS, do not join the bridge.',
    [
      figure(
        'iar-naive-net-revenue-with-promotion',
        'net',
        'revenue of orders with a promotion',
      ),
    ],
  ),
  // O. Multi-step
  answerCase(
    'iar-multistep-top-store-then-product-2024',
    'Which store had the highest net revenue in USD from completed orders in 2024, and which product sold the most units in that store that year?',
    'The first result (the top store) writes the second query.',
    [
      mentions(
        'iar-multistep-top-store-then-product-2024',
        'store_name',
        'the top store',
      ),
      mentions(
        'iar-multistep-top-store-then-product-2024',
        'product_name',
        "the store's best-selling product",
      ),
    ],
  ),
  answerCase(
    'iar-multistep-stores-above-average-2024',
    'How many retail stores had a 2024 net revenue in USD from completed orders above the average of the retail stores that sold something in 2024?',
    'An average of per-store totals, then a count above it.',
    [exact('iar-multistep-stores-above-average-2024', 'stores', 'store count')],
  ),
  // P. Clear twins of the ambiguous questions
  answerCase(
    'iar-noclarify-top-store-net-revenue-2024',
    'Which store had the highest net revenue in USD from completed orders in 2024?',
    'The measure is stated: answer, do not ask; the clear twin of the best-store clarification.',
    [
      mentions(
        'iar-noclarify-top-store-net-revenue-2024',
        'store_name',
        'the top store',
      ),
      figure(
        'iar-noclarify-top-store-net-revenue-2024',
        'net',
        'revenue of the top store',
      ),
    ],
  ),
  answerCase(
    'iar-noclarify-top-5-customers-net-revenue',
    'Which 5 customers have the highest net revenue in USD from completed orders, over all the data?',
    'The measure and the scope are stated: answer, do not ask; the clear twin of the most-valuable-customers clarification.',
    [
      mentions(
        'iar-noclarify-top-5-customers-net-revenue',
        'full_name',
        'the five customers',
      ),
      hasMarkdownTable(5),
    ],
  ),
  // Q. Ambiguous: must clarify
  clarifyCase(
    'iar-clarify-best-store',
    'Which store is performing best?',
    '"Best" names no measure (net revenue, orders, target attainment, growth): the run asks which.',
  ),
  clarifyCase(
    'iar-clarify-most-valuable-customers',
    'Who are our most valuable customers?',
    '"Most valuable" names no measure (revenue, orders, average order value): the run asks which.',
  ),
  clarifyCase(
    'iar-clarify-strongest-category',
    'Which product category is the strongest?',
    '"Strongest" names no measure (revenue, units, margin, return rate): the run asks which.',
  ),
  clarifyCase(
    'iar-clarify-top-products',
    'What were our top products in 2024?',
    '"Top" names no measure (units against revenue give different products): the run asks which.',
  ),
  // R. Out of coverage: must say so
  coverageCase(
    'iar-coverage-net-revenue-2021',
    'What was our net revenue in USD from completed orders in 2021?',
    'The data starts in January 2022: the answer says so and does not present another year as 2021.',
    [
      sqlTruthCheck({
        id: 'iar-coverage-2021-not-2022',
        description:
          'The answer does not give the 2022 total as the 2021 revenue',
        sql: referenceOf('iar-coverage-net-revenue-2021'),
        compare: (rows, input) =>
          answerHasFigure('net')(rows, input) === undefined
            ? 'the answer gives the 2022 total as if it were 2021'
            : undefined,
      }),
    ],
    'The question asks about 2021, a year this dataset does not cover (its orders start in January 2022). Score pass=true only if the final answer says the data holds no 2021 orders and that it starts in January 2022, and gives no 2021 figure. Score pass=false if it gives a 2021 revenue or presents another year as 2021.',
  ),
  coverageCase(
    'iar-coverage-targets-2022',
    'What percentage of its 2022 revenue target did store US-01 reach?',
    'Targets exist for 2023 and 2024 only: the answer says there is none for 2022 and gives no percentage.',
    [
      sqlTruthCheck({
        id: 'iar-coverage-2022-not-2024',
        description:
          'The answer gives no attainment percentage of another year as the 2022 one',
        sql: referenceOf('iar-coverage-targets-2022'),
        compare: (rows, input) => {
          const stated = ['attainment_2023', 'attainment_2024'].filter(
            (column) =>
              answerHasNumber(column, { tolerance: 0.05 })(rows, input) ===
              undefined,
          );
          return stated.length
            ? `the answer states the ${stated.join(' and ')} percentage as if it were 2022`
            : undefined;
        },
      }),
    ],
    "The question asks about the 2022 revenue target of store US-01, but the data holds revenue targets for 2023 and 2024 only. Score pass=true only if the final answer says there are no revenue targets for 2022 (targets cover 2023 and 2024) and gives no attainment percentage for 2022; stating the store's 2022 revenue is fine. Score pass=false if it gives a 2022 attainment percentage.",
  ),
  coverageCase(
    'iar-coverage-marketing-spend',
    'What was our return on advertising spend by channel in 2024?',
    'The data holds no advertising spend: the answer says the return cannot be computed.',
    [answerStatesNone(['ROAS of', 'ROAS was', 'ROAS is'])],
    'The question asks for return on advertising spend, but the data holds no advertising or marketing spend. Score pass=true only if the final answer says the data holds no advertising or marketing spend, so the return cannot be computed, and gives no return-on-spend figure; offering revenue by channel is fine. Score pass=false if it gives a return-on-spend figure.',
  ),
];

export const INSIGHTS_ANALYST_RETAIL_EVAL_SET: AssistantEvalSet = {
  id: 'insights-analyst-retail',
  name: 'Insights Analyst: Retail Ops',
  description:
    'Thirty-six questions put to the whole Answer a Business Question ' +
    'workflow over the Retail Ops sample: lookups, aggregations, joins of ' +
    'three or more tables, period over period, top N per group, ranking ' +
    'ties, ratios, cohorts and funnels, distinct counts, NULLs and an empty ' +
    'table, case duplicates, refunds, a fiscal calendar, traps where the ' +
    'naive SQL is wrong and multi-step questions. Four ambiguous questions ' +
    'must end on a clarifying question, each with a clear twin that must ' +
    'not, and three questions the data cannot answer must be refused. ' +
    'Figures are checked against live SQL. Load the "Retail Ops" sample in ' +
    'Settings → Testing Data.',
  fixtureId: 'retail-ops',
  agentKey: 'insights-analyst',
  cases: CASES,
};
