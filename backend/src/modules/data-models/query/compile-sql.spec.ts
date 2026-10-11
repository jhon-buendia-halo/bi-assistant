import { worldCupFixture } from '../dsl/__fixtures__/world-cup.fixture';
import { composeSessionModel } from '../session-model';
import {
  compileLogicalQuery,
  LogicalQueryError,
  type SqlDialect,
} from './compile-sql';
import type { LogicalQuery } from './logical-query';

const model = composeSessionModel([
  { dataset: 'World Cup Core', model: worldCupFixture() },
]);

function compile(query: LogicalQuery, dialect: SqlDialect = 'postgres') {
  return compileLogicalQuery(model, query, dialect);
}

/** The shared fixture has no date/datetime attribute (every other spec in
 * this module enumerates its exact attribute list) — bucket tests need one,
 * so they get their own locally-extended model rather than growing the
 * shared fixture and rippling into unrelated snapshot/reference tests. */
function modelWithDate() {
  const base = worldCupFixture();
  const matches = base.entities.find((e) => e.name === 'matches')!;
  return composeSessionModel([
    {
      dataset: 'World Cup Core',
      model: {
        ...base,
        entities: base.entities.map((e) =>
          e === matches
            ? {
                ...e,
                attributes: [
                  ...e.attributes,
                  { name: 'kickoff_date', type: 'datetime' as const },
                ],
              }
            : e,
        ),
      },
    },
  ]);
}

describe('compileLogicalQuery — golden SQL per dialect', () => {
  it('plain select', () => {
    const query: LogicalQuery = {
      from: 'matches',
      select: [{ attr: 'stage' }, { attr: 'attendance' }],
      limit: 10,
    };
    expect(compile(query, 'postgres').sql).toBe(
      'SELECT "matches"."stage" AS "stage", "matches"."attendance" AS "attendance" FROM "public"."matches" AS "matches" LIMIT 10',
    );
    expect(compile(query, 'databricks').sql).toBe(
      'SELECT `matches`.`stage` AS `stage`, `matches`.`attendance` AS `attendance` FROM `main`.`public`.`matches` AS `matches` LIMIT 10',
    );
    expect(compile(query, 'sqlite').sql).toBe(
      'SELECT "matches"."stage" AS "stage", "matches"."attendance" AS "attendance" FROM "main.public.matches" AS "matches" LIMIT 10',
    );
  });

  it('a model metric', () => {
    const query: LogicalQuery = {
      from: 'matches',
      select: [{ metric: 'avg_attendance' }],
      limit: 100,
    };
    expect(compile(query).sql).toBe(
      'SELECT AVG("matches"."attendance") AS "avg_attendance" FROM "public"."matches" AS "matches" LIMIT 100',
    );
  });

  it('ad-hoc aggregation with a where', () => {
    const query: LogicalQuery = {
      from: 'matches',
      select: [
        { attr: 'stage' },
        {
          agg: 'avg',
          of: 'attendance',
          alias: 'final_avg_attendance',
          where: { attr: 'stage', op: 'eq', value: 'Final' },
        },
      ],
      limit: 100,
    };
    expect(compile(query).sql).toBe(
      'SELECT "matches"."stage" AS "stage", ' +
        'AVG(CASE WHEN "matches"."stage" = \'Final\' THEN "matches"."attendance" END) AS "final_avg_attendance" ' +
        'FROM "public"."matches" AS "matches" GROUP BY "matches"."stage" LIMIT 100',
    );
  });

  it('join via an explicit relationship', () => {
    const query: LogicalQuery = {
      from: 'matches',
      joins: [{ via: 'matches.home_team_id->teams.team_id', as: 'home_team' }],
      select: [
        { attr: 'home_team.name', alias: 'home_team_name' },
        { attr: 'stage' },
      ],
      limit: 50,
    };
    expect(compile(query).sql).toBe(
      'SELECT "home_team"."common_name" AS "home_team_name", "matches"."stage" AS "stage" ' +
        'FROM "public"."matches" AS "matches" ' +
        'JOIN "public"."teams" AS "home_team" ON "matches"."home_team_id" = "home_team"."id" ' +
        'LIMIT 50',
    );
  });

  it('auto-path: a bare entity-qualified attribute reaches the one declared relationship without an explicit join', () => {
    const query: LogicalQuery = {
      from: 'matches',
      select: [{ attr: 'teams.name', alias: 'team_name' }],
      limit: 50,
    };
    const compiled = compile(query);
    expect(compiled.sql).toBe(
      'SELECT "teams"."common_name" AS "team_name" FROM "public"."matches" AS "matches" ' +
        'JOIN "public"."teams" AS "teams" ON "matches"."home_team_id" = "teams"."id" LIMIT 50',
    );
    expect(compiled.notes.some((n) => n.includes('auto-joined'))).toBe(true);
  });

  it('buckets kickoff_date by year/quarter/week, per dialect', () => {
    const withDate = modelWithDate();
    const compileDate = (query: LogicalQuery, dialect: SqlDialect) =>
      compileLogicalQuery(withDate, query, dialect);

    const yearQuery: LogicalQuery = {
      from: 'matches',
      select: [{ attr: 'kickoff_date', bucket: 'year', alias: 'kickoff_year' }],
      limit: 10,
    };
    expect(compileDate(yearQuery, 'postgres').sql).toContain(
      'EXTRACT(YEAR FROM "matches"."kickoff_date")::int AS "kickoff_year"',
    );
    expect(compileDate(yearQuery, 'databricks').sql).toContain(
      'year(`matches`.`kickoff_date`) AS `kickoff_year`',
    );
    expect(compileDate(yearQuery, 'sqlite').sql).toContain(
      'CAST(strftime(\'%Y\', "matches"."kickoff_date") AS INTEGER) AS "kickoff_year"',
    );

    const quarterQuery: LogicalQuery = {
      from: 'matches',
      select: [
        { attr: 'kickoff_date', bucket: 'quarter', alias: 'kickoff_quarter' },
      ],
      limit: 10,
    };
    expect(compileDate(quarterQuery, 'postgres').sql).toContain(
      'date_trunc(\'quarter\', "matches"."kickoff_date")::date AS "kickoff_quarter"',
    );
    expect(compileDate(quarterQuery, 'databricks').sql).toContain(
      "date_trunc('QUARTER', `matches`.`kickoff_date`) AS `kickoff_quarter`",
    );
    expect(compileDate(quarterQuery, 'sqlite').sql).toContain(
      'strftime(\'%Y\', "matches"."kickoff_date") || \'-Q\' ||',
    );

    const weekQuery: LogicalQuery = {
      from: 'matches',
      select: [{ attr: 'kickoff_date', bucket: 'week', alias: 'kickoff_week' }],
      limit: 10,
    };
    expect(compileDate(weekQuery, 'postgres').sql).toContain(
      'date_trunc(\'week\', "matches"."kickoff_date")::date AS "kickoff_week"',
    );
    expect(compileDate(weekQuery, 'databricks').sql).toContain(
      "date_trunc('WEEK', `matches`.`kickoff_date`) AS `kickoff_week`",
    );
    expect(compileDate(weekQuery, 'sqlite').sql).toContain(
      'date("matches"."kickoff_date", \'weekday 0\', \'-6 days\') AS "kickoff_week"',
    );
  });

  it('rejects a bucket on a non-date attribute', () => {
    const query: LogicalQuery = {
      from: 'matches',
      select: [{ attr: 'attendance', bucket: 'year', alias: 'bad' }],
      limit: 10,
    };
    try {
      compile(query);
      throw new Error('expected compile to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LogicalQueryError);
      expect((err as LogicalQueryError).issues[0].code).toBe(
        'bucket_on_non_date',
      );
    }
  });

  it('groups by the bucket expression, not the raw column, when group_by is auto-filled', () => {
    const query: LogicalQuery = {
      from: 'matches',
      select: [
        { attr: 'kickoff_date', bucket: 'month', alias: 'month' },
        { metric: 'avg_attendance' },
      ],
      limit: 10,
    };
    const sql = compileLogicalQuery(modelWithDate(), query, 'postgres').sql;
    expect(sql).toContain(
      'GROUP BY date_trunc(\'month\', "matches"."kickoff_date")::date',
    );
  });

  it('group_by may reference a select alias, reusing its bucket', () => {
    const query: LogicalQuery = {
      from: 'matches',
      select: [
        { attr: 'kickoff_date', bucket: 'month', alias: 'month' },
        { metric: 'avg_attendance' },
      ],
      group_by: ['month'],
      limit: 10,
    };
    const sql = compileLogicalQuery(modelWithDate(), query, 'postgres').sql;
    expect(sql).toContain(
      'GROUP BY date_trunc(\'month\', "matches"."kickoff_date")::date',
    );
  });

  it('limits default to 100 and are always appended', () => {
    const query: LogicalQuery = {
      from: 'matches',
      select: [{ attr: 'stage' }],
      limit: 100,
    };
    expect(compile(query).sql).toMatch(/LIMIT 100$/);
  });

  it('escapes string literals', () => {
    const query: LogicalQuery = {
      from: 'matches',
      select: [{ attr: 'stage' }],
      where: { attr: 'stage', op: 'eq', value: "Round of 16's" },
      limit: 10,
    };
    expect(compile(query).sql).toContain(`'Round of 16''s'`);
  });

  it('rejects an unknown attribute before any database call', () => {
    const query: LogicalQuery = {
      from: 'matches',
      select: [{ attr: 'nope' }],
      limit: 10,
    };
    expect(() => compile(query)).toThrow(LogicalQueryError);
    try {
      compile(query);
    } catch (err) {
      expect(err).toBeInstanceOf(LogicalQueryError);
      expect((err as LogicalQueryError).issues[0].code).toBe(
        'unknown_attribute',
      );
    }
  });

  it('rejects an undeclared relationship path (ambiguous or absent)', () => {
    const query: LogicalQuery = {
      from: 'matches',
      select: [{ attr: 'nonexistent_entity.name' }],
      limit: 10,
    };
    expect(() => compile(query)).toThrow(LogicalQueryError);
  });
});

describe('compileLogicalQuery — ratio, ambiguous path, fan-out guard', () => {
  function modelWithExtras() {
    const base = worldCupFixture();
    return composeSessionModel([
      {
        dataset: 'World Cup Core',
        model: {
          ...base,
          relationships: [
            ...base.relationships,
            // A second relationship between the same two entities — any
            // dotted reference to "teams" from "matches" is now ambiguous.
            {
              from: 'matches.away_team_id',
              to: 'teams.team_id',
              cardinality: 'many_to_one',
              source: 'declared',
            },
            // The reverse direction, one_to_many from teams -> matches —
            // selecting a plain match attribute through it must be rejected.
            {
              from: 'teams.team_id',
              to: 'matches.home_team_id',
              cardinality: 'one_to_many',
              source: 'declared',
              name: 'team_home_matches',
            },
          ],
          metrics: [
            ...base.metrics,
            {
              name: 'home_win_share',
              label: 'Home win share',
              entity: 'matches',
              agg: 'ratio',
              numerator: 'avg_attendance',
              denominator: 'avg_attendance',
            },
          ],
        },
      },
    ]);
  }

  it('compiles a ratio metric as numerator / NULLIF(denominator, 0)', () => {
    const extras = modelWithExtras();
    const sql = compileLogicalQuery(
      extras,
      { from: 'matches', select: [{ metric: 'home_win_share' }], limit: 10 },
      'postgres',
    ).sql;
    expect(sql).toBe(
      'SELECT (AVG("matches"."attendance")) * 1.0 / NULLIF(AVG("matches"."attendance"), 0) AS "home_win_share" ' +
        'FROM "public"."matches" AS "matches" LIMIT 10',
    );
  });

  it('rejects an auto-path attribute reference when two relationships connect the same entities', () => {
    const extras = modelWithExtras();
    expect(() =>
      compileLogicalQuery(
        extras,
        { from: 'matches', select: [{ attr: 'teams.name' }], limit: 10 },
        'postgres',
      ),
    ).toThrow(LogicalQueryError);
    try {
      compileLogicalQuery(
        extras,
        { from: 'matches', select: [{ attr: 'teams.name' }], limit: 10 },
        'postgres',
      );
    } catch (err) {
      expect((err as LogicalQueryError).issues[0].code).toBe('ambiguous_path');
    }
  });

  it('allows plain attributes selected through a one_to_many join (not itself a fan-out bug)', () => {
    const extras = modelWithExtras();
    const compiled = compileLogicalQuery(
      extras,
      {
        from: 'teams',
        joins: [{ via: 'team_home_matches', as: 'home_matches' }],
        select: [{ attr: 'name' }, { attr: 'home_matches.stage' }],
        limit: 10,
      },
      'postgres',
    );
    expect(compiled.sql).toContain('"teams"."common_name"');
  });

  it('rejects an aggregate computed on the "one" side of a one_to_many join (fan-out guard)', () => {
    const extras = modelWithExtras();
    const query: LogicalQuery = {
      from: 'teams',
      joins: [{ via: 'team_home_matches', as: 'home_matches' }],
      select: [
        { agg: 'count_distinct', of: 'name', alias: 'distinct_team_names' },
      ],
      limit: 10,
    };
    expect(() => compileLogicalQuery(extras, query, 'postgres')).toThrow(
      LogicalQueryError,
    );
    try {
      compileLogicalQuery(extras, query, 'postgres');
    } catch (err) {
      expect((err as LogicalQueryError).issues[0].code).toBe('fan_out');
    }
  });

  it('allows an aggregate/metric computed on the "many" side of a one_to_many join', () => {
    const extras = modelWithExtras();
    const compiled = compileLogicalQuery(
      extras,
      {
        from: 'teams',
        joins: [{ via: 'team_home_matches', as: 'home_matches' }],
        select: [{ attr: 'name' }, { metric: 'avg_attendance' }],
        limit: 10,
      },
      'postgres',
    );
    expect(compiled.sql).toContain('AVG("home_matches"."attendance")');
  });
});
