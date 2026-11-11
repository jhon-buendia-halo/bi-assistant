jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../datasources/connectors/postgres-profiling', () => ({
  PostgresProfiler: class {},
}));
jest.mock('../datasources/connectors/databricks-profiling', () => ({
  DatabricksProfiler: class {},
}));
jest.mock('../datasets/datasets.service', () => ({
  DatasetsService: class {},
}));

import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ProfileCache } from './profile-cache';
import { SyntheticDataService } from './synthetic-data.service';
import type { SampledProfileBuilder } from './synthetic-data.service';

const PG_TABLES = ['wc.public.players', 'wc.public.teams'];

function setup(
  opts: {
    datasets?: unknown[];
    kind?: string;
    sample?: jest.Mock;
    tables?: jest.Mock;
    datasourceError?: Error;
  } = {},
) {
  const datasets = {
    list: jest.fn().mockResolvedValue(
      opts.datasets ?? [
        {
          name: 'World Cup',
          datasourceId: 'ds1',
          datasourceKind: opts.kind ?? 'postgres',
          tables: PG_TABLES,
        },
      ],
    ),
  };
  const datasources = {
    get: jest.fn().mockImplementation(async () => {
      if (opts.datasourceError) throw opts.datasourceError;
      return {
        id: 'ds1',
        name: 'WC DB',
        kind: 'postgres',
        config: { database: 'wc' },
      };
    }),
  };
  const sample =
    opts.sample ??
    jest.fn().mockImplementation(async (_c, ns: string, table: string) => ({
      namespace: ns,
      table,
      rowCountEstimate: 5,
      method: 'full',
      columns: [],
      rows: [],
      durationMs: 1,
    }));
  const scoped = {
    tables: opts.tables ?? jest.fn().mockResolvedValue([]),
    keys: jest.fn().mockResolvedValue([]),
    foreignKeys: jest.fn().mockResolvedValue([]),
    sampleTable: sample,
  };
  const profiler = {
    withSessions: jest.fn(
      async (
        _c: unknown,
        _n: number,
        _s: AbortSignal | undefined,
        fn: (s: unknown) => Promise<unknown>,
      ) => fn(scoped),
    ),
  };
  const build: jest.MockedFunction<SampledProfileBuilder> = jest.fn((i) => ({
    version: 1,
    datasetName: i.dataset.name,
    datasourceId: i.datasource.id,
    datasourceName: i.datasource.name,
    dialect: i.datasource.kind,
    generatedAt: '',
    expiresAt: '',
    sampleSize: i.sampleSize,
    tables: [],
    relationships: [],
  }));
  let now = 1_700_000_000_000;
  const cache = new ProfileCache(() => now);
  const service = new SyntheticDataService(
    datasets as never,
    datasources as never,
    profiler as never,
    profiler as never,
    cache,
    build,
  );
  return {
    service,
    cache,
    profiler,
    scoped,
    build,
    datasources,
    advance: (ms: number) => (now += ms),
  };
}

const reject = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => e,
  );

describe('SyntheticDataService.profile (#111 errors)', () => {
  it('400 datasetName is required', async () => {
    const e = await reject(setup().service.profile({}));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e?.message).toBe('datasetName is required');
  });

  it('404 Dataset "<name>" not found', async () => {
    const e = await reject(setup().service.profile({ datasetName: 'Nope' }));
    expect(e).toBeInstanceOf(NotFoundException);
    expect(e?.message).toBe('Dataset "Nope" not found');
  });

  it('400 Dataset "<name>" has no datasource', async () => {
    const s = setup({ datasets: [{ name: 'D', tables: [] }] });
    const e = await reject(s.service.profile({ datasetName: 'D' }));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e?.message).toBe('Dataset "D" has no datasource');
  });

  it('400 for a dataset that is neither PostgreSQL nor Databricks', async () => {
    const e = await reject(
      setup({ kind: 'rest' }).service.profile({ datasetName: 'World Cup' }),
    );
    expect(e?.message).toBe(
      'Profiling a sample supports PostgreSQL and Databricks datasets only',
    );
  });

  it('400 tables must be an array of entity keys', async () => {
    const s = setup();
    for (const tables of ['x', [1], {}]) {
      const e = await reject(
        s.service.profile({ datasetName: 'World Cup', tables }),
      );
      expect(e?.message).toBe('tables must be an array of entity keys');
    }
  });

  it('400 "<key>" is not a table of dataset "<name>"', async () => {
    const e = await reject(
      setup().service.profile({
        datasetName: 'World Cup',
        tables: ['wc.public.nothing'],
      }),
    );
    expect(e?.message).toBe(
      '"wc.public.nothing" is not a table of dataset "World Cup"',
    );
  });

  it('400 Choose at most 50 tables', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `wc.public.t${i}`);
    const s = setup({
      datasets: [
        {
          name: 'Big',
          datasourceId: 'ds1',
          datasourceKind: 'postgres',
          tables: many,
        },
      ],
    });
    const e = await reject(s.service.profile({ datasetName: 'Big' }));
    expect(e?.message).toBe('Choose at most 50 tables');
  });

  it.each([0, 1001, 1.5, '10', -1])('400 sampleSize %p', async (sampleSize) => {
    const e = await reject(
      setup().service.profile({ datasetName: 'World Cup', sampleSize }),
    );
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e?.message).toBe(
      'sampleSize must be a whole number from 1 to 1,000',
    );
  });

  it('answers the first error that applies: tables before sampleSize', async () => {
    const e = await reject(
      setup().service.profile({
        datasetName: 'World Cup',
        tables: 'x',
        sampleSize: 0,
      }),
    );
    expect(e?.message).toBe('tables must be an array of entity keys');
  });

  it('404 Datasource "<id>" not found', async () => {
    const s = setup({ datasourceError: new NotFoundException('gone') });
    const e = await reject(s.service.profile({ datasetName: 'World Cup' }));
    expect(e).toBeInstanceOf(NotFoundException);
    expect(e?.message).toBe('Datasource "ds1" not found');
  });

  it('502 with the connector message when the table list fails', async () => {
    const s = setup({
      tables: jest.fn().mockRejectedValue(new Error('connection refused')),
    });
    const e = await reject(s.service.profile({ datasetName: 'World Cup' }));
    expect(e).toBeInstanceOf(BadGatewayException);
    expect(e?.message).toBe('connection refused');
  });
});

describe('SyntheticDataService.profile (behaviour)', () => {
  it('resolves the dataset by name and samples every table when none are given', async () => {
    const s = setup();
    const out = await s.service.profile({ datasetName: ' World Cup ' });
    expect(out.datasetName).toBe('World Cup');
    expect(s.build.mock.calls[0][0].tables.map((t) => t.key)).toEqual(PG_TABLES);
    expect(s.scoped.sampleTable).toHaveBeenCalledTimes(2);
    expect(s.scoped.sampleTable).toHaveBeenCalledWith(
      expect.anything(),
      'public',
      'players',
      { sampleSize: 1000, repeatableSeed: 7 },
    );
  });

  it('treats an empty tables array as every table, and honours a subset and sampleSize', async () => {
    const s = setup();
    await s.service.profile({ datasetName: 'World Cup', tables: [] });
    expect(s.scoped.sampleTable).toHaveBeenCalledTimes(2);
    const t = setup();
    await t.service.profile({
      datasetName: 'World Cup',
      tables: ['wc.public.teams'],
      sampleSize: 50,
    });
    expect(t.scoped.sampleTable).toHaveBeenCalledTimes(1);
    expect(t.build.mock.calls[0][0].sampleSize).toBe(50);
  });

  it('stamps an id and a 60 minute expiry, and caches the profile', async () => {
    const s = setup();
    const out = await s.service.profile({ datasetName: 'World Cup' });
    expect(out.profileId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(out.expiresAt) - Date.parse(out.generatedAt)).toBe(
      3_600_000,
    );
    expect(s.service.getProfile(out.profileId)).toBe(out);
    s.advance(3_600_001);
    expect(s.service.getProfile(out.profileId)).toBeUndefined();
  });

  it('a table that cannot be sampled is not an error', async () => {
    const sample = jest.fn().mockRejectedValue(new Error('permission denied'));
    const s = setup({ sample });
    await s.service.profile({ datasetName: 'World Cup' });
    const outcomes = s.build.mock.calls[0][0].tables;
    expect(outcomes.map((o) => o.sample.error)).toEqual([
      'permission denied',
      'permission denied',
    ]);
  });

  it('a table of another database is recorded as an error and the others still profile', async () => {
    const s = setup({
      datasets: [
        {
          name: 'World Cup',
          datasourceId: 'ds1',
          datasourceKind: 'postgres',
          tables: ['wc.public.players', 'other.public.teams'],
        },
      ],
    });
    await s.service.profile({ datasetName: 'World Cup' });
    const outcomes = s.build.mock.calls[0][0].tables;
    expect(outcomes[0].sample.error).toBeUndefined();
    expect(outcomes[1].key).toBe('other.public.teams');
    expect(outcomes[1].sample.error).toBe(
      'Table other.public.teams is not in the datasource\'s database "wc"',
    );
    expect(s.scoped.sampleTable).toHaveBeenCalledTimes(1);
  });

  it('aborts when the signal fires: stops sampling and builds nothing', async () => {
    const ac = new AbortController();
    const sample = jest.fn().mockImplementation(async () => {
      ac.abort();
      return {
        namespace: 'public',
        table: 't',
        rowCountEstimate: 1,
        method: 'full',
        columns: [],
        rows: [],
        durationMs: 1,
      };
    });
    const s = setup({ sample });
    const e = await reject(
      s.service.profile({ datasetName: 'World Cup' }, { signal: ac.signal }),
    );
    expect(e?.name).toBe('AbortError');
    expect(s.build).not.toHaveBeenCalled();
    expect(s.profiler.withSessions).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      ac.signal,
      expect.any(Function),
    );
  });

  it('does not start when already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const s = setup();
    const e = await reject(
      s.service.profile({ datasetName: 'World Cup' }, { signal: ac.signal }),
    );
    expect(e?.name).toBe('AbortError');
    expect(s.profiler.withSessions).not.toHaveBeenCalled();
  });
});
