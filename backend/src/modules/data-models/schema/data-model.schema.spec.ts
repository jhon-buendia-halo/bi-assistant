import {
  dataModelJsonSchema,
  validateAgainstSnapshot,
  validateDataModel,
} from './data-model.schema';
import { worldCupFixture } from '../dsl/__fixtures__/world-cup.fixture';
import type { DataModel, ModelIssue } from '../entities/data-model.entity';

/** Deep-clones the shared fixture so each test perturbs its own copy. */
function fixture(): DataModel {
  return structuredClone(worldCupFixture());
}

function issuePaths(issues: ModelIssue[]): string[] {
  return issues.map((issue) => issue.path);
}

/**
 * Asserts one issue's path/message without building an object literal
 * around `expect.stringContaining` (typed `any`) — that trips
 * `no-unsafe-assignment` at the property position, whereas passing it as a
 * bare matcher argument to `toEqual` does not.
 */
function expectIssue(
  issue: ModelIssue,
  path: string,
  messageContains: string,
): void {
  expect(issue.path).toBe(path);
  expect(issue.message).toEqual(expect.stringContaining(messageContains));
}

describe('validateDataModel — valid model', () => {
  it('accepts the World Cup fixture with no issues', () => {
    const result = validateDataModel(fixture());
    expect(result.issues).toEqual([]);
    expect(result.model).toEqual(fixture());
  });
});

describe('validateDataModel — Zod structural errors', () => {
  it('reports a wrong-typed field with a precise path', () => {
    const model = fixture() as unknown as Record<string, unknown>;
    model.version = 'not-a-number';
    const result = validateDataModel(model);
    expect(result.model).toBeUndefined();
    expect(issuePaths(result.issues)).toContain('version');
  });

  it('rejects an unknown top-level property (strict object)', () => {
    const model = { ...fixture(), extra: true };
    const result = validateDataModel(model);
    expect(result.model).toBeUndefined();
  });

  it('rejects a metric name that is not lower_snake_case', () => {
    const model = fixture();
    model.metrics[0].name = 'Avg Attendance';
    const result = validateDataModel(model);
    expect(result.model).toBeUndefined();
    expect(issuePaths(result.issues)).toContain('metrics[0].name');
  });

  it('rejects an unknown binding kind', () => {
    const model = fixture() as unknown as {
      entities: { bindings: unknown[] }[];
    };
    model.entities[0].bindings = [{ kind: 'graphql', datasource: 'x' }];
    const result = validateDataModel(model);
    expect(result.model).toBeUndefined();
  });
});

describe('validateDataModel — entity semantics', () => {
  it('flags a duplicate entity name (case-insensitive)', () => {
    const model = fixture();
    model.entities.push({ ...model.entities[0], name: 'TEAMS' });
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('entities[2].name');
  });

  it('flags an entity name with invalid characters', () => {
    const model = fixture();
    model.entities[0].name = 'teams!';
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('entities[0].name');
  });

  it('flags a duplicate attribute name (case-insensitive)', () => {
    const model = fixture();
    model.entities[0].attributes.push({ name: 'TEAM_ID', type: 'integer' });
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain(
      'entities[0].attributes[3].name',
    );
  });

  it('flags an attribute path with an invalid segment', () => {
    const model = fixture();
    model.entities[0].attributes[0].name = '1bad';
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain(
      'entities[0].attributes[0].name',
    );
  });

  it('accepts a nested array attribute path', () => {
    const model = fixture();
    model.entities[0].attributes.push({
      name: 'ratings[].score',
      type: 'number',
      role: 'measure',
    });
    const result = validateDataModel(model);
    expect(result.issues).toEqual([]);
  });

  it('flags a key entry that is not a declared attribute', () => {
    const model = fixture();
    model.entities[0].key = ['not_an_attribute'];
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('entities[0].key[0]');
  });
});

describe('validateDataModel — binding semantics', () => {
  it('flags a sql binding table without three segments', () => {
    const model = fixture();
    (model.entities[0].bindings[0] as { table: string }).table = 'public.teams';
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain(
      'entities[0].bindings[0].table',
    );
  });

  it('flags a binding column that maps an undeclared attribute', () => {
    const model = fixture();
    (
      model.entities[0].bindings[0] as { columns?: Record<string, string> }
    ).columns = { not_an_attribute: 'id' };
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain(
      'entities[0].bindings[0].columns.not_an_attribute',
    );
  });
});

describe('validateDataModel — relationship semantics', () => {
  it('flags a malformed reference (no dot)', () => {
    const model = fixture();
    model.relationships[0].from = 'matches';
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('relationships[0].from');
  });

  it('flags a reference to an unknown entity', () => {
    const model = fixture();
    model.relationships[0].to = 'players.team_id';
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('relationships[0].to');
  });

  it('flags a reference to an unknown attribute', () => {
    const model = fixture();
    model.relationships[0].from = 'matches.nope';
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('relationships[0].from');
  });
});

describe('validateDataModel — metric semantics', () => {
  it('flags an unknown metric entity', () => {
    const model = fixture();
    model.metrics[0].entity = 'players';
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('metrics[0].entity');
  });

  it('flags an unknown "of" attribute', () => {
    const model = fixture();
    model.metrics[0].of = 'nope';
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('metrics[0].of');
  });

  it('flags an unknown dimension attribute', () => {
    const model = fixture();
    model.metrics[0].dimensions = ['nope'];
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('metrics[0].dimensions[0]');
  });

  it('requires "of" for an aggregation other than count/ratio', () => {
    const model = fixture();
    delete model.metrics[0].of;
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('metrics[0].agg');
  });

  it('allows "count" without "of"', () => {
    const model = fixture();
    model.metrics[0].agg = 'count';
    delete model.metrics[0].of;
    const result = validateDataModel(model);
    expect(result.issues).toEqual([]);
  });

  it('requires numerator and denominator for a ratio metric', () => {
    const model = fixture();
    model.metrics.push({
      name: 'conversion',
      label: 'Conversion',
      entity: 'matches',
      agg: 'ratio',
    });
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toEqual(
      expect.arrayContaining([
        'metrics[2].numerator',
        'metrics[2].denominator',
      ]),
    );
  });

  it('rejects a ratio metric naming itself as an operand', () => {
    const model = fixture();
    model.metrics.push({
      name: 'conversion',
      label: 'Conversion',
      entity: 'matches',
      agg: 'ratio',
      numerator: 'conversion',
      denominator: 'avg_attendance',
    });
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('metrics[2].numerator');
  });

  it('rejects a ratio metric whose operand is not another metric', () => {
    const model = fixture();
    model.metrics.push({
      name: 'conversion',
      label: 'Conversion',
      entity: 'matches',
      agg: 'ratio',
      numerator: 'avg_attendance',
      denominator: 'does_not_exist',
    });
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('metrics[2].denominator');
  });

  it('accepts a ratio metric naming two other metrics', () => {
    const model = fixture();
    model.metrics.push({
      name: 'conversion',
      label: 'Conversion',
      entity: 'matches',
      agg: 'ratio',
      numerator: 'avg_attendance',
      denominator: 'avg_attendance',
    });
    const result = validateDataModel(model);
    expect(result.issues).toEqual([]);
  });

  it('requires agg or expressions.sql', () => {
    const model = fixture();
    delete model.metrics[1].expressions;
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('metrics[1]');
  });

  it('allows a metric with both agg and expressions.sql', () => {
    const model = fixture();
    model.metrics[1].agg = 'avg';
    model.metrics[1].of = 'attendance';
    const result = validateDataModel(model);
    expect(result.issues).toEqual([]);
  });
});

describe('dataModelJsonSchema', () => {
  it('targets JSON Schema draft 2020-12 with $defs for every DSL concept', () => {
    const schema = dataModelJsonSchema();
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    const defs = schema.$defs as Record<string, unknown>;
    for (const name of [
      'Entity',
      'Attribute',
      'Binding',
      'Relationship',
      'Metric',
      'Predicate',
    ]) {
      expect(defs[name]).toBeDefined();
    }
  });
});

describe('validateAgainstSnapshot', () => {
  const snapshot = [
    { table: 'main.public.teams', columns: ['id', 'common_name', 'fifa_code'] },
    {
      table: 'main.public.matches',
      columns: [
        'id',
        'home_team_id',
        'away_team_id',
        'winner_team_id',
        'stage',
        'attendance',
      ],
    },
  ];

  it('reports no drift when every bound attribute maps to a real column', () => {
    const result = validateDataModel(fixture());
    const issues = validateAgainstSnapshot(result.model!, snapshot);
    expect(issues).toEqual([]);
  });

  it('is case-insensitive on the table name', () => {
    const result = validateDataModel(fixture());
    const upper = snapshot.map((t) => ({ ...t, table: t.table.toUpperCase() }));
    expect(validateAgainstSnapshot(result.model!, upper)).toEqual([]);
  });

  it('flags a same-name attribute missing from the snapshot', () => {
    const result = validateDataModel(fixture());
    const dropped = [
      { ...snapshot[0] },
      {
        ...snapshot[1],
        columns: snapshot[1].columns.filter((c) => c !== 'stage'),
      },
    ];
    const issues = validateAgainstSnapshot(result.model!, dropped);
    expect(issues).toHaveLength(1);
    expectIssue(issues[0], 'entities[1].attributes[4].name', 'stage');
  });

  it('flags a mapped column missing from the snapshot, at the columns path', () => {
    const result = validateDataModel(fixture());
    const dropped = [
      {
        ...snapshot[0],
        columns: snapshot[0].columns.filter((c) => c !== 'id'),
      },
      snapshot[1],
    ];
    const issues = validateAgainstSnapshot(result.model!, dropped);
    expect(issues).toHaveLength(1);
    expectIssue(
      issues[0],
      'entities[0].bindings[0].columns.team_id',
      'team_id',
    );
  });

  it('flags a binding whose table is not part of the dataset at all (finding 5)', () => {
    const result = validateDataModel(fixture());
    const issues = validateAgainstSnapshot(result.model!, [snapshot[0]]);
    expect(issues).toHaveLength(1);
    expectIssue(
      issues[0],
      'entities[1].bindings[0].table',
      'is not part of dataset',
    );
  });

  it('is case-insensitive on a binding column override (finding 11)', () => {
    const result = validateDataModel(fixture());
    const model = structuredClone(result.model!);
    (
      model.entities[0].bindings[0] as { columns?: Record<string, string> }
    ).columns = { TEAM_ID: 'id', name: 'common_name' };
    expect(validateAgainstSnapshot(model, snapshot)).toEqual([]);
  });

  it('treats a rest binding like a sql one, using endpoint as the snapshot key', () => {
    const model = fixture();
    model.entities[0].bindings = [
      {
        kind: 'rest',
        datasource: 'ds',
        endpoint: 'main.public.teams',
        columns: { team_id: 'id', name: 'common_name' },
      },
    ];
    expect(validateAgainstSnapshot(model, snapshot)).toEqual([]);

    const dropped = [
      {
        ...snapshot[0],
        columns: snapshot[0].columns.filter((c) => c !== 'id'),
      },
      snapshot[1],
    ];
    const issues = validateAgainstSnapshot(model, dropped);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('entities[0].bindings[0].columns.team_id');
  });
});

describe('validateDataModel — entity binding requirement (finding 5)', () => {
  it('rejects an entity with no bindings at all', () => {
    const model = fixture();
    model.entities[0].bindings = [];
    const result = validateDataModel(model);
    expect(result.model).toBeUndefined();
    expect(issuePaths(result.issues)).toContain('entities[0].bindings');
  });
});

describe('validateDataModel — metric name uniqueness (finding 5)', () => {
  it('flags a duplicate metric name, case-insensitive', () => {
    const model = fixture();
    model.metrics.push({ ...model.metrics[0], name: 'AVG_ATTENDANCE' });
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('metrics[2].name');
  });
});

describe('validateDataModel — metric where-clause attributes (finding 5)', () => {
  it('flags a where-clause attr that does not resolve on the metric entity', () => {
    const model = fixture();
    model.metrics[0].where = { attr: 'nope', op: 'eq', value: 1 };
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain('metrics[0].where.attr');
  });

  it('walks and/or/not to find a bad attr nested in the predicate tree', () => {
    const model = fixture();
    model.metrics[0].where = {
      and: [
        { attr: 'attendance', op: 'gt', value: 0 },
        { not: { attr: 'nope', op: 'is_null' } },
      ],
    };
    const result = validateDataModel(model);
    expect(issuePaths(result.issues)).toContain(
      'metrics[0].where.and[1].not.attr',
    );
  });

  it('accepts a where-clause whose attrs all resolve', () => {
    const model = fixture();
    model.metrics[0].where = { attr: 'attendance', op: 'gt', value: 0 };
    const result = validateDataModel(model);
    expect(result.issues).toEqual([]);
  });
});
