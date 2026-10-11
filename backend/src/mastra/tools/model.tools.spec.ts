/**
 * `model.tools.ts` only imports `@mastra/core/tools` (safe under Jest) —
 * see `assistant.agent.spec.ts`'s header for why `@mastra/core/agent` is not
 * safe to import here. Covers the BA-86 review findings: `sql`/`correctedSql`
 * never reach the model's own tool result (ADR-0007 §4), `run_raw_sql`
 * resolves its datasource from `entity` (no `datasourceId` input), execution
 * errors are sanitised of physical names, and `query_entities` reports every
 * resolver issue, not just the first.
 */
import {
  describeEntityTool,
  queryEntitiesTool,
  runRawSqlTool,
  sampleRecordsTool,
} from './model.tools';
import {
  setDatasetToolServices,
  queryEntitiesProvenance,
  type DatasetToolServices,
} from '../tool-services';
import { LogicalQueryError } from '../../modules/data-models/query/compile-sql';
import { composeSessionModel } from '../../modules/data-models/session-model';
import { worldCupFixture } from '../../modules/data-models/dsl/__fixtures__/world-cup.fixture';

const model = composeSessionModel([
  { dataset: 'World Cup Core', model: worldCupFixture() },
]);

function requestContextWith(datasets: string[]) {
  const store = new Map<string, unknown>([['datasets', datasets]]);
  return { get: (key: string) => store.get(key) };
}

function installServices(overrides: Partial<DatasetToolServices>) {
  setDatasetToolServices({
    createVisual: jest.fn(),
    updateVisual: jest.fn(),
    getDatasets: jest.fn().mockResolvedValue([]),
    sampleRows: jest.fn(),
    runReadOnlySql: jest.fn(),
    getSessionModel: jest.fn().mockResolvedValue(model),
    runLogicalQuery: jest.fn(),
    ...overrides,
  });
}

describe('queryEntitiesTool', () => {
  it('strips sql/correctedSql from the model-visible result, keeping them in queryEntitiesProvenance', async () => {
    const full = {
      columns: ['n'],
      rows: [{ n: 1 }],
      entities: ['matches'],
      sql: 'SELECT COUNT(*) AS n FROM "public"."matches"',
      correctedSql: 'SELECT COUNT(*) AS n FROM "public"."matches" LIMIT 10',
    };
    installServices({ runLogicalQuery: jest.fn().mockResolvedValue(full) });

    const result = (await queryEntitiesTool.execute!(
      {
        query: {
          from: 'matches',
          select: [{ agg: 'count', alias: 'n' }],
          limit: 10,
        },
        rationale: 'count matches',
      },
      { requestContext: requestContextWith(['World Cup Core']) } as never,
    )) as Record<string, unknown>;

    expect(result).not.toHaveProperty('sql');
    expect(result).not.toHaveProperty('correctedSql');
    expect(result.rows).toEqual([{ n: 1 }]);
    expect(queryEntitiesProvenance.get(result)).toEqual(full);
  });

  it('reports every resolver issue, not just the first, on a LogicalQueryError', async () => {
    const issues = [
      {
        code: 'unknown_attribute' as const,
        message: 'bad attr',
        path: 'select[0].attr',
      },
      {
        code: 'unknown_metric' as const,
        message: 'bad metric',
        path: 'select[1].metric',
      },
    ];
    installServices({
      runLogicalQuery: jest
        .fn()
        .mockRejectedValue(new LogicalQueryError(issues)),
    });

    const result = (await queryEntitiesTool.execute!(
      {
        query: { from: 'matches', select: [{ attr: 'nope' }], limit: 10 },
        rationale: 'test',
      },
      { requestContext: requestContextWith(['World Cup Core']) } as never,
    )) as { error: { issues: unknown[]; message: string } };

    expect(result.error.issues).toEqual(issues);
    expect(result.error.message).toContain('bad attr');
    expect(result.error.message).toContain('bad metric');
  });

  it('sanitises a physical table/column name out of an execution error', async () => {
    installServices({
      runLogicalQuery: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'column "id" of relation "main.public.matches" does not exist',
          ),
        ),
    });

    const result = (await queryEntitiesTool.execute!(
      {
        query: { from: 'matches', select: [{ attr: 'stage' }], limit: 10 },
        rationale: 'test',
      },
      { requestContext: requestContextWith(['World Cup Core']) } as never,
    )) as { error: { message: string } };

    expect(result.error.message).not.toContain('main.public.matches');
  });
});

describe('sampleRecordsTool', () => {
  it('runs a compiled select over the entity, not the connector sampleRows, and strips sql', async () => {
    const sampleRows = jest.fn();
    const full = {
      columns: ['match_id', 'stage'],
      rows: [{ match_id: 1, stage: 'Final' }],
      entities: ['matches'],
      sql: 'SELECT "matches"."match_id" ... ',
    };
    const runLogicalQuery = jest.fn().mockResolvedValue(full);
    installServices({ sampleRows, runLogicalQuery });

    const result = (await sampleRecordsTool.execute!(
      { entity: 'matches', limit: 5, rationale: 'peek' },
      { requestContext: requestContextWith(['World Cup Core']) } as never,
    )) as Record<string, unknown>;

    expect(sampleRows).not.toHaveBeenCalled();
    expect(runLogicalQuery).toHaveBeenCalled();
    const [, query] = runLogicalQuery.mock.calls[0] as [
      unknown,
      { from: string },
    ];
    expect(query.from).toBe('matches');
    expect(result).not.toHaveProperty('sql');
    expect(result.rows).toEqual([{ match_id: 1, stage: 'Final' }]);
  });
});

describe('runRawSqlTool', () => {
  it('resolves the datasource from "entity", not a datasourceId input', async () => {
    const runReadOnlySql = jest
      .fn()
      .mockResolvedValue({ columns: ['n'], rows: [{ n: 1 }] });
    installServices({ runReadOnlySql });

    await runRawSqlTool.execute!(
      {
        entity: 'matches',
        sql: 'SELECT COUNT(*) AS n FROM matches',
        rationale: 'fallback',
      },
      { requestContext: requestContextWith(['World Cup Core']) } as never,
    );

    expect(runReadOnlySql).toHaveBeenCalledWith(
      'world-cup', // matches entity's datasourceId in the fixture
      'SELECT COUNT(*) AS n FROM matches',
      100,
      ['World Cup Core'],
    );
  });

  it('errors on an unknown entity without reaching the datasource', async () => {
    const runReadOnlySql = jest.fn();
    installServices({ runReadOnlySql });

    const result = (await runRawSqlTool.execute!(
      { entity: 'nope', sql: 'SELECT 1', rationale: 'fallback' },
      { requestContext: requestContextWith(['World Cup Core']) } as never,
    )) as { error: string };

    expect(result.error).toContain('nope');
    expect(runReadOnlySql).not.toHaveBeenCalled();
  });
});

describe('describeEntityTool', () => {
  it('shows each relationship as the exact `via` ref joins[].via accepts, plus name when set', async () => {
    installServices({});

    const result = (await describeEntityTool.execute!({ entity: 'matches' }, {
      requestContext: requestContextWith(['World Cup Core']),
    } as never)) as {
      relationships: { via: string; name?: string; cardinality: string }[];
    };

    expect(result.relationships).toEqual([
      expect.objectContaining({
        via: 'matches.home_team_id->teams.team_id',
        name: 'matches_home_team',
        cardinality: 'many_to_one',
      }),
    ]);
  });
});
