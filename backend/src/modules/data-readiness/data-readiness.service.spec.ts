// Keep the real connectors (and their drivers) out of this unit test.
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../datasources/connectors/postgres-profiling', () => ({
  PostgresProfiler: class {},
}));
jest.mock('../datasources/connectors/databricks-profiling', () => ({
  DatabricksProfiler: class {},
}));

import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  DataReadinessService,
  entityRefFromKey,
} from './data-readiness.service';
import { profilePostgres } from './adapters/postgres.adapter';
import { profileDatabricks } from './adapters/databricks.adapter';
import { runAssessment } from './engine/check-engine';
import { DEFAULT_THRESHOLDS } from './engine/types';
import type {
  EngineResult,
  EntityProfile,
  ReadinessReport,
  SourceProfile,
} from './engine/types';
import type { DatasourcesService } from '../datasources/datasources.service';
import type { PostgresProfiler } from '../datasources/connectors/postgres-profiling';
import type { DatabricksProfiler } from '../datasources/connectors/databricks-profiling';
import type { DataReadinessRepository } from './data-readiness.repository';
import type { Datasource } from '../datasources/entities/datasource.entity';

jest.mock('./adapters/postgres.adapter');
jest.mock('./adapters/databricks.adapter');
jest.mock('./engine/check-engine');

const mockPostgres = jest.mocked(profilePostgres);
const mockDatabricks = jest.mocked(profileDatabricks);
const mockEngine = jest.mocked(runAssessment);

const NOW = new Date('2026-05-04T10:00:00.000Z');

const entity = (namespace: string, name: string): EntityProfile => ({
  namespace,
  name,
  rowCount: 1,
  fields: [],
  keys: [],
});

const profile = (entities: EntityProfile[]): SourceProfile => ({
  sourceId: 'ds-pg',
  sourceType: 'postgres',
  entities,
  relationships: [
    {
      fromNamespace: 'public',
      fromEntity: 'orders',
      fromField: 'customer_id',
      toNamespace: 'public',
      toEntity: 'customers',
      toField: 'id',
    },
  ],
});

const engineResult = (entityCount: number): EngineResult => ({
  findings: [],
  dimensionScores: [],
  overallScore: 72,
  maturity: 'Defined',
  entityCount,
});

const datasources: Record<string, Datasource> = {
  'ds-pg': {
    id: 'ds-pg',
    name: 'Sales PG',
    kind: 'postgres',
    config: {
      host: 'h',
      port: 5432,
      database: 'sales',
      user: 'u',
      password: 'p',
    },
  } as unknown as Datasource,
  'ds-dbx': {
    id: 'ds-dbx',
    name: 'Lakehouse',
    kind: 'databricks',
    config: { host: 'x', token: 't', warehouseId: 'w' },
  } as unknown as Datasource,
  'ds-rest': {
    id: 'ds-rest',
    name: 'API',
    kind: 'rest',
    config: {},
  } as unknown as Datasource,
};

function build() {
  const ds = {
    get: jest.fn((id: string) => {
      const found = datasources[id];
      return found
        ? Promise.resolve(found)
        : Promise.reject(new NotFoundException(`Datasource ${id} not found`));
    }),
  };
  const stored: ReadinessReport[] = [];
  const repository = {
    insert: jest.fn((r: ReadinessReport) => {
      stored.push(r);
      return Promise.resolve(r);
    }),
    listByDatasource: jest.fn(),
    get: jest.fn(),
  };
  const postgres = { kind: 'postgres' } as unknown as PostgresProfiler;
  const databricks = { kind: 'databricks' } as unknown as DatabricksProfiler;
  const service = new DataReadinessService(
    ds as unknown as DatasourcesService,
    postgres,
    databricks,
    repository as unknown as DataReadinessRepository,
  );
  return { service, ds, repository, postgres, databricks, stored };
}

describe('DataReadinessService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockPostgres.mockResolvedValue(
      profile([entity('public', 'orders'), entity('public', 'customers')]),
    );
    mockDatabricks.mockResolvedValue({
      sourceId: 'ds-dbx',
      sourceType: 'databricks',
      entities: [entity('main.sales', 'orders')],
      relationships: [],
    });
    mockEngine.mockImplementation((p) => engineResult(p.entities.length));
  });

  describe('assess', () => {
    it('profiles a Postgres datasource, runs the engine with now and stores the report', async () => {
      const { service, postgres, repository } = build();

      const report = await service.assess(
        { datasourceId: 'ds-pg', sessionId: 'sess-1' },
        NOW,
      );

      expect(mockPostgres).toHaveBeenCalledWith(
        postgres,
        datasources['ds-pg'].config,
        'ds-pg',
        undefined,
      );
      expect(mockEngine).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: 'ds-pg' }),
        { thresholds: DEFAULT_THRESHOLDS, now: NOW },
      );
      expect(report).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
        datasourceId: 'ds-pg',
        datasourceName: 'Sales PG',
        datasourceKind: 'postgres',
        generatedAt: '2026-05-04T10:00:00.000Z',
        sessionId: 'sess-1',
        ...engineResult(2),
      });
      expect(repository.insert).toHaveBeenCalledWith(report);
    });

    it('uses the Databricks adapter for a Databricks datasource', async () => {
      const { service, databricks } = build();

      const report = await service.assess({ datasourceId: 'ds-dbx' }, NOW);

      expect(mockDatabricks).toHaveBeenCalledWith(
        databricks,
        datasources['ds-dbx'].config,
        'ds-dbx',
        undefined,
      );
      expect(mockPostgres).not.toHaveBeenCalled();
      expect(report.datasourceKind).toBe('databricks');
      expect(report).not.toHaveProperty('sessionId');
    });

    it('defaults now to the current time', async () => {
      const { service } = build();
      const before = Date.now();

      const report = await service.assess({ datasourceId: 'ds-pg' });

      const ctx = mockEngine.mock.calls[0][1];
      expect(ctx.now.getTime()).toBeGreaterThanOrEqual(before);
      expect(report.generatedAt).toBe(ctx.now.toISOString());
    });

    it.each([undefined, '', '   '])(
      'rejects a missing datasourceId (%p)',
      async (datasourceId) => {
        const { service } = build();
        await expect(
          service.assess({ datasourceId } as never, NOW),
        ).rejects.toThrow(new BadRequestException('datasourceId is required'));
      },
    );

    it('answers 404 with the quoted id for an unknown datasource', async () => {
      const { service } = build();
      const err = await service
        .assess({ datasourceId: 'nope' }, NOW)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as Error).message).toBe('Datasource "nope" not found');
    });

    it('rejects a rest datasource', async () => {
      const { service } = build();
      await expect(
        service.assess({ datasourceId: 'ds-rest' }, NOW),
      ).rejects.toThrow(
        new BadRequestException(
          'Data readiness supports PostgreSQL and Databricks datasources only',
        ),
      );
      expect(mockPostgres).not.toHaveBeenCalled();
      expect(mockDatabricks).not.toHaveBeenCalled();
    });

    it('turns an unreachable datasource into 502 with the connector message', async () => {
      mockPostgres.mockRejectedValue(new Error('connect ECONNREFUSED'));
      const { service, repository } = build();

      const err = await service
        .assess({ datasourceId: 'ds-pg' }, NOW)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BadGatewayException);
      expect((err as Error).message).toBe('connect ECONNREFUSED');
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('narrows to one entity with an entity scope', async () => {
      mockPostgres.mockResolvedValue(profile([entity('public', 'orders')]));
      const { service } = build();

      const report = await service.assess(
        { datasourceId: 'ds-pg', entities: ['sales.public.orders'] },
        NOW,
      );

      expect(mockPostgres.mock.calls[0][3]).toEqual({
        namespace: 'public',
        entity: 'orders',
      });
      expect(report.entityCount).toBe(1);
    });

    it('narrows several entities of one namespace to that namespace, then filters the profile', async () => {
      mockPostgres.mockResolvedValue(
        profile([
          entity('public', 'orders'),
          entity('public', 'customers'),
          entity('public', 'audit'),
        ]),
      );
      const { service } = build();

      await service.assess(
        {
          datasourceId: 'ds-pg',
          entities: ['sales.public.orders', 'sales.public.customers'],
        },
        NOW,
      );

      expect(mockPostgres.mock.calls[0][3]).toEqual({ namespace: 'public' });
      const assessed = mockEngine.mock.calls[0][0];
      expect(assessed.entities.map((e) => e.name)).toEqual([
        'orders',
        'customers',
      ]);
      expect(assessed.relationships).toHaveLength(1);
    });

    it('profiles one scope per namespace when entities span namespaces, and merges them', async () => {
      mockPostgres
        .mockResolvedValueOnce(profile([entity('public', 'orders')]))
        .mockResolvedValueOnce({
          sourceId: 'ds-pg',
          sourceType: 'postgres',
          entities: [entity('crm', 'leads')],
          relationships: [],
        });
      const { service } = build();

      await service.assess(
        {
          datasourceId: 'ds-pg',
          entities: ['sales.public.orders', 'sales.crm.leads'],
        },
        NOW,
      );

      expect(mockPostgres.mock.calls.map((c) => c[3])).toEqual([
        { namespace: 'public', entity: 'orders' },
        { namespace: 'crm', entity: 'leads' },
      ]);
      const assessed = mockEngine.mock.calls[0][0];
      expect(assessed.entities.map((e) => `${e.namespace}.${e.name}`)).toEqual([
        'public.orders',
        'crm.leads',
      ]);
      // orders -> customers stays: its orphans belong to orders.
      expect(assessed.relationships).toHaveLength(1);
    });

    it('drops relationships whose from-entity is out of scope', async () => {
      mockPostgres.mockResolvedValue(
        profile([entity('public', 'customers'), entity('public', 'orders')]),
      );
      const { service } = build();

      await service.assess(
        { datasourceId: 'ds-pg', entities: ['sales.public.customers'] },
        NOW,
      );

      expect(mockEngine.mock.calls[0][0].relationships).toEqual([]);
    });

    it('drops PostgreSQL keys naming another database', async () => {
      const { service } = build();

      await expect(
        service.assess(
          { datasourceId: 'ds-pg', entities: ['hr.public.orders'] },
          NOW,
        ),
      ).rejects.toThrow(
        new BadRequestException('None of the entities to assess exist'),
      );
      expect(mockPostgres).not.toHaveBeenCalled();
    });

    it('refuses an entity list with no string keys', async () => {
      const { service } = build();

      await expect(
        service.assess(
          { datasourceId: 'ds-pg', entities: [null, 3] as never },
          NOW,
        ),
      ).rejects.toThrow(
        new BadRequestException('None of the entities to assess exist'),
      );
    });

    it('keeps a programming error as is, not 502', async () => {
      mockPostgres.mockRejectedValue(new TypeError('x is undefined'));
      const { service } = build();

      const err = await service
        .assess({ datasourceId: 'ds-pg' }, NOW)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(TypeError);
    });

    it('stores the trimmed sessionId', async () => {
      const { service } = build();
      const report = await service.assess(
        { datasourceId: 'ds-pg', sessionId: '  s-9 ' },
        NOW,
      );
      expect(report.sessionId).toBe('s-9');
    });

    it('drops keys that no longer exist and counts only assessed entities', async () => {
      mockPostgres.mockResolvedValue(profile([entity('public', 'orders')]));
      const { service } = build();

      const report = await service.assess(
        {
          datasourceId: 'ds-pg',
          entities: ['sales.public.orders', 'sales.public.gone'],
        },
        NOW,
      );

      expect(report.entityCount).toBe(1);
    });

    it('maps Databricks keys to a catalog.schema namespace', async () => {
      const { service } = build();

      await service.assess(
        { datasourceId: 'ds-dbx', entities: ['main.sales.orders'] },
        NOW,
      );

      expect(mockDatabricks.mock.calls[0][3]).toEqual({
        namespace: 'main.sales',
        entity: 'orders',
      });
    });

    it('refuses when none of the entities exist', async () => {
      mockPostgres.mockResolvedValue(profile([]));
      const { service, repository } = build();

      await expect(
        service.assess(
          { datasourceId: 'ds-pg', entities: ['sales.public.gone'] },
          NOW,
        ),
      ).rejects.toThrow(
        new BadRequestException('None of the entities to assess exist'),
      );
      expect(mockEngine).not.toHaveBeenCalled();
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('refuses keys that cannot name a table without profiling', async () => {
      const { service } = build();

      await expect(
        service.assess({ datasourceId: 'ds-pg', entities: ['orders'] }, NOW),
      ).rejects.toThrow(
        new BadRequestException('None of the entities to assess exist'),
      );
      expect(mockPostgres).not.toHaveBeenCalled();
    });

    it('treats an empty entity list as the whole datasource', async () => {
      const { service } = build();

      await service.assess({ datasourceId: 'ds-pg', entities: [] }, NOW);

      expect(mockPostgres.mock.calls[0][3]).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns summaries in repository order', async () => {
      const { service, repository } = build();
      const full: ReadinessReport = {
        id: 'r-1',
        datasourceId: 'ds-pg',
        datasourceName: 'Sales PG',
        datasourceKind: 'postgres',
        generatedAt: '2026-05-04T10:00:00.000Z',
        sessionId: 's-1',
        ...engineResult(2),
      };
      repository.listByDatasource.mockResolvedValue([
        full,
        { ...full, id: 'r-0', sessionId: undefined },
      ]);

      const { reports } = await service.list('ds-pg');

      expect(repository.listByDatasource).toHaveBeenCalledWith('ds-pg');
      expect(reports).toEqual([
        {
          id: 'r-1',
          datasourceId: 'ds-pg',
          datasourceName: 'Sales PG',
          datasourceKind: 'postgres',
          generatedAt: '2026-05-04T10:00:00.000Z',
          overallScore: 72,
          maturity: 'Defined',
          entityCount: 2,
          sessionId: 's-1',
        },
        expect.not.objectContaining({ sessionId: 's-1' }) as unknown,
      ]);
      expect(reports[0]).not.toHaveProperty('findings');
      expect(reports[1]).not.toHaveProperty('sessionId');
    });

    it('gives an empty list for an unknown datasource', async () => {
      const { service, repository } = build();
      repository.listByDatasource.mockResolvedValue([]);
      await expect(service.list('unknown')).resolves.toEqual({ reports: [] });
    });

    it('rejects a missing datasourceId', async () => {
      const { service } = build();
      await expect(service.list(undefined as never)).rejects.toThrow(
        new BadRequestException('datasourceId is required'),
      );
    });
  });

  describe('get', () => {
    it('returns the stored report', async () => {
      const { service, repository } = build();
      const stored = { id: 'r-1' } as ReadinessReport;
      repository.get.mockResolvedValue(stored);
      await expect(service.get('r-1')).resolves.toBe(stored);
    });

    it('answers 404 for an unknown report', async () => {
      const { service, repository } = build();
      repository.get.mockResolvedValue(null);
      const err = await service.get('nope').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as Error).message).toBe('Readiness report "nope" not found');
    });
  });
});

describe('entityRefFromKey', () => {
  it('maps PostgreSQL database.schema.table to (schema, table)', () => {
    expect(entityRefFromKey('postgres', 'sales.public.orders')).toEqual({
      namespace: 'public',
      name: 'orders',
    });
  });

  it('maps Databricks catalog.schema.table to (catalog.schema, table)', () => {
    expect(entityRefFromKey('databricks', 'main.sales.orders')).toEqual({
      namespace: 'main.sales',
      name: 'orders',
    });
  });

  it('rejects keys with fewer than three parts', () => {
    expect(entityRefFromKey('postgres', 'public.orders')).toBeNull();
    expect(entityRefFromKey('postgres', 'a..b')).toBeNull();
  });
});
