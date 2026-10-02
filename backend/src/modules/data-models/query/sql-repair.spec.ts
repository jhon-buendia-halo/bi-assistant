import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  dialectForDatasourceKind,
  isRepairableSqlError,
  readOnlyStatement,
  runSqlWithRepair,
} from './sql-repair';

describe('dialectForDatasourceKind', () => {
  it('maps postgres/databricks straight through and rest to sqlite (the materialisation target)', () => {
    expect(dialectForDatasourceKind('postgres')).toBe('postgres');
    expect(dialectForDatasourceKind('databricks')).toBe('databricks');
    expect(dialectForDatasourceKind('rest')).toBe('sqlite');
  });
});

describe('isRepairableSqlError', () => {
  it('rejects a guard rejection (BadRequestException) without a fixer round trip', () => {
    expect(isRepairableSqlError(new BadRequestException('not read-only'))).toBe(
      false,
    );
  });

  it('rejects a missing-datasource error (NotFoundException) — no rewrite conjures a datasource', () => {
    expect(
      isRepairableSqlError(new NotFoundException('Datasource ds-1 not found')),
    ).toBe(false);
  });

  it('rejects a "Datasource ... not found" message even when it is a plain Error (type lost crossing an async boundary)', () => {
    expect(isRepairableSqlError(new Error('Datasource ds-1 not found'))).toBe(
      false,
    );
  });

  it('rejects a transport/auth failure', () => {
    expect(isRepairableSqlError(new Error('bad HTTP status code: 403'))).toBe(
      false,
    );
    expect(isRepairableSqlError(new Error('ECONNREFUSED'))).toBe(false);
  });

  it('treats an engine parse/resolution error as repairable', () => {
    expect(isRepairableSqlError(new Error('column "foo" does not exist'))).toBe(
      true,
    );
  });
});

describe('readOnlyStatement', () => {
  it('strips fences and trailing semicolons from a select/with statement', () => {
    expect(readOnlyStatement('```sql\nSELECT 1;\n```')).toBe('SELECT 1');
    expect(readOnlyStatement('with x as (select 1) select * from x')).toBe(
      'with x as (select 1) select * from x',
    );
  });

  it('rejects anything that is not a select/with statement', () => {
    expect(readOnlyStatement('DROP TABLE foo')).toBeUndefined();
  });
});

describe('runSqlWithRepair', () => {
  it('returns the result as-is when the statement succeeds first try', async () => {
    const runSql = jest
      .fn()
      .mockResolvedValue({ columns: ['n'], rows: [{ n: 1 }] });
    const repair = jest.fn();
    const result = await runSqlWithRepair('SELECT 1', { runSql, repair });
    expect(result).toEqual({ columns: ['n'], rows: [{ n: 1 }] });
    expect(repair).not.toHaveBeenCalled();
  });

  it('repairs a failed statement and flags the corrected SQL', async () => {
    const runSql = jest
      .fn()
      .mockRejectedValueOnce(new Error('bad column'))
      .mockResolvedValueOnce({ columns: ['n'], rows: [{ n: 2 }] });
    const repair = jest.fn().mockResolvedValue('SELECT n FROM fixed');
    const logWarn = jest.fn();
    const result = await runSqlWithRepair('SELECT n FROM broken', {
      runSql,
      repair,
      logWarn,
    });
    expect(result).toEqual({
      columns: ['n'],
      rows: [{ n: 2 }],
      correctedSql: 'SELECT n FROM fixed',
    });
    expect(runSql).toHaveBeenNthCalledWith(2, 'SELECT n FROM fixed');
    expect(logWarn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget and rethrows the last error', async () => {
    const runSql = jest
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(new Error('third'));
    const repair = jest
      .fn()
      .mockResolvedValueOnce('SELECT 1')
      .mockResolvedValueOnce('SELECT 2');
    await expect(
      runSqlWithRepair('SELECT bad', { runSql, repair, attempts: 2 }),
    ).rejects.toThrow('third');
    expect(runSql).toHaveBeenCalledTimes(3);
    expect(repair).toHaveBeenCalledTimes(2);
  });

  it('never calls repair when isRepairable returns false', async () => {
    const runSql = jest.fn().mockRejectedValue(new Error('not found'));
    const repair = jest.fn();
    await expect(
      runSqlWithRepair('SELECT 1', {
        runSql,
        repair,
        isRepairable: () => false,
      }),
    ).rejects.toThrow('not found');
    expect(repair).not.toHaveBeenCalled();
  });

  it('rethrows the original error when repair produces nothing usable', async () => {
    const runSql = jest.fn().mockRejectedValue(new Error('broken'));
    const repair = jest.fn().mockResolvedValue(undefined);
    await expect(
      runSqlWithRepair('SELECT 1', { runSql, repair }),
    ).rejects.toThrow('broken');
  });
});
