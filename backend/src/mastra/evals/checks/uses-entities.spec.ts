import { readEntities, usesEntities } from './uses-entities';
import type { ViewTables } from './check';
import type { CheckToolCall, CheckTurn } from './turn';

/** The final-score-2018 reference: matches, tournaments and teams. */
const REFERENCE =
  "SELECT home.common_name AS home_team, away.common_name AS away_team, match.home_goals, match.away_goals FROM world_cup.matches match JOIN world_cup.tournaments tournament ON tournament.id = match.tournament_id JOIN world_cup.teams home ON home.id = match.home_team_id JOIN world_cup.teams away ON away.id = match.away_team_id WHERE tournament.tournament_year = 2018 AND match.stage = 'final'";

const context = { dialect: 'postgres' as const, expectedSql: REFERENCE };

/** Two World Cup views as its seed defines them (sample-views.spec.ts). */
const VIEWS: ViewTables = new Map([
  ['v_match_results', ['matches', 'tournaments', 'venues', 'teams']],
  [
    'v_player_goal_totals',
    ['goals', 'matches', 'tournaments', 'players', 'teams'],
  ],
]);

const withViews = { ...context, views: () => VIEWS };

/** The answer of the BA-188 review: right, and read from a view. */
const FROM_VIEW = (from: string) =>
  `SELECT tournament_year, stage, home_team, away_team, home_goals, away_goals FROM ${from} WHERE tournament_year = 2018 AND LOWER(stage) = 'final'`;

function sql(written: string, error?: string): CheckToolCall {
  return {
    name: 'run_readonly_sql',
    args: { sql: written, rationale: 'Why.' },
    argsReadable: true,
    ...(error === undefined ? { result: { rows: [] } } : { error }),
  };
}

const turn = (...toolCalls: CheckToolCall[]): CheckTurn => ({
  question: 'What was the score of the 2018 World Cup final?',
  answer: '…',
  toolCalls,
});

describe('usesEntities (R124, D2)', () => {
  it('passes when one query reads every table of the reference, however qualified', () => {
    expect(
      usesEntities.evaluate(
        turn(
          sql(
            'SELECT h.common_name, a.common_name, m.home_goals, m.away_goals FROM api.world_cup.matches m JOIN api.world_cup.tournaments t ON t.id = m.tournament_id JOIN api.world_cup.teams h ON h.id = m.home_team_id JOIN api.world_cup.teams a ON a.id = m.away_team_id JOIN api.world_cup.venues v ON v.id = m.venue_id',
          ),
        ),
        {},
        context,
      ),
    ).toEqual({ passed: true });
  });

  it('fails when the tables are split across queries, naming what the closest missed', () => {
    // The baseline's answer reported team ids: it never joined teams.
    expect(
      usesEntities.evaluate(
        turn(
          sql(
            'SELECT m.home_team_id, m.away_team_id FROM world_cup.matches m JOIN world_cup.tournaments t ON m.tournament_id = t.id',
          ),
          sql('SELECT common_name FROM world_cup.teams WHERE id = 6'),
        ),
        {},
        context,
      ),
    ).toEqual({
      passed: false,
      reason:
        'no single successful SQL reads every entity; the closest misses "teams"',
    });
  });

  it('takes its own entities, and fails a turn with no successful query', () => {
    expect(
      usesEntities.evaluate(
        turn(sql('SELECT 1 FROM world_cup.goals')),
        { entities: ['world_cup.goals'] },
        context,
      ).passed,
    ).toBe(true);
    expect(
      usesEntities.evaluate(
        turn(sql('SELECT 1 FROM world_cup.matches', 'boom')),
        {},
        context,
      ).reason,
    ).toBe('no successful run_readonly_sql to inspect');
  });

  it('counts a query on a view as reading the tables the view reads, however qualified (BA-188)', () => {
    for (const from of [
      'world_cup.v_match_results',
      'api.world_cup.v_match_results',
      '`evals`.world_cup.v_match_results',
    ]) {
      expect(
        usesEntities.evaluate(turn(sql(FROM_VIEW(from))), {}, withViews),
      ).toEqual({ passed: true });
    }
  });

  it('fails the same query as before when the sample has no views', () => {
    const before = {
      passed: false,
      reason:
        'no single successful SQL reads every entity; the closest misses "matches", "tournaments", "teams"',
    };
    const query = turn(sql(FROM_VIEW('world_cup.v_match_results')));
    expect(usesEntities.evaluate(query, {}, context)).toEqual(before);
    expect(
      usesEntities.evaluate(query, {}, { ...context, views: () => new Map() }),
    ).toEqual(before);
  });

  it('still fails a view that does not read a needed table', () => {
    expect(
      usesEntities.evaluate(
        turn(sql(FROM_VIEW('world_cup.v_match_results'))),
        { entities: ['goals', 'teams'] },
        withViews,
      ),
    ).toEqual({
      passed: false,
      reason:
        'no single successful SQL reads every entity; the closest misses "goals"',
    });
  });

  it('keeps a view among the entities: the query must read the view', () => {
    expect(
      usesEntities.evaluate(
        turn(
          sql(
            'SELECT 1 FROM world_cup.matches m JOIN world_cup.tournaments t ON t.id = m.tournament_id JOIN world_cup.venues v ON v.id = m.venue_id JOIN world_cup.teams h ON h.id = m.home_team_id',
          ),
        ),
        { entities: ['v_match_results'] },
        withViews,
      ).reason,
    ).toBe(
      'no single successful SQL reads every entity; the closest misses "v_match_results"',
    );
  });

  it('opens a view that a view reads, and stops on a cycle', () => {
    const nested: ViewTables = new Map([
      ['v_outer', ['v_inner', 'c']],
      ['v_inner', ['a', 'b']],
      ['v_loop', ['v_back']],
      ['v_back', ['v_loop', 'd']],
    ]);
    expect(readEntities('SELECT * FROM s.v_outer', nested)).toEqual(
      new Set(['v_outer', 'v_inner', 'c', 'a', 'b']),
    );
    expect(readEntities('SELECT * FROM s.v_loop', nested)).toEqual(
      new Set(['v_loop', 'v_back', 'd']),
    );
    expect(readEntities('SELECT * FROM s.v_outer', undefined)).toEqual(
      new Set(['v_outer']),
    );
  });

  it('describes the entities it expects', () => {
    expect(usesEntities.describe({}, context)).toBe(
      'Checks that one successful SQL query reads matches, tournaments, teams',
    );
  });

  it('is refused at load without entities on a case with no usable reference', () => {
    expect(usesEntities.validateCase?.({}, undefined)).toBe(
      '"usesEntities" needs args."entities" or a reference query to take them from',
    );
    expect(usesEntities.validateCase?.({}, { postgres: 'SELECT 1' })).toBe(
      '"usesEntities" needs args."entities": the reference query names no table',
    );
    expect(
      usesEntities.validateCase?.({}, { postgres: REFERENCE }),
    ).toBeUndefined();
    expect(
      usesEntities.validateCase?.({ entities: ['goals'] }, undefined),
    ).toBeUndefined();
  });
});
