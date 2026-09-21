import { checks } from '@mastra/evals/checks';
import { runEvals } from '@mastra/core/evals';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraScorer } from '@mastra/core/evals';
import { assistantAgent } from '../agents/assistant.agent';
import { resolveAgentModel } from '../model-resolver';
import { providerOptionsFor } from '../model-compat';
import {
  evalJudgeAgent,
  evalJudgeOutputSchema,
} from '../agents/eval-judge.agent';
import { ASSISTANT_MAX_STEPS } from '../agent-constants';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset.tools';
import {
  SESSION_ID_CONTEXT_KEY,
  TURN_RECORDS_CONTEXT_KEY,
} from '../tools/visual.tools';
import { getDatasetToolServices } from '../tool-services';
import { entityOrientationLines } from '../context-blocks';
import { runResultSetCheck } from './result-set-check';
import type { ResultSetCheckOptions } from './result-set-check';
import {
  assistantEvalDatasetError,
  evalFixture,
} from './assistant-eval-datasets';
import type { SampleFixture } from '../../modules/testing-data/fixtures/registry';
import {
  synthesizeToolOnlyTurn,
  toolDataRecord,
} from '../../modules/sessions/turn-data';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import type { SessionsService } from '../../modules/sessions/sessions.service';

/**
 * Eval suite for the Questions to Insights assistant.
 *
 * The questions are grouped into sets, one per bundled sample (World Cup,
 * Formula 1), and every expected substring below is a fact that is actually in
 * that sample's data — a check failing means the agent got it wrong, not that
 * the fixture drifted.
 *
 * The assistant resolves its entities from the session's datasets via
 * requestContext, so each case carries the dataset it is allowed to query.
 */

/**
 * `runEvals` keys its scores by scorer id, so two scorers of the same kind in
 * one case would collide — each case below uses each check type at most once.
 */
export interface AssistantEvalCase {
  /** Short id used when reporting per-question scores. */
  id: string;
  question: string;
  /** What the question is probing for, for the run report. */
  intent: string;
  scorers: MastraScorer<any, any, any, any>[];
  /**
   * Trusted SQL against the eval datasource whose live result set is the
   * reference answer. When present, `runAssistantEvalCase` compares it
   * (via `runResultSetCheck`) against the agent's successful
   * `run_readonly_sql` results and adds that as the case's primary
   * correctness signal, on top of the text/tool `scorers` above.
   */
  expectedSql?: string;
  resultSetOptions?: ResultSetCheckOptions;
  /**
   * A natural-language grading rubric for cases where a regex/text check on
   * the final answer would be too brittle (clarification quality, refusal
   * quality, whether a visual plausibly answers the request). When present,
   * `runAssistantEvalCase` scores it with the LLM judge
   * (`../agents/eval-judge.agent`) as an additional check.
   */
  judgeRubric?: string;
}

/**
 * A named group of eval questions that share one fixture. Sets exist so the
 * suite can grow past the World Cup sample without the questions tab becoming
 * one undifferentiated list — a future set brings its own schema and its own
 * datasource, and the two must not be run against each other.
 */
export interface AssistantEvalSet {
  /** Stable id, used by the API and the questions tab's selection. */
  id: string;
  name: string;
  /** What the set covers and what it needs to run, shown above its questions. */
  description: string;
  /**
   * The sample this set questions, by `SampleFixture.id`. The data preflight
   * takes the entities the set requires from that registry entry, so the list
   * lives in exactly one place for both the loader and the suite.
   */
  fixtureId: string;
  cases: AssistantEvalCase[];
}

const WORLD_CUP_EVAL_CASES: AssistantEvalCase[] = [
  {
    id: 'champion-2022',
    question: 'Who won the 2022 World Cup?',
    intent: 'Single-hop lookup against tournaments — the simplest happy path.',
    scorers: [
      checks.includes('Argentina'),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    expectedSql:
      'SELECT champion.common_name AS champion ' +
      'FROM world_cup.tournaments tournament ' +
      'JOIN world_cup.teams champion ON champion.id = tournament.champion_team_id ' +
      'WHERE tournament.tournament_year = 2022',
  },
  {
    id: 'final-score-2018',
    question: 'What was the score of the 2018 World Cup final?',
    intent:
      'Filter matches by stage and tournament, then read both goal columns.',
    scorers: [
      checks.matches(/4\s*[-–:]\s*2/),
      checks.includes('France'),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    expectedSql:
      'SELECT home.common_name AS home_team, away.common_name AS away_team, ' +
      'match.home_goals, match.away_goals ' +
      'FROM world_cup.matches match ' +
      'JOIN world_cup.tournaments tournament ON tournament.id = match.tournament_id ' +
      'JOIN world_cup.teams home ON home.id = match.home_team_id ' +
      'JOIN world_cup.teams away ON away.id = match.away_team_id ' +
      "WHERE tournament.tournament_year = 2018 AND match.stage = 'final'",
  },
  {
    id: 'top-scorer-2022',
    question: 'Who scored the most goals in the 2022 World Cup, and how many?',
    intent:
      'Aggregate over goals joined to players, excluding own goals — the classic GROUP BY question.',
    scorers: [
      checks.includes('Messi'),
      checks.matches(/\b4\b/),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    expectedSql:
      'SELECT player, goals FROM world_cup.v_player_goal_totals ' +
      'WHERE tournament_year = 2022 ORDER BY goals DESC, player LIMIT 1',
  },
  {
    id: 'shootouts',
    question:
      'Which knockout matches went to a penalty shootout, and who advanced?',
    intent:
      'Requires noticing that shootouts are encoded as non-null penalty columns, not a flag.',
    scorers: [
      checks.includes('Croatia'),
      checks.matches(/Argentina/i),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    expectedSql:
      'SELECT tournament_year, home_team, away_team, winner ' +
      'FROM world_cup.v_match_results WHERE home_penalties IS NOT NULL ' +
      'ORDER BY tournament_year, match_number',
  },
  {
    id: 'biggest-venue',
    // Several matches can tie at the same venue and attendance. The question
    // asks for the distinct venue/attendance fact, not the number of matches.
    resultSetOptions: { distinctRows: true },
    question:
      'Which stadium hosted the best-attended match, and what was the attendance?',
    intent: 'Join matches to venues and order by a nullable measure.',
    scorers: [
      checks.includes('Lusail'),
      checks.matches(/88[,.]?966/),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    expectedSql:
      'SELECT DISTINCT venue, attendance FROM world_cup.v_match_results ' +
      'WHERE attendance = (SELECT MAX(attendance) FROM world_cup.v_match_results)',
  },
  {
    id: 'schema-discovery',
    question: 'What data do I have available to analyse?',
    intent:
      'Pure discovery — must inspect the session datasets rather than invent entities or run SQL.',
    scorers: [
      checks.calledTool('list_entities'),
      checks.includes('matches'),
      checks.didNotCall('run_readonly_sql'),
      checks.noToolErrors(),
    ],
  },
  {
    id: 'ambiguous-best-team',
    question: 'Which team performed best?',
    intent:
      'Ambiguous on both metric and tournament — the agent must ask instead of guessing.',
    scorers: [
      checks.calledTool('ask_clarification'),
      checks.didNotCall('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    // Regex can confirm ask_clarification fired; it cannot judge whether the
    // question itself is well-formed, so that quality dimension goes to the
    // judge instead of a brittle text check.
    judgeRubric:
      'The question ("Which team performed best?") is ambiguous on both the ' +
      'performance metric (goals? wins? possession?) and the scope ' +
      '(which tournament/year). Score pass=true only if the final answer is ' +
      'itself a clarifying question — not an attempt to answer with data — ' +
      'that offers 2-4 concrete, well-formed options grounded in this World ' +
      'Cup dataset (e.g. naming an actual metric like goals/wins/possession, ' +
      'or an actual tournament year in the data such as 2018 or 2022), and ' +
      'that does not state any performance figures as if they were the ' +
      'answer. Score pass=false if it guesses an answer, invents a metric ' +
      'or scope not in the data, or asks a vague open-ended question with no ' +
      'concrete options.',
  },
  {
    id: 'possession-vs-result',
    question:
      'In the 2022 knockout rounds, did the team with more possession usually win?',
    intent:
      'Two-table reasoning over match_team_statistics — the answer must be a judgement backed by counts, not a row dump.',
    scorers: [
      checks.calledTool('run_readonly_sql'),
      checks.matches(/\b(possession|%)\b/i),
      checks.noToolErrors(),
    ],
    // No expectedSql: the reference answer here is two scalar counts, and
    // `runResultSetCheck` compares row sets positionally, so it cannot tell
    // that a wide reference row ({won: 2, lost: 6}) and the equivalent long
    // aggregate ([{outcome, matches}, …]) state the same fact. A correct
    // agent that grouped by outcome instead of pivoting scored 0 against a
    // reference it actually agreed with. Both orientations answer the
    // question, so the counts are graded in the rubric below instead.
    judgeRubric:
      'The question asks whether, in the 2022 knockout rounds, the team with ' +
      'more possession usually won. In this dataset the answer is NO: of the ' +
      '8 knockout matches, the team with higher possession won 2 and lost 6. ' +
      'Score pass=true only if the final answer concludes that more ' +
      'possession did NOT usually win, and backs it with counts or ' +
      'percentages consistent with 2 of 8 won / 6 of 8 lost (equivalently ' +
      '25% / 75%). Any query shape is acceptable — per-stage breakdowns, ' +
      'per-match tables or a single pivoted row all count, as do minor ' +
      'rewordings. Score pass=false if it concludes more possession usually ' +
      'won, gives no counts at all, or states counts that contradict 2 won / ' +
      '6 lost.',
  },
  {
    id: 'out-of-scope',
    question: 'How many goals did Pelé score in the 1970 World Cup?',
    intent:
      'The fixture only covers 2018 and 2022 — the agent must say so instead of fabricating a number.',
    // The regex/excludes text checks this case used to run were brittle (a
    // refusal phrased without any of the listed words would fail, and a
    // fabricated answer that avoided the exact phrase "Pelé scored 4" would
    // pass) — a judge reads the actual claim instead of matching words.
    scorers: [checks.noToolErrors()],
    judgeRubric:
      'The question asks about 1970, a year this dataset does not cover (it ' +
      'only has 2018 and 2022). Score pass=true only if the final answer ' +
      'clearly states it cannot answer for 1970 AND explicitly states what ' +
      'the data DOES cover (2018 and/or 2022), without inventing any goal ' +
      'count, statistic or claim about Pelé or the 1970 tournament. Score ' +
      'pass=false if it states or implies any 1970 statistic, or fails to ' +
      'state what the data actually covers.',
  },
  {
    id: 'visual-request',
    question: 'Chart the goals scored by each team in the 2022 knockout stage.',
    intent:
      'Answer first, then build a visual — checks the SQL → create_visual ordering.',
    scorers: [
      checks.toolOrder(['run_readonly_sql', 'create_visual']),
      checks.calledTool('create_visual'),
      checks.noToolErrors(),
    ],
    judgeRubric:
      'The user asked for a chart of goals scored by each team in the 2022 ' +
      'World Cup knockout stage. Score pass=true only if a create_visual (or ' +
      'update_visual) tool call succeeded and its title/description ' +
      'plausibly describes a chart of goals per team for the 2022 knockout ' +
      'matches (not an unrelated metric, an unrelated tournament/year, or a ' +
      'chart that clearly covers something else). Score pass=false if no ' +
      'visual tool call succeeded, or the visual it produced does not match ' +
      'this request.',
  },
];

/**
 * Grounded in the Formula 1 fixture (`formula1` schema, 1950-2026). Every
 * figure below was run against that database before it was written down, so a
 * failing check means the agent got it wrong rather than the fixture drifting.
 *
 * The `expectedSql` references are deliberately narrow — usually the single
 * figure that settles the question. `runResultSetCheck` compares
 * width-tolerantly, so a narrow reference matches any wider agent result that
 * carries the same fact, which keeps the check from failing merely because the
 * agent projected `driver.full_name` where the reference used `driver.name`.
 */
const FORMULA_1_EVAL_CASES: AssistantEvalCase[] = [
  {
    id: 'f1-champion-2023',
    question:
      "Who won the 2023 Formula 1 drivers' championship, and how many points " +
      'did they finish on?',
    intent:
      'Single-hop lookup against the season standings — the simplest happy path.',
    scorers: [
      checks.includes('Verstappen'),
      checks.matches(/575/),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    // Reference is the points total alone: the champion's name lives in
    // `driver` under both `name` and `full_name`, and either projection is a
    // correct answer, so the points are what the comparison pins down.
    expectedSql:
      'SELECT standing.points ' +
      'FROM formula1.season_driver_standing standing ' +
      'WHERE standing.year = 2023 AND standing.position_number = 1',
  },
  {
    id: 'f1-british-gp-2023',
    question:
      'At which circuit was the 2023 British Grand Prix held, and how many ' +
      'laps did the race run to?',
    intent:
      'Filter a race by season and grand prix, which needs the race/grand_prix (and circuit) join rather than a single table.',
    scorers: [
      checks.includes('Silverstone'),
      checks.matches(/\b52\b/),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    expectedSql:
      'SELECT race.laps ' +
      'FROM formula1.race race ' +
      'JOIN formula1.grand_prix grand_prix ON grand_prix.id = race.grand_prix_id ' +
      "WHERE race.year = 2023 AND grand_prix.name = 'Great Britain'",
  },
  {
    id: 'f1-most-race-wins',
    question:
      'Which driver has won the most Grands Prix in Formula 1 history, and ' +
      'how many did they win?',
    intent:
      'A "most" question with a verifiable number — the answer is the same whether it is read off the driver totals or aggregated from race results.',
    scorers: [
      checks.includes('Hamilton'),
      checks.matches(/\b106\b/),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    expectedSql:
      'SELECT driver.total_race_wins AS wins ' +
      'FROM formula1.driver driver ' +
      'ORDER BY driver.total_race_wins DESC LIMIT 1',
  },
  {
    id: 'f1-most-titles-tie',
    question:
      "Which drivers have won the most Formula 1 drivers' championships, and " +
      'how many each?',
    intent:
      'A genuine tie at the top (two drivers on seven titles) — a LIMIT 1 answer is wrong here, so this catches agents that rank instead of handling ties.',
    scorers: [
      checks.includes('Schumacher'),
      checks.matches(/Hamilton/i),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    expectedSql:
      'SELECT driver.name AS driver, COUNT(*) AS championships ' +
      'FROM formula1.season_driver_standing standing ' +
      'JOIN formula1.driver driver ON driver.id = standing.driver_id ' +
      'WHERE standing.position_number = 1 ' +
      'GROUP BY driver.name ' +
      'HAVING COUNT(*) = (SELECT MAX(title_count) FROM (' +
      'SELECT COUNT(*) AS title_count FROM formula1.season_driver_standing ' +
      'WHERE position_number = 1 GROUP BY driver_id) counts) ' +
      'ORDER BY driver',
  },
  {
    id: 'f1-monaco-2024-podium',
    question: 'Who finished on the podium at the 2024 Monaco Grand Prix?',
    intent:
      'Needs the race_result view (or the `type` discriminator on race_data) rather than a base table — reading race_data without filtering its type returns every session, not the race.',
    scorers: [
      checks.includes('Leclerc'),
      checks.matches(/Piastri/i),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    expectedSql:
      'SELECT driver.name AS driver ' +
      'FROM formula1.race_result race_result ' +
      'JOIN formula1.race race ON race.id = race_result.race_id ' +
      'JOIN formula1.driver driver ON driver.id = race_result.driver_id ' +
      "WHERE race.year = 2024 AND race.grand_prix_id = 'monaco' " +
      'AND race_result.position_number <= 3 ' +
      'ORDER BY race_result.position_number',
  },
  {
    id: 'f1-schema-discovery',
    question: 'What Formula 1 data do I have available to analyse?',
    intent:
      'Pure discovery — must inspect the session datasets rather than invent entities or run SQL.',
    scorers: [
      checks.calledTool('list_entities'),
      checks.includes('driver'),
      checks.didNotCall('run_readonly_sql'),
      checks.noToolErrors(),
    ],
  },
  {
    id: 'f1-ambiguous-dominant-driver',
    question: 'Which driver was the most dominant?',
    intent:
      'Ambiguous on both metric and era — 77 seasons of data, and the agent must ask instead of guessing.',
    scorers: [
      checks.calledTool('ask_clarification'),
      checks.didNotCall('run_readonly_sql'),
      checks.noToolErrors(),
    ],
    judgeRubric:
      'The question ("Which driver was the most dominant?") is ambiguous on ' +
      'both the metric (race wins? championships? pole positions? points? ' +
      'win rate?) and the scope (this dataset covers every season from 1950 ' +
      'to 2026, so "dominant" could mean a single season, an era, or a whole ' +
      'career). Score pass=true only if the final answer is itself a ' +
      'clarifying question — not an attempt to answer with data — that ' +
      'offers 2-4 concrete, well-formed options grounded in this Formula 1 ' +
      'dataset (e.g. naming an actual metric such as race wins, ' +
      'championships won, pole positions or points, or an actual season or ' +
      'era in the data such as 2023 or the 2010s), and that does not state ' +
      'any driver as the answer or quote any figures as if they were the ' +
      'answer. Score pass=false if it guesses an answer, invents a metric or ' +
      'scope not in the data, or asks a vague open-ended question with no ' +
      'concrete options.',
  },
  {
    id: 'f1-pole-to-win-2023',
    question:
      'In the 2023 season, did the driver who started on pole usually go on ' +
      'to win the race?',
    intent:
      'Joins the grid/pole position to the race result across 22 races — the answer must be a judgement backed by counts, not a row dump.',
    scorers: [
      checks.calledTool('run_readonly_sql'),
      checks.matches(/\b(pole|grid)\b/i),
      checks.noToolErrors(),
    ],
    // No expectedSql: the reference answer is two scalar counts, and
    // `runResultSetCheck` compares row sets positionally, so it cannot tell
    // that a wide reference row ({won: 14, races: 22}) and the equivalent long
    // aggregate ([{outcome, races}, …]) state the same fact — see the
    // `possession-vs-result` note above. The counts are graded in the rubric.
    judgeRubric:
      'The question asks whether, in the 2023 Formula 1 season, the driver ' +
      'who started on pole usually won the race. In this dataset the answer ' +
      'is YES: of the 22 races in 2023, the pole-sitter won 14 and failed to ' +
      'win 8 (about 64%). Both readings of "pole" — the pole_position flag ' +
      'and grid position 1 — give the same 14 of 22. Score pass=true only if ' +
      'the final answer concludes that the pole-sitter DID usually win, and ' +
      'backs it with counts or percentages consistent with 14 of 22 wins ' +
      '(equivalently 8 non-wins, or roughly 64%). Any query shape is ' +
      'acceptable — a per-race table, a grouped aggregate or a single pivoted ' +
      'row all count, as do minor rewordings and rounding (63%-64%). Score ' +
      'pass=false if it concludes the pole-sitter usually did not win, gives ' +
      'no counts at all, or states counts that contradict 14 of 22.',
  },
  {
    id: 'f1-out-of-scope-motogp',
    question: 'Who won the 2023 MotoGP world championship?',
    intent:
      'The fixture covers Formula 1 only — the agent must say so instead of fabricating a MotoGP result.',
    scorers: [checks.noToolErrors()],
    judgeRubric:
      'The question asks about MotoGP, a motorcycle racing series this ' +
      'dataset does not contain — it holds Formula 1 world championship data ' +
      'only, for the seasons 1950 to 2026. Score pass=true only if the final ' +
      'answer clearly states it cannot answer the MotoGP question from this ' +
      'data AND explicitly states what the data DOES cover (Formula 1, and ' +
      'ideally its 1950-2026 season range or the kind of entities it holds ' +
      'such as drivers, constructors, races and standings), without naming a ' +
      'MotoGP champion or inventing any MotoGP fact. Score pass=false if it ' +
      'states or implies any 2023 MotoGP result, or fails to state what the ' +
      'data actually covers.',
  },
  {
    id: 'f1-visual-request',
    question:
      'Chart the total points scored by each constructor in the 2023 season.',
    intent:
      'Answer first, then build a visual — checks the SQL → create_visual ordering.',
    scorers: [
      checks.toolOrder(['run_readonly_sql', 'create_visual']),
      checks.calledTool('create_visual'),
      checks.noToolErrors(),
    ],
    judgeRubric:
      'The user asked for a chart of the total points scored by each ' +
      'constructor in the 2023 Formula 1 season (ten constructors scored, ' +
      'from Red Bull on 860 down to Haas on 12). Score pass=true only if a ' +
      'create_visual (or update_visual) tool call succeeded and its ' +
      'title/description plausibly describes a chart of points per ' +
      'constructor for the 2023 season (not an unrelated metric, an ' +
      'unrelated season, or drivers instead of constructors). Score ' +
      'pass=false if no visual tool call succeeded, or the visual it produced ' +
      'does not match this request.',
  },
];

/**
 * Every question set the assistant suite offers. Adding another means
 * appending a set here, not touching the questions tab.
 */
export const ASSISTANT_EVAL_SETS: AssistantEvalSet[] = [
  {
    id: 'world-cup',
    name: 'World Cup',
    description:
      'Questions against the bundled World Cup sample (2018 and 2022). ' +
      'Select its PostgreSQL datasource with a saved dataset containing the ' +
      'world_cup tables and views.',
    fixtureId: 'world-cup',
    cases: WORLD_CUP_EVAL_CASES,
  },
  {
    id: 'formula-1',
    name: 'Formula 1',
    description:
      'Questions against the bundled Formula 1 sample (1950 to 2026) — ' +
      'seasons, drivers, constructors, circuits, races, standings and the ' +
      'per-session result views. Select its PostgreSQL datasource with a ' +
      'saved dataset containing the formula1 tables and views.',
    fixtureId: 'formula-1',
    cases: FORMULA_1_EVAL_CASES,
  },
];

/**
 * Every case across every set, flattened. Case ids are unique suite-wide, so
 * the runner and `selectEvalCases` keep working on ids alone and never need
 * to know which set a case came from.
 */
export const ASSISTANT_EVAL_CASES: AssistantEvalCase[] =
  ASSISTANT_EVAL_SETS.flatMap((set) => set.cases);

/** One tool the agent called while answering, in call order. */
export interface EvalToolCall {
  name: string;
  /** Arguments the agent passed, JSON-encoded and truncated. */
  input?: string;
  /** What the tool returned, JSON-encoded and truncated. */
  output?: string;
  error?: string;
}

/** One scorer's verdict on a question, with why it landed there. */
export interface EvalCheckResult {
  id: string;
  /** The scorer's own description, e.g. 'Checks if output includes "X"'. */
  description: string;
  score: number;
  passed: boolean;
  /** Why the check scored what it did — populated on failure where known. */
  reason?: string;
}

/** Outcome of one question. */
export interface AssistantEvalCaseResult {
  id: string;
  question: string;
  /** Score per scorer id, 0..1. Empty when the run threw. */
  scores: Record<string, number>;
  /** Per-check verdicts, in the order the case declares them. */
  checkResults: EvalCheckResult[];
  /** The agent's final answer text. */
  answer: string;
  /** The tool calls the agent made, in order — the executed process. */
  toolCalls: EvalToolCall[];
  /** True when every scorer scored 1. */
  passed: boolean;
  /** Set when the agent run itself failed (connection, model, tool crash). */
  error?: string;
  /** Wall time for the question, in milliseconds. */
  durationMs: number;
}

/** Tool payloads can be whole result sets; keep the trace readable. */
const MAX_TRACE_FIELD = 2000;

function encode(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text =
    typeof value === 'string' ? value : (safeStringify(value) ?? String(value));
  return text.length > MAX_TRACE_FIELD
    ? `${text.slice(0, MAX_TRACE_FIELD)}… (truncated)`
    : text;
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

/**
 * Pull the tool trace out of an agent result. The runEvals callback types this
 * as `any`; the call/result shape has moved between AI SDK versions, so every
 * field is read defensively. In the currently installed Mastra/AI-SDK
 * version, each entry in `step.toolCalls`/`step.toolResults` is a chunk
 * (`{ type: 'tool-call' | 'tool-result', payload: {...} }`) rather than a flat
 * object — the actual `toolCallId`/`toolName`/`args`/`result` live on
 * `.payload`. Reading them off the chunk itself (as this used to) silently
 * finds nothing, which is why every reported step name used to render
 * "unknown". Both shapes are still accepted, in case a future upgrade
 * flattens the chunk again.
 */
function extractToolCalls(targetResult: any): EvalToolCall[] {
  const steps: any[] = Array.isArray(targetResult?.steps)
    ? targetResult.steps
    : [targetResult];

  const calls: EvalToolCall[] = [];
  for (const step of steps) {
    if (!step) continue;
    const stepCalls: any[] = Array.isArray(step.toolCalls)
      ? step.toolCalls
      : [];
    const stepResults: any[] = Array.isArray(step.toolResults)
      ? step.toolResults
      : [];

    for (const call of stepCalls) {
      const callPayload = call?.payload ?? call;
      const match = stepResults.find((result) => {
        const resultPayload = result?.payload ?? result;
        return resultPayload?.toolCallId === callPayload?.toolCallId;
      });
      const matchPayload = match?.payload ?? match;
      const output = matchPayload?.output ?? matchPayload?.result;
      calls.push({
        name: String(callPayload?.toolName ?? callPayload?.name ?? 'unknown'),
        input: encode(callPayload?.input ?? callPayload?.args),
        output: matchPayload?.isError ? undefined : encode(output),
        error: matchPayload?.isError
          ? (encode(output) ?? 'Tool call failed')
          : undefined,
      });
    }
  }
  return calls;
}

/** A one-line preview of the answer, for reasons that hinge on the output. */
function outputHint(output: unknown): string {
  const text = typeof output === 'string' ? output.trim() : '';
  if (!text) return 'the agent produced no answer text';
  const firstLine = text.split('\n')[0];
  return firstLine.length > 120
    ? `answer began "${firstLine.slice(0, 120)}…"`
    : `answer was "${firstLine}"`;
}

/**
 * The scorer payload carries the comparison it made; turn the known shapes
 * into a sentence. Unknown shapes fall back to the raw payload so a new check
 * still explains itself, just less prettily.
 */
function checkReason(payload: any): string | undefined {
  const detail = payload?.preprocessStepResult;
  if (detail && typeof detail === 'object') {
    if ('target' in detail && 'found' in detail) {
      return `expected ${JSON.stringify(detail.target)} in the answer — ${outputHint(detail.output)}`;
    }
    if ('target' in detail && 'excluded' in detail) {
      return `expected ${JSON.stringify(detail.target)} NOT to appear — ${outputHint(detail.output)}`;
    }
    if ('pattern' in detail && 'matched' in detail) {
      return `expected the answer to match ${detail.pattern} — ${outputHint(detail.output)}`;
    }
    if ('toolName' in detail && 'actualCount' in detail) {
      const expected = detail.expectedTimes ?? 1;
      return `expected "${detail.toolName}" to be called ${expected}×, it was called ${detail.actualCount}×`;
    }
    if ('toolName' in detail && 'called' in detail) {
      return `expected "${detail.toolName}" NOT to be called, it was`;
    }
    if ('expectedOrder' in detail) {
      const actual = Array.isArray(detail.actualOrder)
        ? detail.actualOrder.join(' → ')
        : 'nothing';
      const expected = Array.isArray(detail.expectedOrder)
        ? detail.expectedOrder.join(' → ')
        : String(detail.expectedOrder);
      return `expected the tool order ${expected}, got ${actual || 'nothing'}`;
    }
    if ('errors' in detail || 'toolErrors' in detail) {
      const errors = detail.errors ?? detail.toolErrors;
      return `a tool call failed: ${encode(errors) ?? 'unknown error'}`;
    }
    const encoded = encode(detail);
    if (encoded) return encoded;
  }
  return typeof payload?.reason === 'string' ? payload.reason : undefined;
}

/**
 * The cases to run: the named ones, or all of them when the caller passes no
 * list at all. An explicit empty list selects nothing — it must not be read as
 * "run everything", or an empty selection would start a full (paid) run.
 */
export function selectEvalCases(caseIds?: string[]): AssistantEvalCase[] {
  if (!caseIds) return ASSISTANT_EVAL_CASES;
  const wanted = new Set(caseIds);
  return ASSISTANT_EVAL_CASES.filter((evalCase) => wanted.has(evalCase.id));
}

/** The sets the selection touches — every set when nothing is named. */
export function selectEvalSets(caseIds?: string[]): AssistantEvalSet[] {
  if (!caseIds) return ASSISTANT_EVAL_SETS;
  const wanted = new Set(caseIds);
  return ASSISTANT_EVAL_SETS.filter((set) =>
    set.cases.some((evalCase) => wanted.has(evalCase.id)),
  );
}

/**
 * The sample a selection of questions must be run against. Throws when the
 * selection resolves to no set, to several samples at once (their schemas are
 * unrelated — a run scoped to one cannot answer the other), or to a fixture id
 * the registry does not know.
 */
export function fixtureForCases(caseIds?: string[]): SampleFixture {
  const sets = selectEvalSets(caseIds);
  if (sets.length === 0) {
    throw new Error(
      'No question set matches the selected questions, so there is no sample ' +
        'to validate the datasets against.',
    );
  }
  const fixtureIds = Array.from(new Set(sets.map((set) => set.fixtureId)));
  if (fixtureIds.length > 1) {
    throw new Error(
      `The selected questions span several samples (${fixtureIds.join(', ')}) — ` +
        'run one sample at a time.',
    );
  }
  return evalFixture(fixtureIds[0]);
}

/**
 * requestContext scoping the agent to the eval datasets, as a session would —
 * plus, when a throwaway eval session exists, the same `session-id` and a
 * live turn-records array `create_visual`/`update_visual` read via
 * `TURN_RECORDS_CONTEXT_KEY` in a real chat turn (see
 * `SessionsService.streamMessage`).
 */
function evalRequestContext(
  datasets: string[],
  sessionId: string | undefined,
  turnRecords: ToolDataRecord[],
): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(DATASETS_CONTEXT_KEY, datasets);
  if (sessionId) requestContext.set(SESSION_ID_CONTEXT_KEY, sessionId);
  requestContext.set(TURN_RECORDS_CONTEXT_KEY, turnRecords);
  return requestContext;
}

/**
 * Mirrors `toolRecords()` in `SessionsService` (the non-streaming turn path)
 * but incrementally, per step, via `targetOptions.onStepFinish` — so a
 * `create_visual`/`update_visual` call later in the *same* run sees the SQL
 * earlier steps already captured, the same way production threads a live
 * records array through requestContext during `streamMessage`.
 */
function captureStepRecords(step: any, turnRecords: ToolDataRecord[]): void {
  const results: any[] = Array.isArray(step?.toolResults)
    ? step.toolResults
    : [];
  for (const entry of results) {
    const payload = (entry?.payload ?? entry) as {
      toolName?: string;
      args?: Record<string, unknown>;
      result?: unknown;
    };
    const record = toolDataRecord(
      payload.toolName ?? 'tool',
      payload.args ?? {},
      payload.result,
    );
    if (record) turnRecords.push(record);
  }
}

/** A throwaway session created purely to give `create_visual`/`update_visual`
 * somewhere to write during an eval run. */
export interface EvalSession {
  id: string;
}

/**
 * `create_visual` looks up the session's latest completed answer before it
 * will do anything — a throwaway session with no chat history has none, so
 * seed one generic placeholder once. The chart's actual data comes from the
 * run's own captured records (merged over this placeholder via
 * `TURN_RECORDS_CONTEXT_KEY`), not from this message's (empty) data.
 */
const EVAL_SESSION_PLACEHOLDER_ANSWER =
  'This is a throwaway session created for the assistant eval suite.';

/**
 * A real, disposable session so `create_visual`/`update_visual` — which read
 * `session-id` from requestContext and look up session state — behave the
 * same way they do in a real chat turn. Both callers of the eval suite
 * (`EvalRunsService`, the in-app runner, and `run-assistant-evals.ts`, the
 * CLI) boot the full Nest app and can hand this a `SessionsService`; callers
 * that cannot (e.g. a lightweight unit test) simply omit it and the suite
 * still runs — `create_visual` then reports "No session in context", scored
 * like any other tool error.
 */
export async function createEvalSession(
  sessions: SessionsService,
  datasets: string[],
): Promise<EvalSession> {
  const session = await sessions.create(
    `assistant eval ${new Date().toISOString()}`.slice(0, 64),
    datasets,
  );
  await sessions.appendAssistantMessage(session.id, {
    content: EVAL_SESSION_PLACEHOLDER_ANSWER,
  });
  return { id: session.id };
}

/** Best-effort cleanup — a throwaway session must never outlive its run. */
export async function cleanupEvalSession(
  sessions: SessionsService | undefined,
  session: EvalSession | undefined,
): Promise<void> {
  if (!sessions || !session) return;
  await sessions.delete(session.id).catch(() => undefined);
}

/** Parse a model's JSON reply, tolerating a markdown fence around it —
 * mirrors `parseJsonObject` in `SessionsService`/`DeepAnalysisService`,
 * duplicated here rather than imported so this module's judge check stays
 * usable without pulling in either of those heavier services. */
function parseJsonObject(text: string | undefined): unknown {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(
      trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    );
  } catch {
    return undefined;
  }
}

/** Scorer id for the LLM-judge check, shown in the report's checks table. */
const LLM_JUDGE_CHECK_ID = 'llm-judge';

/**
 * Score a case's tool calls + final answer against its `judgeRubric` with
 * one structured-output `generate` call on `evalJudgeAgent` (same configured
 * model the assistant runs on, via `resolveAgentModel`). Returns `undefined`
 * when the case has no rubric. A judge that errors or returns unparseable
 * JSON scores 0 rather than crashing the run — the run's other checks and
 * remaining cases must still complete.
 */
async function runJudgeCheck(
  evalCase: AssistantEvalCase,
  answer: string,
  toolCalls: EvalToolCall[],
): Promise<EvalCheckResult | undefined> {
  if (!evalCase.judgeRubric) return undefined;
  const description = `LLM judge: ${evalCase.judgeRubric}`;
  try {
    const prompt = [
      `Question asked: ${evalCase.question}`,
      '',
      'Rubric:',
      evalCase.judgeRubric,
      '',
      'Tool calls the assistant made, in order:',
      toolCalls.length
        ? JSON.stringify(
            toolCalls.map((call) => ({
              name: call.name,
              input: call.input,
              output: call.output,
              error: call.error,
            })),
          )
        : '(none)',
      '',
      "Assistant's final answer to the user:",
      answer || '(the assistant produced no answer text)',
    ].join('\n');

    const result = await evalJudgeAgent.generate(prompt, {
      maxSteps: 1,
      toolChoice: 'none',
      // Deterministic-ish grading: low temperature where the provider
      // supports it, via providerOptions rather than a top-level field the
      // structured-output call overload does not accept.
      providerOptions: providerOptionsFor(await resolveAgentModel(), {
        temperature: 0,
      }),
      structuredOutput: {
        schema: evalJudgeOutputSchema,
        jsonPromptInjection: 'inline',
      },
    });
    const parsed = evalJudgeOutputSchema.safeParse(
      (result as { object?: unknown }).object ??
        parseJsonObject((result as { text?: string }).text),
    );
    if (!parsed.success) {
      return {
        id: LLM_JUDGE_CHECK_ID,
        description,
        score: 0,
        passed: false,
        reason: 'judge error: the judge did not return valid JSON',
      };
    }
    return {
      id: LLM_JUDGE_CHECK_ID,
      description,
      score: parsed.data.pass ? 1 : 0,
      passed: parsed.data.pass,
      reason: parsed.data.pass ? undefined : parsed.data.reason,
    };
  } catch (err) {
    return {
      id: LLM_JUDGE_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: `judge error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Run one question. Each case is its own `runEvals` call because `runEvals`
 * keys and averages scores across the data items of a single call — one call
 * for all ten questions would collapse them into one set of numbers.
 */
export async function runAssistantEvalCase(
  evalCase: AssistantEvalCase,
  datasets: string[],
  sessionId?: string,
  /**
   * The curated-knowledge system block (`KnowledgeService.definitionBlock`)
   * for these datasets — same block a real chat turn gets from
   * `SessionsService.agentContext`. Both callers (`EvalRunsService`, the CLI
   * in `run-assistant-evals.ts`) populate this from `KnowledgeService`;
   * omitted (or empty) when neither wires one in.
   */
  knowledgeBlock?: string,
): Promise<AssistantEvalCaseResult> {
  const startedAt = Date.now();
  // Captured from the per-item callback: the run itself only reports numbers.
  let answer = '';
  let toolCalls: EvalToolCall[] = [];
  let scorerPayloads: Record<string, any> = {};
  // Populated live via onStepFinish as the run executes — the same records a
  // real turn would have threaded through TURN_RECORDS_CONTEXT_KEY.
  const turnRecords: ToolDataRecord[] = [];

  try {
    const datasetSnapshots =
      await getDatasetToolServices().getDatasets(datasets);
    const orientation = entityOrientationLines(datasets, datasetSnapshots).join(
      '\n',
    );

    const result = await runEvals({
      data: [
        {
          input: evalCase.question,
          requestContext: evalRequestContext(datasets, sessionId, turnRecords),
        },
      ],
      scorers: evalCase.scorers,
      target: assistantAgent,
      // Same step budget and dataset/entity + join-hint grounding a real chat
      // turn gets from SessionsService.agentContext — without this the model
      // used to run out of steps mid-analysis (the AI-SDK default cap is 5)
      // and every case died with empty answer text.
      targetOptions: {
        maxSteps: ASSISTANT_MAX_STEPS,
        context: [
          { role: 'system', content: orientation },
          ...(knowledgeBlock
            ? [{ role: 'system' as const, content: knowledgeBlock }]
            : []),
        ],
        onStepFinish: (step: unknown) => captureStepRecords(step, turnRecords),
      },
      onItemComplete: ({ targetResult, scorerResults }) => {
        answer = String(targetResult?.text ?? '');
        toolCalls = extractToolCalls(targetResult);
        scorerPayloads = scorerResults ?? {};
      },
    });

    // Mirrors SessionsService.streamMessage's tool-only-turn fallback: a run
    // that spent every step on tools and never produced prose still gets a
    // reported answer built from what the tools actually returned, instead
    // of scoring/reporting an empty string. Note: `runEvals` scores the
    // target's own output before this callback runs, so this fixes what the
    // report *shows* as the answer; it cannot retroactively change scores
    // already computed against the empty text. With maxSteps now matching
    // production this path should be rare — the empty-answer failures in the
    // original bug report were caused by the 5-step default, not by the
    // model routinely finishing without prose.
    if (!answer.trim() && toolCalls.length > 0) {
      answer = await synthesizeToolOnlyTurn(
        assistantAgent,
        evalCase.question,
        turnRecords,
        new AbortController().signal,
        providerOptionsFor(await resolveAgentModel(), {
          reasoningEffort: 'medium',
        }),
      );
    }

    const scores: Record<string, number> = {};
    for (const [id, value] of Object.entries(result.scores ?? {})) {
      scores[id] = typeof value === 'number' ? value : Number(value ?? 0);
    }

    const checkResults: EvalCheckResult[] = evalCase.scorers.map((scorer) => {
      const id = String(scorer.id ?? '');
      const score = scores[id] ?? 0;
      const passed = score === 1;
      return {
        id,
        description: String(scorer.description ?? scorer.name ?? id),
        score,
        passed,
        reason: passed ? undefined : checkReason(scorerPayloads[id]),
      };
    });

    // Result-set comparison (Feature 1) — primary correctness signal for
    // cases with expectedSql, on top of the text/tool scorers above.
    const resultSetCheck = await runResultSetCheck(
      evalCase.expectedSql,
      datasets,
      datasetSnapshots,
      turnRecords,
      evalCase.resultSetOptions,
    );
    if (resultSetCheck) checkResults.push(resultSetCheck);

    // LLM-judge (Feature 2) — for cases where a regex/text check on the
    // final answer would be too brittle.
    const judgeCheck = await runJudgeCheck(evalCase, answer, toolCalls);
    if (judgeCheck) checkResults.push(judgeCheck);

    return {
      id: evalCase.id,
      question: evalCase.question,
      scores,
      checkResults,
      answer,
      toolCalls,
      passed:
        checkResults.length > 0 && checkResults.every((check) => check.passed),
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      id: evalCase.id,
      question: evalCase.question,
      scores: {},
      checkResults: [],
      answer,
      toolCalls,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Run every case sequentially against the given datasets, reporting each as it
 * lands. Sequential keeps the load on the datasource (and the model) to what a
 * single user session would produce.
 *
 * `sessions`, when provided, gets one throwaway session created up front and
 * deleted when every case has run (or the run throws) — shared across cases
 * because only the `visual-request` case needs it, so there is no benefit to
 * a fresh one per question.
 */
export async function runAssistantEvals(
  datasets: string[],
  onCaseComplete?: (result: AssistantEvalCaseResult) => void,
  caseIds?: string[],
  sessions?: SessionsService,
  knowledgeBlock?: string,
): Promise<AssistantEvalCaseResult[]> {
  const datasetError = assistantEvalDatasetError(
    datasets,
    await getDatasetToolServices().getDatasets(datasets),
    fixtureForCases(caseIds),
  );
  if (datasetError) throw new Error(datasetError);
  const evalSession = sessions
    ? await createEvalSession(sessions, datasets)
    : undefined;
  try {
    const results: AssistantEvalCaseResult[] = [];
    for (const evalCase of selectEvalCases(caseIds)) {
      const result = await runAssistantEvalCase(
        evalCase,
        datasets,
        evalSession?.id,
        knowledgeBlock,
      );
      results.push(result);
      onCaseComplete?.(result);
    }
    return results;
  } finally {
    await cleanupEvalSession(sessions, evalSession);
  }
}
