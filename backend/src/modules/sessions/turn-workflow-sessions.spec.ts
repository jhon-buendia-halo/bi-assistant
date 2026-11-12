// The data-readiness service loads the Databricks driver (ESM-only deps)
// at import time; the session specs never call it for real.
jest.mock('../data-readiness/data-readiness.service', () => ({
  DataReadinessService: class {},
}));

// Every streamed turn runs the session's workflow (agents.md 5.1, 5.12;
// ADR-0040; agent-answers R61): the assistant, the Data Readiness Agent and a user
// agent each run one `agent-turn` run, whose `answer` step is today's agent
// turn, with today's error rules; a one-step workflow never writes the bar.
jest.mock('@mastra/core/request-context', () => ({
  RequestContext: class {
    private readonly values = new Map<string, unknown>();
    set = jest.fn((key: string, value: unknown) => {
      this.values.set(key, value);
    });
    get = jest.fn((key: string) => this.values.get(key));
  },
}));
// The turn workflow runs on the engine stand-in (Jest can't load Mastra's ESM).
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../../mastra/testing/workflows.stub')>(
    '../../mastra/testing/workflows.stub',
  ),
);
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
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

import { streamTurnWorkflow } from '../../mastra/testing/turn-workflow.stub';
import { SessionsService, type StreamEvent } from './sessions.service';
import { streamStored } from './testing/stream-stored';
import type { SessionDoc } from './entities/session.entity';

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

/** The shape of an AI SDK `APICallError` from an OpenAI-style endpoint. */
function apiCallError(statusCode: number): Error {
  return Object.assign(new Error(`Request failed (${statusCode})`), {
    name: 'AI_APICallError',
    statusCode,
    url: 'http://127.0.0.1:8317/v1/chat/completions',
  });
}

const HISTORIAN = {
  name: 'Cup historian',
  description: 'Answers questions about World Cup history',
  instructions: 'Always name the tournament year.',
  datasets: ['World Cup'],
  starterQuestions: [],
};

interface BuildOptions {
  /** Which session: a plain one, one bound to the Data Readiness Agent, or a user agent's. */
  kind: 'assistant' | 'readiness' | 'user-agent';
  chunks?: unknown[];
  /** `agent.stream()` itself throws this. */
  streamThrows?: Error;
  /** The saved LLM settings (llm-settings R50/R51). */
  llmView?: Record<string, unknown>;
}

function build(options: BuildOptions) {
  const session: SessionDoc = {
    id: 's-1',
    name: 'Turn',
    datasets: ['World Cup'],
    messages: [],
    visualizations: [],
    ...(options.kind === 'readiness'
      ? { agentKey: 'data-readiness', agentName: 'Data Readiness Agent' }
      : {}),
    ...(options.kind === 'user-agent'
      ? { agentId: 'agent-1', agentName: HISTORIAN.name }
      : {}),
  };
  const repository = {
    get: jest.fn().mockResolvedValue(session),
    update: jest.fn().mockImplementation((_id: string, patch: object) => {
      Object.assign(session, patch);
      return Promise.resolve(session);
    }),
  };
  const agentFor = (name: string) => ({
    id: name,
    name,
    getDescription: () => name,
    getMemory: jest.fn().mockResolvedValue({
      getThreadById: jest.fn().mockResolvedValue({ id: session.id }),
    }),
    stream: jest.fn().mockImplementation(() => {
      if (options.streamThrows) {
        return Promise.reject(options.streamThrows);
      }
      return Promise.resolve({
        fullStream: streamOf(
          options.chunks ?? [
            toolCall('c0', 'list_entities', {}),
            toolResult('c0', 'list_entities', { entities: [] }),
            { type: 'text-delta', payload: { text: 'Hello.' } },
          ],
        ),
        text: Promise.resolve(''),
      });
    }),
    generate: jest.fn().mockResolvedValue({ text: 'Synthesized.' }),
  });
  const assistant = agentFor('Questions to Insights Assistant');
  const readiness = agentFor('Data Readiness Agent');
  const registry: Record<string, unknown> = {
    assistant,
    'data-readiness': readiness,
  };
  const mastra = {
    getAgent: jest.fn((key: string) => registry[key]),
    listAgents: () => registry,
    streamWorkflow: jest.fn(streamTurnWorkflow),
    ensureSessionWorkspace: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve({ id: `session-${id}` }),
      ),
  };
  const userAgents = {
    get: jest
      .fn()
      .mockResolvedValue(
        options.kind === 'user-agent'
          ? { id: 'agent-1', draft: HISTORIAN, live: HISTORIAN }
          : null,
      ),
    list: jest.fn().mockResolvedValue([]),
    skillsFor: jest.fn().mockResolvedValue([]),
    datasetNames: jest.fn().mockResolvedValue(new Set(['World Cup'])),
  };
  const llm = {
    getView: jest
      .fn()
      .mockResolvedValue(options.llmView ?? { reasoningEffort: 'medium' }),
  };
  const service = new SessionsService(
    repository as never,
    mastra as never,
    {
      getByNames: jest.fn().mockResolvedValue([
        {
          name: session.datasets[0],
          datasourceId: 'ds-1',
          datasourceKind: 'postgres',
          tables: [],
        },
      ]),
    } as never,
    { get: jest.fn().mockResolvedValue({ id: 'ds-1', name: 'DS' }) } as never,
    llm as never,
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
  return { service, session, repository, mastra, assistant, readiness };
}

/** Run a streamed turn and collect its events. */
async function turn(
  ctx: ReturnType<typeof build>,
  content: string,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await streamStored(ctx.service, 's-1', content, (event) =>
    events.push(event),
  );
  return events;
}

/** The `workflowState` patches written during the turn. */
function workflowStateWrites(ctx: ReturnType<typeof build>): unknown[] {
  return (ctx.repository.update.mock.calls as [string, object][])
    .map(([, patch]) => patch)
    .filter((patch) => 'workflowState' in patch)
    .map((patch) => patch.workflowState);
}

describe('every streamed turn runs the session workflow (agents.md 5.1, ADR-0040)', () => {
  it.each([
    ['an assistant', 'assistant', 'assistant'],
    ['a Data Readiness', 'readiness', 'data-readiness'],
    ['a user agent', 'user-agent', 'assistant'],
  ] as const)(
    '%s turn starts one agent-turn run with the question and datasets',
    async (_label, kind, agentKey) => {
      const ctx = build({ kind });
      const events = await turn(ctx, '  Who won?  ');

      expect(ctx.mastra.streamWorkflow).toHaveBeenCalledTimes(1);
      expect(ctx.mastra.streamWorkflow).toHaveBeenCalledWith(
        'agent-turn',
        { question: 'Who won?', datasets: ctx.session.datasets },
        expect.anything(),
      );
      // The step ran the session's agent, once.
      expect(ctx.mastra.getAgent).toHaveBeenCalledWith(agentKey);
      const agent =
        agentKey === 'data-readiness' ? ctx.readiness : ctx.assistant;
      expect(agent.stream).toHaveBeenCalledTimes(1);
      // The same answer, events and stored message as before.
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining(['tool', 'text', 'done']),
      );
      expect(events.at(-1)?.type).toBe('done');
      expect(ctx.session.messages.at(-1)).toMatchObject({
        role: 'assistant',
        content: 'Hello.',
      });
      // A one-step workflow never writes the bar from its step events.
      expect(events.some((event) => event.type === 'workflow')).toBe(false);
      expect(workflowStateWrites(ctx)).toEqual([]);
    },
  );

  it('ends the turn with the card on a clarifying question', async () => {
    const ctx = build({
      kind: 'assistant',
      chunks: [
        toolCall('c0', 'ask_clarification', {
          question: 'Which measure?',
          options: ['Most titles', 'Highest win rate'],
        }),
        { type: 'text-delta', payload: { text: 'Never streamed.' } },
      ],
    });
    const events = await turn(ctx, 'Who is the best team?');

    expect(ctx.mastra.streamWorkflow).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(['done']);
    expect(ctx.session.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Which measure?',
      clarification: { question: 'Which measure?' },
    });
  });

  it('fails a custom endpoint turn with the R50 text (llm-settings R51)', async () => {
    const ctx = build({
      kind: 'assistant',
      chunks: [{ type: 'error', payload: { error: apiCallError(401) } }],
      llmView: {
        provider: 'custom',
        baseUrl: 'http://127.0.0.1:8317/v1',
        reasoningEffort: 'medium',
      },
    });

    await expect(turn(ctx, 'Why?')).rejects.toThrow(
      'The endpoint rejected the API key (401)',
    );
    expect(ctx.session.messages.at(-1)?.role).toBe('user');
  });

  it("keeps today's handling of an OpenAI-style stream error", async () => {
    const ctx = build({
      kind: 'assistant',
      chunks: [{ type: 'error', payload: { error: apiCallError(401) } }],
    });

    const events = await turn(ctx, 'Why?');

    // The turn goes on: tool-only synthesis answers it, and `done` follows.
    expect(events.at(-1)?.type).toBe('done');
    expect(ctx.session.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Synthesized.',
    });
  });

  it('reports an exception from agent.stream() with its own message', async () => {
    const failure = new Error('No API key configured for provider "openai"');
    const ctx = build({ kind: 'readiness', streamThrows: failure });

    await expect(turn(ctx, 'Assess it')).rejects.toBe(failure);
    expect(ctx.mastra.streamWorkflow).toHaveBeenCalledTimes(1);
  });
});
