import type { Agent } from '@mastra/core/agent';
import { checks } from '@mastra/evals/checks';
import type * as ExplainerAgent from '../agents/query-explainer.agent';
import type {
  AssistantEvalCase,
  AssistantEvalSet,
  EvalTarget,
} from './assistant.evals';
import {
  countsVerified,
  notFallback,
  startsFromATableItReads,
  textsInBusinessWords,
} from './query-explainer-eval-checks';
import {
  explainerTurnAgent,
  type ExplainQuery,
} from './query-explainer-eval-target';

/**
 * The eval set of Hannah, Query Explainer (agents.md 8.1, 2.12), run on the
 * `query-explainer` agent over the bundled World Cup sample. A case is one
 * statement with the reason it was run (the request the explainer gets in
 * the app); each probes one shape of query: an aggregate, a join with a
 * group, a rank kept with a filter, a CTE, a top N with a LIMIT, a distinct
 * count, a HAVING and a UNION. Every statement runs on the seeded
 * `world_cup` schema (tables and columns read from `001_world_cup.sql`).
 *
 * The target is the app's own turn (`explainForEval`): the answer is the
 * explanation as JSON text with its verified (or unverified) step counts.
 * Code checks hold what is deterministic (a usable reply, the start on a
 * table the query reads, business words, counts verified on the real data);
 * one judged rubric per case holds the one pass condition: the steps say
 * what the query does to the rows, in order, without inventing a filter or a
 * table.
 */

/** The sample fixture the set is bound to. */
export const QUERY_EXPLAINER_EVAL_FIXTURE_ID = 'world-cup';

/** The registry key of the agent the set runs on. */
export const QUERY_EXPLAINER_EVAL_AGENT_KEY = 'query-explainer';

interface ExplainerStatement {
  id: string;
  /** What the case probes. */
  intent: string;
  /** Why the query was run: the request's rationale line. */
  rationale: string;
  /** The statement explained: the question the case sends. */
  sql: string;
  /** The tables it reads (the start step must be one of them). */
  reads: string[];
  /** What the steps must say, in order: the judge's reference. */
  steps: string;
}

/** One pass condition, as every rubric states it. */
const PASS_RULE =
  ' Score pass=true only if the steps say what the query does to the rows, ' +
  'in order, in plain words, and invent no filter and no table the query ' +
  'does not have. Score pass=false if a step is missing, out of order, ' +
  'describes a filter, join or table the SQL does not hold, or restates the ' +
  'SQL instead of explaining it. The steps for the LIMIT or the final list ' +
  'are added by the app (a Show step), not written by the explainer.';

const STATEMENTS: ExplainerStatement[] = [
  {
    id: 'qe-aggregate-totals',
    intent:
      'An aggregate over a whole table: one row of totals, no group. The count steps must end on 1 row.',
    rationale:
      'Total goals and the average attendance over every match in the data',
    sql: 'SELECT SUM(home_goals + away_goals) AS total_goals, AVG(attendance) AS average_attendance FROM world_cup.matches',
    reads: ['world_cup.matches'],
    steps:
      'start from the matches; count or total them into one row (total goals and average attendance). No filter and no group.',
  },
  {
    id: 'qe-join-group-goals-per-team',
    intent:
      'A join with a group: goals looked up with their team, counted for each team, sorted.',
    rationale: 'Goals scored by each team, most goals first',
    sql: 'SELECT team.common_name AS team, COUNT(*) AS goals FROM world_cup.goals goal JOIN world_cup.teams team ON team.id = goal.scoring_team_id GROUP BY team.common_name ORDER BY goals DESC',
    reads: ['world_cup.goals', 'world_cup.teams'],
    steps:
      'start from the goals; add the team of each goal (a join with teams); group by team and count the goals of each; sort by goals, most first. No filter.',
  },
  {
    id: 'qe-rank-kept-with-filter',
    intent:
      'A rank kept with a filter: a rank is worked out over the grouped rows and only the top three are kept.',
    rationale: 'The three teams that scored the most goals, with their goals',
    sql: 'SELECT team, goals FROM (SELECT team.common_name AS team, COUNT(*) AS goals, RANK() OVER (ORDER BY COUNT(*) DESC) AS goal_rank FROM world_cup.goals goal JOIN world_cup.teams team ON team.id = goal.scoring_team_id GROUP BY team.common_name) ranked WHERE goal_rank <= 3',
    reads: ['world_cup.goals', 'world_cup.teams'],
    steps:
      'start from the goals; add the team of each goal; group by team and count the goals; work out a rank by goals (a compute step); keep only the teams ranked 1 to 3 (a keep step). Ties can keep more than three teams.',
  },
  {
    id: 'qe-cte-high-scoring-matches',
    intent:
      'A CTE: matches get their total goals in a named subquery, then the high-scoring ones are filtered and counted.',
    rationale: 'How many matches had four goals or more',
    sql: 'WITH match_goals AS (SELECT id, home_goals + away_goals AS goals FROM world_cup.matches) SELECT COUNT(*) AS high_scoring_matches FROM match_goals WHERE goals >= 4',
    reads: ['world_cup.matches'],
    steps:
      'start from the matches; work out the goals of each match (compute); keep the matches with 4 goals or more; count them into one row. The CTE is not a table of its own.',
  },
  {
    id: 'qe-top-n-limit-attendance',
    intent:
      'A top N with a LIMIT: matches sorted by attendance and only five listed. The LIMIT is no step of the explainer.',
    rationale: 'The five matches with the biggest crowds',
    sql: 'SELECT match_number, stage, attendance FROM world_cup.matches ORDER BY attendance DESC LIMIT 5',
    reads: ['world_cup.matches'],
    steps:
      'start from the matches; sort them by attendance, biggest first. The LIMIT of 5 is the Show step the app adds, so a step for it is not needed; a step that says only five matches are kept is acceptable if it does not change the sort.',
  },
  {
    id: 'qe-distinct-count-scorers',
    intent:
      'A distinct count after a filter: the goals with a known scorer, the different scorers counted.',
    rationale: 'How many different players scored at least one goal',
    sql: 'SELECT COUNT(DISTINCT scorer_player_id) AS different_scorers FROM world_cup.goals WHERE scorer_player_id IS NOT NULL',
    reads: ['world_cup.goals'],
    steps:
      'start from the goals; keep the goals that have a known scorer; count the different scorers into one row.',
  },
  {
    id: 'qe-having-repeat-scorers',
    intent:
      'A HAVING: goals grouped by scorer and only the scorers with two goals or more are kept, sorted.',
    rationale: 'Players who scored two goals or more, with their goals',
    sql: 'SELECT player.full_name AS player, COUNT(*) AS goals FROM world_cup.goals goal JOIN world_cup.players player ON player.id = goal.scorer_player_id GROUP BY player.full_name HAVING COUNT(*) >= 2 ORDER BY goals DESC',
    reads: ['world_cup.goals', 'world_cup.players'],
    steps:
      'start from the goals; add the player of each goal (a join with players); group by player and count their goals; keep the players with 2 goals or more (a keep after the count); sort by goals, most first.',
  },
  {
    id: 'qe-union-teams-played',
    intent:
      'A UNION: the home teams and the away teams are put together, duplicates removed.',
    rationale: 'Every team that played a match, home or away, once each',
    sql: 'SELECT home.common_name AS team FROM world_cup.matches m JOIN world_cup.teams home ON home.id = m.home_team_id UNION SELECT away.common_name FROM world_cup.matches m JOIN world_cup.teams away ON away.id = m.away_team_id',
    reads: ['world_cup.matches', 'world_cup.teams'],
    steps:
      'start from the matches; bring in the teams that played at home and the teams that played away (in one step or in two, in either order); put the two lists into one without repeats.',
  },
];

function rubricOf(statement: ExplainerStatement): string {
  return (
    `The explainer was asked to explain this PostgreSQL statement: ${statement.sql} ` +
    `(run to answer: "${statement.rationale}"). What the steps should say, in order: ${statement.steps}` +
    PASS_RULE
  );
}

export const QUERY_EXPLAINER_EVAL_CASES: AssistantEvalCase[] = STATEMENTS.map(
  (statement): AssistantEvalCase => ({
    id: statement.id,
    // The statement explained: the target reads it from the question.
    question: statement.sql,
    intent: `${statement.intent} Run to answer: ${statement.rationale}.`,
    // `runEvals` needs one built-in check: the answer holds the steps list.
    scorers: [checks.includes('"steps"')],
    customChecks: [
      notFallback(),
      startsFromATableItReads(statement.reads),
      textsInBusinessWords(),
      countsVerified(),
    ],
    judgeRubric: rubricOf(statement),
  }),
);

export const QUERY_EXPLAINER_EVAL_SET: AssistantEvalSet = {
  id: 'query-explainer',
  name: 'Query Explainer',
  description:
    'Statements for Hannah, Query Explainer, over the bundled World Cup ' +
    'sample: an aggregate, a join with a group, a rank kept with a filter, ' +
    'a CTE, a top N with a LIMIT, a distinct count, a HAVING and a UNION. ' +
    'Each is explained step by step and its step counts are run on the ' +
    'real data. Select its PostgreSQL datasource with a saved dataset ' +
    'containing the world_cup tables and views.',
  fixtureId: QUERY_EXPLAINER_EVAL_FIXTURE_ID,
  agentKey: QUERY_EXPLAINER_EVAL_AGENT_KEY,
  cases: QUERY_EXPLAINER_EVAL_CASES,
};

/** The reason a statement was run, by the statement (the case's question). */
export function rationaleOfStatement(sql: string): string | undefined {
  return STATEMENTS.find((statement) => statement.sql === sql)?.rationale;
}

/**
 * The real agent and its model call, required on first use: they keep
 * Mastra off the module graph of the eval catalogue (which Jest and the
 * Agents screen load without running a case).
 */
function defaultAgent(): typeof ExplainerAgent {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../agents/query-explainer.agent') as typeof ExplainerAgent;
}

/**
 * The eval target of one `query-explainer` run (agents.md 8.1): the agent,
 * its `generate` replaced by the app's turn for one statement. The explainer
 * gets no orientation and no knowledge (its request holds its own context),
 * and the case's judge reads the explanation JSON.
 */
export function queryExplainerEvalTarget(
  loadAgent: () => Agent = () => defaultAgent().queryExplainerAgent,
  explain: ExplainQuery = (input) =>
    defaultAgent().explainQueryWithModel(input),
): EvalTarget {
  let agent: Agent | undefined;
  let run: Agent | undefined;
  return {
    agentKey: QUERY_EXPLAINER_EVAL_AGENT_KEY,
    get agent(): Agent {
      agent ??= loadAgent();
      return agent;
    },
    // Each case explains one statement, as the app does (not an agent chat).
    get runTarget(): Agent {
      run ??= explainerTurnAgent(
        (agent ??= loadAgent()),
        explain,
        rationaleOfStatement,
      );
      return run;
    },
    sets: [QUERY_EXPLAINER_EVAL_SET],
    sendsKnowledge: false,
    orientation: () => '',
  };
}
