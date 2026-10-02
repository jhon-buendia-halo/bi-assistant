import {
  bootstrapFromSnapshot,
  deriveEntityNames,
  inferAttributeType,
  mapDimensionNames,
  safeName,
} from './bootstrap';
import type {
  DatasetDoc,
  DatasetEntitySnapshot,
} from '../datasets/repositories/datasets.repository';
import type { MetricDoc } from '../metrics/entities/metric.entity';
import type { Attribute } from './entities/data-model.entity';

const MATCHES_KEY = 'world_cup.world_cup.matches';
const TEAMS_KEY = 'world_cup.world_cup.teams';

const matches: DatasetEntitySnapshot = {
  key: MATCHES_KEY,
  columns: [
    { name: 'match_id', type: 'bigint', nullable: false },
    {
      name: 'home_team_id',
      type: 'bigint',
      nullable: false,
      references: { entity: TEAMS_KEY, column: 'team_id', source: 'declared' },
    },
    { name: 'match_date', type: 'date', nullable: false },
    {
      name: 'attendance',
      type: 'integer',
      nullable: true,
      sampleValues: ['42000', '38000'],
    },
    {
      name: 'IsFinal',
      type: 'boolean',
      nullable: false,
      sampleValues: ['true', 'false'],
    },
  ],
};

const teams: DatasetEntitySnapshot = {
  key: TEAMS_KEY,
  columns: [
    { name: 'team_id', type: 'bigint', nullable: false },
    { name: 'name', type: 'text', nullable: false },
  ],
};

function dataset(overrides: Partial<DatasetDoc> = {}): DatasetDoc {
  return {
    name: 'World Cup Core',
    datasourceId: 'ds-1',
    datasourceKind: 'postgres',
    tables: [MATCHES_KEY, TEAMS_KEY],
    entities: [matches, teams],
    ...overrides,
  };
}

describe('inferAttributeType', () => {
  it.each([
    ['bigint', 'integer'],
    ['integer', 'integer'],
    ['smallint', 'integer'],
    ['serial', 'integer'],
    ['numeric(10,2)', 'number'],
    ['double precision', 'number'],
    ['boolean', 'boolean'],
    ['timestamp without time zone', 'datetime'],
    ['datetime', 'datetime'],
    ['date', 'date'],
    ['time', 'time'],
    ['json', 'json'],
    ['text', 'string'],
    ['varchar(255)', 'string'],
    ['uuid', 'string'],
    ['money', 'number'],
    ['interval', 'unknown'],
    ['', 'unknown'],
  ])('maps %s -> %s', (raw, expected) => {
    expect(inferAttributeType(raw)).toBe(expected);
  });
});

describe('deriveEntityNames', () => {
  it('uses the lowercase last segment of the table key', () => {
    const names = deriveEntityNames([matches, teams]);

    expect(names.get(MATCHES_KEY)).toBe('matches');
    expect(names.get(TEAMS_KEY)).toBe('teams');
  });

  it('prefixes the schema on a collision between two tables of the same name', () => {
    const a: DatasetEntitySnapshot = { key: 'main.sales.orders', columns: [] };
    const b: DatasetEntitySnapshot = {
      key: 'main.finance.orders',
      columns: [],
    };

    const names = deriveEntityNames([a, b]);

    expect(names.get('main.sales.orders')).toBe('sales_orders');
    expect(names.get('main.finance.orders')).toBe('finance_orders');
  });
});

describe('mapDimensionNames', () => {
  const attributes: Attribute[] = [
    { name: 'month', type: 'string' },
    { name: 'provider', type: 'string' },
  ];

  it('maps a matching dimension to its attribute name, case-insensitively', () => {
    expect(mapDimensionNames(['MONTH'], attributes)).toEqual(['month']);
  });

  it('drops an unmatched dimension rather than keeping it verbatim', () => {
    expect(mapDimensionNames(['region'], attributes)).toEqual([]);
  });
});

describe('safeName', () => {
  it('lowercases and replaces invalid characters with a single underscore', () => {
    expect(safeName('Match Date')).toBe('match_date');
    expect(safeName('match--date')).toBe('match_date');
  });

  it('prefixes c_ when the result would not start with a letter', () => {
    expect(safeName('2024_total')).toBe('c_2024_total');
  });
});

describe('bootstrapFromSnapshot', () => {
  it('builds sql bindings, typed attributes with samples, and a declared relationship', () => {
    const { model, issues } = bootstrapFromSnapshot(dataset(), [], 1);

    expect(issues).toEqual([]);
    expect(model.model).toBe('World Cup Core');
    expect(model.version).toBe(1);

    const matchesEntity = model.entities.find((e) => e.name === 'matches');
    const teamsEntity = model.entities.find((e) => e.name === 'teams');
    expect(matchesEntity).toBeDefined();
    expect(teamsEntity).toBeDefined();
    expect(matchesEntity!.bindings[0]).toMatchObject({
      kind: 'sql',
      datasource: 'ds-1',
      table: MATCHES_KEY,
    });

    const attendance = matchesEntity!.attributes.find(
      (a) => a.name === 'attendance',
    );
    expect(attendance).toMatchObject({
      type: 'integer',
      role: 'measure',
      nullable: true,
      samples: [42000, 38000],
    });

    const isFinal = matchesEntity!.attributes.find((a) => a.name === 'isfinal');
    expect(isFinal).toMatchObject({ type: 'boolean', samples: [true, false] });
    // `columns` override is only emitted when the physical name differs.
    expect(matchesEntity!.bindings[0]).toMatchObject({
      columns: { isfinal: 'IsFinal' },
    });

    const homeTeam = matchesEntity!.attributes.find(
      (a) => a.name === 'home_team_id',
    );
    expect(homeTeam?.role).toBe('key');

    const rel = model.relationships.find(
      (r) => r.from === 'matches.home_team_id' && r.to === 'teams.team_id',
    );
    expect(rel).toMatchObject({
      cardinality: 'many_to_one',
      source: 'declared',
    });
  });

  it('falls back to datasource "default" when the dataset has none on record', () => {
    const { model } = bootstrapFromSnapshot(
      dataset({ datasourceId: undefined }),
      [],
      1,
    );

    expect(model.entities[0].bindings[0]).toMatchObject({
      datasource: 'default',
    });
  });

  it('derives the key as [id] or [<singular entity>_id]', () => {
    const withId: DatasetEntitySnapshot = {
      key: 'main.public.teams',
      columns: [{ name: 'id', type: 'bigint', nullable: false }],
    };
    const withSingular: DatasetEntitySnapshot = {
      key: 'main.public.matches',
      columns: [{ name: 'match_id', type: 'bigint', nullable: false }],
    };
    const withNeither: DatasetEntitySnapshot = {
      key: 'main.public.logs',
      columns: [{ name: 'note', type: 'text', nullable: true }],
    };

    const { model } = bootstrapFromSnapshot(
      dataset({
        tables: [withId.key, withSingular.key, withNeither.key],
        entities: [withId, withSingular, withNeither],
      }),
      [],
      1,
    );

    expect(model.entities.find((e) => e.name === 'teams')?.key).toEqual(['id']);
    expect(model.entities.find((e) => e.name === 'matches')?.key).toEqual([
      'match_id',
    ]);
    expect(model.entities.find((e) => e.name === 'logs')?.key).toBeUndefined();
  });

  it('skips a relationship whose target table is outside the dataset', () => {
    const matchesOnly: DatasetEntitySnapshot = {
      ...matches,
      key: MATCHES_KEY,
    };
    const { model } = bootstrapFromSnapshot(
      dataset({ tables: [MATCHES_KEY], entities: [matchesOnly] }),
      [],
      1,
    );

    expect(model.relationships).toEqual([]);
  });

  it('builds a rest binding keeping the full endpoint key', () => {
    const endpoint: DatasetEntitySnapshot = {
      key: 'api.default.users',
      columns: [{ name: 'id', type: 'integer', nullable: false }],
    };
    const { model } = bootstrapFromSnapshot(
      dataset({
        datasourceKind: 'rest',
        tables: [endpoint.key],
        entities: [endpoint],
      }),
      [],
      1,
    );

    expect(model.entities[0].bindings[0]).toMatchObject({
      kind: 'rest',
      endpoint: 'api.default.users',
    });
  });

  it('imports a legacy metric bound to one of the dataset tables, mapping its dimensions', () => {
    const legacy: MetricDoc[] = [
      {
        id: 'm1',
        name: 'avg_attendance',
        label: 'Average attendance',
        entity: MATCHES_KEY,
        expression: 'avg(attendance)',
        dimensions: ['MATCH_DATE', 'unmatched_dimension'],
      },
      {
        id: 'm2',
        name: 'other_table_metric',
        label: 'Irrelevant',
        entity: 'main.other.table',
        expression: 'count(*)',
      },
    ];

    const { model } = bootstrapFromSnapshot(dataset(), legacy, 1);

    expect(model.metrics).toHaveLength(1);
    expect(model.metrics[0]).toMatchObject({
      name: 'avg_attendance',
      entity: 'matches',
      expressions: { sql: 'avg(attendance)' },
      // "unmatched_dimension" matches no attribute on "matches" and is
      // dropped (review finding 4) rather than kept verbatim.
      dimensions: ['match_date'],
    });
  });

  it('returns issues instead of persisting when the result would not validate', () => {
    // A key attribute name collides with a reserved one once sanitized
    // ("match id" and "match-id" both become "match_id") — the duplicate
    // fails `validateDataModel`'s uniqueness check.
    const colliding: DatasetEntitySnapshot = {
      key: MATCHES_KEY,
      columns: [
        { name: 'match id', type: 'bigint', nullable: false },
        { name: 'match-id', type: 'bigint', nullable: false },
      ],
    };
    const { model, issues } = bootstrapFromSnapshot(
      dataset({ tables: [MATCHES_KEY], entities: [colliding] }),
      [],
      1,
    );

    expect(issues.length).toBeGreaterThan(0);
    expect(model.entities[0].attributes).toHaveLength(2);
  });
});
