import { findFixture } from '../../modules/testing-data/fixtures/registry';
import type { SampleFixture } from '../../modules/testing-data/fixtures/registry';
import { sampleViews, seedSampleOf, viewTablesFromSql } from './sample-views';

function fixture(id: string): SampleFixture {
  const found = findFixture(id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
}

describe('viewTablesFromSql (agents-evals R124)', () => {
  it('reads each view a script creates, with the names its definition reads', () => {
    const views = viewTablesFromSql(`
      CREATE TABLE a (id int);
      -- CREATE VIEW in_a_comment AS SELECT * FROM z;
      CREATE VIEW v_plain AS SELECT * FROM a JOIN s.b ON b.id = a.id;
      create or replace view s."V_Quoted" (x, y) as
        SELECT a.id, ';' AS semi /* ; */ FROM a, s.c -- ;
        WHERE a.id IN (SELECT id FROM d);
      CREATE MATERIALIZED VIEW IF NOT EXISTS s.v_cte AS
        WITH recent AS (SELECT * FROM e) SELECT * FROM recent JOIN v_plain USING (id);
      COMMENT ON VIEW v_plain IS 'CREATE VIEW nothing AS SELECT 1';
    `);
    expect(Object.fromEntries(views)).toEqual({
      v_plain: ['a', 'b'],
      v_quoted: ['a', 'c', 'd'],
      v_cte: ['e', 'v_plain'],
    });
  });

  it('reads nothing from a script without views', () => {
    expect(viewTablesFromSql('CREATE TABLE a (id int);').size).toBe(0);
  });
});

describe('seedSampleOf', () => {
  it('finds the seed that created a sample on every datasource kind', () => {
    for (const id of [
      'world-cup',
      'world-cup-rest',
      'world-cup-rest-connector',
      'world-cup-databricks',
    ]) {
      expect([id, seedSampleOf(fixture(id))?.id]).toEqual([id, 'world-cup']);
    }
    expect(seedSampleOf(fixture('finance-rest'))?.id).toBe('finance');
    expect(seedSampleOf(fixture('finance-databricks'))?.id).toBe('finance');
  });

  it('finds none for a REST sample that is not a copy of a seeded one', () => {
    // Same schema as `intellify`, but other tables: the RFP API's own.
    expect(seedSampleOf(fixture('intellify-api'))).toBeUndefined();
  });
});

describe('sampleViews', () => {
  it('reads the World Cup views from its seed, once for all its kinds', () => {
    const views = sampleViews('world-cup');
    expect(Object.fromEntries(views)).toEqual({
      v_match_results: ['matches', 'tournaments', 'venues', 'teams'],
      v_seeded_team_performance: [
        'matches',
        'tournaments',
        'teams',
        'countries',
        'confederations',
        'match_team_statistics',
      ],
      v_player_goal_totals: [
        'goals',
        'matches',
        'tournaments',
        'players',
        'teams',
      ],
    });
    for (const id of [
      'world-cup-rest',
      'world-cup-rest-connector',
      'world-cup-databricks',
    ]) {
      expect(sampleViews(id)).toBe(views);
    }
  });

  it('has no views for a sample whose seed creates none, has no seed, or cannot be read', () => {
    expect(sampleViews('marketing-analytics').size).toBe(0);
    expect(sampleViews('intellify-api').size).toBe(0);
    expect(sampleViews('no-such-sample').size).toBe(0);
    expect(sampleViews('world-cup', '/no/such/fixtures/dir').size).toBe(0);
  });
});
