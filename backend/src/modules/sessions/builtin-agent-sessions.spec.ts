// The data-readiness service loads the Databricks driver (ESM-only deps)
// at import time; the session specs never call it for real.
jest.mock('../data-readiness/data-readiness.service', () => ({
  DataReadinessService: class {},
}));

// Sessions bound to a built-in agent (agent-answers R52, R61; ADR-0028): the
// derived `agent`, the turn of an agent other than the assistant, and how a
// session of the removed RFP Builder still reads.
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
// Every streamed turn runs its workflow (agents.md 5.1): the engine stand-in.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../../mastra/testing/workflows.stub')>(
    '../../mastra/testing/workflows.stub',
  ),
);
jest.mock('../../mastra/model-resolver', () => ({
  AGENT_OVERRIDES_CONTEXT_KEY: 'agent-overrides',
  isCustomAnthropicConfig: (c: unknown) =>
    typeof c === 'object' && c !== null && 'kind' in c,
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
import { streamTurnWorkflow } from '../../mastra/testing/turn-workflow.stub';
import { toolDataRecord } from './turn-data';
import type { SessionDoc } from './entities/session.entity';

const READINESS_DESCRIPTION = 'Assesses how ready a dataset is for analysis.';
const READINESS_STARTERS = [
  'Assess the readiness of this dataset',
  'What are the worst data-quality problems?',
  'Show my past assessments',
];

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
  chunks?: unknown[];
}

function build(options: BuildOptions = {}) {
  const session: SessionDoc = {
    id: 's-1',
    name: 'Data Readiness',
    datasets: ['Claims'],
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
    update: jest.fn().mockImplementation((_id: string, patch: object) => {
      Object.assign(session, patch);
      return Promise.resolve(session);
    }),
  };
  const readinessAgent = {
    id: 'data-readiness',
    name: 'Data Readiness Agent',
    getDescription: () => READINESS_DESCRIPTION,
    getMemory: jest.fn().mockResolvedValue({
      getThreadById: jest.fn().mockResolvedValue({ id: session.id }),
    }),
    stream: jest.fn().mockImplementation(() =>
      Promise.resolve({
        fullStream: streamOf(
          options.chunks ?? [
            { type: 'text-delta', payload: { text: 'Hello.' } },
          ],
        ),
        text: Promise.resolve(''),
      }),
    ),
    generate: jest.fn().mockResolvedValue({ text: 'Synthesized.' }),
  };
  const assistant = {
    name: 'assistant',
    getDescription: () => 'assistant',
    stream: jest.fn(),
    generate: jest.fn(),
  };
  // The RFP Builder (`rfp`) is no longer registered.
  const registry: Record<string, unknown> = {
    assistant,
    'data-readiness': readinessAgent,
  };
  const mastra = {
    getAgent: jest.fn((key: string) => registry[key]),
    listAgents: () => registry,
    streamWorkflow: streamTurnWorkflow,
    ensureSessionWorkspace: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve({ id: `session-${id}` }),
      ),
  };
  const datasetsRepository = {
    getByNames: jest.fn().mockResolvedValue([
      {
        name: 'Claims',
        datasourceId: 'ds-pg',
        datasourceKind: 'postgres',
        tables: ['claims.public.claims'],
      },
    ]),
  };
  const datasources = {
    get: jest.fn().mockResolvedValue({ id: 'ds-pg', name: 'Claims PG' }),
  };
  const userAgents = {
    get: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    datasetNames: jest.fn().mockResolvedValue(new Set(['Claims'])),
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
    {
      referenceBlock: jest.fn(),
      isVerifiedSql: jest.fn().mockResolvedValue(false),
    } as never,
    { definitionBlock: jest.fn() } as never,
    { contextFor: jest.fn() } as never,
    userAgents as never,
  );
  return { service, session, repository, readinessAgent };
}

/** Run a streamed turn and collect its events. */
async function turn(
  ctx: ReturnType<typeof build>,
  content: string,
  careful = false,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await streamStored(
    ctx.service,
    's-1',
    content,
    (event) => events.push(event),
    undefined,
    undefined,
    careful,
  );
  return events;
}

describe('SessionsService sessions bound to a built-in agent (ADR-0028)', () => {
  it('derives the agent from the registered built-in with its starters (api.md 2.1)', async () => {
    const ctx = build();
    const expected = {
      id: 'data-readiness',
      name: 'Data Readiness Agent',
      deleted: false,
      description: READINESS_DESCRIPTION,
      starterQuestions: READINESS_STARTERS,
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

  describe('a turn of an agent other than the assistant', () => {
    it('skips the grounding pass and careful mode, but keeps tool-only synthesis', async () => {
      const ctx = build();
      await turn(ctx, 'Hello', true);
      // A tool-free answer would trigger the assistant's grounding pass, and
      // careful mode its cross-check: neither runs for this agent.
      expect(ctx.readinessAgent.generate).not.toHaveBeenCalled();
      expect(ctx.session.messages.at(-1)).not.toHaveProperty('crossCheck');

      const silent = build({
        chunks: [
          toolCall('c0', 'list_entities', {}),
          toolResult('c0', 'list_entities', { entities: [] }),
        ],
      });
      await turn(silent, 'List the tables');
      expect(silent.session.messages.at(-1)?.content).toBe(
        'I completed the data analysis but could not produce a final response. Please retry your question.',
      );
    });

    it('emits the panel-item event of a show_in_panel result', async () => {
      const ctx = build({
        chunks: [
          toolCall('c0', 'show_in_panel', {
            kind: 'document',
            title: 'Notes',
            markdown: '# Notes',
          }),
          toolResult('c0', 'show_in_panel', {
            shown: true,
            id: 'doc-1',
            kind: 'document',
            title: 'Notes',
          }),
          toolCall('c1', 'show_in_panel', { kind: 'file', path: '../x' }),
          toolResult('c1', 'show_in_panel', {
            error: 'Invalid file path "../x"',
          }),
          { type: 'text-delta', payload: { text: 'Done.' } },
        ],
      });
      ctx.session.panelItems = [
        {
          id: 'doc-1',
          kind: 'document',
          title: 'Notes',
          shownAt: '2026-10-14T10:00:00.000Z',
          markdown: '# Notes',
        },
      ];
      const events = await turn(ctx, 'Show it');
      expect(events.filter((e) => e.type === 'panel-item')).toHaveLength(1);
      const results = events
        .filter((e) => e.type === 'tool-result')
        .map((e) => JSON.parse(e.content!) as unknown);
      expect(results).toEqual([
        { tool: 'show_in_panel', input: 'Notes' },
        { tool: 'show_in_panel', error: 'Invalid file path "../x"' },
      ]);
      // The removed RFP Builder's package event is never sent.
      expect(events.map((e) => e.type)).not.toContain('rfp-package');
    });

    it('keeps clarification interception', async () => {
      const ctx = build({
        chunks: [
          toolCall('c0', 'ask_clarification', {
            question: 'Which dataset?',
            options: ['Claims', 'Members'],
          }),
        ],
      });
      await turn(ctx, 'Assess it');
      expect(ctx.session.messages.at(-1)).toMatchObject({
        content: 'Which dataset?',
        clarification: { question: 'Which dataset?' },
      });
    });
  });

  describe('a stored session of the removed RFP Builder', () => {
    /** As an earlier version stored it, legacy fields and all. */
    const legacy = {
      agentKey: 'rfp',
      agentName: 'RFP Builder',
      workflowId: 'agent:rfp',
      rfpId: 'rfp-1',
      datasets: ['Intellify RFP API'],
      messages: [
        { role: 'user', content: 'Start an RFP', at: 't1' },
        {
          role: 'assistant',
          content: 'Package exported.',
          at: 't2',
          rfpPackage: {
            rfpId: 'rfp-1',
            title: 'Orchard RFP',
            files: [{ name: 'rfp.md', bytes: 10 }],
            exportedAt: 't2',
          },
        },
      ],
      panelItems: [
        {
          id: 'f1',
          kind: 'file',
          title: 'RFP',
          path: 'rfp/rfp-1/rfp.md',
          shownAt: 't2',
        },
      ],
    } as unknown as Partial<SessionDoc>;

    it('reads as a plain Assistant session, without throwing', async () => {
      const ctx = build({ session: legacy });
      const view = await ctx.service.toView(ctx.session);
      expect(view).not.toHaveProperty('agent');
      expect(view).not.toHaveProperty('agentKey');
      expect(view).not.toHaveProperty('agentName');
      expect(view).not.toHaveProperty('rfpId');
      expect(view).not.toHaveProperty('workflow');
      expect(view.workflowRef).toEqual({
        id: 'agent:assistant',
        name: 'Assistant',
        kind: 'agent',
        deleted: false,
      });
      // Its transcript and panel items still read as stored.
      expect(view.messages).toHaveLength(2);
      expect(view.panelItems).toEqual([
        expect.objectContaining({ id: 'f1', path: 'rfp/rfp-1/rfp.md' }),
      ]);
      // A list read gives the same view; the stored document is untouched.
      const [listed] = await ctx.service.toViews([ctx.session]);
      expect(listed).toEqual(view);
      expect(ctx.session).toMatchObject({ agentKey: 'rfp', rfpId: 'rfp-1' });
      expect(ctx.repository.update).not.toHaveBeenCalled();
    });

    it('reads as plain when it never stored a workflowId', async () => {
      const ctx = build({
        session: { ...legacy, workflowId: undefined },
      });
      const view = await ctx.service.toView(ctx.session);
      expect(view).not.toHaveProperty('agent');
      expect(view.workflowRef).toMatchObject({
        id: 'agent:assistant',
        name: 'Assistant',
      });
    });
  });
});

describe('toolDataRecord for tabular tool results (agents.md 5.1)', () => {
  it('records a non-SQL result that carries columns and rows', () => {
    const rows = Array.from({ length: 205 }, (_, n) => ({ n }));
    const record = toolDataRecord(
      'get_orders',
      { customer: 'IC100100', line: 'Medical', rationale: 'why' },
      { columns: ['n'], rows },
    );
    expect(record).toEqual({
      tool: 'get_orders',
      input: 'IC100100 · Medical',
      columns: ['n'],
      rows: rows.slice(0, 200),
      rowCount: 205,
      truncated: true,
    });
  });

  it('records nothing for other results', () => {
    expect(toolDataRecord('list_orders', {}, { orders: [] })).toBeNull();
    expect(toolDataRecord('get_orders', {}, { error: 'boom' })).toBeNull();
    expect(toolDataRecord('describe_entity', {}, { columns: [] })).toBeNull();
  });
});
