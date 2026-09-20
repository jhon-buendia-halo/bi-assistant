import { inferRelationships } from './relationships';
import type { ForeignKeyEdge } from './relationships';
import type { DatasetEntitySnapshot } from './repositories/datasets.repository';

/**
 * Column DSL: `name` is non-nullable, `name?` is nullable. Types are irrelevant
 * to inference (it reads names only) so they are left uniform.
 */
function entity(table: string, ...columns: string[]): DatasetEntitySnapshot {
  return {
    key: `world_cup.world_cup.${table}`,
    columns: columns.map((spec) => ({
      name: spec.replace(/\?$/, ''),
      type: 'text',
      nullable: spec.endsWith('?'),
    })),
  };
}

/** Column order and nullability mirror `docker/postgres/init/001_world_cup.sql`. */
const WORLD_CUP: DatasetEntitySnapshot[] = [
  entity('confederations', 'code', 'name'),
  entity('countries', 'code', 'name', 'confederation_code'),
  entity('teams', 'id', 'country_code', 'common_name', 'fifa_code'),
  entity(
    'tournaments',
    'id',
    'name',
    'tournament_year',
    'host_country_code',
    'starts_on',
    'ends_on',
    'champion_team_id?',
    'runner_up_team_id?',
  ),
  entity(
    'tournament_teams',
    'id',
    'tournament_id',
    'team_id',
    'group_letter?',
    'final_rank?',
    'qualified_for_knockout',
  ),
  entity('venues', 'id', 'tournament_id', 'name', 'city', 'capacity?'),
  entity(
    'players',
    'id',
    'national_team_id',
    'full_name',
    'position',
    'date_of_birth?',
  ),
  entity(
    'squad_members',
    'tournament_team_id',
    'player_id',
    'shirt_number',
    'squad_position',
  ),
  entity(
    'matches',
    'id',
    'tournament_id',
    'match_number',
    'stage',
    'group_letter?',
    'kicked_off_at',
    'venue_id',
    'home_team_id',
    'away_team_id',
    'home_goals',
    'away_goals',
    'went_to_extra_time',
    'home_penalties?',
    'away_penalties?',
    'winner_team_id?',
    'attendance?',
  ),
  entity(
    'match_team_statistics',
    'match_id',
    'team_id',
    'possession_pct',
    'shots',
    'shots_on_target',
    'corners',
    'fouls_committed',
    'offsides',
    'passes_completed',
    'passes_attempted',
    'expected_goals',
  ),
  entity(
    'goals',
    'id',
    'match_id',
    'scoring_team_id',
    'scorer_player_id?',
    'assist_player_id?',
    'minute',
    'stoppage_minute',
    'goal_type',
    'home_score_after',
    'away_score_after',
  ),
  entity(
    'disciplinary_events',
    'id',
    'match_id',
    'team_id',
    'player_id?',
    'minute',
    'stoppage_minute',
    'card_type',
    'reason?',
  ),
];

const byTable = (table: string): DatasetEntitySnapshot => {
  const found = WORLD_CUP.find((e) => e.key.endsWith(`.${table}`));
  if (!found) throw new Error(`fixture has no table ${table}`);
  return found;
};

/** `goals.match_id -> matches.id`, for readable assertions and diffs. */
const render = (edge: ForeignKeyEdge): string =>
  `${edge.from.entity.split('.').pop()}.${edge.from.column} -> ${edge.to.entity
    .split('.')
    .pop()}.${edge.to.column}`;

const rendered = (entities: DatasetEntitySnapshot[]): string[] =>
  inferRelationships(entities).map(render).sort();

/**
 * Every foreign key `001_world_cup.sql` declares. Inference is expected to
 * recover all 25 and invent nothing — this list is the ground truth for both
 * the recall and the precision assertions below.
 */
const DECLARED_FOREIGN_KEYS = [
  'countries.confederation_code -> confederations.code',
  'teams.country_code -> countries.code',
  'tournaments.host_country_code -> countries.code',
  'tournaments.champion_team_id -> teams.id',
  'tournaments.runner_up_team_id -> teams.id',
  'tournament_teams.tournament_id -> tournaments.id',
  'tournament_teams.team_id -> teams.id',
  'venues.tournament_id -> tournaments.id',
  'players.national_team_id -> teams.id',
  'squad_members.tournament_team_id -> tournament_teams.id',
  'squad_members.player_id -> players.id',
  'matches.tournament_id -> tournaments.id',
  'matches.venue_id -> venues.id',
  'matches.home_team_id -> teams.id',
  'matches.away_team_id -> teams.id',
  'matches.winner_team_id -> teams.id',
  'match_team_statistics.match_id -> matches.id',
  'match_team_statistics.team_id -> teams.id',
  'goals.match_id -> matches.id',
  'goals.scoring_team_id -> teams.id',
  'goals.scorer_player_id -> players.id',
  'goals.assist_player_id -> players.id',
  'disciplinary_events.match_id -> matches.id',
  'disciplinary_events.team_id -> teams.id',
  'disciplinary_events.player_id -> players.id',
].sort();

describe('inferRelationships — World Cup schema', () => {
  // The seven joins whose absence produced the "Team ID 5" answers.
  it.each([
    'goals.scoring_team_id -> teams.id',
    'goals.match_id -> matches.id',
    'players.national_team_id -> teams.id',
    'matches.tournament_id -> tournaments.id',
    'disciplinary_events.team_id -> teams.id',
    'match_team_statistics.team_id -> teams.id',
    'tournament_teams.team_id -> teams.id',
  ])('recovers %s', (expected) => {
    expect(rendered(WORLD_CUP)).toContain(expected);
  });

  it('recovers every declared foreign key and invents nothing', () => {
    expect(rendered(WORLD_CUP)).toEqual(DECLARED_FOREIGN_KEYS);
  });

  it('resolves a non-`id` primary key by suffix, not by guessing `id`', () => {
    // countries is keyed `code`; joining host_country_code to a bigint id
    // would fail at runtime instead of returning a country name.
    expect(rendered(WORLD_CUP)).toContain(
      'tournaments.host_country_code -> countries.code',
    );
  });

  it('handles the irregular plural `match` -> `matches`', () => {
    expect(rendered(WORLD_CUP)).toContain('goals.match_id -> matches.id');
  });

  it('strips left-hand qualifiers until a table name matches', () => {
    const edges = rendered(WORLD_CUP);
    expect(edges).toContain('goals.scoring_team_id -> teams.id');
    expect(edges).toContain('matches.home_team_id -> teams.id');
    expect(edges).toContain('tournaments.runner_up_team_id -> teams.id');
  });

  it('prefers the longest matching prefix', () => {
    // `tournament_team_id` must reach tournament_teams, not stop at teams.
    expect(rendered(WORLD_CUP)).toContain(
      'squad_members.tournament_team_id -> tournament_teams.id',
    );
  });

  it('emits at most one edge per source column', () => {
    const slots = inferRelationships(WORLD_CUP).map(
      (e) => `${e.from.entity}|${e.from.column}`,
    );
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('never emits a self-edge', () => {
    for (const edge of inferRelationships(WORLD_CUP)) {
      expect(edge.to.entity).not.toBe(edge.from.entity);
    }
  });

  it('only targets columns that exist in the target snapshot', () => {
    for (const edge of inferRelationships(WORLD_CUP)) {
      const target = WORLD_CUP.find((e) => e.key === edge.to.entity);
      expect(target?.columns.map((c) => c.name)).toContain(edge.to.column);
    }
  });
});

describe('inferRelationships — no false positives', () => {
  it.each(['minute', 'stoppage_minute', 'goal_type', 'home_score_after'])(
    'emits nothing from goals.%s',
    (column) => {
      const sources = inferRelationships(WORLD_CUP)
        .filter((e) => e.from.entity.endsWith('.goals'))
        .map((e) => e.from.column);
      expect(sources).not.toContain(column);
    },
  );

  it('emits nothing from matches.home_goals despite a `goals` table', () => {
    // A measure that happens to be named after another table is the classic
    // false-positive trap: `home_goals` is a count, not a reference.
    const sources = inferRelationships(WORLD_CUP)
      .filter((e) => e.from.entity.endsWith('.matches'))
      .map((e) => e.from.column);
    expect(sources).not.toContain('home_goals');
    expect(sources).not.toContain('away_goals');
  });

  it('emits nothing from match_team_statistics.possession_pct', () => {
    const sources = inferRelationships(WORLD_CUP)
      .filter((e) => e.from.entity.endsWith('.match_team_statistics'))
      .map((e) => e.from.column);
    expect(sources).not.toContain('possession_pct');
    expect(sources).not.toContain('expected_goals');
  });

  it('emits nothing when the target tables are outside the dataset', () => {
    // A dataset of one table has nothing to join to; hinting at `matches` the
    // user did not include would produce SQL against an inaccessible table.
    expect(inferRelationships([byTable('goals')])).toEqual([]);
  });

  it('does not link two tables that merely share a primary key name', () => {
    // confederations.code and countries.code are both keys named `code`;
    // the real reference runs through countries.confederation_code.
    const edges = rendered([byTable('confederations'), byTable('countries')]);
    expect(edges).toEqual([
      'countries.confederation_code -> confederations.code',
    ]);
  });

  it('drops a self-referential name instead of pointing a table at itself', () => {
    const teams: DatasetEntitySnapshot = {
      key: 'wc.wc.teams',
      columns: [
        { name: 'team_id', type: 'bigint', nullable: false },
        { name: 'name', type: 'text', nullable: false },
      ],
    };
    expect(inferRelationships([teams])).toEqual([]);
  });

  it('drops an ambiguous table name', () => {
    // Two schemas expose `orders`; `order_id` cannot be resolved to either.
    const entities: DatasetEntitySnapshot[] = [
      {
        key: 'sales.public.orders',
        columns: [{ name: 'id', type: 'bigint', nullable: false }],
      },
      {
        key: 'finance.public.order',
        columns: [{ name: 'id', type: 'bigint', nullable: false }],
      },
      {
        key: 'sales.public.shipments',
        columns: [
          { name: 'id', type: 'bigint', nullable: false },
          { name: 'order_id', type: 'bigint', nullable: false },
        ],
      },
    ];
    expect(inferRelationships(entities)).toEqual([]);
  });

  it('emits nothing when the target table has no usable key column', () => {
    const teams: DatasetEntitySnapshot = {
      key: 'wc.wc.teams',
      columns: [], // snapshot captured before enrichment
    };
    const goals: DatasetEntitySnapshot = {
      key: 'wc.wc.goals',
      columns: [{ name: 'team_id', type: 'bigint', nullable: false }],
    };
    expect(inferRelationships([teams, goals])).toEqual([]);
  });
});

describe('inferRelationships — shared column names', () => {
  /** `member_profiles` is keyed `member_id`; no table is called `members`. */
  const memberProfiles: DatasetEntitySnapshot = {
    key: 'lake.hr.member_profiles',
    columns: [
      { name: 'member_id', type: 'bigint', nullable: false },
      { name: 'full_name', type: 'string', nullable: false },
    ],
  };
  const claims: DatasetEntitySnapshot = {
    key: 'lake.hr.claims',
    columns: [
      { name: 'id', type: 'bigint', nullable: false },
      { name: 'member_id', type: 'bigint', nullable: false },
      { name: 'paid_amount', type: 'double', nullable: false },
    ],
  };

  it('links a shared key name when exactly one table is keyed by it', () => {
    expect(rendered([memberProfiles, claims])).toEqual([
      'claims.member_id -> member_profiles.member_id',
    ]);
  });

  it('emits nothing when two tables are plausibly keyed by the same name', () => {
    const memberAccounts: DatasetEntitySnapshot = {
      key: 'lake.hr.member_accounts',
      columns: [
        { name: 'member_id', type: 'bigint', nullable: false },
        { name: 'plan', type: 'string', nullable: false },
      ],
    };
    expect(
      inferRelationships([memberProfiles, memberAccounts, claims]),
    ).toEqual([]);
  });

  it('ignores a nullable same-named column as a key candidate', () => {
    const nullableKey: DatasetEntitySnapshot = {
      key: 'lake.hr.member_notes',
      columns: [
        { name: 'member_id', type: 'bigint', nullable: true },
        { name: 'note', type: 'string', nullable: true },
      ],
    };
    expect(inferRelationships([nullableKey, claims])).toEqual([]);
  });

  it('lets the table-name rule win when the two rules disagree', () => {
    const teams: DatasetEntitySnapshot = {
      key: 'wc.wc.teams',
      columns: [
        { name: 'id', type: 'bigint', nullable: false },
        { name: 'name', type: 'text', nullable: false },
      ],
    };
    const teamProfiles: DatasetEntitySnapshot = {
      key: 'wc.wc.team_profiles',
      columns: [
        { name: 'team_id', type: 'bigint', nullable: false },
        { name: 'nickname', type: 'text', nullable: false },
      ],
    };
    const goals: DatasetEntitySnapshot = {
      key: 'wc.wc.goals',
      columns: [
        { name: 'id', type: 'bigint', nullable: false },
        { name: 'team_id', type: 'bigint', nullable: false },
      ],
    };
    // Rule 2 would offer team_profiles.team_id; the table-name match wins.
    expect(rendered([teams, teamProfiles, goals])).toEqual([
      'goals.team_id -> teams.id',
      'team_profiles.team_id -> teams.id',
    ]);
  });
});

describe('inferRelationships — robustness', () => {
  it('matches case-insensitively and preserves the original casing', () => {
    const members: DatasetEntitySnapshot = {
      key: 'WAREHOUSE.PUBLIC.Members',
      columns: [
        { name: 'ID', type: 'NUMBER', nullable: false },
        { name: 'FULL_NAME', type: 'VARCHAR', nullable: false },
      ],
    };
    const claims: DatasetEntitySnapshot = {
      key: 'WAREHOUSE.PUBLIC.Claims',
      columns: [
        { name: 'ID', type: 'NUMBER', nullable: false },
        { name: 'MEMBER_ID', type: 'NUMBER', nullable: false },
      ],
    };
    expect(inferRelationships([members, claims])).toEqual([
      {
        from: { entity: 'WAREHOUSE.PUBLIC.Claims', column: 'MEMBER_ID' },
        to: { entity: 'WAREHOUSE.PUBLIC.Members', column: 'ID' },
      },
    ]);
  });

  it('handles mixed-case irregular plurals', () => {
    const entities: DatasetEntitySnapshot[] = [
      {
        key: 'DW.Sport.Matches',
        columns: [{ name: 'Id', type: 'bigint', nullable: false }],
      },
      {
        key: 'DW.Sport.Cities',
        columns: [{ name: 'Id', type: 'bigint', nullable: false }],
      },
      {
        key: 'DW.Sport.Goals',
        columns: [
          { name: 'Match_Id', type: 'bigint', nullable: false },
          { name: 'City_Id', type: 'bigint', nullable: false },
        ],
      },
    ];
    expect(rendered(entities).sort()).toEqual([
      'Goals.City_Id -> Cities.Id',
      'Goals.Match_Id -> Matches.Id',
    ]);
  });

  it('returns an empty list for an empty entity set', () => {
    expect(inferRelationships([])).toEqual([]);
  });

  it('tolerates an entity with zero columns', () => {
    const edges = rendered([
      ...WORLD_CUP,
      { key: 'world_cup.world_cup.staging_blob', columns: [] },
    ]);
    expect(edges).toEqual(DECLARED_FOREIGN_KEYS);
  });

  it('tolerates malformed entity keys without throwing', () => {
    const entities: DatasetEntitySnapshot[] = [
      { key: '', columns: [{ name: 'id', type: 'bigint', nullable: false }] },
      {
        key: 'a..b.',
        columns: [{ name: 'id', type: 'bigint', nullable: false }],
      },
      {
        key: 'teams',
        columns: [{ name: 'id', type: 'bigint', nullable: false }],
      },
      {
        key: 'goals',
        columns: [{ name: 'team_id', type: 'bigint', nullable: false }],
      },
    ];
    let edges: ForeignKeyEdge[] = [];
    expect(() => {
      edges = inferRelationships(entities);
    }).not.toThrow();
    // A bare table name is still a usable key, so this one edge survives.
    expect(edges).toEqual([
      {
        from: { entity: 'goals', column: 'team_id' },
        to: { entity: 'teams', column: 'id' },
      },
    ]);
  });
});
