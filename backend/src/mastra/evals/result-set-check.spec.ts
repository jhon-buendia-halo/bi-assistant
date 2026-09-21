import {
  lastSuccessfulSqlRecord,
  runResultSetCheck,
  RESULT_SET_CHECK_ID,
  RESULT_SET_ROW_LIMIT,
} from './result-set-check';
import { setDatasetToolServices } from '../tool-services';
import type { DatasetToolServices, DatasetSnapshot } from '../tool-services';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';

function stubServices(
  overrides: Partial<DatasetToolServices> = {},
): DatasetToolServices {
  return {
    createVisual: jest.fn(),
    updateVisual: jest.fn(),
    getDatasets: jest.fn(),
    sampleRows: jest.fn(),
    runReadOnlySql: jest.fn(),
    ...overrides,
  } as unknown as DatasetToolServices;
}

const snapshot: DatasetSnapshot[] = [
  { name: 'World Cup', datasourceId: 'ds-1', tables: ['world_cup.matches'] },
];

describe('lastSuccessfulSqlRecord', () => {
  it('returns undefined when there are no run_readonly_sql records', () => {
    const records: ToolDataRecord[] = [{ tool: 'list_entities', input: 'x' }];
    expect(lastSuccessfulSqlRecord(records)).toBeUndefined();
  });

  it('skips errored sql calls and picks the last successful one', () => {
    const records: ToolDataRecord[] = [
      { tool: 'run_readonly_sql', input: 'SELECT 1', rows: [{ a: 1 }] },
      { tool: 'run_readonly_sql', input: 'SELECT bad', error: 'boom' },
    ];
    // The errored call is last, so the successful one before it should win.
    expect(lastSuccessfulSqlRecord(records)?.input).toBe('SELECT 1');
  });

  it('returns the most recent successful call when several succeeded', () => {
    const records: ToolDataRecord[] = [
      { tool: 'run_readonly_sql', input: 'SELECT 1', rows: [] },
      { tool: 'run_readonly_sql', input: 'SELECT 2', rows: [{ a: 2 }] },
    ];
    expect(lastSuccessfulSqlRecord(records)?.input).toBe('SELECT 2');
  });
});

describe('runResultSetCheck', () => {
  afterEach(() => {
    // Leave no stub installed between tests.
    setDatasetToolServices(stubServices());
  });

  it('returns undefined when the case has no expectedSql', async () => {
    const result = await runResultSetCheck(undefined, ['World Cup'], snapshot, []);
    expect(result).toBeUndefined();
  });

  it('fails when the agent never ran a successful SQL call', async () => {
    const result = await runResultSetCheck(
      'SELECT 1',
      ['World Cup'],
      snapshot,
      [{ tool: 'run_readonly_sql', input: 'bad', error: 'boom' }],
    );
    expect(result?.id).toBe(RESULT_SET_CHECK_ID);
    expect(result?.passed).toBe(false);
    expect(result?.reason).toMatch(/no successful run_readonly_sql/);
  });

  it('fails when no datasource can be resolved', async () => {
    const result = await runResultSetCheck(
      'SELECT 1',
      ['World Cup'],
      [{ name: 'World Cup', tables: [] }],
      [{ tool: 'run_readonly_sql', input: 'SELECT 1', rows: [{ a: 1 }] }],
    );
    expect(result?.passed).toBe(false);
    expect(result?.reason).toMatch(/could not resolve a datasource/);
  });

  it('passes when the agent rows match the expectedSql rows', async () => {
    const runReadOnlySql = jest.fn().mockResolvedValue({
      columns: ['champion'],
      rows: [{ champion: 'Argentina' }],
    });
    setDatasetToolServices(stubServices({ runReadOnlySql }));

    const result = await runResultSetCheck(
      'SELECT champion FROM tournaments',
      ['World Cup'],
      snapshot,
      [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT team FROM tournaments',
          rows: [{ team: 'Argentina' }],
        },
      ],
    );

    expect(result?.passed).toBe(true);
    expect(result?.score).toBe(1);
    expect(result?.reason).toBeUndefined();
    expect(runReadOnlySql).toHaveBeenCalledWith(
      'ds-1',
      'SELECT champion FROM tournaments',
      RESULT_SET_ROW_LIMIT,
      ['World Cup'],
    );
  });

  it('fails with a reason when the rows differ', async () => {
    const runReadOnlySql = jest.fn().mockResolvedValue({
      columns: ['champion'],
      rows: [{ champion: 'Argentina' }],
    });
    setDatasetToolServices(stubServices({ runReadOnlySql }));

    const result = await runResultSetCheck(
      'SELECT champion FROM tournaments',
      ['World Cup'],
      snapshot,
      [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT team FROM tournaments',
          rows: [{ team: 'France' }],
        },
      ],
    );

    expect(result?.passed).toBe(false);
    expect(result?.reason).toMatch(/did not match/);
  });

  it('scores 0 with a reason when expectedSql fails to run', async () => {
    const runReadOnlySql = jest
      .fn()
      .mockRejectedValue(new Error('syntax error at or near "FORM"'));
    setDatasetToolServices(stubServices({ runReadOnlySql }));

    const result = await runResultSetCheck(
      'SELECT champion FORM tournaments',
      ['World Cup'],
      snapshot,
      [{ tool: 'run_readonly_sql', input: 'SELECT 1', rows: [{ a: 1 }] }],
    );

    expect(result?.passed).toBe(false);
    expect(result?.reason).toMatch(/expectedSql failed to run/);
    expect(result?.reason).toMatch(/syntax error/);
  });
});
