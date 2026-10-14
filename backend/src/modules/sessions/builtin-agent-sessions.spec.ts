// Sessions bound to a built-in agent (sessions-chat R52, R61; ADR-0028): the
// RFP Builder's session creation, its derived `agent`, and its turn.
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
  AGENT_OVERRIDES_CONTEXT_KEY: 'agent-overrides',
  resolveAgentModel: jest.fn().mockResolvedValue('openai/gpt-4.1-mini'),
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
jest.mock('../knowledge/knowledge.service', () => ({
  KnowledgeService: class {},
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
jest.mock('./visualization-document', () => ({
  sourceEntities: jest.fn().mockReturnValue([]),
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { setDatasetToolServices } from '../../mastra/tool-services';
import type { DatasetToolServices } from '../../mastra/tool-services';
import { isoToday } from '../../mastra/rfp-context';
import { CurrentUserService, LOCAL_USER } from '../auth/current-user.service';
import { SessionsService, type StreamEvent } from './sessions.service';
import { toolDataRecord } from './turn-data';
import type { SessionDoc } from './entities/session.entity';

const RFP_ID = '7b0c2f0e-1d2a-4c9b-9a51-0f6f1c2d3e4f';
const REQUIREMENT =
  'Load the "Intellify RFP API" sample in Settings → Testing Data first';
const RFP_DESCRIPTION =
  'Walks a Mercer benefits consultant through building a carrier RFP for one client over the Intellify data, stage by stage, and assembles the RFP package.';

async function* streamOf(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) {
    await Promise.resolve();
    yield chunk;
  }
}

function toolCall(id: string, toolName: string, args: Record<string, unknown>) {
  return { type: 'tool-call', payload: { toolCallId: id, toolName, args } };
}

function toolResult(id: string, toolName: string, result: unknown) {
  return { type: 'tool-result', payload: { toolCallId: id, toolName, result } };
}

interface BuildOptions {
  session?: Partial<SessionDoc>;
  datasets?: string[];
  chunks?: unknown[];
  /** What the active RFP read answers; an Error makes it fail. */
  rfp?: Record<string, unknown> | Error;
  /** Set on `turn-rfp` by a tool during the turn (as create_rfp does). */
  openedRfpId?: string;
}

function build(options: BuildOptions = {}) {
  const users = new CurrentUserService();
  const session: SessionDoc = {
    id: 's-1',
    name: 'RFP Builder',
    datasets: ['Intellify RFP API'],
    agentKey: 'rfp',
    agentName: 'RFP Builder',
    messages: [],
    visualizations: [],
    ...options.session,
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
    context: { role: string; content: string }[];
    requestContext: { get(key: string): unknown };
  } = { context: [], requestContext: { get: () => undefined } };
  const rfpAgent = {
    id: 'rfp-builder',
    name: 'RFP Builder',
    getDescription: () => RFP_DESCRIPTION,
    getMemory: jest.fn().mockResolvedValue({
      getThreadById: jest.fn().mockResolvedValue({ id: session.id }),
    }),
    stream: jest
      .fn()
      .mockImplementation((_input: unknown, opts: typeof streamOptions) => {
        streamOptions = opts;
        if (options.openedRfpId) {
          (opts.requestContext.get('turn-rfp') as { rfpId?: string }).rfpId =
            options.openedRfpId;
        }
        return Promise.resolve({
          fullStream: streamOf(
            options.chunks ?? [
              { type: 'text-delta', payload: { text: 'Hello.' } },
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
  const registry: Record<string, unknown> = { assistant, rfp: rfpAgent };
  const mastra = {
    getAgent: jest.fn((key: string) => registry[key]),
    listAgents: () => registry,
    ensureSessionWorkspace: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve({ id: `session-${id}` }),
      ),
  };
  const datasetsRepository = {
    getByNames: jest.fn().mockResolvedValue([
      {
        name: 'Intellify RFP API',
        datasourceId: 'ds-rest',
        datasourceKind: 'rest',
        tables: ['api.intellify.clients'],
      },
    ]),
  };
  const datasources = {
    get: jest
      .fn()
      .mockResolvedValue({ id: 'ds-rest', name: 'Intellify RFP API' }),
  };
  const userAgents = {
    get: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    datasetNames: jest
      .fn()
      .mockResolvedValue(new Set(options.datasets ?? ['Intellify RFP API'])),
  };
  const knowledge = { contextFor: jest.fn() };
  const metrics = { definitionBlock: jest.fn() };
  const verifiedQueries = {
    referenceBlock: jest.fn(),
    isVerifiedSql: jest.fn().mockResolvedValue(false),
  };
  const rfpPackages = {
    getJson: jest
      .fn()
      .mockImplementation(() =>
        options.rfp instanceof Error
          ? Promise.reject(options.rfp)
          : Promise.resolve(options.rfp ?? {}),
      ),
    restTarget: jest.fn().mockResolvedValue({ baseUrl: 'u', headers: {} }),
    exportRfpPackage: jest.fn(),
    download: jest.fn().mockResolvedValue({
      filename: 'rfp-x.zip',
      contentType: 'application/zip',
      body: Buffer.from('zip'),
    }),
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
    users,
    undefined,
    rfpPackages as never,
  );
  return {
    service,
    session,
    repository,
    mastra,
    rfpAgent,
    assistant,
    knowledge,
    metrics,
    verifiedQueries,
    rfpPackages,
    users,
    streamOptions: () => streamOptions,
  };
}

/** Run a streamed turn as the local user and collect its events. */
async function turn(
  ctx: ReturnType<typeof build>,
  content: string,
  careful = false,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await ctx.users.runAs(LOCAL_USER, () =>
    ctx.service.streamMessage(
      's-1',
      content,
      (event) => events.push(event),
      undefined,
      undefined,
      careful,
    ),
  );
  return events;
}

describe('SessionsService sessions bound to a built-in agent (ADR-0028)', () => {
  describe('createFromAgent with a built-in key (api.md 2.1 #3)', () => {
    it('creates a session named after the agent over its dataset, bound by key', async () => {
      const ctx = build();
      const session = await ctx.service.createFromAgent('rfp');
      expect(session).toMatchObject({
        name: 'RFP Builder',
        datasets: ['Intellify RFP API'],
        agentKey: 'rfp',
        agentName: 'RFP Builder',
        messages: [],
      });
      expect(session).not.toHaveProperty('agentId');
      expect(ctx.mastra.ensureSessionWorkspace).toHaveBeenCalled();
    });

    it('refuses with the requirement while the dataset is missing, creating nothing', async () => {
      const ctx = build({ datasets: [] });
      await expect(ctx.service.createFromAgent('rfp')).rejects.toThrow(
        new BadRequestException(REQUIREMENT),
      );
      expect(ctx.repository.insert).not.toHaveBeenCalled();
    });

    it('still answers not found for a built-in key that declares no dataset', async () => {
      await expect(
        build().service.createFromAgent('assistant'),
      ).rejects.toThrow(new NotFoundException('Agent "assistant" not found'));
    });
  });

  it('derives the agent from the registered built-in with its starters (api.md 2.1)', async () => {
    const ctx = build();
    const expected = {
      id: 'rfp',
      name: 'RFP Builder',
      deleted: false,
      description: RFP_DESCRIPTION,
      starterQuestions: [
        'Start an RFP for a client',
        'Which of my clients renew on 1 January 2027?',
        'Resume my draft RFPs',
      ],
    };
    expect((await ctx.service.toView(ctx.session)).agent).toEqual(expected);
    const plain: SessionDoc = {
      id: 's-2',
      name: 'Plain',
      datasets: ['x'],
      messages: [],
    };
    const [bound, unbound] = await ctx.service.toViews([ctx.session, plain]);
    expect(bound.agent).toEqual(expected);
    expect(unbound).not.toHaveProperty('agent');
  });

  it('installs the RFP bridge methods on the tool services (agents.md 3.10)', async () => {
    const ctx = build();
    (setDatasetToolServices as jest.Mock).mockClear();
    ctx.repository['listAllOwners' as never] = jest
      .fn()
      .mockResolvedValue([]) as never;
    await ctx.service.onModuleInit().catch(() => undefined);
    const [[installed]] = jest.mocked(setDatasetToolServices).mock.calls as [
      [DatasetToolServices],
    ];
    await installed.restTarget('ds-rest');
    expect(ctx.rfpPackages.restTarget).toHaveBeenCalledWith('ds-rest');
    await installed.exportRfpPackage('s-1', 'ds-rest', RFP_ID);
    expect(ctx.rfpPackages.exportRfpPackage).toHaveBeenCalledWith(
      's-1',
      'ds-rest',
      RFP_ID,
    );
  });

  describe('the RFP Builder turn (agents.md 4.1, 4.2, 5.1)', () => {
    it('runs the rfp agent with Block R1 only and the rfp context keys', async () => {
      const ctx = build();
      await turn(ctx, 'Start an RFP for Orchard');

      expect(ctx.mastra.getAgent).toHaveBeenCalledWith('rfp');
      expect(ctx.assistant.stream).not.toHaveBeenCalled();
      const options = ctx.streamOptions();
      expect(options.context).toEqual([
        {
          role: 'system',
          content: [
            'Intellify RFP API for this session: datasource ds-rest ("Intellify RFP API").',
            'No RFP is active in this session yet: start at stage 1.',
            `Today is ${isoToday()}.`,
          ].join('\n'),
        },
      ]);
      const context = options.requestContext;
      expect(context.get('datasets')).toEqual(['Intellify RFP API']);
      expect(context.get('session-id')).toBe('s-1');
      expect(context.get('turn-question')).toBe('Start an RFP for Orchard');
      expect(context.get('session-workspace-id')).toBe('session-s-1');
      expect(context.get('rfp-created-by')).toBe(LOCAL_USER.id);
      expect(context.get('turn-rfp')).toEqual({});
      expect(context.get('turn-data-records')).toBeUndefined();
      expect(context.get('knowledge-used')).toBeUndefined();
      // No metrics, knowledge or verified-query block for the RFP Builder.
      expect(ctx.metrics.definitionBlock).not.toHaveBeenCalled();
      expect(ctx.knowledge.contextFor).not.toHaveBeenCalled();
      expect(ctx.verifiedQueries.referenceBlock).not.toHaveBeenCalled();
    });

    it('names the active RFP read from the API', async () => {
      const ctx = build({
        session: { rfpId: RFP_ID },
        rfp: {
          id: RFP_ID,
          title: 'Orchard Manufacturing — 2027 benefits RFP',
          clientName: 'Orchard Manufacturing',
          clientOneCode: 'IC100100',
          planYear: 2027,
          status: 'draft',
          stage: 2,
        },
      });
      await turn(ctx, 'Carry on');
      expect(ctx.rfpPackages.getJson).toHaveBeenCalledWith(
        'ds-rest',
        `/v1/rfps/${RFP_ID}`,
      );
      expect(ctx.streamOptions().context[0].content.split('\n')[1]).toBe(
        `Active RFP in this session: ${RFP_ID} — "Orchard Manufacturing — 2027 benefits RFP" for Orchard Manufacturing (IC100100), plan year 2027, status draft, last completed stage 2.`,
      );
    });

    it('treats an RFP that cannot be read as none active', async () => {
      const ctx = build({
        session: { rfpId: RFP_ID },
        rfp: new Error('Intellify API unreachable'),
      });
      await turn(ctx, 'Carry on');
      expect(ctx.streamOptions().context[0].content.split('\n')[1]).toBe(
        'No RFP is active in this session yet: start at stage 1.',
      );
    });

    it("stores the RFP the turn opened as the session's active RFP", async () => {
      const ctx = build({ openedRfpId: RFP_ID });
      await turn(ctx, 'Create it');
      expect(ctx.session.rfpId).toBe(RFP_ID);
      expect(ctx.repository.update).toHaveBeenLastCalledWith(
        's-1',
        expect.objectContaining({ rfpId: RFP_ID }),
      );
    });

    it('shows each RFP tool step, keeps tabular results and stores the exported package', async () => {
      const exported = {
        rfpId: RFP_ID,
        title: 'Orchard Manufacturing — 2027 benefits RFP',
        files: [
          { name: 'rfp.md', bytes: 120 },
          { name: 'rfp.pdf', bytes: 4096 },
        ],
        exportedAt: '2026-10-14T10:00:00.000Z',
      };
      const ctx = build({
        chunks: [
          toolCall('c0', 'list_clients', { query: 'Orchard' }),
          toolResult('c0', 'list_clients', { clients: [{ name: 'Orchard' }] }),
          toolCall('c1', 'get_client_financials', {
            clientOneCode: 'IC100100',
            line: 'Medical',
          }),
          toolResult('c1', 'get_client_financials', {
            planYear: 2026,
            columns: ['carrier', 'annualPremium'],
            rows: [{ carrier: 'Aetna', annualPremium: 100 }],
            totals: {},
          }),
          toolCall('c2', 'get_rfp', { rfpId: 'nope' }),
          toolResult('c2', 'get_rfp', {
            error: '404 not_found: RFP "nope" not found',
          }),
          toolCall('c3', 'skill', { name: 'rfp-package' }),
          toolResult('c3', 'skill', { instructions: '...' }),
          toolCall('c4', 'export_rfp_package', { rfpId: RFP_ID }),
          toolResult('c4', 'export_rfp_package', exported),
          { type: 'text-delta', payload: { text: 'The package is ready.' } },
        ],
      });

      const events = await turn(ctx, 'Export it');

      const results = events
        .filter((event) => event.type === 'tool-result')
        .map((event) => JSON.parse(event.content!) as unknown);
      expect(results).toEqual([
        { tool: 'list_clients', input: 'Orchard' },
        { tool: 'get_client_financials', input: 'IC100100', rowCount: 1 },
        {
          tool: 'get_rfp',
          input: 'nope',
          error: '404 not_found: RFP "nope" not found',
        },
        { tool: 'export_rfp_package', input: RFP_ID },
      ]);
      // The package event comes just before the export's tool-result.
      const types = events.map((event) => event.type);
      const packageAt = types.indexOf('rfp-package');
      expect(packageAt).toBeGreaterThan(-1);
      expect(JSON.parse(events[packageAt + 1].content!)).toMatchObject({
        tool: 'export_rfp_package',
      });
      expect(JSON.parse(events[packageAt].content!)).toEqual(exported);

      const answer = ctx.session.messages.at(-1)!;
      expect(answer).toMatchObject({
        role: 'assistant',
        content: 'The package is ready.',
        rfpPackage: exported,
        data: [
          {
            tool: 'get_client_financials',
            input: 'IC100100 · Medical',
            columns: ['carrier', 'annualPremium'],
            rows: [{ carrier: 'Aetna', annualPremium: 100 }],
            rowCount: 1,
          },
        ],
      });
      expect(answer).not.toHaveProperty('interpretation');
      expect(events.at(-1)?.type).toBe('done');
    });

    it('skips the grounding pass and careful mode, but keeps tool-only synthesis', async () => {
      const ctx = build();
      await turn(ctx, 'Hello', true);
      // A tool-free answer would trigger the assistant's grounding pass, and
      // careful mode its cross-check: neither runs for the RFP Builder.
      expect(ctx.rfpAgent.generate).not.toHaveBeenCalled();
      expect(ctx.session.messages.at(-1)).not.toHaveProperty('crossCheck');

      const silent = build({
        chunks: [
          toolCall('c0', 'list_rfps', {}),
          toolResult('c0', 'list_rfps', { rfps: [] }),
        ],
      });
      await turn(silent, 'List my drafts');
      expect(silent.session.messages.at(-1)?.content).toBe(
        'I completed the data analysis but could not produce a final response. Please retry your question.',
      );
    });

    it('keeps clarification interception', async () => {
      const ctx = build({
        chunks: [
          toolCall('c0', 'ask_clarification', {
            question: 'Which client?',
            options: ['Orchard Manufacturing', 'Orchard Foods'],
          }),
        ],
      });
      await turn(ctx, 'Start an RFP for Orchard');
      expect(ctx.session.messages.at(-1)).toMatchObject({
        content: 'Which client?',
        clarification: { question: 'Which client?' },
      });
    });
  });

  it("serves the package download for the owner's session only (api.md #105)", async () => {
    const ctx = build();
    await expect(
      ctx.service.downloadRfpPackage('s-1', RFP_ID, 'rfp.md'),
    ).resolves.toMatchObject({ filename: 'rfp-x.zip' });
    expect(ctx.rfpPackages.download).toHaveBeenCalledWith(
      's-1',
      RFP_ID,
      'rfp.md',
    );

    ctx.repository.get.mockResolvedValue(null);
    await expect(
      ctx.service.downloadRfpPackage('other', RFP_ID),
    ).rejects.toThrow(new NotFoundException('Session other not found'));
  });
});

describe('toolDataRecord for tabular tool results (agents.md 5.1)', () => {
  it('records a non-SQL result that carries columns and rows', () => {
    const rows = Array.from({ length: 205 }, (_, n) => ({ n }));
    const record = toolDataRecord(
      'get_client_financials',
      { clientOneCode: 'IC100100', line: 'Medical', rationale: 'why' },
      { columns: ['n'], rows },
    );
    expect(record).toEqual({
      tool: 'get_client_financials',
      input: 'IC100100 · Medical',
      columns: ['n'],
      rows: rows.slice(0, 200),
      rowCount: 205,
      truncated: true,
    });
  });

  it('records nothing for other results', () => {
    expect(toolDataRecord('list_clients', {}, { clients: [] })).toBeNull();
    expect(
      toolDataRecord('get_client_financials', {}, { error: 'boom' }),
    ).toBeNull();
    expect(toolDataRecord('describe_entity', {}, { columns: [] })).toBeNull();
  });
});
