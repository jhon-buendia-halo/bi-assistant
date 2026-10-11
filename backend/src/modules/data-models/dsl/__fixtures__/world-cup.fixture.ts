/**
 * A small, valid `DataModel` shared by every spec in this module — the
 * `teams`/`matches` shape already used by `testing-data/fixtures/001_world_cup.sql`,
 * trimmed to the handful of attributes each test needs. Keeping one fixture
 * per concern (a tweak per test) would make failures about the fixture
 * itself rather than the behaviour under test; a shared, known-good model
 * that individual specs clone and perturb keeps the diff small and the
 * intent obvious.
 *
 * Deliberately exercises every binding/column-mapping shape at once:
 * `teams.team_id` and `matches.match_id` are logical keys mapped onto a
 * physical `id` column (`columns`), and `home_win_rate` is a metric with no
 * `agg`, proving `expressions.sql` alone satisfies "needs agg or
 * expressions.sql". Nested array paths (`ratings[].score`) are exercised
 * separately in `references.spec.ts`, not here — a flat `sql` binding has
 * no physical column for a nested path, so folding one into this fixture
 * would make the snapshot-drift tests fight the reference-grammar tests.
 */
import type { DataModel } from '../../entities/data-model.entity';

export function worldCupFixture(): DataModel {
  return {
    model: 'world_cup',
    version: 1,
    description: 'World Cup matches and teams, trimmed for tests.',
    entities: [
      {
        name: 'teams',
        label: 'Teams',
        key: ['team_id'],
        bindings: [
          {
            kind: 'sql',
            datasource: 'world-cup',
            table: 'main.public.teams',
            columns: { team_id: 'id', name: 'common_name' },
          },
        ],
        attributes: [
          { name: 'team_id', type: 'integer', role: 'key' },
          { name: 'name', type: 'string', role: 'dimension' },
          { name: 'fifa_code', type: 'string', role: 'dimension' },
        ],
      },
      {
        name: 'matches',
        label: 'Matches',
        key: ['match_id'],
        bindings: [
          {
            kind: 'sql',
            datasource: 'world-cup',
            table: 'main.public.matches',
            columns: { match_id: 'id' },
          },
        ],
        attributes: [
          { name: 'match_id', type: 'integer', role: 'key' },
          { name: 'home_team_id', type: 'integer', role: 'key' },
          { name: 'away_team_id', type: 'integer', role: 'key' },
          {
            name: 'winner_team_id',
            type: 'integer',
            role: 'key',
            nullable: true,
          },
          { name: 'stage', type: 'string', role: 'dimension' },
          {
            name: 'attendance',
            type: 'integer',
            role: 'measure',
            samples: [64000, 72000, 45000],
          },
        ],
      },
    ],
    relationships: [
      {
        name: 'matches_home_team',
        from: 'matches.home_team_id',
        to: 'teams.team_id',
        cardinality: 'many_to_one',
        source: 'declared',
      },
    ],
    metrics: [
      {
        name: 'avg_attendance',
        label: 'Average attendance',
        entity: 'matches',
        agg: 'avg',
        of: 'attendance',
      },
      {
        name: 'home_win_rate',
        label: 'Home win rate',
        entity: 'matches',
        description: 'Share of matches the home team won.',
        expressions: {
          sql: 'avg(case when winner_team_id = home_team_id then 1.0 else 0 end)',
        },
      },
    ],
  };
}
