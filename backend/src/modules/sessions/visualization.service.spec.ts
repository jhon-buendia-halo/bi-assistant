jest.mock('@mastra/core/request-context', () => ({
  RequestContext: class {
    set = jest.fn();
  },
}));
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/session-workspaces', () => ({
  SESSION_WORKSPACE_CONTEXT_KEY: 'session-workspace',
}));
// `marked` is ESM-only; the document builders are exercised elsewhere.
jest.mock('./visualization-document', () => ({
  storedVisualizationDocument: jest.fn().mockReturnValue('<html></html>'),
  sandboxedVisualizationDocument: jest.fn().mockReturnValue('<html></html>'),
  FRAME_SCRIPT_FILENAME: 'qti-frame.js',
  FRAME_SELECT_SCRIPT: '/* frame bridge */',
}));
jest.mock('./visual-runtime', () => ({
  VISUAL_RUNTIME_FILENAME: 'qti-chart.js',
  VISUAL_RUNTIME_SCRIPT: '/* runtime */',
}));
jest.mock('./zip-archive', () => ({ createZip: jest.fn() }));
jest.mock('../../mastra/tool-services', () => ({
  getDatasetToolServices: jest.fn(),
}));

import {
  sandboxedVisualizationDocument,
  storedVisualizationDocument,
} from './visualization-document';
import { getDatasetToolServices } from '../../mastra/tool-services';
import { createZip } from './zip-archive';
import { VisualizationService, chartRecords } from './visualization.service';
import type {
  SessionDoc,
  ReasoningStep,
  ToolDataRecord,
} from './entities/session.entity';

const bundle = {
  title: 'Claims by month',
  description: 'Denials peak in March.',
  html: '<div id="chart"></div>',
  css: '.chart { color: red; }',
  javascript: 'const x = 1;',
};

/** An answer whose stored rows exceed what the designer prompt may carry. */
function sessionWithRows(stored: number, rowCount: number): SessionDoc {
  const record: ToolDataRecord = {
    tool: 'run_readonly_sql',
    input: 'SELECT month, n FROM main.health.claims',
    columns: ['month', 'n'],
    rows: Array.from({ length: stored }, (_, n) => ({ month: n, n })),
    rowCount,
    ...(rowCount > stored ? { truncated: true } : {}),
  };
  return {
    id: 'session-1',
    name: 'Claims',
    datasets: ['claims'],
    visualizations: [],
    messages: [
      {
        role: 'user',
        content: 'Claims per month?',
        at: '2024-01-01T00:00:00.000Z',
      },
      {
        role: 'assistant',
        content: 'March is the peak.',
        at: '2024-01-01T00:00:01.000Z',
        data: [record],
      },
    ],
  };
}

function build() {
  const filesystem = {
    // Freeform visuals have no spec.json — a real filesystem throws for it.
    readFile: jest.fn((path: string) => {
      if (String(path).endsWith('spec.json'))
        return Promise.reject(new Error('ENOENT'));
      return Promise.resolve('# skill');
    }),
    writeFile: jest
      .fn<Promise<void>, [path: string, data: unknown]>()
      .mockResolvedValue(undefined),
  };
  const agent = { generate: jest.fn().mockResolvedValue({ object: bundle }) };
  const mastra = {
    getAgent: jest.fn().mockReturnValue(agent),
    ensureSessionWorkspace: jest
      .fn()
      .mockResolvedValue({ id: 'workspace-1', filesystem }),
  };
  return {
    service: new VisualizationService(mastra as never),
    agent,
    filesystem,
  };
}

/** One stored result set of `rows` rows, its query counting `rowCount`. */
function sizedRecord(
  input: string,
  rows: number,
  rowCount = rows,
): ToolDataRecord {
  return {
    tool: 'run_readonly_sql',
    input,
    columns: ['n'],
    rows: Array.from({ length: rows }, (_, n) => ({ n })),
    rowCount,
  };
}

/**
 * The run that drew 33 of 45 states (2026-11): four queries of 3, 12, 45 and
 * 1 rows, the single-row one holding the headline totals.
 */
function censusRecords(): ToolDataRecord[] {
  const sql = (
    input: string,
    columns: string[],
    rows: Record<string, unknown>[],
  ): ToolDataRecord => ({
    tool: 'run_readonly_sql',
    input,
    columns,
    rows,
    rowCount: rows.length,
  });
  return [
    sql(
      'SELECT plan_type, employees FROM census GROUP BY plan_type',
      ['plan_type', 'employees'],
      ['HSA', 'PPO', 'NA'].map((plan_type, n) => ({
        plan_type,
        employees: 100 + n,
      })),
    ),
    sql(
      'SELECT age_band, hsa, ppo FROM census GROUP BY age_band',
      ['age_band', 'hsa', 'ppo'],
      Array.from({ length: 12 }, (_, n) => ({
        age_band: `${20 + 5 * n}-${24 + 5 * n}`,
        hsa: n,
        ppo: 2 * n,
      })),
    ),
    sql(
      'SELECT state, employees FROM census GROUP BY state',
      ['state', 'employees'],
      Array.from({ length: 45 }, (_, n) => ({
        state: `S${n}`,
        employees: 45 - n,
      })),
    ),
    sql(
      'SELECT count(*) AS total_employees, avg(age) AS avg_age FROM census',
      ['total_employees', 'avg_age'],
      [{ total_employees: 1035, avg_age: 41.2 }],
    ),
  ];
}

describe('chartRecords', () => {
  it('keeps every result set of the run, in run order, with all its rows', () => {
    const records = censusRecords();

    const drawn = chartRecords(records);

    expect(drawn.map((r) => r.input)).toEqual(records.map((r) => r.input));
    expect(drawn.map((r) => r.rows.length)).toEqual([3, 12, 45, 1]);
    expect(drawn[2].rows).toEqual(records[2].rows);
  });

  it('skips failed and empty result sets', () => {
    const drawn = chartRecords([
      { tool: 'run_readonly_sql', error: 'boom', rowCount: 9 },
      sizedRecord('empty', 0),
      sizedRecord('kept', 2),
    ]);

    expect(drawn.map((r) => r.input)).toEqual(['kept']);
  });

  it('keeps the 8 largest of 10 result sets, in run order', () => {
    const records = [3, 50, 2, 40, 30, 20, 10, 9, 8, 7].map((rows, n) =>
      sizedRecord(`SELECT ${n}`, rows),
    );

    const drawn = chartRecords(records);

    // The two smallest (2 and 3 rows) are left out.
    const expected = ['SELECT 1', 'SELECT 3', 'SELECT 4', 'SELECT 5'].concat([
      'SELECT 6',
      'SELECT 7',
      'SELECT 8',
      'SELECT 9',
    ]);
    expect(drawn.map((r) => r.input)).toEqual(expected);
    expect(drawn[0].rows).toHaveLength(50);
  });

  it('halves the largest result set until the embedded data fits', () => {
    const wide = 'x'.repeat(500);
    const record: ToolDataRecord = {
      tool: 'run_readonly_sql',
      input: 'SELECT wide',
      columns: ['n', 'text'],
      rows: Array.from({ length: 2000 }, (_, n) => ({ n, text: wide })),
      rowCount: 2000,
    };

    const drawn = chartRecords([record, sizedRecord('small', 30)]);

    // About 1 MB at 2,000 rows: 1,000 is still over 400,000 characters, 500 fits.
    expect(drawn[0].rows).toHaveLength(500);
    expect(drawn[1].rows).toHaveLength(30);
    expect(JSON.stringify(drawn).length).toBeLessThanOrEqual(400_000);
  });

  it('never cuts a result set under 20 rows to fit', () => {
    const huge = 'x'.repeat(30_000);
    const record: ToolDataRecord = {
      tool: 'run_readonly_sql',
      input: 'SELECT huge',
      columns: ['n', 'text'],
      rows: Array.from({ length: 100 }, (_, n) => ({ n, text: huge })),
      rowCount: 100,
    };

    const drawn = chartRecords([record]);

    expect(drawn[0].rows).toHaveLength(20);
  });
});

// Driven through the viewer's download: the frame context it writes.
describe('VisualizationService contextFor reasoning', () => {
  beforeEach(() => {
    (storedVisualizationDocument as jest.Mock).mockClear();
  });

  const reasoningOf = (calls: unknown[][]) =>
    (calls[0][1] as { reasoning?: ReasoningStep[] }).reasoning;

  it('uses the persisted reasoning field when present, ignoring per-record rationale', async () => {
    const { service } = build();
    const session = sessionWithRows(20, 20);
    const persisted: ReasoningStep[] = [
      {
        step: 1,
        rationale: 'Persisted rationale.',
        tool: 'run_readonly_sql',
        rowCount: 20,
      },
    ];
    session.messages[1].reasoning = persisted;
    session.messages[1].data![0].rationale = 'Should be ignored.';

    await service.download(withVisual(session), 'visual-1');

    const calls = (storedVisualizationDocument as jest.Mock).mock
      .calls as unknown[][];
    expect(reasoningOf(calls)).toEqual(persisted);
  });

  it('derives reasoning from data records carrying a rationale when the field is absent, in order', async () => {
    const { service } = build();
    const session = sessionWithRows(20, 20);
    session.messages[1].data = [
      { tool: 'run_readonly_sql', input: 'SELECT 1' }, // no rationale: skipped
      {
        tool: 'run_readonly_sql',
        input: 'SELECT 2',
        rationale: 'First, sized up total volume.',
        rowCount: 12,
      },
      {
        tool: 'run_readonly_sql',
        input: 'SELECT 3',
        rationale: 'Then tried a regional split.',
        error: 'boom',
      },
    ];

    await service.download(withVisual(session), 'visual-1');

    const calls = (storedVisualizationDocument as jest.Mock).mock
      .calls as unknown[][];
    expect(reasoningOf(calls)).toEqual([
      {
        step: 1,
        rationale: 'First, sized up total volume.',
        tool: 'run_readonly_sql',
        input: 'SELECT 2',
        rowCount: 12,
        error: undefined,
      },
      {
        step: 2,
        rationale: 'Then tried a regional split.',
        tool: 'run_readonly_sql',
        input: 'SELECT 3',
        rowCount: undefined,
        error: 'boom',
      },
    ]);
  });

  it('omits reasoning entirely when no records carry a rationale', async () => {
    const { service } = build();

    await service.download(withVisual(sessionWithRows(20, 20)), 'visual-1');

    const calls = (storedVisualizationDocument as jest.Mock).mock
      .calls as unknown[][];
    expect(reasoningOf(calls)).toBeUndefined();
  });
});

describe('VisualizationService.download answer.md reasoning section', () => {
  beforeEach(() => {
    (createZip as jest.Mock).mockClear();
  });

  it('lists the reasoning steps before the data-used section', async () => {
    const { service } = build();
    const session = sessionWithRows(20, 20);
    session.messages[1].data = [
      {
        tool: 'run_readonly_sql',
        input: 'SELECT month, n FROM main.health.claims',
        rationale: 'Checked totals by month.',
        rowCount: 20,
      },
    ];

    await service.download(withVisual(session), 'visual-1');

    const files = jest.mocked(createZip).mock.calls[0][0] as {
      name: string;
      data: string;
    }[];
    const answerFile = files.find((f) => f.name === 'answer.md');
    expect(answerFile).toBeDefined();
    const md = answerFile!.data;
    expect(md).toContain('## How this was worked out');
    expect(md).toContain('1. Checked totals by month. (20 rows)');
    expect(md.indexOf('## How this was worked out')).toBeLessThan(
      md.indexOf('## Data used'),
    );
  });

  it('omits the section when no step carries a rationale', async () => {
    const { service } = build();

    await service.download(withVisual(sessionWithRows(20, 20)), 'visual-1');

    const files = jest.mocked(createZip).mock.calls[0][0] as {
      name: string;
      data: string;
    }[];
    const md = files.find((f) => f.name === 'answer.md')!.data;
    expect(md).not.toContain('How this was worked out');
  });
});

/** The same session with one existing visual at the given current version. */
function withVisual(
  session: SessionDoc,
  options: { currentVersion?: number; instruction?: string } = {},
): SessionDoc {
  const currentVersion = options.currentVersion ?? 1;
  return {
    ...session,
    visualizations: [
      {
        id: 'visual-1',
        title: 'Claims by month',
        description: 'Denials peak in March.',
        path: 'visuals/visual-1',
        sourceMessageAt: '2024-01-01T00:00:01.000Z',
        createdAt: '2024-01-01T00:00:02.000Z',
        currentVersion,
        versions: Array.from({ length: currentVersion }, (_, n) => ({
          version: n + 1,
          createdAt: '2024-01-01T00:00:02.000Z',
          sourceMessageAt: '2024-01-01T00:00:01.000Z',
          ...(n + 1 === currentVersion && options.instruction
            ? { instruction: options.instruction }
            : {}),
        })),
      },
    ],
  };
}

describe('VisualizationService.refreshData', () => {
  const dataset = {
    name: 'claims',
    datasourceId: 'ds-1',
    datasourceKind: 'databricks' as const,
    tables: ['main.health.claims'],
  };

  /** No data.json on disk yet — every readFile resolves the generic stub. */
  function buildNoStoredData() {
    return build();
  }

  beforeEach(() => {
    (storedVisualizationDocument as jest.Mock).mockClear();
    (sandboxedVisualizationDocument as jest.Mock).mockClear();
    (getDatasetToolServices as jest.Mock).mockReset();
  });

  it('re-runs the stored SQL through the same executor the query tool uses', async () => {
    const { service, filesystem } = buildNoStoredData();
    const runReadOnlySql = jest.fn().mockResolvedValue({
      columns: ['month', 'n'],
      rows: [{ month: 1, n: 111 }],
    });
    (getDatasetToolServices as jest.Mock).mockReturnValue({
      getDatasets: jest.fn().mockResolvedValue([dataset]),
      runReadOnlySql,
    });

    const session = withVisual(sessionWithRows(20, 20));
    const { metadata } = await service.refreshData(session, 'visual-1');

    expect(runReadOnlySql).toHaveBeenCalledWith(
      'ds-1',
      'SELECT month, n FROM main.health.claims',
      expect.any(Number),
      session.datasets,
    );
    // Same version, no new entry appended to the version history.
    expect(metadata.currentVersion).toBe(1);
    expect(metadata.versions).toHaveLength(1);
    expect(metadata.versions?.[0]?.refreshedAt).toEqual(expect.any(String));

    const dataWrite = filesystem.writeFile.mock.calls.find(
      (call) => call[0] === 'visuals/visual-1/v1/data.json',
    );
    expect(dataWrite).toBeDefined();
    const written = JSON.parse(dataWrite![1] as string) as ToolDataRecord[];
    expect(written).toHaveLength(1);
    expect(written[0].rows).toEqual([{ month: 1, n: 111 }]);
    expect(written[0].error).toBeUndefined();

    // index.html is regenerated from the refreshed rows; no other version dir touched.
    expect(filesystem.writeFile).toHaveBeenCalledWith(
      'visuals/visual-1/v1/index.html',
      expect.any(String),
    );
    expect(
      filesystem.writeFile.mock.calls.some((call) =>
        String(call[0]).includes('/v2/'),
      ),
    ).toBe(false);
  });

  it('draws every stored row of the refreshed results in the frame', async () => {
    const { service } = buildNoStoredData();
    (getDatasetToolServices as jest.Mock).mockReturnValue({
      getDatasets: jest.fn().mockResolvedValue([dataset]),
      runReadOnlySql: jest.fn().mockResolvedValue({
        columns: ['month', 'n'],
        rows: Array.from({ length: 300 }, (_, n) => ({ month: n, n })),
      }),
    });

    await service.refreshData(withVisual(sessionWithRows(20, 20)), 'visual-1');

    const calls = (storedVisualizationDocument as jest.Mock).mock
      .calls as unknown[][];
    const context = calls[0][1] as {
      chartData?: { rows: unknown[] }[];
      chartRows?: { shown: number; truncatedFrom: number };
    };
    // 200 rows are stored of the 300 the re-run returned: all 200 are drawn.
    expect(context.chartData?.[0].rows).toHaveLength(200);
    expect(context.chartRows).toEqual({ shown: 200, truncatedFrom: 300 });
  });

  it('stores an error on a record whose re-run fails without aborting others', async () => {
    const { service, filesystem } = buildNoStoredData();
    const runReadOnlySql = jest.fn().mockRejectedValue(new Error('timed out'));
    (getDatasetToolServices as jest.Mock).mockReturnValue({
      getDatasets: jest.fn().mockResolvedValue([dataset]),
      runReadOnlySql,
    });

    const session = withVisual(sessionWithRows(20, 20));
    await service.refreshData(session, 'visual-1');

    const dataWrite = filesystem.writeFile.mock.calls.find(
      (call) => call[0] === 'visuals/visual-1/v1/data.json',
    );
    const written = JSON.parse(dataWrite![1] as string) as ToolDataRecord[];
    expect(written).toHaveLength(1);
    expect(written[0].error).toBe('timed out');
    expect(written[0].rows).toBeUndefined();
  });

  it('leaves records without a SQL statement untouched', async () => {
    const { service, filesystem } = buildNoStoredData();
    const runReadOnlySql = jest.fn();
    (getDatasetToolServices as jest.Mock).mockReturnValue({
      getDatasets: jest.fn().mockResolvedValue([dataset]),
      runReadOnlySql,
    });

    const session = withVisual(sessionWithRows(20, 20));
    // sample_rows records carry no real SQL — nothing to re-run.
    session.messages[1].data = [
      { tool: 'sample_rows', input: 'main.health.claims', rows: [{ a: 1 }] },
    ];

    await service.refreshData(session, 'visual-1');

    expect(runReadOnlySql).not.toHaveBeenCalled();
    const dataWrite = filesystem.writeFile.mock.calls.find(
      (call) => call[0] === 'visuals/visual-1/v1/data.json',
    );
    const written = JSON.parse(dataWrite![1] as string) as ToolDataRecord[];
    expect(written).toEqual(session.messages[1].data);
  });

  it('load prefers the refreshed data.json over the original answer data', async () => {
    const { service, filesystem } = buildNoStoredData();
    const refreshedRecord: ToolDataRecord = {
      tool: 'run_readonly_sql',
      input: 'SELECT month, n FROM main.health.claims',
      columns: ['month', 'n'],
      rows: [{ month: 99, n: 999 }],
      rowCount: 1,
    };
    (filesystem.readFile as jest.Mock).mockImplementation((path: string) => {
      if (path.endsWith('spec.json'))
        return Promise.reject(new Error('ENOENT'));
      if (path.endsWith('data.json')) {
        return Promise.resolve(JSON.stringify([refreshedRecord]));
      }
      return Promise.resolve('# skill');
    });

    await service.load(withVisual(sessionWithRows(20, 20)), 'visual-1', 1);

    const calls = (sandboxedVisualizationDocument as jest.Mock).mock
      .calls as unknown[][];
    const context = calls.at(-1)![1] as { data?: ToolDataRecord[] };
    expect(context.data).toEqual([refreshedRecord]);
  });
});
