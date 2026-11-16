import type { AssistantEvalSet } from './assistant.evals';
import { isolatedCase } from './isolated-call-target';
import type { PlannerEvalInput } from './isolated-call-targets';
import {
  edgeCasesCatalogBlock,
  edgeCasesPlannerCatalog,
} from './analysis-planner-edge-catalog';
import {
  assumesMayBeEmpty,
  clarificationDecision,
  entitiesInCatalog,
  hasMeasures,
  namedColumnsExist,
  namesSpelledExactly,
  noInvented,
  planParses,
  readsTables,
  restatesAnswer,
  scopeOrAssumptionsMention,
  statesGap,
} from './analysis-planner-eval-checks';

/**
 * The `analysis-planner` eval set (agents.md 8.1, 2.11; roadmap 1.29.2):
 * Olivia's Plan call alone, on a frozen input built as the workflow builds
 * it (the question, the Edge Cases catalog block of Load catalog, and for
 * one case the answer to a Clarify question). The scored answer is the plan
 * as JSON; every check is code, against the plan and the catalog it saw.
 */

const CATALOG = edgeCasesPlannerCatalog();
const BLOCK = edgeCasesCatalogBlock();

/** The checks every plan must pass: it parses and names only real things. */
const BASE = () => [
  planParses(),
  entitiesInCatalog(CATALOG),
  namedColumnsExist(CATALOG),
];

const input = (question: string, extra: Partial<PlannerEvalInput> = {}) => ({
  question,
  catalogBlock: BLOCK,
  ...extra,
});

export const ANALYSIS_PLANNER_EVAL_SET: AssistantEvalSet = {
  id: 'analysis-planner',
  name: 'Analysis Planner',
  description:
    'Olivia’s Plan call alone, on the Edge Cases sample’s catalog: when to ask ' +
    'and when not, measures the data lacks, awkward names spelled as the ' +
    'catalog does, no second question after an answer. Load the "Edge Cases" ' +
    'sample in Settings → Testing Data.',
  fixtureId: 'edge-cases',
  agentKey: 'analysis-planner',
  cases: [
    isolatedCase<PlannerEvalInput>({
      id: 'ap-ambiguous-best-customers',
      question: 'Who are our best customers?',
      intent:
        '"Best" has several readings (revenue, orders, lifetime value): Plan asks, with options.',
      scorers: [],
      customChecks: [...BASE(), clarificationDecision(true)],
      input: input('Who are our best customers?'),
    }),
    isolatedCase<PlannerEvalInput>({
      id: 'ap-clear-cancelled-orders',
      question: 'How many orders were cancelled in 2024?',
      intent: 'A clear question: no clarification; orders is read.',
      scorers: [],
      customChecks: [
        ...BASE(),
        clarificationDecision(false),
        readsTables(['orders']),
        hasMeasures(1),
      ],
      input: input('How many orders were cancelled in 2024?'),
    }),
    isolatedCase<PlannerEvalInput>({
      id: 'ap-missing-supplier-margin',
      question: 'What is the profit margin by supplier?',
      intent:
        'There is no supplier in the data: no invented supplier entity or column; the gap is stated or asked about.',
      scorers: [],
      customChecks: [
        ...BASE(),
        noInvented(/supplier/i, 'a supplier entity or measure'),
        statesGap(/supplier/i, 'no supplier in the data'),
      ],
      input: input('What is the profit margin by supplier?'),
    }),
    isolatedCase<PlannerEvalInput>({
      id: 'ap-awkward-names',
      question:
        'Which orders have notes, by year (año) and discount percentage, and where are they shipped to?',
      intent:
        'The columns "Order Notes", año, "discount_%" and "ship-to" are spelled exactly as the catalog does.',
      scorers: [],
      customChecks: [
        ...BASE(),
        clarificationDecision(false),
        namesSpelledExactly(
          ['Order Notes', 'año', 'discount_%', 'ship-to'],
          [
            /order_notes/i,
            /\bano\b/i,
            /discount_pct|discount_percent/i,
            /ship_to\b/i,
          ],
        ),
      ],
      input: input(
        'Which orders have notes, by year (año) and discount percentage, and where are they shipped to?',
      ),
    }),
    isolatedCase<PlannerEvalInput>({
      id: 'ap-legacy-orders-mixed-case',
      question:
        'How many legacy orders are there, and how many are duplicated?',
      intent:
        'The MixedCase table "LegacyOrders" is read under its exact name.',
      scorers: [],
      customChecks: [
        ...BASE(),
        readsTables(['LegacyOrders']),
        namesSpelledExactly(
          ['LegacyOrders'],
          [/legacy_orders/i, /legacyorders(?!")/],
        ),
      ],
      input: input(
        'How many legacy orders are there, and how many are duplicated?',
      ),
    }),
    isolatedCase<PlannerEvalInput>({
      id: 'ap-after-clarify-no-second-question',
      question: 'Who are our best customers?',
      intent:
        'After the user answered the clarifying question, Plan never asks again and restates the answer.',
      scorers: [],
      customChecks: [
        ...BASE(),
        clarificationDecision(false),
        restatesAnswer(/revenue|spend|amount/i),
      ],
      input: input('Who are our best customers?', {
        answered: {
          question: 'What makes a customer "best"?',
          options: [
            'Highest total revenue',
            'Most orders',
            'Highest lifetime value',
          ],
          answer: 'Highest total revenue',
        },
      }),
    }),
    isolatedCase<PlannerEvalInput>({
      id: 'ap-fully-null-fax',
      question: 'How many customers have a fax number?',
      intent:
        'customers.fax is 100% null: the plan reads it and assumes it may be empty, inventing nothing else.',
      scorers: [],
      customChecks: [
        ...BASE(),
        readsTables(['customers']),
        assumesMayBeEmpty('fax'),
      ],
      input: input('How many customers have a fax number?'),
    }),
    isolatedCase<PlannerEvalInput>({
      id: 'ap-last-month-stale-legacy',
      question: 'How many legacy orders were placed last month?',
      intent:
        'LegacyOrders stops in 2015: the plan states the period it assumes for "last month" rather than a world fact.',
      scorers: [],
      customChecks: [
        ...BASE(),
        readsTables(['LegacyOrders']),
        scopeOrAssumptionsMention(
          /last month|month|period|date|placed_at/i,
          'the period it assumes',
          'states-period',
        ),
      ],
      input: input('How many legacy orders were placed last month?'),
    }),
    isolatedCase<PlannerEvalInput>({
      id: 'ap-spanish-question',
      question: '¿Cuántos pedidos tienen estado reembolsado por región?',
      intent:
        'A question in Spanish still gives a valid plan over orders and customers.',
      scorers: [],
      customChecks: [...BASE(), clarificationDecision(false), hasMeasures(1)],
      input: input('¿Cuántos pedidos tienen estado reembolsado por región?'),
    }),
    isolatedCase<PlannerEvalInput>({
      id: 'ap-top-five-ties',
      question: 'What are the top 5 products by revenue?',
      intent:
        'The measure is named (revenue): Plan does not ask, even with a product_revenue view in the catalog (the rule for unnamed measures must not over-fire). Ties are the writer’s to state, not the plan’s.',
      scorers: [],
      customChecks: [...BASE(), clarificationDecision(false), hasMeasures(1)],
      input: input('What are the top 5 products by revenue?'),
    }),
    isolatedCase<PlannerEvalInput>({
      id: 'ap-list-million-lines',
      question: 'List all the order lines.',
      intent:
        'One million rows: the plan scopes or aggregates (a count, a sample, a page), never a plain dump of every row.',
      scorers: [],
      customChecks: [
        ...BASE(),
        readsTables(['order_lines']),
        scopeOrAssumptionsMention(
          /\b(count|sample|first|page|limit|top|1,?000,?000|million|too many|summar)/i,
          'how it handles a million rows',
          'scopes-million-rows',
        ),
      ],
      input: input('List all the order lines.'),
    }),
    isolatedCase<PlannerEvalInput>({
      id: 'ap-wide-table-beyond-cap',
      question:
        'What is the average of score_07 in the customer profile table?',
      intent:
        'customer_profile_wide has 65 columns; the catalog shows at most 40. The plan reads that table and does not invent a column it was not shown.',
      scorers: [],
      customChecks: [...BASE(), readsTables(['customer_profile_wide'])],
      input: input(
        'What is the average of score_07 in the customer profile table?',
      ),
    }),
  ],
};
