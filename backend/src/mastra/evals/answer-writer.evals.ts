import type { AssistantEvalSet } from './assistant.evals';
import { isolatedCase } from './isolated-call-target';
import type { WriterEvalInput } from './isolated-call-targets';
import {
  answerParses,
  figuresFromRows,
  neverSays,
  says,
} from './answer-writer-eval-checks';

/**
 * The `answer-writer` eval set (agents.md 8.1, 2.11; roadmap 1.28.3):
 * Jessica's Write answer call alone, on frozen inputs as the workflow builds
 * them (the question, the plan, each query's SQL and rows, Validate's
 * findings). The rows are the Edge Cases sample's real values, read once
 * from the fixture. The scored answer is `{ headline, answer }` as JSON;
 * every check is code.
 *
 * `aw-warning-is-not-a-caveat` probes known issue D: Validate's warning-only
 * "Measures covered" reaches Jessica as a failed check, so she may report a
 * limit that is not one. Its failure documents the issue until it is fixed.
 */

type Query = WriterEvalInput['queries'][number];
type Finding = WriterEvalInput['findings'][number];

const SCHEMA = 'edge_cases.edge_cases';

function plan(question: string, measures: string[], entities: string[]) {
  return {
    question,
    measures,
    entities: entities.map((e) => `${SCHEMA}.${e}`),
    scope: 'All rows of the sample',
    assumptions: [],
    needsClarification: false,
    clarification: null,
  };
}

/** Validate's findings, all passed unless a check is named failed. */
function findings(failed: Partial<Record<string, string>> = {}): Finding[] {
  const checks: [string, string][] = [
    ['Ran a query', '1 of 1 SQL query succeeded.'],
    ['No unresolved tool error', 'No tool call failed.'],
    ['No result cut at its row limit', 'No query was cut at its row limit.'],
    ['No answer from a sample', 'No answer rests on sample_rows.'],
    ['Measures covered (warning only)', 'Every measure is named by a query.'],
  ];
  return checks.map(([check, detail]) => ({
    check,
    passed: failed[check] === undefined,
    detail: failed[check] ?? detail,
  }));
}

function query(
  sql: string,
  rows: Record<string, unknown>[],
  extra: Partial<Query> = {},
): Query {
  return {
    sql,
    rationale: 'The rows the question needs.',
    rows,
    rowCount: rows.length,
    truncated: false,
    ...extra,
  };
}

const TOP_PRODUCTS = [
  { product_id: 5, name: 'Product 5', revenue: '50000000.00' },
  { product_id: 1, name: 'Product 1', revenue: '50000000.00' },
  { product_id: 3, name: 'Product 3', revenue: '50000000.00' },
  { product_id: 4, name: 'Product 4', revenue: '50000000.00' },
  { product_id: 2, name: 'Product 2', revenue: '50000000.00' },
  { product_id: 3496, name: 'Product 3496', revenue: '320219.68' },
];

const STATUS_COUNTS = [
  { status: 'delivered', orders: 112319 },
  { status: 'returned', orders: 37941 },
  { status: 'cancelled', orders: 37712 },
  { status: 'paid', orders: 37544 },
  { status: 'pending', orders: 37276 },
  { status: 'shipped', orders: 37208 },
];

const WEIGHTS = [
  {
    products: 5000,
    nan_weights: 5,
    infinite_weights: 1,
    avg_finite_kg: 25.175,
  },
];

const DISCOUNTS = [{ total_discount: '1190245.0000', orders: 300000 }];

const BASE = () => [answerParses()];

export const ANSWER_WRITER_EVAL_SET: AssistantEvalSet = {
  id: 'answer-writer',
  name: 'Answer Writer',
  description:
    'Jessica’s Write answer call alone, on frozen rows of the Edge Cases ' +
    'sample: ties, NaN, rounding, empty and cut results, caveats only for ' +
    'failed checks, every figure from the rows. Load the "Edge Cases" sample ' +
    'in Settings → Testing Data.',
  fixtureId: 'edge-cases',
  agentKey: 'answer-writer',
  cases: [
    isolatedCase<WriterEvalInput>({
      id: 'aw-top-five-tie',
      question: 'What are the top 5 products by revenue?',
      intent:
        'Five products tie at 50,000,000.00: the answer says they tie rather than ranking them 1 to 5, with figures from the rows.',
      scorers: [],
      customChecks: [
        ...BASE(),
        figuresFromRows(TOP_PRODUCTS, [], 'top 5'),
        says(
          /\btie|\btied|same revenue|equal revenue|all (five|5)\b/i,
          'says the five products tie',
          'says-tie',
        ),
      ],
      input: {
        question: 'What are the top 5 products by revenue?',
        plan: plan(
          'What are the top 5 products by revenue?',
          ['revenue per product'],
          ['v_product_revenue'],
        ),
        queries: [
          query(
            `SELECT product_id, name, revenue FROM ${SCHEMA}.v_product_revenue ORDER BY revenue DESC LIMIT 6`,
            TOP_PRODUCTS,
          ),
        ],
        findings: findings(),
      },
    }),
    isolatedCase<WriterEvalInput>({
      id: 'aw-status-counts',
      question: 'How many orders are there per status?',
      intent:
        'Every count in the answer is a count of the rows; nothing is added.',
      scorers: [],
      customChecks: [...BASE(), figuresFromRows(STATUS_COUNTS, [300000])],
      input: {
        question: 'How many orders are there per status?',
        plan: plan(
          'How many orders are there per status?',
          ['orders per status'],
          ['orders'],
        ),
        queries: [
          query(
            `SELECT status, count(*) AS orders FROM ${SCHEMA}.orders GROUP BY status ORDER BY orders DESC`,
            STATUS_COUNTS,
          ),
        ],
        findings: findings(),
      },
    }),
    isolatedCase<WriterEvalInput>({
      id: 'aw-nan-weights',
      question: 'What is the average product weight?',
      intent:
        'Five weights are NaN and one is Infinity: the answer gives the finite average from the rows and says some weights are not numbers; it never prints NaN or Infinity as a figure.',
      scorers: [],
      customChecks: [
        ...BASE(),
        figuresFromRows(WEIGHTS),
        neverSays(
          /\b(average|mean)[^.]{0,40}\b(NaN|Infinity)\b/i,
          'gives NaN or Infinity as the average',
          'no-nan-figure',
        ),
        says(
          /\b(NaN|not a number|infinit|invalid|excluded|left out)\b/i,
          'says some weights are not numbers',
          'says-nan-excluded',
        ),
      ],
      input: {
        question: 'What is the average product weight?',
        plan: plan(
          'What is the average product weight?',
          ['average weight in kg'],
          ['products'],
        ),
        queries: [
          query(
            `SELECT count(*) AS products, count(*) FILTER (WHERE weight_kg = 'NaN') AS nan_weights, count(*) FILTER (WHERE weight_kg = 'Infinity') AS infinite_weights, round(avg(weight_kg) FILTER (WHERE weight_kg NOT IN ('NaN','Infinity'))::numeric, 3) AS avg_finite_kg FROM ${SCHEMA}.products`,
            WEIGHTS,
          ),
        ],
        findings: findings(),
      },
    }),
    isolatedCase<WriterEvalInput>({
      id: 'aw-half-cent-total',
      question: 'What is the total discount given?',
      intent:
        'The total 1,190,245.0000 is reported from the row, rounded consistently, not recomputed.',
      scorers: [],
      customChecks: [...BASE(), figuresFromRows(DISCOUNTS)],
      input: {
        question: 'What is the total discount given?',
        plan: plan(
          'What is the total discount given?',
          ['sum of discount_amount'],
          ['orders'],
        ),
        queries: [
          query(
            `SELECT sum(discount_amount) AS total_discount, count(*) AS orders FROM ${SCHEMA}.orders`,
            DISCOUNTS,
          ),
        ],
        findings: findings(),
      },
    }),
    isolatedCase<WriterEvalInput>({
      id: 'aw-empty-result',
      question: 'How many gift cards were issued?',
      intent:
        'The table is empty: the answer says no gift cards are recorded and invents no figure.',
      scorers: [],
      customChecks: [
        ...BASE(),
        figuresFromRows([{ gift_cards: 0 }]),
        says(
          /\b(no|none|zero|0)\b[^.]{0,40}gift card|gift card[^.]{0,40}\b(no|none|zero|0|empty)\b/i,
          'says there are none',
          'says-none',
        ),
      ],
      input: {
        question: 'How many gift cards were issued?',
        plan: plan(
          'How many gift cards were issued?',
          ['count of gift cards'],
          ['gift_cards'],
        ),
        queries: [
          query(`SELECT count(*) AS gift_cards FROM ${SCHEMA}.gift_cards`, [
            { gift_cards: 0 },
          ]),
        ],
        findings: findings(),
      },
    }),
    isolatedCase<WriterEvalInput>({
      id: 'aw-cut-result-is-partial',
      question: 'List the order lines.',
      intent:
        'The query was cut at 100 of 1,000,000 rows (a failed row-limit check): the answer says the list is partial and does not present it as complete.',
      scorers: [],
      customChecks: [
        ...BASE(),
        says(
          /\b(first|partial|only|of 1,?000,?000|100 of|cut|limited|sample of)\b/i,
          'says the list is partial',
          'says-partial',
        ),
      ],
      input: {
        question: 'List the order lines.',
        plan: plan('List the order lines.', ['order lines'], ['order_lines']),
        queries: [
          query(
            `SELECT order_id, line_number, product_id, quantity, unit_price FROM ${SCHEMA}.order_lines ORDER BY order_id, line_number LIMIT 100`,
            Array.from({ length: 5 }, (_, i) => ({
              order_id: 1,
              line_number: i + 1,
              product_id: 2,
              quantity: 10,
              unit_price: '1000.00',
            })),
            { rowCount: 100, truncated: true },
          ),
        ],
        findings: findings({
          'No result cut at its row limit':
            'One query was cut at its row limit of 100.',
        }),
      },
    }),
    isolatedCase<WriterEvalInput>({
      id: 'aw-failed-check-is-a-caveat',
      question: 'How many orders were cancelled?',
      intent:
        'A failed check (an unresolved tool error) becomes a caveat of the answer.',
      scorers: [],
      customChecks: [
        ...BASE(),
        says(
          /\b(caveat|note|however|could not|failed|error|may be incomplete)\b/i,
          'gives the failed check as a caveat',
          'says-caveat',
        ),
      ],
      input: {
        question: 'How many orders were cancelled?',
        plan: plan(
          'How many orders were cancelled?',
          ['cancelled orders'],
          ['orders'],
        ),
        queries: [
          query(
            `SELECT count(*) AS cancelled FROM ${SCHEMA}.orders WHERE status = 'cancelled'`,
            [{ cancelled: 37712 }],
          ),
        ],
        findings: findings({
          'No unresolved tool error':
            'describe_entity failed and was not run again successfully.',
        }),
      },
    }),
    isolatedCase<WriterEvalInput>({
      id: 'aw-warning-is-not-a-caveat',
      question: 'How many orders were delivered?',
      intent:
        'Known issue D: the warning-only "Measures covered" check is not a limit of the answer; with every other check passed, the answer gives no caveat about missing measures.',
      scorers: [],
      customChecks: [
        ...BASE(),
        figuresFromRows([{ delivered: 112319 }]),
        neverSays(
          /\b(measure|could not (cover|find)|not covered|missing)\b/i,
          'reports the warning as a limit',
          'no-warning-caveat',
        ),
      ],
      input: {
        question: 'How many orders were delivered?',
        plan: plan(
          'How many orders were delivered?',
          ['delivered orders', 'delivery rate'],
          ['orders'],
        ),
        queries: [
          query(
            `SELECT count(*) AS delivered FROM ${SCHEMA}.orders WHERE status = 'delivered'`,
            [{ delivered: 112319 }],
          ),
        ],
        findings: findings({
          'Measures covered (warning only)':
            'No query names the measure "delivery rate".',
        }),
      },
    }),
    isolatedCase<WriterEvalInput>({
      id: 'aw-awkward-column-names',
      question: 'What do the order notes say most often?',
      intent:
        'Values and the column "Order Notes" are reported as they are, special characters kept.',
      scorers: [],
      customChecks: [
        ...BASE(),
        says(
          /100% sure/,
          'quotes the note with its percent sign',
          'keeps-percent',
        ),
        says(
          /SAVE_10/,
          'quotes the note with its underscore',
          'keeps-underscore',
        ),
      ],
      input: {
        question: 'What do the order notes say most often?',
        plan: plan(
          'What do the order notes say most often?',
          ['orders per note'],
          ['orders'],
        ),
        queries: [
          query(
            `SELECT "Order Notes", count(*) AS orders FROM ${SCHEMA}.orders WHERE "Order Notes" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 3`,
            [
              { 'Order Notes': 'Leave at door; 100% sure', orders: 299 },
              { 'Order Notes': 'Use code SAVE_10 (snake_case)', orders: 299 },
              { 'Order Notes': 'Path C:\\Users\\new folder', orders: 298 },
            ],
          ),
        ],
        findings: findings(),
      },
    }),
    isolatedCase<WriterEvalInput>({
      id: 'aw-spanish-question',
      question: '¿Cuántos pedidos fueron devueltos?',
      intent:
        'A question in Spanish: the figure comes from the row (the language follows the instructions).',
      scorers: [],
      customChecks: [...BASE(), figuresFromRows([{ returned: 37941 }])],
      input: {
        question: '¿Cuántos pedidos fueron devueltos?',
        plan: plan(
          '¿Cuántos pedidos fueron devueltos?',
          ['returned orders'],
          ['orders'],
        ),
        queries: [
          query(
            `SELECT count(*) AS returned FROM ${SCHEMA}.orders WHERE status = 'returned'`,
            [{ returned: 37941 }],
          ),
        ],
        findings: findings(),
      },
    }),
  ],
};
