/**
 * A full, realistic `GapReport` of the World Cup Medallion example (the plan
 * docs/plans/m1-30-consumption-gap-analysis.md): three schemas of the
 * `world_cup` database, six questions, one reference dashboard with seven
 * widgets and two filters, about thirty inferred edges and seven fixes. The
 * report unit renders it in its tests and the workflow unit reuses it.
 */
import type { GapReport } from './consumption-gap.report';
import type {
  FieldAssessment,
  FieldSource,
  GapFix,
  GapStatus,
  Layer,
  LayerTable,
  LineageEdge,
  Requirement,
  RequirementAssessment,
} from './consumption-gap-analysis.schemas';

const CATALOG = 'world_cup';
const SCHEMA: Record<Layer, string> = {
  landing: 'wc_landing',
  normalized: 'wc_normalized',
  consumption: 'wc_consumption',
};

function table(
  layer: Layer,
  name: string,
  columns: Array<[string, string]>,
): LayerTable {
  return {
    entity: `${CATALOG}.${SCHEMA[layer]}.${name}`,
    layer,
    dataset: 'World Cup Medallion',
    datasourceId: 'ds-world-cup',
    datasourceKind: 'postgres',
    columns: columns.map(([n, type]) => ({ name: n, type })),
    more: 0,
  };
}

const TABLES: LayerTable[] = [
  table('landing', 'raw_matches', [
    ['match_id', 'text'],
    ['tournament', 'text'],
    ['home_team_name', 'text'],
    ['away_team_name', 'text'],
    ['score_str', 'text'],
    ['match_date_str', 'text'],
    ['stage_txt', 'text'],
    ['stadium', 'text'],
    ['attendance_str', 'text'],
  ]),
  table('landing', 'raw_goals', [
    ['match_id', 'text'],
    ['player_name', 'text'],
    ['team', 'text'],
    ['minute_str', 'text'],
    ['penalty_flag', 'text'],
  ]),
  table('landing', 'raw_match_stats', [
    ['match_id', 'text'],
    ['team', 'text'],
    ['possession_pct_str', 'text'],
    ['shots', 'integer'],
    ['xg', 'text'],
  ]),
  table('landing', 'raw_teams', [
    ['team', 'text'],
    ['confed', 'text'],
  ]),
  table('normalized', 'matches', [
    ['match_id', 'integer'],
    ['tournament_year', 'integer'],
    ['stage', 'text'],
    ['home_team_id', 'integer'],
    ['away_team_id', 'integer'],
    ['home_score', 'integer'],
    ['away_score', 'integer'],
    ['match_date', 'date'],
  ]),
  table('normalized', 'teams', [
    ['team_id', 'integer'],
    ['team_name', 'text'],
    ['confederation', 'text'],
  ]),
  table('normalized', 'goals', [
    ['goal_id', 'integer'],
    ['match_id', 'integer'],
    ['player_name', 'text'],
    ['team_id', 'integer'],
    ['minute', 'integer'],
    ['is_penalty', 'boolean'],
  ]),
  table('normalized', 'match_team_statistics', [
    ['match_id', 'integer'],
    ['team_id', 'integer'],
    ['possession', 'numeric'],
    ['shots', 'integer'],
  ]),
  table('consumption', 'fct_match_results', [
    ['match_id', 'integer'],
    ['tournament_year', 'integer'],
    ['stage', 'text'],
    ['home_team', 'text'],
    ['away_team', 'text'],
    ['home_score', 'integer'],
    ['away_score', 'integer'],
    ['total_goals', 'integer'],
    ['winner', 'text'],
  ]),
  table('consumption', 'agg_team_tournament', [
    ['tournament_year', 'integer'],
    ['team', 'text'],
    ['matches_played', 'integer'],
    ['wins', 'integer'],
    ['draws', 'integer'],
    ['losses', 'integer'],
    ['goals_for', 'integer'],
    ['goals_against', 'integer'],
  ]),
  table('consumption', 'agg_player_goals', [
    ['tournament_year', 'integer'],
    ['player', 'text'],
    ['team', 'text'],
    ['goals', 'integer'],
  ]),
];

/** `lc.table.column` -> its entity and column, for the sample's edges. */
function ref(layer: Layer, tableName: string, column: string) {
  return {
    entity: `${CATALOG}.${SCHEMA[layer]}.${tableName}`,
    column,
  };
}

function edge(
  from: [Layer, string, string],
  to: [Layer, string, string],
  method: LineageEdge['method'],
  confidence: number,
  overlap: number | null,
  expression = '',
): LineageEdge {
  return {
    from: ref(...from),
    to: ref(...to),
    method,
    confidence,
    overlap,
    expression,
  };
}

const L = 'landing' as const;
const N = 'normalized' as const;
const C = 'consumption' as const;

const EDGES: LineageEdge[] = [
  edge(
    [L, 'raw_matches', 'match_id'],
    [N, 'matches', 'match_id'],
    'values',
    1,
    1,
  ),
  edge(
    [L, 'raw_matches', 'stage_txt'],
    [N, 'matches', 'stage'],
    'values',
    0.96,
    0.96,
  ),
  edge(
    [L, 'raw_matches', 'match_date_str'],
    [N, 'matches', 'match_date'],
    'values',
    1,
    1,
  ),
  edge(
    [L, 'raw_matches', 'score_str'],
    [N, 'matches', 'home_score'],
    'mapped',
    0.7,
    null,
    "split_part(score_str, '-', 1)::int",
  ),
  edge(
    [L, 'raw_matches', 'score_str'],
    [N, 'matches', 'away_score'],
    'mapped',
    0.7,
    null,
    "split_part(score_str, '-', 2)::int",
  ),
  edge(
    [L, 'raw_matches', 'home_team_name'],
    [N, 'teams', 'team_name'],
    'values',
    1,
    1,
  ),
  edge([L, 'raw_teams', 'team'], [N, 'teams', 'team_name'], 'values', 1, 1),
  edge(
    [L, 'raw_teams', 'confed'],
    [N, 'teams', 'confederation'],
    'values',
    1,
    1,
  ),
  edge([L, 'raw_goals', 'match_id'], [N, 'goals', 'match_id'], 'values', 1, 1),
  edge(
    [L, 'raw_goals', 'player_name'],
    [N, 'goals', 'player_name'],
    'values',
    0.99,
    0.99,
  ),
  edge(
    [L, 'raw_goals', 'minute_str'],
    [N, 'goals', 'minute'],
    'values',
    0.97,
    0.97,
  ),
  edge(
    [L, 'raw_goals', 'penalty_flag'],
    [N, 'goals', 'is_penalty'],
    'similar-name',
    0.71,
    null,
  ),
  edge(
    [L, 'raw_match_stats', 'match_id'],
    [N, 'match_team_statistics', 'match_id'],
    'values',
    1,
    1,
  ),
  edge(
    [L, 'raw_match_stats', 'possession_pct_str'],
    [N, 'match_team_statistics', 'possession'],
    'values',
    0.94,
    0.94,
  ),
  edge(
    [L, 'raw_match_stats', 'shots'],
    [N, 'match_team_statistics', 'shots'],
    'name',
    1,
    null,
  ),
  edge(
    [N, 'matches', 'match_id'],
    [C, 'fct_match_results', 'match_id'],
    'values',
    1,
    1,
  ),
  edge(
    [N, 'matches', 'tournament_year'],
    [C, 'fct_match_results', 'tournament_year'],
    'values',
    1,
    1,
  ),
  edge(
    [N, 'matches', 'tournament_year'],
    [C, 'agg_team_tournament', 'tournament_year'],
    'values',
    0.5,
    0.5,
  ),
  edge(
    [N, 'matches', 'tournament_year'],
    [C, 'agg_player_goals', 'tournament_year'],
    'values',
    1,
    1,
  ),
  edge(
    [N, 'matches', 'stage'],
    [C, 'fct_match_results', 'stage'],
    'values',
    1,
    1,
  ),
  edge(
    [N, 'matches', 'home_score'],
    [C, 'fct_match_results', 'home_score'],
    'name',
    1,
    null,
  ),
  edge(
    [N, 'matches', 'away_score'],
    [C, 'fct_match_results', 'away_score'],
    'name',
    1,
    null,
  ),
  edge(
    [N, 'matches', 'home_score'],
    [C, 'fct_match_results', 'total_goals'],
    'mapped',
    0.8,
    null,
    'home_score + away_score',
  ),
  edge(
    [N, 'matches', 'home_score'],
    [C, 'agg_team_tournament', 'goals_for'],
    'mapped',
    0.8,
    null,
    'sum of the team’s score per tournament',
  ),
  edge(
    [N, 'matches', 'away_score'],
    [C, 'agg_team_tournament', 'goals_against'],
    'mapped',
    0.8,
    null,
    'sum of the opponent’s score per tournament',
  ),
  edge(
    [N, 'teams', 'team_name'],
    [C, 'fct_match_results', 'home_team'],
    'values',
    1,
    1,
  ),
  edge(
    [N, 'teams', 'team_name'],
    [C, 'agg_team_tournament', 'team'],
    'values',
    1,
    1,
  ),
  edge(
    [N, 'teams', 'team_name'],
    [C, 'agg_player_goals', 'team'],
    'values',
    1,
    1,
  ),
  edge(
    [N, 'goals', 'player_name'],
    [C, 'agg_player_goals', 'player'],
    'values',
    1,
    1,
  ),
  edge(
    [N, 'goals', 'goal_id'],
    [C, 'agg_player_goals', 'goals'],
    'mapped',
    0.75,
    null,
    'count(goal_id) per player',
  ),
];

const DASHBOARD_ID = 'D1';

const BLUEPRINT = {
  title: 'Rendimiento Mundial',
  summary: 'Goals, scorers and team output of the 2018 and 2022 World Cups.',
  theme: { mode: 'light' as const, accent: '#d4380f', palette: ['#d4380f'] },
  layout:
    'Row 1: a KPI, two bar charts. Row 2: a line, a donut and a scatter. Row 3: a table.',
  filters: [
    {
      id: 'tournament',
      label: 'Mundial',
      kind: 'select' as const,
      column: 'tournament_year',
      options: ['All', '2018', '2022'],
    },
    {
      id: 'confederation',
      label: 'Confederación',
      kind: 'select' as const,
      column: 'confederation',
      options: ['All', 'UEFA', 'CONMEBOL', 'CAF', 'AFC', 'CONCACAF', 'OFC'],
    },
  ],
  widgets: [
    widget('total-goals', 'Goles totales', 'kpi', 3, 'total_goals', 'sum', ''),
    widget(
      'goals-by-stage',
      'Goles promedio por fase',
      'bar',
      5,
      'total_goals',
      'avg',
      'stage',
    ),
    widget(
      'goals-for-by-team',
      'Goles a favor por equipo',
      'bar',
      4,
      'goals_for',
      'sum',
      'team',
    ),
    widget(
      'goals-by-minute',
      'Goles por tramo de minuto',
      'line',
      6,
      'goals',
      'count',
      'minute_bucket',
    ),
    widget(
      'penalty-share',
      'Penal vs jugada',
      'donut',
      3,
      'goals',
      'count',
      'is_penalty',
    ),
    widget(
      'xg-vs-goals',
      'xG vs goles por equipo',
      'scatter',
      3,
      'xg',
      'sum',
      'team',
    ),
    widget(
      'scorers-by-stage',
      'Goleadores por fase',
      'table',
      12,
      'goals',
      'count',
      'player',
    ),
  ],
  columns: [
    {
      name: 'tournament_year',
      type: 'number' as const,
      description: 'Tournament year',
      values: [],
      min: 2018,
      max: 2022,
    },
    {
      name: 'team',
      type: 'string' as const,
      description: 'National team',
      values: ['Argentina', 'France', 'Croatia', 'Morocco'],
      min: null,
      max: null,
    },
    {
      name: 'goals',
      type: 'number' as const,
      description: 'Goals',
      values: [],
      min: 0,
      max: 8,
    },
  ],
};

function widget(
  id: string,
  title: string,
  kind: 'kpi' | 'bar' | 'line' | 'donut' | 'scatter' | 'table',
  span: number,
  column: string,
  aggregation: 'sum' | 'avg' | 'count',
  dimension: string,
) {
  return {
    id,
    title,
    kind,
    span,
    measures: [
      {
        label: title,
        column,
        aggregation,
        format: 'number' as const,
        unit: '',
        total: null,
      },
    ],
    dimension,
    description: `${aggregation}(${column})${dimension ? ` by ${dimension}` : ''}`,
    observed: '',
    filteredBy:
      id === 'goals-for-by-team' ? ['tournament', 'confederation'] : [],
  };
}

function question(
  n: number,
  title: string,
  fields: Requirement['fields'],
  grain: string,
  periodValues: string[] = [],
): Requirement {
  return {
    id: `Q${n}`,
    kind: 'question',
    title,
    source: `Question ${n}`,
    dashboardId: '',
    ref: '',
    fields,
    grain,
    periodValues,
  };
}

function widgetReq(
  n: number,
  ref: string,
  kindLabel: string,
  title: string,
  fields: Requirement['fields'],
  grain: string,
): Requirement {
  return {
    id: `W${n}`,
    kind: 'widget',
    title,
    source: `Rendimiento Mundial · ${kindLabel}`,
    dashboardId: DASHBOARD_ID,
    ref,
    fields,
    grain,
    periodValues: [],
  };
}

function filterReq(
  n: number,
  ref: string,
  title: string,
  name: string,
): Requirement {
  return {
    id: `F${n}`,
    kind: 'filter',
    title,
    source: 'Rendimiento Mundial · select',
    dashboardId: DASHBOARD_ID,
    ref,
    fields: [{ name, role: 'filter', aggregation: '', description: title }],
    grain: '',
    periodValues: [],
  };
}

const measure = (
  name: string,
  aggregation = 'sum',
): Requirement['fields'][number] => ({
  name,
  role: 'measure',
  aggregation,
  description: '',
});
const dimension = (name: string): Requirement['fields'][number] => ({
  name,
  role: 'dimension',
  aggregation: '',
  description: '',
});

const REQUIREMENTS: Requirement[] = [
  question(
    1,
    '¿Qué equipo ganó más partidos en cada Mundial (2018 y 2022)?',
    [measure('wins'), dimension('team'), dimension('tournament_year')],
    'team × tournament',
    ['2018', '2022'],
  ),
  question(
    2,
    '¿Cuál es la diferencia de gol de cada equipo por Mundial?',
    [
      measure('goal difference'),
      dimension('team'),
      dimension('tournament_year'),
    ],
    'team × tournament',
  ),
  question(
    3,
    '¿Qué porcentaje de los goles fueron de penal?',
    [measure('penalty share', 'share'), dimension('is_penalty')],
    'goal',
  ),
  question(
    4,
    '¿Los equipos con más posesión ganan más partidos?',
    [measure('possession', 'avg'), measure('wins'), dimension('team')],
    'team × match',
  ),
  question(
    5,
    '¿Cuál es la asistencia promedio por estadio?',
    [measure('attendance', 'avg'), dimension('stadium')],
    'match',
  ),
  question(
    6,
    '¿Qué jugadores recibieron más tarjetas amarillas?',
    [measure('yellow cards', 'count'), dimension('player')],
    'booking',
  ),
  widgetReq(
    1,
    'total-goals',
    'kpi',
    'Goles totales',
    [measure('total_goals')],
    'match',
  ),
  widgetReq(
    2,
    'goals-by-stage',
    'bar',
    'Goles promedio por fase',
    [measure('total_goals', 'avg'), dimension('stage')],
    'match',
  ),
  widgetReq(
    3,
    'goals-for-by-team',
    'bar',
    'Goles a favor por equipo',
    [measure('goals_for'), dimension('team')],
    'team × tournament',
  ),
  widgetReq(
    4,
    'goals-by-minute',
    'line',
    'Goles por tramo de minuto',
    [measure('goals', 'count'), dimension('minute bucket')],
    'goal',
  ),
  widgetReq(
    5,
    'penalty-share',
    'donut',
    'Penal vs jugada',
    [measure('goals', 'count'), dimension('is_penalty')],
    'goal',
  ),
  widgetReq(
    6,
    'xg-vs-goals',
    'scatter',
    'xG vs goles por equipo',
    [measure('xg'), measure('goals'), dimension('team')],
    'team × match',
  ),
  widgetReq(
    7,
    'scorers-by-stage',
    'table',
    'Goleadores por fase',
    [measure('goals', 'count'), dimension('player'), dimension('stage')],
    'player × stage',
  ),
  filterReq(1, 'tournament', 'Filtro Mundial', 'tournament_year'),
  filterReq(2, 'confederation', 'Filtro Confederación', 'confederation'),
];

function source(
  layer: Layer,
  tableName: string,
  column: string,
  expression = '',
): FieldSource {
  const { entity } = ref(layer, tableName, column);
  return { layer, entity, column, expression };
}

function field(
  name: string,
  status: GapStatus,
  consumption: FieldSource | null,
  upstream: FieldSource | null,
  path: Array<[Layer, string, string]> = [],
): FieldAssessment {
  return {
    field: name,
    status,
    consumption,
    upstream,
    path: path.map((p) => ref(...p)),
  };
}

function assessment(
  requirementId: string,
  status: GapStatus,
  fields: FieldAssessment[],
  reason: string,
  evidence: string,
): RequirementAssessment {
  return { requirementId, status, fields, reason, evidence };
}

const teamTournament = (column: string, expression = '') =>
  source(C, 'agg_team_tournament', column, expression);

const ASSESSMENTS: RequirementAssessment[] = [
  assessment(
    'Q1',
    'grain',
    [
      field('wins', 'supported', teamTournament('wins'), null),
      field('team', 'supported', teamTournament('team'), null),
      field(
        'tournament_year',
        'supported',
        teamTournament('tournament_year'),
        null,
      ),
    ],
    'The columns are in Consumption, but 2018 has no rows.',
    'Rows by year: 2022 → 32, 2018 → 0. Normalized has 64 matches of 2018.',
  ),
  assessment(
    'Q2',
    'derivable',
    [
      field(
        'goal difference',
        'derivable',
        teamTournament('goals_for', 'goals_for - goals_against'),
        null,
      ),
      field('team', 'supported', teamTournament('team'), null),
      field(
        'tournament_year',
        'supported',
        teamTournament('tournament_year'),
        null,
      ),
    ],
    'Goal difference is goals_for minus goals_against, both in Consumption.',
    'No nulls in either column; 32 rows.',
  ),
  assessment(
    'Q3',
    'normalized-only',
    [
      field(
        'penalty share',
        'normalized-only',
        null,
        source(N, 'goals', 'is_penalty'),
        [
          [L, 'raw_goals', 'penalty_flag'],
          [N, 'goals', 'is_penalty'],
        ],
      ),
    ],
    'Goal-level penalties exist in Normalized; no Consumption table keeps them.',
    'Normalized: 341 goals, 23 penalties (6.7%).',
  ),
  assessment(
    'Q4',
    'normalized-only',
    [
      field(
        'possession',
        'normalized-only',
        null,
        source(N, 'match_team_statistics', 'possession'),
        [
          [L, 'raw_match_stats', 'possession_pct_str'],
          [N, 'match_team_statistics', 'possession'],
        ],
      ),
      field('wins', 'supported', teamTournament('wins'), null),
    ],
    'Possession is in Normalized only.',
    'Normalized: possession on 256 of 256 team-matches.',
  ),
  assessment(
    'Q5',
    'landing-only',
    [
      field(
        'attendance',
        'landing-only',
        null,
        source(L, 'raw_matches', 'attendance_str'),
        [[L, 'raw_matches', 'attendance_str']],
      ),
      field(
        'stadium',
        'landing-only',
        null,
        source(L, 'raw_matches', 'stadium'),
        [[L, 'raw_matches', 'stadium']],
      ),
    ],
    'Attendance and stadium exist as raw text in Landing only.',
    'Landing: attendance as text, 3% unparseable (“N/D”).',
  ),
  assessment(
    'Q6',
    'missing',
    [field('yellow cards', 'missing', null, null)],
    'No column in any layer holds bookings.',
    'No column in any layer matches bookings or cards.',
  ),
  assessment(
    'W1',
    'supported',
    [
      field(
        'total_goals',
        'supported',
        source(C, 'fct_match_results', 'total_goals'),
        null,
        [
          [N, 'matches', 'home_score'],
          [C, 'fct_match_results', 'total_goals'],
        ],
      ),
    ],
    'total_goals is a Consumption column.',
    'Sum = 341, equal to the goals in Normalized.',
  ),
  assessment(
    'W2',
    'supported',
    [
      field(
        'total_goals',
        'supported',
        source(C, 'fct_match_results', 'total_goals'),
        null,
      ),
      field(
        'stage',
        'supported',
        source(C, 'fct_match_results', 'stage'),
        null,
        [
          [N, 'matches', 'stage'],
          [C, 'fct_match_results', 'stage'],
        ],
      ),
    ],
    'Both columns are in Consumption.',
    '7 stages, no nulls.',
  ),
  assessment(
    'W3',
    'grain',
    [
      field('goals_for', 'supported', teamTournament('goals_for'), null, [
        [N, 'matches', 'home_score'],
        [C, 'agg_team_tournament', 'goals_for'],
      ]),
      field('team', 'supported', teamTournament('team'), null),
    ],
    'The columns are in Consumption, but only 2022 has rows.',
    '32 teams, 2022 only (see Q1).',
  ),
  assessment(
    'W4',
    'normalized-only',
    [
      field(
        'goals',
        'normalized-only',
        null,
        source(N, 'goals', 'goal_id', 'count(goal_id)'),
        [[N, 'goals', 'goal_id']],
      ),
      field(
        'minute bucket',
        'normalized-only',
        null,
        source(N, 'goals', 'minute'),
        [
          [L, 'raw_goals', 'minute_str'],
          [N, 'goals', 'minute'],
        ],
      ),
    ],
    'Minute is in Normalized only.',
    'Normalized: minute on 341 of 341 goals.',
  ),
  assessment(
    'W5',
    'normalized-only',
    [
      field(
        'goals',
        'normalized-only',
        null,
        source(N, 'goals', 'goal_id', 'count(goal_id)'),
        [[N, 'goals', 'goal_id']],
      ),
      field(
        'is_penalty',
        'normalized-only',
        null,
        source(N, 'goals', 'is_penalty'),
        [
          [L, 'raw_goals', 'penalty_flag'],
          [N, 'goals', 'is_penalty'],
        ],
      ),
    ],
    'is_penalty is in Normalized only.',
    'Same column as Q3.',
  ),
  assessment(
    'W6',
    'landing-only',
    [
      field('xg', 'landing-only', null, source(L, 'raw_match_stats', 'xg'), [
        [L, 'raw_match_stats', 'xg'],
      ]),
      field('goals', 'supported', source(C, 'agg_player_goals', 'goals'), null),
      field('team', 'supported', teamTournament('team'), null),
    ],
    'xG exists as text in Landing only.',
    'Landing: xg as text, present for 2022 only.',
  ),
  assessment(
    'W7',
    'grain',
    [
      field(
        'goals',
        'supported',
        source(C, 'agg_player_goals', 'goals'),
        null,
        [
          [N, 'goals', 'goal_id'],
          [C, 'agg_player_goals', 'goals'],
        ],
      ),
      field(
        'player',
        'supported',
        source(C, 'agg_player_goals', 'player'),
        null,
        [
          [N, 'goals', 'player_name'],
          [C, 'agg_player_goals', 'player'],
        ],
      ),
      field(
        'stage',
        'supported',
        source(C, 'fct_match_results', 'stage'),
        null,
      ),
    ],
    'agg_player_goals has no stage, so its grain is coarser than the widget needs.',
    'The sources share no column that joins player to stage.',
  ),
  assessment(
    'F1',
    'supported',
    [
      field(
        'tournament_year',
        'supported',
        source(C, 'fct_match_results', 'tournament_year'),
        null,
        [
          [N, 'matches', 'tournament_year'],
          [C, 'fct_match_results', 'tournament_year'],
        ],
      ),
    ],
    'tournament_year is a Consumption column.',
    '2 values (2018, 2022) in fct_match_results.',
  ),
  assessment(
    'F2',
    'normalized-only',
    [
      field(
        'confederation',
        'normalized-only',
        null,
        source(N, 'teams', 'confederation'),
        [
          [L, 'raw_teams', 'confed'],
          [N, 'teams', 'confederation'],
        ],
      ),
    ],
    'confederation is in Normalized only.',
    '6 values, no nulls in Normalized.',
  ),
];

const FIXES: GapFix[] = [
  {
    id: 'X1',
    title: 'Backfill agg_team_tournament for 2018',
    startsIn: 'consumption',
    path: ['consumption'],
    closes: ['Q1', 'W3'],
    why: 'The model is filtered to the latest tournament; Normalized already holds the 64 matches of 2018.',
    change:
      '-- wc_consumption.agg_team_tournament: drop the year filter\n-- WHERE m.tournament_year = (SELECT max(tournament_year) FROM wc_normalized.matches)\n-- then rebuild for every year.',
  },
  {
    id: 'X2',
    title: 'New Consumption fact at goal grain: fct_goals',
    startsIn: 'consumption',
    path: ['normalized', 'consumption'],
    closes: ['Q3', 'W4', 'W5', 'W7'],
    why: 'Four requirements need goal-level detail (penalty, minute, stage) that every Consumption table aggregates away.',
    change:
      'CREATE VIEW wc_consumption.fct_goals AS\nSELECT g.goal_id, m.tournament_year, m.stage, g.minute,\n       (g.minute / 15) * 15 AS minute_bucket, g.is_penalty,\n       g.player_name AS player, t.team_name AS team\nFROM wc_normalized.goals g\nJOIN wc_normalized.matches m ON m.match_id = g.match_id\nJOIN wc_normalized.teams t ON t.team_id = g.team_id;',
  },
  {
    id: 'X3',
    title: 'New Consumption fact fct_team_match with possession and result',
    startsIn: 'consumption',
    path: ['normalized', 'consumption'],
    closes: ['Q4'],
    why: 'Possession is per team and match in Normalized; the question compares it with the result.',
    change:
      "CREATE VIEW wc_consumption.fct_team_match AS\nSELECT s.match_id, m.tournament_year, t.team_name AS team, s.possession, s.shots,\n       CASE WHEN (s.team_id = m.home_team_id AND m.home_score > m.away_score)\n              OR (s.team_id = m.away_team_id AND m.away_score > m.home_score)\n            THEN 'win' WHEN m.home_score = m.away_score THEN 'draw' ELSE 'loss' END AS result\nFROM wc_normalized.match_team_statistics s\nJOIN wc_normalized.matches m USING (match_id)\nJOIN wc_normalized.teams t ON t.team_id = s.team_id;",
  },
  {
    id: 'X4',
    title: 'Add confederation to agg_team_tournament',
    startsIn: 'consumption',
    path: ['normalized', 'consumption'],
    closes: ['F2'],
    why: 'The dashboard filters by confederation; only Normalized has it.',
    change:
      'ALTER TABLE wc_consumption.agg_team_tournament ADD COLUMN confederation text;\n-- fill from wc_normalized.teams.confederation',
  },
  {
    id: 'X5',
    title: 'Normalize attendance and stadium, then expose them',
    startsIn: 'normalized',
    path: ['landing', 'normalized', 'consumption'],
    closes: ['Q5'],
    why: 'Both exist only as raw text in Landing; 3% of attendance values are “N/D”.',
    change:
      "-- Normalized: matches.attendance int <- NULLIF(regexp_replace(attendance_str, '[^0-9]', '', 'g'), '')::int\n--             matches.venue text <- raw_matches.stadium (trimmed)\n-- Consumption: fct_match_results.attendance, fct_match_results.venue",
  },
  {
    id: 'X6',
    title: 'Normalize xG into match_team_statistics and expose it',
    startsIn: 'normalized',
    path: ['landing', 'normalized', 'consumption'],
    closes: ['W6'],
    why: 'xG lands as text and only for 2022: the scatter would cover one tournament.',
    change:
      '-- Normalized: match_team_statistics.xg numeric <- raw_match_stats.xg::numeric\n-- Consumption: fct_team_match.xg (see X3)',
  },
  {
    id: 'X7',
    title: 'New source: match bookings (yellow and red cards)',
    startsIn: 'source',
    path: ['source', 'landing', 'normalized', 'consumption'],
    closes: ['Q6'],
    why: 'No layer holds disciplinary events; the question cannot be answered until they are ingested.',
    change:
      '-- Landing: raw_bookings(match_id, player_name, minute_str, card_type)\n-- Normalized: bookings(booking_id, match_id, player_id, minute, card_type)\n-- Consumption: agg_player_cards(tournament_year, player, team, yellow, red)',
  },
];

/** The World Cup Medallion report: every status, a full lineage, seven fixes. */
export const SAMPLE_GAP_REPORT: GapReport = {
  questions: REQUIREMENTS.filter((r) => r.kind === 'question').map(
    (r) => r.title,
  ),
  datasets: ['World Cup Medallion'],
  layers: (['landing', 'normalized', 'consumption'] as Layer[]).map(
    (layer) => ({
      schemaKey: `${CATALOG}.${SCHEMA[layer]}`,
      layer,
      dataset: 'World Cup Medallion',
      description: '',
    }),
  ),
  tables: TABLES,
  lineage: { edges: EDGES, checkedPairs: 24, failedChecks: 1 },
  dashboards: [
    {
      id: DASHBOARD_ID,
      source: 'image',
      name: 'Rendimiento Mundial',
      blueprint: BLUEPRINT,
    },
  ],
  requirements: REQUIREMENTS,
  assessments: ASSESSMENTS,
  fixes: FIXES,
  probeCount: 12,
};
