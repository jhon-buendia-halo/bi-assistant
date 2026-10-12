/**
 * `model.tools.ts` only imports `@mastra/core/tools` (safe under Jest) —
 * see `assistant.agent.spec.ts`'s header for why `@mastra/core/agent` is not
 * safe to import here. Covers the BA-86 review findings: `sql`/`correctedSql`
 * never reach the model's own tool result (ADR-0014 §4), `run_raw_sql`
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
    // The kept result also carries the guards' warnings (here: the query's
    // own unordered `limit: 10`), covered below.
    expect(queryEntitiesProvenance.get(result)).toEqual(
      expect.objectContaining(full),
    );
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

describe('result guards on the model tools (agents.md 5.4, sessions-chat R29)', () => {
  const context = {
    requestContext: requestContextWith(['World Cup Core']),
  } as never;
  const CONSTANT_ONE =
    'is_final is 1 on every row, so it cannot explain any difference between them.';
  const UNORDERED =
    'The query keeps only a few rows without ranking them, so these are an arbitrary sample rather than the top results.';

  it('query_entities attaches the warnings to the model-visible result and to the result kept for the data record', async () => {
    const full = {
      columns: ['stage', 'is_final'],
      rows: [
        { stage: 'Final', is_final: 1 },
        { stage: 'Group', is_final: 1 },
      ],
      entities: ['matches'],
      sql: 'SELECT "matches"."stage" AS "stage", 1 AS "is_final" FROM "main"."public"."matches" AS "matches" ORDER BY "stage" ASC LIMIT 100',
    };
    installServices({ runLogicalQuery: jest.fn().mockResolvedValue(full) });

    const result = (await queryEntitiesTool.execute!(
      {
        query: {
          from: 'matches',
          select: [{ attr: 'stage' }],
          order_by: [{ by: 'stage' }],
        },
        rationale: 'stages',
      },
      context,
    )) as Record<string, unknown>;

    expect(result.warnings).toEqual([CONSTANT_ONE]);
    expect(result).not.toHaveProperty('sql');
    expect(queryEntitiesProvenance.get(result)).toEqual(
      expect.objectContaining({ sql: full.sql, warnings: [CONSTANT_ONE] }),
    );
  });

  it('query_entities does not flag the LIMIT the compiler always writes when the query set no limit', async () => {
    const runLogicalQuery = jest.fn().mockResolvedValue({
      columns: ['stage'],
      rows: [{ stage: 'Final' }, { stage: 'Group' }, { stage: 'Semi' }],
      entities: ['matches'],
      sql: 'SELECT DISTINCT "matches"."stage" AS "stage" FROM "main"."public"."matches" AS "matches" LIMIT 100',
    });
    installServices({ runLogicalQuery });

    const result = (await queryEntitiesTool.execute!(
      {
        query: { from: 'matches', select: [{ attr: 'stage' }] },
        rationale: 'stages',
      },
      context,
    )) as Record<string, unknown>;

    expect(result).not.toHaveProperty('warnings');
    // The tool still runs the query with the documented default limit.
    const [, query] = runLogicalQuery.mock.calls[0] as [
      unknown,
      { limit: number },
    ];
    expect(query.limit).toBe(100);
  });

  it('query_entities flags an unordered limit the query set itself', async () => {
    installServices({
      runLogicalQuery: jest.fn().mockResolvedValue({
        columns: ['stage'],
        rows: [{ stage: 'Final' }, { stage: 'Group' }],
        entities: ['matches'],
        sql: 'SELECT "matches"."stage" AS "stage" FROM "main"."public"."matches" AS "matches" LIMIT 5',
      }),
    });

    const result = (await queryEntitiesTool.execute!(
      {
        query: { from: 'matches', select: [{ attr: 'stage' }], limit: 5 },
        rationale: 'stages',
      },
      context,
    )) as Record<string, unknown>;

    expect(result.warnings).toEqual([UNORDERED]);
  });

  it('query_entities keeps the row-cap check for a result that filled the default limit', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ match_id: i + 1 }));
    installServices({
      runLogicalQuery: jest.fn().mockResolvedValue({
        columns: ['match_id'],
        rows,
        entities: ['matches'],
        sql: 'SELECT "matches"."match_id" AS "match_id" FROM "main"."public"."matches" AS "matches" ORDER BY "match_id" ASC LIMIT 100',
      }),
    });

    const result = (await queryEntitiesTool.execute!(
      {
        query: {
          from: 'matches',
          select: [{ attr: 'match_id' }],
          order_by: [{ by: 'match_id' }],
        },
        rationale: 'ids',
      },
      context,
    )) as Record<string, unknown>;

    expect(result.warnings).toEqual([
      'The result stopped at 100 rows, so it is probably cut short and missing later ones.',
    ]);
  });

  it('query_entities inspects the corrected statement when the SQL was repaired', async () => {
    installServices({
      runLogicalQuery: jest.fn().mockResolvedValue({
        columns: ['kept', 'total'],
        rows: [{ kept: 3, total: 7 }],
        entities: ['matches'],
        sql: 'SELECT SUM(a) AS kept, SUM(a) AS total FROM t ORDER BY 1 LIMIT 100',
        correctedSql:
          'SELECT SUM(a) AS kept, SUM(b) AS total FROM t ORDER BY 1 LIMIT 100',
      }),
    });

    const result = (await queryEntitiesTool.execute!(
      {
        query: { from: 'matches', select: [{ agg: 'count', alias: 'n' }] },
        rationale: 'ratio',
      },
      context,
    )) as Record<string, unknown>;

    expect(result).not.toHaveProperty('warnings');
  });

  it('sample_records never warns about an unordered or full sample', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      match_id: i + 1,
      stage: `Stage ${i}`,
    }));
    installServices({
      runLogicalQuery: jest.fn().mockResolvedValue({
        columns: ['match_id', 'stage'],
        rows,
        entities: ['matches'],
        sql: 'SELECT "matches"."match_id" AS "match_id", "matches"."stage" AS "stage" FROM "main"."public"."matches" AS "matches" LIMIT 20',
      }),
    });

    const result = (await sampleRecordsTool.execute!(
      { entity: 'matches', limit: 20, rationale: 'peek' },
      context,
    )) as Record<string, unknown>;

    expect(result).not.toHaveProperty('warnings');
  });

  it('sample_records still runs the other checks', async () => {
    installServices({
      runLogicalQuery: jest.fn().mockResolvedValue({
        columns: ['match_id', 'stage'],
        rows: [
          { match_id: 1, stage: 'Final' },
          { match_id: 2, stage: null },
        ],
        entities: ['matches'],
        sql: 'SELECT "matches"."match_id" AS "match_id", "matches"."stage" AS "stage" FROM "main"."public"."matches" AS "matches" LIMIT 10',
      }),
    });

    const result = (await sampleRecordsTool.execute!(
      { entity: 'matches', rationale: 'peek' },
      context,
    )) as Record<string, unknown>;

    expect(result.warnings).toEqual([
      'stage is missing on 1 of 2 rows, so those rows are grouped under a blank value.',
    ]);
    expect(queryEntitiesProvenance.get(result)).toEqual(
      expect.objectContaining({ warnings: result.warnings }),
    );
  });

  it('run_raw_sql runs the guards on the statement that ran and keeps correctedSql', async () => {
    installServices({
      runReadOnlySql: jest.fn().mockResolvedValue({
        columns: ['team'],
        rows: [{ team: 'Argentina' }, { team: 'France' }],
        correctedSql: 'SELECT team FROM main.public.teams LIMIT 5',
      }),
    });

    const result = (await runRawSqlTool.execute!(
      {
        entity: 'teams',
        sql: 'SELECT team FROM main.public.team LIMIT 5',
        rationale: 'fallback',
      },
      context,
    )) as Record<string, unknown>;

    expect(result.warnings).toEqual([UNORDERED]);
    expect(result.correctedSql).toBe(
      'SELECT team FROM main.public.teams LIMIT 5',
    );
    expect(result.outsideModel).toBe(true);
  });

  it('run_raw_sql carries no warnings property when nothing is wrong', async () => {
    installServices({
      runReadOnlySql: jest.fn().mockResolvedValue({
        columns: ['team'],
        rows: [{ team: 'Argentina' }, { team: 'France' }],
      }),
    });

    const result = (await runRawSqlTool.execute!(
      {
        entity: 'teams',
        sql: 'SELECT team FROM main.public.teams ORDER BY team',
        rationale: 'fallback',
      },
      context,
    )) as Record<string, unknown>;

    expect(result).not.toHaveProperty('warnings');
  });
});
