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
  return {
    service: new MetricsService(repository as never, verifiedQueries as never),
    repository,
    verifiedQueries,
  };
}

describe('MetricsService.create', () => {
  it('normalizes and stores a valid definition', async () => {
    const { service, repository } = build();

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
  });

  it.each([
    ['name', { name: '' }, /name is required/],
    ['slug', { name: '2denials' }, /lowercase letters/],
    ['label', { label: '  ' }, /label is required/],
    ['entity', { entity: '' }, /entity is required/],
    ['expression', { expression: ' ' }, /expression is required/],
    ['statement chain', { expression: 'COUNT(*); DROP TABLE x' }, /semicolons/],
  ])('rejects an invalid %s', async (_case, overrides, expected) => {
    const { service, repository } = build();

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
  it('keeps its own name and clears dropped optional fields', async () => {
    const { service, repository } = build([
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
  it('returns the removed definition', async () => {
    const { service, repository } = build([metric()]);

    expect((await service.delete('metric-1')).label).toBe('Denial rate');
    expect(repository.delete).toHaveBeenCalledWith('metric-1');
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

  it('is byte-identical to the newest-defined path when ranked is explicitly false', async () => {
    const { service: unranked } = build(library);
    const { service: rankedFalse } = build(library);

    const a = await unranked.definitionBlock(['main.health.claims']);
    const b = await rankedFalse.definitionBlock(['main.health.claims'], {
      ranked: false,
      question: 'irrelevant, ignored when ranked is false',
      budgetChars: 1,
    });

    expect(b).toEqual(a);
  });

  describe('ranked', () => {
    it('ranks a metric matching the question above an unrelated one covering the same entities', async () => {
      const netPaid = metric({
        id: 'net-paid',
        name: 'net_paid',
        label: 'Net paid',
        entity: 'main.health.claims',
        expression: 'SUM(paid) - SUM(reversed)',
        description: 'Net paid amount by region.',
      });
      const unrelated = metric({
        id: 'other',
        name: 'claim_count',
        label: 'Claim count',
        entity: 'main.health.claims',
        expression: 'COUNT(*)',
        description: 'Total number of claims.',
      });
      const { service } = build([unrelated, netPaid]);

      const block = await service.definitionBlock(['main.health.claims'], {
        ranked: true,
        question: 'net paid by region',
      });

      expect(block!.indexOf('net_paid')).toBeLessThan(
        block!.indexOf('claim_count'),
      );
    });

    it('fills the budget best-first, skipping a higher-ranked entry that does not fit', async () => {
      const bigButRelevant = metric({
        id: 'big',
        name: 'net_paid',
        label: 'net paid net paid net paid',
        description: 'x'.repeat(3_990),
      });
      const smallLessRelevant = metric({
        id: 'small',
        name: 'other',
        label: 'Other',
      });
      const { service } = build([smallLessRelevant, bigButRelevant]);

      const block = await service.definitionBlock(['main.health.claims'], {
        ranked: true,
        question: 'net paid',
      });

      expect(block).toContain('Other');
      expect(block).not.toContain('net paid net paid');
    });
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

describe('MetricsService.lookup', () => {
  const netPaid = metric({
    id: 'net-paid',
    name: 'net_paid',
    label: 'Net paid',
    entity: 'main.health.claims',
    expression: 'SUM(paid) - SUM(reversed)',
    description: 'Net paid amount by region.',
  });
  const denialRate = metric({
    id: 'denial-rate',
    name: 'denial_rate',
    label: 'Denial rate',
    entity: 'main.health.claims',
  });
  const alleleFraction = metric({
    id: 'allele-fraction',
    name: 'allele_fraction',
    label: 'Allele fraction',
    entity: 'main.genomics.variant_calls',
    expression: 'AVG(fraction)',
  });

  it('scopes to the given entities', async () => {
    const { service } = build([netPaid, denialRate, alleleFraction]);

    const results = await service.lookup(['main.health.claims'], {});

    expect(results.map((r) => r.name).sort()).toEqual([
      'denial_rate',
      'net_paid',
    ]);
  });

  it('filters by entity (last-two-segment match)', async () => {
    const { service } = build([netPaid, denialRate, alleleFraction]);

    const results = await service.lookup([], { entity: 'health.claims' });

    expect(results.map((r) => r.name).sort()).toEqual([
      'denial_rate',
      'net_paid',
    ]);
  });

  it('ranks results by phrase', async () => {
    const { service } = build([denialRate, netPaid]);

    const results = await service.lookup(['main.health.claims'], {
      phrase: 'net paid by region',
    });

    expect(results[0].name).toBe('net_paid');
  });

  it('returns at most 8 results', async () => {
    const many = Array.from({ length: 20 }, (_, n) =>
      metric({
        id: `m${n}`,
        name: `metric_${n}`,
        entity: 'main.health.claims',
      }),
    );
    const { service } = build(many);

    const results = await service.lookup(['main.health.claims'], {});

    expect(results.length).toBeLessThanOrEqual(8);
  });

  it('omits description when the metric has none', async () => {
    const { service } = build([denialRate]);

    const results = await service.lookup(['main.health.claims'], {});

    expect(results[0]).toEqual({
      name: 'denial_rate',
      label: 'Denial rate',
      entity: 'main.health.claims',
      expression: denialRate.expression,
    });
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
