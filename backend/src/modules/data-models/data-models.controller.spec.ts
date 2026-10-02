// `@databricks/sql` -> `thrift` ships an ESM-only `uuid` build Jest cannot
// `require()` under this project's CommonJS config — mocked the same way
// `test/data-models.e2e-spec.ts` does; nothing here exercises databricks.
jest.mock('../datasources/connectors/databricks.connector', () => ({
  DatabricksConnector: class {},
}));

import { BadRequestException } from '@nestjs/common';
import { DataModelsController } from './data-models.controller';
import { worldCupFixture } from './dsl/__fixtures__/world-cup.fixture';
import { setSqlFixerBridge } from './query/sql-repair';

/**
 * `/model/query` (item 12, BA-86 review): routes a runtime SQL error through
 * the same `sql-fixer` repair pass `SessionsService.runSqlWithRepair` gives
 * the chat `query_entities` tool, instead of failing on the first engine
 * error. The repair pass itself crosses the `DataModelsModule`/
 * `SessionsModule` boundary as a plain `SqlFixerBridge` callback
 * (`query/sql-repair.ts`), not a `MastraService` injection — importing
 * `MastraModule` here would drag in the real Mastra agent registry, which
 * broke `test/data-models.e2e-spec.ts`'s focused (Mastra-free) module set
 * the one time this was tried. This spec installs a fake bridge directly, so
 * it never touches Mastra either. Unit-level (mocked `DataModelsService`/
 * `DatasourcesService`, no HTTP, no database, no real model call) — the e2e
 * spec never exercised this endpoint's failure path at all before this test
 * existed.
 */
describe('DataModelsController — /model/query repair routing', () => {
  function build(opts: {
    runReadOnlySql: jest.Mock;
    fixerReplies?: (string | undefined)[];
  }) {
    const doc = {
      dataset: 'world-cup',
      currentVersion: 1,
      versions: [{ version: 1, model: worldCupFixture() }],
    };
    const dataModels = {
      get: jest.fn().mockResolvedValue(doc),
    };
    const datasources = {
      get: jest.fn().mockResolvedValue({ id: 'ds-1', kind: 'postgres' }),
      runReadOnlySql: opts.runReadOnlySql,
    };
    const repair = jest.fn();
    for (const reply of opts.fixerReplies ?? []) {
      repair.mockResolvedValueOnce(reply);
    }
    setSqlFixerBridge({ repair });
    const controller = new DataModelsController(
      dataModels as never,
      datasources as never,
    );
    return { controller, repair, datasources };
  }

  const query = {
    from: 'matches',
    select: [{ agg: 'count', alias: 'n' }],
    limit: 10,
  };

  it('returns the result as-is when the statement succeeds first try, never calling the fixer', async () => {
    const runReadOnlySql = jest
      .fn()
      .mockResolvedValue({ columns: ['n'], rows: [{ n: 5 }] });
    const { controller, repair } = build({ runReadOnlySql });

    const result = (await controller.runQuery('world-cup', {
      query,
    })) as { rows: unknown[]; sql: string };

    expect(result.rows).toEqual([{ n: 5 }]);
    expect(typeof result.sql).toBe('string');
    expect(repair).not.toHaveBeenCalled();
  });

  it('repairs a failed statement via the SqlFixerBridge and returns the corrected result', async () => {
    const runReadOnlySql = jest
      .fn()
      .mockRejectedValueOnce(new Error('column "stage" does not exist'))
      .mockResolvedValueOnce({ columns: ['n'], rows: [{ n: 7 }] });
    const { controller, repair } = build({
      runReadOnlySql,
      fixerReplies: ['SELECT COUNT(*) AS n FROM matches'],
    });

    const result = (await controller.runQuery('world-cup', {
      query,
    })) as { rows: unknown[]; correctedSql?: string };

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.rows).toEqual([{ n: 7 }]);
    expect(result.correctedSql).toBe('SELECT COUNT(*) AS n FROM matches');
  });

  it('does not call the fixer on a non-repairable (guard) rejection and rethrows immediately', async () => {
    const runReadOnlySql = jest
      .fn()
      .mockRejectedValue(
        new BadRequestException(
          'Only read-only SELECT / WITH queries can be run.',
        ),
      );
    const { controller, repair } = build({ runReadOnlySql });

    await expect(controller.runQuery('world-cup', { query })).rejects.toThrow(
      'Only read-only SELECT / WITH queries can be run.',
    );
    expect(repair).not.toHaveBeenCalled();
    expect(runReadOnlySql).toHaveBeenCalledTimes(1);
  });

  it('degrades to no repair (rethrows the original error) when the bridge itself fails', async () => {
    // Mirrors a process where `SessionsModule`'s `onModuleInit` never ran —
    // `repair` rejecting has the same observable effect as no bridge at all.
    const runReadOnlySql = jest
      .fn()
      .mockRejectedValue(new Error('column "stage" does not exist'));
    const { controller } = build({ runReadOnlySql });
    setSqlFixerBridge({
      repair: () => Promise.reject(new Error('no bridge installed')),
    });

    await expect(controller.runQuery('world-cup', { query })).rejects.toThrow(
      'column "stage" does not exist',
    );
  });
});
