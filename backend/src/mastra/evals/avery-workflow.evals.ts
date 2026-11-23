import { CHIEF_OF_STAFF_AGENT_KEY } from '../agent-constants';
import type {
  AssistantEvalCase,
  AssistantEvalSet,
  EvalCustomCheck,
} from './assistant.evals';
import {
  answerFromDataCalls,
  asksAtMostOnce,
  callsOnlyHerTools,
  clarificationOffersOptions,
  closesIn,
  closingFiguresFromMichael,
  readsNoPlaybook,
  readsPlaybook,
  runEndsIn,
} from './avery-workflow-eval-checks';
import { AVERY_WORKFLOW_EVAL_TARGET } from './avery-workflow-target';
import {
  answerNamesAll,
  answerStatesNone,
  answerStatesNumbers,
} from './insights-analyst-eval-checks';

/**
 * The `avery-michael-workflow` eval set (agents.md 8.1, 5.23): Avery, the
 * Chief of Staff (agent `chief-of-staff`), as she runs in Answer a Business
 * Question (Avery + Michael) (`orchestrated-answer-michael`): each case is
 * one whole run of the workflow over the bundled World Cup sample, read back
 * from the stored run (target `avery-michael-workflow`). Each probes one of
 * her playbooks or rules: a ranking with a tie at the cut-off, a change
 * between two periods, a word with several readings, a filter matching no
 * rows, a false premise, partial coverage, a simple question and one the
 * data cannot answer.
 *
 * Every expected figure was read from the seeded `world_cup` schema on
 * 2026-11-23 (16 matches, the quarter-finals to the final of 2018 and 2022;
 * 23 goals in 2018 and 24 in 2022; no 2022 goal from a free kick; no ticket
 * prices anywhere).
 *
 * Code checks (3 of 3 runs) hold what the stored run decides: her tool calls
 * (answer_from_data once or twice, at most one question, only her tools,
 * the playbook file she read), the run's status, the size of her closing and
 * that every figure in it is Michael's. The judge (2 of 3) grades only what
 * code cannot: what her closing says, one pass condition each. The scored
 * answer holds Michael's answer and her closing, each under its label.
 */

/** The sample fixture the set is bound to (Michael's set's). */
export const AVERY_EVAL_FIXTURE_ID = 'world-cup';

/** Where the judge finds her words in the scored answer. */
const CLOSING =
  "The final answer shows Michael's answer (the analyst's, which Avery " +
  'does not write) and, under "Avery\'s closing:", the one or two sentences ' +
  'Avery wrote after it. Grade only her closing. ';

/** Her rules in every run that answers (agents.md 5.23). */
function answered(
  question: string,
  {
    calls = [1, 2],
    sentences = [1, 2],
  }: { calls?: [number, number]; sentences?: [number, number] } = {},
) {
  return [
    answerFromDataCalls(...calls),
    asksAtMostOnce(),
    callsOnlyHerTools(),
    runEndsIn(['success']),
    closesIn(...sentences),
    closingFiguresFromMichael(question),
  ];
}

/** A case: its question, intent, code checks and its rubric, if judged. */
function averyCase(evalCase: {
  id: string;
  question: string;
  intent: string;
  customChecks: (question: string) => EvalCustomCheck[];
  judgeRubric?: string;
}): AssistantEvalCase {
  return {
    id: evalCase.id,
    question: evalCase.question,
    intent: evalCase.intent,
    // Every verdict is a custom check or the judge: the built-in scorers
    // read her agent's own result, which a whole run has not.
    scorers: [],
    customChecks: evalCase.customChecks(evalCase.question),
    ...(evalCase.judgeRubric ? { judgeRubric: evalCase.judgeRubric } : {}),
  };
}

const AVERY_EVAL_CASES: AssistantEvalCase[] = [
  averyCase({
    id: 'avery-ranking-tie-top-3-scorers-2022',
    question: 'Who were the top 3 scorers of the 2022 World Cup?',
    intent:
      'Ranking playbook with a tie at the cut-off: Messi 4, Mbappé 3, then Weghorst and Álvarez tied on 2 for third place, so a top 3 holds four players.',
    customChecks: (question) => [
      ...answered(question),
      readsPlaybook('ranking'),
      answerNamesAll(['Messi', 'Mbappe', 'Weghorst', 'Alvarez']),
    ],
    judgeRubric:
      CLOSING +
      'In the 2022 data Lionel Messi scored 4, Kylian Mbappé 3, and Wout ' +
      'Weghorst and Julián Álvarez are tied on 2 for third place. Score ' +
      'pass=true only if her closing says that third place is a tie between ' +
      'Weghorst and Álvarez (2 goals each).',
  }),
  averyCase({
    id: 'avery-period-change-goals-2018-2022',
    question:
      'How did the number of goals change from the 2018 World Cup to the 2022 World Cup?',
    intent:
      'Period-change playbook: 23 goals in 2018 against 24 in 2022, up 1 (about 4%), each over 8 matches; the data holds only the quarter-finals to the final, the last 8 matches of each tournament.',
    customChecks: (question) => [
      ...answered(question),
      readsPlaybook('period-change'),
      answerStatesNumbers([[{ value: 23 }, { value: 24 }]]),
    ],
    judgeRubric:
      CLOSING +
      'The data holds 23 goals for 2018 and 24 for 2022, each over 8 ' +
      'matches: only the quarter-finals to the final, the last 8 matches of ' +
      'each tournament. Score pass=true only if her closing states all four: ' +
      'the size of the change (1 goal, or about 4%), its direction (up), ' +
      'its basis (the goals of the matches in the data, or the 8 matches of ' +
      'each tournament) and that the data covers only the last 8 matches ' +
      '(the knockout rounds) of each tournament.',
  }),
  averyCase({
    id: 'avery-ambiguous-best-team',
    question: 'Which team had the best World Cup?',
    intent:
      'Ambiguous-wording playbook: "best" read as the champion gives France (2018) or Argentina (2022); read as matches won or goals over both tournaments it gives France (5 wins, 14 goals). She asks once with 2-4 options, or answers on a stated reading.',
    customChecks: (question) => [
      answerFromDataCalls(0, 2),
      asksAtMostOnce(),
      callsOnlyHerTools(),
      runEndsIn(['success', 'suspended']),
      clarificationOffersOptions(),
      closesIn(1, 2),
      closingFiguresFromMichael(question),
    ],
    judgeRubric:
      "The final answer is either Avery's question to the user (after " +
      '"Avery asks the user:", with its options, one per line), or ' +
      'Michael\'s answer followed by "Avery\'s closing:" and her words. ' +
      '"Best" can be read as the champion (France in 2018, Argentina in ' +
      '2022) or as the most matches won or goals over both tournaments ' +
      '(France), and the readings give different answers. Score pass=true ' +
      'only if either she asks one question whose options are different ' +
      'readings of "best" that this World Cup data can answer, or her ' +
      'closing states the reading of "best" the answer assumed.',
  }),
  averyCase({
    id: 'avery-no-rows-free-kick-goals-2022',
    question:
      'Which goals at the 2022 World Cup were scored directly from free kicks?',
    intent:
      'No-answer playbook on empty rows: the only free-kick goal in the data is from 2018 (Trippier), so the 2022 filter matches no rows. No invented figures; the closing says nothing matched.',
    customChecks: (question) => [
      ...answered(question),
      readsPlaybook('no-answer'),
    ],
    judgeRubric:
      CLOSING +
      'No goal of the 2022 World Cup in the data was scored from a free ' +
      'kick: the filter matches no rows. Score pass=true only if her ' +
      'closing says that no 2022 goal in the data matched (none was scored ' +
      'directly from a free kick).',
  }),
  averyCase({
    id: 'avery-false-premise-goals-drop-2022',
    question: 'Why did goals drop at the 2022 World Cup compared with 2018?',
    intent:
      'False premise: goals rose from 23 (2018) to 24 (2022) over the 8 matches of each tournament in the data, so there is no drop to explain.',
    customChecks: (question) => [
      ...answered(question),
      answerStatesNumbers([[{ value: 23 }, { value: 24 }]]),
    ],
    judgeRubric:
      CLOSING +
      'The question assumes goals dropped in 2022, but the data shows they ' +
      'rose, from 23 in 2018 to 24 in 2022. Score pass=true only if her ' +
      'closing says the premise is false: goals did not drop, they rose.',
  }),
  averyCase({
    id: 'avery-partial-coverage-all-champions',
    question: 'Which teams have won the World Cup since the first one in 1930?',
    intent:
      'Partial coverage: the data holds only the 2018 (France) and 2022 (Argentina) tournaments, so it answers two of them; the limit comes first, and no champion from general knowledge.',
    customChecks: (question) => [
      ...answered(question),
      answerNamesAll(['France', 'Argentina']),
      answerStatesNone(['Italy', 'Germany', 'Spain']),
    ],
    judgeRubric:
      CLOSING +
      'The data holds only the 2018 and 2022 World Cups (won by France and ' +
      'Argentina), not every tournament since 1930. Score pass=true only if ' +
      'her closing begins with that limit: its first sentence says the data ' +
      'covers only the 2018 and 2022 tournaments, before any result.',
  }),
  averyCase({
    id: 'avery-simple-goals-2022',
    question: 'How many goals were scored at the 2022 World Cup?',
    intent:
      'A simple single-figure question (score 0-1): no playbook file, one brief to Michael, a one-sentence close. 24 goals in the 8 matches of 2022 in the data.',
    customChecks: (question) => [
      ...answered(question, { calls: [1, 1], sentences: [1, 1] }),
      readsNoPlaybook(),
      answerStatesNumbers([[{ value: 24 }]]),
    ],
  }),
  averyCase({
    id: 'avery-unanswerable-ticket-prices-2022-final',
    question: 'What was the average ticket price at the 2022 World Cup final?',
    intent:
      'A question the data cannot answer at all: it holds no ticket prices (attendance only). One brief to Michael, no second call; the closing says what is missing.',
    customChecks: (question) => answered(question, { calls: [1, 1] }),
    judgeRubric:
      CLOSING +
      'The data holds no ticket prices (it has match attendance, not ' +
      'prices), so the question cannot be answered from it. Score pass=true ' +
      'only if her closing says what is missing: the data has no ticket ' +
      'prices.',
  }),
];

export const AVERY_EVAL_SET: AssistantEvalSet = {
  id: 'avery-michael-workflow',
  name: 'Avery in Answer a Business Question (Avery + Michael)',
  description:
    'Avery, the Chief of Staff, in whole runs of Answer a Business Question ' +
    '(Avery + Michael) over the bundled World Cup sample: a ranking with a ' +
    'tie, a period change, an ambiguous word, a filter with no rows, a ' +
    'false premise, partial coverage, a simple question and one the data ' +
    'cannot answer. Select its PostgreSQL datasource with a saved dataset ' +
    'containing the world_cup tables and views.',
  fixtureId: AVERY_EVAL_FIXTURE_ID,
  agentKey: CHIEF_OF_STAFF_AGENT_KEY,
  target: AVERY_WORKFLOW_EVAL_TARGET,
  cases: AVERY_EVAL_CASES,
};
