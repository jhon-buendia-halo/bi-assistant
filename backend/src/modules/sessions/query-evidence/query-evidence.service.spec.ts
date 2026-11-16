jest.mock('../../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../../datasets/repositories/datasets.repository', () => ({
  DatasetsRepository: class {},
}));

import type { DatasetsRepository } from '../../datasets/repositories/datasets.repository';
import type { PagedStatement } from '../../datasources/connectors/paged-sql.types';
import type { DatasourcesService } from '../../datasources/datasources.service';
import type { ChatMessage } from '../entities/session.entity';
import { QueryEvidenceService } from './query-evidence.service';

const RANKED =
  'SELECT r.product, COUNT(*) AS n FROM shop.public.returns r JOIN shop.public.products p ON p.id = r.product GROUP BY r.product ORDER BY n DESC LIMIT 100';

function build(
  datasets = [
    {
      name: 'shop',
      datasourceId: 'ds-1',
      datasourceKind: 'postgres',
      tables: ['shop.public.returns', 'shop.public.products'],
    },
  ],
) {
  const runReadOnlySql = jest.fn(
    (_id: string, sql: string, _limit: number, maxRows?: number) => {
      if (sql.includes('"products"')) {
        return Promise.reject(new Error('Postgres — permission denied'));
      }
      if (sql.startsWith('SELECT COUNT(*)')) {
        return Promise.resolve({ columns: ['n'], rows: [{ n: '48912' }] });
      }
      const total = maxRows ? 50_001 : 1870;
      const kept = Math.min(total, maxRows ?? 100);
      return Promise.resolve({
        columns: ['product', 'n'],
        rows: Array.from({ length: kept }, (_, i) => ({
          product: `p${i}`,
          n: i,
        })),
        totalRows: total,
      });
    },
  );
  const runPagedSql = jest.fn((_id: string, stmt: PagedStatement) =>
    Promise.resolve({
      columns: stmt.columns,
      rows: [{ product: 'p0', n: 9 }],
      matchedRows: 1870,
    }),
  );
  const datasources = {
    runReadOnlySql,
    runPagedSql,
    sampleRows: jest
      .fn()
      .mockResolvedValue({ columns: ['id'], rows: [{ id: 1 }] }),
    get: jest.fn().mockResolvedValue({ id: 'ds-1', kind: 'postgres' }),
    defaultDatasource: jest.fn(),
  };
  const repository = { getByNames: jest.fn().mockResolvedValue(datasets) };
  const service = new QueryEvidenceService(
    repository as unknown as DatasetsRepository,
    datasources as unknown as DatasourcesService,
  );
  return { service, runReadOnlySql, runPagedSql };
}

const answer: ChatMessage = {
  role: 'assistant',
  content: 'Top products by returns.',
  at: 't',
  data: [
    {
      tool: 'run_readonly_sql',
      input: RANKED,
      columns: ['product', 'n'],
      rows: [],
      rowCount: 100,
    },
    {
      tool: 'run_readonly_sql',
      input: 'SELECT COUNT(*) FROM shop.public.returns',
      columns: ['count'],
      rows: [{ count: 48912 }],
      rowCount: 1,
    },
    { tool: 'run_readonly_sql', input: 'SELECT nope', error: 'no column' },
  ],
};

describe('QueryEvidenceService.prepare (api.md 139)', () => {
  it('builds the evidence and sizes each table once, a failed count kept as an error', async () => {
    const { service, runReadOnlySql } = build();

    const evidence = await service.prepare(answer, ['shop']);

    const counts = runReadOnlySql.mock.calls.map((call) => call[1]);
    expect(counts.sort()).toEqual([
      'SELECT COUNT(*) AS n FROM "public"."products"',
      'SELECT COUNT(*) AS n FROM "public"."returns"',
    ]);
    expect(evidence).toEqual([
      {
        index: 0,
        coverage: 'top-n',
        outerLimit: 100,
        datasourceId: 'ds-1',
        datasourceKind: 'postgres',
        tables: [
          { entity: 'shop.public.returns', rows: 48912 },
          {
            entity: 'shop.public.products',
            rows: null,
            error: 'Postgres — permission denied',
          },
        ],
      },
      {
        index: 1,
        coverage: 'whole-table',
        datasourceId: 'ds-1',
        datasourceKind: 'postgres',
        tables: [{ entity: 'shop.public.returns', rows: 48912 }],
      },
      { index: 2 },
    ]);
  });

  it('runs no query when called again with nothing missing', async () => {
    const { service, runReadOnlySql } = build();
    const evidence = await service.prepare(answer, ['shop']);
    runReadOnlySql.mockClear();

    expect(
      await service.prepare({ ...answer, evidence: evidence! }, ['shop']),
    ).toBeNull();
    expect(runReadOnlySql).not.toHaveBeenCalled();
  });
});

describe('QueryEvidenceService.rerun and exportRows (api.md 142, 143)', () => {
  it('runs the same statement at its row limit, with no repair', async () => {
    const { service, runReadOnlySql } = build();

    const result = await service.rerun(
      answer.data![0],
      { index: 0, rowLimit: 100 },
      ['shop'],
    );

    expect(runReadOnlySql).toHaveBeenCalledWith('ds-1', RANKED, 100);
    expect(result).toMatchObject({
      rowCount: 100,
      totalRows: 1870,
      coverage: 'partial',
    });
    expect(typeof result.ranAt).toBe('string');
  });

  it('refuses a run with several datasources and no recorded one', async () => {
    const { service } = build([
      {
        name: 'a',
        datasourceId: 'ds-1',
        datasourceKind: 'postgres',
        tables: [],
      },
      {
        name: 'b',
        datasourceId: 'ds-2',
        datasourceKind: 'databricks',
        tables: [],
      },
    ]);

    await expect(
      service.rerun(answer.data![0], { index: 0 }, ['a', 'b']),
    ).rejects.toThrow(
      'Several datasources are in scope for this run; this query cannot be re-run',
    );
  });

  it('exports 50,000 rows with the LIMIT raised, and says they were cut', async () => {
    const { service, runReadOnlySql } = build();

    const exported = await service.exportRows(answer.data![0], undefined, [
      'shop',
    ]);

    expect(runReadOnlySql).toHaveBeenCalledWith(
      'ds-1',
      RANKED.replace('LIMIT 100', 'LIMIT 50001'),
      50_001,
      50_001,
    );
    expect(exported.rows).toHaveLength(50_000);
    expect(exported.cut).toBe(true);
  });
});

describe('QueryEvidenceService.page (api.md 152, 154)', () => {
  it('pages the stored SQL over its stored columns, with nothing stored', async () => {
    const { service, runPagedSql, runReadOnlySql } = build();
    const record = {
      ...answer.data![0],
      rows: [{ product: 'p0', n: 9 }],
    };
    const before = JSON.stringify(record);

    const result = await service.page(record, { index: 0 }, ['shop'], {
      page: 2,
      sort: [{ column: 'n', direction: 'asc' }],
    });

    expect(runPagedSql).toHaveBeenCalledWith('ds-1', {
      sql: RANKED,
      columns: ['product', 'n'],
      filters: [],
      sort: [{ column: 'n', direction: 'asc' }],
      limit: 50,
      offset: 50,
      kinds: { product: 'text', n: 'number' },
    });
    expect(runReadOnlySql).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      page: 2,
      pageSize: 50,
      pageCount: 38,
      matchedRows: 1870,
      capped: false,
      rows: [{ product: 'p0', n: 9 }],
    });
    expect(JSON.stringify(record)).toBe(before);
  });

  it('refuses a sample, and a bad request before any query', async () => {
    const { service, runPagedSql } = build();

    await expect(
      service.page(
        { tool: 'sample_rows', input: 'shop.public.returns' },
        { index: 3 },
        ['shop'],
        {},
      ),
    ).rejects.toThrow('Query 3 is a sample; it has no full result to page');
    await expect(
      service.page(answer.data![0], { index: 0 }, ['shop'], {
        filters: [{ column: 'nope', op: 'eq', value: 1 }],
      }),
    ).rejects.toThrow('Unknown column "nope"');
    expect(runPagedSql).not.toHaveBeenCalled();
  });

  it("answers the connector's failure as a 400 with its message", async () => {
    const { service, runPagedSql } = build();
    runPagedSql.mockRejectedValueOnce(new Error('Postgres — timeout'));

    await expect(
      service.page(answer.data![0], { index: 0 }, ['shop'], {}),
    ).rejects.toMatchObject({ status: 400, message: 'Postgres — timeout' });
  });
});

describe('QueryEvidenceService.countRows', () => {
  it('reads one whole number', async () => {
    const { service } = build();
    expect(
      await service.countRows(
        'ds-1',
        'SELECT COUNT(*) AS n FROM "public"."returns"',
      ),
    ).toBe(48912);
  });
});
