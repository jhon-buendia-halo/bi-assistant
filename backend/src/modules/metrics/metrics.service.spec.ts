import { MetricsService, toMetricName } from './metrics.service';
import type { MetricDoc } from './entities/metric.entity';

const metric = (overrides: Partial<MetricDoc> = {}): MetricDoc => ({
  id: 'metric-1',
  name: 'denial_rate',
  label: 'Denial rate',
  entity: 'main.health.claims',
  expression: "SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END)/COUNT(*)",
  ...overrides,
});

function build(
  docs: MetricDoc[] = [],
  pairs: {
    id: string;
    question: string;
    sql: string;
    entities: string[];
    datasourceId?: string;
  }[] = [],
) {
  const repository = {
    list: jest.fn().mockResolvedValue(docs),
    get: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(docs.find((d) => d.id === id) ?? null),
      ),
    findByName: jest
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve(docs.find((d) => d.name === name) ?? null),
      ),
    insert: jest.fn().mockImplementation((doc: MetricDoc) => doc),
    update: jest
      .fn()
      .mockImplementation((id: string, patch: Partial<MetricDoc>) =>
        Promise.resolve({ ...docs.find((d) => d.id === id), ...patch }),
      ),
    delete: jest.fn().mockResolvedValue(1),
  };
  const verifiedQueries = { list: jest.fn().mockResolvedValue(pairs) };
  // `DataModelsService`'s metrics-panel sync — a plain fake here (this spec
  // is about the legacy-store-backed public API, not the model-sync
  // behaviour, which is covered by `data-models.service.spec.ts`); every
  // test just asserts the right bridge call happened.
  const dataModels = {
    syncMetric: jest.fn().mockResolvedValue([]),
    removeMetric: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    // Default: no model binds anything, so `definitionBlock`/`candidates`
    // fall through to the legacy-store-backed behaviour these specs cover;
    // individual tests override to exercise the model-sourced path.
    metricsBoundToEntities: jest.fn().mockResolvedValue(new Map()),
    promotedVerifiedQueryIds: jest.fn().mockResolvedValue(new Set()),
  };
  return {
    service: new MetricsService(
      repository as never,
      verifiedQueries as never,
      dataModels as never,
    ),
    repository,
    verifiedQueries,
    dataModels,
  };
}

describe('MetricsService.create', () => {
  it('normalizes and stores a valid definition', async () => {
    const { service, repository, dataModels } = build();

    const saved = await service.create({
      name: '  Denial_Rate  ',
      label: '  Denial rate  ',
      entity: '  main.health.claims  ',
      expression: '  SUM(denied)/COUNT(*)  ',
      description: '  Share of claims denied  ',
      dimensions: [' month ', '', 'provider'],
    });

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'denial_rate',
        label: 'Denial rate',
        entity: 'main.health.claims',
        expression: 'SUM(denied)/COUNT(*)',
        description: 'Share of claims denied',
        dimensions: ['month', 'provider'],
      }),
    );
    expect(saved.id).toEqual(expect.any(String));
    expect(dataModels.syncMetric).toHaveBeenCalledWith(saved);
  });

  it.each([
    ['name', { name: '' }, /name is required/],
    ['slug', { name: '2denials' }, /lowercase letters/],
    ['label', { label: '  ' }, /label is required/],
    ['entity', { entity: '' }, /entity is required/],
    ['expression', { expression: ' ' }, /expression is required/],
    ['statement chain', { expression: 'COUNT(*); DROP TABLE x' }, /semicolons/],
  ])('rejects an invalid %s', async (_case, overrides, expected) => {
    const { service, repository, dataModels } = build();

    await expect(
      service.create({
        name: 'denial_rate',
        label: 'Denial rate',
        entity: 'main.health.claims',
        expression: 'COUNT(*)',
        ...overrides,
      }),
    ).rejects.toThrow(expected);
    expect(repository.insert).not.toHaveBeenCalled();
    expect(dataModels.syncMetric).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name', async () => {
    const { service } = build([metric()]);

    await expect(
      service.create({
        name: 'denial_rate',
        label: 'Another denial rate',
        entity: 'main.health.claims',
        expression: 'COUNT(*)',
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('MetricsService.update', () => {
  it('keeps its own name, clears dropped optional fields and syncs (no remove)', async () => {
    const { service, repository, dataModels } = build([
      metric({ description: 'old', dimensions: ['month'] }),
    ]);

    await service.update('metric-1', {
      name: 'denial_rate',
      label: 'Denial rate',
      entity: 'main.health.claims',
      expression: 'COUNT(*)',
    });

    expect(repository.update).toHaveBeenCalledWith(
      'metric-1',
      expect.objectContaining({ expression: 'COUNT(*)' }),
      expect.arrayContaining(['description', 'dimensions']),
    );
    expect(dataModels.removeMetric).not.toHaveBeenCalled();
    expect(dataModels.syncMetric).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'denial_rate', expression: 'COUNT(*)' }),
    );
  });

  it('removes the old name first when the metric is renamed', async () => {
    const { service, dataModels } = build([metric({ name: 'denial_rate' })]);

    await service.update('metric-1', {
      name: 'denial_ratio',
      label: 'Denial ratio',
      entity: 'main.health.claims',
      expression: 'COUNT(*)',
    });

    expect(dataModels.removeMetric).toHaveBeenCalledWith('denial_rate');
    expect(dataModels.syncMetric).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'denial_ratio' }),
    );
  });

  it('rejects a name already held by another metric', async () => {
    const { service } = build([
      metric(),
      metric({ id: 'metric-2', name: 'avg_cost' }),
    ]);

    await expect(
      service.update('metric-2', {
        name: 'denial_rate',
        label: 'Clash',
        entity: 'main.health.claims',
        expression: 'COUNT(*)',
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('rejects an unknown metric', async () => {
    const { service } = build();

    await expect(
      service.update('missing', {
        name: 'denial_rate',
        label: 'Denial rate',
        entity: 'main.health.claims',
        expression: 'COUNT(*)',
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('MetricsService.delete', () => {
  it('returns the removed definition and removes it from the model', async () => {
    const { service, repository, dataModels } = build([metric()]);

    expect((await service.delete('metric-1')).label).toBe('Denial rate');
    expect(repository.delete).toHaveBeenCalledWith('metric-1');
    expect(dataModels.removeMetric).toHaveBeenCalledWith('denial_rate');
  });

  it('rejects an unknown metric', async () => {
    const { service } = build();

    await expect(service.delete('missing')).rejects.toThrow(/not found/);
  });
});

describe('MetricsService.definitionBlock', () => {
  const library = [
    metric({ description: 'Share of claims denied', dimensions: ['month'] }),
    metric({
      id: 'metric-2',
      name: 'avg_cost',
      label: 'Average cost',
      entity: 'main.health.encounters',
      expression: 'AVG(cost)',
    }),
  ];

  it('renders only the metrics defined over the entities in scope', async () => {
    const { service } = build(library);

    const block = await service.definitionBlock(['main.health.claims']);

    expect(block).toContain('Governed metric definitions');
    expect(block).toContain(
      '- Denial rate (denial_rate) on main.health.claims:',
    );
    expect(block).toContain('dimensions: month');
    expect(block).toContain('Share of claims denied');
    expect(block).not.toContain('avg_cost');
  });

  it('matches entities case-insensitively', async () => {
    const { service } = build(library);

    expect(await service.definitionBlock(['MAIN.HEALTH.CLAIMS'])).toContain(
      'denial_rate',
    );
  });

  it('is undefined when no metric covers the scope', async () => {
    const { service } = build(library);

    expect(await service.definitionBlock(['main.other.table'])).toBe(undefined);
    expect(await service.definitionBlock([])).toBe(undefined);
  });

  it('stops at the character budget', async () => {
    const many = Array.from({ length: 200 }, (_, n) =>
      metric({
        id: `metric-${n}`,
        name: `metric_${n}`,
        label: `Metric ${n}`,
        description: 'x'.repeat(200),
      }),
    );
    const { service } = build(many);

    const block = await service.definitionBlock(['main.health.claims']);

    expect(block!.length).toBeLessThanOrEqual(4_200);
    expect(block).toContain('Metric 0');
  });

  it('reads a governed metric from the current data model, not the legacy store, for a table a model binds (review finding 1)', async () => {
    const { service, dataModels } = build(library);
    dataModels.metricsBoundToEntities.mockResolvedValue(
      new Map([
        [
          'main.health.claims',
          [
            {
              name: 'approval_rate',
              label: 'Approval rate',
              entity: 'claims',
              agg: 'avg',
              of: 'approved',
              dimensions: ['month'],
              description: 'Model-authored definition',
            },
          ],
        ],
      ]),
    );

    const block = await service.definitionBlock(['main.health.claims']);

    expect(block).toContain(
      '- Approval rate (approval_rate) on main.health.claims: avg(approved)',
    );
    expect(block).toContain('Model-authored definition');
    // The legacy copy for the SAME table is not also rendered — the model
    // is authoritative for any table it binds, panel delete included.
    expect(block).not.toContain('denial_rate');
  });

  it('renders expressions.sql verbatim and a where clause for a model metric', async () => {
    const { service, dataModels } = build([]);
    dataModels.metricsBoundToEntities.mockResolvedValue(
      new Map([
        [
          'main.health.claims',
          [
            {
              name: 'high_cost_claims',
              label: 'High-cost claims',
              entity: 'claims',
              expressions: { sql: 'count(*)' },
              where: { attr: 'amount', op: 'gt', value: 10000 },
            },
          ],
        ],
      ]),
    );

    const block = await service.definitionBlock(['main.health.claims']);

    expect(block).toContain('count(*) where amount > 10000');
  });

  it('falls back to the legacy store for a table no model binds, even when other tables are model-bound', async () => {
    const { service, dataModels } = build(library);
    dataModels.metricsBoundToEntities.mockResolvedValue(
      new Map([['main.health.claims', []]]), // bound, zero model metrics
    );

    const block = await service.definitionBlock([
      'main.health.claims',
      'main.health.encounters',
    ]);

    // claims is model-bound with no metrics -> nothing rendered for it, and
    // the legacy "denial_rate" (also on claims) must NOT leak in either.
    expect(block).not.toContain('denial_rate');
    // encounters is not model-bound -> legacy metric still grounds it.
    expect(block).toContain('avg_cost');
  });
});

describe('MetricsService.candidates', () => {
  const pairs = [
    {
      id: 'vq-1',
      question: 'Denial rate by month',
      sql: 'SELECT 1',
      entities: ['main.health.claims'],
      datasourceId: 'ds-1',
    },
    {
      id: 'vq-2',
      question: 'Average cost per member',
      sql: 'SELECT 2',
      entities: ['main.health.encounters'],
    },
    { id: 'vq-3', question: 'No provenance', sql: 'SELECT 3', entities: [] },
  ];

  it('prefills drafts from verified queries with entity provenance', async () => {
    const { service } = build([], pairs);

    const candidates = await service.candidates();

    expect(candidates).toEqual([
      {
        verifiedQueryId: 'vq-1',
        name: 'denial_rate_by_month',
        label: 'Denial rate by month',
        entity: 'main.health.claims',
        datasourceId: 'ds-1',
        sql: 'SELECT 1',
      },
      {
        verifiedQueryId: 'vq-2',
        name: 'average_cost_per_member',
        label: 'Average cost per member',
        entity: 'main.health.encounters',
        sql: 'SELECT 2',
      },
    ]);
  });

  it('drops pairs already promoted and scopes to the given entities', async () => {
    const { service } = build(
      [metric({ sourceVerifiedQueryId: 'vq-1' })],
      pairs,
    );

    const candidates = await service.candidates([
      'main.health.claims',
      'main.health.encounters',
    ]);

    expect(candidates.map((c) => c.verifiedQueryId)).toEqual(['vq-2']);
  });

  it('also drops a pair promoted into a data model, not just the legacy store (review finding 8)', async () => {
    const { service, dataModels } = build([], pairs);
    dataModels.promotedVerifiedQueryIds.mockResolvedValue(new Set(['vq-1']));

    const candidates = await service.candidates([
      'main.health.claims',
      'main.health.encounters',
    ]);

    expect(candidates.map((c) => c.verifiedQueryId)).toEqual(['vq-2']);
  });

  it('applies the promoted filter before the MAX_CANDIDATES slice, not after', async () => {
    // 15 pairs, all sharing one entity, so unfiltered they would exceed the
    // 12-candidate cap; the first one is promoted into a model. If the
    // promoted-filter ran after slicing instead of before, the 13th pair
    // would never get a chance to appear.
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `vq-many-${i}`,
      question: `Question ${i}`,
      sql: `SELECT ${i}`,
      entities: ['main.health.claims'],
    }));
    const { service, dataModels } = build([], many);
    dataModels.promotedVerifiedQueryIds.mockResolvedValue(
      new Set(['vq-many-0']),
    );

    const candidates = await service.candidates(['main.health.claims']);

    expect(candidates).toHaveLength(12);
    expect(candidates.map((c) => c.verifiedQueryId)).not.toContain('vq-many-0');
    expect(candidates.map((c) => c.verifiedQueryId)).toContain('vq-many-12');
  });
});

describe('MetricsService.candidatesForDataset (roadmap 1.2.3)', () => {
  it("scopes candidates to the model's bound entities and re-addresses them by logical name", async () => {
    const { service, dataModels } = build(
      [],
      [
        {
          id: 'vq-1',
          question: 'Goals per match?',
          sql: 'select count(*) from matches',
          entities: ['world_cup.world_cup.matches'],
        },
        {
          id: 'vq-2',
          question: 'Unrelated question',
          sql: 'select 1',
          entities: ['world_cup.world_cup.other'],
        },
      ],
    );
    dataModels.get.mockResolvedValue({
      dataset: 'World Cup Core',
      currentVersion: 1,
      versions: [
        {
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          source: 'bootstrap',
          yaml: '',
          model: {
            model: 'World Cup Core',
            version: 1,
            entities: [
              {
                name: 'matches',
                bindings: [
                  {
                    kind: 'sql',
                    datasource: 'ds-1',
                    table: 'world_cup.world_cup.matches',
                  },
                ],
                attributes: [],
              },
            ],
            relationships: [],
            metrics: [],
          },
        },
      ],
    });

    const candidates = await service.candidatesForDataset('World Cup Core');

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      verifiedQueryId: 'vq-1',
      entity: 'matches',
    });
  });

  it('drops a candidate already promoted into any model (by sourceVerifiedQueryId, review finding 8)', async () => {
    const { service, dataModels } = build(
      [],
      [
        {
          id: 'vq-1',
          question: 'Goals per match?',
          sql: 'select count(*) from matches',
          entities: ['world_cup.world_cup.matches'],
        },
      ],
    );
    dataModels.get.mockResolvedValue({
      dataset: 'World Cup Core',
      currentVersion: 1,
      versions: [
        {
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          source: 'bootstrap',
          yaml: '',
          model: {
            model: 'World Cup Core',
            version: 1,
            entities: [
              {
                name: 'matches',
                bindings: [
                  {
                    kind: 'sql',
                    datasource: 'ds-1',
                    table: 'world_cup.world_cup.matches',
                  },
                ],
                attributes: [],
              },
            ],
            relationships: [],
            // Renamed after promotion — the candidate must still drop out
            // because the filter tracks `sourceVerifiedQueryId`, not name.
            metrics: [
              {
                name: 'renamed_goal_metric',
                label: 'Goals per match',
                entity: 'matches',
                agg: 'count',
                sourceVerifiedQueryId: 'vq-1',
              },
            ],
          },
        },
      ],
    });
    // Promoted into a DIFFERENT dataset's model than the one being queried —
    // still excluded, since promotion is tracked globally, not per-dataset.
    dataModels.promotedVerifiedQueryIds.mockResolvedValue(new Set(['vq-1']));

    const candidates = await service.candidatesForDataset('World Cup Core');

    expect(candidates).toEqual([]);
  });

  it('is empty when the dataset has no model yet', async () => {
    const { service, dataModels } = build();
    dataModels.get.mockResolvedValue(null);

    expect(await service.candidatesForDataset('No Model')).toEqual([]);
  });
});

describe('toMetricName', () => {
  it('slugs a question into a handle', () => {
    expect(toMetricName('Denial rate — by month?')).toBe(
      'denial_rate_by_month',
    );
  });

  it('is empty when nothing slug-like survives', () => {
    expect(toMetricName('2024 ???')).toBe('');
  });
});
