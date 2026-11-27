// Sessions bound to Insights Analyst (BA-320; api.md 2.1 #3,
// agents.md 2.11, agent-answers R61): a past chat of his (agentKey, no
// workflowId) keeps the removed Answer a Business Question's chip and goes
// on as his own turn on the `agent-turn` engine: the derived agent, the
// turn's agent, its context and the plain turn.
jest.mock('@mastra/core/request-context', () => ({
  RequestContext: class {
    private readonly values = new Map<string, unknown>();
    set = jest.fn((key: string, value: unknown) => {
      this.values.set(key, value);
    });
    get = jest.fn((key: string) => this.values.get(key));
  },
}));
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/model-resolver', () => ({
  isCustomAnthropicConfig: (c: unknown) =>
    typeof c === 'object' && c !== null && 'kind' in c,
  AGENT_OVERRIDES_CONTEXT_KEY: 'agent-overrides',
  resolveAgentModelConfig: jest.fn().mockResolvedValue('openai/gpt-4.1-mini'),
}));
jest.mock('../../mastra/tool-services', () => ({
  setDatasetToolServices: jest.fn(),
}));
// Every streamed turn runs its workflow (agents.md 5.1): the engine stand-in.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../../mastra/testing/workflows.stub')>(
    '../../mastra/testing/workflows.stub',
  ),
);
jest.mock('../../mastra/tools/dataset.tools', () => ({
  DATASETS_CONTEXT_KEY: 'datasets',
}));
jest.mock('../../mastra/session-workspaces', () => ({
  SESSION_WORKSPACE_CONTEXT_KEY: 'session-workspace-id',
}));
jest.mock('../datasets/repositories/datasets.repository', () => ({
  DatasetsRepository: class {},
}));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));
jest.mock('../verified-queries/verified-queries.service', () => ({
  VerifiedQueriesService: class {},
}));
jest.mock('../metrics/metrics.service', () => ({ MetricsService: class {} }));
jest.mock('../ontology/ontology.service', () => ({
  OntologyService: class {},
}));
jest.mock('../../mastra/agents/sql-fixer.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  return { sqlFixOutputSchema: z.object({ sql: z.string() }) };
});
jest.mock('./repositories/sessions.repository', () => ({
  SessionsRepository: class {},
}));
jest.mock('./visualization.service', () => ({
  VisualizationService: class {},
}));
jest.mock('../../common/markdown-pdf', () => ({ renderPdf: jest.fn() }));
jest.mock('./visualization-document', () => ({
  sourceEntities: jest.fn().mockReturnValue([]),
}));

import { SessionsService, type StreamEvent } from './sessions.service';
import { streamStored } from './testing/stream-stored';
import type { SessionDoc } from './entities/session.entity';
import { streamTurnWorkflow } from '../../mastra/testing/turn-workflow.stub';

const NAME = 'Insights Analyst';
const DESCRIPTION =
  'A business data analyst: answers questions over the datasets you pick with read-only SQL, checks its results and explains how it got them.';

async function* streamOf(chunks: unknown[]) {
  for (const chunk of chunks) yield await Promise.resolve(chunk);
}

const DATASETS = [
  {
    name: 'World Cup',
    datasourceId: 'ds-pg',
    datasourceKind: 'postgres',
    tables: ['wc.public.matches', 'wc.public.teams'],
  },
  {
    name: 'Sales',
    datasourceId: 'ds-dbx',
    datasourceKind: 'databricks',
    tables: ['main.sales.orders'],
  },
];

/** A turn that ran one successful query, then answered. */
const SQL_CHUNKS = [
  {
    type: 'tool-call',
    payload: {
      toolCallId: 't1',
      toolName: 'run_readonly_sql',
      args: { sql: 'SELECT 1 AS n', rationale: 'Count.' },
    },
  },
  {
    type: 'tool-result',
    payload: {
      toolCallId: 't1',
      toolName: 'run_readonly_sql',
      result: { columns: ['n'], rows: [{ n: 1 }], rowCount: 1 },
    },
  },
  { type: 'text-delta', payload: { text: 'Hello.' } },
];

function build(chunks?: unknown[], partial: Partial<SessionDoc> = {}) {
  const session: SessionDoc = {
    id: 's-1',
    name: 'Goals',
    datasets: ['World Cup'],
    agentKey: 'insights-analyst',
    agentName: NAME,
    messages: [],
    visualizations: [],
    ...partial,
  };
  const repository = {
    insert: jest
      .fn()
      .mockImplementation((doc: SessionDoc) => Promise.resolve(doc)),
    get: jest.fn().mockResolvedValue(session),
    update: jest.fn().mockImplementation((_id: string, patch: object) => {
      Object.assign(session, patch);
      return Promise.resolve(session);
    }),
  };
  let streamOptions: {
    maxSteps?: number;
    context: { role: string; content: string }[];
    requestContext: { get(key: string): unknown };
  } = { context: [], requestContext: { get: () => undefined } };
  const michael = {
    id: 'insights-analyst',
    name: NAME,
    getDescription: () => DESCRIPTION,
    getMemory: jest.fn().mockResolvedValue({
      getThreadById: jest.fn().mockResolvedValue({ id: session.id }),
    }),
    stream: jest
      .fn()
      .mockImplementation((_input: unknown, opts: typeof streamOptions) => {
        streamOptions = opts;
        return Promise.resolve({
          fullStream: streamOf(chunks ?? SQL_CHUNKS),
          text: Promise.resolve(''),
        });
      }),
    generate: jest.fn().mockResolvedValue({ text: 'Synthesized.' }),
  };
  const assistant = {
    name: 'Questions to Insights Assistant',
    getDescription: () => 'assistant',
    getMemory: jest.fn().mockResolvedValue(null),
    stream: jest.fn(),
    generate: jest.fn(),
  };
  const registry: Record<string, unknown> = {
    assistant,
    'insights-analyst': michael,
  };
  const mastra = {
    getAgent: jest.fn((key: string) => registry[key]),
    streamWorkflow: jest.fn(streamTurnWorkflow),
    listAgents: () => registry,
    ensureSessionWorkspace: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve({ id: `session-${id}` }),
      ),
  };
  const datasetsRepository = {
    getByNames: jest.fn((names: string[]) =>
      Promise.resolve(DATASETS.filter((d) => names.includes(d.name))),
    ),
  };
  const userAgents = {
    get: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    datasetNames: jest
      .fn()
      .mockResolvedValue(new Set(DATASETS.map((d) => d.name))),
  };
  // No metric, knowledge or verified query applies unless a test says so.
  const knowledge = {
    contextFor: jest.fn().mockResolvedValue({ block: '', used: [] }),
  };
  const metrics = { definitionBlock: jest.fn().mockResolvedValue('') };
  const verifiedQueries = {
    referenceBlock: jest.fn().mockResolvedValue(undefined),
    isVerifiedSql: jest.fn().mockResolvedValue(false),
  };
  const service = new SessionsService(
    repository as never,
    mastra as never,
    datasetsRepository as never,
    {} as never,
    {
      getView: jest.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
    } as never,
    {} as never,
    verifiedQueries as never,
    metrics as never,
    knowledge as never,
    userAgents as never,
  );
  return {
    service,
    session,
    repository,
    mastra,
    michael,
    assistant,
    knowledge,
    metrics,
    verifiedQueries,
    streamOptions: () => streamOptions,
  };
}

async function turn(
  ctx: ReturnType<typeof build>,
  content: string,
  abortSignal?: AbortSignal,
  events: StreamEvent[] = [],
): Promise<StreamEvent[]> {
  await streamStored(
    ctx.service,
    's-1',
    content,
    (event) => events.push(event),
    abortSignal,
  );
  return events;
}

describe('SessionsService sessions bound to Insights Analyst (BA-320)', () => {
  it('derives the agent from the registry, with no starters (api.md 2.1)', async () => {
    const ctx = build();
    expect((await ctx.service.toView(ctx.session)).agent).toEqual({
      id: 'insights-analyst',
      name: NAME,
      deleted: false,
      description: DESCRIPTION,
      starterQuestions: [],
    });
  });

  it("keeps the removed workflow's chip and shows no bar (agents.md 5.12)", async () => {
    const ctx = build();
    expect(ctx.service.effectiveWorkflowFor(ctx.session)).toEqual([]);
    const view = await ctx.service.toView(ctx.session);
    expect(view.workflowRef).toEqual({
      id: 'answer-business-question',
      name: 'Answer a Business Question',
      kind: 'code',
      deleted: false,
    });
    expect(view).not.toHaveProperty('workflow');
  });

  it('runs Michael with Block 1, the metrics, knowledge and verified-query blocks, in that order (agents.md 2.11, 4.1, 4.2)', async () => {
    const ctx = build(undefined, { datasets: ['World Cup', 'Sales'] });
    const used = [
      {
        id: 'k-1',
        kind: 'default_filter',
        title: 'No friendlies',
        body: "stage <> 'friendly'",
      },
    ];
    ctx.metrics.definitionBlock.mockResolvedValue('METRICS BLOCK');
    ctx.knowledge.contextFor.mockResolvedValue({
      block: 'KNOWLEDGE BLOCK',
      used,
    });
    ctx.verifiedQueries.referenceBlock.mockResolvedValue('VERIFIED BLOCK');
    await turn(ctx, 'How many goals per year?');
    expect(ctx.mastra.getAgent).toHaveBeenCalledWith('insights-analyst');
    expect(ctx.assistant.stream).not.toHaveBeenCalled();
    const options = ctx.streamOptions();
    expect(options.maxSteps).toBe(15);
    expect(options.context).toEqual([
      {
        role: 'system',
        content: [
          'Datasets for this session: World Cup, Sales.',
          'Entities available (fully-qualified catalog.schema.table):',
          '- wc.public.matches (dataset: World Cup; datasource: postgres ds-pg)',
          '- wc.public.teams (dataset: World Cup; datasource: postgres ds-pg)',
          '- main.sales.orders (dataset: Sales; datasource: databricks ds-dbx)',
          // It has sample_rows (2.11), and no visuals lines.
          'Use describe_entity / sample_rows / run_readonly_sql to inspect and query them.',
        ].join('\n'),
      },
      { role: 'system', content: 'METRICS BLOCK' },
      { role: 'system', content: 'KNOWLEDGE BLOCK' },
      { role: 'system', content: 'VERIFIED BLOCK' },
    ]);
    // The same services as the assistant's turn, for the session's datasets.
    expect(ctx.metrics.definitionBlock).toHaveBeenCalledWith([
      'wc.public.matches',
      'wc.public.teams',
      'main.sales.orders',
    ]);
    expect(ctx.knowledge.contextFor).toHaveBeenCalledWith([
      'World Cup',
      'Sales',
    ]);
    expect(ctx.verifiedQueries.referenceBlock).toHaveBeenCalledWith(
      'How many goals per year?',
    );
    const context = options.requestContext;
    expect(context.get('datasets')).toEqual(['World Cup', 'Sales']);
    expect(context.get('session-id')).toBe('s-1');
    expect(context.get('turn-question')).toBe('How many goals per year?');
    expect(context.get('knowledge-used')).toEqual(used);
    expect(context.get('session-workspace-id')).toBeUndefined();
    expect(context.get('agent-tools')).toBeUndefined();
    expect(context.get('agent-skills')).toBeUndefined();
    expect(ctx.mastra.ensureSessionWorkspace).not.toHaveBeenCalled();
    // The answer records the knowledge the model saw.
    expect(ctx.session.messages.at(-1)).toMatchObject({
      role: 'assistant',
      knowledge: used,
    });
  });

  it('leaves out the metrics, knowledge and verified-query blocks when none applies', async () => {
    const ctx = build();
    await turn(ctx, 'How many matches?');
    const contents = ctx.streamOptions().context.map((block) => block.content);
    expect(contents).toHaveLength(1);
    expect(contents[0]).toMatch(/^Datasets for this session: World Cup\./);
  });

  describe('a clarifying question (agents.md 2.11, 3.6)', () => {
    const ASK = {
      type: 'tool-call',
      payload: {
        toolCallId: 'c1',
        toolName: 'ask_clarification',
        args: {
          question: 'Which measure makes a team the best?',
          options: 'Most wins\nMost goals — scored over all matches',
        },
      },
    };

    it('stops the turn with the question and its options, and sends done', async () => {
      const ctx = build([
        ASK,
        { type: 'text-delta', payload: { text: 'never streamed' } },
      ]);
      const events = await turn(ctx, 'Which team is the best?');
      const answer = ctx.session.messages.at(-1);
      expect(answer).toMatchObject({
        role: 'assistant',
        content: 'Which measure makes a team the best?',
        clarification: {
          question: 'Which measure makes a team the best?',
          options: [
            { label: 'Most wins' },
            { label: 'Most goals', description: 'scored over all matches' },
          ],
        },
      });
      expect(answer?.content).not.toContain('never streamed');
      expect(events.some((event) => event.type === 'done')).toBe(true);
    });

    it("replays the question before the user's pick on the next turn", async () => {
      const ctx = build([ASK]);
      await turn(ctx, 'Which team is the best?');
      ctx.michael.stream.mockImplementation(() =>
        Promise.resolve({
          fullStream: streamOf(SQL_CHUNKS),
          text: Promise.resolve(''),
        }),
      );
      await turn(ctx, 'Most wins');
      const calls = ctx.michael.stream.mock.calls as unknown[][];
      expect(calls.at(-1)?.[0]).toEqual([
        {
          role: 'assistant',
          content: 'Which measure makes a team the best?',
        },
        { role: 'user', content: 'Most wins' },
      ]);
      expect(ctx.session.messages.at(-1)).toMatchObject({
        role: 'assistant',
        content: 'Hello.',
      });
    });
  });

  it('runs no grounding pass on a turn without tools', async () => {
    const ctx = build([
      { type: 'text-delta', payload: { text: 'Brazil won in 2002.' } },
    ]);
    await turn(ctx, 'Who won in 2002?');
    // The grounding guard would call generate again.
    expect(ctx.michael.generate).not.toHaveBeenCalled();
    expect(ctx.assistant.generate).not.toHaveBeenCalled();
    const answer = ctx.session.messages.at(-1);
    expect(answer).toMatchObject({
      role: 'assistant',
      content: 'Brazil won in 2002.',
    });
  });

  it('keeps a run_readonly_sql call as a data record and shows its step', async () => {
    const ctx = build(SQL_CHUNKS);
    const events = await turn(ctx, 'How many?');
    const step = events.find((event) => event.type === 'tool-result');
    expect(JSON.parse(step?.content ?? '{}')).toMatchObject({
      tool: 'run_readonly_sql',
      input: 'SELECT 1 AS n',
      rowCount: 1,
    });
    const answer = ctx.session.messages.at(-1);
    expect(answer?.content).toBe('Hello.');
    expect(answer?.data?.[0]).toMatchObject({
      tool: 'run_readonly_sql',
      input: 'SELECT 1 AS n',
    });
  });

  describe('the turn workflow (agents.md 5.12, ADR-0040)', () => {
    it('runs a past chat on the agent-turn engine, with no workflow bar events', async () => {
      const ctx = build();
      const events = await turn(ctx, '  How many?  ');
      const engines = ctx.mastra.streamWorkflow.mock.calls.map(
        (call) => call[0],
      );
      expect(engines).toEqual(['agent-turn']);
      expect(events.some((event) => event.type === 'workflow')).toBe(false);
      // Michael's text is the answer, streamed as he writes it.
      const texts = events.filter((event) => event.type === 'text');
      expect(texts.map((event) => event.content)).toEqual(['Hello.']);
      expect(events.at(-1)?.type).toBe('done');
      expect(ctx.session.messages.at(-1)?.content).toBe('Hello.');
    });

    it('sends no done when the user stops the turn', async () => {
      const controller = new AbortController();
      const ctx = build();
      ctx.michael.stream.mockImplementation(() =>
        Promise.resolve({
          fullStream: (async function* () {
            yield await Promise.resolve({
              type: 'text-delta',
              payload: { text: 'Partial' },
            });
            controller.abort();
          })(),
          text: Promise.resolve(''),
        }),
      );
      const events = await turn(ctx, 'How many?', controller.signal);
      expect(events.some((event) => event.type === 'done')).toBe(false);
    });

    it("leaves the assistant turn as it was: its own agent, never Michael's", async () => {
      const ctx = build(undefined, { agentKey: undefined });
      ctx.assistant.stream.mockResolvedValue({
        fullStream: streamOf([]),
        text: Promise.resolve('Answer.'),
      });
      ctx.assistant.generate.mockResolvedValue({ text: 'Answer.' });
      await turn(ctx, 'How many?').catch(() => undefined);
      // Every turn is a run since ADR-0040; the assistant's is `agent-turn`.
      const engines = ctx.mastra.streamWorkflow.mock.calls.map(
        (call) => call[0],
      );
      expect(engines).toEqual(['agent-turn']);
      expect(ctx.michael.stream).not.toHaveBeenCalled();
    });
  });
});
