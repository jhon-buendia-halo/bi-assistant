import { worldCupFixture } from '../dsl/__fixtures__/world-cup.fixture';
import { composeSessionModel } from '../session-model';
import {
  resolveLogicalQuery,
  logicalQuerySchema,
  parseLogicalQuery,
} from './logical-query';
import type { LogicalQuery } from './logical-query';

const model = composeSessionModel([
  { dataset: 'World Cup Core', model: worldCupFixture() },
]);

describe('logicalQuerySchema / parseLogicalQuery', () => {
  it('defaults limit to 100', () => {
    const parsed = parseLogicalQuery({
      from: 'matches',
      select: [{ attr: 'stage' }],
    });
    expect(parsed.limit).toBe(100);
  });

  it('rejects an ad-hoc select item with agg "ratio" (ratios only exist as named metrics)', () => {
    expect(() =>
      logicalQuerySchema.parse({
        from: 'matches',
        select: [{ agg: 'ratio', alias: 'bad_ratio' }],
      }),
    ).toThrow();
  });

  it('rejects an unrecognised top-level field (strict object)', () => {
    expect(() =>
      logicalQuerySchema.parse({
        from: 'matches',
        select: [{ attr: 'stage' }],
        sql: 'SELECT 1',
      }),
    ).toThrow();
  });
});

describe('resolveLogicalQuery', () => {
  function resolve(query: LogicalQuery) {
    return resolveLogicalQuery(model, query);
  }

  it('resolves a plain select against the root entity', () => {
    const result = resolve({
      from: 'matches',
      select: [{ attr: 'stage' }],
      limit: 10,
    });
    expect(result.ok).toBe(true);
  });

  it('fails with unknown_entity for an unknown "from"', () => {
    const result = resolve({
      from: 'nope',
      select: [{ attr: 'x' }],
      limit: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe('unknown_entity');
  });

  it('fails with unknown_metric when the metric name does not exist', () => {
    const result = resolve({
      from: 'matches',
      select: [{ metric: 'nope' }],
      limit: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe('unknown_metric');
  });

  it('auto-fills group_by from plain attributes when mixed with an aggregation, and notes it', () => {
    const result = resolve({
      from: 'matches',
      select: [{ attr: 'stage' }, { metric: 'avg_attendance' }],
      limit: 10,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query.groupBy.map((g) => g.ref.attribute.name)).toEqual([
        'stage',
      ]);
      expect(
        result.query.notes.some((n) => n.includes('group_by inferred')),
      ).toBe(true);
    }
  });

  it('rejects order_by naming something that is neither a select alias nor a known attribute', () => {
    const result = resolve({
      from: 'matches',
      select: [{ attr: 'stage' }],
      order_by: [{ by: 'not_a_real_thing' }],
      limit: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe('unknown_attribute');
  });

  it('accepts order_by naming an attribute ref not present in select', () => {
    const result = resolve({
      from: 'matches',
      select: [{ attr: 'stage' }],
      order_by: [{ by: 'attendance' }],
      limit: 10,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query.orderBy).toEqual([
        {
          kind: 'ref',
          ref: expect.objectContaining({ alias: 'matches' }) as unknown,
          dir: 'asc',
        },
      ]);
    }
  });

  it('accepts order_by naming a select alias', () => {
    const result = resolve({
      from: 'matches',
      select: [{ attr: 'stage', alias: 'phase' }],
      order_by: [{ by: 'phase', dir: 'desc' }],
      limit: 10,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an ad-hoc agg other than count with no "of"', () => {
    const result = resolve({
      from: 'matches',
      select: [{ agg: 'avg', alias: 'bad' }],
      limit: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe('invalid_select');
  });
});

describe('resolveLogicalQuery — scope lookups by alias (second hop off an aliased join, self-joins)', () => {
  function modelWithCountryAndHierarchy() {
    const base = worldCupFixture();
    return composeSessionModel([
      {
        dataset: 'World Cup Core',
        model: {
          ...base,
          entities: [
            ...base.entities,
            {
              name: 'countries',
              label: 'Countries',
              key: ['country_id'],
              bindings: [
                {
                  kind: 'sql' as const,
                  datasource: 'world-cup',
                  table: 'main.public.countries',
                  columns: {},
                },
              ],
              attributes: [
                {
                  name: 'country_id',
                  type: 'integer' as const,
                  role: 'key' as const,
                },
                {
                  name: 'name',
                  type: 'string' as const,
                  role: 'dimension' as const,
                },
              ],
            },
          ].map((e) =>
            e.name === 'teams'
              ? {
                  ...e,
                  attributes: [
                    ...e.attributes,
                    { name: 'country_id', type: 'integer' as const },
                    {
                      name: 'parent_team_id',
                      type: 'integer' as const,
                      nullable: true,
                    },
                  ],
                }
              : e,
          ),
          relationships: [
            ...base.relationships,
            {
              from: 'teams.country_id',
              to: 'countries.country_id',
              cardinality: 'many_to_one' as const,
              source: 'declared' as const,
            },
            {
              name: 'team_parent',
              from: 'teams.parent_team_id',
              to: 'teams.team_id',
              cardinality: 'many_to_one' as const,
              source: 'declared' as const,
            },
          ],
        },
      },
    ]);
  }

  it('reaches a second hop off a join that was given a custom alias', () => {
    const extended = modelWithCountryAndHierarchy();
    const result = resolveLogicalQuery(extended, {
      from: 'matches',
      joins: [
        { via: 'matches.home_team_id->teams.team_id', as: 'home_team' },
        {
          via: 'teams.country_id->countries.country_id',
          as: 'home_country',
        },
      ],
      select: [{ attr: 'home_country.name', alias: 'home_country_name' }],
      limit: 10,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const countryJoin = result.query.joins.find(
        (j) => j.alias === 'home_country',
      );
      expect(countryJoin?.scopeAlias).toBe('home_team');
    }
  });

  it('rejects a self-join without a distinct alias', () => {
    const extended = modelWithCountryAndHierarchy();
    const result = resolveLogicalQuery(extended, {
      from: 'teams',
      joins: [{ via: 'team_parent' }],
      select: [{ attr: 'name' }],
      limit: 10,
    });
    expect(result.ok).toBe(false);
  });

  it('resolves a self-join given a distinct alias', () => {
    const extended = modelWithCountryAndHierarchy();
    const result = resolveLogicalQuery(extended, {
      from: 'teams',
      joins: [{ via: 'team_parent', as: 'parent_team' }],
      select: [
        { attr: 'name', alias: 'team_name' },
        { attr: 'parent_team.name', alias: 'parent_team_name' },
      ],
      limit: 10,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const selfJoin = result.query.joins.find(
        (j) => j.alias === 'parent_team',
      );
      expect(selfJoin?.scopeAlias).toBe('teams');
      expect(selfJoin?.scopeSide).toBe('from');
    }
  });
});
