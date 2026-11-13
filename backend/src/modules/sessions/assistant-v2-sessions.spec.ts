// The data-readiness service loads the Databricks driver (ESM-only deps)
// at import time; the session specs never call it for real.
jest.mock('../data-readiness/data-readiness.service', () => ({
  DataReadinessService: class {},
}));

// Sessions bound to Questions to Insights v2 (BA-320; api.md 2.1 #3,
// agents.md 2.11, agent-answers R61): creation over picked datasets, the
// derived agent, the turn's agent, its context and the plain turn.
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
  // The Load catalog step reads the datasets as the dataset tools do.
  getDatasetToolServices: () => ({
    getDatasets: (names: string[]) =>
      Promise.resolve(
        [
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
        ].filter((d) => names.includes(d.name)),
      ),
  }),
}));
// v2's turn runs its workflow (agents.md 5.11) on the engine stand-in.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../../mastra/testing/workflows.stub')>(
    '../../mastra/testing/workflows.stub',
  ),
);
jest.mock('../../mastra/tools/dataset.tools', () => ({
  DATASETS_CONTEXT_KEY: 'datasets',
}));
jest.mock('../../mastra/tools/visual.tools', () => ({
  ACTIVE_VISUAL_CONTEXT_KEY: 'active-visual-id',
  SESSION_ID_CONTEXT_KEY: 'session-id',
  TURN_QUESTION_CONTEXT_KEY: 'turn-question',
  TURN_RECORDS_CONTEXT_KEY: 'turn-data-records',
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
jest.mock('../../mastra/agents/sql-verifier.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  return { sqlVerifyOutputSchema: z.object({ sql: z.string() }) };
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
import type { SessionDoc, SessionView } from './entities/session.entity';
import { qtiV2TurnWorkflow } from '../../mastra/workflows/qti-v2-turn.workflow';
import { planOf } from '../../mastra/workflows/qti-v2-turn.steps';

type StubRun = {
  stream(args: { inputData: unknown; requestContext: unknown }): unknown;
};
const turnWorkflow = qtiV2TurnWorkflow as unknown as {
  createRun(): Promise<StubRun>;
};

const NAME = 'Questions to Insights v2';
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

/** The answer the stubbed Write answer step writes, in two pieces. */
const WRITTEN = 'The written answer.';

/** An Analyse turn that ran one successful query, then wrote a note. */
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
    agentKey: 'assistant-v2',
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
  // Every Analyse attempt's options, in order (a retry streams again).
  const allStreamOptions: Record<string, unknown>[] = [];
  const v2 = {
    id: 'questions-to-insights-v2',
    name: NAME,
    getDescription: () => DESCRIPTION,
    getMemory: jest.fn().mockResolvedValue({
      getThreadById: jest.fn().mockResolvedValue({ id: session.id }),
    }),
    stream: jest
      .fn()
      .mockImplementation((_input: unknown, opts: typeof streamOptions) => {
        streamOptions = opts;
        allStreamOptions.push(opts);
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
    'assistant-v2': v2,
  };
  const mastra = {
    getAgent: jest.fn((key: string) => registry[key]),
    streamWorkflow: jest.fn(
      async (_key: string, inputData: unknown, requestContext: unknown) =>
        (await turnWorkflow.createRun()).stream({ inputData, requestContext }),
    ),
    listAgents: () => registry,
    // v2's Plan and Write answer model calls (agents.md 5.11).
    planV2Turn: jest.fn(({ question }: { question: string }) =>
      Promise.resolve({ plan: planOf({}, question), stopped: false }),
    ),
    writeV2Answer: jest.fn(
      (_input: unknown, opts: { onText?: (delta: string) => void }) => {
        opts.onText?.('The written ');
        opts.onText?.('answer.');
        return Promise.resolve({
          answer: { headline: WRITTEN, answer: WRITTEN },
          stopped: false,
        });
      },
    ),
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
    v2,
    assistant,
    knowledge,
    metrics,
    verifiedQueries,
    streamOptions: () => streamOptions,
    allStreamOptions,
  };
}

async function turn(
  ctx: ReturnType<typeof build>,
  content: string,
  careful = false,
  abortSignal?: AbortSignal,
  events: StreamEvent[] = [],
): Promise<StreamEvent[]> {
  await streamStored(
    ctx.service,
    's-1',
    content,
    (event) => events.push(event),
    abortSignal,
    undefined,
    careful,
  );
  return events;
}

/** The `workflow` events of a turn, as `current`, `done` and `failed`. */
function workflowMoves(events: StreamEvent[]) {
  return events
    .filter((event) => event.type === 'workflow')
    .map((event) => {
      const view = JSON.parse(event.content ?? '{}') as {
        current: number | null;
        done: number[];
        failed?: number;
      };
      return {
        current: view.current,
        done: view.done,
        ...(view.failed ? { failed: view.failed } : {}),
      };
    });
}

const STEPS = [
  { number: 1, title: 'Receive question' },
  { number: 2, title: 'Load catalog' },
  { number: 3, title: 'Plan' },
  { number: 4, title: 'Clarify' },
  { number: 5, title: 'Analyse' },
  { number: 6, title: 'Validate' },
  { number: 7, title: 'Write answer' },
  { number: 8, title: 'Wrap up' },
];

/** The plan block the default plan gives Analyse. */
const planBlockFor = (question: string) =>
  `Analysis plan for this turn:\n${JSON.stringify(planOf({}, question))}`;

describe('SessionsService sessions bound to Questions to Insights v2 (BA-320)', () => {
  it('derives the agent from the registry, with no starters (api.md 2.1)', async () => {
    const ctx = build();
    expect((await ctx.service.toView(ctx.session)).agent).toEqual({
      id: 'assistant-v2',
      name: NAME,
      deleted: false,
      description: DESCRIPTION,
      starterQuestions: [],
    });
  });

  it("shows its workflow's eight steps before any turn (agent-panel R8a)", async () => {
    const ctx = build();
    expect(ctx.service.effectiveWorkflowFor(ctx.session)).toEqual(STEPS);
    expect((await ctx.service.toView(ctx.session)).workflow).toEqual({
      phases: STEPS,
      source: 'workflow',
      current: null,
      done: [],
      skipped: [],
    });
  });

  it('runs v2 with Block 1, the metrics, knowledge and verified-query blocks, in that order, then the catalog and the plan (agents.md 2.11, 4.1, 4.2, 5.11)', async () => {
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
    expect(ctx.mastra.getAgent).toHaveBeenCalledWith('assistant-v2');
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
      {
        role: 'system',
        content: [
          'Catalog loaded for this turn: 3 entities.',
          '- wc.public.matches (dataset: World Cup; ? columns)',
          '- wc.public.teams (dataset: World Cup; ? columns)',
          '- main.sales.orders (dataset: Sales; ? columns)',
        ].join('\n'),
      },
      { role: 'system', content: planBlockFor('How many goals per year?') },
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
    ctx.metrics.definitionBlock.mockResolvedValue('');
    ctx.knowledge.contextFor.mockResolvedValue({ block: '', used: [] });
    ctx.verifiedQueries.referenceBlock.mockResolvedValue(undefined);
    await turn(ctx, 'How many matches?');
    const contents = ctx.streamOptions().context.map((block) => block.content);
    expect(contents).toHaveLength(3);
    expect(contents[0]).toMatch(/^Datasets for this session: World Cup\./);
    expect(contents[1]).toMatch(/^Catalog loaded for this turn:/);
    expect(contents[2]).toMatch(/^Analysis plan for this turn:/);
  });

  describe('Plan and Write answer (agents.md 5.11)', () => {
    it("plans with the turn's input and the catalog, and answers with Write answer's text only", async () => {
      const ctx = build();
      const events = await turn(ctx, 'How many?');
      expect(ctx.mastra.planV2Turn).toHaveBeenCalledWith(
        {
          messages: 'How many?',
          question: 'How many?',
          catalogBlock: expect.stringMatching(
            /^Catalog loaded for this turn: 2 entities\./,
          ) as string,
        },
        expect.objectContaining({
          abortSignal: expect.any(AbortSignal) as AbortSignal,
          providerOptions: expect.anything() as unknown,
        }),
      );
      // Write answer reads the attempt's query and its rows.
      expect(ctx.mastra.writeV2Answer).toHaveBeenCalledWith(
        {
          question: 'How many?',
          plan: planOf({}, 'How many?'),
          queries: [
            {
              sql: 'SELECT 1 AS n',
              rationale: 'Count.',
              rows: [{ n: 1 }],
              rowCount: 1,
              truncated: false,
            },
          ],
          findings: expect.arrayContaining([
            {
              check: 'Ran a query',
              passed: true,
              detail: expect.any(String) as string,
            },
          ]) as unknown,
        },
        expect.objectContaining({ onText: expect.any(Function) as unknown }),
      );
      // Analyse's own text ("Hello.") is a note: never streamed, never stored.
      const texts = events.filter((event) => event.type === 'text');
      expect(texts.map((event) => event.content)).toEqual([
        'The written ',
        'answer.',
      ]);
      expect(ctx.session.messages.at(-1)).toMatchObject({
        role: 'assistant',
        content: WRITTEN,
        // The turn's SQL stays on the answer.
        data: [expect.objectContaining({ input: 'SELECT 1 AS n' })],
      });
    });

    it('stops at Clarify when the plan needs clarification: the card, done, no analysis', async () => {
      const ctx = build();
      ctx.mastra.planV2Turn.mockImplementation(
        ({ question }: { question: string }) =>
          Promise.resolve({
            plan: planOf(
              {
                needsClarification: true,
                clarification: {
                  question: 'Dominant by which measure?',
                  options: ['Matches won', 'Goals scored — over all matches'],
                },
              },
              question,
            ),
            stopped: false,
          }),
      );
      const events = await turn(ctx, 'Which team was the most dominant?');
      expect(ctx.v2.stream).not.toHaveBeenCalled();
      expect(ctx.mastra.writeV2Answer).not.toHaveBeenCalled();
      expect(ctx.session.messages.at(-1)).not.toHaveProperty('data');
      expect(ctx.session.messages.at(-1)).toMatchObject({
        role: 'assistant',
        content: 'Dominant by which measure?',
        clarification: {
          question: 'Dominant by which measure?',
          options: [
            { label: 'Matches won' },
            { label: 'Goals scored', description: 'over all matches' },
          ],
        },
      });
      // The bar stops at Clarify, the run's last step.
      expect(workflowMoves(events).at(-1)).toEqual({
        current: 4,
        done: [1, 2, 3],
      });
      expect(events.at(-1)?.type).toBe('done');
    });

    it('retries Analyse once, without the memory thread and with the failed checks, when Validate fails', async () => {
      const ctx = build();
      ctx.v2.stream.mockImplementationOnce(
        (_input: unknown, opts: Record<string, unknown>) => {
          ctx.allStreamOptions.push(opts);
          return Promise.resolve({
            fullStream: streamOf([
              { type: 'text-delta', payload: { text: 'No query.' } },
            ]),
            text: Promise.resolve(''),
          });
        },
      );
      const events = await turn(ctx, 'How many?');
      expect(ctx.v2.stream).toHaveBeenCalledTimes(2);
      const [first, second] = ctx.allStreamOptions;
      expect(first).toHaveProperty('memory');
      expect(second).not.toHaveProperty('memory');
      const retry = (second['context'] as { content: string }[]).at(-1);
      expect(retry?.content).toContain(
        'Attempt 1 of this analysis failed validation.',
      );
      expect(retry?.content).toContain('- Ran a query: No SQL query ran.');
      // Analyse and Validate ran twice; the bar went through them again.
      const moves = workflowMoves(events);
      // The retry makes Analyse current again, after the first attempt's
      // Analyse and Validate were done.
      expect(moves).toContainEqual({ current: 5, done: [1, 2, 3, 5, 6] });
      expect(moves.at(-1)).toEqual({
        current: 8,
        done: [1, 2, 3, 5, 6, 7, 8],
      });
      expect(ctx.session.messages.at(-1)?.content).toBe(WRITTEN);
    });
  });

  describe('a clarifying question from Analyse (agents.md 2.11, 5.11)', () => {
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

    it('stops the turn at Analyse with the question and its options, and sends done', async () => {
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
      // The run ends at Analyse: no answer is written.
      expect(workflowMoves(events).at(-1)).toEqual({
        current: 5,
        done: [1, 2, 3],
      });
      expect(ctx.mastra.writeV2Answer).not.toHaveBeenCalled();
      expect(events.some((event) => event.type === 'done')).toBe(true);
    });

    it("replays the question before the user's pick on the next turn, Plan included", async () => {
      const ctx = build([ASK]);
      await turn(ctx, 'Which team is the best?');
      ctx.v2.stream.mockImplementation(() =>
        Promise.resolve({
          fullStream: streamOf(SQL_CHUNKS),
          text: Promise.resolve(''),
        }),
      );
      const events = await turn(ctx, 'Most wins');
      const replayed = [
        {
          role: 'assistant',
          content: 'Which measure makes a team the best?',
        },
        { role: 'user', content: 'Most wins' },
      ];
      const calls = ctx.v2.stream.mock.calls as unknown[][];
      expect(calls.at(-1)?.[0]).toEqual(replayed);
      expect(ctx.mastra.planV2Turn).toHaveBeenLastCalledWith(
        expect.objectContaining({ messages: replayed, question: 'Most wins' }),
        expect.anything(),
      );
      expect(ctx.session.messages.at(-1)).toMatchObject({
        role: 'assistant',
        content: WRITTEN,
      });
      expect(workflowMoves(events).at(-1)).toEqual({
        current: 8,
        done: [1, 2, 3, 5, 6, 7, 8],
      });
    });
  });

  it('runs no grounding pass on a turn without tools, and no careful cross-check', async () => {
    const ctx = build([
      { type: 'text-delta', payload: { text: 'Brazil won in 2002.' } },
    ]);
    await turn(ctx, 'Who won in 2002?', true);
    // The grounding guard and the cross-check would call generate again.
    expect(ctx.v2.generate).not.toHaveBeenCalled();
    expect(ctx.assistant.generate).not.toHaveBeenCalled();
    const answer = ctx.session.messages.at(-1);
    expect(answer).toMatchObject({ role: 'assistant', content: WRITTEN });
    expect(answer).not.toHaveProperty('crossCheck');
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
    expect(answer?.content).toBe(WRITTEN);
    expect(answer?.data?.[0]).toMatchObject({
      tool: 'run_readonly_sql',
      input: 'SELECT 1 AS n',
    });
  });

  describe('the turn workflow (agents.md 5.11, ADR-0034)', () => {
    it('runs every streamed turn as the workflow and moves the bar step by step', async () => {
      const ctx = build();
      const events = await turn(ctx, '  How many?  ');
      expect(ctx.mastra.streamWorkflow).toHaveBeenCalledWith(
        'qti-v2-turn',
        { question: 'How many?', datasets: ['World Cup'] },
        expect.anything(),
      );
      expect(workflowMoves(events)).toEqual([
        { current: 1, done: [] },
        { current: 1, done: [1] },
        { current: 2, done: [1] },
        { current: 2, done: [1, 2] },
        { current: 3, done: [1, 2] },
        { current: 3, done: [1, 2, 3] },
        // Clarify (4) is the branch not taken.
        { current: 5, done: [1, 2, 3] },
        { current: 5, done: [1, 2, 3, 5] },
        { current: 6, done: [1, 2, 3, 5] },
        { current: 6, done: [1, 2, 3, 5, 6] },
        { current: 7, done: [1, 2, 3, 5, 6] },
        { current: 7, done: [1, 2, 3, 5, 6, 7] },
        { current: 8, done: [1, 2, 3, 5, 6, 7] },
        { current: 8, done: [1, 2, 3, 5, 6, 7, 8] },
      ]);
      // The answer streams inside Write answer, between its start and end.
      const types = events.map((event) => event.type);
      const text = types.indexOf('text');
      const moves = events
        .map((event, i) => (event.type === 'workflow' ? i : -1))
        .filter((i) => i >= 0);
      expect(text).toBeGreaterThan(moves[10]);
      expect(text).toBeLessThan(moves[11]);
      expect(types.at(-1)).toBe('done');
      const done = events.at(-1)?.session as SessionView | undefined;
      expect(done?.workflow).toMatchObject({
        source: 'workflow',
        current: 8,
        done: [1, 2, 3, 5, 6, 7, 8],
      });
      expect(ctx.session.workflowState).toMatchObject({
        current: 8,
        done: [1, 2, 3, 5, 6, 7, 8],
      });
      expect(ctx.session.messages.at(-1)?.content).toBe(WRITTEN);
    });

    it('starts over on the next turn', async () => {
      const ctx = build(undefined, {
        workflowState: {
          current: 3,
          done: [1, 2],
          failed: 3,
          updatedAt: '2026-11-09T00:00:00.000Z',
        },
      });
      const events = await turn(ctx, 'Again');
      expect(workflowMoves(events)[0]).toEqual({ current: 1, done: [] });
      expect(ctx.session.workflowState).not.toHaveProperty('failed');
    });

    it('marks Analyse failed and fails the turn with the model error', async () => {
      const ctx = build([
        { type: 'error', payload: { error: new Error('model down') } },
      ]);
      const events: StreamEvent[] = [];
      await expect(
        turn(ctx, 'How many?', false, undefined, events),
      ).rejects.toThrow('model down');
      expect(workflowMoves(events).at(-1)).toEqual({
        current: 5,
        done: [1, 2, 3],
        failed: 5,
      });
      expect(ctx.session.workflowState).toMatchObject({
        current: 5,
        done: [1, 2, 3],
        failed: 5,
      });
      expect(events.some((event) => event.type === 'done')).toBe(false);
      // The question was kept; no answer was added.
      expect(ctx.session.messages.map((m) => m.role)).toEqual(['user']);
    });

    it('marks Write answer failed with its model error', async () => {
      const ctx = build();
      ctx.mastra.writeV2Answer.mockRejectedValue(new Error('answer down'));
      const events: StreamEvent[] = [];
      await expect(
        turn(ctx, 'How many?', false, undefined, events),
      ).rejects.toThrow('answer down');
      expect(workflowMoves(events).at(-1)).toMatchObject({
        current: 7,
        failed: 7,
      });
    });

    it('ends at Analyse when the user stops the turn', async () => {
      const controller = new AbortController();
      const ctx = build();
      ctx.v2.stream.mockImplementation(() =>
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
      const events = await turn(ctx, 'How many?', false, controller.signal);
      expect(workflowMoves(events).at(-1)).toEqual({
        current: 5,
        done: [1, 2, 3],
      });
      expect(ctx.mastra.writeV2Answer).not.toHaveBeenCalled();
      expect(events.some((event) => event.type === 'done')).toBe(false);
    });

    it('logs the wrap-up summary of the SQL calls', async () => {
      const ctx = build(SQL_CHUNKS);
      const log = jest
        .spyOn(
          (ctx.service as unknown as { logger: { log: () => void } }).logger,
          'log',
        )
        .mockImplementation(() => undefined);
      await turn(ctx, 'How many?');
      expect(log).toHaveBeenCalledWith(
        `Questions to Insights v2 turn in session s-1: {"sqlQueries":1,"failedQueries":0,"rows":1,"answerLength":${WRITTEN.length}}`,
      );
    });

    it("leaves the assistant turn as it was: its one-step workflow, never v2's", async () => {
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
      expect(engines).not.toContain('qti-v2-turn');
      expect(ctx.mastra.planV2Turn).not.toHaveBeenCalled();
    });
  });
});
