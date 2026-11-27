jest.mock('../../modules/readiness-assessor/assess-readiness', () => ({
  assessReadiness: jest.fn(),
}));

import { RequestContext } from '@mastra/core/request-context';
import { assessReadiness } from '../../modules/readiness-assessor/assess-readiness';
import type {
  ReadinessAssessment,
  ReadinessPort,
  ReadinessScope,
} from '../../modules/readiness-assessor/readiness.types';
import type { QueryFacts } from '../../modules/sessions/query-evidence/query-evidence.types';
import { carriedQueryRecords } from '../../modules/sessions/turn-data';
import { setReadinessToolServices } from '../readiness-tool-services';
import {
  QUERY_FACTS_CONTEXT_KEY,
  queryFactsKey,
  setDatasetToolServices,
  type DatasetToolServices,
} from '../tool-services';
import { DATASETS_CONTEXT_KEY } from './dataset-tool-context';
import {
  assessReadinessTool,
  READINESS_SQL_ROW_LIMIT,
  readinessScopeSchema,
} from './readiness.tools';
import { SESSION_ID_CONTEXT_KEY } from './turn-context';

type Execute = (
  input: Record<string, unknown>,
  context: { requestContext: RequestContext; abortSignal?: AbortSignal },
) => Promise<Record<string, unknown>>;
const execute = assessReadinessTool.execute as unknown as Execute;
const engine = assessReadiness as jest.MockedFunction<typeof assessReadiness>;

const COUNT = 'SELECT COUNT(*) AS rows FROM shop.public.orders';
const NULLS =
  'SELECT COUNT(*) - COUNT(customer_id) AS nulls FROM shop.public.orders';

const SCOPE: ReadinessScope = {
  useCase: 'A weekly sales dashboard',
  useType: 'dashboard',
  risk: 'medium',
  entities: ['shop.public.orders'],
  criticalFields: [
    {
      entity: 'shop.public.orders',
      column: 'customer_id',
      indispensable: true,
    },
  ],
  requiredFreshnessHours: 24,
  personalDataNeeded: false,
  assumptions: ['The dashboard is internal.'],
};

function assessmentFor(scope: ReadinessScope): ReadinessAssessment {
  return {
    id: 'ra-1',
    createdAt: '2026-11-26T10:00:00.000Z',
    rubricVersion: '1.0',
    useCaseKey: 'a weekly sales dashboard|shop',
    sessionId: 's-1',
    datasets: ['shop'],
    scope,
    verdict: 'not-ready',
    weightedScore: 1.9,
    conditions: [],
    gates: [
      {
        gate: 'G5',
        status: 'fail',
        reason: 'customer_id is 30% null',
        evidenceIds: ['EV-002'],
      },
    ],
    dimensions: [
      {
        dimension: 'D2',
        applicable: true,
        level: 1,
        weight: 0.25,
        reason: 'More than 20% nulls in a key field',
        evidenceIds: ['EV-002'],
      },
    ],
    findings: [
      {
        id: 'F-001',
        dimension: 'D2',
        gate: 'G5',
        severity: 'blocking',
        entity: 'shop.public.orders',
        column: 'customer_id',
        measured: '30% null',
        threshold: '<= 5% null',
        description: 'Three in ten orders have no customer.',
        evidenceIds: ['EV-002'],
      },
    ],
    evidence: [
      {
        id: 'EV-001',
        dimension: 'D1',
        description: 'How many orders there are.',
        source: 'sql',
        sql: COUNT,
        datasourceId: 'ds-1',
        entity: 'shop.public.orders',
        coverage: 'whole-table',
        result: { rows: 10 },
      },
      {
        id: 'EV-002',
        dimension: 'D2',
        description: 'Orders without a customer.',
        source: 'sql',
        sql: NULLS,
        datasourceId: 'ds-1',
        entity: 'shop.public.orders',
        coverage: 'whole-table',
        result: { nulls: 3, null_rate: 0.3 },
      },
      {
        id: 'EV-003',
        dimension: 'D5',
        description: 'Personal data in a sample of orders.',
        source: 'sample',
        datasourceId: 'ds-1',
        entity: 'shop.public.orders',
        coverage: 'sample',
        sampleSize: 2,
        result: { email_rate: 0.5 },
      },
    ],
    notEvaluated: [{ item: 'Owner metadata', reason: 'The app keeps none.' }],
    escalations: ['No owner is known for shop.'],
  };
}

/** The engine stub: drives the port as the real engine would, then returns. */
function engineThatMeasures() {
  const seen: {
    scope?: ReadinessScope;
    options?: unknown;
    port?: ReadinessPort;
  } = {};
  engine.mockImplementation(async (scope, port, options) => {
    Object.assign(seen, { scope, options, port });
    await port.datasets(['shop', 'not-mine']);
    await port.runSql('ds-1', COUNT);
    await port.runSql('ds-1', NULLS);
    await port.sampleRows('ds-1', 'shop.public.orders', 200);
    await port.previous('a weekly sales dashboard|shop');
    const assessment = assessmentFor(scope);
    await port.save(assessment);
    return assessment;
  });
  return seen;
}

function services(overrides: Partial<DatasetToolServices> = {}) {
  const impl: DatasetToolServices = {
    getDatasets: jest.fn((names: string[]) =>
      Promise.resolve(
        [
          {
            name: 'shop',
            datasourceId: 'ds-1',
            datasourceKind: 'postgres' as const,
            tables: ['shop.public.orders', 'shop.public.customers'],
          },
        ].filter((dataset) => names.includes(dataset.name)),
      ),
    ),
    sampleRows: jest.fn().mockResolvedValue({
      columns: ['email'],
      rows: [{ email: 'ana@example.com' }, { email: null }],
    }),
    runReadOnlySql: jest.fn((_ds: string, sql: string) =>
      Promise.resolve(
        sql === COUNT
          ? { columns: ['rows'], rows: [{ rows: 10 }], totalRows: 1 }
          : { columns: ['nulls'], rows: [{ nulls: 3 }], totalRows: 1 },
      ),
    ),
    ...overrides,
  };
  setDatasetToolServices(impl);
  return impl;
}

function readinessStore() {
  const store = {
    previous: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue(undefined),
  };
  setReadinessToolServices(store);
  return store;
}

function turnContext(datasets: string[] = ['shop']) {
  const requestContext = new RequestContext();
  const facts = new Map<string, QueryFacts>();
  requestContext.set(DATASETS_CONTEXT_KEY, datasets);
  requestContext.set(SESSION_ID_CONTEXT_KEY, 's-1');
  requestContext.set(QUERY_FACTS_CONTEXT_KEY, facts);
  return { requestContext, facts };
}

const call = (requestContext: RequestContext, scope: unknown = SCOPE) =>
  execute(
    { scope, rationale: 'I check the orders for the dashboard.' },
    {
      requestContext,
    },
  );

beforeEach(() => engine.mockReset());

describe('assess_readiness (plan data-readiness-assessor 2, 3)', () => {
  it("runs the engine on the scope, the conversation's datasets and its session", async () => {
    services();
    readinessStore();
    const seen = engineThatMeasures();
    const { requestContext } = turnContext();
    await call(requestContext);
    expect(seen.scope).toEqual(SCOPE);
    expect(seen.options).toEqual({ datasets: ['shop'], sessionId: 's-1' });
  });

  it("gives the engine only the conversation's datasets, a small row cap and the stored baselines", async () => {
    const data = services();
    const store = readinessStore();
    engineThatMeasures();
    const { requestContext } = turnContext();
    await call(requestContext);
    /* eslint-disable @typescript-eslint/unbound-method -- jest doubles */
    expect(data.getDatasets).toHaveBeenLastCalledWith(['shop']);
    expect(data.runReadOnlySql).toHaveBeenCalledWith(
      'ds-1',
      COUNT,
      READINESS_SQL_ROW_LIMIT,
      ['shop'],
    );
    expect(READINESS_SQL_ROW_LIMIT).toBeLessThanOrEqual(100);
    expect(data.sampleRows).toHaveBeenCalledWith(
      'ds-1',
      'shop.public.orders',
      200,
    );
    expect(store.previous).toHaveBeenCalledWith(
      'a weekly sales dashboard|shop',
    );
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ra-1' }),
    );
    /* eslint-enable @typescript-eslint/unbound-method */
  });

  it('returns the compact projection the report quotes, with no rows and no sampled value', async () => {
    services();
    readinessStore();
    engineThatMeasures();
    const { requestContext } = turnContext();
    const result = await call(requestContext);
    const hook = (
      assessReadinessTool as unknown as {
        toModelOutput: (output: unknown) => { type: string; value: unknown };
      }
    ).toModelOutput;
    const seen = hook(result);
    expect(seen.type).toBe('json');
    expect(seen.value).toMatchObject({
      assessmentId: 'ra-1',
      rubricVersion: '1.0',
      verdict: 'not-ready',
      weightedScore: 1.9,
      useType: 'dashboard',
      risk: 'medium',
      assumptions: ['The dashboard is internal.'],
      gates: [{ gate: 'G5', status: 'fail' }],
      dimensions: [{ dimension: 'D2', level: 1 }],
      findings: [{ id: 'F-001', measured: '30% null' }],
      notEvaluated: [{ item: 'Owner metadata' }],
      escalations: ['No owner is known for shop.'],
      evidence: [
        { id: 'EV-001', description: 'How many orders there are.', sql: COUNT },
        { id: 'EV-002', sql: NULLS, result: { nulls: 3, null_rate: 0.3 } },
        { id: 'EV-003', source: 'sample', sampleSize: 2 },
      ],
    });
    const text = JSON.stringify(seen.value);
    expect(text).not.toContain('queryRecords');
    expect(text).not.toContain('"rows":[');
    expect(text).not.toContain('ana@example.com');
    expect(text).not.toContain('ds-1');
  });

  it("carries the engine's SQL for the query inspector, each cited by its evidence, with its datasource", async () => {
    services();
    readinessStore();
    engineThatMeasures();
    const { requestContext, facts } = turnContext();
    const result = await call(requestContext);
    expect(carriedQueryRecords(result)).toEqual([
      {
        tool: 'run_readonly_sql',
        input: COUNT,
        columns: ['rows'],
        rows: [{ rows: 10 }],
        rowCount: 1,
        rationale: 'EV-001: How many orders there are.',
      },
      {
        tool: 'run_readonly_sql',
        input: NULLS,
        columns: ['nulls'],
        rows: [{ nulls: 3 }],
        rowCount: 1,
        rationale: 'EV-002: Orders without a customer.',
      },
    ]);
    expect(facts.get(queryFactsKey('run_readonly_sql', COUNT))).toEqual({
      datasourceId: 'ds-1',
      rowLimit: READINESS_SQL_ROW_LIMIT,
      totalRows: 1,
    });
    // A sample is never a query record: its values stay in the engine.
    expect(JSON.stringify(result)).not.toContain('ana@example.com');
  });

  it('records the statement that ran when the fixer repaired it', async () => {
    services({
      runReadOnlySql: jest.fn((_ds: string, sql: string) =>
        Promise.resolve({
          columns: ['rows'],
          rows: [{ rows: 10 }],
          ...(sql === NULLS ? { correctedSql: `${NULLS} -- fixed` } : {}),
        }),
      ),
    });
    readinessStore();
    engineThatMeasures();
    const { requestContext } = turnContext();
    const records = carriedQueryRecords(await call(requestContext));
    expect(records[1]).toMatchObject({
      input: `${NULLS} -- fixed`,
      rationale: 'EV-002: Orders without a customer.',
    });
  });

  it("refuses a statement on a datasource outside the conversation's datasets", async () => {
    services();
    readinessStore();
    engine.mockImplementation(async (_scope, port) => {
      await port.runSql('ds-other', COUNT);
      throw new Error('unreachable');
    });
    const { requestContext } = turnContext();
    expect(await call(requestContext)).toEqual({
      error:
        'Datasource "ds-other" is not used by this conversation\'s datasets',
    });
  });

  it("answers an error, without running the engine, for an entity outside the conversation's datasets", async () => {
    services();
    readinessStore();
    const { requestContext } = turnContext();
    const result = await call(requestContext, {
      ...SCOPE,
      criticalFields: [
        { entity: 'hr.public.salaries', column: 'amount', indispensable: true },
      ],
    });
    expect(result.error).toContain(
      'Entity "hr.public.salaries" is not part of this conversation\'s datasets',
    );
    expect(result.error).toContain('shop.public.orders');
    expect(engine).not.toHaveBeenCalled();
  });

  it('answers an error with no dataset in the conversation', async () => {
    services();
    readinessStore();
    const { requestContext } = turnContext([]);
    expect(await call(requestContext)).toEqual({
      error: 'This conversation has no dataset to assess',
    });
    expect(engine).not.toHaveBeenCalled();
  });

  it("answers the engine's failure as an error instead of throwing", async () => {
    services();
    readinessStore();
    engine.mockRejectedValue(
      new Error('assessReadiness is not implemented yet'),
    );
    const { requestContext } = turnContext();
    expect(await call(requestContext)).toEqual({
      error: 'assessReadiness is not implemented yet',
    });
  });

  it('throws when the turn was stopped, so the call ends', async () => {
    services();
    readinessStore();
    const stop = new AbortController();
    engine.mockImplementation(() => {
      stop.abort();
      return Promise.reject(new Error('aborted'));
    });
    const { requestContext } = turnContext();
    await expect(
      execute(
        { scope: SCOPE, rationale: 'r' },
        { requestContext, abortSignal: stop.signal },
      ),
    ).rejects.toThrow('aborted');
  });
});

describe('the scoping card (skill readiness-scoping)', () => {
  it('accepts a complete card', () => {
    expect(readinessScopeSchema.safeParse(SCOPE).success).toBe(true);
  });

  it.each([
    ['an unknown use type', { ...SCOPE, useType: 'report' }],
    ['an unknown risk', { ...SCOPE, risk: 'extreme' }],
    ['an empty use case', { ...SCOPE, useCase: '  ' }],
    [
      'a null rate above 1',
      {
        ...SCOPE,
        criticalFields: [
          {
            entity: 'shop.public.orders',
            column: 'id',
            indispensable: true,
            maxNullRate: 5,
          },
        ],
      },
    ],
    ['a freshness of 0 hours', { ...SCOPE, requiredFreshnessHours: 0 }],
    ['no assumptions list', { ...SCOPE, assumptions: undefined }],
    ['no personal-data answer', { ...SCOPE, personalDataNeeded: undefined }],
    [
      'a grain key without columns',
      { ...SCOPE, grainKeys: [{ entity: 'shop.public.orders', columns: [] }] },
    ],
  ])('rejects %s', (_label, scope) => {
    expect(readinessScopeSchema.safeParse(scope).success).toBe(false);
  });
});
