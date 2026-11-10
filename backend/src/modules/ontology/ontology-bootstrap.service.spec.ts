// `mastra.service.ts` pulls in every registered agent (ESM-only transitive
// deps) and the real `Agent` class is ESM-only too; both are stubbed so the
// suite stays on Jest's CommonJS transform while the real draft schemas in
// `knowledge-bootstrap.agent.ts` are still exercised.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('@mastra/core/agent', () => ({ Agent: class {} }));
jest.mock('../../mastra/model-resolver', () => ({
  resolveAgentModel: jest.fn(),
}));
// The Databricks connector behind `DatasourcesService` has the same
// ESM-under-Jest problem; the repositories need a doc store. All faked below.
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../datasets/repositories/datasets.repository', () => ({
  DatasetsRepository: class {},
}));
jest.mock('../metrics/metrics.service', () => ({ MetricsService: class {} }));
jest.mock('./repositories/ontology.repository', () => ({
  OntologyRepository: class {},
}));

import { BadRequestException } from '@nestjs/common';
import { OntologyBootstrapService } from './ontology-bootstrap.service';
import { knowledgeBootstrapOutputSchema } from '../../mastra/agents/knowledge-bootstrap.agent';

describe('the bootstrap output schema', () => {
  it('accepts more than 15 drafts, so an overshooting model does not fail the run', () => {
    const drafts = Array.from({ length: 22 }, (_, i) => ({
      kind: 'instruction',
      name: `Rule ${i}`,
      description: 'text',
    }));
    expect(knowledgeBootstrapOutputSchema.safeParse({ drafts }).success).toBe(
      true,
    );
  });
});
import type { OntologyItem } from './entities/ontology-item.entity';

const DATASET = {
  name: 'Shop',
  datasourceId: 'ds-1',
  datasourceKind: 'postgres',
  tables: ['shop.public.orders', 'shop.public.customers'],
  entities: [
    {
      key: 'shop.public.orders',
      columns: [
        { name: 'id', type: 'int', nullable: false },
        {
          name: 'customer_id',
          type: 'int',
          nullable: false,
          references: {
            entity: 'shop.public.customers',
            column: 'id',
            source: 'declared',
          },
        },
        {
          name: 'status',
          type: 'text',
          nullable: true,
          sampleValues: ['paid', 'void'],
        },
      ],
    },
    {
      key: 'shop.public.customers',
      columns: [{ name: 'id', type: 'int', nullable: false }],
    },
  ],
};

const METRIC = {
  id: 'metric-1',
  name: 'order_count',
  label: 'Order count',
  entity: 'shop.public.orders',
  expression: 'COUNT(*)',
};

const item = (overrides: Partial<OntologyItem>): OntologyItem => ({
  id: 'existing-1',
  dataset: 'Shop',
  kind: 'concept',
  name: 'Customer',
  description: 'A buyer',
  enabled: true,
  source: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function build(
  options: {
    existing?: OntologyItem[];
    drafts?: unknown[];
    generate?: jest.Mock;
    datasets?: unknown[];
  } = {},
) {
  const repository = {
    list: jest.fn().mockResolvedValue(options.existing ?? []),
    insert: jest.fn().mockImplementation((doc: OntologyItem) => doc),
  };
  const datasetsRepository = {
    getByNames: jest.fn().mockResolvedValue(options.datasets ?? [DATASET]),
  };
  const datasourcesService = {
    defaultDatasource: jest.fn().mockResolvedValue(undefined),
    sampleRows: jest.fn().mockResolvedValue({
      columns: ['status'],
      rows: [{ status: 'paid', created: '2024-03-01' }],
    }),
  };
  const metricsService = {
    listForEntities: jest.fn().mockResolvedValue([METRIC]),
  };
  const generate =
    options.generate ??
    jest.fn().mockResolvedValue({ object: { drafts: options.drafts ?? [] } });
  const mastra = { getAgent: jest.fn().mockReturnValue({ generate }) };
  const service = new OntologyBootstrapService(
    repository as never,
    datasetsRepository as never,
    datasourcesService as never,
    metricsService as never,
    mastra as never,
  );
  return { service, repository, metricsService, mastra, generate };
}

const concept = (name: string, extra: Record<string, unknown> = {}) => ({
  kind: 'concept',
  name,
  description: `${name} definition`,
  ...extra,
});

describe('OntologyBootstrapService.bootstrap', () => {
  it('saves concepts, relations, constraints and instructions as mined, disabled dataset items', async () => {
    const { service, repository, mastra, generate } = build({
      drafts: [
        { kind: 'relation', from: 'order', type: 'part-of', to: 'Customer' },
        {
          kind: 'constraint',
          name: 'Exclude void',
          predicate: "status <> 'void'",
          description: 'Unless asked about voids',
          entities: ['SHOP.public.orders', 'other.x.y'],
        },
        {
          kind: 'instruction',
          name: 'Coverage',
          description: 'Orders cover March 2024',
        },
        concept('Order', {
          synonyms: [' purchase ', ''],
          mappings: [{ entity: 'shop.public.orders', column: 'id' }],
        }),
        concept('Customer', {
          mappings: [{ entity: 'shop.public.customers', column: 'id' }],
        }),
      ],
    });

    const created = await service.bootstrap(' Shop ');

    expect(mastra.getAgent).toHaveBeenCalledWith('knowledge-bootstrap');
    expect(created.map((i) => i.kind)).toEqual([
      'concept',
      'concept',
      'relation',
      'constraint',
      'instruction',
    ]);
    for (const saved of created) {
      expect(saved).toEqual(
        expect.objectContaining({
          dataset: 'Shop',
          source: 'mined',
          enabled: false,
        }),
      );
    }
    const [order, customer, relation, constraint, instruction] = created;
    expect(order).toEqual(
      expect.objectContaining({
        name: 'Order',
        description: 'Order definition',
        synonyms: ['purchase'],
        mappings: [{ entity: 'shop.public.orders', column: 'id' }],
      }),
    );
    expect(relation).toEqual(
      expect.objectContaining({
        name: 'Order part-of Customer',
        description: '',
        from: order.id,
        type: 'part-of',
        to: customer.id,
      }),
    );
    expect(constraint).toEqual(
      expect.objectContaining({
        predicate: "status <> 'void'",
        description: 'Unless asked about voids',
        entities: ['shop.public.orders'],
      }),
    );
    expect(instruction.description).toBe('Orders cover March 2024');
    expect(instruction.entities).toBeUndefined();
    expect(repository.insert).toHaveBeenCalledTimes(5);

    const [prompt, options] = generate.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(prompt).toContain('<entity-schemas>');
    expect(prompt).toContain('<sample-rows>');
    expect(prompt).toContain(
      'shop.public.orders.customer_id -> shop.public.customers.id (declared)',
    );
    expect(prompt).toContain('order_count — Order count (shop.public.orders)');
    expect(options).toEqual(
      expect.objectContaining({ maxSteps: 1, toolChoice: 'none' }),
    );
  });

  it('resolves a relation to an existing concept and measured-by to a metric', async () => {
    const existing = [
      item({ id: 'c-customer', name: 'Customer' }),
      item({ id: 'other', dataset: 'Elsewhere', name: 'Store' }),
    ];
    const { service } = build({
      existing,
      drafts: [
        concept('Order'),
        { kind: 'relation', from: 'Order', type: 'part-of', to: 'customer' },
        {
          kind: 'relation',
          from: 'Order',
          type: 'measured-by',
          metric: 'ORDER_COUNT',
        },
        { kind: 'relation', from: 'Order', type: 'part-of', to: 'Store' },
      ],
    });

    const created = await service.bootstrap('Shop');

    const [order, toCustomer, measured] = created;
    expect(created).toHaveLength(3);
    expect(toCustomer).toEqual(
      expect.objectContaining({ from: order.id, to: 'c-customer' }),
    );
    expect(measured).toEqual(
      expect.objectContaining({
        from: order.id,
        type: 'measured-by',
        metricId: 'metric-1',
        name: 'Order measured-by Order count',
      }),
    );
    expect(measured.to).toBeUndefined();
  });

  it('drops unresolved relations, mappings outside the dataset and duplicate names', async () => {
    const { service } = build({
      existing: [
        item({ id: 'c-customer', name: 'Customer' }),
        item({
          id: 'shared',
          dataset: null,
          kind: 'instruction',
          name: 'Dates',
        }),
      ],
      drafts: [
        concept('Order', {
          mappings: [
            { entity: 'other.public.orders', column: 'id' },
            { entity: 'shop.public.orders', expression: 'id * 1' },
          ],
        }),
        concept('order'),
        concept('CUSTOMER'),
        { kind: 'relation', from: 'Order', type: 'is-a', to: 'Ghost' },
        { kind: 'relation', from: 'Ghost', type: 'is-a', to: 'Order' },
        { kind: 'relation', from: 'Order', type: 'measured-by', metric: 'x' },
        { kind: 'relation', from: 'Order', type: 'has-many', to: 'Order' },
        { kind: 'instruction', name: 'dates', description: 'Use UTC' },
      ],
    });

    const created = await service.bootstrap('Shop');

    expect(created).toHaveLength(1);
    expect(created[0].mappings).toEqual([
      { entity: 'shop.public.orders', expression: 'id * 1' },
    ]);
  });

  it('keeps at most 15 drafts', async () => {
    const drafts = Array.from({ length: 20 }, (_, i) => concept(`C${i}`));
    const { service, repository } = build({ drafts });

    const created = await service.bootstrap('Shop');

    expect(created).toHaveLength(15);
    expect(repository.insert).toHaveBeenCalledTimes(15);
  });

  it('persists nothing when the agent fails', async () => {
    const generate = jest.fn().mockRejectedValue(new Error('model down'));
    const { service, repository } = build({ generate });

    await expect(service.bootstrap('Shop')).rejects.toThrow(
      new BadRequestException('Ontology bootstrap failed: model down'),
    );
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('fails with no usable drafts when the reply does not parse', async () => {
    const generate = jest.fn().mockResolvedValue({
      text: '```json\n{"drafts":[{"kind":"term"}]}\n```',
    });
    const { service, repository } = build({ generate });

    await expect(service.bootstrap('Shop')).rejects.toThrow(
      'Ontology bootstrap failed: the bootstrap agent returned no usable drafts',
    );
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('rejects an empty or unknown dataset', async () => {
    await expect(build().service.bootstrap('  ')).rejects.toThrow(
      new BadRequestException('dataset is required'),
    );
    await expect(
      build({ datasets: [] }).service.bootstrap('Missing'),
    ).rejects.toThrow(new BadRequestException('Dataset "Missing" not found'));
  });

  it('reports each stage through onProgress, in order', async () => {
    const { service } = build({ drafts: [concept('Order')] });
    const progress: { key: string; message: string }[] = [];

    await service.bootstrap('Shop', (p) => progress.push(p));

    expect(progress.map((p) => p.key)).toEqual([
      'dataset',
      'schema',
      'sample',
      'sample',
      'draft',
      'save',
    ]);
    expect(progress[0].message).toBe('Opening dataset “Shop”');
    expect(progress[1].message).toBe('Reading schema — 2 tables');
    expect(progress[3].message).toBe('Sampling rows — 2 of 2 tables');
    expect(progress[5].message).toBe('Saving 1 draft for review');
  });
});
