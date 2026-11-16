import { checks } from '@mastra/evals/checks';
import type { AssistantEvalCase, AssistantEvalSet } from './assistant.evals';
import {
  answerExcludes,
  calledAtMost,
  calledWithInput,
  noFindingRecount,
  readsEveryPage,
} from './data-readiness-eval-checks';
import {
  answerStates,
  completenessTotalEqualsReport,
  namesPlantedFinding,
  noMoneyAmount,
  numbersFromReport,
  quotesReportScoreAndMaturity,
  quotesValidityFigures,
} from './readiness-workflow-eval-checks';
import { READINESS_WORKFLOW_EVAL_TARGET } from './readiness-workflow-target';

/**
 * The `readiness-workflow` eval set (agents.md 8.1, 5.13): Explain report,
 * Sarah's last model step, run inside the whole Assess Data Readiness
 * workflow on the Edge Cases sample (target
 * `data-readiness:assessment-workflow`). The workflow has already assessed
 * and saved the report, so each case's question is the workflow's question
 * and the checks compare the answer with the saved report (`details.report`)
 * and the planted problems of the sample (testing-data R24).
 *
 * `rw-stale-tables` is the known-issue-C probe: the explain runtime streams
 * the turn input and may drop the workflow's own question, so Sarah answers
 * another one. Its failure documents the issue until it is fixed.
 */

/** The sample fixture the set is bound to. */
export const READINESS_WORKFLOW_EVAL_FIXTURE_ID = 'edge-cases';

/** The rule every case shares: the engine's numbers, never a tool error. */
const BASE = [checks.noToolErrors()];

const READINESS_WORKFLOW_EVAL_CASES: AssistantEvalCase[] = [
  {
    id: 'rw-ready-for-analysis',
    question: 'Is this dataset ready for analysis?',
    intent:
      'D2, D9, D15 inside the workflow: lead with the saved report’s overall score and maturity, quote only numbers the report holds, read the report and never assess again or recount findings with SQL.',
    scorers: [...BASE, checks.calledTool('get_readiness_report')],
    customChecks: [
      quotesReportScoreAndMaturity(),
      numbersFromReport(),
      calledAtMost('assess_data_readiness', 0),
      noFindingRecount(),
    ],
  },
  {
    id: 'rw-all-completeness-issues',
    question: 'What are all the completeness issues?',
    intent:
      'D15 inside the workflow: read the completeness findings with `dimension: completeness`, every page, and give the total the report states, which equals the saved report’s completeness count.',
    scorers: [...BASE],
    customChecks: [
      calledWithInput('get_readiness_report', 'dimension', 'completeness'),
      readsEveryPage('completeness'),
      completenessTotalEqualsReport(),
      noFindingRecount(),
      calledAtMost('assess_data_readiness', 0),
    ],
  },
  {
    id: 'rw-orphan-order-lines',
    question: 'Are there orphan order lines?',
    intent:
      'A planted problem (R24): 20 order_lines rows whose order_id has no order. The answer names order_lines and the 20 rows from the report or its finding sources, without a new count.',
    scorers: [...BASE, checks.calledTool('get_readiness_report')],
    customChecks: [
      namesPlantedFinding('order_lines', 20),
      numbersFromReport(),
      calledAtMost('assess_data_readiness', 0),
    ],
  },
  {
    id: 'rw-stale-tables',
    question: 'Which tables are stale?',
    intent:
      'Known issue C: the workflow’s question must be the one answered. LegacyOrders is the stale table (newest 2015); an answer that restates the overall score instead has lost the question.',
    scorers: [...BASE],
    customChecks: [
      answerStates(['LegacyOrders', '2015'], 'names LegacyOrders and its 2015'),
      numbersFromReport(),
      calledAtMost('assess_data_readiness', 0),
    ],
  },
  {
    id: 'rw-out-of-scope-revenue',
    question: 'What is our revenue?',
    intent:
      'Scope rule: general analysis is declined in one sentence and Questions to Insights is named; no query runs and no revenue figure appears.',
    scorers: [...BASE],
    customChecks: [
      answerStates(
        ['Questions to Insights'],
        'points to Questions to Insights',
      ),
      noMoneyAmount(),
      answerExcludes(/\brevenue (?:is|was|of) \d/i, 'states no revenue figure'),
      calledAtMost('run_readonly_sql', 0),
      calledAtMost('assess_data_readiness', 0),
    ],
  },
  {
    id: 'rw-explain-validity',
    question: 'Explain the validity score.',
    intent:
      'The validity figures come from the report: the dimension’s score, and the invalid emails (customers.email 1,000, payments.payer_email 750) when the report holds them.',
    scorers: [...BASE, checks.calledTool('get_readiness_report')],
    customChecks: [
      quotesValidityFigures([1000, 750]),
      numbersFromReport(),
      calledAtMost('assess_data_readiness', 0),
      noFindingRecount(),
    ],
  },
];

export const READINESS_WORKFLOW_EVAL_SET: AssistantEvalSet = {
  id: 'readiness-workflow',
  name: 'Assess Data Readiness: Explain report',
  description:
    'Questions put to the whole Assess Data Readiness workflow over the Edge ' +
    'Cases sample: it assesses and saves the report, then Sarah explains it. Load the ' +
    '"Edge Cases" sample in Settings → Testing Data. The checks compare the ' +
    'answer with the saved report and the planted problems.',
  fixtureId: READINESS_WORKFLOW_EVAL_FIXTURE_ID,
  agentKey: 'data-readiness',
  target: READINESS_WORKFLOW_EVAL_TARGET,
  cases: READINESS_WORKFLOW_EVAL_CASES,
};
