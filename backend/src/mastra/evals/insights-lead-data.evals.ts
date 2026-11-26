import {
  INSIGHTS_LEAD_AGENT_KEY,
  INSIGHTS_LEAD_NAME,
} from '../agents/insights-lead-catalog';
import type {
  AssistantEvalCase,
  AssistantEvalSet,
  EvalCustomCheck,
} from './assistant.evals';
import {
  answerIncludes,
  answerMatches,
  calledTool,
  didNotCall,
  noToolErrors,
  runEndsIn,
} from './insights-lead-eval-checks';
import { INSIGHTS_LEAD_EVAL_TARGET } from './insights-lead-target';
import type { ResultSetCheckOptions } from './result-set-check';

/**
 * The data sets of the former assistant (Emily), run on Elena, the Insights
 * Lead (agents.md 8.1, plan elena-hosts-user-agents E3): `world-cup`,
 * `world-cup-excel`, `world-cup-rest` and `formula-1`, with the same case
 * ids, questions, `expectedSql` and rubrics, so the two agents compare on
 * the same ground. Each case is one whole run of her conversation
 * (`agent:insights-lead`, target `insights-lead-workflow`), read back from
 * the stored run; every expected substring is a fact that is in the
 * sample's data, so a check failing means the answer is wrong, not that the
 * fixture drifted.
 *
 * The built-in checks read an agent's own result, which a whole run has
 * not, so each one is its counterpart over the stored run
 * (`insights-lead-eval-checks.ts`): `checks.includes` is `answerIncludes`,
 * `matches` is `answerMatches`, and so on. Every case also checks the run's
 * status: `success`, or `suspended` for the ambiguous questions, where her
 * question is the run's wait (its `ask_clarification` call is not stored,
 * so the wait replaces `calledTool('ask_clarification')`). The result-set
 * check reads the stored answer's records (`details.records`).
 *
 * Not ported (see `backend/eval/README.md`): the visual cases
 * (`visual-request`, `f1-visual-request`, `no-visuals-chart-request` and
 * their REST copies), as the visual designer is gone; the tool-selection
 * case `no-clarification-best-team`, which needs a user agent's draft run;
 * and the `schema-notes` set, whose staged orientation a real run never
 * sends.
 */

/** A ported case before Elena's run-status check is added. */
interface DataCaseSource {
  id: string;
  question: string;
  intent: string;
  /** The case's answer and tool checks, as the assistant's scorers were. */
  checks: EvalCustomCheck[];
  /** The question is ambiguous: the run must end waiting for her question. */
  asks?: true;
  expectedSql?: string;
  resultSetOptions?: ResultSetCheckOptions;
  judgeRubric?: string;
}

/** Where the judge finds her question in the scored answer. */
const ASKS =
  `The final answer is Elena's question to the user (after "${INSIGHTS_LEAD_NAME} ` +
  'asks the user:", with its options, one per line). ';

/** A source as Elena's case: the run-status check first, then its own. */
function dataCase({
  checks,
  asks,
  judgeRubric,
  ...source
}: DataCaseSource): AssistantEvalCase {
  return {
    ...source,
    // Every verdict is a custom check or the judge (see above).
    scorers: [],
    customChecks: [runEndsIn(asks ? ['suspended'] : ['success']), ...checks],
    ...(judgeRubric
      ? { judgeRubric: asks ? ASKS + judgeRubric : judgeRubric }
      : {}),
  };
}

/** The query tool her answers on data run. */
const SQL = 'run_readonly_sql';

const WORLD_CUP_SOURCES: DataCaseSource[] = [
  {
    id: 'champion-2022',
    question: 'Who won the 2022 World Cup?',
    intent: 'Single-hop lookup against tournaments — the simplest happy path.',
    checks: [answerIncludes('Argentina'), calledTool(SQL), noToolErrors()],
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
    checks: [
      answerMatches(/4\s*[-–:]\s*2/),
      answerIncludes('France'),
      calledTool(SQL),
      noToolErrors(),
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
    checks: [
      answerIncludes('Messi'),
      answerMatches(/\b4\b/),
      calledTool(SQL),
      noToolErrors(),
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
    checks: [
      answerIncludes('Croatia'),
      answerMatches(/Argentina/i),
      calledTool(SQL),
      noToolErrors(),
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
    checks: [
      answerIncludes('Lusail'),
      answerMatches(/88[,.]?966/),
      calledTool(SQL),
      noToolErrors(),
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
    // The context already lists the entities, so calling list_entities is
    // not required (agents-evals, BA-209).
    checks: [answerIncludes('matches'), didNotCall(SQL), noToolErrors()],
  },
  {
    id: 'ambiguous-best-team',
    question: 'Which team performed best?',
    intent:
      'Ambiguous on both metric and tournament — the agent must ask instead of guessing.',
    asks: true,
    checks: [didNotCall(SQL), noToolErrors()],
    // The wait confirms she asked; it cannot judge whether the question
    // itself is well-formed, so that quality dimension goes to the judge.
    judgeRubric:
      'The question ("Which team performed best?") is ambiguous on both the ' +
      'performance metric (goals? wins? possession?) and the scope ' +
      '(which tournament/year). Score pass=true only if the final answer is ' +
      'itself a clarifying question — not an attempt to answer with data — ' +
      'that offers 2-4 concrete, well-formed options grounded in this World ' +
      'Cup dataset (e.g. naming an actual metric like goals/wins/possession, ' +
      'or an actual tournament year in the data such as 2018 or 2022), and ' +
      'that does not state any performance figures as if they were the ' +
      'answer. One clarifying question on either dimension is enough: ' +
      'options that each name a concrete metric (scoped, for example, ' +
      '"across all tournaments") pass even when no year is named, and ' +
      'options that each name a tournament year pass even when no metric is ' +
      'named. Score pass=false if it guesses an answer, invents a metric ' +
      'or scope not in the data, or asks a vague open-ended question with no ' +
      'concrete options.',
  },
  {
    id: 'possession-vs-result',
    question:
      'In the 2022 knockout rounds, did the team with more possession usually win?',
    intent:
      'Two-table reasoning over match_team_statistics — the answer must be a judgement backed by counts, not a row dump.',
    checks: [
      calledTool(SQL),
      answerMatches(/\b(possession|%)\b/i),
      noToolErrors(),
    ],
    // No expectedSql: the reference answer here is two scalar counts, and
    // `runResultSetCheck` compares row sets positionally, so it cannot tell
    // that a wide reference row ({won: 2, lost: 6}) and the equivalent long
    // aggregate ([{outcome, matches}, …]) state the same fact. Both
    // orientations answer the question, so the counts are graded in the
    // rubric below instead.
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
    // A judge reads the actual claim instead of matching words, which a
    // refusal phrased otherwise would fail.
    checks: [noToolErrors()],
    judgeRubric:
      'The question asks about 1970, a year this dataset does not cover (it ' +
      'only has 2018 and 2022). Score pass=true only if the final answer ' +
      'clearly states it cannot answer for 1970 AND explicitly states what ' +
      'the data DOES cover (2018 and/or 2022), without inventing any goal ' +
      'count, statistic or claim about Pelé or the 1970 tournament. Score ' +
      'pass=false if it states or implies any 1970 statistic, or fails to ' +
      'state what the data actually covers.',
  },
];

/**
 * The same World Cup data behind a REST API. The connector materialises the
 * endpoints a statement references into in-memory SQLite tables named by their
 * dotted key, so the reference SQL below is SQLite reading `api.world_cup.*`
 * (not PostgreSQL reading `world_cup.*`). Only `expectedSql` differs from the
 * PostgreSQL cases: questions, checks and rubrics are shared, so the two sets
 * grade the same behaviour over two datasource kinds.
 *
 * The `match` alias becomes `m` (MATCH is a SQLite operator keyword) and the
 * views arrive precomputed from the API, so nothing here needs PostgreSQL-only
 * syntax (`::` casts, `ILIKE`, `FILTER`). Semantics match the originals.
 */
const WORLD_CUP_REST_SQL: Record<string, string> = {
  'champion-2022':
    'SELECT champion.common_name AS champion ' +
    'FROM api.world_cup.tournaments tournament ' +
    'JOIN api.world_cup.teams champion ON champion.id = tournament.champion_team_id ' +
    'WHERE tournament.tournament_year = 2022',
  'final-score-2018':
    'SELECT home.common_name AS home_team, away.common_name AS away_team, ' +
    'm.home_goals, m.away_goals ' +
    'FROM api.world_cup.matches m ' +
    'JOIN api.world_cup.tournaments tournament ON tournament.id = m.tournament_id ' +
    'JOIN api.world_cup.teams home ON home.id = m.home_team_id ' +
    'JOIN api.world_cup.teams away ON away.id = m.away_team_id ' +
    "WHERE tournament.tournament_year = 2018 AND m.stage = 'final'",
  'top-scorer-2022':
    'SELECT player, goals FROM api.world_cup.v_player_goal_totals ' +
    'WHERE tournament_year = 2022 ORDER BY goals DESC, player LIMIT 1',
  shootouts:
    'SELECT tournament_year, home_team, away_team, winner ' +
    'FROM api.world_cup.v_match_results WHERE home_penalties IS NOT NULL ' +
    'ORDER BY tournament_year, match_number',
  'biggest-venue':
    'SELECT DISTINCT venue, attendance FROM api.world_cup.v_match_results ' +
    'WHERE attendance = (SELECT MAX(attendance) FROM api.world_cup.v_match_results)',
};

/**
 * Derive the REST variant of each base case: `rest-` id prefix, and the
 * `expectedSql` swapped for its SQLite port. A case with no port must have had
 * no reference SQL to begin with — this throws otherwise, so a new
 * PostgreSQL reference cannot silently go ungraded here.
 */
function restVariants(
  base: DataCaseSource[],
  sql: Record<string, string>,
): DataCaseSource[] {
  const unknown = Object.keys(sql).filter(
    (id) => !base.some((source) => source.id === id),
  );
  if (unknown.length > 0) {
    throw new Error(
      `REST SQL overrides for unknown cases: ${unknown.join(', ')}`,
    );
  }
  return base.map(({ id, expectedSql, ...source }) => {
    if (expectedSql && !sql[id]) {
      throw new Error(`Case "${id}" has expectedSql but no REST port`);
    }
    return {
      ...source,
      id: `rest-${id}`,
      ...(expectedSql ? { expectedSql: sql[id] } : {}),
    };
  });
}

/**
 * The World Cup data as an Excel workbook and a CSV file (`file` datasource,
 * M1-31): `world_cup.xlsx` (sheets Matches, Teams, Goals) and `players.csv`,
 * built from the same seed. DuckDB reads `file.world_cup.<sheet>` and
 * `file.players.players`. The questions are the World Cup ones the sheets can
 * answer; the goals question is also a trap for the `Total` row under Goals,
 * which the import excludes (24, not 48), and the last one reads the CSV.
 */
const WORLD_CUP_EXCEL_SOURCES: DataCaseSource[] = [
  {
    id: 'excel-champion-2022',
    question: 'Who won the 2022 World Cup?',
    intent:
      'Single-hop lookup in the Matches sheet: the winner of the 2022 final.',
    checks: [answerIncludes('Argentina'), calledTool(SQL), noToolErrors()],
    expectedSql:
      'SELECT winner FROM file.world_cup.matches ' +
      "WHERE tournament_year = 2022 AND stage = 'final'",
  },
  {
    id: 'excel-final-score-2018',
    question: 'What was the score of the 2018 World Cup final?',
    intent:
      'Filter the Matches sheet by stage and year, read both goal columns.',
    checks: [
      answerMatches(/4\s*[-–:]\s*2/),
      answerIncludes('France'),
      calledTool(SQL),
      noToolErrors(),
    ],
    expectedSql:
      'SELECT home_team, away_team, home_goals, away_goals ' +
      'FROM file.world_cup.matches ' +
      "WHERE tournament_year = 2018 AND stage = 'final'",
  },
  {
    id: 'excel-top-scorer-2022',
    question: 'Who scored the most goals in the 2022 World Cup, and how many?',
    intent:
      'Aggregate the Goals sheet by scorer, excluding own goals; the sheet has a Total row the import must have dropped.',
    checks: [
      answerIncludes('Messi'),
      answerMatches(/\b4\b/),
      calledTool(SQL),
      noToolErrors(),
    ],
    expectedSql:
      'SELECT scorer, COUNT(*) AS goals FROM file.world_cup.goals ' +
      "WHERE tournament_year = 2022 AND goal_type <> 'own_goal' " +
      'GROUP BY scorer ORDER BY goals DESC, scorer LIMIT 1',
  },
  {
    id: 'excel-goals-2022',
    question: 'How many goals were scored in the 2022 World Cup?',
    intent:
      'Count rows of the Goals sheet for one year; a Total row left in the table would double the figure.',
    checks: [answerMatches(/\b24\b/), calledTool(SQL), noToolErrors()],
    expectedSql:
      'SELECT COUNT(*) AS goals FROM file.world_cup.goals ' +
      'WHERE tournament_year = 2022',
  },
  {
    id: 'excel-shootouts',
    question:
      'Which knockout matches went to a penalty shootout, and who advanced?',
    intent:
      'Shootouts are non-null penalty columns of the Matches sheet, not a flag.',
    checks: [
      answerIncludes('Croatia'),
      answerMatches(/Argentina/i),
      calledTool(SQL),
      noToolErrors(),
    ],
    expectedSql:
      'SELECT tournament_year, home_team, away_team, winner ' +
      'FROM file.world_cup.matches WHERE home_penalties IS NOT NULL ' +
      'ORDER BY tournament_year, match_number',
  },
  {
    id: 'excel-biggest-venue',
    // Two matches share the best attendance at one stadium.
    resultSetOptions: { distinctRows: true },
    question:
      'Which stadium hosted the best-attended match, and what was the attendance?',
    intent:
      'Order the Matches sheet by a nullable measure; the title row above its header must not shift the columns.',
    checks: [
      answerIncludes('Lusail'),
      answerMatches(/88[,.]?966/),
      calledTool(SQL),
      noToolErrors(),
    ],
    expectedSql:
      'SELECT DISTINCT stadium, attendance FROM file.world_cup.matches ' +
      'WHERE attendance = (SELECT MAX(attendance) FROM file.world_cup.matches)',
  },
  {
    id: 'excel-goalkeepers',
    question: 'How many goalkeepers are in the players list?',
    intent: 'A question only the CSV file can answer (`file.players.players`).',
    checks: [answerMatches(/\b13\b/), calledTool(SQL), noToolErrors()],
    expectedSql:
      "SELECT COUNT(*) AS goalkeepers FROM file.players.players WHERE position = 'GK'",
  },
  {
    id: 'excel-schema-discovery',
    question: 'What data do I have available to analyse?',
    intent:
      'Pure discovery: the answer names the sheets and the CSV rather than running SQL.',
    checks: [
      answerIncludes('matches'),
      answerMatches(/players/i),
      didNotCall(SQL),
      noToolErrors(),
    ],
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
const FORMULA_1_SOURCES: DataCaseSource[] = [
  {
    id: 'f1-champion-2023',
    question:
      "Who won the 2023 Formula 1 drivers' championship, and how many points " +
      'did they finish on?',
    intent:
      'Single-hop lookup against the season standings — the simplest happy path.',
    checks: [
      answerIncludes('Verstappen'),
      answerMatches(/575/),
      calledTool(SQL),
      noToolErrors(),
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
    checks: [
      answerIncludes('Silverstone'),
      answerMatches(/\b52\b/),
      calledTool(SQL),
      noToolErrors(),
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
    checks: [
      answerIncludes('Hamilton'),
      answerMatches(/\b106\b/),
      calledTool(SQL),
      noToolErrors(),
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
    checks: [
      answerIncludes('Schumacher'),
      answerMatches(/Hamilton/i),
      calledTool(SQL),
      noToolErrors(),
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
    checks: [
      answerIncludes('Leclerc'),
      answerMatches(/Piastri/i),
      calledTool(SQL),
      noToolErrors(),
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
    // The context already lists the entities (BA-209).
    checks: [answerIncludes('driver'), didNotCall(SQL), noToolErrors()],
  },
  {
    id: 'f1-ambiguous-dominant-driver',
    question: 'Which driver was the most dominant?',
    intent:
      'Ambiguous on both metric and era — 77 seasons of data, and the agent must ask instead of guessing.',
    asks: true,
    checks: [didNotCall(SQL), noToolErrors()],
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
    checks: [
      calledTool(SQL),
      answerMatches(/\b(pole|grid)\b/i),
      noToolErrors(),
    ],
    // No expectedSql: the reference answer is two scalar counts — see the
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
    checks: [noToolErrors()],
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
];

/** A ported set: Elena's agent and target, with the set's cases. */
function dataSet(
  set: Pick<AssistantEvalSet, 'id' | 'name' | 'description' | 'fixtureId'>,
  sources: DataCaseSource[],
): AssistantEvalSet {
  return {
    ...set,
    agentKey: INSIGHTS_LEAD_AGENT_KEY,
    target: INSIGHTS_LEAD_EVAL_TARGET,
    cases: sources.map(dataCase),
  };
}

/** The four data sets, in the order the questions tab lists them. */
export const INSIGHTS_LEAD_DATA_EVAL_SETS: AssistantEvalSet[] = [
  dataSet(
    {
      id: 'world-cup',
      name: 'World Cup',
      description:
        'Elena, in whole runs of her conversation, against the bundled World ' +
        'Cup sample (2018 and 2022). Select its PostgreSQL datasource with a ' +
        'saved dataset containing the world_cup tables and views.',
      fixtureId: 'world-cup',
    },
    WORLD_CUP_SOURCES,
  ),
  dataSet(
    {
      id: 'world-cup-excel',
      name: 'World Cup Excel',
      description:
        'The World Cup questions the sample files can answer, against the ' +
        'bundled World Cup Excel sample: the workbook world_cup.xlsx (sheets ' +
        'Matches, Teams, Goals) and players.csv. Load it from Settings → ' +
        'Testing Data and select its Excel / CSV datasource with the saved ' +
        'dataset; reference SQL runs in DuckDB over file.world_cup.* and ' +
        'file.players.players.',
      fixtureId: 'world-cup-excel',
    },
    WORLD_CUP_EXCEL_SOURCES,
  ),
  dataSet(
    {
      id: 'world-cup-rest',
      name: 'World Cup (REST API)',
      description:
        'The same World Cup questions against the sample served by a local ' +
        "REST API ('npm run worldcup:api'). Select its REST API datasource " +
        'with a saved dataset containing the api.world_cup endpoints; ' +
        'reference SQL runs in SQLite over the fetched endpoints.',
      fixtureId: 'world-cup-rest',
    },
    restVariants(WORLD_CUP_SOURCES, WORLD_CUP_REST_SQL),
  ),
  dataSet(
    {
      id: 'formula-1',
      name: 'Formula 1',
      description:
        'Questions against the bundled Formula 1 sample (1950 to 2026) — ' +
        'seasons, drivers, constructors, circuits, races, standings and the ' +
        'per-session result views. Select its PostgreSQL datasource with a ' +
        'saved dataset containing the formula1 tables and views.',
      fixtureId: 'formula-1',
    },
    FORMULA_1_SOURCES,
  ),
];
