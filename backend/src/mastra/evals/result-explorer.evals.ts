import type { Agent } from '@mastra/core/agent';
import { checks } from '@mastra/evals/checks';
import type {
  ColumnKind,
  FilterSpec,
  ResultView,
  SortSpec,
} from '../../modules/datasources/connectors/paged-sql.types';
import type * as ExplorerAgent from '../agents/result-explorer.agent';
import {
  explorerCandidateOf,
  type ExplorerCandidate,
} from '../agents/result-explorer.prompts';
import type {
  AssistantEvalCase,
  AssistantEvalSet,
  EvalCustomCheck,
  EvalTarget,
} from './assistant.evals';
import {
  actionIs,
  filtersAre,
  pageIs,
  queryIs,
  refusesWhatNoColumnHolds,
  replyIsAView,
  sortIs,
} from './result-explorer-eval-checks';
import {
  explorerInputOf,
  explorerTurnAgent,
  type ExplorerEvalInput,
  type InterpretResult,
} from './result-explorer-eval-target';

/**
 * The eval set of Nathan, Result Explorer (agents.md 8.1, 2.16), run on the
 * `result-explorer` agent over the World Cup sample. A case is the user's
 * words, the candidates they are said about (built with `explorerCandidateOf`
 * from hard-coded stored rows of the fixture's real columns: no database is
 * read during a run) and the view the user sees; each probes one reading: a
 * page move, a filter in each operator family, a value spelled as stored
 * (also from another language), a sort, clearing the filters, the choice
 * between two candidates, and the words that are a new question or hold a
 * column the result does not have.
 *
 * The target is the app's own call (`interpretResultWithModel`): the answer
 * is what `specOf` made of the reply, as JSON text. Every check is code; no
 * judge.
 */

/** The sample fixture the set is bound to. */
export const RESULT_EXPLORER_EVAL_FIXTURE_ID = 'world-cup';

/** The registry key of the agent the set runs on. */
export const RESULT_EXPLORER_EVAL_AGENT_KEY = 'result-explorer';

const MATCH_KINDS: Record<string, ColumnKind> = {
  stage: 'text',
  home_team: 'text',
  away_team: 'text',
  total_goals: 'number',
  attendance: 'number',
  kicked_off_at: 'date',
};

/** A "matches with team names" result, as stored (query 1). */
export const MATCHES_COLUMNS = Object.keys(MATCH_KINDS);
export const MATCHES_ROWS: Record<string, unknown>[] = [
  {
    stage: 'Group stage',
    home_team: 'Brazil',
    away_team: 'Serbia',
    total_goals: 2,
    attendance: 88103,
    kicked_off_at: '2022-11-24T19:00:00.000Z',
  },
  {
    stage: 'Group stage',
    home_team: 'France',
    away_team: 'Australia',
    total_goals: 5,
    attendance: 40875,
    kicked_off_at: '2022-11-22T19:00:00.000Z',
  },
  {
    stage: 'Group stage',
    home_team: 'Argentina',
    away_team: 'Saudi Arabia',
    total_goals: 3,
    attendance: 88012,
    kicked_off_at: '2022-11-22T13:00:00.000Z',
  },
  {
    stage: 'Round of 16',
    home_team: 'Belgium',
    away_team: 'Canada',
    total_goals: 1,
    attendance: 40432,
    kicked_off_at: '2022-11-23T19:00:00.000Z',
  },
  {
    stage: 'Final',
    home_team: 'Qatar',
    away_team: 'Ecuador',
    total_goals: 2,
    attendance: 67372,
    kicked_off_at: '2022-11-20T16:00:00.000Z',
  },
];

const SCORER_KINDS: Record<string, ColumnKind> = {
  player: 'text',
  country: 'text',
  goals: 'number',
};

/** A "top scorers" result, as stored. */
export const SCORERS_COLUMNS = Object.keys(SCORER_KINDS);
export const SCORERS_ROWS: Record<string, unknown>[] = [
  { player: 'Kylian Mbappé', country: 'France', goals: 8 },
  { player: 'Lionel Messi', country: 'Argentina', goals: 7 },
  { player: 'Richarlison', country: 'Brazil', goals: 3 },
  { player: 'Cristiano Ronaldo', country: 'Portugal', goals: 1 },
  { player: 'Harry Kane', country: 'England', goals: 2 },
];

const matches = (ref = 'Q1') =>
  explorerCandidateOf(
    ref,
    MATCHES_COLUMNS,
    MATCHES_ROWS,
    MATCH_KINDS,
    'World Cup matches with the team names',
  );
const scorers = (ref = 'Q1') =>
  explorerCandidateOf(
    ref,
    SCORERS_COLUMNS,
    SCORERS_ROWS,
    SCORER_KINDS,
    'Top scorers with their country',
  );

/** What a case must come out as (0-based query; the complete view). */
export interface ExplorerExpectation {
  /** Omitted when either action is right (the column does not exist). */
  action?: 'explore' | 'new-question';
  query: number;
  /** Acceptable complete filter sets. */
  filters: FilterSpec[][];
  sort: SortSpec[];
  page: number;
  /** The words hold a column no candidate has. */
  refuses?: boolean;
}

export interface ExplorerCase {
  id: string;
  intent: string;
  /** The user's words: the case's question. */
  words: string;
  candidates: ExplorerCandidate[];
  view: ResultView | null;
  expect: ExplorerExpectation;
}

const SHOWN: ResultView = {
  filters: [],
  sort: [],
  page: 1,
  pageSize: 25,
  matchedRows: 64,
};

const year2018 = (): FilterSpec[][] => {
  const goals: FilterSpec[][] = [
    [{ column: 'total_goals', op: 'gt', value: 3 }],
    [{ column: 'total_goals', op: 'gte', value: 4 }],
  ];
  const dates: FilterSpec[][] = [
    [
      {
        column: 'kicked_off_at',
        op: 'between',
        value: '2018-01-01',
        valueTo: '2018-12-31',
      },
    ],
    [
      { column: 'kicked_off_at', op: 'gte', value: '2018-01-01' },
      { column: 'kicked_off_at', op: 'lte', value: '2018-12-31' },
    ],
    [
      { column: 'kicked_off_at', op: 'gte', value: '2018-01-01' },
      { column: 'kicked_off_at', op: 'lt', value: '2019-01-01' },
    ],
  ];
  return goals.flatMap((g) => dates.map((d) => [...g, ...d]));
};

const attendanceSort: SortSpec[] = [
  { column: 'attendance', direction: 'desc' },
];
const brazilHome: FilterSpec = {
  column: 'home_team',
  op: 'eq',
  value: 'Brazil',
};

export const RESULT_EXPLORER_CASES: ExplorerCase[] = [
  {
    id: 're-next-page',
    intent: 'A page move: "next page" from page 1 lands on page 2.',
    words: 'next page',
    candidates: [matches()],
    view: SHOWN,
    expect: { action: 'explore', query: 0, filters: [[]], sort: [], page: 2 },
  },
  {
    id: 're-page-five',
    intent: 'A named page: "page 5" lands on page 5 of 8.',
    words: 'go to page 5',
    candidates: [matches()],
    view: { ...SHOWN, matchedRows: 200 },
    expect: { action: 'explore', query: 0, filters: [[]], sort: [], page: 5 },
  },
  {
    id: 're-only-brazil',
    intent: 'An equality filter on text, the value spelled as stored.',
    words: 'only Brazil',
    candidates: [scorers()],
    view: null,
    expect: {
      action: 'explore',
      query: 0,
      filters: [[{ column: 'country', op: 'eq', value: 'Brazil' }]],
      sort: [],
      page: 1,
    },
  },
  {
    id: 're-goals-over-3-in-2018',
    intent:
      'A number comparison (gt 3) and a year as a date range, both kept in one set.',
    words: 'goals over 3 in 2018',
    candidates: [matches()],
    view: null,
    expect: {
      action: 'explore',
      query: 0,
      filters: year2018(),
      sort: [],
      page: 1,
    },
  },
  {
    id: 're-attendance-between',
    intent: 'A range: between, both bounds included.',
    words: 'attendance between 40000 and 60000',
    candidates: [matches()],
    view: null,
    expect: {
      action: 'explore',
      query: 0,
      filters: [
        [
          {
            column: 'attendance',
            op: 'between',
            value: 40000,
            valueTo: 60000,
          },
        ],
      ],
      sort: [],
      page: 1,
    },
  },
  {
    id: 're-teams-starting-with-b',
    intent: 'A text prefix: starts_with on the country column.',
    words: 'teams starting with B',
    candidates: [scorers()],
    view: null,
    expect: {
      action: 'explore',
      query: 0,
      filters: [[{ column: 'country', op: 'starts_with', value: 'B' }]],
      sort: [],
      page: 1,
    },
  },
  {
    id: 're-highest-attendance-first',
    intent: '"Highest first" is a descending sort on the named column.',
    words: 'highest attendance first',
    candidates: [matches()],
    view: null,
    expect: {
      action: 'explore',
      query: 0,
      filters: [[]],
      sort: attendanceSort,
      page: 1,
    },
  },
  {
    id: 're-clear-the-filters',
    intent:
      'Clearing the filters of a filtered view: no filters, back to page 1, the sort kept.',
    words: 'clear the filters',
    candidates: [matches()],
    view: {
      filters: [
        { column: 'stage', op: 'eq', value: 'Group stage' },
        { column: 'total_goals', op: 'gte', value: 3 },
      ],
      sort: attendanceSort,
      page: 3,
      pageSize: 25,
      matchedRows: 120,
    },
    expect: {
      action: 'explore',
      query: 0,
      filters: [[]],
      sort: attendanceSort,
      page: 1,
    },
  },
  {
    id: 're-solo-brasil',
    intent:
      'The same filter as "only Brazil", said in Spanish with a Spanish spelling: the value is the stored one.',
    words: 'solo Brasil',
    candidates: [scorers()],
    view: null,
    expect: {
      action: 'explore',
      query: 0,
      filters: [[{ column: 'country', op: 'eq', value: 'Brazil' }]],
      sort: [],
      page: 1,
    },
  },
  {
    id: 're-pick-the-scorers-candidate',
    intent: 'Two candidates: "the scorers one" is Q2.',
    words: 'the scorers one, only France',
    candidates: [matches('Q1'), scorers('Q2')],
    view: null,
    expect: {
      action: 'explore',
      query: 1,
      filters: [[{ column: 'country', op: 'eq', value: 'France' }]],
      sort: [],
      page: 1,
    },
  },
  {
    id: 're-new-question-own-goals',
    intent:
      'A measure over data this result does not hold is a new question; the view is kept.',
    words: 'which team scored the most own goals?',
    candidates: [matches()],
    view: null,
    expect: {
      action: 'new-question',
      query: 0,
      filters: [[]],
      sort: [],
      page: 1,
    },
  },
  {
    id: 're-new-question-by-year',
    intent:
      'A new grouping is a new question; the current filters, sort and page are kept.',
    words: 'now by year',
    candidates: [matches()],
    view: { ...SHOWN, filters: [brazilHome], page: 2, matchedRows: 60 },
    expect: {
      action: 'new-question',
      query: 0,
      filters: [[brazilHome]],
      sort: [],
      page: 2,
    },
  },
  {
    id: 're-no-continent-column',
    intent:
      'No column holds a continent: the words are a new question, or the part is left out and listed as rejected; no filter is made up.',
    words: 'only European teams',
    candidates: [scorers()],
    view: null,
    expect: { query: 0, filters: [[]], sort: [], page: 1, refuses: true },
  },
];

function checksOf(expect: ExplorerExpectation): EvalCustomCheck[] {
  return [
    replyIsAView(),
    ...(expect.action ? [actionIs(expect.action)] : []),
    queryIs(expect.query),
    filtersAre(expect.filters),
    sortIs(expect.sort),
    pageIs(expect.page),
    ...(expect.refuses ? [refusesWhatNoColumnHolds()] : []),
  ];
}

export const RESULT_EXPLORER_EVAL_CASES: AssistantEvalCase[] =
  RESULT_EXPLORER_CASES.map((c): AssistantEvalCase => ({
    id: c.id,
    question: c.words,
    intent: c.intent,
    // `runEvals` needs one built-in check: the answer holds the action.
    scorers: [checks.includes('"action"')],
    customChecks: checksOf(c.expect),
  }));

export const RESULT_EXPLORER_EVAL_SET: AssistantEvalSet = {
  id: 'result-explorer',
  name: 'Result Explorer',
  description:
    'Words about a query result for Nathan, Result Explorer, over the ' +
    'bundled World Cup sample: page moves, filters (equality in two ' +
    'languages, a comparison, a range, a prefix), a sort, clearing the ' +
    'filters, the choice between two candidates and the words that are a ' +
    'new question. Stored rows are in the cases; code checks only. Select ' +
    'its PostgreSQL datasource with a saved dataset containing the ' +
    'world_cup tables and views.',
  fixtureId: RESULT_EXPLORER_EVAL_FIXTURE_ID,
  agentKey: RESULT_EXPLORER_EVAL_AGENT_KEY,
  cases: RESULT_EXPLORER_EVAL_CASES,
};

/** Edge Cases orders with awkward column names (testing-data R24). */
const EDGE_ORDER_KINDS: Record<string, ColumnKind> = {
  id: 'number',
  'Order Notes': 'text',
  año: 'number',
  'discount_%': 'number',
  'ship-to': 'text',
  status: 'text',
};
const EDGE_ORDER_ROWS: Record<string, unknown>[] = [
  {
    id: 1,
    'Order Notes': 'Leave at door; 100% sure',
    año: 2024,
    'discount_%': 7.5,
    'ship-to': 'Calle 1 #1-1, Medellín',
    status: 'pending',
  },
  {
    id: 2,
    'Order Notes': 'Use code SAVE_10 (snake_case)',
    año: 2023,
    'discount_%': 12,
    'ship-to': 'Av. 2 #2-2, Bogotá',
    status: 'cancelled',
  },
  {
    id: 3,
    'Order Notes': null,
    año: 2024,
    'discount_%': 0,
    'ship-to': 'Cra 3 #3-3, Cali',
    status: 'returned',
  },
  {
    id: 4,
    'Order Notes': 'Path C:\\Users\\new folder',
    año: 2022,
    'discount_%': 25,
    'ship-to': 'Calle 4 #4-4, Medellín',
    status: 'delivered',
  },
  {
    id: 5,
    'Order Notes': 'Ring twice',
    año: 2024,
    'discount_%': 10,
    'ship-to': 'Cra 5 #5-5, Pasto',
    status: 'shipped',
  },
];
const edgeOrders = (ref = 'Q1') =>
  explorerCandidateOf(
    ref,
    Object.keys(EDGE_ORDER_KINDS),
    EDGE_ORDER_ROWS,
    EDGE_ORDER_KINDS,
    'Edge Cases orders with their notes, year, discount, address and status',
  );

/** Nathan on awkward column names (roadmap 1.28.6). */
export const RESULT_EXPLORER_EDGE_CASES: ExplorerCase[] = [
  {
    id: 'rxe-notes-with-percent',
    intent:
      'A filter on a column with a space, the value holding a percent sign.',
    words: 'only the orders whose notes mention 100%',
    candidates: [edgeOrders()],
    view: null,
    expect: {
      action: 'explore',
      query: 0,
      filters: [[{ column: 'Order Notes', op: 'contains', value: '100%' }]],
      sort: [],
      page: 1,
    },
  },
  {
    id: 'rxe-ano-2024',
    intent: 'A column named with an ñ, in Spanish words.',
    words: 'solo los pedidos del año 2024',
    candidates: [edgeOrders()],
    view: null,
    expect: {
      action: 'explore',
      query: 0,
      filters: [[{ column: 'año', op: 'eq', value: 2024 }]],
      sort: [],
      page: 1,
    },
  },
  {
    id: 'rxe-discount-over-10',
    intent: 'A column named with a percent sign, a comparison in Spanish.',
    words: 'descuento mayor a 10',
    candidates: [edgeOrders()],
    view: null,
    expect: {
      action: 'explore',
      query: 0,
      filters: [[{ column: 'discount_%', op: 'gt', value: 10 }]],
      sort: [],
      page: 1,
    },
  },
  {
    id: 'rxe-cancelled-or-returned',
    intent: 'A list of enum values.',
    words: 'only cancelled or returned orders',
    candidates: [edgeOrders()],
    view: null,
    expect: {
      action: 'explore',
      query: 0,
      filters: [
        [{ column: 'status', op: 'in', values: ['cancelled', 'returned'] }],
        [{ column: 'status', op: 'in', values: ['returned', 'cancelled'] }],
      ],
      sort: [],
      page: 1,
    },
  },
  {
    id: 'rxe-sort-ship-to',
    intent: 'A sort on a column named with a hyphen.',
    words: 'sort by ship-to',
    candidates: [edgeOrders()],
    view: null,
    expect: {
      action: 'explore',
      query: 0,
      filters: [[]],
      sort: [{ column: 'ship-to', direction: 'asc' }],
      page: 1,
    },
  },
];

export const RESULT_EXPLORER_EDGE_EVAL_SET: AssistantEvalSet = {
  id: 'result-explorer-edge',
  name: 'Result Explorer: Edge Cases',
  description:
    'Words about an Edge Cases orders result for Nathan, Result Explorer: ' +
    'columns named with a space, an ñ, a percent sign and a hyphen, an enum ' +
    'list, words in Spanish. Stored rows are in the cases; code checks only.',
  fixtureId: 'edge-cases',
  agentKey: RESULT_EXPLORER_EVAL_AGENT_KEY,
  cases: RESULT_EXPLORER_EDGE_CASES.map((c): AssistantEvalCase => ({
    id: c.id,
    question: c.words,
    intent: c.intent,
    scorers: [checks.includes('"action"')],
    customChecks: checksOf(c.expect),
  })),
};

/** What the explorer reads for a case, by its words (the case's question). */
export function explorerInputOfWords(
  words: string,
): ExplorerEvalInput | undefined {
  const found = [...RESULT_EXPLORER_CASES, ...RESULT_EXPLORER_EDGE_CASES].find(
    (c) => c.words === words,
  );
  return found
    ? explorerInputOf(found.words, found.candidates, found.view)
    : undefined;
}

/**
 * The real agent and its model call, required on first use: they keep
 * Mastra off the module graph of the eval catalogue.
 */
function defaultAgent(): typeof ExplorerAgent {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../agents/result-explorer.agent') as typeof ExplorerAgent;
}

/**
 * The eval target of one `result-explorer` run (agents.md 8.1): the agent,
 * its `generate` replaced by the app's call for one case. No orientation and
 * no knowledge: the request holds its own context.
 */
export function resultExplorerEvalTarget(
  loadAgent: () => Agent = () => defaultAgent().resultExplorerAgent,
  interpret: InterpretResult = (input) =>
    defaultAgent().interpretResultWithModel(input),
): EvalTarget {
  let agent: Agent | undefined;
  let run: Agent | undefined;
  return {
    agentKey: RESULT_EXPLORER_EVAL_AGENT_KEY,
    get agent(): Agent {
      agent ??= loadAgent();
      return agent;
    },
    get runTarget(): Agent {
      run ??= explorerTurnAgent(
        (agent ??= loadAgent()),
        interpret,
        explorerInputOfWords,
      );
      return run;
    },
    sets: [RESULT_EXPLORER_EVAL_SET, RESULT_EXPLORER_EDGE_EVAL_SET],
    sendsKnowledge: false,
    orientation: () => '',
  };
}
