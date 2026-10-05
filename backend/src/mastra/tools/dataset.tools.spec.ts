import { RequestContext } from '@mastra/core/request-context';
import {
  ENGINE_DEFAULTS,
  ENGINE_OPTIONS_CONTEXT_KEY,
  resolveEngineOptions,
  type EngineOptions,
} from '../../modules/engine/engine-options';
import { inspectResult } from '../../modules/sessions/result-guards';
import { SQL_HINT_MARKER } from '../../modules/sessions/sql-errors';
import { SEMANTIC_REPAIR_WARNING } from '../../modules/sessions/sql-repair-guard';
import {
  setDatasetToolServices,
  type ColumnProfile,
  type DatasetColumnSnapshot,
  type DatasetSnapshot,
  type DatasetToolServices,
  type SqlRunResult,
} from '../tool-services';
import {
  compactProfile,
  DATASETS_CONTEXT_KEY,
  datasetTools,
  describeEntityTool,
  listEntitiesTool,
  runReadOnlySqlTool,
  sampleRowsTool,
} from './dataset.tools';

const DB = 'questions_to_insights.health_insurance';
const CLAIMS = `${DB}.claims`;

const STATUS_PROFILE: ColumnProfile = {
  sampledRows: 1000,
  nullRate: 0,
  distinctCount: 4,
  constant: false,
  topValues: [
    { value: 'PAID', count: 700 },
    { value: 'DENIED', count: 150 },
    { value: 'PENDING', count: 100 },
    { value: 'REVERSED', count: 50 },
  ],
  profiledAt: '2026-09-23T00:00:00Z',
};

function claimsColumns(withProfiles = false): DatasetColumnSnapshot[] {
  return [
    { name: 'id', type: 'bigint', nullable: false },
    {
      name: 'member_id',
      type: 'bigint',
      nullable: false,
      references: { entity: `${DB}.members`, column: 'id', source: 'declared' },
    },
    {
      name: 'status',
      type: 'text',
      nullable: false,
      sampleValues: ['PAID', 'DENIED'],
      ...(withProfiles ? { profile: STATUS_PROFILE } : {}),
    },
    {
      name: 'currency',
      type: 'text',
      nullable: false,
      sampleValues: ['USD'],
      ...(withProfiles
        ? {
            profile: {
              sampledRows: 1000,
              nullRate: 0,
              distinctCount: 1,
              constant: true,
              topValues: [{ value: 'USD', count: 1000 }],
              profiledAt: '2026-09-23T00:00:00Z',
            },
          }
        : {}),
    },
    {
      name: 'paid_amount_cents',
      type: 'bigint',
      nullable: false,
      ...(withProfiles
        ? {
            profile: {
              sampledRows: 1000,
              nullRate: 0.12,
              distinctCount: 812,
              constant: false,
              min: '0',
              max: '98000',
              magnitude: 'cents-like' as const,
              profiledAt: '2026-09-23T00:00:00Z',
            },
          }
        : {}),
    },
    { name: 'is_test', type: 'boolean', nullable: false },
  ];
}

function snapshots(withProfiles = false): DatasetSnapshot[] {
  return [
    {
      name: 'Health Insurance',
      datasourceId: 'pg-1',
      datasourceKind: 'postgres',
      tables: [CLAIMS, `${DB}.members`],
      entities: [
        { key: CLAIMS, columns: claimsColumns(withProfiles) },
        {
          key: `${DB}.members`,
          columns: [
            { name: 'id', type: 'bigint', nullable: false },
            { name: 'full_name', type: 'text', nullable: false },
          ],
        },
      ],
    },
  ];
}

type Bridge = jest.Mocked<Required<DatasetToolServices>>;

function install(
  options: { withProfiles?: boolean; result?: SqlRunResult } = {},
): Bridge {
  const bridge = {
    getDatasets: jest.fn(async () => snapshots(options.withProfiles)),
    sampleRows: jest.fn(async () => ({ columns: ['id'], rows: [{ id: 1 }] })),
    runReadOnlySql: jest.fn(
      async (): Promise<SqlRunResult> =>
        options.result ?? {
          columns: ['status', 'n'],
          rows: [{ status: 'PAID', n: 3 }],
        },
    ),
    createVisual: jest.fn(),
    updateVisual: jest.fn(),
    lookupValues: jest.fn(async () => []),
    knowledgeFor: jest.fn(async () => ({ snippets: [], metrics: [] })),
    defaultFilters: jest.fn(async () => [
      {
        entity: CLAIMS,
        title: 'Exclude test claims',
        predicate:
          'exclude claims where is_test = true from every claims aggregate',
      },
    ]),
  } as unknown as Bridge;
  setDatasetToolServices(bridge);
  return bridge;
}

function context(engine?: Partial<EngineOptions>): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(DATASETS_CONTEXT_KEY, ['Health Insurance']);
  if (engine)
    requestContext.set(
      ENGINE_OPTIONS_CONTEXT_KEY,
      resolveEngineOptions(engine),
    );
  return requestContext;
}

// Tool results are loosely typed (a union with Mastra's validation error).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(
  tool: { execute?: (...args: any[]) => any },
  input: unknown,
  engine?: Partial<EngineOptions>,
): Promise<any> {
  return tool.execute!(input, { requestContext: context(engine) });
}

/**
 * What `run_readonly_sql` returned before the engine levers existed, given
 * the same bridge result — the tool's pre-lever body, verbatim in effect.
 */
function legacyRunOutput(
  result: SqlRunResult,
  sql: string,
  rowLimit: number,
): unknown {
  const executed =
    typeof result.correctedSql === 'string' ? result.correctedSql : sql;
  const warnings = inspectResult(executed, result.rows ?? [], rowLimit).map(
    (w) => w.message,
  );
  return warnings.length ? { ...result, warnings } : result;
}

const SQL =
  'SELECT status, COUNT(*) AS n FROM health_insurance.claims WHERE is_test = false GROUP BY status';

describe('dataset tools — default engine is byte-identical to the pre-lever tools', () => {
  const scenarios: [string, SqlRunResult, string, number][] = [
    [
      'rows',
      {
        columns: ['status', 'n'],
        rows: [
          { status: 'PAID', n: 3 },
          { status: 'DENIED', n: 2 },
        ],
      },
      SQL,
      100,
    ],
    [
      'repaired + guard warning',
      {
        columns: ['status', 'n'],
        rows: [
          { status: 'PAID', n: 1 },
          { status: 'DENIED', n: 1 },
        ],
        correctedSql: `${SQL} LIMIT 50`,
        note: 'original query failed and was auto-corrected — cite the corrected SQL',
      },
      SQL,
      100,
    ],
    [
      'zero rows',
      {
        columns: ['n'],
        rows: [],
        note: 'query returned 0 rows — verify filters/values before concluding',
      },
      "SELECT COUNT(*) AS n FROM health_insurance.claims WHERE status = 'APPROVED'",
      100,
    ],
    [
      'row cap',
      {
        columns: ['id'],
        rows: Array.from({ length: 20 }, (_, i) => ({ id: i })),
        truncated: true,
        note: 'row limit 20 reached',
      },
      'SELECT id FROM health_insurance.claims',
      20,
    ],
  ];

  it.each(scenarios)(
    'run_readonly_sql: %s',
    async (_name, result, sql, limit) => {
      const bridge = install({ result });
      for (const engine of [undefined, { ...ENGINE_DEFAULTS }]) {
        const output = await call(
          runReadOnlySqlTool,
          { sql, limit, rationale: 'why' },
          engine,
        );
        expect(JSON.stringify(output)).toBe(
          JSON.stringify(legacyRunOutput(result, sql, limit)),
        );
      }
      expect(bridge.defaultFilters).not.toHaveBeenCalled();
    },
  );

  it('run_readonly_sql passes the resolved levers to the bridge', async () => {
    const bridge = install();
    await call(runReadOnlySqlTool, { sql: SQL, rationale: 'why' });
    expect(bridge.runReadOnlySql).toHaveBeenCalledWith(
      'pg-1',
      SQL,
      100,
      ['Health Insurance'],
      {
        engine: resolveEngineOptions(),
      },
    );
  });

  it('run_readonly_sql: an error is the raw message', async () => {
    const bridge = install();
    bridge.runReadOnlySql.mockRejectedValueOnce(
      new Error('Postgres — column c.amount does not exist'),
    );
    expect(
      await call(runReadOnlySqlTool, {
        sql: 'SELECT c.amount FROM health_insurance.claims c',
        rationale: 'why',
      }),
    ).toEqual({
      error: 'Postgres — column c.amount does not exist',
    });
  });

  it('describe_entity returns the stored columns untouched', async () => {
    install();
    const output = await call(describeEntityTool, { entity: CLAIMS });
    expect(JSON.stringify(output)).toBe(
      JSON.stringify({
        entity: CLAIMS,
        datasourceId: 'pg-1',
        datasourceKind: 'postgres',
        columns: claimsColumns(false),
      }),
    );
  });

  it('describe_entity keeps stored profiles out of the default output', async () => {
    install({ withProfiles: true });
    const output = await call(describeEntityTool, { entity: CLAIMS });
    expect(JSON.stringify(output.columns)).toBe(
      JSON.stringify(claimsColumns(false)),
    );
  });

  it('list_entities and sample_rows are unchanged', async () => {
    const bridge = install();
    expect(await call(listEntitiesTool, {})).toEqual({
      entities: [
        {
          entity: CLAIMS,
          columnCount: 6,
          datasourceId: 'pg-1',
          datasourceKind: 'postgres',
          dataset: 'Health Insurance',
        },
        {
          entity: `${DB}.members`,
          columnCount: 2,
          datasourceId: 'pg-1',
          datasourceKind: 'postgres',
          dataset: 'Health Insurance',
        },
      ],
    });
    expect(
      await call(sampleRowsTool, { entity: CLAIMS, rationale: 'why' }),
    ).toEqual({ columns: ['id'], rows: [{ id: 1 }] });
    expect(bridge.sampleRows).toHaveBeenCalledWith('pg-1', CLAIMS, 10);
  });

  it('keeps the tool map and ids', () => {
    expect(Object.keys(datasetTools)).toEqual([
      'list_entities',
      'describe_entity',
      'sample_rows',
      'run_readonly_sql',
    ]);
    for (const [key, tool] of Object.entries(datasetTools))
      expect(tool.id).toBe(key);
  });
});

describe('run_readonly_sql — descriptive errors (lever descriptiveErrors)', () => {
  it('appends the closest columns to an unknown-column error', async () => {
    const bridge = install();
    bridge.runReadOnlySql.mockRejectedValueOnce(
      new Error('Postgres — column c.amount does not exist'),
    );
    const output = await call(
      runReadOnlySqlTool,
      {
        sql: 'SELECT SUM(c.amount) FROM health_insurance.claims c',
        rationale: 'why',
      },
      { descriptiveErrors: true },
    );
    expect(
      output.error.startsWith(
        `Postgres — column c.amount does not exist${SQL_HINT_MARKER}Closest columns on health_insurance.claims: paid_amount_cents, `,
      ),
    ).toBe(true);
  });

  it('adds the column vocabulary to a zero-row result', async () => {
    install({
      withProfiles: true,
      result: {
        columns: ['n'],
        rows: [],
        note: 'query returned 0 rows — verify filters/values before concluding',
      },
    });
    const output = await call(
      runReadOnlySqlTool,
      {
        sql: "SELECT COUNT(*) AS n FROM health_insurance.claims c WHERE c.status = 'APPROVED'",
        rationale: 'why',
      },
      { descriptiveErrors: true },
    );
    const hint =
      'status holds: PAID, DENIED, PENDING, REVERSED (case-sensitive).';
    expect(output.note).toBe(
      `query returned 0 rows — verify filters/values before concluding; ${hint}`,
    );
    expect(output.hints).toEqual([hint]);
  });

  it('does not repeat a hint the bridge already attached', async () => {
    const hint =
      'status holds: PAID, DENIED, PENDING, REVERSED (case-sensitive).';
    install({
      withProfiles: true,
      result: {
        columns: ['n'],
        rows: [],
        note: `0 rows; ${hint}`,
        hints: [hint],
      },
    });
    const output = await call(
      runReadOnlySqlTool,
      {
        sql: "SELECT COUNT(*) AS n FROM health_insurance.claims c WHERE c.status = 'APPROVED'",
        rationale: 'why',
      },
      { descriptiveErrors: true },
    );
    expect(output.note).toBe(`0 rows; ${hint}`);
    expect(output.hints).toEqual([hint]);
  });
});

describe('run_readonly_sql — precheck and repair warnings', () => {
  it('merges bridge precheck findings and semantic-repair warnings into warnings', async () => {
    install({
      result: {
        columns: ['status', 'n'],
        rows: [
          { status: 'PAID', n: 3 },
          { status: 'DENIED', n: 2 },
        ],
        correctedSql: `${SQL.replace('is_test = false', 'is_test = true')}`,
        precheck: [
          'health_insurance.claims has no column stat — closest: status.',
        ],
        repairs: [
          {
            original: SQL,
            repaired: SQL.replace('is_test = false', 'is_test = true'),
            error: 'boom',
            kind: 'semantic',
            warning: SEMANTIC_REPAIR_WARNING,
          },
        ],
      },
    });
    const output = await call(runReadOnlySqlTool, {
      sql: SQL,
      rationale: 'why',
    });
    expect(output.warnings).toEqual([
      `repair: ${SEMANTIC_REPAIR_WARNING} (filter value: FALSE → TRUE)`,
      'precheck: health_insurance.claims has no column stat — closest: status.',
    ]);
    // The raw records ride along for the turn record (U1-A reads them).
    expect(output.precheck).toHaveLength(1);
    expect(output.repairs).toHaveLength(1);
  });

  it('ignores identifier repairs without a warning', async () => {
    install({
      result: {
        columns: ['n'],
        rows: [{ n: 3 }],
        repairs: [
          { original: 'a', repaired: 'b', error: 'x', kind: 'identifier' },
        ],
      },
    });
    const output = await call(runReadOnlySqlTool, {
      sql: SQL,
      rationale: 'why',
    });
    expect(output.warnings).toBeUndefined();
  });
});

describe('run_readonly_sql — extended guards (lever extendedGuards)', () => {
  it('fetches default filters and runs the extended guards', async () => {
    const bridge = install({
      result: { columns: ['member_id', 'n'], rows: [{ member_id: 4, n: 9 }] },
    });
    const sql =
      'SELECT member_id, COUNT(*) AS n FROM health_insurance.claims GROUP BY member_id ORDER BY n DESC LIMIT 1';
    const output = await call(
      runReadOnlySqlTool,
      { sql, limit: 1, rationale: 'why' },
      { extendedGuards: true },
    );
    expect(bridge.defaultFilters).toHaveBeenCalledWith(['Health Insurance']);
    expect(output.warnings).toEqual([
      'The result names its rows only by member_id, so join to the table that holds their names and report those instead.',
      'The query reads claims without its default filter "Exclude test claims" (is_test), so rows that filter excludes are counted.',
    ]);
  });

  it('does not repeat a default filter the precheck already raised', async () => {
    install({
      result: {
        columns: ['n'],
        rows: [{ n: 9 }],
        precheck: [
          'health_insurance.claims has default filter "Exclude test claims" but the query never uses is_test — apply it.',
        ],
      },
    });
    const output = await call(
      runReadOnlySqlTool,
      {
        sql: 'SELECT COUNT(*) AS n FROM health_insurance.claims',
        rationale: 'why',
      },
      { extendedGuards: true, sqlPrecheck: true },
    );
    expect(output.warnings).toEqual([
      'precheck: health_insurance.claims has default filter "Exclude test claims" but the query never uses is_test — apply it.',
    ]);
  });

  it('keeps answering when the default-filter lookup fails', async () => {
    const bridge = install({ result: { columns: ['n'], rows: [{ n: 9 }] } });
    bridge.defaultFilters.mockRejectedValueOnce(new Error('store down'));
    const output = await call(
      runReadOnlySqlTool,
      {
        sql: 'SELECT COUNT(*) AS n FROM health_insurance.claims',
        rationale: 'why',
      },
      { extendedGuards: true },
    );
    expect(output).toEqual({ columns: ['n'], rows: [{ n: 9 }] });
  });
});

describe('describe_entity — profiles and inline knowledge', () => {
  it('renders each column profile as one compact line (lever columnProfiles)', async () => {
    install({ withProfiles: true });
    const output = await call(
      describeEntityTool,
      { entity: CLAIMS },
      { columnProfiles: true },
    );
    const byName = Object.fromEntries(
      output.columns.map((c: { name: string }) => [c.name, c]),
    );
    expect(byName.status.profile).toBe(
      '4 distinct; values: PAID (700), DENIED (150), PENDING (100), REVERSED (50)',
    );
    expect(byName.currency.profile).toBe('constant: every row holds USD');
    expect(byName.paid_amount_cents.profile).toBe(
      '12% null; 812 distinct; range 0 … 98000; looks like cents (divide by 100 for currency units)',
    );
    expect(byName.id.profile).toBeUndefined();
    expect(byName.status.sampleValues).toEqual(['PAID', 'DENIED']);
    expect(output.knowledge).toBeUndefined();
  });

  it('puts knowledge beside its column, the rest and the metrics on the entity (lever inlineKnowledge)', async () => {
    const bridge = install();
    bridge.knowledgeFor.mockResolvedValueOnce({
      snippets: [
        {
          kind: 'term',
          title: 'Approved',
          body: "'approved' means status PAID",
          entities: [CLAIMS],
          column: 'status',
        },
        {
          kind: 'default_filter',
          title: 'Exclude test claims',
          body: 'exclude is_test = true',
          entities: [CLAIMS],
        },
      ],
      metrics: [
        {
          name: 'net_paid',
          entity: CLAIMS,
          expression: 'SUM(paid_amount_cents)',
        },
      ],
    });
    const output = await call(
      describeEntityTool,
      { entity: CLAIMS },
      { columnProfiles: true, inlineKnowledge: true },
    );
    expect(bridge.knowledgeFor).toHaveBeenCalledWith(['Health Insurance'], {
      entity: CLAIMS,
    });
    const status = output.columns.find(
      (c: { name: string }) => c.name === 'status',
    );
    expect(status.knowledge).toEqual([
      "[term] Approved: 'approved' means status PAID",
    ]);
    expect(output.knowledge).toEqual([
      '[default_filter] Exclude test claims: exclude is_test = true',
    ]);
    expect(output.metrics).toEqual([
      {
        name: 'net_paid',
        entity: CLAIMS,
        expression: 'SUM(paid_amount_cents)',
      },
    ]);
  });

  it('never inlines knowledge in the bare arm, and survives a failed lookup', async () => {
    const bridge = install();
    await call(
      describeEntityTool,
      { entity: CLAIMS },
      { inlineKnowledge: true, context: 'bare' },
    );
    expect(bridge.knowledgeFor).not.toHaveBeenCalled();
    bridge.knowledgeFor.mockRejectedValueOnce(new Error('down'));
    const output = await call(
      describeEntityTool,
      { entity: CLAIMS },
      { inlineKnowledge: true },
    );
    expect(output.columns).toEqual(claimsColumns(false));
  });

  it('still refuses entities outside the session', async () => {
    install();
    expect(
      await call(
        describeEntityTool,
        { entity: 'other.schema.table' },
        { columnProfiles: true },
      ),
    ).toEqual({
      error: `Entity "other.schema.table" is not part of this session's datasets`,
    });
  });
});

describe('compactProfile', () => {
  it('handles all-null and incomplete vocabularies', () => {
    expect(
      compactProfile({ ...STATUS_PROFILE, nullRate: 1, topValues: [] }),
    ).toBe('always null');
    expect(compactProfile({ ...STATUS_PROFILE, distinctCount: 40 })).toBe(
      '40 distinct; most common: PAID (700), DENIED (150), PENDING (100), REVERSED (50)',
    );
    expect(compactProfile({ ...STATUS_PROFILE, nullRate: 0.001 })).toMatch(
      /^<1% null; /,
    );
  });
});
