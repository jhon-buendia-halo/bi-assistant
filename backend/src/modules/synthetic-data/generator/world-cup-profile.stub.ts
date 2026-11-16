// A hand-written sampled profile shaped like the World Cup dataset, for generator specs.
// (`.stub.ts`: excluded from the build.)

import type {
  SampledColumn,
  SampledProfile,
  SampledRelationship,
  SampledTable,
} from '../types';

const Q = (lo: number, hi: number): number[] =>
  Array.from({ length: 11 }, (_, i) => lo + ((hi - lo) * i) / 10);

export function column(
  name: string,
  type: string,
  over: Partial<SampledColumn> = {},
): SampledColumn {
  return {
    name,
    type,
    semanticType: 'text',
    nullable: true,
    kind: 'text',
    strategy: 'pattern',
    nullFraction: 0,
    distinctCount: 10,
    distinctRatio: 1,
    ...over,
  };
}

export const idCol = (name = 'id'): SampledColumn =>
  column(name, 'bigint', {
    semanticType: 'numeric',
    nullable: false,
    kind: 'identifier',
    strategy: 'sequence',
  });

export const fkCol = (
  name: string,
  nullable = false,
  nullFraction = 0,
): SampledColumn =>
  column(name, 'bigint', {
    semanticType: 'numeric',
    nullable,
    nullFraction,
    kind: 'identifier',
    strategy: 'foreign-key',
  });

export const textKey = (
  name: string,
  type: string,
  shape: string,
): SampledColumn =>
  column(name, type, {
    nullable: false,
    kind: 'identifier',
    strategy: 'unique-pattern',
    patterns: [{ shape, fraction: 1 }],
    length: { min: 3, max: 12, mean: 8, quantiles: Q(3, 12) },
  });

export function table(
  name: string,
  columns: SampledColumn[],
  primaryKey: string[] = ['id'],
  uniqueKeys: string[][] = [],
): SampledTable {
  return {
    key: `world_cup.public.${name}`,
    namespace: 'public',
    name,
    rowCountEstimate: 100,
    sampledRows: 100,
    method: 'full',
    durationMs: 3,
    primaryKey,
    uniqueKeys,
    columns,
  };
}

export const rel = (
  from: string,
  fromColumns: string[],
  to: string,
  toColumns: string[] = ['id'],
): SampledRelationship => ({
  fromTable: `world_cup.public.${from}`,
  fromColumns,
  toTable: `world_cup.public.${to}`,
  toColumns,
  origin: 'declared',
});

export function profile(
  tables: SampledTable[],
  relationships: SampledRelationship[],
): SampledProfile {
  return {
    profileId: '00000000-0000-4000-8000-000000000001',
    version: 1,
    datasetName: 'World Cup',
    datasourceId: 'ds-1',
    datasourceName: 'World Cup DB',
    dialect: 'postgres',
    generatedAt: '2026-11-11T10:00:00.000Z',
    expiresAt: '2026-11-11T11:00:00.000Z',
    sampleSize: 1000,
    tables,
    relationships,
  };
}

export function worldCupProfile(): SampledProfile {
  const tables = [
    table(
      'confederations',
      [
        textKey('code', 'text', 'A{4,8}'),
        textKey('name', 'text', 'Aa{3,10}_Aa{3,10}'),
      ],
      ['code'],
      [['name']],
    ),
    table(
      'countries',
      [
        textKey('code', 'character(3)', 'AAA'),
        textKey('name', 'text', 'Aa{3,12}'),
        fkCol('confederation_code'),
      ],
      ['code'],
      [['name']],
    ),
    table(
      'teams',
      [
        idCol(),
        fkCol('country_code'),
        textKey('common_name', 'text', 'Aa{3,12}'),
        textKey('fifa_code', 'character(3)', 'AAA'),
      ],
      ['id'],
      [['country_code'], ['common_name'], ['fifa_code']],
    ),
    table(
      'tournaments',
      [
        idCol(),
        column('name', 'text', {
          nullable: false,
          patterns: [{ shape: '9999_Aa{4,6}_Aa{3}', fraction: 1 }],
        }),
        column('tournament_year', 'integer', {
          semanticType: 'numeric',
          nullable: false,
          kind: 'identifier',
          strategy: 'unique-range',
          numeric: {
            min: 2018,
            max: 2022,
            mean: 2020,
            quantiles: [
              2018, 2018, 2018, 2018, 2018, 2020, 2022, 2022, 2022, 2022, 2022,
            ],
            integer: true,
            scale: 0,
          },
        }),
        fkCol('host_country_code'),
        column('starts_on', 'date', {
          semanticType: 'temporal',
          kind: 'temporal',
          strategy: 'temporal-range',
          nullable: false,
          temporal: {
            min: '2018-06-14T00:00:00.000Z',
            max: '2022-11-20T00:00:00.000Z',
            quantiles: Array.from({ length: 11 }, (_, i) =>
              i < 6 ? '2018-06-14T00:00:00.000Z' : '2022-11-20T00:00:00.000Z',
            ),
            granularity: 'date',
          },
        }),
        fkCol('champion_team_id', true, 0.3),
      ],
      ['id'],
      [['tournament_year']],
    ),
    table(
      'tournament_teams',
      [
        idCol(),
        fkCol('tournament_id'),
        fkCol('team_id'),
        column('group_letter', 'character(1)', {
          kind: 'categorical',
          strategy: 'categorical',
          nullFraction: 0.1,
          topValues: [
            { value: 'A', fraction: 0.5 },
            { value: 'B', fraction: 0.3 },
            { value: 'C', fraction: 0.2 },
          ],
          otherFraction: 0,
        }),
      ],
      ['id'],
      [['tournament_id', 'team_id']],
    ),
    table(
      'players',
      [
        idCol(),
        fkCol('national_team_id'),
        textKey('full_name', 'text', 'Aa{3,8}_Aa{3,10}'),
      ],
      ['id'],
      [['national_team_id', 'full_name']],
    ),
    table(
      'squad_members',
      [
        fkCol('tournament_team_id'),
        fkCol('player_id'),
        column('shirt_number', 'integer', {
          semanticType: 'numeric',
          nullable: false,
          kind: 'identifier',
          strategy: 'unique-range',
          numeric: {
            min: 1,
            max: 26,
            mean: 13,
            quantiles: Q(1, 26),
            integer: true,
            scale: 0,
          },
        }),
      ],
      ['tournament_team_id', 'player_id'],
      [['tournament_team_id', 'shirt_number']],
    ),
    table('matches', [
      idCol(),
      fkCol('tournament_id'),
      fkCol('home_team_id'),
      fkCol('away_team_id'),
      fkCol('winner_team_id', true, 0.25),
      column('home_score', 'integer', {
        semanticType: 'numeric',
        kind: 'numeric',
        strategy: 'numeric-range',
        numeric: {
          min: 0,
          max: 7,
          mean: 1.4,
          quantiles: [0, 0, 0, 1, 1, 1, 2, 2, 3, 4, 7],
          integer: true,
          scale: 0,
        },
      }),
      column('attendance_ratio', 'numeric(5,2)', {
        semanticType: 'numeric',
        kind: 'numeric',
        strategy: 'numeric-range',
        nullFraction: 0.2,
        numeric: {
          min: 0.35,
          max: 99.9,
          mean: 60,
          quantiles: Q(0.35, 99.9).map((x) => Math.round(x * 100) / 100),
          integer: false,
          scale: 2,
        },
      }),
      column('kickoff_at', 'timestamp with time zone', {
        semanticType: 'temporal',
        kind: 'temporal',
        strategy: 'temporal-range',
        temporal: {
          min: '2018-06-14T15:00:00.000Z',
          max: '2022-12-18T15:00:00.000Z',
          quantiles: Array.from({ length: 11 }, (_, i) =>
            new Date(
              Date.UTC(2018, 5, 14, 15) + i * 14_000_000_000,
            ).toISOString(),
          ).map((s, i) => (i === 10 ? '2022-12-18T15:00:00.000Z' : s)),
          granularity: 'second',
        },
      }),
      column('extra_time', 'boolean', {
        semanticType: 'boolean',
        kind: 'boolean',
        strategy: 'boolean-rate',
        boolean: { trueFraction: 0.2 },
      }),
    ]),
    table('goals', [
      idCol(),
      fkCol('match_id'),
      fkCol('scorer_player_id', true, 0.05),
      column('minute', 'integer', {
        semanticType: 'numeric',
        kind: 'numeric',
        strategy: 'numeric-range',
        nullable: false,
        numeric: {
          min: 1,
          max: 120,
          mean: 50,
          quantiles: Q(1, 120).map(Math.round),
          integer: true,
          scale: 0,
        },
      }),
      column('description', 'text', {
        kind: 'text',
        strategy: 'words',
        nullFraction: 0.5,
        length: {
          min: 41,
          max: 120,
          mean: 70,
          quantiles: Q(41, 120).map(Math.round),
        },
      }),
      column('scorer_email', 'text', {
        kind: 'formatted',
        strategy: 'format-template',
        formatRule: 'email',
      }),
      column('payload', 'jsonb', {
        semanticType: 'json',
        kind: 'unsupported',
        strategy: 'null-only',
        note: 'Type not synthesized: generated as NULL',
      }),
    ]),
  ];
  const relationships = [
    rel('countries', ['confederation_code'], 'confederations', ['code']),
    rel('teams', ['country_code'], 'countries', ['code']),
    rel('tournaments', ['host_country_code'], 'countries', ['code']),
    rel('tournaments', ['champion_team_id'], 'teams'),
    rel('tournament_teams', ['tournament_id'], 'tournaments'),
    rel('tournament_teams', ['team_id'], 'teams'),
    rel('players', ['national_team_id'], 'teams'),
    rel('squad_members', ['tournament_team_id'], 'tournament_teams'),
    rel('squad_members', ['player_id'], 'players'),
    rel('matches', ['tournament_id'], 'tournaments'),
    rel('matches', ['home_team_id'], 'teams'),
    rel('matches', ['away_team_id'], 'teams'),
    rel('matches', ['winner_team_id'], 'teams'),
    rel('goals', ['match_id'], 'matches'),
    rel('goals', ['scorer_player_id'], 'players'),
  ];
  return profile(tables, relationships);
}
