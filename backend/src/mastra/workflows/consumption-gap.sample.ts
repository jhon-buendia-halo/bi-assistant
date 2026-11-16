/**
 * The World Cup Medallion sample (roadmap 1.30.1) as Consumption Gap
 * Analysis sees it: the layer catalogs, the six example questions and a
 * plausible Layer Mapper reply for them. Pure data, used by the unit tests
 * of ./consumption-gap.lineage.ts and ./consumption-gap.gaps.ts.
 */
import type {
  Layer,
  LayerTable,
  Requirement,
  RequirementField,
} from './consumption-gap-analysis.schemas';

/** The sample's datasource (one Postgres database, `world_cup`). */
export const GAP_SAMPLE_DATASOURCE = 'ds-world-cup';

function table(
  layer: Layer,
  schema: string,
  name: string,
  columns: Array<[string, string]>,
): LayerTable {
  return {
    entity: `world_cup.${schema}.${name}`,
    layer,
    dataset: 'World Cup Medallion',
    datasourceId: GAP_SAMPLE_DATASOURCE,
    datasourceKind: 'postgres',
    columns: columns.map(([n, type]) => ({ name: n, type })),
    more: 0,
  };
}

/** The entities of the three tagged schemas, Consumption first. */
export const GAP_SAMPLE_TABLES: LayerTable[] = [
  table('consumption', 'wc_consumption', 'agg_player_goals', [
    ['tournament_year', 'integer'],
    ['player', 'text'],
    ['team', 'text'],
    ['goals', 'integer'],
  ]),
  table('consumption', 'wc_consumption', 'agg_team_tournament', [
    ['tournament_year', 'integer'],
    ['team', 'text'],
    ['matches_played', 'integer'],
    ['wins', 'integer'],
    ['draws', 'integer'],
    ['losses', 'integer'],
    ['goals_for', 'integer'],
    ['goals_against', 'integer'],
  ]),
  table('consumption', 'wc_consumption', 'fct_match_results', [
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
  table('normalized', 'wc_normalized', 'goals', [
    ['goal_id', 'integer'],
    ['match_id', 'integer'],
    ['player_name', 'text'],
    ['team_id', 'integer'],
    ['minute', 'integer'],
    ['is_penalty', 'boolean'],
  ]),
  table('normalized', 'wc_normalized', 'match_team_statistics', [
    ['match_id', 'integer'],
    ['team_id', 'integer'],
    ['possession', 'numeric'],
    ['shots', 'integer'],
  ]),
  table('normalized', 'wc_normalized', 'matches', [
    ['match_id', 'integer'],
    ['tournament_year', 'integer'],
    ['stage', 'text'],
    ['home_team_id', 'integer'],
    ['away_team_id', 'integer'],
    ['home_score', 'integer'],
    ['away_score', 'integer'],
    ['match_date', 'date'],
  ]),
  table('normalized', 'wc_normalized', 'teams', [
    ['team_id', 'integer'],
    ['team_name', 'text'],
    ['confederation', 'text'],
  ]),
  table('landing', 'wc_landing', 'raw_goals', [
    ['match_id', 'text'],
    ['player_name', 'text'],
    ['team', 'text'],
    ['minute_str', 'text'],
    ['penalty_flag', 'text'],
  ]),
  table('landing', 'wc_landing', 'raw_match_stats', [
    ['match_id', 'text'],
    ['team', 'text'],
    ['possession_pct_str', 'text'],
    ['shots', 'integer'],
    ['xg', 'text'],
  ]),
  table('landing', 'wc_landing', 'raw_matches', [
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
  table('landing', 'wc_landing', 'raw_teams', [
    ['team', 'text'],
    ['confed', 'text'],
  ]),
];

/** The six example questions of the sample. */
export const GAP_SAMPLE_QUESTIONS = [
  '¿Qué equipo ganó más partidos en cada Mundial (2018 y 2022)?',
  '¿Cuál es la diferencia de gol de cada equipo por Mundial?',
  '¿Qué porcentaje de los goles fueron de penal?',
  '¿Los equipos con más posesión ganan más partidos?',
  '¿Cuál es la asistencia promedio por estadio?',
  '¿Qué jugadores recibieron más tarjetas amarillas?',
];

function field(
  name: string,
  role: RequirementField['role'],
  aggregation = '',
): RequirementField {
  return { name, role, aggregation, description: name };
}

function question(
  n: number,
  fields: RequirementField[],
  grain: string,
  periodValues: string[] = [],
): Requirement {
  return {
    id: `Q${n}`,
    kind: 'question',
    title: GAP_SAMPLE_QUESTIONS[n - 1],
    source: `Question ${n}`,
    dashboardId: '',
    ref: '',
    fields,
    grain,
    periodValues,
  };
}

/** The requirements the Requirements Analyst would derive from them. */
export const GAP_SAMPLE_REQUIREMENTS: Requirement[] = [
  question(
    1,
    [
      field('wins', 'measure', 'max'),
      field('team', 'dimension'),
      field('tournament_year', 'time'),
    ],
    'team × tournament',
    ['2018', '2022'],
  ),
  question(
    2,
    [
      field('goal_difference', 'measure', 'sum'),
      field('team', 'dimension'),
      field('tournament_year', 'time'),
    ],
    'team × tournament',
  ),
  question(3, [field('penalty_share', 'measure', 'share')], 'goal'),
  question(
    4,
    [
      field('possession', 'measure', 'avg'),
      field('wins', 'measure', 'sum'),
      field('team', 'dimension'),
    ],
    'team × tournament',
  ),
  question(
    5,
    [field('attendance', 'measure', 'avg'), field('stadium', 'dimension')],
    'stadium',
  ),
  question(
    6,
    [field('yellow_cards', 'measure', 'sum'), field('player', 'dimension')],
    'player',
  ),
];

const C = 'world_cup.wc_consumption';
const N = 'world_cup.wc_normalized';
const L = 'world_cup.wc_landing';

/** A plausible Layer Mapper reply for the six requirements. */
export const GAP_SAMPLE_MAPPING_REPLY = {
  mappings: [
    {
      requirementId: 'Q1',
      field: 'wins',
      sources: [
        {
          layer: 'consumption',
          entity: `${C}.agg_team_tournament`,
          column: 'wins',
          expression: '',
        },
      ],
      note: '',
    },
    {
      requirementId: 'Q1',
      field: 'team',
      sources: [
        {
          layer: 'consumption',
          entity: `${C}.agg_team_tournament`,
          column: 'team',
          expression: '',
        },
      ],
      note: '',
    },
    {
      requirementId: 'Q1',
      field: 'tournament_year',
      sources: [
        {
          layer: 'consumption',
          entity: `${C}.agg_team_tournament`,
          column: 'tournament_year',
          expression: '',
        },
        {
          layer: 'normalized',
          entity: `${N}.matches`,
          column: 'tournament_year',
          expression: '',
        },
        {
          layer: 'landing',
          entity: `${L}.raw_matches`,
          column: 'tournament',
          expression: 'left(tournament, 4)::int',
        },
      ],
      note: '',
    },
    {
      requirementId: 'Q2',
      field: 'goal_difference',
      sources: [
        {
          layer: 'consumption',
          entity: `${C}.agg_team_tournament`,
          column: 'goals_for',
          expression: 'goals_for - goals_against',
        },
      ],
      note: '',
    },
    {
      requirementId: 'Q2',
      field: 'team',
      sources: [
        {
          layer: 'consumption',
          entity: `${C}.agg_team_tournament`,
          column: 'team',
          expression: '',
        },
      ],
      note: '',
    },
    {
      requirementId: 'Q2',
      field: 'tournament_year',
      sources: [
        {
          layer: 'consumption',
          entity: `${C}.agg_team_tournament`,
          column: 'tournament_year',
          expression: '',
        },
      ],
      note: '',
    },
    {
      requirementId: 'Q3',
      field: 'penalty_share',
      sources: [
        {
          layer: 'normalized',
          entity: `${N}.goals`,
          column: 'is_penalty',
          expression: 'avg(case when is_penalty then 1 else 0 end)',
        },
        {
          layer: 'landing',
          entity: `${L}.raw_goals`,
          column: 'penalty_flag',
          expression: "penalty_flag = 'Y'",
        },
      ],
      note: '',
    },
    {
      requirementId: 'Q4',
      field: 'possession',
      sources: [
        {
          layer: 'normalized',
          entity: `${N}.match_team_statistics`,
          column: 'possession',
          expression: '',
        },
      ],
      note: '',
    },
    {
      requirementId: 'Q4',
      field: 'wins',
      sources: [
        {
          layer: 'consumption',
          entity: `${C}.agg_team_tournament`,
          column: 'wins',
          expression: '',
        },
      ],
      note: '',
    },
    {
      requirementId: 'Q4',
      field: 'team',
      sources: [
        {
          layer: 'consumption',
          entity: `${C}.agg_team_tournament`,
          column: 'team',
          expression: '',
        },
      ],
      note: '',
    },
    {
      requirementId: 'Q5',
      field: 'attendance',
      sources: [
        {
          layer: 'landing',
          entity: `${L}.raw_matches`,
          column: 'attendance_str',
          expression: "replace(attendance_str, ',', '')::int",
        },
      ],
      note: '',
    },
    {
      requirementId: 'Q5',
      field: 'stadium',
      sources: [
        {
          layer: 'landing',
          entity: `${L}.raw_matches`,
          column: 'stadium',
          expression: '',
        },
      ],
      note: '',
    },
    {
      requirementId: 'Q6',
      field: 'yellow_cards',
      sources: [],
      note: 'No layer records cards.',
    },
    {
      requirementId: 'Q6',
      field: 'player',
      sources: [
        {
          layer: 'consumption',
          entity: `${C}.agg_player_goals`,
          column: 'player',
          expression: '',
        },
      ],
      note: '',
    },
  ],
};
