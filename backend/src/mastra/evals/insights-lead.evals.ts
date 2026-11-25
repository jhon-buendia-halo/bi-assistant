import {
  INSIGHTS_LEAD_AGENT_KEY,
  INSIGHTS_LEAD_TOOL_NAMES,
} from '../agents/insights-lead-catalog';
import type {
  AssistantEvalCase,
  AssistantEvalSet,
  EvalCustomCheck,
} from './assistant.evals';
import {
  AVERY_CASE_SOURCES,
  AVERY_EVAL_FIXTURE_ID,
  type EvalCaseSource,
} from './avery-workflow.evals';
import {
  asksAtMostOnce,
  callsOnlyHerTools,
  clarificationOffersOptions,
  figuresFromQueries,
  ranAQuery,
  repairAtMostOnce,
  runEndsIn,
} from './insights-lead-eval-checks';
import { INSIGHTS_LEAD_EVAL_TARGET } from './insights-lead-target';

/**
 * The `insights-lead` eval set (agents.md 8.1, plan Elena 5): Elena, the
 * Insights Lead (agent `insights-lead`), answering alone in her conversation
 * (`agent:insights-lead`): each case is one whole run over the bundled World
 * Cup sample, read back from the stored run (target `insights-lead-workflow`).
 *
 * The 8 cases are those of `avery-michael-workflow` (the same questions,
 * intents, text checks and pass conditions; the case ids end `-elena`), so
 * Avery with Michael and Elena can be compared on the same ground. The
 * judge's rubric differs only in where it finds the words: there is no
 * Michael's answer and Avery's closing, only the answer.
 *
 * Code checks (3 of 3 runs) hold what the stored run decides: that she ran a
 * query, at most one question, only her tools, the run's status, that every
 * figure in her answer comes from her queries and that the turn repaired its
 * answer once at most. The judge (2 of 3) grades what code cannot.
 */

/** Where the judge finds her words in the scored answer. */
const ANSWER =
  "The final answer is Elena's answer to the question, as the user reads it. Grade the whole answer. ";

/** The framing of a rubric whose answer may be her question instead. */
const EITHER =
  "The final answer is either Elena's question to the user (after " +
  '"Elena asks the user:", with its options, one per line), or her answer ' +
  'to the question. ';

/** Wording of a pass condition written for Avery's closing, for her answer. */
function forAnswer(body: string): string {
  return body.replace(/\bher closing\b/g, 'her answer');
}

/** The check list of a case source, under Elena's rules. */
function leadChecks(source: EvalCaseSource): EvalCustomCheck[] {
  return [
    ranAQuery(),
    asksAtMostOnce(),
    callsOnlyHerTools(INSIGHTS_LEAD_TOOL_NAMES),
    runEndsIn(source.mayAsk ? ['success', 'suspended'] : ['success']),
    ...(source.mayAsk ? [clarificationOffersOptions()] : []),
    figuresFromQueries(source.question),
    repairAtMostOnce(),
    ...(source.textChecks?.() ?? []),
  ];
}

/** A case of Avery's, as Elena runs it. */
export function insightsLeadCase(source: EvalCaseSource): AssistantEvalCase {
  return {
    id: source.id.replace(/^avery-/, '') + '-elena',
    question: source.question,
    intent: source.intent,
    // Every verdict is a custom check or the judge: the built-in scorers
    // read her agent's own result, which a whole run has not.
    scorers: [],
    customChecks: leadChecks(source),
    ...(source.body
      ? {
          judgeRubric:
            (source.kind === 'either' ? EITHER : ANSWER) +
            forAnswer(source.body),
        }
      : {}),
  };
}

export const INSIGHTS_LEAD_EVAL_CASES: AssistantEvalCase[] =
  AVERY_CASE_SOURCES.map(insightsLeadCase);

export const INSIGHTS_LEAD_EVAL_SET: AssistantEvalSet = {
  id: 'insights-lead',
  name: 'Elena, the Insights Lead',
  description:
    'Elena, the Insights Lead, in whole runs of her own conversation over ' +
    'the bundled World Cup sample: the 8 cases of Avery and Michael (a ' +
    'ranking with a tie, a period change, an ambiguous word, a filter with ' +
    'no rows, a false premise, partial coverage, a simple question and one ' +
    'the data cannot answer), so the two can be compared. Select its ' +
    'PostgreSQL datasource with a saved dataset containing the world_cup ' +
    'tables and views.',
  fixtureId: AVERY_EVAL_FIXTURE_ID,
  agentKey: INSIGHTS_LEAD_AGENT_KEY,
  target: INSIGHTS_LEAD_EVAL_TARGET,
  cases: INSIGHTS_LEAD_EVAL_CASES,
};
