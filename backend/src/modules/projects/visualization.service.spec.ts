jest.mock('@mastra/core/request-context', () => ({
  RequestContext: class {
    set = jest.fn();
  },
}));
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/project-workspaces', () => ({
  PROJECT_WORKSPACE_CONTEXT_KEY: 'project-workspace',
}));
jest.mock('../../mastra/agents/visualization.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  return {
    interactiveVisualOutputSchema: z.object({
      title: z.string(),
      description: z.string(),
      html: z.string(),
      css: z.string(),
      javascript: z.string(),
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
jest.mock('./zip-archive', () => ({ createZip: jest.fn() }));

import { storedVisualizationDocument } from './visualization-document';
import {
  VisualizationService,
  visualizationData,
} from './visualization.service';
import type { ProjectDoc, ToolDataRecord } from './entities/project.entity';

const bundle = {
  title: 'Claims by month',
  description: 'Denials peak in March.',
  html: '<div id="chart"></div>',
  css: '.chart { color: red; }',
  javascript: 'const x = 1;',
};

/** An answer whose stored rows exceed what the designer prompt may carry. */
function projectWithRows(stored: number, rowCount: number): ProjectDoc {
  const record: ToolDataRecord = {
    tool: 'run_readonly_sql',
    input: 'SELECT month, n FROM main.health.claims',
    columns: ['month', 'n'],
    rows: Array.from({ length: stored }, (_, n) => ({ month: n, n })),
    rowCount,
    ...(rowCount > stored ? { truncated: true } : {}),
  };
  return {
    id: 'project-1',
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
    readFile: jest.fn().mockResolvedValue('# skill'),
    writeFile: jest.fn().mockResolvedValue(undefined),
  };
  const agent = { generate: jest.fn().mockResolvedValue({ object: bundle }) };
  const mastra = {
    getAgent: jest.fn().mockReturnValue(agent),
    ensureProjectWorkspace: jest
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
});

describe('VisualizationService truncation markers', () => {
  beforeEach(() => {
    (storedVisualizationDocument as jest.Mock).mockClear();
  });

  it('tells the designer how many of the rows it is seeing', async () => {
    const { service, agent } = build();

    await service.create(projectWithRows(150, 250), undefined);

    const prompt = (agent.generate.mock.calls as unknown[][])[0][0] as string;
    expect(prompt).toContain('showing first 100 of 250 rows');
  });

  it('says nothing about truncation when the designer saw every row', async () => {
    const { service, agent } = build();

    await service.create(projectWithRows(20, 20), undefined);

    const prompt = (agent.generate.mock.calls as unknown[][])[0][0] as string;
    expect(prompt).toContain('<data>');
    expect(prompt).not.toContain('showing first');
  });

  it('threads the row counts into the readable frame', async () => {
    const { service } = build();

    await service.create(projectWithRows(150, 250), undefined);

    const calls = (storedVisualizationDocument as jest.Mock).mock
      .calls as unknown[][];
    const context = calls[0][1] as {
      chartRows?: { shown: number; truncatedFrom: number };
    };
    expect(context.chartRows).toEqual({ shown: 100, truncatedFrom: 250 });
  });
});

describe('VisualizationService recommended form', () => {
  const promptOf = (agent: { generate: jest.Mock }, call = 0) =>
    (agent.generate.mock.calls as unknown[][])[call][0] as string;

  it('hands the designer a deterministic form recommendation on create', async () => {
    const { service, agent } = build();

    await service.create(projectWithRows(20, 20), undefined);

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
      withVisual(projectWithRows(20, 20)),
      'visual-1',
      'make it blue',
    );

    expect(promptOf(agent)).toContain('<recommended-form>');
  });

  it('omits the block when the answer carries no rows', async () => {
    const { service, agent } = build();
    const project = projectWithRows(20, 20);
    delete project.messages[1].data;

    await service.create(project, undefined);

    expect(promptOf(agent)).not.toContain('<recommended-form>');
  });
});

/** The same project with one existing visual at the given current version. */
function withVisual(
  project: ProjectDoc,
  options: { currentVersion?: number; instruction?: string } = {},
): ProjectDoc {
  const currentVersion = options.currentVersion ?? 1;
  return {
    ...project,
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
      withVisual(projectWithRows(20, 20)),
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
      withVisual(projectWithRows(20, 20)),
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
      withVisual(projectWithRows(20, 20)),
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
        withVisual(projectWithRows(20, 20), {
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
      withVisual(projectWithRows(20, 20), {
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
      service.repair(projectWithRows(20, 20), 'missing', 'boom'),
    ).rejects.toThrow(/not found/);
  });
});
