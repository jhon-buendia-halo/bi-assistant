// The data-readiness service loads the Databricks driver (ESM-only deps)
// at import time; the session specs never call it for real.
jest.mock('../data-readiness/data-readiness.service', () => ({
  DataReadinessService: class {},
}));

// Sessions bound to the Data Readiness Agent (BA-261; data-readiness R2, R5;
// sessions-chat R52, R61): creation, the derived agent, the turn's context
// and the readiness-report event.
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
jest.mock('../rfp-packages/rfp-packages.service', () => ({
  RfpPackagesService: class {},
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

import { BadRequestException } from '@nestjs/common';
import { isoToday } from '../../mastra/rfp-context';
import { getReadinessToolServices } from '../../mastra/readiness-tool-services';
import type {
  ReadinessReport,
  ReadinessSummary,
} from '../data-readiness/engine/types';
import { SessionsService, type StreamEvent } from './sessions.service';
import type { SessionDoc } from './entities/session.entity';

const REQUIREMENT = 'Add a PostgreSQL or Databricks dataset first';
const DESCRIPTION =
  'Assesses how ready a PostgreSQL or Databricks dataset is for analysis, scoring it on the DMBOK data-quality dimensions with a deterministic engine and explaining the findings.';

function report(id: string): ReadinessReport {
  return {
    id,
    datasourceId: 'ds-pg',
    datasourceName: 'World Cup DB',
    datasourceKind: 'postgres',
    generatedAt: '2026-11-03T10:00:00.000Z',
    entityCount: 2,
    overallScore: 91,
    maturity: 'Managed',
    dimensionScores: [],
    findings: [],
  };
}

async function* streamOf(chunks: (() => Promise<unknown>)[]) {
  for (const chunk of chunks) yield await chunk();
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
  {
    name: 'Intellify RFP API',
    datasourceId: 'ds-rest',
    datasourceKind: 'rest',
    tables: ['api.intellify.clients'],
  },
];

interface BuildOptions {
  session?: Partial<SessionDoc>;
  /** The datasets that exist (default: all of DATASETS). */
  existing?: typeof DATASETS;
  /** The chunks of the turn; each runs when the stream reaches it. */
  chunks?: (() => Promise<unknown>)[];
}

function build(options: BuildOptions = {}) {
  const session: SessionDoc = {
    id: 's-1',
    name: 'Data Readiness',
    datasets: ['World Cup'],
    agentKey: 'data-readiness',
    agentName: 'Data Readiness Agent',
    messages: [],
    visualizations: [],
    ...options.session,
  };
  const repository = {
    insert: jest
      .fn()
      .mockImplementation((doc: SessionDoc) => Promise.resolve(doc)),
    get: jest.fn().mockResolvedValue(session),
    listAll: jest.fn().mockResolvedValue([]),
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
  const readinessAgent = {
    id: 'data-readiness-agent',
    name: 'Data Readiness Agent',
    getDescription: () => DESCRIPTION,
    getMemory: jest.fn().mockResolvedValue({
      getThreadById: jest.fn().mockResolvedValue({ id: session.id }),
    }),
    stream: jest
      .fn()
      .mockImplementation((_input: unknown, opts: typeof streamOptions) => {
        streamOptions = opts;
        return Promise.resolve({
          fullStream: streamOf(
            options.chunks ?? [
              () =>
                Promise.resolve({
                  type: 'text-delta',
                  payload: { text: 'Hello.' },
                }),
            ],
          ),
          text: Promise.resolve(''),
        });
      }),
    generate: jest.fn().mockResolvedValue({ text: 'Synthesized.' }),
  };
  const assistant = {
    name: 'assistant',
    getDescription: () => 'assistant',
    stream: jest.fn(),
    generate: jest.fn(),
  };
  const registry: Record<string, unknown> = {
    assistant,
    'data-readiness': readinessAgent,
  };
  const mastra = {
    getAgent: jest.fn((key: string) => registry[key]),
    listAgents: () => registry,
    ensureSessionWorkspace: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve({ id: `session-${id}` }),
      ),
  };
  const existing = options.existing ?? DATASETS;
  const datasetsRepository = {
    getByNames: jest.fn((names: string[]) =>
      Promise.resolve(existing.filter((d) => names.includes(d.name))),
    ),
  };
  const datasources = {
    get: jest.fn((id: string) =>
      Promise.resolve({
        id,
        name: id === 'ds-pg' ? 'World Cup DB' : 'Lakehouse',
      }),
    ),
  };
  const userAgents = {
    get: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    datasetNames: jest
      .fn()
      .mockResolvedValue(new Set(existing.map((d) => d.name))),
    datasetKinds: jest.fn().mockResolvedValue(
      existing.map((d) => ({
        name: d.name,
        datasourceKind: d.datasourceKind,
      })),
    ),
  };
  const knowledge = { contextFor: jest.fn() };
  const metrics = { definitionBlock: jest.fn() };
  const verifiedQueries = {
    referenceBlock: jest.fn(),
    isVerifiedSql: jest.fn().mockResolvedValue(false),
  };
  const readiness = {
    assess: jest.fn().mockResolvedValue(report('r-1')),
    list: jest.fn().mockResolvedValue({ reports: [] }),
    get: jest.fn((id: string) => Promise.resolve(report(id))),
  };
  const service = new SessionsService(
    repository as never,
    mastra as never,
    datasetsRepository as never,
    datasources as never,
    {
      getView: jest.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
    } as never,
    {} as never,
    verifiedQueries as never,
    metrics as never,
    knowledge as never,
    userAgents as never,
    undefined,
    readiness as never,
  );
  return {
    service,
    session,
    repository,
    mastra,
    readinessAgent,
    assistant,
    knowledge,
    metrics,
    verifiedQueries,
    readiness,
    streamOptions: () => streamOptions,
  };
}

async function turn(
  ctx: ReturnType<typeof build>,
  content: string,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await ctx.service.streamMessage('s-1', content, (event) =>
    events.push(event),
  );
  return events;
}

/** The chunks of a readiness tool call that runs through the bridge. */
function readinessToolTurn(
  toolName: 'assess_data_readiness' | 'get_readiness_report',
  run: () => Promise<{ summary: ReadinessSummary }>,
) {
  return [
    () =>
      Promise.resolve({
        type: 'tool-call',
        payload: { toolCallId: 't1', toolName, args: {} },
      }),
    async () => ({
      type: 'tool-result',
      payload: {
        toolCallId: 't1',
        toolName,
        result: (await run()).summary,
      },
    }),
    () =>
      Promise.resolve({
        type: 'text-delta',
        payload: { text: 'Overall 91, Managed.' },
      }),
  ];
}

describe('SessionsService sessions bound to the Data Readiness Agent (BA-261)', () => {
  describe('createFromAgent (api.md 2.1 #3, data-readiness R2)', () => {
    it('creates "Data Readiness" over every PostgreSQL or Databricks dataset, by name', async () => {
      const ctx = build();
      const session = await ctx.service.createFromAgent('data-readiness');
      expect(session).toMatchObject({
        name: 'Data Readiness',
        datasets: ['Sales', 'World Cup'],
        agentKey: 'data-readiness',
        agentName: 'Data Readiness Agent',
        messages: [],
      });
      expect(session).not.toHaveProperty('agentId');
    });

    it('uses a typed name instead', async () => {
      const session = await build().service.createFromAgent(
        'data-readiness',
        '  Q4 data check ',
      );
      expect(session.name).toBe('Q4 data check');
    });

    it('refuses with the requirement when no dataset qualifies, creating nothing', async () => {
      const ctx = build({ existing: [DATASETS[2]] });
      await expect(
        ctx.service.createFromAgent('data-readiness'),
      ).rejects.toThrow(new BadRequestException(REQUIREMENT));
      expect(ctx.repository.insert).not.toHaveBeenCalled();
    });
  });

  it('derives the agent with its starters (api.md 2.1)', async () => {
    const ctx = build();
    expect((await ctx.service.toView(ctx.session)).agent).toEqual({
      id: 'data-readiness',
      name: 'Data Readiness Agent',
      deleted: false,
      description: DESCRIPTION,
      starterQuestions: [
        'Assess the readiness of this dataset',
        'What are the worst data-quality problems?',
        'Show my past assessments',
      ],
    });
    expect(ctx.service.effectiveWorkflowFor(ctx.session)).toEqual([]);
  });

  it('runs the agent with Block D1 only and its context keys (agents.md 4.1, 4.2)', async () => {
    const ctx = build({ session: { datasets: ['World Cup', 'Sales'] } });
    await turn(ctx, 'Assess the readiness of this dataset');
    expect(ctx.mastra.getAgent).toHaveBeenCalledWith('data-readiness');
    expect(ctx.assistant.stream).not.toHaveBeenCalled();
    const options = ctx.streamOptions();
    expect(options.maxSteps).toBe(10);
    expect(options.context).toEqual([
      {
        role: 'system',
        content: [
          'Datasets for this session (data readiness):',
          '- World Cup — PostgreSQL datasource "World Cup DB" (datasourceId ds-pg), 2 entities, named like wc.public.matches',
          '- Sales — Databricks datasource "Lakehouse" (datasourceId ds-dbx), 1 entities, named like main.sales.orders',
          `Today is ${isoToday()}.`,
        ].join('\n'),
      },
    ]);
    const context = options.requestContext;
    expect(context.get('datasets')).toEqual(['World Cup', 'Sales']);
    expect(context.get('session-id')).toBe('s-1');
    expect(context.get('turn-question')).toBe(
      'Assess the readiness of this dataset',
    );
    expect(context.get('session-workspace-id')).toBe('session-s-1');
    expect(context.get('turn-data-records')).toEqual([]);
    expect(context.get('knowledge-used')).toBeUndefined();
    expect(context.get('rfp-created-by')).toBeUndefined();
    expect(context.get('turn-rfp')).toBeUndefined();
    expect(ctx.metrics.definitionBlock).not.toHaveBeenCalled();
    expect(ctx.knowledge.contextFor).not.toHaveBeenCalled();
    expect(ctx.verifiedQueries.referenceBlock).not.toHaveBeenCalled();
  });

  describe('a report reaches the client (api.md 3.1, data-readiness R5)', () => {
    it('emits readiness-report just before the tool-result, stores the panel item and the answer reference', async () => {
      const ctx = build();
      await ctx.service.onModuleInit();
      const bridge = getReadinessToolServices();
      const chunks = readinessToolTurn('assess_data_readiness', () =>
        bridge.assessReadiness({ sessionId: 's-1' }),
      );
      ctx.readinessAgent.stream.mockImplementation(() =>
        Promise.resolve({
          fullStream: streamOf(chunks),
          text: Promise.resolve(''),
        }),
      );
      const events = await turn(ctx, 'Assess the readiness of this dataset');

      expect(ctx.readiness.assess).toHaveBeenCalledWith({
        datasourceId: 'ds-pg',
        entities: ['wc.public.matches', 'wc.public.teams'],
        sessionId: 's-1',
      });
      // The full report came from the bridge's cache, not a second read.
      expect(ctx.readiness.get).not.toHaveBeenCalled();
      const types = events.map((event) => event.type);
      const at = types.indexOf('readiness-report');
      expect(at).toBeGreaterThan(-1);
      expect(types[at + 1]).toBe('tool-result');
      const payload = JSON.parse(events[at].content!) as {
        report: ReadinessReport;
        panelItem: Record<string, unknown>;
      };
      expect(payload.report).toEqual(report('r-1'));
      expect(payload.panelItem).toMatchObject({
        id: 'readiness:r-1',
        kind: 'readiness',
        title: 'Data readiness — World Cup DB',
        reportId: 'r-1',
      });
      expect(JSON.parse(events[at + 1].content!)).toEqual({
        tool: 'assess_data_readiness',
      });

      expect(ctx.session.panelItems).toEqual([payload.panelItem]);
      const answer = ctx.session.messages.at(-1)!;
      expect(answer).toMatchObject({
        role: 'assistant',
        content: 'Overall 91, Managed.',
        readinessReport: {
          reportId: 'r-1',
          datasourceName: 'World Cup DB',
          overallScore: 91,
          maturity: 'Managed',
          generatedAt: '2026-11-03T10:00:00.000Z',
        },
      });
      expect(answer).not.toHaveProperty('data');
    });

    it('streams assessment progress as tool-progress between the call and its result, never persisted (BA-324)', async () => {
      const progress = {
        phase: 'profiling',
        message: 'Profiling wc.public.matches',
        done: 1,
        total: 2,
        entity: 'wc.public.matches',
      };
      const ctx = build({
        chunks: [
          () =>
            Promise.resolve({
              type: 'tool-call',
              payload: {
                toolCallId: 'c1',
                toolName: 'assess_data_readiness',
                args: {},
              },
            }),
          // Verbatim, as `writer.custom` forwards it.
          () =>
            Promise.resolve({
              type: 'data-readiness-progress',
              data: progress,
            }),
          // Wrapped as a tool-output chunk.
          () =>
            Promise.resolve({
              type: 'tool-output',
              payload: {
                output: {
                  type: 'data-readiness-progress',
                  data: { phase: 'scoring', message: 'Scoring' },
                },
              },
            }),
          // Malformed: ignored.
          () =>
            Promise.resolve({
              type: 'data-readiness-progress',
              data: { phase: 'x', message: 42 },
            }),
          () =>
            Promise.resolve({
              type: 'tool-output',
              payload: { output: { type: 'other', data: {} } },
            }),
          () =>
            Promise.resolve({
              type: 'tool-result',
              payload: {
                toolCallId: 'c1',
                toolName: 'assess_data_readiness',
                result: {},
              },
            }),
          () =>
            Promise.resolve({
              type: 'text-delta',
              payload: { text: 'Done.' },
            }),
        ],
      });
      await ctx.service.onModuleInit();
      const events = await turn(ctx, 'Assess the readiness of this dataset');

      const types = events.map((event) => event.type);
      expect(types.slice(0, 4)).toEqual([
        'tool',
        'tool-progress',
        'tool-progress',
        'tool-result',
      ]);
      expect(JSON.parse(events[1].content!)).toEqual({
        tool: 'assess_data_readiness',
        ...progress,
      });
      expect(JSON.parse(events[2].content!)).toEqual({
        tool: 'assess_data_readiness',
        phase: 'scoring',
        message: 'Scoring',
      });
      const answer = ctx.session.messages.at(-1)!;
      expect(JSON.stringify(ctx.session.messages)).not.toContain('Profiling');
      expect(answer).toMatchObject({ role: 'assistant', content: 'Done.' });
    });

    it('upserts the item when the same report is shown again', async () => {
      const ctx = build({
        session: {
          panelItems: [
            {
              id: 'readiness:r-7',
              kind: 'readiness',
              title: 'Data readiness — World Cup DB',
              shownAt: '2026-01-01T00:00:00.000Z',
              reportId: 'r-7',
            },
          ],
        },
      });
      await ctx.service.onModuleInit();
      const bridge = getReadinessToolServices();
      const chunks = readinessToolTurn('get_readiness_report', () =>
        bridge.getReadinessReport({ sessionId: 's-1', reportId: 'r-7' }),
      );
      ctx.readinessAgent.stream.mockImplementation(() =>
        Promise.resolve({
          fullStream: streamOf(chunks),
          text: Promise.resolve(''),
        }),
      );
      await turn(ctx, 'Show the report r-7');
      expect(ctx.session.panelItems).toHaveLength(1);
      expect(ctx.session.panelItems![0].shownAt).not.toBe(
        '2026-01-01T00:00:00.000Z',
      );
    });

    it("takes the full report from the tool's raw { summary, report } result (unit 9 contract)", async () => {
      const ctx = build();
      ctx.readinessAgent.stream.mockImplementation(() =>
        Promise.resolve({
          fullStream: streamOf([
            () =>
              Promise.resolve({
                type: 'tool-result',
                payload: {
                  toolCallId: 't1',
                  toolName: 'get_readiness_report',
                  args: {},
                  result: {
                    summary: { reportId: 'r-5' },
                    report: report('r-5'),
                  },
                },
              }),
            () =>
              Promise.resolve({
                type: 'text-delta',
                payload: { text: 'Here it is.' },
              }),
          ]),
          text: Promise.resolve(''),
        }),
      );
      const events = await turn(ctx, 'Show the latest report');
      expect(ctx.readiness.get).not.toHaveBeenCalled();
      const event = events.find((e) => e.type === 'readiness-report')!;
      expect(
        (JSON.parse(event.content!) as { report: ReadinessReport }).report,
      ).toEqual(report('r-5'));
      expect(ctx.session.messages.at(-1)).toMatchObject({
        readinessReport: { reportId: 'r-5' },
      });
    });

    it('keeps the answer and its card when the turn ends on the report without prose', async () => {
      const ctx = build();
      await ctx.service.onModuleInit();
      const bridge = getReadinessToolServices();
      const chunks = readinessToolTurn('assess_data_readiness', () =>
        bridge.assessReadiness({ sessionId: 's-1' }),
      ).slice(0, 2);
      ctx.readinessAgent.stream.mockImplementation(() =>
        Promise.resolve({
          fullStream: streamOf(chunks),
          text: Promise.resolve(''),
        }),
      );
      await turn(ctx, 'Assess the readiness of this dataset');
      expect(ctx.readinessAgent.generate).not.toHaveBeenCalled();
      expect(ctx.session.messages.at(-1)).toMatchObject({
        role: 'assistant',
        content:
          'Data readiness of "World Cup DB": 91/100, Managed. The scorecard is open in the panel.',
        readinessReport: { reportId: 'r-1' },
      });
    });

    it('shows a tool error as the step, with no report event', async () => {
      const ctx = build();
      ctx.readinessAgent.stream.mockImplementation(() =>
        Promise.resolve({
          fullStream: streamOf([
            () =>
              Promise.resolve({
                type: 'tool-result',
                payload: {
                  toolCallId: 't1',
                  toolName: 'assess_data_readiness',
                  args: { dataset: 'Nope' },
                  result: {
                    error:
                      'Dataset "Nope" is not in this session. Choose one of: World Cup.',
                  },
                },
              }),
            () =>
              Promise.resolve({
                type: 'tool-result',
                payload: {
                  toolCallId: 't2',
                  toolName: 'list_readiness_reports',
                  args: {},
                  result: {
                    datasourceName: 'World Cup DB',
                    reports: [],
                    total: 0,
                  },
                },
              }),
            () =>
              Promise.resolve({
                type: 'text-delta',
                payload: { text: 'Which dataset?' },
              }),
          ]),
          text: Promise.resolve(''),
        }),
      );
      const events = await turn(ctx, 'Assess Nope');
      expect(events.map((e) => e.type)).not.toContain('readiness-report');
      const results = events
        .filter((e) => e.type === 'tool-result')
        .map((e) => JSON.parse(e.content!) as Record<string, unknown>);
      expect(results).toEqual([
        {
          tool: 'assess_data_readiness',
          input: 'Nope',
          error:
            'Dataset "Nope" is not in this session. Choose one of: World Cup.',
        },
        { tool: 'list_readiness_reports' },
      ]);
      expect(ctx.session.messages.at(-1)).not.toHaveProperty('readinessReport');
    });
  });
});
