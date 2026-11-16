import { checks } from '@mastra/evals/checks';
import type { AssistantEvalCase, AssistantEvalSet } from './assistant.evals';
import {
  aggregatesNeverLists,
  answerKeepsTie,
  answerSaysNoRows,
  answerStatesEachCount,
  averageHandlesNonFinite,
  headlineFiguresInRows,
  planEntitiesInSql,
  sqlUsesAny,
} from './insights-analyst-edge-checks';
import { answerHasNumber, sqlTruthCheck } from './sql-truth-check';

/**
 * The `insights-analyst-edge` eval set (agents.md 8.1, 5.11; roadmap
 * 1.29.6): Michael's Analyse through the whole Answer a Business Question
 * workflow on the Edge Cases sample. The truth of every figure is read with
 * live SQL at eval time (`sqlTruthCheck`), and two checks compare the
 * workflow's steps with each other (`details.steps`): Plan's entities are
 * the ones Analyse queried, and Write answer's headline figures are in
 * Analyse's rows.
 */

const S = 'edge_cases.edge_cases';

/** The checks every case shares: no tool error, the steps agree. */
const BASE = (question: string) => [
  planEntitiesInSql(),
  headlineFiguresInRows(question),
];

const CASES: AssistantEvalCase[] = [
  {
    id: 'iae-top-five-tie',
    question: 'What are the top 5 products by revenue?',
    intent:
      'Five products tie at 50,000,000.00: the answer says they tie and ranks none above another.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ...BASE('What are the top 5 products by revenue?'),
      answerKeepsTie(),
    ],
  },
  {
    id: 'iae-orders-per-status',
    question: 'How many orders are there per status?',
    intent: 'Each status count equals the data (an enum column).',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ...BASE('How many orders are there per status?'),
      sqlTruthCheck({
        id: 'iae-status-counts-match-sql',
        description: 'Every status count of the answer equals the data',
        sql: `SELECT status::text AS status, count(*) AS orders FROM ${S}.orders GROUP BY 1`,
        compare: answerStatesEachCount('status', 'orders'),
      }),
    ],
  },
  {
    id: 'iae-average-weight-nan',
    question: 'What is the average product weight in kg?',
    intent:
      'Five weights are NaN and one is Infinity: the answer gives the finite average (as the data computes it) and never NaN or Infinity.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ...BASE('What is the average product weight in kg?'),
      sqlTruthCheck({
        id: 'iae-average-weight-finite',
        description: 'The average is the finite one and NaN is not a figure',
        sql: `SELECT round(avg(weight_kg) FILTER (WHERE weight_kg NOT IN ('NaN','Infinity'))::numeric, 2) AS avg FROM ${S}.products`,
        compare: averageHandlesNonFinite('avg'),
      }),
    ],
  },
  {
    id: 'iae-million-lines-aggregate',
    question: 'How many order lines are there in total?',
    intent:
      'One million rows: the answer is a count from an aggregate query, never a listing.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ...BASE('How many order lines are there in total?'),
      aggregatesNeverLists(),
      sqlTruthCheck({
        id: 'iae-line-count-matches-sql',
        description: 'The count of order lines equals the data',
        sql: `SELECT count(*) AS lines FROM ${S}.order_lines`,
        compare: answerHasNumber('lines'),
      }),
    ],
  },
  {
    id: 'iae-legacy-orders-mixed-case',
    question: 'How many legacy orders are there?',
    intent:
      'The MixedCase table "LegacyOrders" is queried by its exact name and the count equals the data.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ...BASE('How many legacy orders are there?'),
      sqlUsesAny(['"legacyorders"'], 'legacy-orders-quoted'),
      sqlTruthCheck({
        id: 'iae-legacy-count-matches-sql',
        description: 'The count of legacy orders equals the data',
        sql: `SELECT count(*) AS legacy FROM ${S}."LegacyOrders"`,
        compare: answerHasNumber('legacy'),
      }),
    ],
  },
  {
    id: 'iae-notes-with-percent',
    question: 'How many orders have notes that mention "100%"?',
    intent:
      'A LIKE on a value with a percent sign: the % must be escaped; the count equals the data.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ...BASE('How many orders have notes that mention "100%"?'),
      sqlUsesAny(['"order notes"'], 'order-notes-quoted'),
      sqlTruthCheck({
        id: 'iae-percent-notes-match-sql',
        description:
          'The count of orders whose notes contain "100%" equals the data',
        sql: `SELECT count(*) AS notes FROM ${S}.orders WHERE strpos("Order Notes", '100%') > 0`,
        compare: answerHasNumber('notes'),
      }),
    ],
  },
  {
    id: 'iae-orphan-order-lines',
    question: 'How many order lines point to an order that does not exist?',
    intent:
      'Twenty orphan rows: an anti-join, not an inner join; the count equals the data.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ...BASE('How many order lines point to an order that does not exist?'),
      sqlTruthCheck({
        id: 'iae-orphans-match-sql',
        description: 'The orphan count equals the data',
        sql: `SELECT count(*) AS orphans FROM ${S}.order_lines ol LEFT JOIN ${S}.orders o ON o.id = ol.order_id WHERE o.id IS NULL`,
        compare: answerHasNumber('orphans'),
      }),
    ],
  },
  {
    id: 'iae-empty-gift-cards',
    question: 'How many gift cards were issued, and for what total value?',
    intent:
      'The table is empty: the answer says there are none and invents no value.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ...BASE('How many gift cards were issued, and for what total value?'),
      answerSaysNoRows('gift cards'),
    ],
  },
];

export const INSIGHTS_ANALYST_EDGE_EVAL_SET: AssistantEvalSet = {
  id: 'insights-analyst-edge',
  name: 'Insights Analyst: Edge Cases',
  description:
    'Questions put to the whole Answer a Business Question workflow over the ' +
    'Edge Cases sample: ties, NaN, a million rows, awkward names, a percent ' +
    'in a value, orphans, an empty table. Figures are checked against live ' +
    'SQL. Load the "Edge Cases" sample in Settings → Testing Data.',
  fixtureId: 'edge-cases',
  agentKey: 'insights-analyst',
  cases: CASES,
};
