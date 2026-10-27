jest.mock('pg', () => ({ Client: jest.fn() }));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../datasets/datasets.service', () => ({
  DatasetsService: class {},
}));
// The real services pull in Mastra and the doc store; the loader only calls
// their list/create, which the in-memory doubles below provide.
jest.mock('../knowledge/knowledge.service', () => ({
  KnowledgeService: class {},
}));
jest.mock('../metrics/metrics.service', () => ({
  MetricsService: class {},
}));

import { BadRequestException } from '@nestjs/common';
import { Client } from 'pg';
import {
  TestingDataService,
  knowledgeSeedSuffix,
  type SampleFixtureView,
  type TestingDataStatus,
} from './testing-data.service';
import {
  SAMPLE_FIXTURES,
  findFixture,
  requiredEntityKeys,
  type SampleFixture,
} from './fixtures/registry';
import {
  setIntellifyApiInfo,
  type IntellifyApiInfo,
} from '../../intellify-api/api-info';
import type { KnowledgeSeed } from './fixtures/knowledge/types';
import type { CatalogInfo } from '../datasources/entities/datasource.entity';
import type { DatasetDoc } from '../datasets/repositories/datasets.repository';
import type {
  KnowledgeSnippet,
  KnowledgeSnippetInput,
} from '../knowledge/entities/knowledge-snippet.entity';
import type { MetricDoc, MetricInput } from '../metrics/entities/metric.entity';

/** Everything below is driven by the registry entry, never by a local copy. */
const WORLD_CUP = findFixture('world-cup') as SampleFixture;
const REQUIRED_TABLES = WORLD_CUP.requiredTables;
/** The keys the repo defaults produce: catalog and schema are both world_cup. */
const REQUIRED_ENTITY_KEYS = requiredEntityKeys(WORLD_CUP, WORLD_CUP.schema);
const TESTING_DATASOURCE_NAME = WORLD_CUP.datasourceName;
const TESTING_DATASET_NAME = WORLD_CUP.datasetName;

const DEFAULT_INPUT = {
  host: '127.0.0.1',
  port: 55432,
  database: 'world_cup',
  user: 'world_cup',
  password: 'world_cup_dev',
  ssl: false,
};

const savedDatasource = {
  id: 'ds-1',
  name: TESTING_DATASOURCE_NAME,
  kind: 'postgres' as const,
  summary: '127.0.0.1:55432/world_cup',
  config: {},
};

/** The datasource view the app stores once loaded — password already masked. */
const loadedDatasourceView = {
  id: 'ds-1',
  name: TESTING_DATASOURCE_NAME,
  kind: 'postgres' as const,
  config: {
    host: '127.0.0.1',
    port: 55432,
    database: 'world_cup',
    user: 'world_cup',
    password: '********',
    ssl: false,
  },
};

// ---------------------------------------------------------------- pg doubles

interface FakeClient {
  options: Record<string, unknown>;
  connect: jest.Mock;
  query: jest.Mock;
  end: jest.Mock;
}

let clients: FakeClient[] = [];
/** Per-connect hook: return an Error to fail that connection attempt. */
let onConnect: (options: Record<string, unknown>) => Error | undefined;
/** Per-query hook: return an Error to fail that statement. */
let onQuery: (
  sql: string,
  options: Record<string, unknown>,
) => Error | undefined;

function pgError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function queriesOn(database: string): string[] {
  return clients
    .filter((client) => client.options.database === database)
    .flatMap((client) =>
      client.query.mock.calls.map(([sql]) => String(sql as string)),
    );
}

beforeEach(() => {
  clients = [];
  onConnect = () => undefined;
  onQuery = () => undefined;
  const ClientMock = Client as unknown as jest.Mock;
  ClientMock.mockReset();
  ClientMock.mockImplementation((options: Record<string, unknown>) => {
    const client: FakeClient = {
      options,
      connect: jest.fn(() => {
        const err = onConnect(options);
        return err ? Promise.reject(err) : Promise.resolve();
      }),
      query: jest.fn((sql: string) => {
        const err = onQuery(sql, options);
        return err
          ? Promise.reject(err)
          : Promise.resolve({ rows: [], fields: [] });
      }),
      end: jest.fn(() => Promise.resolve()),
    };
    clients.push(client);
    return client;
  });
});

// ------------------------------------------------------------ service double

/** The fixture's inventory: one catalog (the database), one schema, every table. */
function inventory(
  tables: string[] = REQUIRED_TABLES,
  database = 'world_cup',
  schema = WORLD_CUP.schema,
): CatalogInfo[] {
  return [
    {
      name: database,
      schemas: [
        {
          name: schema,
          tables: tables.map((name) => ({
            name,
            columns: [
              { name: 'id', type: 'integer', nullable: false },
              { name: 'label', type: 'text', nullable: true },
            ],
          })),
        },
        // A same-named table in another schema must never satisfy a requirement.
        { name: 'public', tables: [{ name: 'teams', columns: [] }] },
      ],
    },
  ];
}

/**
 * The knowledge store as the loader sees it: `list` answers like the real
 * service (entries scoped to the dataset plus every global one) and `create`
 * stores the entry with source `user`, as the real create does.
 */
function knowledgeDouble(initial: KnowledgeSnippet[] = []) {
  const entries = [...initial];
  let next = entries.length;
  return {
    entries,
    list: jest.fn((query: { datasetId?: string } = {}) =>
      Promise.resolve(
        entries.filter(
          (entry) =>
            !query.datasetId ||
            entry.scope == null ||
            entry.scope.datasetId === query.datasetId,
        ),
      ),
    ),
    create: jest.fn((input: KnowledgeSnippetInput) => {
      // Stamped like the real store: the current millisecond.
      const now = new Date().toISOString();
      const saved: KnowledgeSnippet = {
        ...input,
        id: `k-${++next}`,
        scope: input.scope ?? null,
        enabled: input.enabled ?? true,
        source: 'user',
        createdAt: now,
        updatedAt: now,
      };
      entries.push(saved);
      return Promise.resolve(saved);
    }),
  };
}

/** The metrics store: every metric, unique by name. */
function metricsDouble(initial: MetricDoc[] = []) {
  const docs = [...initial];
  let next = docs.length;
  return {
    docs,
    list: jest.fn(() => Promise.resolve(docs)),
    create: jest.fn((input: MetricInput) => {
      const saved: MetricDoc = { ...input, id: `m-${++next}` };
      docs.push(saved);
      return Promise.resolve(saved);
    }),
  };
}

function build(overrides: {
  existing?: unknown[];
  catalogs?: CatalogInfo[];
  datasets?: DatasetDoc[];
  deletedDatasets?: number;
  knowledge?: KnowledgeSnippet[];
  metrics?: MetricDoc[];
}) {
  const datasources = {
    list: jest.fn().mockResolvedValue(overrides.existing ?? []),
    save: jest.fn().mockResolvedValue(savedDatasource),
    delete: jest.fn().mockResolvedValue(savedDatasource),
    inventory: jest.fn().mockResolvedValue({
      catalogs: overrides.catalogs ?? inventory(),
      fetchedAt: '2024-01-01T00:00:00.000Z',
      cached: false,
    }),
  };
  const datasets = {
    list: jest.fn().mockResolvedValue(overrides.datasets ?? []),
    save: jest.fn().mockResolvedValue({ name: TESTING_DATASET_NAME }),
    delete: jest.fn().mockResolvedValue(overrides.deletedDatasets ?? 0),
  };
  const knowledge = knowledgeDouble(overrides.knowledge);
  const metrics = metricsDouble(overrides.metrics);
  const service = new TestingDataService(
    datasources as never,
    datasets as never,
    knowledge as never,
    metrics as never,
  );
  return { service, datasources, datasets, knowledge, metrics };
}

/** The single fixture entry of a status response. */
function viewOf(
  status: TestingDataStatus,
  id = 'world-cup',
): SampleFixtureView {
  const view = status.fixtures.find((fixture) => fixture.id === id);
  if (!view) throw new Error(`No fixture "${id}" in the status response`);
  return view;
}

describe('TestingDataService.load', () => {
  it('rejects an unknown fixture id before touching anything', async () => {
    const { service, datasources, datasets } = build({});

    expect(await service.load('not-a-sample', DEFAULT_INPUT)).toEqual({
      ok: false,
      message: 'Unknown sample fixture "not-a-sample"',
    });
    expect(clients).toHaveLength(0);
    expect(datasources.list).not.toHaveBeenCalled();
    expect(datasources.save).not.toHaveBeenCalled();
    expect(datasets.save).not.toHaveBeenCalled();
  });

  it('refuses a REST fixture before touching anything', async () => {
    const { service, datasources, datasets } = build({});

    const result = await service.load('world-cup-rest', DEFAULT_INPUT);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('scripts/setup-worldcup-rest.ts');
    expect(clients).toHaveLength(0);
    expect(datasources.save).not.toHaveBeenCalled();
    expect(datasets.save).not.toHaveBeenCalled();
  });

  it.each([
    ['world-cup-databricks', 'world-cup'],
    ['finance-databricks', 'finance'],
    ['marketing-analytics-databricks', 'marketing-analytics'],
  ])(
    'refuses the Databricks fixture %s, naming the loader and its sample, before touching anything',
    async (id, source) => {
      const { service, datasources, datasets } = build({});

      const result = await service.load(id, DEFAULT_INPUT);

      expect(result).toEqual({
        ok: false,
        message:
          `The ${findFixture(id)?.name} sample is registered for evals only — load it into ` +
          `Databricks and register it with scripts/setup-fixture-databricks.ts --fixture ${source} ` +
          'instead of loading it here (runbook: docs/evals/databricks-vdi.md).',
      });
      expect(clients).toHaveLength(0);
      expect(datasources.save).not.toHaveBeenCalled();
      expect(datasets.save).not.toHaveBeenCalled();
    },
  );

  it('rejects a bad connection before touching the network', async () => {
    const { service, datasources, datasets } = build({});

    expect(
      await service.load('world-cup', { ...DEFAULT_INPUT, host: '  ' }),
    ).toEqual({
      ok: false,
      message: 'Host is required',
    });
    expect(
      await service.load('world-cup', { ...DEFAULT_INPUT, port: 0 }),
    ).toEqual({
      ok: false,
      message: 'Port must be a positive integer',
    });
    expect(clients).toHaveLength(0);
    expect(datasources.save).not.toHaveBeenCalled();
    expect(datasets.save).not.toHaveBeenCalled();
  });

  it('rejects a database name containing a double quote', async () => {
    const { service, datasources } = build({});

    const result = await service.load('world-cup', {
      ...DEFAULT_INPUT,
      database: 'world"cup',
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('double quote');
    expect(clients).toHaveLength(0);
    expect(datasources.save).not.toHaveBeenCalled();
  });

  it('writes nothing when the connection is refused', async () => {
    const { service, datasources, datasets } = build({});
    onConnect = () =>
      pgError('connect ECONNREFUSED 127.0.0.1:55432', 'ECONNREFUSED');

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('127.0.0.1:55432');
    expect(result.message).toContain('docker compose up -d');
    expect(datasources.save).not.toHaveBeenCalled();
    expect(datasets.save).not.toHaveBeenCalled();
    // Even a failed connect must not leak a socket.
    expect(clients.every((client) => client.end.mock.calls.length > 0)).toBe(
      true,
    );
  });

  it('names the host and the user when authentication fails', async () => {
    const { service, datasources } = build({});
    onConnect = () =>
      pgError('password authentication failed for user "world_cup"', '28P01');

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('127.0.0.1:55432');
    expect(result.message).toContain('password authentication failed');
    expect(result.message).not.toContain('world_cup_dev');
    expect(datasources.save).not.toHaveBeenCalled();
  });

  it('creates the database when it does not exist, then seeds it', async () => {
    const { service, datasets } = build({});
    let exists = false;
    onConnect = (options) =>
      options.database === 'world_cup' && !exists
        ? pgError('database "world_cup" does not exist', '3D000')
        : undefined;
    onQuery = (sql) => {
      if (sql.startsWith('CREATE DATABASE')) exists = true;
      return undefined;
    };

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.ok).toBe(true);
    expect(result.createdDatabase).toBe(true);
    expect(result.message).toContain('created the database');
    expect(queriesOn('postgres')).toEqual(['CREATE DATABASE "world_cup"']);
    const seeded = queriesOn('world_cup');
    expect(seeded[0]).toBe('DROP SCHEMA IF EXISTS "world_cup" CASCADE');
    expect(seeded.join('\n')).toContain('CREATE SCHEMA world_cup');
    expect(datasets.save).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the database is missing and cannot be created', async () => {
    const { service, datasources, datasets } = build({});
    onConnect = (options) =>
      options.database === 'world_cup'
        ? pgError('database "world_cup" does not exist', '3D000')
        : undefined;
    onQuery = (sql) =>
      sql.startsWith('CREATE DATABASE')
        ? pgError('permission denied to create database', '42501')
        : undefined;

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('does not exist');
    expect(result.message).toContain('could not create it');
    expect(datasources.save).not.toHaveBeenCalled();
    expect(datasets.save).not.toHaveBeenCalled();
  });

  it('seeds the fixture and saves the datasource and dataset', async () => {
    const { service, datasources, datasets } = build({});

    const result = await service.load('world-cup', DEFAULT_INPUT);

    const seeded = queriesOn('world_cup');
    expect(seeded[0]).toBe('DROP SCHEMA IF EXISTS "world_cup" CASCADE');
    // The script is replayed in bounded batches wrapped in one transaction:
    // a whole dump in a single query exhausts the server's shared memory.
    expect(seeded[1]).toBe('BEGIN');
    expect(seeded[seeded.length - 1]).toBe('COMMIT');
    expect(seeded.length).toBeGreaterThan(2);
    const body = seeded.slice(2, -1).join('\n');
    expect(body).toContain('CREATE TABLE match_team_statistics');
    // The dump's own BEGIN/COMMIT must not nest inside ours.
    expect(
      seeded.slice(2, -1).some((sql) => /^(BEGIN|COMMIT);?$/m.test(sql)),
    ).toBe(false);
    expect(clients.every((client) => client.end.mock.calls.length > 0)).toBe(
      true,
    );

    expect(datasources.save).toHaveBeenCalledWith({
      id: undefined,
      name: TESTING_DATASOURCE_NAME,
      kind: 'postgres',
      config: {
        host: '127.0.0.1',
        port: 55432,
        database: 'world_cup',
        user: 'world_cup',
        password: 'world_cup_dev',
        ssl: false,
      },
    });
    expect(datasources.inventory).toHaveBeenCalledWith('ds-1', true);

    const [saved] = datasets.save.mock.calls[0] as [
      {
        name: string;
        tables: string[];
        entities: { key: string; columns: unknown[] }[];
        datasourceId: string;
      },
    ];
    expect(saved.name).toBe(TESTING_DATASET_NAME);
    expect(saved.datasourceId).toBe('ds-1');
    expect(saved.tables).toEqual(REQUIRED_ENTITY_KEYS);
    expect(saved.entities).toHaveLength(10);
    expect(saved.entities[0]).toEqual({
      key: 'world_cup.world_cup.tournaments',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'label', type: 'text', nullable: true },
      ],
    });
    expect(result).toEqual({
      ok: true,
      message:
        'Seeded world_cup on 127.0.0.1:55432 and loaded 10 entities into dataset "World Cup"',
      datasourceId: 'ds-1',
      datasetName: TESTING_DATASET_NAME,
      entityCount: 10,
      createdDatabase: false,
      seeded: true,
    });
  });

  it('reuses the existing datasource instead of creating a duplicate', async () => {
    const { service, datasources, datasets } = build({
      existing: [
        { id: 'other', name: 'Some other datasource' },
        loadedDatasourceView,
      ],
    });

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.ok).toBe(true);
    expect(datasources.save).toHaveBeenCalledTimes(1);
    expect(datasources.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ds-1', name: TESTING_DATASOURCE_NAME }),
    );
    // Upsert-by-name on the dataset side: one save, one dataset.
    expect(datasets.save).toHaveBeenCalledTimes(1);
  });

  it('reports the entity that is still missing after seeding', async () => {
    const { service, datasets } = build({
      catalogs: inventory(
        REQUIRED_TABLES.filter((table) => table !== 'v_player_goal_totals'),
      ),
    });

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      'Missing entities after seeding: world_cup.world_cup.v_player_goal_totals',
    );
    expect(datasets.save).not.toHaveBeenCalled();
  });

  it('derives the entity keys from the supplied database name', async () => {
    const { service, datasets } = build({
      catalogs: inventory(REQUIRED_TABLES, 'wc_demo'),
    });

    const result = await service.load('world-cup', {
      ...DEFAULT_INPUT,
      database: 'wc_demo',
    });

    expect(result.ok).toBe(true);
    const [saved] = datasets.save.mock.calls[0] as [{ tables: string[] }];
    expect(saved.tables[0]).toBe('wc_demo.world_cup.tournaments');
  });
});

/**
 * A domain sample's knowledge seed (R26), created by the loader after the
 * dataset is saved. Driven by the Health Insurance registry entry and its
 * seed, never by a local copy of them.
 */
describe('TestingDataService.load — knowledge seeds (R26)', () => {
  const HEALTH = findFixture('health-insurance') as SampleFixture;
  const SEED = HEALTH.knowledge as KnowledgeSeed;
  const ENTRIES = SEED.knowledge.length;
  const METRICS = SEED.metrics.length;
  const ofKind = (kind: string) =>
    SEED.knowledge.filter((entry) => entry.kind === kind);
  /** Spec order: the entry sent first is created last (knowledge R16). */
  const SEND_ORDER = [
    ...ofKind('default_filter'),
    ...ofKind('instruction'),
    ...ofKind('term'),
  ];
  const CREATION_ORDER = [...SEND_ORDER].reverse();
  const DATABASE = 'hi_demo';
  const INPUT = { ...DEFAULT_INPUT, database: DATABASE };
  const LOADED =
    'Seeded health_insurance on 127.0.0.1:55432 and loaded 12 entities ' +
    'into dataset "Health Insurance"';

  const catalogs = () =>
    inventory(HEALTH.requiredTables, DATABASE, 'health_insurance');
  const titles = (entries: KnowledgeSnippet[]) =>
    entries.map((entry) => `${entry.kind}:${entry.title}`);

  it('ships a seed with several entries and metrics, so the message is plural', () => {
    expect(ENTRIES).toBeGreaterThan(1);
    expect(METRICS).toBeGreaterThan(1);
  });

  it('creates every entry, enabled and scoped to the dataset, after the dataset is saved', async () => {
    const { service, datasets, knowledge, metrics } = build({
      catalogs: catalogs(),
    });

    const result = await service.load('health-insurance', INPUT);

    expect(result).toEqual({
      ok: true,
      message: `${LOADED} — added ${ENTRIES} knowledge entries and ${METRICS} metrics`,
      datasourceId: 'ds-1',
      datasetName: 'Health Insurance',
      entityCount: 12,
      createdDatabase: false,
      seeded: true,
    });
    expect(knowledge.create).toHaveBeenCalledTimes(ENTRIES);
    CREATION_ORDER.forEach((entry, at) => {
      expect(knowledge.create.mock.calls[at][0]).toEqual({
        kind: entry.kind,
        scope: { datasetId: 'Health Insurance' },
        title: entry.title,
        body: entry.body,
        ...(entry.synonyms ? { synonyms: entry.synonyms } : {}),
        // `<database>.<schema>.<table>` on the database this load used.
        entities: entry.entities.map((entity) => `${DATABASE}.${entity}`),
        enabled: true,
      });
    });
    expect(knowledge.entries.every((entry) => entry.source === 'user')).toBe(
      true,
    );
    expect(metrics.create).toHaveBeenCalledTimes(METRICS);
    SEED.metrics.forEach((metric, at) => {
      expect(metrics.create.mock.calls[at][0]).toEqual({
        name: metric.name,
        label: metric.label,
        ...(metric.description ? { description: metric.description } : {}),
        entity: `${DATABASE}.${metric.entity}`,
        datasourceId: 'ds-1',
        expression: metric.expression,
      });
    });
    // Only once the load itself has succeeded.
    expect(datasets.save.mock.invocationCallOrder[0]).toBeLessThan(
      knowledge.create.mock.invocationCallOrder[0],
    );
  });

  it('creates the terms first in reverse seed order, then the instructions, and the default filters last', async () => {
    const { service, knowledge } = build({ catalogs: catalogs() });

    await service.load('health-insurance', INPUT);

    const created = knowledge.create.mock.calls.map(([input]) => input);
    const kinds = created.map((input) => input.kind);
    const terms = ofKind('term').length;
    const instructions = ofKind('instruction').length;
    expect(kinds).toEqual([
      ...Array<string>(terms).fill('term'),
      ...Array<string>(instructions).fill('instruction'),
      ...Array<string>(ofKind('default_filter').length).fill('default_filter'),
    ]);
    expect(created.map((input) => input.title)).toEqual([
      ...ofKind('term')
        .map((entry) => entry.title)
        .reverse(),
      ...ofKind('instruction')
        .map((entry) => entry.title)
        .reverse(),
      ...ofKind('default_filter')
        .map((entry) => entry.title)
        .reverse(),
    ]);
    // Each entry is stamped strictly after the one before, so the block's
    // newest-first order is exactly the send order, with no ties to break.
    const stamps = knowledge.entries.map((entry) =>
      Date.parse(entry.updatedAt),
    );
    stamps.slice(1).forEach((stamp, at) => {
      expect(stamp).toBeGreaterThan(stamps[at]);
    });
    const newestFirst = [...knowledge.entries].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    expect(newestFirst.map((entry) => entry.title)).toEqual(
      SEND_ORDER.map((entry) => entry.title),
    );
  });

  it('creates nothing on a second load, and the message says nothing about knowledge', async () => {
    const { service, knowledge, metrics } = build({ catalogs: catalogs() });
    await service.load('health-insurance', INPUT);

    const again = await service.load('health-insurance', INPUT);

    expect(again.ok).toBe(true);
    expect(again.message).toBe(LOADED);
    expect(knowledge.create).toHaveBeenCalledTimes(ENTRIES);
    expect(metrics.create).toHaveBeenCalledTimes(METRICS);
    const listed = titles(knowledge.entries);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('keeps an edited entry as edited and brings back a deleted one, in the singular', async () => {
    const { service, knowledge, metrics } = build({ catalogs: catalogs() });
    await service.load('health-insurance', INPUT);
    const edited = knowledge.entries[0];
    edited.body = 'Our own wording of the status rule.';
    edited.enabled = false;
    const deleted = knowledge.entries.splice(1, 1)[0];
    const deletedMetric = metrics.docs.splice(0, 1)[0];

    const again = await service.load('health-insurance', INPUT);

    expect(again.message).toBe(
      `${LOADED} — added 1 knowledge entry and 1 metric`,
    );
    expect(edited.body).toBe('Our own wording of the status rule.');
    expect(edited.enabled).toBe(false);
    expect(knowledge.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: deleted.kind, title: deleted.title }),
    );
    expect(metrics.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: deletedMetric.name }),
    );
    const listed = titles(knowledge.entries);
    expect(listed).toHaveLength(ENTRIES);
    expect(new Set(listed).size).toBe(ENTRIES);
  });

  it('holds an entry only by kind and title on that dataset, and a metric by name', async () => {
    const [first, second] = SEED.knowledge;
    const other = (overrides: Partial<KnowledgeSnippet>): KnowledgeSnippet => ({
      id: `held-${overrides.title}-${String(overrides.scope?.datasetId)}`,
      kind: first.kind,
      scope: { datasetId: 'Health Insurance' },
      title: first.title,
      body: 'Written by hand.',
      enabled: true,
      source: 'user',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      ...overrides,
    });
    const userMetric: MetricDoc = {
      id: 'mine',
      name: SEED.metrics[0].name,
      label: 'My version',
      entity: 'elsewhere.health_insurance.claims',
      expression: 'COUNT(*)',
    };
    const { service, knowledge, metrics } = build({
      catalogs: catalogs(),
      knowledge: [
        // Not held: global, another dataset, another kind.
        other({ scope: null }),
        other({ scope: { datasetId: 'Genomics' } }),
        other({
          kind: first.kind === 'instruction' ? 'term' : 'instruction',
        }),
        // Held: same kind, the title re-cased by hand, on this dataset.
        other({
          kind: second.kind,
          title: `  ${second.title.toUpperCase()} `,
        }),
      ],
      metrics: [userMetric],
    });

    const result = await service.load('health-insurance', INPUT);

    expect(result.message).toBe(
      `${LOADED} — added ${ENTRIES - 1} knowledge entries and ${METRICS - 1} metrics`,
    );
    expect(knowledge.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: second.title }),
    );
    expect(knowledge.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: first.title }),
    );
    expect(metrics.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: userMetric.name }),
    );
    expect(metrics.docs.find((doc) => doc.id === 'mine')).toEqual(userMetric);
  });

  it('puts the seed after "created the database"', async () => {
    const { service } = build({ catalogs: catalogs() });
    let exists = false;
    onConnect = (options) =>
      options.database === DATABASE && !exists
        ? pgError(`database "${DATABASE}" does not exist`, '3D000')
        : undefined;
    onQuery = (sql) => {
      if (sql.startsWith('CREATE DATABASE')) exists = true;
      return undefined;
    };

    const result = await service.load('health-insurance', INPUT);

    expect(result.message).toBe(
      `${LOADED} — created the database — added ${ENTRIES} knowledge entries and ${METRICS} metrics`,
    );
  });

  it('creates no knowledge when the seed SQL fails', async () => {
    const { service, knowledge, metrics } = build({ catalogs: catalogs() });
    onQuery = (sql) =>
      sql.includes('CREATE TABLE claims')
        ? pgError('relation "claims" already exists', '42P07')
        : undefined;

    const result = await service.load('health-insurance', INPUT);

    expect(result.ok).toBe(false);
    expect(knowledge.list).not.toHaveBeenCalled();
    expect(knowledge.create).not.toHaveBeenCalled();
    expect(metrics.create).not.toHaveBeenCalled();
  });

  it('creates no knowledge when the inventory misses an entity', async () => {
    const { service, knowledge, metrics } = build({
      catalogs: inventory(
        HEALTH.requiredTables.filter((table) => table !== 'claims'),
        DATABASE,
        'health_insurance',
      ),
    });

    const result = await service.load('health-insurance', INPUT);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Missing entities after seeding');
    expect(knowledge.create).not.toHaveBeenCalled();
    expect(metrics.create).not.toHaveBeenCalled();
  });

  it('still succeeds when an entry cannot be saved, says why, and keeps what it created', async () => {
    const { service, knowledge, metrics } = build({ catalogs: catalogs() });
    const create = knowledge.create.getMockImplementation() as (
      input: KnowledgeSnippetInput,
    ) => Promise<KnowledgeSnippet>;
    knowledge.create.mockImplementation((input) =>
      knowledge.create.mock.calls.length === 3
        ? Promise.reject(new BadRequestException('body is required'))
        : create(input),
    );

    const result = await service.load('health-insurance', INPUT);

    expect(result.ok).toBe(true);
    expect(result.datasetName).toBe('Health Insurance');
    expect(result.message).toBe(
      `${LOADED} — could not add its knowledge seed: body is required`,
    );
    expect(knowledge.entries).toHaveLength(2);
    expect(metrics.create).not.toHaveBeenCalled();
  });

  it('reports a metric that cannot be saved the same way', async () => {
    const { service, knowledge, metrics } = build({ catalogs: catalogs() });
    metrics.create.mockRejectedValueOnce(
      new BadRequestException(
        'Metric expression must be a single SQL expression (no semicolons)',
      ),
    );

    const result = await service.load('health-insurance', INPUT);

    expect(result.ok).toBe(true);
    expect(result.message).toBe(
      `${LOADED} — could not add its knowledge seed: Metric expression must be a single SQL expression (no semicolons)`,
    );
    expect(knowledge.entries).toHaveLength(ENTRIES);
  });

  it('creates no knowledge entry or metric for the World Cup sample', async () => {
    const { service, knowledge, metrics } = build({});

    const result = await service.load('world-cup', DEFAULT_INPUT);

    expect(result.message).toBe(
      'Seeded world_cup on 127.0.0.1:55432 and loaded 10 entities into dataset "World Cup"',
    );
    expect(knowledge.list).not.toHaveBeenCalled();
    expect(knowledge.create).not.toHaveBeenCalled();
    expect(metrics.list).not.toHaveBeenCalled();
    expect(metrics.create).not.toHaveBeenCalled();
  });

  it('leaves the knowledge entries and metrics when the sample is removed (R18)', async () => {
    const { service, knowledge, metrics } = build({
      catalogs: catalogs(),
      existing: [loadedDatasourceView],
      deletedDatasets: 1,
    });
    await service.load('health-insurance', INPUT);

    await service.clear('health-insurance');

    expect(knowledge.entries).toHaveLength(ENTRIES);
    expect(metrics.docs).toHaveLength(METRICS);
  });

  it.each(['finance', 'genomics', 'supply-chain', 'marketing-analytics'])(
    'creates the %s seed on its own database',
    async (id) => {
      const fixture = findFixture(id) as SampleFixture;
      const seed = fixture.knowledge as KnowledgeSeed;
      const { service, knowledge, metrics } = build({
        catalogs: inventory(fixture.requiredTables, 'demo', fixture.schema),
      });

      const result = await service.load(id, {
        ...DEFAULT_INPUT,
        database: 'demo',
      });

      expect(result.ok).toBe(true);
      expect(result.message).toMatch(
        new RegExp(
          ` — added ${seed.knowledge.length} knowledge entries and ${seed.metrics.length} metrics$`,
        ),
      );
      expect(knowledge.entries).toHaveLength(seed.knowledge.length);
      for (const entry of knowledge.entries) {
        expect(entry.scope).toEqual({ datasetId: fixture.datasetName });
        for (const entity of entry.entities ?? []) {
          expect(entity.startsWith(`demo.${fixture.schema}.`)).toBe(true);
        }
      }
      expect(metrics.docs.map((doc) => doc.entity)).toEqual(
        seed.metrics.map((metric) => `demo.${metric.entity}`),
      );
    },
  );
});

describe('knowledgeSeedSuffix', () => {
  it.each([
    [
      { knowledge: 9, metrics: 3 },
      ' — added 9 knowledge entries and 3 metrics',
    ],
    [{ knowledge: 1, metrics: 1 }, ' — added 1 knowledge entry and 1 metric'],
    [{ knowledge: 2, metrics: 0 }, ' — added 2 knowledge entries'],
    [{ knowledge: 0, metrics: 1 }, ' — added 1 metric'],
    [{ knowledge: 0, metrics: 0 }, ''],
    [
      { knowledge: 2, metrics: 0, error: 'title is required' },
      ' — could not add its knowledge seed: title is required',
    ],
  ])('%j ends the message with "%s"', (outcome, suffix) => {
    expect(knowledgeSeedSuffix(outcome)).toBe(suffix);
  });
});

/**
 * A sample too large to bundle: the registry entry carries no `seedFile`, so
 * the panel can point the app at a database that already holds the data.
 * Registered here only for the duration of these tests — the shipped registry
 * still has exactly one entry.
 */
describe('a register-only fixture (no bundled SQL)', () => {
  const REGISTER_ONLY: SampleFixture = {
    id: 'register-only',
    name: 'Register Only',
    description: 'A sample too large to bundle; the database already has it.',
    schema: 'huge',
    defaults: {
      host: 'db.internal',
      port: 5432,
      database: 'huge',
      user: 'reader',
      password: '',
      ssl: true,
    },
    datasourceName: 'Register Only PostgreSQL',
    datasetName: 'Register Only',
    requiredTables: ['alpha', 'beta'],
  };

  beforeEach(() => SAMPLE_FIXTURES.push(REGISTER_ONLY));
  afterEach(() => {
    const at = SAMPLE_FIXTURES.indexOf(REGISTER_ONLY);
    if (at >= 0) SAMPLE_FIXTURES.splice(at, 1);
  });

  const input = {
    host: 'db.internal',
    port: 5432,
    database: 'huge',
    user: 'reader',
    password: 'secret',
    ssl: true,
  };

  it('skips DROP SCHEMA and the seed, and still registers both records', async () => {
    const { service, datasources, datasets } = build({
      catalogs: inventory(REGISTER_ONLY.requiredTables, 'huge', 'huge'),
    });

    const result = await service.load('register-only', input);

    // No SQL at all: the connection is a preflight, nothing is written.
    expect(queriesOn('huge')).toEqual([]);
    expect(clients.every((client) => client.end.mock.calls.length > 0)).toBe(
      true,
    );
    expect(datasources.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Register Only PostgreSQL',
        kind: 'postgres',
      }),
    );
    const [saved] = datasets.save.mock.calls[0] as [
      { name: string; tables: string[] },
    ];
    expect(saved.name).toBe('Register Only');
    expect(saved.tables).toEqual(['huge.huge.alpha', 'huge.huge.beta']);
    expect(result.message).toContain('nothing was written to the database');
    // Exhaustive, so a stray field would fail: the message is asserted above.
    expect(result).toEqual({
      ok: true,
      message: result.message,
      datasourceId: 'ds-1',
      datasetName: 'Register Only',
      entityCount: 2,
      createdDatabase: false,
      seeded: false,
    });
  });

  it('does not create the database it cannot seed', async () => {
    const { service, datasources, datasets } = build({});
    onConnect = (options) =>
      options.database === 'huge'
        ? pgError('database "huge" does not exist', '3D000')
        : undefined;

    const result = await service.load('register-only', input);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('ships no seed SQL');
    expect(queriesOn('postgres')).toEqual([]);
    expect(datasources.save).not.toHaveBeenCalled();
    expect(datasets.save).not.toHaveBeenCalled();
  });

  it('is reported as not seedable, alongside the seedable samples', async () => {
    const { service } = build({});

    const status = await service.status();

    expect(status.fixtures.map((fixture) => fixture.id)).toEqual([
      'world-cup',
      'formula-1',
      'intellify',
      'world-cup-rest',
      'intellify-api',
      'finance',
      'health-insurance',
      'genomics',
      'supply-chain',
      'marketing-analytics',
      'finance-rest',
      'marketing-analytics-rest',
      'world-cup-rest-connector',
      'world-cup-databricks',
      'finance-databricks',
      'marketing-analytics-databricks',
      'register-only',
    ]);
    expect(viewOf(status, 'world-cup').seedable).toBe(true);
    const view = viewOf(status, 'register-only');
    expect(view.seedable).toBe(false);
    expect(view.defaults).toEqual(REGISTER_ONLY.defaults);
    expect(view.status).toEqual({ loaded: false, requiredCount: 2 });
  });
});

describe('TestingDataService.clear', () => {
  it('removes both records without running any SQL', async () => {
    const { service, datasources, datasets } = build({
      existing: [loadedDatasourceView],
      deletedDatasets: 1,
    });

    const result = await service.clear('world-cup');

    expect(result.ok).toBe(true);
    expect(datasets.delete).toHaveBeenCalledWith(TESTING_DATASET_NAME);
    expect(datasources.delete).toHaveBeenCalledWith('ds-1');
    expect(clients).toHaveLength(0);
    expect(result.message).toContain('left untouched');
  });

  it('is a no-op when nothing is loaded', async () => {
    const { service, datasources } = build({});

    const result = await service.clear('world-cup');

    expect(result.ok).toBe(true);
    expect(result.message).toContain('Nothing to remove');
    expect(datasources.delete).not.toHaveBeenCalled();
    expect(clients).toHaveLength(0);
  });

  it('refuses an unknown fixture id and deletes nothing', async () => {
    const { service, datasources, datasets } = build({
      existing: [loadedDatasourceView],
      deletedDatasets: 1,
    });

    expect(await service.clear('not-a-sample')).toEqual({
      ok: false,
      message: 'Unknown sample fixture "not-a-sample"',
    });
    expect(datasets.delete).not.toHaveBeenCalled();
    expect(datasources.delete).not.toHaveBeenCalled();
  });
});

describe('TestingDataService.status', () => {
  const defaults = {
    host: '127.0.0.1',
    port: 55432,
    database: 'world_cup',
    user: 'world_cup',
    password: 'world_cup_dev',
    ssl: false,
  };

  it('describes every registered fixture, loaded or not', async () => {
    const { service, datasets } = build({});

    const status = await service.status();

    expect(status.fixtures).toHaveLength(SAMPLE_FIXTURES.length);
    expect(viewOf(status)).toEqual({
      id: 'world-cup',
      name: 'World Cup',
      description: WORLD_CUP.description,
      seedable: true,
      schema: 'world_cup',
      selfRegistering: false,
      defaults,
      status: { loaded: false, requiredCount: 10 },
    });
    // Nothing is registered, so the datasets never need reading.
    expect(datasets.list).not.toHaveBeenCalled();
  });

  it('shows a registered Databricks sample as loaded, with no PostgreSQL connection', async () => {
    const sample = findFixture('world-cup-databricks') as SampleFixture;
    const { service } = build({
      existing: [
        {
          id: 'dbx-1',
          name: sample.datasourceName,
          kind: 'databricks',
          config: {
            host: 'adb-1.azuredatabricks.net',
            token: '********',
            warehouseId: 'abc123',
          },
        },
      ],
      datasets: [
        {
          name: sample.datasetName,
          tables: sample.requiredTables.map(
            (table) => `evals.${sample.schema}.${table}`,
          ),
        },
      ],
    });

    expect(viewOf(await service.status(), sample.id).status).toEqual({
      loaded: true,
      datasourceId: 'dbx-1',
      datasourceName: 'World Cup Databricks',
      datasetName: 'World Cup (Databricks)',
      entityCount: 10,
      requiredCount: 10,
    });
  });

  it('is not loaded when the dataset is missing entities', async () => {
    const { service } = build({
      existing: [loadedDatasourceView],
      datasets: [
        {
          name: TESTING_DATASET_NAME,
          tables: REQUIRED_ENTITY_KEYS.slice(0, 8),
        },
      ],
    });

    expect(viewOf(await service.status()).status).toEqual({
      loaded: false,
      datasourceId: 'ds-1',
      datasourceName: TESTING_DATASOURCE_NAME,
      datasetName: TESTING_DATASET_NAME,
      entityCount: 8,
      requiredCount: 10,
      connection: {
        host: '127.0.0.1',
        port: 55432,
        database: 'world_cup',
        user: 'world_cup',
        ssl: false,
      },
    });
  });

  it('is not loaded when the datasource exists but the dataset does not', async () => {
    const { service } = build({
      existing: [loadedDatasourceView],
      datasets: [{ name: 'Unrelated', tables: [] }],
    });

    expect(viewOf(await service.status()).status).toEqual({
      loaded: false,
      datasourceId: 'ds-1',
      datasourceName: TESTING_DATASOURCE_NAME,
      requiredCount: 10,
      connection: {
        host: '127.0.0.1',
        port: 55432,
        database: 'world_cup',
        user: 'world_cup',
        ssl: false,
      },
    });
  });

  it('is loaded once the dataset covers all ten entities, and never echoes a password', async () => {
    const { service } = build({
      existing: [loadedDatasourceView],
      datasets: [
        { name: 'Unrelated', tables: [] },
        { name: TESTING_DATASET_NAME, tables: REQUIRED_ENTITY_KEYS },
      ],
    });

    const view = viewOf(await service.status());

    expect(view.status.loaded).toBe(true);
    expect(view.status.entityCount).toBe(10);
    expect(view.status.requiredCount).toBe(10);
    expect(view.defaults).toEqual(defaults);
    expect(view.status.connection).toEqual({
      host: '127.0.0.1',
      port: 55432,
      database: 'world_cup',
      user: 'world_cup',
      ssl: false,
    });
    expect(view.status.connection).not.toHaveProperty('password');
    expect(JSON.stringify(view.status.connection)).not.toContain('*');
  });
});

describe('TestingDataService.describe', () => {
  it('lists the registry without reading a single store', () => {
    const { service, datasources, datasets } = build({});

    expect(service.describe()).toEqual({
      fixtures: SAMPLE_FIXTURES.map((fixture) => ({
        id: fixture.id,
        name: fixture.name,
        description: fixture.description,
        seedable: Boolean(fixture.seedFile),
        schema: fixture.schema,
        selfRegistering: Boolean(fixture.selfRegistering),
        defaults: fixture.defaults,
        status: {
          loaded: false,
          requiredCount: fixture.requiredTables.length,
        },
      })),
    });
    expect(datasources.list).not.toHaveBeenCalled();
    expect(datasets.list).not.toHaveBeenCalled();
  });
});

describe('TestingDataService.load — self-registering intellify-api (R21)', () => {
  const API = findFixture('intellify-api') as SampleFixture;
  const INFO: IntellifyApiInfo = {
    url: 'http://127.0.0.1:3100',
    apiKey: 'k-1',
  };
  const PATHS = API.requiredTables.map((t) => `/v1/${t.replace(/_/g, '-')}`);
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  function health(body: unknown, status = 200) {
    fetchMock.mockResolvedValue({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    });
  }

  function discovery(paths: string[]) {
    return {
      specUrl: `${INFO.url}/openapi.json`,
      baseUrl: INFO.url,
      skipped: [],
      endpoints: paths.map((path) => ({
        method: 'GET',
        listResponse: true,
        endpoint: {
          name: path.split('/').pop() as string,
          group: 'v1',
          path,
          rowsPointer: '/data',
          pagination: {
            style: 'page',
            pageParam: 'page',
            sizeParam: 'per_page',
          },
        },
      })),
    };
  }

  function buildApi(paths: string[] | Error) {
    const made = build({
      catalogs: inventory(API.requiredTables, 'api', 'intellify'),
    });
    (made.datasources as Record<string, jest.Mock>).discoverRestEndpoints =
      paths instanceof Error
        ? jest.fn().mockRejectedValue(paths)
        : jest.fn().mockResolvedValue(discovery(paths));
    return made as typeof made & {
      datasources: { discoverRestEndpoints: jest.Mock };
    };
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    setIntellifyApiInfo(INFO);
  });
  afterEach(() => {
    global.fetch = realFetch;
    setIntellifyApiInfo(null);
  });

  it('says so when the API is not running, touching nothing', async () => {
    setIntellifyApiInfo(null);
    const { service, datasources } = buildApi(PATHS);

    const result = await service.load('intellify-api', {});

    expect(result).toEqual({
      ok: false,
      message:
        'The Intellify API is not running in this app (INTELLIFY_API=off or it failed to start) — see the system logs.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(datasources.save).not.toHaveBeenCalled();
  });

  it('names the database when the API reports it down', async () => {
    health({ ok: false, database: 'down' }, 503);
    const { service, datasources } = buildApi(PATHS);

    const result = await service.load('intellify-api', {});

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(
      /^The Intellify API cannot reach its database at .+:\d+\/.+\. Load the "Intellify" sample into that database first\.$/,
    );
    expect(datasources.save).not.toHaveBeenCalled();
  });

  it('registers the datasource and dataset from discovery', async () => {
    health({ ok: true, database: 'up' });
    const { service, datasources, datasets } = buildApi(PATHS);

    const result = await service.load('intellify-api', {});

    expect(result).toMatchObject({
      ok: true,
      message:
        'Registered the Intellify RFP API at http://127.0.0.1:3100 and loaded 10 entities into dataset "Intellify RFP API"',
      entityCount: 10,
      datasetName: 'Intellify RFP API',
    });
    const saved = (datasources.save.mock.calls as unknown[][])[0][0] as {
      name: string;
      kind: string;
      config: {
        baseUrl: string;
        auth: unknown;
        endpoints: { name: string; group: string }[];
      };
    };
    expect(saved.name).toBe('Intellify RFP API');
    expect(saved.kind).toBe('rest');
    expect(saved.config.baseUrl).toBe(INFO.url);
    expect(saved.config.auth).toEqual({
      type: 'api-key-header',
      headerName: 'X-API-Key',
      token: 'k-1',
    });
    expect(saved.config.endpoints.map((e) => e.name)).toEqual(
      API.requiredTables,
    );
    expect(saved.config.endpoints.every((e) => e.group === 'intellify')).toBe(
      true,
    );
    expect(datasources.inventory).toHaveBeenCalledWith('ds-1', true);
    const dataset = (datasets.save.mock.calls as unknown[][])[0][0] as {
      tables: string[];
    };
    expect(dataset.tables).toContain('api.intellify.funding_types');
    expect(dataset.tables).toHaveLength(10);
  });

  it('falls back to explicit endpoint definitions and reuses the record', async () => {
    health({ ok: true, database: 'up' });
    const { service, datasources } = buildApi(new Error('no spec'));
    datasources.list.mockResolvedValue([
      { id: 'ds-9', name: 'Intellify RFP API' },
    ]);

    const result = await service.load('intellify-api', {});

    expect(result.ok).toBe(true);
    const saved = (datasources.save.mock.calls as unknown[][])[0][0] as {
      id: string;
      config: { endpoints: Record<string, unknown>[] };
    };
    expect(saved.id).toBe('ds-9');
    expect(saved.config.endpoints).toHaveLength(10);
    expect(saved.config.endpoints[2]).toMatchObject({
      name: 'funding_types',
      path: '/v1/funding-types',
      rowsPointer: '/data',
      pagination: {
        style: 'page',
        pageParam: 'page',
        sizeParam: 'per_page',
        pageSize: 100,
      },
    });
  });

  it('exposes the API URL on the catalogue entry', () => {
    const { service } = buildApi(PATHS);
    const view = service
      .describe()
      .fixtures.find((f) => f.id === 'intellify-api');
    expect(view).toMatchObject({
      selfRegistering: true,
      apiUrl: INFO.url,
      seedable: false,
    });
  });
});
