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
