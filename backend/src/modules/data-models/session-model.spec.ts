import { worldCupFixture } from './dsl/__fixtures__/world-cup.fixture';
import { composeSessionModel, renderModelBlock } from './session-model';
import type { DataModel } from './entities/data-model.entity';

const BANNED_WORDS = [
  'catalog',
  'schema',
  'postgres',
  'postgresql',
  'databricks',
  'sqlite',
  'sql dialect',
  'main.public',
];

describe('composeSessionModel', () => {
  it('keeps a unique entity name as-is, with its dataset and relationships/metrics attached', () => {
    const model = composeSessionModel([
      { dataset: 'World Cup Core', model: worldCupFixture() },
    ]);
    const matches = model.entities.find((e) => e.name === 'matches');
    expect(matches).toBeDefined();
    expect(matches?.qualified).toBe(false);
    expect(matches?.datasets).toEqual(['World Cup Core']);
    expect(matches?.table).toBe('main.public.matches');
    expect(matches?.columns['match_id']).toBe('id');
    expect(model.relationships).toHaveLength(1);
    expect(model.metrics.map((m) => m.name)).toEqual(
      expect.arrayContaining(['avg_attendance', 'home_win_rate']),
    );
  });

  it('dedupes the same entity name into one, remembering every contributing dataset, when every binding points at the same physical table', () => {
    const model = composeSessionModel([
      { dataset: 'World Cup A', model: worldCupFixture() },
      { dataset: 'World Cup B', model: worldCupFixture() },
    ]);
    const matches = model.entities.filter((e) => e.name === 'matches');
    expect(matches).toHaveLength(1);
    expect(matches[0].datasets.sort()).toEqual(['World Cup A', 'World Cup B']);
    expect(matches[0].qualified).toBe(false);
  });

  it('qualifies both copies as <dataset>__<entity> when the same logical name binds different tables, and records a note', () => {
    const second: DataModel = {
      ...worldCupFixture(),
      model: 'other',
      entities: worldCupFixture().entities.map((e) =>
        e.name === 'matches'
          ? {
              ...e,
              bindings: [
                {
                  kind: 'sql',
                  datasource: 'other-ds',
                  table: 'other.public.fixtures',
                },
              ],
            }
          : e,
      ),
    };
    const model = composeSessionModel([
      { dataset: 'World Cup A', model: worldCupFixture() },
      { dataset: 'Other Fixtures', model: second },
    ]);
    const names = model.entities.map((e) => e.name).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        'world_cup_a__matches',
        'other_fixtures__matches',
      ]),
    );
    expect(model.entities.every((e) => e.name !== 'matches')).toBe(true);
    expect(model.notes.some((n) => n.includes('matches'))).toBe(true);
  });

  it("rewrites a ratio metric's numerator/denominator when the operand metric it names was itself qualified on collision", () => {
    const datasetB: DataModel = {
      ...worldCupFixture(),
      model: 'world_cup_b',
      metrics: [
        // Same name as dataset A's metric, but on a different entity — this
        // is what forces "avg_attendance" to be qualified for dataset B.
        {
          name: 'avg_attendance',
          label: 'Average attendance (teams)',
          entity: 'teams',
          agg: 'count',
        },
        {
          name: 'b_ratio',
          label: 'B ratio',
          entity: 'teams',
          agg: 'ratio',
          numerator: 'avg_attendance',
          denominator: 'avg_attendance',
        },
      ],
    };
    const model = composeSessionModel([
      { dataset: 'World Cup A', model: worldCupFixture() },
      { dataset: 'World Cup B', model: datasetB },
    ]);
    const bRatio = model.metrics.find((m) => m.name === 'b_ratio');
    expect(bRatio).toBeDefined();
    expect(bRatio?.numerator).toBe('world_cup_b__avg_attendance');
    expect(bRatio?.denominator).toBe('world_cup_b__avg_attendance');
    expect(
      model.metrics.some((m) => m.name === 'world_cup_b__avg_attendance'),
    ).toBe(true);
  });

  it('skips entities with no sql/rest binding (mongo/file are not queryable in the beta)', () => {
    const withMongo: DataModel = {
      ...worldCupFixture(),
      entities: [
        ...worldCupFixture().entities,
        {
          name: 'players',
          bindings: [
            { kind: 'mongo', datasource: 'mongo-ds', collection: 'players' },
          ],
          attributes: [{ name: 'player_id', type: 'integer', role: 'key' }],
        },
      ],
    };
    const model = composeSessionModel([
      { dataset: 'World Cup', model: withMongo },
    ]);
    expect(model.entities.some((e) => e.name === 'players')).toBe(false);
  });
});

describe('renderModelBlock', () => {
  const block = renderModelBlock(
    composeSessionModel([
      { dataset: 'World Cup Core', model: worldCupFixture() },
    ]),
  );

  it('names dataset, keys, attributes (with role/type/samples) and metrics, never physical identifiers or dialect words', () => {
    expect(block).toContain('matches (dataset "World Cup Core")');
    expect(block).toContain('key: match_id');
    expect(block).toContain('attendance measure integer');
    expect(block).toContain('[e.g. 64000, 72000, 45000]');
    expect(block).toContain(
      'avg_attendance (Average attendance) = avg(attendance)',
    );
    expect(block).toContain(
      'via matches.home_team_id->teams.team_id (many_to_one, named "matches_home_team")',
    );
    for (const word of BANNED_WORDS) {
      expect(block.toLowerCase()).not.toContain(word);
    }
  });

  it('renders an expressions.sql metric as "(custom expression)", never the raw SQL text', () => {
    expect(block).toContain(
      'home_win_rate (Home win rate) = (custom expression)',
    );
    expect(block).not.toContain('avg(case when');
  });

  it('drops samples, then descriptions, then truncates entities to stay within budget', () => {
    const model = composeSessionModel([
      { dataset: 'World Cup Core', model: worldCupFixture() },
    ]);
    const withoutSamples = renderModelBlock(model, { budgetChars: 400 });
    expect(withoutSamples).not.toContain('[e.g.');

    const tiny = renderModelBlock(model, { budgetChars: 60 });
    expect(tiny).toContain('more entities; call describe_entity');
  });
});
