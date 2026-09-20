jest.mock('@mastra/core/request-context', () => ({
  RequestContext: class {
    set = jest.fn();
  },
}));
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/session-workspaces', () => ({
  SESSION_WORKSPACE_CONTEXT_KEY: 'session-workspace',
}));
jest.mock('../../mastra/agents/visualization.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  // The spec schema is pure zod, so the real one is used — a test that hands
  // the designer a bad spec must be rejected exactly as production would.
  const { visualSpecSchema } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./visual-spec') as typeof import('./visual-spec');
  return {
    interactiveVisualOutputSchema: z.object({
      title: z.string(),
      description: z.string(),
      html: z.string(),
      css: z.string(),
      javascript: z.string(),
    }),
    specVisualOutputSchema: z.object({
      title: z.string(),
      description: z.string(),
      spec: visualSpecSchema,
    }),
  };
});
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
  getSandboxToolServices: jest.fn(),
}));

import {
  sandboxedVisualizationDocument,
  storedVisualizationDocument,
} from './visualization-document';
import { getSandboxToolServices } from '../../mastra/tool-services';
import { createZip } from './zip-archive';
import {
  VisualizationService,
  visualizationData,
} from './visualization.service';
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

/** A valid spec-mode designer output for the rows `sessionWithRows` carries. */
const specOutput = {
  title: 'Claims by month',
  description: 'Volume climbs through the year.',
  spec: {
    spec: 1,
    kpis: [
      { label: 'Total claims', select: ['month', 'n'], column: 'n', agg: 'sum' },
    ],
    chart: { form: 'line', select: ['month', 'n'], x: 'month', y: 'n' },
    table: { select: ['month', 'n'], columns: ['month', 'n'], collapsed: true },
  },
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
    sandboxes: ['claims'],
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
    readFile: jest.fn(async (path: string) => {
      if (String(path).endsWith('spec.json')) throw new Error('ENOENT');
      return '# skill';
    }),
    writeFile: jest.fn().mockResolvedValue(undefined),
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

describe('visualizationData', () => {
  it('reports the original row total when the caps clip the rows', () => {
    const rows = Array.from({ length: 150 }, (_, n) => ({ n }));
    const block = visualizationData([
      { tool: 'run_readonly_sql', rows, rowCount: 400 },
    ]);

    expect(block.shown).toBe(100);
    expect(block.truncatedFrom).toBe(400);
  });

  it('reports no truncation when every row fits', () => {
    const block = visualizationData([
      { tool: 'run_readonly_sql', rows: [{ n: 1 }], rowCount: 1 },
    ]);

    expect(block.shown).toBe(1);
    expect(block.truncatedFrom).toBeUndefined();
  });

  it('ignores failed and empty records', () => {
    const block = visualizationData([
      { tool: 'run_readonly_sql', error: 'boom', rowCount: 900 },
      { tool: 'run_readonly_sql', rows: [], rowCount: 0 },
    ]);

    expect(block.json).toBe('[]');
    expect(block.truncatedFrom).toBeUndefined();
  });

  it('carries every successful record, each with its own SQL', () => {
    const block = visualizationData([
      {
        tool: 'run_readonly_sql',
        input: 'SELECT count(*) FROM claims',
        rows: [{ total: 5 }],
        rowCount: 1,
      },
      { tool: 'run_readonly_sql', error: 'boom', rowCount: 9 },
      {
        tool: 'run_readonly_sql',
        input: 'SELECT payer, n FROM claims GROUP BY payer',
        rows: [
          { payer: 'Aetna', n: 3 },
          { payer: 'Cigna', n: 2 },
        ],
        rowCount: 2,
      },
    ]);

    const parsed = JSON.parse(block.json) as { input: string }[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0].input).toContain('count(*)');
    expect(parsed[1].input).toContain('GROUP BY payer');
    expect(block.shown).toBe(3);
    expect(block.truncatedFrom).toBeUndefined();
  });

  it('keeps the three largest records and shares the row budget', () => {
    const sized = (id: number, rows: number) => ({
      tool: 'run_readonly_sql',
      input: `SELECT ${id}`,
      rows: Array.from({ length: rows }, (_, n) => ({ n })),
      rowCount: rows,
    });
    const block = visualizationData([
      sized(1, 50),
      sized(2, 5),
      sized(3, 60),
      sized(4, 40),
    ]);

    const parsed = JSON.parse(block.json) as {
      input: string;
      rows: unknown[];
    }[];
    // Smallest record dropped; the survivors stay in the order they ran.
    expect(parsed.map((r) => r.input)).toEqual([
      'SELECT 1',
      'SELECT 3',
      'SELECT 4',
    ]);
    // 100 rows shared three ways.
    expect(parsed.map((r) => r.rows.length)).toEqual([33, 33, 33]);
    expect(block.shown).toBe(99);
    // The dropped record's rows count as truncation, not as silent loss.
    expect(block.truncatedFrom).toBe(155);
  });
});

describe('VisualizationService truncation markers', () => {
  beforeEach(() => {
    (storedVisualizationDocument as jest.Mock).mockClear();
  });

  it('tells the designer how many of the rows it is seeing', async () => {
    const { service, agent } = build();

    await service.create(sessionWithRows(150, 250), undefined);

    const prompt = (agent.generate.mock.calls as unknown[][])[0][0] as string;
    expect(prompt).toContain('showing first 100 of 250 rows');
  });

  it('says nothing about truncation when the designer saw every row', async () => {
    const { service, agent } = build();

    await service.create(sessionWithRows(20, 20), undefined);

    const prompt = (agent.generate.mock.calls as unknown[][])[0][0] as string;
    expect(prompt).toContain('<data>');
    expect(prompt).not.toContain('showing first');
  });

  it('threads the row counts into the readable frame', async () => {
    const { service } = build();

    await service.create(sessionWithRows(150, 250), undefined);

    const calls = (storedVisualizationDocument as jest.Mock).mock
      .calls as unknown[][];
    const context = calls[0][1] as {
      chartRows?: { shown: number; truncatedFrom: number };
    };
    expect(context.chartRows).toEqual({ shown: 100, truncatedFrom: 250 });
  });
});

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

    await service.create(session, undefined);

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

    await service.create(session, undefined);

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

    await service.create(sessionWithRows(20, 20), undefined);

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

    const files = (createZip as jest.Mock).mock.calls[0][0] as {
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

    const files = (createZip as jest.Mock).mock.calls[0][0] as {
      name: string;
      data: string;
    }[];
    const md = files.find((f) => f.name === 'answer.md')!.data;
    expect(md).not.toContain('How this was worked out');
  });
});

describe('VisualizationService recommended form', () => {
  const promptOf = (agent: { generate: jest.Mock }, call = 0) =>
    (agent.generate.mock.calls as unknown[][])[call][0] as string;

  it('hands the designer a deterministic form recommendation on create', async () => {
    const { service, agent } = build();

    await service.create(sessionWithRows(20, 20), undefined);

    const prompt = promptOf(agent);
    expect(prompt).toContain('<recommended-form>');
    expect(prompt).toContain('Data shape: 20 rows;');
    expect(prompt).toContain('Recommended form: a line chart over month');
    expect(prompt).toContain('if you deviate, say why in the description.');
    expect(prompt).toContain('</recommended-form>');
  });

  it('hands it to the tailor path too', async () => {
    const { service, agent } = build();

    await service.update(
      withVisual(sessionWithRows(20, 20)),
      'visual-1',
      'make it blue',
    );

    expect(promptOf(agent)).toContain('<recommended-form>');
  });

  it('omits the block when the answer carries no rows', async () => {
    const { service, agent } = build();
    const session = sessionWithRows(20, 20);
    delete session.messages[1].data;

    await service.create(session, undefined);

    expect(promptOf(agent)).not.toContain('<recommended-form>');
  });
});

/** The same session whose answer rests on rows rich enough to compose. */
function sessionWithComposableRows(): SessionDoc {
  const session = sessionWithRows(20, 20);
  session.messages[1].data = [
    {
      tool: 'run_readonly_sql',
      input: 'SELECT month, claims, denials FROM main.health.claims',
      columns: ['month', 'claims', 'denials'],
      rows: Array.from({ length: 12 }, (_, n) => ({
        month: `2024-${String(n + 1).padStart(2, '0')}`,
        claims: n * 10,
        denials: n,
      })),
      rowCount: 12,
    },
  ];
  return session;
}

/**
 * The character budget and output allowance belong to the freeform designer,
 * which now runs last — after the spec attempts the stubbed agent fails. Both
 * helpers therefore read the final call, whatever preceded it.
 */
describe('VisualizationService composed budget', () => {
  const lastPrompt = (agent: { generate: jest.Mock }) =>
    (agent.generate.mock.calls as unknown[][]).at(-1)![0] as string;
  const optionsOf = (agent: { generate: jest.Mock }) =>
    (agent.generate.mock.calls as unknown[][]).at(-1)![1] as {
      modelSettings: { maxOutputTokens: number };
    };

  it('keeps the tight budget for a single-form visual', async () => {
    const { service, agent } = build();

    // Below the composition floor (COMPOSED_MIN_ROWS = 4) so this stays a
    // single-form visual even with one measure.
    await service.create(sessionWithRows(3, 3), undefined);

    const prompt = lastPrompt(agent);
    expect(prompt).toContain('below 14,000 characters');
    expect(prompt).not.toContain('Composed answer:');
    expect(optionsOf(agent).modelSettings.maxOutputTokens).toBe(7_000);
  });

  it('raises the budget only when the form is composed', async () => {
    const { service, agent } = build();

    await service.create(sessionWithComposableRows(), undefined);

    const prompt = lastPrompt(agent);
    expect(prompt).toContain('below 20,000 characters');
    expect(prompt).toContain('Composed answer:');
    expect(optionsOf(agent).modelSettings.maxOutputTokens).toBe(11_000);
  });

  it('raises it on the tailor path too', async () => {
    const { service, agent } = build();

    await service.update(
      withVisual(sessionWithComposableRows()),
      'visual-1',
      'add a table',
    );

    const prompt = lastPrompt(agent);
    expect(prompt).toContain('below 20,000 characters');
    expect(optionsOf(agent).modelSettings.maxOutputTokens).toBe(11_000);
  });
});

describe('VisualizationService spec pipeline', () => {
  const promptAt = (agent: { generate: jest.Mock }, call: number) =>
    (agent.generate.mock.calls as unknown[][])[call][0] as string;
  const writes = (filesystem: { writeFile: jest.Mock }) =>
    new Map(
      (filesystem.writeFile.mock.calls as unknown[][]).map((call) => [
        String(call[0]),
        String(call[1]),
      ]),
    );
  /** Path → contents, with the random visual id collapsed to `<id>`. */
  const writtenFiles = (filesystem: { writeFile: jest.Mock }) =>
    new Map(
      Array.from(writes(filesystem)).map(([path, data]) => [
        path.replace(/^visuals\/[^/]+\//, 'visuals/<id>/'),
        data,
      ]),
    );

  it('asks for a spec first and writes it with the synthetic bundle files', async () => {
    const { service, agent, filesystem } = build();
    agent.generate.mockResolvedValue({ object: specOutput });

    const { bundle: created } = await service.create(
      sessionWithRows(20, 20),
      undefined,
    );

    // One call only: the spec validated, so the freeform designer never ran.
    expect(agent.generate).toHaveBeenCalledTimes(1);
    const prompt = promptAt(agent, 0);
    expect(prompt).toContain('Return only the JSON spec');
    expect(prompt).not.toContain('HTML, CSS, and JavaScript bundle below');
    // The blocks the freeform prompt carries are carried unchanged.
    expect(prompt).toContain('<data>');
    expect(prompt).toContain('<recommended-form>');
    expect(prompt).toContain('<question>');
    expect(prompt).toContain('<answer>');
    expect(
      (agent.generate.mock.calls as unknown[][])[0][1] as {
        modelSettings: { maxOutputTokens: number };
      },
    ).toMatchObject({ modelSettings: { maxOutputTokens: 2_500 } });

    expect(created.spec).toEqual(specOutput.spec);
    const files = writtenFiles(filesystem);
    expect(JSON.parse(files.get('visuals/<id>/v1/spec.json')!)).toEqual(
      specOutput.spec,
    );
    expect(files.get('visuals/<id>/v1/body.html')).toBe(
      '<div id="qti-chart-root"></div>',
    );
    expect(files.get('visuals/<id>/v1/styles.css')).toBe('');
    expect(files.get('visuals/<id>/v1/script.js')).toBe('window.qtiChart.mount();');
    expect(files.get('visuals/<id>/v1/qti-chart.js')).toBe('/* runtime */');
    expect(files.get('visuals/<id>/v1/qti-frame.js')).toBe('/* frame bridge */');
    expect(
      JSON.parse(files.get('visuals/<id>/v1/manifest.json')!) as {
        renderer: string;
      },
    ).toMatchObject({ renderer: 'spec' });
  });

  it('retries once with the validation problems, then falls back to freeform', async () => {
    const { service, agent, filesystem } = build();
    const broken = {
      ...specOutput,
      spec: {
        spec: 1,
        chart: { form: 'bar', select: ['month', 'n'], x: 'month', y: 'amount' },
      },
    };
    agent.generate
      .mockResolvedValueOnce({ object: broken })
      .mockResolvedValueOnce({ object: broken })
      .mockResolvedValue({ object: bundle });

    const { bundle: created } = await service.create(
      sessionWithRows(20, 20),
      undefined,
    );

    expect(agent.generate).toHaveBeenCalledTimes(3);
    // Attempt two quotes the exact problem back at the designer.
    const retry = promptAt(agent, 1);
    expect(retry).toContain('<previous-attempt-error>');
    expect(retry).toContain('Your previous spec was rejected');
    expect(retry).toContain('chart.y: column "amount" is not in the selected');
    expect(retry).toContain('only names columns present in the <data> block');
    // Third call is the untouched freeform pipeline.
    const freeform = promptAt(agent, 2);
    expect(freeform).toContain('HTML, CSS, and JavaScript bundle below');
    expect(freeform).not.toContain('<previous-attempt-error>');

    expect(created.spec).toBeUndefined();
    expect(created.html).toBe(bundle.html);
    const files = writtenFiles(filesystem);
    expect(files.has('visuals/<id>/v1/spec.json')).toBe(false);
    expect(files.has('visuals/<id>/v1/qti-chart.js')).toBe(false);
    expect(files.get('visuals/<id>/v1/script.js')).toBe(bundle.javascript);
  });

  it('falls back to freeform when the designer cannot produce a parseable spec', async () => {
    const { service, agent } = build();
    // The stub agent returns the freeform bundle for every call, so both spec
    // attempts fail schema validation before any data check runs.
    await service.create(sessionWithRows(20, 20), undefined);

    expect(agent.generate).toHaveBeenCalledTimes(3);
    expect(promptAt(agent, 2)).toContain('HTML, CSS, and JavaScript bundle below');
  });

  it('skips the spec attempt entirely when the answer carries no rows', async () => {
    const { service, agent } = build();
    const session = sessionWithRows(20, 20);
    delete session.messages[1].data;

    await service.create(session, undefined);

    expect(agent.generate).toHaveBeenCalledTimes(1);
    expect(promptAt(agent, 0)).toContain('HTML, CSS, and JavaScript bundle below');
  });

  describe('tailoring a spec visual', () => {
    /** The stored v1 is a spec visual: spec.json parses. */
    function buildWithStoredSpec() {
      const built = build();
      (built.filesystem.readFile as jest.Mock).mockImplementation(
        async (path: string) => {
          if (path.endsWith('spec.json')) return JSON.stringify(specOutput.spec);
          return '# skill';
        },
      );
      return built;
    }

    it('hands the designer the current spec, not the synthetic code', async () => {
      const { service, agent, filesystem } = buildWithStoredSpec();
      agent.generate.mockResolvedValue({
        object: {
          ...specOutput,
          spec: {
            ...specOutput.spec,
            chart: { ...specOutput.spec.chart, form: 'bar' },
          },
        },
      });

      const { metadata } = await service.update(
        withVisual(sessionWithRows(20, 20)),
        'visual-1',
        'make it a bar chart',
      );

      expect(agent.generate).toHaveBeenCalledTimes(1);
      const prompt = promptAt(agent, 0);
      expect(prompt).toContain('Tailor the existing visual spec below');
      expect(prompt).toContain('<current-visual>');
      expect(prompt).toContain('"spec"');
      expect(prompt).toContain('"form": "line"');
      expect(prompt).not.toContain('"javascript"');
      expect(prompt).toContain('<instruction>');
      expect(prompt).toContain('make it a bar chart');

      expect(metadata.currentVersion).toBe(2);
      const files = writes(filesystem);
      const spec = JSON.parse(files.get('visuals/visual-1/v2/spec.json')!) as {
        chart: { form: string };
      };
      expect(spec.chart.form).toBe('bar');
    });

    it('feeds a runtime error into the spec path when repairing', async () => {
      const { service, agent } = buildWithStoredSpec();
      agent.generate.mockResolvedValue({ object: specOutput });

      await service.repair(
        withVisual(sessionWithRows(20, 20)),
        'visual-1',
        'boom',
      );

      const prompt = promptAt(agent, 0);
      expect(prompt).toContain('Return only the JSON spec');
      expect(prompt).toContain('<previous-attempt-error>');
      expect(prompt).toContain('boom');
    });

    it('keeps a freeform visual freeform when tailoring it', async () => {
      const { service, agent } = build();

      await service.update(
        withVisual(sessionWithRows(20, 20)),
        'visual-1',
        'make it blue',
      );

      // No spec attempt at all: a spec cannot preserve bespoke markup.
      expect(agent.generate).toHaveBeenCalledTimes(1);
      expect(promptAt(agent, 0)).toContain(
        'Tailor the existing interactive visual below',
      );
    });

    it('refreshes data without a designer call, keeping the spec in the document', async () => {
      const { service, agent, filesystem } = buildWithStoredSpec();
      (getSandboxToolServices as jest.Mock).mockReturnValue({
        getSandboxes: jest.fn().mockResolvedValue([
          {
            name: 'claims',
            datasourceId: 'ds-1',
            datasourceKind: 'databricks' as const,
            tables: ['main.health.claims'],
          },
        ]),
        runReadOnlySql: jest.fn().mockResolvedValue({
          columns: ['month', 'n'],
          rows: [{ month: 1, n: 111 }],
        }),
      });
      (storedVisualizationDocument as jest.Mock).mockClear();

      const { bundle: refreshed } = await service.refreshData(
        withVisual(sessionWithRows(20, 20)),
        'visual-1',
      );

      expect(agent.generate).not.toHaveBeenCalled();
      expect(refreshed.spec).toEqual(specOutput.spec);
      // index.html is rebuilt from the spec bundle, so the regenerated
      // document keeps the spec block and the runtime reference.
      const rebuilt = (storedVisualizationDocument as jest.Mock).mock
        .calls as unknown[][];
      expect((rebuilt.at(-1)![0] as { spec?: unknown }).spec).toEqual(
        specOutput.spec,
      );
      expect(
        (filesystem.writeFile as jest.Mock).mock.calls.some(
          (call) => call[0] === 'visuals/visual-1/v1/index.html',
        ),
      ).toBe(true);
    });

    it('packages the spec and the runtime file in the download', async () => {
      const { service } = buildWithStoredSpec();
      (createZip as jest.Mock).mockClear();

      await service.download(withVisual(sessionWithRows(20, 20)), 'visual-1');

      const files = (createZip as jest.Mock).mock.calls[0][0] as {
        name: string;
        data: string;
      }[];
      const byName = new Map(files.map((f) => [f.name, f.data]));
      expect(JSON.parse(byName.get('spec.json')!)).toEqual(specOutput.spec);
      expect(byName.get('qti-chart.js')).toBe('/* runtime */');
      expect(byName.get('script.js')).toBe('window.qtiChart.mount();');
      expect(byName.get('styles.css')).toBe('');
      expect(byName.get('qti-frame.js')).toBe('/* frame bridge */');
    });
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

describe('VisualizationService.repair', () => {
  it('feeds the runtime error back to the designer and stores a new version', async () => {
    const { service, agent, filesystem } = build();

    const { metadata } = await service.repair(
      withVisual(sessionWithRows(20, 20)),
      'visual-1',
      "Cannot read properties of null (reading 'appendChild')",
    );

    const prompt = (agent.generate.mock.calls as unknown[][])[0][0] as string;
    expect(prompt).toContain('<previous-attempt-error>');
    expect(prompt).toContain(
      'Your previous code failed at runtime in the sandbox',
    );
    expect(prompt).toContain("reading 'appendChild'");
    expect(prompt).toContain('renders the same visual');
    // The broken code is handed over so the fix is a correction, not a rewrite.
    expect(prompt).toContain('<current-visual>');

    expect(metadata.currentVersion).toBe(2);
    expect(metadata.versions?.at(-1)?.instruction).toBe(
      "auto-repair: Cannot read properties of null (reading 'appendChild')",
    );
    expect(filesystem.writeFile).toHaveBeenCalledWith(
      'visuals/visual-1/v2/script.js',
      expect.any(String),
    );
  });

  it('records the blank-render report as the repair reason', async () => {
    const { service } = build();

    const { metadata } = await service.repair(
      withVisual(sessionWithRows(20, 20)),
      'visual-1',
      'visual rendered blank',
    );

    expect(metadata.versions?.at(-1)?.instruction).toBe(
      'auto-repair: visual rendered blank',
    );
  });

  it('truncates a long runtime error to 200 characters', async () => {
    const { service } = build();

    const { metadata } = await service.repair(
      withVisual(sessionWithRows(20, 20)),
      'visual-1',
      'x'.repeat(500),
    );

    expect(metadata.versions?.at(-1)?.instruction).toBe(
      `auto-repair: ${'x'.repeat(200)}`,
    );
  });

  it('refuses to repair a version that is already an auto-repair', async () => {
    const { service, agent } = build();

    await expect(
      service.repair(
        withVisual(sessionWithRows(20, 20), {
          currentVersion: 2,
          instruction: 'auto-repair: boom',
        }),
        'visual-1',
        'boom again',
      ),
    ).rejects.toThrow(/already an automatic repair/);
    expect(agent.generate).not.toHaveBeenCalled();
  });

  it('still repairs a version tailored by hand', async () => {
    const { service } = build();

    const { metadata } = await service.repair(
      withVisual(sessionWithRows(20, 20), {
        currentVersion: 2,
        instruction: 'make it a bar chart',
      }),
      'visual-1',
      'boom',
    );

    expect(metadata.currentVersion).toBe(3);
  });

  it('rejects an unknown visual', async () => {
    const { service } = build();

    await expect(
      service.repair(sessionWithRows(20, 20), 'missing', 'boom'),
    ).rejects.toThrow(/not found/);
  });
});

describe('VisualizationService.refreshData', () => {
  const sandbox = {
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
    (getSandboxToolServices as jest.Mock).mockReset();
  });

  it('re-runs the stored SQL through the same executor the query tool uses', async () => {
    const { service, filesystem } = buildNoStoredData();
    const runReadOnlySql = jest.fn().mockResolvedValue({
      columns: ['month', 'n'],
      rows: [{ month: 1, n: 111 }],
    });
    (getSandboxToolServices as jest.Mock).mockReturnValue({
      getSandboxes: jest.fn().mockResolvedValue([sandbox]),
      runReadOnlySql,
    });

    const session = withVisual(sessionWithRows(20, 20));
    const { metadata } = await service.refreshData(session, 'visual-1');

    expect(runReadOnlySql).toHaveBeenCalledWith(
      'ds-1',
      'SELECT month, n FROM main.health.claims',
      expect.any(Number),
      session.sandboxes,
    );
    // Same version, no new entry appended to the version history.
    expect(metadata.currentVersion).toBe(1);
    expect(metadata.versions).toHaveLength(1);
    expect(metadata.versions?.[0]?.refreshedAt).toEqual(expect.any(String));

    const dataWrite = (filesystem.writeFile as jest.Mock).mock.calls.find(
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
      (filesystem.writeFile as jest.Mock).mock.calls.some((call) =>
        String(call[0]).includes('/v2/'),
      ),
    ).toBe(false);
  });

  it('stores an error on a record whose re-run fails without aborting others', async () => {
    const { service, filesystem } = buildNoStoredData();
    const runReadOnlySql = jest.fn().mockRejectedValue(new Error('timed out'));
    (getSandboxToolServices as jest.Mock).mockReturnValue({
      getSandboxes: jest.fn().mockResolvedValue([sandbox]),
      runReadOnlySql,
    });

    const session = withVisual(sessionWithRows(20, 20));
    await service.refreshData(session, 'visual-1');

    const dataWrite = (filesystem.writeFile as jest.Mock).mock.calls.find(
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
    (getSandboxToolServices as jest.Mock).mockReturnValue({
      getSandboxes: jest.fn().mockResolvedValue([sandbox]),
      runReadOnlySql,
    });

    const session = withVisual(sessionWithRows(20, 20));
    // sample_rows records carry no real SQL — nothing to re-run.
    session.messages[1].data = [
      { tool: 'sample_rows', input: 'main.health.claims', rows: [{ a: 1 }] },
    ];

    await service.refreshData(session, 'visual-1');

    expect(runReadOnlySql).not.toHaveBeenCalled();
    const dataWrite = (filesystem.writeFile as jest.Mock).mock.calls.find(
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
    (filesystem.readFile as jest.Mock).mockImplementation(
      async (path: string) => {
        if (path.endsWith('spec.json')) throw new Error('ENOENT');
        if (path.endsWith('data.json')) {
          return JSON.stringify([refreshedRecord]);
        }
        return '# skill';
      },
    );

    await service.load(withVisual(sessionWithRows(20, 20)), 'visual-1', 1);

    const calls = (sandboxedVisualizationDocument as jest.Mock).mock
      .calls as unknown[][];
    const context = calls.at(-1)![1] as { data?: ToolDataRecord[] };
    expect(context.data).toEqual([refreshedRecord]);
  });
});

describe('VisualizationService turnRecords merge', () => {
  const STALE_SQL = 'SELECT month, n FROM main.health.claims';
  const STAGE_SQL = 'SELECT stage, n FROM main.health.stages';

  const writtenDataJson = (
    filesystem: { writeFile: jest.Mock },
    path: string,
  ): ToolDataRecord[] | undefined => {
    const call = (filesystem.writeFile.mock.calls as unknown[][]).find(
      (c) => c[0] === path,
    );
    return call ? (JSON.parse(call[1] as string) as ToolDataRecord[]) : undefined;
  };
  /** Same as `writtenDataJson`, matching by suffix — `create()` mints a random visual id. */
  const writtenDataJsonBySuffix = (
    filesystem: { writeFile: jest.Mock },
    suffix: string,
  ): ToolDataRecord[] | undefined => {
    const call = (filesystem.writeFile.mock.calls as unknown[][]).find((c) =>
      String(c[0]).endsWith(suffix),
    );
    return call ? (JSON.parse(call[1] as string) as ToolDataRecord[]) : undefined;
  };
  const promptOf = (agent: { generate: jest.Mock }) =>
    (agent.generate.mock.calls as unknown[][])[0][0] as string;

  describe('update()', () => {
    it('merges the turn\'s records onto the current version\'s stored data, deduping by SQL (fresh wins)', async () => {
      const { service, agent, filesystem } = build();
      const session = withVisual(sessionWithRows(20, 20));
      const turnRecords: ToolDataRecord[] = [
        {
          tool: 'run_readonly_sql',
          input: STALE_SQL,
          columns: ['month', 'n'],
          rows: [{ month: 1, n: 111 }],
          rowCount: 1,
        },
        {
          tool: 'run_readonly_sql',
          input: STAGE_SQL,
          columns: ['stage', 'n'],
          rows: [{ stage: 'A', n: 5 }],
          rowCount: 1,
        },
      ];

      await service.update(
        session,
        'visual-1',
        'break it down by stage',
        turnRecords,
      );

      // The designer prompt sees the merged set: the fresh row for the
      // re-run query, plus the brand-new per-stage query — never the stale
      // 20-row set the original answer carried.
      const prompt = promptOf(agent);
      expect(prompt).toContain('"n": 111');
      expect(prompt).toContain('"stage": "A"');
      expect(prompt).not.toContain('"n": 19');

      // The new version's data.json is the deduped merge, not the answer's
      // original rows and not a duplicate of the re-run query.
      const written = writtenDataJson(filesystem, 'visuals/visual-1/v2/data.json');
      expect(written).toHaveLength(2);
      const stale = written!.find((r) => r.input === STALE_SQL);
      expect(stale?.rows).toEqual([{ month: 1, n: 111 }]);
      const fresh = written!.find((r) => r.input === STAGE_SQL);
      expect(fresh?.rows).toEqual([{ stage: 'A', n: 5 }]);
    });

    it('keeps the last record when the turn re-runs the same SQL twice', async () => {
      const { service, filesystem } = build();
      const session = withVisual(sessionWithRows(20, 20));
      const turnRecords: ToolDataRecord[] = [
        {
          tool: 'run_readonly_sql',
          input: STAGE_SQL,
          rows: [{ stage: 'A', n: 1 }],
          rowCount: 1,
        },
        {
          tool: 'run_readonly_sql',
          input: STAGE_SQL,
          rows: [{ stage: 'A', n: 2 }],
          rowCount: 1,
        },
      ];

      await service.update(session, 'visual-1', 'retry the stage split', turnRecords);

      const written = writtenDataJson(filesystem, 'visuals/visual-1/v2/data.json');
      const matches = written!.filter((r) => r.input === STAGE_SQL);
      expect(matches).toHaveLength(1);
      expect(matches[0].rows).toEqual([{ stage: 'A', n: 2 }]);
    });

    it('behaves exactly as before when no turn records are given', async () => {
      const { service, agent, filesystem } = build();
      const session = withVisual(sessionWithRows(20, 20));

      await service.update(session, 'visual-1', 'make it blue');

      const prompt = promptOf(agent);
      expect(prompt).toContain('"n": 19');
      const written = writtenDataJson(filesystem, 'visuals/visual-1/v2/data.json');
      expect(written).toHaveLength(1);
      expect(written![0].input).toBe(STALE_SQL);
    });
  });

  describe('create()', () => {
    it('merges turn records onto the source answer\'s data for a brand-new visual', async () => {
      const { service, agent, filesystem } = build();
      const session = sessionWithRows(20, 20);
      const turnRecords: ToolDataRecord[] = [
        {
          tool: 'run_readonly_sql',
          input: STAGE_SQL,
          rows: [{ stage: 'A', n: 5 }],
          rowCount: 1,
        },
      ];

      await service.create(session, undefined, 'chart it', turnRecords);

      const prompt = promptOf(agent);
      expect(prompt).toContain('"stage": "A"');

      const written = writtenDataJsonBySuffix(filesystem, '/v1/data.json');
      expect(written).toHaveLength(2);
      expect(written!.some((r) => r.input === STAGE_SQL)).toBe(true);
      expect(written!.some((r) => r.input === STALE_SQL)).toBe(true);
    });

    it('behaves exactly as before when no turn records are given', async () => {
      const { service, agent } = build();

      await service.create(sessionWithRows(20, 20), undefined);

      const prompt = promptOf(agent);
      expect(prompt).toContain('"n": 19');
    });
  });
});
