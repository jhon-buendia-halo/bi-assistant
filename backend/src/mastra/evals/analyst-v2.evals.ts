import type { Agent } from '@mastra/core/agent';
import { checks } from '@mastra/evals/checks';
import { assistantV2Agent } from '../agents/assistant-v2.agent';
import { ASSISTANT_V2_TOOL_NAMES } from '../agents/assistant-v2-catalog';
import { entityOrientationLines } from '../context-blocks';
import type { OptionalAgentTool } from '../agent-tools';
import type {
  AssistantEvalCase,
  AssistantEvalSet,
  EvalTarget,
} from './assistant.evals';
import {
  answerNamesAll,
  answerStatesNone,
  answerStatesNumbers,
  hasMarkdownTable,
  ranSuccessfulSql,
  usesStoredValue,
} from './analyst-v2-eval-checks';

/**
 * The data-analyst eval set of Questions to Insights v2 (agents.md 8.1, 2.11):
 * run on the `assistant-v2` agent over the bundled World Cup sample. Each case
 * probes one analyst skill: a ranking with ties, a share, a period comparison,
 * a coverage limit, a question that must be clarified, one that must not, a
 * value lookup, a multi-step question.
 *
 * Every expected figure was read from the seeded `world_cup` schema on
 * 2026-11-13 (16 matches: the quarter-finals to the final of 2018 and 2022;
 * 47 goals, 23 in 2018 and 24 in 2022). US Health is not in the set: it has
 * no entry in the fixture registry, so the preflight cannot bind a set to it.
 *
 * Code checks hold what is deterministic (a successful query, no tool error,
 * the figures and names the data gives, a table for three or more values);
 * the judge rubrics grade the answer's quality. Cases are not run with a
 * tool selection: the agent offers the tools it has.
 */

/** The sample fixture the set is bound to. */
export const ANALYST_V2_EVAL_FIXTURE_ID = 'world-cup';

/** The registry key of the agent the set runs on. */
export const ANALYST_V2_EVAL_AGENT_KEY = 'assistant-v2';

/**
 * The rules every answer case's rubric ends with (the analyst answer
 * format): a headline with the key figure, nothing from general knowledge, no
 * schema or SQL dump.
 */
const ANSWER_FORMAT =
  ' The answer must also open with a one-line headline that states the key ' +
  'figure, rest every figure and fact on the queries it ran (anything that ' +
  'only general knowledge of football would supply fails), and not dump a ' +
  'schema or SQL into the answer.';

const ANALYST_V2_EVAL_CASES: AssistantEvalCase[] = [
  {
    id: 'v2-ranking-ties-top-scorers-2018',
    question: 'Who were the top scorers of the 2018 World Cup?',
    intent:
      'Ranking with ties: three players share the top count (Griezmann, Perisic and Mandzukic, 2 goals each, own goals not counted), so a LIMIT 1 answer is wrong.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ranSuccessfulSql(),
      answerNamesAll(['Griezmann', 'Perisic', 'Mandzukic']),
      answerStatesNumbers([[{ value: 2 }]]),
      hasMarkdownTable(3),
    ],
    expectedSql:
      'SELECT player, goals FROM world_cup.v_player_goal_totals ' +
      'WHERE tournament_year = 2018 AND goals = (SELECT MAX(goals) FROM ' +
      'world_cup.v_player_goal_totals WHERE tournament_year = 2018)',
    judgeRubric:
      'In the 2018 data three players tie for the most goals, 2 each: Antoine ' +
      'Griezmann, Ivan Perisic and Mario Mandzukic (own goals are not goals ' +
      'scored). Score pass=true only if the final answer names all three as ' +
      'the top scorers with 2 goals each and makes clear that they are tied ' +
      '(it does not crown one of them alone and does not leave one out). It ' +
      'may also list the players on 1 goal. Score pass=false if it names a ' +
      'single top scorer, a different count, or fewer than the three.' +
      ANSWER_FORMAT,
  },
  {
    id: 'v2-share-penalty-goals-2022',
    question:
      'What share of the goals in the 2022 World Cup came from penalties?',
    intent:
      'Ratio: 6 penalty goals of 24 goals in 2022 is 25%. Shootout kicks are not goals of the match, so the denominator is the goals table.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ranSuccessfulSql(),
      answerStatesNumbers([
        [{ value: 25, tolerance: 0.5 }],
        [{ value: 6 }, { value: 24 }],
      ]),
    ],
    judgeRubric:
      'The data holds 24 goals for 2022, 6 of them penalties scored during ' +
      'matches (not shootout kicks), so the share is 25%. Score pass=true ' +
      'only if the final answer gives the share as 25% (or 6 of 24, one ' +
      'quarter) and says what it counted (goals of the matches in the data, ' +
      'penalty shootouts not included, or the counts it used). Score ' +
      'pass=false if the share is a different figure, if it counts shootout ' +
      'kicks as goals, or if the figure is not backed by its queries.' +
      ANSWER_FORMAT,
  },
  {
    id: 'v2-compare-goals-per-match-2018-2022',
    question:
      'How did the average number of goals per match change between the 2018 and 2022 World Cups?',
    intent:
      'Period comparison: 23 goals in 8 matches (2.875) in 2018 against 24 in 8 (3.0) in 2022, a rise of about 0.13 goals per match (4%).',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ranSuccessfulSql(),
      answerStatesNumbers([
        [
          { value: 2.875, tolerance: 0.03 },
          { value: 3, tolerance: 0.03 },
        ],
      ]),
    ],
    judgeRubric:
      'In the data 2018 averages 2.875 goals per match (23 goals in 8 ' +
      'matches) and 2022 averages 3.0 (24 goals in 8 matches): a small rise, ' +
      'about 0.13 goals per match or 4%. Score pass=true only if the final ' +
      'answer gives both averages (rounded to at most 2 decimals), says the ' +
      'average went UP from 2018 to 2022 by about 0.1 goals, and states what ' +
      'the comparison covers (the 8 matches of each tournament in the data, ' +
      'or that it holds only knockout matches). Score pass=false if the ' +
      'direction or the averages are wrong, or the answer implies the data ' +
      'covers whole tournaments with their group stage.' +
      ANSWER_FORMAT,
  },
  {
    id: 'v2-out-of-coverage-2014-final',
    question:
      'Who won the 2014 World Cup, and what was the score of the final?',
    intent:
      'Out of coverage: the data holds 2018 and 2022 only. The answer must say so and give no result from general knowledge.',
    scorers: [checks.noToolErrors()],
    customChecks: [answerStatesNone(['Germany', 'Gotze', 'Mario Gotze'])],
    judgeRubric:
      'The question asks about 2014, a tournament this dataset does not ' +
      'cover (it holds the 2018 and 2022 World Cups). Score pass=true only ' +
      'if the final answer clearly says the data has no 2014 tournament, ' +
      'states what the data does cover (2018 and 2022), and gives no 2014 ' +
      'winner, score or other fact from general knowledge. Offering to ' +
      'answer the same question for 2018 or 2022 is fine. Score pass=false ' +
      'if it names a 2014 winner or score, or does not say what is covered.',
  },
  {
    id: 'v2-clarify-most-dominant-team',
    question: 'Which team was the most dominant?',
    intent:
      'Ambiguous metric and scope: "dominant" could mean results, goals, possession or shots, and the choice changes the analysis. The agent must ask one clarifying question.',
    scorers: [
      checks.calledTool('ask_clarification'),
      checks.didNotCall('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    judgeRubric:
      'The question ("Which team was the most dominant?") does not say what ' +
      '"dominant" means (results? goals? possession? shots?) nor which ' +
      'tournament, and each reading changes the analysis. Score pass=true ' +
      'only if the final answer is itself ONE clarifying question that ' +
      'offers 2-4 concrete options grounded in this World Cup data (a named ' +
      'measure such as matches won, goals or possession, or a tournament ' +
      'year in the data) and states no figure as if it were the answer. ' +
      'Score pass=false if it answers with data, asks several questions, ' +
      'asks a vague open question with no concrete options, or invents a ' +
      'measure or scope the data does not have.',
  },
  {
    id: 'v2-no-clarify-total-goals',
    question: 'How many goals were scored at the World Cup?',
    intent:
      'Fuzzy scope that must NOT be clarified: the natural default is every tournament in the data (47 goals: 23 in 2018, 24 in 2022). The agent states the assumption.',
    scorers: [checks.didNotCall('ask_clarification'), checks.noToolErrors()],
    customChecks: [
      ranSuccessfulSql(),
      answerStatesNumbers([[{ value: 47 }], [{ value: 23 }, { value: 24 }]]),
    ],
    judgeRubric:
      'The question does not name a tournament, but the natural reading is ' +
      'every tournament in the data, which holds 47 goals (23 in 2018 and 24 ' +
      'in 2022). Score pass=true only if the final answer gives 47 in total ' +
      '(or 23 and 24 per tournament), states the scope it assumed (the 2018 ' +
      'and 2022 tournaments in the data) and does not ask the user a ' +
      'question instead of answering. Score pass=false if it asks which ' +
      'tournament the user means, gives another total, or does not say what ' +
      'it covered.' +
      ANSWER_FORMAT,
  },
  {
    id: 'v2-value-lookup-free-kick-goals',
    question:
      'How many goals came directly from free kicks, and who scored them?',
    intent:
      'Value lookup: goal types are stored as snake_case codes (`free_kick`), so a guessed literal returns no rows. One goal: Kieran Trippier, England, 2018.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ranSuccessfulSql(),
      usesStoredValue('free_kick'),
      answerNamesAll(['Trippier']),
      answerStatesNumbers([[{ value: 1 }]]),
    ],
    expectedSql:
      'SELECT player.full_name AS scorer FROM world_cup.goals goal ' +
      'JOIN world_cup.players player ON player.id = goal.scorer_player_id ' +
      "WHERE goal.goal_type = 'free_kick'",
    judgeRubric:
      'The data holds exactly one goal of type free kick: Kieran Trippier ' +
      '(England, 2018, minute 5). Score pass=true only if the final answer ' +
      'says one goal came directly from a free kick and names Kieran ' +
      'Trippier. An empty-handed "no free-kick goals" answer, or a different ' +
      'count or scorer, is pass=false.' +
      ANSWER_FORMAT,
  },
  {
    id: 'v2-multistep-top-team-top-scorer-2022',
    question:
      'Which team scored the most goals in the 2022 World Cup, and who was its leading scorer?',
    intent:
      'Two chained queries: Argentina scored 8 goals (France 7); its leading scorer is Lionel Messi with 4.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ranSuccessfulSql(),
      answerNamesAll(['Argentina', 'Messi']),
      answerStatesNumbers([[{ value: 8 }, { value: 4 }]]),
    ],
    // No expectedSql: the model may add the goal types of a team's goals
    // itself (never running one `Argentina | 8` query), which the
    // positional result-set check cannot tell from a wrong answer.
    judgeRubric:
      'In the 2022 data Argentina scored the most goals (8, ahead of France ' +
      'with 7) and its leading scorer is Lionel Messi with 4 goals. Score ' +
      'pass=true only if the final answer names Argentina with 8 goals and ' +
      'Lionel Messi with 4 goals. Score pass=false if either part is ' +
      'missing or wrong.' +
      ANSWER_FORMAT,
  },
  {
    id: 'v2-ranking-ties-busiest-stadium',
    question: 'Which stadium hosted the most matches?',
    intent:
      'Ranking with ties on a count: Lusail Stadium (2022) and Saint Petersburg Stadium (2018) host 3 matches each.',
    scorers: [checks.noToolErrors()],
    customChecks: [
      ranSuccessfulSql(),
      answerNamesAll(['Lusail', 'Saint Petersburg']),
      answerStatesNumbers([[{ value: 3 }]]),
    ],
    expectedSql:
      'SELECT venue, COUNT(*) AS matches FROM world_cup.v_match_results ' +
      'GROUP BY venue HAVING COUNT(*) = (SELECT MAX(per_venue.matches) FROM ' +
      '(SELECT COUNT(*) AS matches FROM world_cup.v_match_results GROUP BY venue) per_venue)',
    judgeRubric:
      'Two stadiums tie for the most matches in the data, 3 each: Lusail ' +
      'Stadium and Saint Petersburg Stadium. Score pass=true only if the ' +
      'final answer names both with 3 matches each and makes clear they are ' +
      'tied. Score pass=false if it names one stadium alone, a different ' +
      'count, or a stadium that does not host the most.' +
      ANSWER_FORMAT,
  },
  {
    id: 'v2-coverage-group-stage-wins',
    question: 'How many group-stage matches did Argentina win in 2022?',
    intent:
      'Coverage check before answering: the data holds no group-stage matches (stages are quarter_final, semi_final, third_place, final), so the true answer is that it cannot say.',
    scorers: [checks.noToolErrors()],
    customChecks: [ranSuccessfulSql()],
    judgeRubric:
      'The data holds only the knockout stages (quarter-finals, semi-finals, ' +
      'third place and final) of 2018 and 2022: there are no group-stage ' +
      'matches. Score pass=true only if the final answer says the data has ' +
      'no group-stage matches, so it cannot give a group-stage win count ' +
      '(saying 0 as if it were a result does not count as stating it), and ' +
      'says what the data does hold (the knockout stage). Offering the ' +
      'knockout record is fine, if backed by its queries. Score pass=false ' +
      'if it states a group-stage win count as a fact, or does not say that ' +
      'the group stage is missing.',
  },
];

export const ANALYST_V2_EVAL_SET: AssistantEvalSet = {
  id: 'analyst-v2',
  name: 'Analyst v2',
  description:
    'Data-analyst questions for Questions to Insights v2 over the bundled ' +
    'World Cup sample: rankings with ties, a share, a period comparison, ' +
    'coverage limits, a question to clarify and one not to, a value lookup ' +
    'and a multi-step question. Select its PostgreSQL datasource with a ' +
    'saved dataset containing the world_cup tables and views.',
  fixtureId: ANALYST_V2_EVAL_FIXTURE_ID,
  agentKey: ANALYST_V2_EVAL_AGENT_KEY,
  cases: ANALYST_V2_EVAL_CASES,
};

/** The optional tools v2's orientation names, from its tool list. */
export function v2OrientationSelection(
  toolNames: readonly string[] = ASSISTANT_V2_TOOL_NAMES,
): OptionalAgentTool[] {
  return toolNames.includes('sample_rows') ? ['sample_rows'] : [];
}

/**
 * The eval target of one `assistant-v2` run (agents.md 8.1): Block 1's dataset
 * half as v2's own turn builds it (with the `sample_rows` hint only when the
 * agent has that tool), and the curated-knowledge block once the agent gets it
 * (together with `sample_rows`, analyst plan P1). The agent loads on first use.
 */
export function analystV2EvalTarget(
  loadAgent: () => Agent = () => assistantV2Agent,
  toolNames: readonly string[] = ASSISTANT_V2_TOOL_NAMES,
): EvalTarget {
  let agent: Agent | undefined;
  const selection = v2OrientationSelection(toolNames);
  return {
    agentKey: ANALYST_V2_EVAL_AGENT_KEY,
    get agent(): Agent {
      agent ??= loadAgent();
      return agent;
    },
    sets: [ANALYST_V2_EVAL_SET],
    // The judge checks that every fact rests on a query, so it reads the
    // whole result the model saw, not its first 2,000 characters.
    judgeTraceChars: 12_000,
    sendsKnowledge: selection.includes('sample_rows'),
    orientation: ({ datasets, snapshots }) =>
      entityOrientationLines(datasets, snapshots, selection).join('\n'),
  };
}
