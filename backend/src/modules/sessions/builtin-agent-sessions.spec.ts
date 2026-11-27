// Sessions bound to a built-in agent (agent-answers R52, R61; ADR-0028): the
// derived `agent`, the turn of an agent other than the assistant, and how a
// session of a removed agent (the RFP Builder, the Site Reviewer, the Data
// Readiness Agent) still reads.
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
import { streamTurnWorkflow } from '../../mastra/testing/turn-workflow.stub';
import { toolDataRecord } from './turn-data';
import type { SessionDoc } from './entities/session.entity';

const ANALYST_DESCRIPTION = 'Answers business questions from the data.';

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
    name: 'Insights Analyst',
    datasets: ['Claims'],
    agentKey: 'insights-analyst',
    agentName: 'Insights Analyst',
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
  const analyst = {
    id: 'insights-analyst',
    name: 'Insights Analyst',
    getDescription: () => ANALYST_DESCRIPTION,
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
  // The assistant, the RFP Builder (`rfp`), the Site Reviewer and the Data
  // Readiness Agent (`data-readiness`) are no longer registered.
  const registry: Record<string, unknown> = {
    'insights-analyst': analyst,
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
    {
      contextFor: jest.fn().mockResolvedValue({ block: '', used: [] }),
    } as never,
    userAgents as never,
  );
  return { service, session, repository, analyst };
}

/** Run a streamed turn and collect its events. */
async function turn(
  ctx: ReturnType<typeof build>,
  content: string,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await streamStored(
    ctx.service,
    's-1',
    content,
    (event) => events.push(event),
    undefined,
  );
  return events;
}

describe('SessionsService sessions bound to a built-in agent (ADR-0028)', () => {
  it('derives the agent from the registered built-in, with no starters (api.md 2.1)', async () => {
    const ctx = build();
    const expected = {
      id: 'insights-analyst',
      name: 'Insights Analyst',
      deleted: false,
      description: ANALYST_DESCRIPTION,
      starterQuestions: [],
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
    it('skips the grounding pass, but keeps tool-only synthesis', async () => {
      const ctx = build();
      await turn(ctx, 'Hello');
      // A tool-free answer would trigger the assistant's grounding pass:
      // it does not run for this agent.
      expect(ctx.analyst.generate).not.toHaveBeenCalled();

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

    // The Site Reviewer (`site-reviewer`) went with Review a Website: a
    // past chat of hers reads as the Assistant's, its chip keeps the
    // removed workflow's name, and a turn on it answers 404 (ADR-0059).
    it('reads a stored Site Reviewer session as the Assistant, and refuses a turn on it', async () => {
      const ctx = build({
        session: {
          agentKey: 'site-reviewer',
          agentName: 'Site Reviewer',
          workflowId: 'review-website',
          datasets: [],
          messages: [
            { role: 'user', content: 'https://shop.example.com/', at: 't1' },
            { role: 'assistant', content: 'Reviewed 2 pages.', at: 't2' },
          ],
        },
      });
      const view = await ctx.service.toView(ctx.session);
      expect(view).not.toHaveProperty('agent');
      expect(view).not.toHaveProperty('agentKey');
      expect(view.workflowRef).toEqual({
        id: 'review-website',
        name: 'Review a Website',
        kind: 'code',
        deleted: false,
      });
      expect(view.messages).toHaveLength(2);

      await expect(turn(ctx, 'And the checkout page?')).rejects.toMatchObject({
        status: 404,
        message: 'Agent "site-reviewer" not found',
      });
      expect(ctx.analyst.stream).not.toHaveBeenCalled();
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

  describe('a stored session of the removed Data Readiness Agent', () => {
    /** As an earlier version stored it: her report on the answer and in the panel. */
    const legacy = {
      agentKey: 'data-readiness',
      agentName: 'Data Readiness Agent',
      workflowId: 'agent:data-readiness',
      messages: [
        { role: 'user', content: 'Assess the readiness of Claims', at: 't1' },
        {
          role: 'assistant',
          content: 'Claims scores 72.',
          at: 't2',
          readinessReport: {
            reportId: 'r-1',
            datasourceName: 'Claims PG',
            overallScore: 72,
            maturity: 'developing',
            generatedAt: 't2',
          },
        },
      ],
      panelItems: [
        {
          id: 'readiness:r-1',
          kind: 'readiness',
          title: 'Claims readiness',
          reportId: 'r-1',
          shownAt: 't2',
        },
        {
          id: 'doc-1',
          kind: 'document',
          title: 'Notes',
          markdown: '# Notes',
          shownAt: 't2',
        },
      ],
    } as unknown as Partial<SessionDoc>;

    it('reads as a plain Assistant session, without her report or its panel item', async () => {
      const ctx = build({ session: legacy });
      const view = await ctx.service.toView(ctx.session);
      expect(view).not.toHaveProperty('agent');
      expect(view).not.toHaveProperty('agentKey');
      expect(view).not.toHaveProperty('agentName');
      expect(view.workflowRef).toEqual({
        id: 'agent:assistant',
        name: 'Assistant',
        kind: 'agent',
        deleted: false,
      });
      // The transcript reads as stored, less the readiness report.
      expect(view.messages.map((m) => m.content)).toEqual([
        'Assess the readiness of Claims',
        'Claims scores 72.',
      ]);
      expect(view.messages[1]).not.toHaveProperty('readinessReport');
      expect(view.panelItems.map((item) => item.id)).toEqual(['doc-1']);
      // A list read gives the same view; the stored document is untouched.
      const [listed] = await ctx.service.toViews([ctx.session]);
      expect(listed).toEqual(view);
      expect(ctx.session.messages[1]).toHaveProperty('readinessReport');
      expect(ctx.repository.update).not.toHaveBeenCalled();
    });

    it('answers 404 to a turn on it: no registered agent runs it (ADR-0059)', async () => {
      const ctx = build({ session: legacy });
      await expect(turn(ctx, 'And the members table?')).rejects.toMatchObject({
        status: 404,
        message: 'Agent "data-readiness" not found',
      });
      expect(ctx.analyst.stream).not.toHaveBeenCalled();
    });
  });
});

describe('a past chat of the removed assistant (ADR-0059)', () => {
  it('still opens: its Assistant chip, a cross-check, a visual and its panel items read as stored, and a turn answers 404', async () => {
    const ctx = build({
      session: {
        agentKey: undefined,
        workflowId: 'agent:assistant',
        datasets: ['World Cup'],
        messages: [
          { role: 'user', content: 'Who won?', at: 't1' },
          {
            role: 'assistant',
            content: 'Argentina won.',
            at: 't2',
            crossCheck: { status: 'agree', note: 'same results' },
          },
          {
            role: 'assistant',
            content: 'Created interactive visual "Wins" (v1).',
            at: 't3',
            visual: {
              visualId: 'v1',
              version: 1,
              title: 'Wins',
              action: 'created',
            },
          },
        ],
        visualizations: [
          {
            id: 'v1',
            title: 'Wins',
            description: '',
            path: 'visuals/v1',
            sourceMessageAt: 't2',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        panelItems: [
          {
            id: 'doc-1',
            kind: 'document',
            title: 'Notes',
            shownAt: '2026-01-01T00:00:00.000Z',
            markdown: '# Notes',
          },
        ],
      },
    });
    const view = await ctx.service.toView(ctx.session);
    expect(view.workflowRef).toEqual({
      id: 'agent:assistant',
      name: 'Assistant',
      kind: 'agent',
      deleted: false,
    });
    expect(view).not.toHaveProperty('agent');
    expect(view.messages[1].crossCheck).toEqual({
      status: 'agree',
      note: 'same results',
    });
    expect(view.messages[2].visual).toMatchObject({ visualId: 'v1' });
    expect(view.panelItems.map((item) => item.id).sort()).toEqual([
      'doc-1',
      'visual:v1',
    ]);
    await expect(turn(ctx, 'And in 2014?')).rejects.toMatchObject({
      status: 404,
      message: 'Agent "assistant" not found',
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
