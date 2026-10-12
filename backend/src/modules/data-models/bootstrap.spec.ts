import {
  bootstrapFromSnapshot,
  deriveEntityNames,
  importLegacyMetrics,
  inferAttributeType,
  mapDimensionNames,
  safeName,
  toModelMetric,
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

/** A legacy metric on "matches", as the raw (all owners) store holds it. */
function legacyMetric(
  overrides: Partial<MetricDoc> & { id: string },
): MetricDoc {
  return {
    name: 'avg_attendance',
    label: 'Average attendance',
    entity: MATCHES_KEY,
    expression: 'avg(attendance)',
    ...overrides,
  };
}

describe('toModelMetric (data-model R34)', () => {
  const attributes: Attribute[] = [{ name: 'attendance', type: 'integer' }];

  it("records the legacy owner as the metric's author", () => {
    const metric = toModelMetric(
      legacyMetric({ id: 'm1', ownerId: 'user-ada' }),
      'matches',
      attributes,
    );
    expect(metric).toEqual({
      name: 'avg_attendance',
      label: 'Average attendance',
      entity: 'matches',
      expressions: { sql: 'avg(attendance)' },
      author: 'user-ada',
    });
  });

  it('records no author for a local-mode metric, and lowercases the name', () => {
    const metric = toModelMetric(
      legacyMetric({ id: 'm1', name: 'Avg_Attendance' }),
      'matches',
      attributes,
    );
    expect(metric.name).toBe('avg_attendance');
    expect(metric).not.toHaveProperty('author');
  });
});

describe('bootstrapFromSnapshot — metrics import across owners (data-model R34, R35)', () => {
  it('keeps the first metric of each lowercase name by createdAt, then id, and reports the rest', () => {
    const legacy = [
      legacyMetric({
        id: 'm-grace',
        ownerId: 'user-grace',
        label: 'Mean attendance',
        expression: 'sum(attendance) / count(*)',
        createdAt: '2025-02-01T00:00:00.000Z',
      }),
      legacyMetric({
        id: 'm-ada',
        ownerId: 'user-ada',
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
      legacyMetric({
        id: 'm-max',
        ownerId: 'user-grace',
        name: 'max_attendance',
        label: 'Highest attendance',
        expression: 'max(attendance)',
        createdAt: '2025-02-02T00:00:00.000Z',
      }),
      legacyMetric({
        id: 'm-elsewhere',
        ownerId: 'user-grace',
        name: 'elsewhere',
        entity: 'main.other.table',
      }),
    ];

    const { model, issues, metricsImport } = bootstrapFromSnapshot(
      dataset(),
      legacy,
      1,
    );

    expect(issues).toEqual([]);
    expect(model.metrics).toEqual([
      expect.objectContaining({
        name: 'avg_attendance',
        label: 'Average attendance',
        author: 'user-ada',
        expressions: { sql: 'avg(attendance)' },
      }),
      expect.objectContaining({ name: 'max_attendance', author: 'user-grace' }),
    ]);
    expect(metricsImport).toEqual({
      imported: [
        {
          name: 'avg_attendance',
          entity: 'matches',
          author: 'user-ada',
          sourceId: 'm-ada',
        },
        {
          name: 'max_attendance',
          entity: 'matches',
          author: 'user-grace',
          sourceId: 'm-max',
        },
      ],
      skipped: [
        {
          name: 'avg_attendance',
          author: 'user-grace',
          sourceId: 'm-grace',
          reason: 'name_clash',
          keptSourceId: 'm-ada',
        },
      ],
    });
  });

  it('breaks a createdAt tie by the lowest id, and clashes names that differ only in case', () => {
    const at = '2025-01-01T00:00:00.000Z';
    const { model, metricsImport } = bootstrapFromSnapshot(
      dataset(),
      [
        legacyMetric({ id: 'b', name: 'Avg_Attendance', createdAt: at }),
        legacyMetric({ id: 'a', createdAt: at, label: 'Kept' }),
      ],
      1,
    );

    expect(model.metrics).toHaveLength(1);
    expect(model.metrics[0]).toMatchObject({
      name: 'avg_attendance',
      label: 'Kept',
    });
    expect(model.metrics[0]).not.toHaveProperty('author');
    expect(metricsImport.skipped).toEqual([
      {
        name: 'avg_attendance',
        sourceId: 'b',
        reason: 'name_clash',
        keptSourceId: 'a',
      },
    ]);
  });
});

describe('importLegacyMetrics (data-model R34)', () => {
  const targets = new Map([
    [
      MATCHES_KEY,
      {
        name: 'matches',
        attributes: [{ name: 'attendance', type: 'integer' }],
      },
    ],
  ]) as Parameters<typeof importLegacyMetrics>[1];

  it('imports nothing for a name the model already holds from the same author', () => {
    const result = importLegacyMetrics(
      [legacyMetric({ id: 'm-ada', ownerId: 'user-ada' })],
      targets,
      {
        held: [
          {
            name: 'avg_attendance',
            label: 'Average attendance',
            entity: 'matches',
            author: 'user-ada',
          },
        ],
      },
    );
    expect(result).toEqual({ metrics: [], imported: [], skipped: [] });
  });

  it('reports a name the model holds from another author, keeping the holder', () => {
    const result = importLegacyMetrics(
      [
        legacyMetric({
          id: 'm-ada',
          ownerId: 'user-ada',
          createdAt: '2025-01-01T00:00:00.000Z',
        }),
        legacyMetric({
          id: 'm-grace',
          ownerId: 'user-grace',
          createdAt: '2025-02-01T00:00:00.000Z',
        }),
      ],
      targets,
      {
        held: [
          {
            name: 'avg_attendance',
            label: 'Mean attendance',
            entity: 'matches',
            author: 'user-grace',
          },
        ],
      },
    );
    expect(result.metrics).toEqual([]);
    expect(result.imported).toEqual([]);
    expect(result.skipped).toEqual([
      {
        name: 'avg_attendance',
        author: 'user-ada',
        sourceId: 'm-ada',
        reason: 'name_clash',
        keptSourceId: 'm-grace',
      },
    ]);
  });

  it('never imports a model-managed or deleted name, and reports nothing for it', () => {
    const result = importLegacyMetrics(
      [
        legacyMetric({ id: 'm1' }),
        legacyMetric({ id: 'm2', name: 'max_attendance' }),
      ],
      targets,
      { excludedNames: ['AVG_ATTENDANCE', 'max_attendance'] },
    );
    expect(result).toEqual({ metrics: [], imported: [], skipped: [] });
  });
});

describe('importLegacyMetrics author name (data-model R34, R35)', () => {
  const targets = new Map([
    [
      MATCHES_KEY,
      {
        name: 'matches',
        attributes: [{ name: 'attendance', type: 'integer' }],
      },
    ],
  ]) as Parameters<typeof importLegacyMetrics>[1];
  const authorNames = new Map([['user-ada', 'Ada Lovelace']]);

  it("stamps the owner's display name on the metric and on both report lists", () => {
    const result = importLegacyMetrics(
      [
        legacyMetric({
          id: 'm-ada',
          ownerId: 'user-ada',
          createdAt: '2025-01-01T00:00:00.000Z',
        }),
        legacyMetric({
          id: 'm-grace',
          ownerId: 'user-grace',
          createdAt: '2025-02-01T00:00:00.000Z',
        }),
      ],
      targets,
      { authorNames },
    );
    expect(result.metrics).toEqual([
      expect.objectContaining({
        author: 'user-ada',
        authorName: 'Ada Lovelace',
      }),
    ]);
    expect(result.imported).toEqual([
      {
        name: 'avg_attendance',
        entity: 'matches',
        author: 'user-ada',
        authorName: 'Ada Lovelace',
        sourceId: 'm-ada',
      },
    ]);
    // Grace is not in the directory: author kept, no author name.
    expect(result.skipped).toEqual([
      {
        name: 'avg_attendance',
        author: 'user-grace',
        sourceId: 'm-grace',
        reason: 'name_clash',
        keptSourceId: 'm-ada',
      },
    ]);
  });

  it('records no author or author name for a legacy metric with no owner', () => {
    const result = importLegacyMetrics([legacyMetric({ id: 'm1' })], targets, {
      authorNames,
    });
    expect(result.metrics[0]).not.toHaveProperty('authorName');
    expect(result.imported[0]).not.toHaveProperty('authorName');
  });

  it('toModelMetric stamps the author name when one is known', () => {
    const metric = toModelMetric(
      legacyMetric({ id: 'm-ada', ownerId: 'user-ada' }),
      'matches',
      [{ name: 'attendance', type: 'integer' }],
      authorNames,
    );
    expect(metric).toMatchObject({
      author: 'user-ada',
      authorName: 'Ada Lovelace',
    });
  });
});

describe('keptSourceId (data-model R35)', () => {
  const targets = new Map([
    [
      MATCHES_KEY,
      {
        name: 'matches',
        attributes: [{ name: 'attendance', type: 'integer' }],
      },
    ],
  ]) as Parameters<typeof importLegacyMetrics>[1];

  it('is left out when the held metric did not come from the legacy store', () => {
    const result = importLegacyMetrics(
      [legacyMetric({ id: 'm-grace', ownerId: 'user-grace' })],
      targets,
      {
        // Written in the YAML (or the Metrics tab) by Ada: no legacy twin.
        held: [
          {
            name: 'avg_attendance',
            label: 'Average attendance',
            entity: 'matches',
            agg: 'avg',
            of: 'attendance',
            author: 'user-ada',
          },
        ],
      },
    );
    expect(result.skipped).toEqual([
      {
        name: 'avg_attendance',
        author: 'user-grace',
        sourceId: 'm-grace',
        reason: 'name_clash',
      },
    ]);
  });
});
