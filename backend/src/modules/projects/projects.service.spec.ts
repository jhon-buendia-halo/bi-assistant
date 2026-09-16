jest.mock('@mastra/core/request-context', () => ({
  RequestContext: class {
    set = jest.fn();
  },
}));
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/tool-services', () => ({
  setSandboxToolServices: jest.fn(),
}));
jest.mock('../../mastra/tools/sandbox.tools', () => ({
  SANDBOXES_CONTEXT_KEY: 'sandboxes',
}));
jest.mock('../../mastra/tools/visual.tools', () => ({
  ACTIVE_VISUAL_CONTEXT_KEY: 'active-visual',
  PROJECT_ID_CONTEXT_KEY: 'project-id',
}));
jest.mock('../../mastra/project-workspaces', () => ({
  PROJECT_WORKSPACE_CONTEXT_KEY: 'project-workspace',
}));
jest.mock('../sandbox/repositories/sandbox.repository', () => ({
  SandboxRepository: class {},
}));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));
jest.mock('../verified-queries/verified-queries.service', () => ({
  VerifiedQueriesService: class {},
}));
jest.mock('../../mastra/agents/sql-fixer.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  return { sqlFixOutputSchema: z.object({ sql: z.string() }) };
});
jest.mock('./repositories/projects.repository', () => ({
  ProjectsRepository: class {},
}));
jest.mock('./visualization.service', () => ({
  VisualizationService: class {},
}));
// `marked` is ESM-only; stub the document builder so the suite runs under
// Jest's CommonJS transform.
jest.mock('./visualization-document', () => ({
  sourceEntities: jest.fn().mockReturnValue([]),
}));

import { setSandboxToolServices } from '../../mastra/tool-services';
import type { SandboxToolServices } from '../../mastra/tool-services';
import { sourceEntities } from './visualization-document';
import { ProjectsService, StreamEvent } from './projects.service';
import type { ProjectDoc } from './entities/project.entity';

describe('ProjectsService streaming', () => {
  /** A service wired to one streamed turn, with everything else stubbed. */
  function buildStreaming(
    fullStream: AsyncGenerator<unknown>,
    options: {
      answer?: string;
      verified?: boolean;
    } = {},
  ) {
    const project: ProjectDoc = {
      id: 'project-1',
      name: 'World Cup analysis',
      sandboxes: ['football'],
      messages: [],
      visualizations: [],
    };
    const repository = {
      get: jest.fn().mockResolvedValue(project),
      update: jest.fn().mockImplementation(async (_id, patch) => {
        Object.assign(project, patch);
        return project;
      }),
    };
    const agent = {
      getMemory: jest.fn().mockResolvedValue({
        getThreadById: jest.fn().mockResolvedValue({ id: project.id }),
      }),
      stream: jest.fn().mockResolvedValue({
        fullStream,
        text: Promise.resolve(''),
      }),
      generate: jest.fn().mockResolvedValue({
        text:
          options.answer ?? 'Argentina won through superior chance creation.',
      }),
    };
    const verifiedQueries = {
      referenceBlock: jest.fn().mockResolvedValue(undefined),
      isVerifiedSql: jest.fn().mockResolvedValue(options.verified ?? false),
    };
    const service = new ProjectsService(
      repository as never,
      {
        getAgent: jest.fn().mockReturnValue(agent),
        ensureProjectWorkspace: jest
          .fn()
          .mockResolvedValue({ id: 'workspace-1' }),
      } as never,
      {
        getByNames: jest
          .fn()
          .mockResolvedValue([
            { name: 'football', datasourceId: 'ds-1', tables: [] },
          ]),
      } as never,
      {} as never,
      {
        getView: jest.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
      } as never,
      {} as never,
      verifiedQueries as never,
    );
    return { service, project, agent, verifiedQueries };
  }

  beforeEach(() => {
    (sourceEntities as jest.Mock).mockReturnValue([]);
  });

  it('synthesizes a final answer after a tool-only turn', async () => {
    const { service, project, agent } = buildStreaming(toolOnlyStream(15));
    const events: StreamEvent[] = [];

    await service.streamMessage(
      'project-1',
      'Why did Argentina win?',
      (event) => events.push(event),
    );

    expect(agent.generate).toHaveBeenCalledWith(
      expect.stringContaining('Why did Argentina win?'),
      expect.objectContaining({ maxSteps: 1, toolChoice: 'none' }),
    );
    expect(project.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: 'Argentina won through superior chance creation.',
      }),
    );
    expect(events.at(-1)).toEqual({ type: 'done', project });
  });

  it('builds the interpretation line from the queries that ran', async () => {
    (sourceEntities as jest.Mock).mockReturnValue(['main.football.matches']);
    const { service, project } = buildStreaming(
      answerStream([
        { sql: 'select 1', rows: [{ n: 1 }, { n: 2 }] },
        { sql: 'select 2', rows: [{ n: 3 }] },
      ]),
    );

    await service.streamMessage('project-1', 'Why?', () => {});

    expect(project.messages.at(-1)?.interpretation).toBe(
      'Computed from 2 queries over main.football.matches — 3 rows analyzed.',
    );
  });

  it('omits the interpretation line when no SQL ran', async () => {
    const { service, project } = buildStreaming(answerStream([]));

    await service.streamMessage('project-1', 'Hello', () => {});

    expect(project.messages.at(-1)?.interpretation).toBeUndefined();
  });

  it('flags the answer verified when its final SQL matches the library', async () => {
    const { service, project, verifiedQueries } = buildStreaming(
      answerStream([
        { sql: 'select 1', rows: [{ n: 1 }] },
        { sql: 'select 2', rows: [{ n: 2 }] },
      ]),
      { verified: true },
    );

    await service.streamMessage('project-1', 'Why?', () => {});

    expect(verifiedQueries.isVerifiedSql).toHaveBeenCalledWith(
      'select 2',
      'ds-1',
    );
    expect(project.messages.at(-1)?.verified).toBe(true);
  });

  it('leaves the answer unverified when nothing matches', async () => {
    const { service, project } = buildStreaming(
      answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
    );

    await service.streamMessage('project-1', 'Why?', () => {});

    expect(project.messages.at(-1)?.verified).toBeUndefined();
  });

  it('keeps the data collected before a clarification on the card', async () => {
    (sourceEntities as jest.Mock).mockReturnValue(['main.football.matches']);
    const { service, project } = buildStreaming(clarificationStream());

    await service.streamMessage('project-1', 'Which team?', () => {});

    const message = project.messages.at(-1)!;
    expect(message.clarification?.question).toBe('Which season?');
    expect(message.data).toEqual([
      expect.objectContaining({ tool: 'run_readonly_sql', input: 'select 1' }),
    ]);
    expect(message.entities).toEqual(['main.football.matches']);
  });

  it('marks a record truncated when storage keeps fewer rows than returned', async () => {
    const rows = Array.from({ length: 250 }, (_, n) => ({ n }));
    const { service, project } = buildStreaming(
      answerStream([{ sql: 'select *', rows }]),
    );

    await service.streamMessage('project-1', 'Everything?', () => {});

    const record = project.messages.at(-1)?.data?.[0];
    expect(record?.truncated).toBe(true);
    expect(record?.rowCount).toBe(250);
    expect(record?.rows).toHaveLength(200);
  });

  it('carries the bridge truncation flag onto the stored record', async () => {
    const { service, project } = buildStreaming(
      answerStream([{ sql: 'select *', rows: [{ n: 1 }], truncated: true }]),
    );

    await service.streamMessage('project-1', 'Everything?', () => {});

    expect(project.messages.at(-1)?.data?.[0]?.truncated).toBe(true);
  });
});

describe('ProjectsService SQL self-correction', () => {
  /** The `run_readonly_sql` bridge ProjectsService installs for the tools. */
  async function bridge(overrides: {
    runs: jest.Mock;
    fixerReplies?: ({ sql: string } | undefined)[];
  }) {
    const fixer = { generate: jest.fn() };
    for (const reply of overrides.fixerReplies ?? []) {
      fixer.generate.mockResolvedValueOnce({ object: reply });
    }
    const sandbox = {
      name: 'claims',
      datasourceId: 'ds-1',
      datasourceKind: 'databricks',
      tables: ['main.health.claims'],
      entities: [
        {
          key: 'main.health.claims',
          columns: [{ name: 'claim_id', type: 'string', nullable: false }],
        },
      ],
    };
    const service = new ProjectsService(
      { list: jest.fn().mockResolvedValue([]) } as never,
      {
        getAgent: jest.fn().mockReturnValue(fixer),
        ensureProjectWorkspace: jest.fn().mockResolvedValue({ id: 'w' }),
      } as never,
      { getByNames: jest.fn().mockResolvedValue([sandbox]) } as never,
      { runReadOnlySql: overrides.runs } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.onModuleInit();
    const calls = (setSandboxToolServices as jest.Mock).mock
      .calls as unknown[][];
    const installed = calls.at(-1)![0] as SandboxToolServices;
    return {
      run: (sql: string) =>
        installed.runReadOnlySql('ds-1', sql, 100, ['claims']),
      fixer,
    };
  }

  it('repairs a failed statement and reports the SQL that ran', async () => {
    const runs = jest
      .fn()
      .mockRejectedValueOnce(new Error('Column claimid cannot be resolved'))
      .mockResolvedValueOnce({ columns: ['n'], rows: [{ n: 3 }] });
    const { run, fixer } = await bridge({
      runs,
      fixerReplies: [
        { sql: 'SELECT count(claim_id) AS n FROM main.health.claims' },
      ],
    });

    const result = await run(
      'SELECT count(claimid) AS n FROM main.health.claims',
    );

    const prompt = (fixer.generate.mock.calls as unknown[][])[0][0] as string;
    expect(fixer.generate).toHaveBeenCalledTimes(1);
    expect(prompt).toContain('Column claimid cannot be resolved');
    expect(prompt).toContain('Dialect: databricks');
    expect(prompt).toContain('main.health.claims(claim_id string)');
    expect(result).toEqual(
      expect.objectContaining({
        rows: [{ n: 3 }],
        correctedSql: 'SELECT count(claim_id) AS n FROM main.health.claims',
        note: expect.stringContaining('auto-corrected'),
      }),
    );
  });

  it('gives up after two repair attempts and rethrows the last error', async () => {
    const runs = jest
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(new Error('third'));
    const { run, fixer } = await bridge({
      runs,
      fixerReplies: [
        { sql: 'SELECT 1 FROM main.health.claims' },
        { sql: 'SELECT 2 FROM main.health.claims' },
      ],
    });

    await expect(run('SELECT bad FROM main.health.claims')).rejects.toThrow(
      'third',
    );
    expect(runs).toHaveBeenCalledTimes(3);
    expect(fixer.generate).toHaveBeenCalledTimes(2);
  });

  it('notes an empty result set without calling the fixer', async () => {
    const runs = jest.fn().mockResolvedValue({ columns: ['n'], rows: [] });
    const { run, fixer } = await bridge({ runs });

    const result = await run('SELECT 1 WHERE false');

    expect(fixer.generate).not.toHaveBeenCalled();
    expect(result.correctedSql).toBeUndefined();
    expect(result.note).toContain('0 rows');
  });

  it('flags and notes a result that filled the row limit', async () => {
    const rows = Array.from({ length: 100 }, (_, n) => ({ n }));
    const runs = jest.fn().mockResolvedValue({ columns: ['n'], rows });
    const { run } = await bridge({ runs });

    const result = await run('SELECT n FROM main.health.claims');

    expect(result.truncated).toBe(true);
    expect(result.note).toContain('row limit 100 reached');
  });
});

describe('ProjectsService answer feedback', () => {
  function build(project: ProjectDoc) {
    const repository = {
      get: jest.fn().mockResolvedValue(project),
      update: jest.fn().mockImplementation(async (_id, patch) => {
        Object.assign(project, patch);
        return project;
      }),
    };
    const verifiedQueries = {
      save: jest.fn().mockResolvedValue({}),
      removeForMessage: jest.fn().mockResolvedValue(1),
    };
    const service = new ProjectsService(
      repository as never,
      {} as never,
      {
        getByNames: jest
          .fn()
          .mockResolvedValue([
            { name: 'claims', datasourceId: 'ds-1', tables: [] },
          ]),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      verifiedQueries as never,
    );
    return { service, verifiedQueries };
  }

  const answered = (): ProjectDoc => ({
    id: 'project-1',
    name: 'Claims',
    sandboxes: ['claims'],
    visualizations: [],
    messages: [
      { role: 'user', content: 'ignore me', at: '2024-01-01T00:00:00.000Z' },
      {
        role: 'assistant',
        content: 'older answer',
        at: '2024-01-01T00:00:01.000Z',
      },
      {
        role: 'user',
        content: 'How many claims were denied last year?',
        at: '2024-01-01T00:00:02.000Z',
      },
      {
        role: 'assistant',
        content: '1,204 claims.',
        at: '2024-01-01T00:00:03.000Z',
        entities: ['main.health.claims'],
        data: [
          { tool: 'run_readonly_sql', input: 'SELECT 1', error: 'boom' },
          {
            tool: 'run_readonly_sql',
            input: 'SELECT count(*) FROM main.health.claims',
            rowCount: 1,
          },
        ],
      },
    ],
  });

  it('saves the preceding question with the last successful SQL on thumbs-up', async () => {
    const project = answered();
    const { service, verifiedQueries } = build(project);

    const updated = await service.recordFeedback(
      'project-1',
      '2024-01-01T00:00:03.000Z',
      'up',
    );

    expect(verifiedQueries.save).toHaveBeenCalledWith({
      question: 'How many claims were denied last year?',
      sql: 'SELECT count(*) FROM main.health.claims',
      datasourceId: 'ds-1',
      entities: ['main.health.claims'],
      sourceProjectId: 'project-1',
      sourceMessageAt: '2024-01-01T00:00:03.000Z',
    });
    expect(updated.messages.at(-1)?.feedback).toBe('up');
    expect(updated.messages.at(-1)?.verified).toBe(true);
  });

  it('clears the verified badge on thumbs-down', async () => {
    const project = answered();
    project.messages[3].verified = true;
    const { service } = build(project);

    await service.recordFeedback(
      'project-1',
      '2024-01-01T00:00:03.000Z',
      'down',
    );

    expect(project.messages.at(-1)?.verified).toBeUndefined();
  });

  it('removes the stored pair on thumbs-down', async () => {
    const project = answered();
    const { service, verifiedQueries } = build(project);

    await service.recordFeedback(
      'project-1',
      '2024-01-01T00:00:03.000Z',
      'down',
    );

    expect(verifiedQueries.removeForMessage).toHaveBeenCalledWith(
      'project-1',
      '2024-01-01T00:00:03.000Z',
    );
    expect(verifiedQueries.save).not.toHaveBeenCalled();
    expect(project.messages.at(-1)?.feedback).toBe('down');
  });

  it('records the rating but saves nothing when the answer ran no SQL', async () => {
    const project = answered();
    delete project.messages[3].data;
    const { service, verifiedQueries } = build(project);

    await service.recordFeedback('project-1', '2024-01-01T00:00:03.000Z', 'up');

    expect(verifiedQueries.save).not.toHaveBeenCalled();
    expect(project.messages.at(-1)?.feedback).toBe('up');
  });
});

/** SQL runs followed by a written answer — the ordinary completed turn. */
async function* answerStream(
  runs: {
    sql: string;
    rows: Record<string, unknown>[];
    truncated?: boolean;
  }[],
) {
  for (const [index, run] of runs.entries()) {
    const toolCallId = `call-${index}`;
    yield {
      type: 'tool-call',
      payload: {
        toolCallId,
        toolName: 'run_readonly_sql',
        args: { sql: run.sql },
      },
    };
    yield {
      type: 'tool-result',
      payload: {
        toolCallId,
        toolName: 'run_readonly_sql',
        result: {
          columns: ['n'],
          rows: run.rows,
          ...(run.truncated ? { truncated: true } : {}),
        },
      },
    };
  }
  yield { type: 'text-delta', payload: { text: 'Here is the answer.' } };
}

/** One SQL run, then the model asks for a clarification and the turn ends. */
async function* clarificationStream() {
  yield {
    type: 'tool-call',
    payload: {
      toolCallId: 'call-0',
      toolName: 'run_readonly_sql',
      args: { sql: 'select 1' },
    },
  };
  yield {
    type: 'tool-result',
    payload: {
      toolCallId: 'call-0',
      toolName: 'run_readonly_sql',
      result: { columns: ['n'], rows: [{ n: 1 }] },
    },
  };
  yield {
    type: 'tool-call',
    payload: {
      toolCallId: 'call-1',
      toolName: 'ask_clarification',
      args: {
        question: 'Which season?',
        options: [{ label: '2022' }, { label: '2018' }],
      },
    },
  };
}

async function* toolOnlyStream(count: number) {
  for (let index = 0; index < count; index++) {
    const toolCallId = `call-${index}`;
    yield {
      type: 'tool-call',
      payload: {
        toolCallId,
        toolName: 'run_readonly_sql',
        args: { sql: `select ${index}` },
      },
    };
    yield {
      type: 'tool-result',
      payload: {
        toolCallId,
        toolName: 'run_readonly_sql',
        result: { columns: ['value'], rows: [{ value: index }] },
      },
    };
  }
}
