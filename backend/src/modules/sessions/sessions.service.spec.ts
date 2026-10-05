jest.mock('@mastra/core/request-context', () => ({
  // Map-backed: the turn writes the knowledge record onto the context and
  // reads it back at persist time, so `get` has to return what `set` stored.
  RequestContext: class {
    private readonly values = new Map<string, unknown>();
    set = jest.fn((key: string, value: unknown) => {
      this.values.set(key, value);
    });
    get = jest.fn((key: string) => this.values.get(key));
  },
}));
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/tool-services', () => ({
  setDatasetToolServices: jest.fn(),
}));
jest.mock('../../mastra/tools/dataset.tools', () => ({
  DATASETS_CONTEXT_KEY: 'datasets',
}));
jest.mock('../../mastra/tools/visual.tools', () => ({
  ACTIVE_VISUAL_CONTEXT_KEY: 'active-visual',
  SESSION_ID_CONTEXT_KEY: 'session-id',
  TURN_RECORDS_CONTEXT_KEY: 'turn-records',
}));
jest.mock('../../mastra/session-workspaces', () => ({
  SESSION_WORKSPACE_CONTEXT_KEY: 'session-workspace',
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
// `marked` is ESM-only; stub the document builder so the suite runs under
// Jest's CommonJS transform.
jest.mock('./visualization-document', () => ({
  sourceEntities: jest.fn().mockReturnValue([]),
}));
// Only the tool names matter here: the allow-list that hides the lookup
// tools must keep every tool Mastra adds at execution time.
jest.mock('@mastra/core/workspace', () => ({
  WORKSPACE_TOOLS: {
    FILESYSTEM: { READ_FILE: 'mastra_workspace_read_file' },
  },
}));
jest.mock('../engine/engine-settings.service', () => ({
  EngineSettingsService: class {},
}));
jest.mock('../../mastra/model-resolver', () => ({
  agentModelId: (config: string | { id: string }) =>
    typeof config === 'string' ? config : config.id,
  lastAgentModelId: () => undefined,
  resolveAgentModel: jest.fn().mockResolvedValue('openai/gpt-4o-mini'),
}));
// The lever wiring is what this suite tests, not the heuristics behind each
// lever (their own specs cover those), so each is a controllable stub.
jest.mock('./sql-precheck', () => ({
  precheckSql: jest.fn().mockReturnValue([]),
}));
jest.mock('./sql-repair-guard', () => ({
  classifyRepair: jest.fn().mockReturnValue({ kind: 'unknown', changed: [] }),
}));
jest.mock('./answer-review', () => ({
  reviewAnswer: jest
    .fn()
    .mockResolvedValue({ review: { status: 'ok', findings: [] } }),
  reviewNudge: jest.fn(
    (findings: { code: string; detail: string }[]) =>
      `Review findings:\n${findings.map((f) => `- [${f.code}] ${f.detail}`).join('\n')}`,
  ),
}));
jest.mock('../../mastra/context-blocks', () => ({
  ...jest.requireActual('../../mastra/context-blocks'),
  schemaCardBlock: jest.fn().mockReturnValue(''),
}));

import { BadRequestException, Logger } from '@nestjs/common';
import { resolveAgentModel } from '../../mastra/model-resolver';
import { providerOptionsFor } from '../../mastra/model-compat';
import { setDatasetToolServices } from '../../mastra/tool-services';
import type { DatasetToolServices } from '../../mastra/tool-services';
import { TURN_RECORDS_CONTEXT_KEY } from '../../mastra/tools/visual.tools';
import { schemaCardBlock } from '../../mastra/context-blocks';
import { ASSISTANT_MAX_STEPS } from '../../mastra/agent-constants';
import {
  ENGINE_OPTIONS_CONTEXT_KEY,
  resolveEngineOptions,
  type EngineOptions,
} from '../engine/engine-options';
import { sourceEntities } from './visualization-document';
import { precheckSql } from './sql-precheck';
import { classifyRepair } from './sql-repair-guard';
import { reviewAnswer } from './answer-review';
import {
  SessionsService,
  StreamEvent,
  lookupValuesSql,
} from './sessions.service';
import { EMPTY_RESPONSE_FALLBACK } from './turn-data';
import type { SessionDoc } from './entities/session.entity';

/** Settings → Engine levers as the store returns them: `defaults` resolved. */
function engineSettings(defaults: Partial<EngineOptions> = {}) {
  return {
    resolved: jest.fn().mockResolvedValue(resolveEngineOptions(defaults)),
  };
}

describe('SessionsService streaming', () => {
  /** A service wired to one streamed turn, with everything else stubbed. */
  function buildStreaming(
    fullStream: AsyncGenerator<unknown>,
    options: {
      answer?: string;
      verified?: boolean;
      metricsBlock?: string;
      knowledgeBlock?: string;
      /** Snippets the curated-knowledge block was built from this turn. */
      knowledgeUsed?: {
        id: string;
        kind: string;
        title: string;
        body: string;
        datasetId?: string;
      }[];
      tables?: string[];
      /**
       * Token counts as the model stream reports them. Left undefined, the
       * stream carries neither field — a provider that reports nothing.
       */
      totalUsage?: Promise<unknown>;
      usage?: Promise<unknown>;
      /** Careful mode: what the verifier replies and what its SQL returns. */
      crossCheck?: {
        sql?: string;
        verifierFails?: boolean;
        rows?: Record<string, unknown>[];
        runFails?: boolean;
      };
      /** What Settings → Engine levers has saved (production defaults). */
      engineDefaults?: Partial<EngineOptions>;
      /** Tool names `agent.listTools()` reports; absent = the method is missing. */
      tools?: string[];
      /** The `answer-review` agent; absent = `getAgent` throws for it. */
      reviewAgent?: { generate: jest.Mock };
      /** A verified-pair block the library returns for the question. */
      verifiedBlock?: string;
      /** What `stream.text` settles to; absent = resolves to ''. */
      text?: Promise<string>;
      /** What the stream output keeps on `error` once it ends. */
      streamError?: unknown;
    } = {},
  ) {
    const session: SessionDoc = {
      id: 'session-1',
      name: 'World Cup analysis',
      datasets: ['football'],
      messages: [],
      visualizations: [],
    };
    const repository = {
      get: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockImplementation(async (_id, patch) => {
        Object.assign(session, patch);
        return session;
      }),
    };
    const agent = {
      getMemory: jest.fn().mockResolvedValue({
        getThreadById: jest.fn().mockResolvedValue({ id: session.id }),
      }),
      stream: jest.fn().mockResolvedValue({
        fullStream,
        text: options.text ?? Promise.resolve(''),
        ...(options.streamError ? { error: options.streamError } : {}),
        ...(options.totalUsage ? { totalUsage: options.totalUsage } : {}),
        ...(options.usage ? { usage: options.usage } : {}),
      }),
      generate: jest.fn().mockResolvedValue({
        text:
          options.answer ?? 'Argentina won through superior chance creation.',
      }),
      ...(options.tools
        ? {
            listTools: jest
              .fn()
              .mockResolvedValue(
                Object.fromEntries(options.tools.map((name) => [name, {}])),
              ),
          }
        : {}),
    };
    const verifiedQueries = {
      referenceBlock: jest.fn().mockResolvedValue(options.verifiedBlock),
      isVerifiedSql: jest.fn().mockResolvedValue(options.verified ?? false),
    };
    const metrics = {
      definitionBlock: jest
        .fn()
        .mockResolvedValue(options.metricsBlock ?? undefined),
      forEntities: jest.fn().mockResolvedValue([]),
      lookup: jest.fn().mockResolvedValue([]),
    };
    const knowledge = {
      definitionBlock: jest
        .fn()
        .mockResolvedValue(options.knowledgeBlock ?? ''),
      contextFor: jest.fn().mockResolvedValue({
        block: options.knowledgeBlock ?? '',
        used: options.knowledgeUsed ?? [],
      }),
      knowledgeByColumn: jest.fn().mockResolvedValue(new Map()),
      defaultFilters: jest.fn().mockResolvedValue([]),
      lookup: jest.fn().mockResolvedValue([]),
    };
    const llm = {
      getView: jest.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
      // Same bucketing the real LlmService does: by the resolved model's
      // provider (`model-compat`), so a lenai model reads `lenai`.
      providerOptionsFor: jest.fn(async (effort: string) =>
        providerOptionsFor(await resolveAgentModel(), {
          reasoningEffort: effort,
        }),
      ),
    };
    const engine = engineSettings(options.engineDefaults);
    const check = options.crossCheck ?? {};
    const verifier = {
      generate: check.verifierFails
        ? jest.fn().mockRejectedValue(new Error('verifier unavailable'))
        : jest.fn().mockResolvedValue({
            object: { sql: check.sql ?? 'SELECT count(*) FROM other.table' },
          }),
    };
    const datasources = {
      runReadOnlySql: check.runFails
        ? jest.fn().mockRejectedValue(new Error('table not found'))
        : jest
            .fn()
            .mockResolvedValue({ columns: ['n'], rows: check.rows ?? [] }),
    };
    const service = new SessionsService(
      repository as never,
      {
        getAgent: jest.fn().mockImplementation((id: string) => {
          if (id === 'sql-verifier') return verifier;
          if (id === 'answer-review') {
            if (!options.reviewAgent) {
              throw new Error('Agent with name answer-review not found');
            }
            return options.reviewAgent;
          }
          return agent;
        }),
        ensureSessionWorkspace: jest
          .fn()
          .mockResolvedValue({ id: 'workspace-1' }),
      } as never,
      {
        getByNames: jest.fn().mockResolvedValue([
          {
            name: 'football',
            datasourceId: 'ds-1',
            datasourceKind: 'databricks',
            tables: options.tables ?? [],
            entities: [
              {
                key: 'main.football.matches',
                columns: [
                  {
                    name: 'winner',
                    type: 'string',
                    nullable: true,
                    sampleValues: ['Argentina', 'France'],
                  },
                ],
              },
            ],
          },
        ]),
      } as never,
      datasources as never,
      llm as never,
      {} as never,
      verifiedQueries as never,
      metrics as never,
      knowledge as never,
      engine as never,
    );
    return {
      service,
      session,
      agent,
      verifiedQueries,
      metrics,
      knowledge,
      verifier,
      datasources,
      llm,
      engine,
    };
  }

  beforeEach(() => {
    (sourceEntities as jest.Mock).mockReturnValue([]);
    (resolveAgentModel as jest.Mock).mockResolvedValue('openai/gpt-4.1-mini');
  });

  // Mastra names an OpenAI-compatible client's provider-options bucket after
  // the provider id, so the reasoning-effort chip was a silent no-op on every
  // LenAI deployment while this key was hardcoded to `openai`.
  it('files provider options under the bucket the configured model reads', async () => {
    (resolveAgentModel as jest.Mock).mockResolvedValue({
      id: 'lenai/mmc-tech-gpt-41-mini-1m-2025-04-14',
      apiKey: 'len-key',
      url: 'https://lenai.example.com/openai/v1/deployments/x',
    });
    const { service, agent } = buildStreaming(toolOnlyStream(15));

    await service.streamMessage('session-1', 'Why did Argentina win?', () => {});

    const options = (agent.generate as jest.Mock).mock.calls.map(
      ([, opts]: [unknown, { providerOptions?: unknown }]) =>
        opts?.providerOptions,
    );
    expect(options).not.toHaveLength(0);
    for (const providerOptions of options) {
      expect(providerOptions).toEqual({
        lenai: { reasoningEffort: 'medium' },
      });
    }
  });

  it('synthesizes a final answer after a tool-only turn', async () => {
    const { service, session, agent } = buildStreaming(toolOnlyStream(15));
    const events: StreamEvent[] = [];

    await service.streamMessage(
      'session-1',
      'Why did Argentina win?',
      (event) => events.push(event),
    );

    expect(agent.generate).toHaveBeenCalledWith(
      expect.stringContaining('Why did Argentina win?'),
      expect.objectContaining({ maxSteps: 1, toolChoice: 'none' }),
    );
    expect(session.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: 'Argentina won through superior chance creation.',
      }),
    );
    expect(events.at(-1)).toEqual({ type: 'done', session });
  });

  describe('provider errors', () => {
    /** What the AI SDK throws — and Mastra sends as `payload.error` — for an exhausted OpenAI balance. */
    function quotaError(): Error {
      const body = {
        error: {
          message: 'You have no credits remaining. Add credits to continue.',
          type: 'insufficient_quota',
          param: null,
          code: 'insufficient_quota',
        },
      };
      return Object.assign(
        new Error('You have no credits remaining. Add credits to continue.'),
        {
          name: 'AI_APICallError',
          statusCode: 429,
          isRetryable: true,
          url: 'https://api.openai.com/v1/responses',
          responseBody: JSON.stringify(body),
          data: body,
        },
      );
    }

    /** The error chunk exactly as `agent.stream`'s fullStream emits it. */
    function errorChunk(error: unknown) {
      return {
        type: 'error',
        runId: 'run-1',
        from: 'AGENT',
        payload: { error },
      };
    }

    /** A rejection that is already handled, so Node never reports it. */
    function rejected(error: Error): Promise<string> {
      const promise = Promise.reject(error);
      promise.catch(() => undefined);
      return promise;
    }

    it('ends a turn the provider refused with an honest message, running no side pass', async () => {
      const error = quotaError();
      async function* refused() {
        yield errorChunk(error);
      }
      const { service, session, agent } = buildStreaming(refused(), {
        text: rejected(error),
      });
      const events: StreamEvent[] = [];

      const result = await service.runTurn('session-1', 'How many matches?', {
        emit: (event) => events.push(event),
      });

      expect(result.providerError).toEqual({
        kind: 'quota',
        statusCode: 429,
        message: 'You have no credits remaining. Add credits to continue.',
      });
      expect(result.text).toContain('no API credits remaining');
      expect(result.text).toContain('No analysis was run.');
      expect(result.text).not.toBe(EMPTY_RESPONSE_FALLBACK);
      // Neither tool-only synthesis nor the zero-tool grounding guard ran:
      // both would have called the same exhausted provider.
      expect(agent.generate).not.toHaveBeenCalled();
      expect(session.messages.at(-1)).toEqual(
        expect.objectContaining({
          role: 'assistant',
          content: result.text,
          providerError: result.providerError,
        }),
      );
      expect(events).toContainEqual({ type: 'text', content: result.text });
      expect(events.at(-1)).toEqual({ type: 'done', session });
      expect(result.aborted).toBe(false);
    });

    it('skips the answer review and careful mode too, and says the analysis stopped', async () => {
      (reviewAnswer as jest.Mock).mockClear();
      const error = quotaError();
      async function* partway() {
        yield* toolOnlyStream(1);
        yield errorChunk(error);
      }
      const reviewAgent = { generate: jest.fn() };
      const { service, session, agent, verifier, verifiedQueries } =
        buildStreaming(partway(), {
          text: rejected(error),
          reviewAgent,
          verified: true,
        });

      const result = await service.runTurn('session-1', 'How many?', {
        engine: { careful: 'on', answerReview: true },
      });

      expect(result.providerError?.kind).toBe('quota');
      expect(result.text).toContain(
        'The analysis stopped before an answer was written.',
      );
      expect(agent.generate).not.toHaveBeenCalled();
      expect(reviewAnswer).not.toHaveBeenCalled();
      expect(reviewAgent.generate).not.toHaveBeenCalled();
      expect(verifier.generate).not.toHaveBeenCalled();
      expect(verifiedQueries.isVerifiedSql).not.toHaveBeenCalled();
      expect(result.crossCheck).toBeUndefined();
      expect(result.review).toBeUndefined();
      // The query that did run is still on the record.
      expect(result.data).toHaveLength(1);
      const persisted = session.messages.at(-1);
      expect(persisted?.content).toBe(result.text);
      expect(persisted?.verified).toBeUndefined();
      expect(persisted?.interpretation).toBeUndefined();
    });

    it('reads the error off a rejected `text` when no chunk carried it', async () => {
      const { service, agent } = buildStreaming(answerStreamWithoutText(), {
        text: rejected(
          Object.assign(new Error('Cannot connect to API: read ECONNRESET'), {
            name: 'AI_APICallError',
            cause: Object.assign(new Error('read ECONNRESET'), {
              code: 'ECONNRESET',
            }),
          }),
        ),
      });

      const result = await service.runTurn('session-1', 'Why?');

      expect(result.providerError).toEqual({
        kind: 'network',
        message: 'Cannot connect to API: read ECONNRESET',
      });
      expect(result.text).toContain(
        'Could not reach the language model provider',
      );
      expect(agent.generate).not.toHaveBeenCalled();
    });

    it('reads the error the stream output kept when `text` resolved empty', async () => {
      const { service } = buildStreaming(answerStreamWithoutText(), {
        streamError: new Error('HTTP/2: "headers timeout after 300000"'),
      });

      const result = await service.runTurn('session-1', 'Why?');

      expect(result.providerError?.kind).toBe('timeout');
      expect(result.text).toContain('did not respond in time');
    });

    it('treats a provider failure thrown out of the stream the same way', async () => {
      async function* throws(): AsyncGenerator<unknown> {
        yield* [];
        throw quotaError();
      }
      const { service, agent } = buildStreaming(throws());

      const result = await service.runTurn('session-1', 'How many?');

      expect(result.providerError?.kind).toBe('quota');
      expect(result.text).toContain('no API credits remaining');
      expect(agent.generate).not.toHaveBeenCalled();
    });

    it('still throws an error that is not the provider’s', async () => {
      async function* broken(): AsyncGenerator<unknown> {
        yield* [];
        throw new TypeError(
          "Cannot read properties of undefined (reading 'x')",
        );
      }
      const { service } = buildStreaming(broken());

      await expect(service.runTurn('session-1', 'How many?')).rejects.toThrow(
        TypeError,
      );
    });

    it('keeps text that was streamed before the provider failed, and flags the turn', async () => {
      async function* cut() {
        yield* answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]);
        yield errorChunk(new Error('Cannot connect to API: read ECONNRESET'));
      }
      const { service, session } = buildStreaming(cut());

      const result = await service.runTurn('session-1', 'How many?');

      expect(result.text).toBe('Here is the answer.');
      expect(result.providerError?.kind).toBe('network');
      expect(session.messages.at(-1)).toEqual(
        expect.objectContaining({
          content: 'Here is the answer.',
          providerError: result.providerError,
        }),
      );
    });

    it('keeps the empty-response fallback for a tool-only turn the provider did not fail', async () => {
      const { service, agent } = buildStreaming(toolOnlyStream(1), {
        answer: '',
      });

      const result = await service.runTurn('session-1', 'How many?');

      expect(agent.generate).toHaveBeenCalledTimes(1);
      expect(result.text).toBe(EMPTY_RESPONSE_FALLBACK);
      expect(result.providerError).toBeUndefined();
    });
  });

  describe('token accounting', () => {
    // Measured, never estimated: the harness reads these off the persisted
    // answer, so what the provider reported has to survive the turn.
    it("records the provider's token counts on the answer", async () => {
      const { service, session } = buildStreaming(
        answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
        {
          totalUsage: Promise.resolve({
            inputTokens: 1200,
            outputTokens: 340,
            totalTokens: 1540,
            reasoningTokens: 64,
          }),
        },
      );

      await service.streamMessage('session-1', 'Why?', () => {});

      expect(session.messages.at(-1)?.usage).toEqual({
        inputTokens: 1200,
        outputTokens: 340,
        totalTokens: 1540,
        reasoningTokens: 64,
        cachedInputTokens: 0,
        calls: 1,
      });
    });

    it('falls back to per-step usage when no total is reported', async () => {
      const { service, session } = buildStreaming(
        answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
        {
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve({ promptTokens: 10, completionTokens: 5 }),
        },
      );

      await service.streamMessage('session-1', 'Why?', () => {});

      expect(session.messages.at(-1)?.usage).toEqual(
        expect.objectContaining({ inputTokens: 10, outputTokens: 5, calls: 1 }),
      );
    });

    it('leaves usage off — not zeroed — when the provider reports nothing', async () => {
      const { service, session } = buildStreaming(
        answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
        {
          totalUsage: Promise.reject(new Error('no usage for this deployment')),
        },
      );

      await service.streamMessage('session-1', 'Why?', () => {});

      expect(session.messages.at(-1)).toEqual(
        expect.objectContaining({ role: 'assistant' }),
      );
      expect(session.messages.at(-1)?.usage).toBeUndefined();
    });
  });

  it('builds the interpretation line from the queries that ran', async () => {
    (sourceEntities as jest.Mock).mockReturnValue(['main.football.matches']);
    const { service, session } = buildStreaming(
      answerStream([
        { sql: 'select 1', rows: [{ n: 1 }, { n: 2 }] },
        { sql: 'select 2', rows: [{ n: 3 }] },
      ]),
    );

    await service.streamMessage('session-1', 'Why?', () => {});

    expect(session.messages.at(-1)?.interpretation).toBe(
      'Computed from 2 queries over main.football.matches — 3 rows analyzed.',
    );
  });

  it('records the curated knowledge the turn was given on the answer', async () => {
    const used = [
      {
        id: 'k1',
        kind: 'default_filter',
        title: 'Exclude test rows',
        body: 'Add is_test = false unless asked otherwise.',
        datasetId: 'football',
      },
    ];
    const { service, session } = buildStreaming(
      answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
      { knowledgeBlock: 'Curated dataset knowledge', knowledgeUsed: used },
    );

    await service.streamMessage('session-1', 'Why?', () => {});

    expect(session.messages.at(-1)?.knowledge).toEqual(used);
  });

  it('omits the knowledge record when no snippet applied', async () => {
    const { service, session } = buildStreaming(
      answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
    );

    await service.streamMessage('session-1', 'Why?', () => {});

    expect(session.messages.at(-1)?.knowledge).toBeUndefined();
  });

  it('omits the interpretation line when no SQL ran', async () => {
    const { service, session } = buildStreaming(answerStream([]));

    await service.streamMessage('session-1', 'Hello', () => {});

    expect(session.messages.at(-1)?.interpretation).toBeUndefined();
  });

  it('flags the answer verified when its final SQL matches the library', async () => {
    const { service, session, verifiedQueries } = buildStreaming(
      answerStream([
        { sql: 'select 1', rows: [{ n: 1 }] },
        { sql: 'select 2', rows: [{ n: 2 }] },
      ]),
      { verified: true },
    );

    await service.streamMessage('session-1', 'Why?', () => {});

    expect(verifiedQueries.isVerifiedSql).toHaveBeenCalledWith(
      'select 2',
      'ds-1',
    );
    expect(session.messages.at(-1)?.verified).toBe(true);
  });

  it('leaves the answer unverified when nothing matches', async () => {
    const { service, session } = buildStreaming(
      answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
    );

    await service.streamMessage('session-1', 'Why?', () => {});

    expect(session.messages.at(-1)?.verified).toBeUndefined();
  });

  it('grounds the turn in the curated metrics for the dataset entities', async () => {
    const { service, agent, metrics } = buildStreaming(answerStream([]), {
      tables: ['main.football.matches', 'main.football.players'],
      metricsBlock: 'Governed metric definitions (curated — …):\n- Win rate',
    });

    await service.streamMessage('session-1', 'Win rate?', () => {});

    expect(metrics.definitionBlock).toHaveBeenCalledWith(
      ['main.football.matches', 'main.football.players'],
      { question: 'Win rate?', ranked: false },
    );
    const options = (agent.stream.mock.calls as unknown[][])[0][1] as {
      context: { content: string }[];
    };
    expect(
      options.context.some((block) =>
        block.content.includes('Governed metric definitions'),
      ),
    ).toBe(true);
  });

  it('omits the metrics block when no curated metric covers the session', async () => {
    const { service, agent } = buildStreaming(answerStream([]));

    await service.streamMessage('session-1', 'Why?', () => {});

    const options = (agent.stream.mock.calls as unknown[][])[0][1] as {
      context: { content: string }[];
    };
    expect(
      options.context.some((block) =>
        block.content.includes('Governed metric definitions'),
      ),
    ).toBe(false);
  });

  it('keeps the data collected before a clarification on the card', async () => {
    (sourceEntities as jest.Mock).mockReturnValue(['main.football.matches']);
    const { service, session } = buildStreaming(clarificationStream());

    await service.streamMessage('session-1', 'Which team?', () => {});

    const message = session.messages.at(-1)!;
    expect(message.clarification?.question).toBe('Which season?');
    expect(message.data).toEqual([
      expect.objectContaining({ tool: 'run_readonly_sql', input: 'select 1' }),
    ]);
    expect(message.entities).toEqual(['main.football.matches']);
  });

  it('marks a record truncated when storage keeps fewer rows than returned', async () => {
    const rows = Array.from({ length: 250 }, (_, n) => ({ n }));
    const { service, session } = buildStreaming(
      answerStream([{ sql: 'select *', rows }]),
    );

    await service.streamMessage('session-1', 'Everything?', () => {});

    const record = session.messages.at(-1)?.data?.[0];
    expect(record?.truncated).toBe(true);
    expect(record?.rowCount).toBe(250);
    expect(record?.rows).toHaveLength(200);
  });

  it('carries the bridge truncation flag onto the stored record', async () => {
    const { service, session } = buildStreaming(
      answerStream([{ sql: 'select *', rows: [{ n: 1 }], truncated: true }]),
    );

    await service.streamMessage('session-1', 'Everything?', () => {});

    expect(session.messages.at(-1)?.data?.[0]?.truncated).toBe(true);
  });

  describe('reasoning trail', () => {
    const FIRST = 'There is no cost-per-member column, so I check how claims';
    const SECOND = 'Now I total spend and divide it across the members found.';

    it('keeps each stated reason on its record and trails them in order', async () => {
      const { service, session } = buildStreaming(
        answerStream([
          { sql: 'select 1', rows: [{ n: 1 }], rationale: `  ${FIRST}  ` },
          { sql: 'select 2', rows: [{ n: 2 }, { n: 3 }], rationale: SECOND },
        ]),
      );

      await service.streamMessage('session-1', 'Cost per member?', () => {});

      const message = session.messages.at(-1)!;
      expect(message.data?.map((record) => record.rationale)).toEqual([
        FIRST,
        SECOND,
      ]);
      expect(message.reasoning).toEqual([
        {
          step: 1,
          rationale: FIRST,
          tool: 'run_readonly_sql',
          input: 'select 1',
          rowCount: 1,
        },
        {
          step: 2,
          rationale: SECOND,
          tool: 'run_readonly_sql',
          input: 'select 2',
          rowCount: 2,
        },
      ]);
    });

    it('keeps the reason on a step whose query failed', async () => {
      const { service, session } = buildStreaming(
        answerStream([
          {
            sql: 'select bad',
            error: 'Column bad cannot be resolved',
            rationale: FIRST,
          },
          { sql: 'select 2', rows: [{ n: 2 }], rationale: SECOND },
        ]),
      );

      await service.streamMessage('session-1', 'Cost per member?', () => {});

      const message = session.messages.at(-1)!;
      expect(message.data?.[0]).toEqual(
        expect.objectContaining({
          error: 'Column bad cannot be resolved',
          rationale: FIRST,
        }),
      );
      expect(message.reasoning).toEqual([
        {
          step: 1,
          rationale: FIRST,
          tool: 'run_readonly_sql',
          input: 'select bad',
          error: 'Column bad cannot be resolved',
        },
        {
          step: 2,
          rationale: SECOND,
          tool: 'run_readonly_sql',
          input: 'select 2',
          rowCount: 1,
        },
      ]);
    });

    it('omits the trail when no call explained itself', async () => {
      const { service, session } = buildStreaming(
        answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
      );

      await service.streamMessage('session-1', 'Why?', () => {});

      expect(session.messages.at(-1)?.data).toHaveLength(1);
      expect(session.messages.at(-1)?.reasoning).toBeUndefined();
    });

    it('keeps the reasoning done before a clarification on the card', async () => {
      const { service, session } = buildStreaming(clarificationStream());

      await service.streamMessage('session-1', 'Which team?', () => {});

      expect(session.messages.at(-1)?.reasoning).toEqual([
        {
          step: 1,
          rationale: 'I check which seasons the data covers before narrowing.',
          tool: 'run_readonly_sql',
          input: 'select 1',
          rowCount: 1,
        },
      ]);
    });

    it('streams the reason with the call and again with its result', async () => {
      const { service } = buildStreaming(
        answerStream([{ sql: 'select 1', rows: [{ n: 1 }], rationale: FIRST }]),
      );
      const events: StreamEvent[] = [];

      await service.streamMessage('session-1', 'Why?', (event) =>
        events.push(event),
      );

      const call = events.find((event) => event.type === 'tool');
      expect(JSON.parse(call!.content!)).toEqual({
        name: 'run_readonly_sql',
        rationale: FIRST,
      });
      const result = events.find((event) => event.type === 'tool-result');
      expect(JSON.parse(result!.content!)).toEqual(
        expect.objectContaining({ rationale: FIRST }),
      );
    });
  });

  describe('turn records exposed to the visual tools', () => {
    it('hands the visual tools a live reference to the records captured so far in the turn', async () => {
      const { service, session, agent } = buildStreaming(
        answerStream([{ sql: 'select stage_1', rows: [{ stage: 1, n: 10 }] }]),
      );

      await service.streamMessage(
        'session-1',
        'Drill into stage 1 and tailor the chart',
        () => {},
      );

      // The same RequestContext instance handed to agent.stream() carries a
      // key the tools read (see mastra/tools/visual.tools.ts) — its value is
      // a live array, not a snapshot, so a create_visual/update_visual call
      // made later in the same turn sees every record gathered up to then.
      const options = (agent.stream.mock.calls as unknown[][])[0][1] as {
        requestContext: { set: jest.Mock };
      };
      const setCalls = options.requestContext.set.mock.calls as [
        string,
        unknown,
      ][];
      const call = setCalls.find(([key]) => key === TURN_RECORDS_CONTEXT_KEY);
      expect(call).toBeDefined();
      const turnRecords = call![1] as unknown[];

      // Same object, not a copy: it is the very array the answer's `data`
      // field ends up holding once the turn finishes.
      expect(turnRecords).toBe(session.messages.at(-1)?.data);
      expect(turnRecords).toEqual([
        expect.objectContaining({
          tool: 'run_readonly_sql',
          input: 'select stage_1',
        }),
      ]);
    });

    it('gives every turn its own empty array up front, before any tool has run', async () => {
      const { service, agent } = buildStreaming(answerStream([]));

      await service.streamMessage('session-1', 'Hello', () => {});

      const options = (agent.stream.mock.calls as unknown[][])[0][1] as {
        requestContext: { set: jest.Mock };
      };
      const setCalls = options.requestContext.set.mock.calls as [
        string,
        unknown,
      ][];
      const call = setCalls.find(([key]) => key === TURN_RECORDS_CONTEXT_KEY);
      // Set before agent.stream() is called, so it exists throughout the run
      // even for a turn that never calls a data-gathering tool.
      expect(call?.[1]).toEqual([]);
    });
  });

  describe('careful mode cross-check', () => {
    const PRIMARY = 'SELECT count(*) AS n FROM main.football.matches';

    /** One careful turn whose answer ran `PRIMARY` and returned one row. */
    function carefulTurn(
      crossCheck: {
        sql?: string;
        verifierFails?: boolean;
        rows?: Record<string, unknown>[];
        runFails?: boolean;
      },
      primary: { rows?: Record<string, unknown>[]; truncated?: boolean } = {},
    ) {
      return buildStreaming(
        answerStream([
          {
            sql: PRIMARY,
            rows: primary.rows ?? [{ n: 64 }],
            truncated: primary.truncated,
          },
        ]),
        { crossCheck, tables: ['main.football.matches'] },
      );
    }

    const run = (service: SessionsService, careful: boolean) =>
      service.streamMessage(
        'session-1',
        'How many matches were played?',
        () => {},
        undefined,
        undefined,
        careful,
      );

    it('does not cross-check a turn that was not flagged careful', async () => {
      const { service, session, verifier, datasources } = carefulTurn({});

      await run(service, false);

      expect(verifier.generate).not.toHaveBeenCalled();
      expect(datasources.runReadOnlySql).not.toHaveBeenCalled();
      expect(session.messages.at(-1)?.crossCheck).toBeUndefined();
    });

    it('agrees when the independent query returns the same results', async () => {
      const { service, session, verifier, datasources } = carefulTurn({
        sql: 'SELECT COUNT(1) AS total FROM main.football.matches',
        // Same fact, different column name and cell typing.
        rows: [{ total: '64' }],
      });

      await run(service, true);

      expect(datasources.runReadOnlySql).toHaveBeenCalledWith(
        'ds-1',
        'SELECT COUNT(1) AS total FROM main.football.matches',
        200,
      );
      expect(session.messages.at(-1)?.crossCheck).toEqual({
        status: 'agree',
        note: 'independent re-derivation returned the same results',
      });
      // Independence: the verifier sees the question and the schema with its
      // sample values, never the statement the analysis agent ran.
      const prompt = (
        verifier.generate.mock.calls as unknown[][]
      )[0][0] as string;
      expect(prompt).toContain('How many matches were played?');
      expect(prompt).toContain(
        'main.football.matches(winner string [e.g. Argentina, France])',
      );
      expect(prompt).toContain('Dialect: databricks');
      expect(prompt).not.toContain(PRIMARY);
    });

    it('disagrees when the independent query returns something else', async () => {
      const { service, session } = carefulTurn({ rows: [{ total: 63 }] });

      await run(service, true);

      const crossCheck = session.messages.at(-1)?.crossCheck;
      expect(crossCheck?.status).toBe('disagree');
      expect(crossCheck?.note).toContain('results differ — treat with care');
    });

    it('reports an error when the verifier cannot produce a query', async () => {
      const { service, session, datasources } = carefulTurn({
        verifierFails: true,
      });

      await run(service, true);

      expect(datasources.runReadOnlySql).not.toHaveBeenCalled();
      const crossCheck = session.messages.at(-1)?.crossCheck;
      expect(crossCheck?.status).toBe('error');
      expect(crossCheck?.note).toContain('verifier unavailable');
    });

    it('reports an error when the independent query fails to run', async () => {
      const { service, session } = carefulTurn({ runFails: true });

      await run(service, true);

      const crossCheck = session.messages.at(-1)?.crossCheck;
      expect(crossCheck?.status).toBe('error');
      expect(crossCheck?.note).toContain('table not found');
    });

    it('refuses to compare against a truncated result set', async () => {
      const { service, session, verifier } = carefulTurn(
        {},
        { truncated: true },
      );

      await run(service, true);

      expect(verifier.generate).not.toHaveBeenCalled();
      const crossCheck = session.messages.at(-1)?.crossCheck;
      expect(crossCheck?.status).toBe('error');
      expect(crossCheck?.note).toContain('row cap');
    });

    it('skips the cross-check when the turn ran no SQL', async () => {
      const { service, session, verifier } = buildStreaming(answerStream([]), {
        crossCheck: {},
      });

      await run(service, true);

      expect(verifier.generate).not.toHaveBeenCalled();
      expect(session.messages.at(-1)?.crossCheck).toBeUndefined();
    });
  });

  describe('zero-SQL-turn grounding guard', () => {
    it('runs one corrective pass and persists its answer when the turn made zero tool calls', async () => {
      const { service, session, agent } = buildStreaming(answerStream([]), {
        answer: 'According to the data, France won the 2022 tournament.',
      });

      await service.streamMessage(
        'session-1',
        'Who won the 2022 World Cup?',
        () => {},
      );

      expect(agent.generate).toHaveBeenCalledTimes(1);
      const [correctiveInput, correctiveOptions] = (
        agent.generate.mock.calls as unknown[][]
      )[0] as [string, Record<string, unknown>];
      // Original question, not the streamed (ungrounded) answer.
      expect(correctiveInput).toBe('Who won the 2022 World Cup?');
      // Memory-free — see the comment on `runGroundingGuard`.
      expect(correctiveOptions).not.toHaveProperty('memory');
      expect(
        (correctiveOptions.context as { content: string }[]).some((block) =>
          block.content.includes('Grounding check'),
        ),
      ).toBe(true);
      expect(session.messages.at(-1)?.content).toBe(
        'According to the data, France won the 2022 tournament.',
      );
    });

    it('does not run the guard when the turn already called a tool', async () => {
      const { service, agent } = buildStreaming(
        answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
      );

      await service.streamMessage('session-1', 'Why?', () => {});

      expect(agent.generate).not.toHaveBeenCalled();
    });

    it('keeps the original answer when the corrective pass fails', async () => {
      const { service, session, agent } = buildStreaming(answerStream([]));
      agent.generate.mockRejectedValueOnce(new Error('provider unavailable'));

      await service.streamMessage(
        'session-1',
        'Who won the 2022 World Cup?',
        () => {},
      );

      expect(agent.generate).toHaveBeenCalledTimes(1);
      expect(session.messages.at(-1)?.content).toBe('Here is the answer.');
    });

    it('skips the guard on a clarification turn', async () => {
      const { service, agent } = buildStreaming(clarificationStream());

      await service.streamMessage('session-1', 'Which team?', () => {});

      expect(agent.generate).not.toHaveBeenCalled();
    });
  });

  describe('mid-turn errors', () => {
    /**
     * A real (non-abort) failure — a provider error, a dead connection, a
     * rejected proxy request — must propagate instead of being swallowed, so
     * the controller's catch can turn it into the SSE `error` event the chat
     * renders. Nothing else gets appended to the transcript: the user's
     * question (persisted before the agent ran) stays the last message,
     * which is what lets a retry reuse it — see `appendUserMessage` — instead
     * of the transcript accumulating duplicate questions.
     */
    it('propagates the provider failure and leaves the transcript retry-safe', async () => {
      const { service, session } = buildStreaming(
        failingStream(new Error('Provider request failed (404) — Resource not found')),
      );

      await expect(
        service.streamMessage('session-1', 'Why did Argentina win?', () => {}),
      ).rejects.toThrow('Provider request failed (404)');

      expect(session.messages).toHaveLength(1);
      expect(session.messages[0]).toMatchObject({
        role: 'user',
        content: 'Why did Argentina win?',
      });
    });
  });

  describe('engine levers in the production turn', () => {
    const METRICS = 'Governed metric definitions (curated):\n- Win rate';
    const KNOWLEDGE = 'Curated dataset knowledge:\n- Exclude friendlies';
    const VERIFIED = 'Verified reference queries:\n- Q: wins → SELECT 1';
    const ORIENTATION = [
      'Datasets for this session: football.',
      'Entities available (fully-qualified catalog.schema.table):',
      '- main.football.matches (dataset: football; datasource: databricks ds-1)',
      'Use describe_entity / sample_rows / run_readonly_sql to inspect and query them.',
    ];
    const VISUALS = [
      'Interactive visuals in this session (id — title, current version):',
      '(none yet)',
      'No visual is open in the right panel.',
    ];
    const system = (content: string) => ({ role: 'system', content });
    type CallOptions = {
      context: { role: string; content: string }[];
      activeTools?: string[];
      requestContext: { get(key: string): unknown };
      [key: string]: unknown;
    };
    const streamOptions = (agent: { stream: jest.Mock }) =>
      (agent.stream.mock.calls as unknown[][])[0][1] as CallOptions;
    const curated = {
      tables: ['main.football.matches'],
      metricsBlock: METRICS,
      knowledgeBlock: KNOWLEDGE,
      verifiedBlock: VERIFIED,
      knowledgeUsed: [
        { id: 'k1', kind: 'instruction', title: 'Friendlies', body: 'Exclude' },
      ],
    };

    beforeEach(() => {
      (schemaCardBlock as jest.Mock).mockReset();
      (schemaCardBlock as jest.Mock).mockReturnValue('');
      (reviewAnswer as jest.Mock).mockReset();
      (reviewAnswer as jest.Mock).mockResolvedValue({
        review: { status: 'ok', findings: [] },
      });
    });

    it('keeps every system block and call option of the pre-lever turn with the defaults', async () => {
      const { service, agent, session, metrics, knowledge } = buildStreaming(
        answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
        // Registered tools without a lookup tool: nothing to hide.
        { ...curated, tools: ['list_entities', 'run_readonly_sql'] },
      );

      await service.streamMessage('session-1', 'Who wins most?', () => {});

      const options = streamOptions(agent);
      expect(Object.keys(options).sort()).toEqual([
        'abortSignal',
        'context',
        'maxSteps',
        'memory',
        'providerOptions',
        'requestContext',
      ]);
      expect(options.maxSteps).toBe(ASSISTANT_MAX_STEPS);
      expect(options.providerOptions).toEqual({
        openai: { reasoningEffort: 'medium' },
      });
      expect(options.memory).toEqual({
        thread: 'session-1',
        resource: 'session-1',
      });
      expect(options.context).toEqual([
        system([...ORIENTATION, '', ...VISUALS].join('\n')),
        system(METRICS),
        system(KNOWLEDGE),
        system(VERIFIED),
      ]);
      expect(options.requestContext.get(ENGINE_OPTIONS_CONTEXT_KEY)).toEqual(
        resolveEngineOptions(),
      );
      expect(schemaCardBlock).not.toHaveBeenCalled();
      expect(knowledge.knowledgeByColumn).not.toHaveBeenCalled();
      expect(metrics.definitionBlock).toHaveBeenCalledWith(
        ['main.football.matches'],
        { question: 'Who wins most?', ranked: false },
      );
      expect(knowledge.contextFor).toHaveBeenCalledWith(['football'], {
        question: 'Who wins most?',
        entities: ['main.football.matches'],
        ranked: false,
      });
      // An ordinary chat answer carries no engine stamp and no review.
      const message = session.messages.at(-1)!;
      expect(message).not.toHaveProperty('engine');
      expect(message).not.toHaveProperty('review');
    });

    it('drops every curated block in the bare arm and stamps the arm', async () => {
      const { service, agent, session, metrics, knowledge, verifiedQueries } =
        buildStreaming(answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]), {
          ...curated,
        });

      const result = await service.runTurn('session-1', 'Who wins most?', {
        engine: { context: 'bare' },
        arm: 'bare',
      });

      expect(streamOptions(agent).context).toEqual([
        system([...ORIENTATION, '', ...VISUALS].join('\n')),
      ]);
      expect(metrics.definitionBlock).not.toHaveBeenCalled();
      expect(knowledge.contextFor).not.toHaveBeenCalled();
      expect(verifiedQueries.referenceBlock).not.toHaveBeenCalled();
      const message = session.messages.at(-1)!;
      expect(message.knowledge).toBeUndefined();
      expect(message.engine).toEqual({
        hash: result.configHash,
        careful: 'off',
        answerReview: false,
        arm: 'bare',
      });
    });

    it('puts the static blocks first and the per-turn ones last when staticFirstContext is on', async () => {
      (schemaCardBlock as jest.Mock).mockReturnValue('SCHEMA CARDS');
      const { service, agent } = buildStreaming(answerStream([]), {
        ...curated,
        engineDefaults: { staticFirstContext: true, columnProfiles: true },
      });

      await service.streamMessage('session-1', 'Who wins most?', () => {});

      expect(streamOptions(agent).context).toEqual([
        system(ORIENTATION.join('\n')),
        system('SCHEMA CARDS'),
        system(METRICS),
        system(KNOWLEDGE),
        system(VERIFIED),
        system(VISUALS.join('\n')),
      ]);
    });

    it('adds the schema cards right after orientation, with knowledge inline when asked', async () => {
      (schemaCardBlock as jest.Mock).mockReturnValue('SCHEMA CARDS');
      const byColumn = new Map([
        [
          'main.football.matches.winner',
          [{ kind: 'term', title: 'W', body: 'b' }],
        ],
      ]);
      const { service, agent, knowledge } = buildStreaming(answerStream([]), {
        ...curated,
      });
      knowledge.knowledgeByColumn.mockResolvedValue(byColumn);

      await service.runTurn('session-1', 'Who wins most?', {
        engine: { columnProfiles: true, inlineKnowledge: true },
      });

      const context = streamOptions(agent).context;
      expect(context[1]).toEqual(system('SCHEMA CARDS'));
      expect(context).toHaveLength(5);
      expect(schemaCardBlock).toHaveBeenCalledWith(
        [expect.objectContaining({ name: 'football' })],
        { knowledgeByColumn: byColumn },
      );
    });

    it('renders the cards without knowledge when inline knowledge is off or the arm is bare', async () => {
      (schemaCardBlock as jest.Mock).mockReturnValue('SCHEMA CARDS');
      const { service, agent, knowledge } = buildStreaming(answerStream([]), {
        ...curated,
      });

      await service.runTurn('session-1', 'Who wins most?', {
        engine: {
          columnProfiles: true,
          inlineKnowledge: true,
          context: 'bare',
        },
      });

      expect(knowledge.knowledgeByColumn).not.toHaveBeenCalled();
      expect(schemaCardBlock).toHaveBeenCalledWith(expect.any(Array), {
        knowledgeByColumn: undefined,
      });
      expect(streamOptions(agent).context.map((b) => b.content)).toEqual([
        [...ORIENTATION, '', ...VISUALS].join('\n'),
        'SCHEMA CARDS',
      ]);
    });

    it('keeps the side-pass call options of the pre-lever turn with the defaults', async () => {
      const { service, agent, verifier } = buildStreaming(toolOnlyStream(1), {
        tables: ['main.football.matches'],
      });

      await service.streamMessage(
        'session-1',
        'How many?',
        () => {},
        undefined,
        undefined,
        true,
      );

      // Tool-only synthesis, then careful mode's verifier.
      expect((agent.generate.mock.calls as unknown[][])[0][1]).toEqual({
        instructions:
          'You are a data analyst writing the final answer from completed query results.',
        maxSteps: 1,
        toolChoice: 'none',
        abortSignal: expect.any(AbortSignal),
        providerOptions: { openai: { reasoningEffort: 'medium' } },
      });
      expect((verifier.generate.mock.calls as unknown[][])[0][1]).toEqual({
        maxSteps: 1,
        toolChoice: 'none',
        providerOptions: { openai: { reasoningEffort: 'medium' } },
        structuredOutput: {
          schema: expect.anything(),
          jsonPromptInjection: 'inline',
        },
      });
    });

    it('overrides reasoning effort and the step budget per turn', async () => {
      const { service, agent, llm } = buildStreaming(answerStream([]));

      const result = await service.runTurn('session-1', 'Hi', {
        engine: { reasoningEffort: 'low', maxSteps: 4 },
      });

      const options = streamOptions(agent);
      expect(options.maxSteps).toBe(4);
      expect(options.providerOptions).toEqual({
        openai: { reasoningEffort: 'low' },
      });
      expect(llm.providerOptionsFor).toHaveBeenCalledWith('low');
      expect(result.engine.reasoningEffort).toBe('low');
    });

    describe('lookup tools', () => {
      const registered = [
        'list_entities',
        'run_readonly_sql',
        'lookup_values',
        'lookup_knowledge',
      ];

      it('hides them with activeTools, keeping the execution-time tools', async () => {
        const { service, agent } = buildStreaming(answerStream([]), {
          tools: registered,
        });

        await service.streamMessage('session-1', 'Hi', () => {});

        expect(streamOptions(agent).activeTools).toEqual([
          'list_entities',
          'run_readonly_sql',
          'mastra_workspace_read_file',
          'skill',
          'skill_search',
          'skill_read',
        ]);
      });

      it('passes no activeTools when the lever is on', async () => {
        const { service, agent } = buildStreaming(answerStream([]), {
          tools: registered,
        });

        await service.runTurn('session-1', 'Hi', {
          engine: { lookupTools: true },
        });

        expect(streamOptions(agent)).not.toHaveProperty('activeTools');
      });
    });

    describe('careful: auto', () => {
      const turn = (
        runs: Parameters<typeof answerStream>[0],
        category?: string,
      ) => {
        const built = buildStreaming(answerStream(runs), {
          tables: ['main.football.matches'],
          crossCheck: { rows: [{ n: 1 }] },
        });
        return {
          ...built,
          run: () =>
            built.service.runTurn('session-1', 'How many?', {
              engine: { careful: 'auto' },
              category,
            }),
        };
      };

      it('cross-checks a risky category', async () => {
        const { run, verifier, session } = turn(
          [{ sql: 'select 1', rows: [{ n: 1 }] }],
          'ratio-trap',
        );

        const result = await run();

        expect(verifier.generate).toHaveBeenCalledTimes(1);
        expect(result.crossCheck?.status).toBe('agree');
        expect(session.messages.at(-1)?.crossCheck?.status).toBe('agree');
      });

      it('cross-checks a turn whose SQL drew a guard warning', async () => {
        const { run, verifier } = turn(
          [
            {
              sql: 'select 1',
              rows: [{ n: 1 }],
              warnings: ['The ratio divides a sum by itself'],
            },
          ],
          'control',
        );

        await run();

        expect(verifier.generate).toHaveBeenCalledTimes(1);
      });

      it('cross-checks a turn whose fixer changed what the query asks', async () => {
        const { run, verifier } = turn([
          {
            sql: 'select 1',
            rows: [{ n: 1 }],
            repairs: [
              {
                original: 'select x',
                repaired: 'select 1',
                error: 'boom',
                kind: 'semantic',
              },
            ],
          },
        ]);

        await run();

        expect(verifier.generate).toHaveBeenCalledTimes(1);
      });

      it('leaves an unremarkable turn alone', async () => {
        const { run, verifier } = turn(
          [{ sql: 'select 1', rows: [{ n: 1 }] }],
          'control',
        );

        const result = await run();

        expect(verifier.generate).not.toHaveBeenCalled();
        expect(result.crossCheck).toBeUndefined();
      });
    });

    describe('answer review', () => {
      const FINDINGS = [
        { code: 'date-filter', detail: 'The question asked for 2024 only.' },
      ];

      it('revises the answer with one corrective pass when the review finds something', async () => {
        const reviewAgent = { generate: jest.fn() };
        const { service, agent, session } = buildStreaming(
          answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
          { reviewAgent },
        );
        (reviewAnswer as jest.Mock).mockResolvedValue({
          review: { status: 'flagged', findings: FINDINGS },
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            totalTokens: 110,
            reasoningTokens: 0,
            cachedInputTokens: 0,
            calls: 1,
          },
        });
        agent.generate.mockResolvedValueOnce({
          text: 'In 2024, 64 matches were played.',
          usage: { inputTokens: 200, outputTokens: 20 },
          steps: [
            { toolCalls: [{ payload: { toolName: 'run_readonly_sql' } }] },
          ],
          toolResults: [
            {
              payload: {
                toolName: 'run_readonly_sql',
                args: { sql: 'select 2024' },
                result: { columns: ['n'], rows: [{ n: 64 }] },
              },
            },
          ],
        });

        const result = await service.runTurn('session-1', 'How many in 2024?', {
          engine: { answerReview: true },
        });

        expect(reviewAnswer).toHaveBeenCalledWith(
          reviewAgent,
          expect.objectContaining({
            question: 'How many in 2024?',
            finalText: 'Here is the answer.',
            sql: [{ sql: 'select 1', ok: true, rowCount: 1 }],
            resultShape: '1 row × columns n',
            warnings: [],
          }),
          {
            providerOptions: { openai: { reasoningEffort: 'medium' } },
            abortSignal: expect.any(AbortSignal),
          },
        );
        const [input, correctiveOptions] = (
          agent.generate.mock.calls as unknown[][]
        )[0] as [string, CallOptions];
        expect(input).toBe('How many in 2024?');
        expect(correctiveOptions).not.toHaveProperty('memory');
        const nudges = correctiveOptions.context.map((b) => b.content);
        expect(nudges).toEqual(
          expect.arrayContaining([
            expect.stringContaining(
              '[date-filter] The question asked for 2024 only.',
            ),
            'The answer under review:\nHere is the answer.',
          ]),
        );
        const message = session.messages.at(-1)!;
        expect(message.content).toBe('In 2024, 64 matches were played.');
        expect(message.review).toEqual({
          status: 'revised',
          findings: FINDINGS,
          note: 'the review found issues and the answer was corrected',
        });
        expect(message.data?.map((r) => r.input)).toEqual([
          'select 1',
          'select 2024',
        ]);
        expect(result.text).toBe('In 2024, 64 matches were played.');
        expect(result.review?.status).toBe('revised');
        expect(result.calledTools).toEqual([
          'run_readonly_sql',
          'run_readonly_sql',
        ]);
        expect(result.sidePassUsage?.review).toEqual(
          expect.objectContaining({
            inputTokens: 300,
            outputTokens: 30,
            calls: 2,
          }),
        );
        expect(message.engine).toEqual(
          expect.objectContaining({ answerReview: true }),
        );
      });

      it('flags the answer when the corrective pass produces nothing', async () => {
        const { service, agent, session } = buildStreaming(
          answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
          { reviewAgent: { generate: jest.fn() } },
        );
        (reviewAnswer as jest.Mock).mockResolvedValue({
          review: { status: 'flagged', findings: FINDINGS },
        });
        agent.generate.mockResolvedValueOnce({ text: '  ' });

        await service.runTurn('session-1', 'How many in 2024?', {
          engine: { answerReview: true },
        });

        const message = session.messages.at(-1)!;
        expect(message.content).toBe('Here is the answer.');
        expect(message.review?.status).toBe('flagged');
      });

      it('keeps the answer and records an error when the review agent is missing', async () => {
        const { service, agent, session } = buildStreaming(
          answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
        );

        const result = await service.runTurn('session-1', 'How many?', {
          engine: { answerReview: true },
        });

        expect(reviewAnswer).not.toHaveBeenCalled();
        expect(agent.generate).not.toHaveBeenCalled();
        const message = session.messages.at(-1)!;
        expect(message.content).toBe('Here is the answer.');
        expect(message.review).toEqual({
          status: 'error',
          findings: [],
          note: expect.stringContaining('answer-review not found'),
        });
        expect(result.review?.status).toBe('error');
      });

      it('makes no review call when the lever is off', async () => {
        const reviewAgent = { generate: jest.fn() };
        const { service } = buildStreaming(
          answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
          { reviewAgent },
        );

        const result = await service.runTurn('session-1', 'How many?');

        expect(reviewAnswer).not.toHaveBeenCalled();
        expect(result.review).toBeUndefined();
      });
    });

    describe('side-pass usage', () => {
      it('sums the main run, synthesis and cross-check, keeping the answer on the main run', async () => {
        const { service, agent, verifier, session } = buildStreaming(
          toolOnlyStream(2),
          {
            tables: ['main.football.matches'],
            totalUsage: Promise.resolve({
              inputTokens: 1000,
              outputTokens: 200,
            }),
          },
        );
        agent.generate.mockResolvedValueOnce({
          text: 'Synthesized.',
          usage: { inputTokens: 100, outputTokens: 20 },
        });
        verifier.generate.mockResolvedValueOnce({
          object: { sql: 'SELECT 1' },
          usage: { inputTokens: 50, outputTokens: 5 },
        });

        const result = await service.runTurn('session-1', 'Why?', {
          engine: { careful: 'on' },
        });

        expect(result.sidePassUsage).toEqual({
          synthesis: expect.objectContaining({ inputTokens: 100, calls: 1 }),
          crossCheck: expect.objectContaining({ inputTokens: 50, calls: 1 }),
        });
        expect(result.usage).toEqual(
          expect.objectContaining({
            inputTokens: 1150,
            outputTokens: 225,
            totalTokens: 1375,
            calls: 3,
          }),
        );
        expect(session.messages.at(-1)?.usage).toEqual(
          expect.objectContaining({ inputTokens: 1000, calls: 1 }),
        );
      });

      it('bills the grounding guard and the fixer as side passes', async () => {
        const { service, agent } = buildStreaming(answerStream([]));
        agent.generate.mockResolvedValueOnce({
          text: 'Grounded answer.',
          usage: { inputTokens: 70, outputTokens: 7 },
          toolCalls: [{ toolName: 'run_readonly_sql' }],
          toolResults: [
            {
              toolName: 'run_readonly_sql',
              args: { sql: 'select winner' },
              result: {
                columns: ['n'],
                rows: [{ n: 1 }],
                repairs: [
                  {
                    original: 'select winer',
                    repaired: 'select winner',
                    error: 'no column winer',
                    kind: 'identifier',
                    usage: {
                      inputTokens: 30,
                      outputTokens: 3,
                      totalTokens: 33,
                      reasoningTokens: 0,
                      cachedInputTokens: 0,
                      calls: 1,
                    },
                  },
                ],
              },
            },
          ],
        });

        const result = await service.runTurn('session-1', 'Who won?');

        expect(result.text).toBe('Grounded answer.');
        expect(result.calledTools).toEqual(['run_readonly_sql']);
        expect(result.sidePassUsage?.grounding).toEqual(
          expect.objectContaining({ inputTokens: 70 }),
        );
        expect(result.sidePassUsage?.fixer).toEqual(
          expect.objectContaining({ inputTokens: 30 }),
        );
        // The main stream reported nothing; the sides still add up.
        expect(result.usage).toEqual(
          expect.objectContaining({ inputTokens: 100, calls: 2 }),
        );
      });

      it('reports no usage at all when nothing was observed', async () => {
        const { service } = buildStreaming(
          answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
        );

        const result = await service.runTurn('session-1', 'Why?');

        expect(result.usage).toBeUndefined();
        expect(result.sidePassUsage).toBeUndefined();
      });
    });

    describe('the TurnResult', () => {
      it('returns everything a harness grades', async () => {
        const { service, session } = buildStreaming(
          answerStream([
            { sql: 'select bad', error: 'no such column' },
            {
              sql: 'select 1',
              rows: [{ n: 1 }],
              warnings: ['Ratio of a sum to itself', 'Shared warning'],
              precheck: ['Shared warning', 'Missing default filter'],
              repairs: [
                {
                  original: 'select 0',
                  repaired: 'select 1',
                  error: 'boom',
                  kind: 'semantic',
                  warning: 'The fix changed the filter',
                },
              ],
            },
            { sql: 'select 2', error: 'timeout' },
          ]),
        );

        const result = await service.runTurn('session-1', 'How many?');

        expect(result).toEqual({
          text: 'Here is the answer.',
          message: session.messages.at(-1),
          data: session.messages.at(-1)?.data,
          calledTools: [
            'run_readonly_sql',
            'run_readonly_sql',
            'run_readonly_sql',
          ],
          steps: 3,
          finalSql: 'select 1',
          repairs: [
            {
              original: 'select 0',
              repaired: 'select 1',
              error: 'boom',
              kind: 'semantic',
              warning: 'The fix changed the filter',
            },
          ],
          warnings: [
            'Ratio of a sum to itself',
            'Shared warning',
            'Missing default filter',
            'The fix changed the filter',
          ],
          engine: resolveEngineOptions(),
          configHash: expect.stringMatching(/^[0-9a-f]{12}$/),
          aborted: false,
          durationMs: expect.any(Number),
        });
        expect(result.data[1]).toEqual(
          expect.objectContaining({
            precheck: ['Shared warning', 'Missing default filter'],
            repairs: result.repairs,
          }),
        );
      });

      it('counts the clarification call and returns the card', async () => {
        const { service } = buildStreaming(clarificationStream());

        const result = await service.runTurn('session-1', 'Which team?');

        expect(result.calledTools).toEqual([
          'run_readonly_sql',
          'ask_clarification',
        ]);
        expect(result.clarification?.question).toBe('Which season?');
        expect(result.text).toBe('Which season?');
        expect(result.aborted).toBe(false);
      });

      it('returns the partial turn when the caller aborts', async () => {
        const controller = new AbortController();
        async function* stopped() {
          yield { type: 'text-delta', payload: { text: 'Partial' } };
          controller.abort();
          throw new Error('The operation was aborted');
        }
        const { service } = buildStreaming(stopped());
        const events: StreamEvent[] = [];

        const result = await service.runTurn('session-1', 'Why?', {
          emit: (event) => events.push(event),
          abortSignal: controller.signal,
        });

        expect(result.aborted).toBe(true);
        expect(result.text).toBe('Partial');
        expect(events.some((event) => event.type === 'done')).toBe(false);
      });

      it('hashes the same levers and model to the same config', async () => {
        const first = buildStreaming(answerStream([]));
        const second = buildStreaming(answerStream([]));

        const a = await first.service.runTurn('session-1', 'Hi');
        const b = await second.service.runTurn('session-1', 'Hi');
        const c = await buildStreaming(answerStream([])).service.runTurn(
          'session-1',
          'Hi',
          { engine: { sqlRepair: false } },
        );

        expect(a.configHash).toBe(b.configHash);
        expect(c.configHash).not.toBe(a.configHash);
      });
    });
  });
});

describe('SessionsService SQL self-correction', () => {
  /** The `run_readonly_sql` bridge SessionsService installs for the tools. */
  async function bridge(overrides: {
    runs: jest.Mock;
    fixerReplies?: ({ sql: string } | undefined)[];
    /** Token counts each fixer reply reports, by position. */
    fixerUsage?: Record<string, number>[];
    engineDefaults?: Partial<EngineOptions>;
  }) {
    const fixer = { generate: jest.fn() };
    for (const [index, reply] of (overrides.fixerReplies ?? []).entries()) {
      const usage = overrides.fixerUsage?.[index];
      fixer.generate.mockResolvedValueOnce({
        object: reply,
        ...(usage ? { usage } : {}),
      });
    }
    const knowledge = {
      defaultFilters: jest.fn().mockResolvedValue([
        {
          entity: 'main.health.claims',
          predicate: 'is_test = false',
          title: 'Exclude test claims',
        },
      ]),
    };
    const metrics = {
      forEntities: jest.fn().mockResolvedValue([
        {
          entity: 'main.health.claims',
          name: 'denial_rate',
          expression: 'AVG(CASE WHEN denied THEN 1 ELSE 0 END)',
        },
      ]),
    };
    const engine = engineSettings(overrides.engineDefaults);
    const dataset = {
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
    const service = new SessionsService(
      { list: jest.fn().mockResolvedValue([]) } as never,
      {
        getAgent: jest.fn().mockReturnValue(fixer),
        ensureSessionWorkspace: jest.fn().mockResolvedValue({ id: 'w' }),
      } as never,
      { getByNames: jest.fn().mockResolvedValue([dataset]) } as never,
      { runReadOnlySql: overrides.runs } as never,
      // The fixer files its low reasoning effort through LlmService.
      {
        providerOptionsFor: jest.fn((effort: string) =>
          Promise.resolve({ openai: { reasoningEffort: effort } }),
        ),
      } as never,
      {} as never,
      {} as never,
      metrics as never,
      knowledge as never,
      engine as never,
    );
    await service.onModuleInit();
    const calls = (setDatasetToolServices as jest.Mock).mock
      .calls as unknown[][];
    const installed = calls.at(-1)![0] as DatasetToolServices;
    return {
      run: (sql: string, levers?: Partial<EngineOptions>) =>
        installed.runReadOnlySql(
          'ds-1',
          sql,
          100,
          ['claims'],
          levers ? { engine: resolveEngineOptions(levers) } : undefined,
        ),
      fixer,
      knowledge,
      metrics,
      engine,
      dataset,
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

  it('logs the offending statement, flattened onto one line, with the repair warning', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const runs = jest
      .fn()
      .mockRejectedValueOnce(new Error('Column claimid cannot be resolved'))
      .mockResolvedValueOnce({ columns: ['n'], rows: [{ n: 3 }] });
    const { run } = await bridge({
      runs,
      fixerReplies: [
        { sql: 'SELECT count(claim_id) AS n FROM main.health.claims' },
      ],
    });

    await run('SELECT\n  count(claimid) AS n\nFROM main.health.claims');

    const warnings = warn.mock.calls.map((call) => call[0]);
    expect(warnings).toEqual([
      expect.stringContaining(
        // Newlines collapsed so one failure stays one log line.
        'SELECT count(claimid) AS n FROM main.health.claims',
      ),
    ]);
    expect(warnings[0]).not.toContain('\n');
  });

  it('does not call the fixer on a guard rejection and rethrows immediately', async () => {
    const runs = jest
      .fn()
      .mockRejectedValueOnce(
        new BadRequestException(
          'Only read-only SELECT / WITH queries can be run.',
        ),
      );
    const { run, fixer } = await bridge({ runs });

    await expect(run('DROP TABLE main.health.claims')).rejects.toThrow(
      'Only read-only SELECT / WITH queries can be run.',
    );
    expect(runs).toHaveBeenCalledTimes(1);
    expect(fixer.generate).not.toHaveBeenCalled();
  });

  it('does not call the fixer on a transport/auth failure and rethrows immediately', async () => {
    const runs = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('Received a response with a bad HTTP status code: 403'),
      );
    const { run, fixer } = await bridge({ runs });

    await expect(
      run('SELECT count(claim_id) AS n FROM main.health.claims'),
    ).rejects.toThrow('bad HTTP status code: 403');
    expect(runs).toHaveBeenCalledTimes(1);
    expect(fixer.generate).not.toHaveBeenCalled();
  });

  it('still calls the fixer for an engine parse/resolution error', async () => {
    const runs = jest
      .fn()
      .mockRejectedValueOnce(
        new Error(
          '[CAST_INVALID_INPUT] The value cannot be cast to "INT" due to an overflow',
        ),
      )
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

    expect(fixer.generate).toHaveBeenCalledTimes(1);
    expect(result.correctedSql).toBe(
      'SELECT count(claim_id) AS n FROM main.health.claims',
    );
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
  describe('engine levers on the bridge', () => {
    beforeEach(() => {
      (classifyRepair as jest.Mock).mockReset();
      (classifyRepair as jest.Mock).mockReturnValue({
        kind: 'unknown',
        changed: [],
      });
      (precheckSql as jest.Mock).mockReset();
      (precheckSql as jest.Mock).mockReturnValue([]);
    });

    it('uses the production defaults when the caller passes no levers', async () => {
      const runs = jest.fn().mockResolvedValue({ columns: ['n'], rows: [] });
      const { run, engine } = await bridge({
        runs,
        engineDefaults: { sqlPrecheck: true },
      });

      await run('SELECT 1 FROM main.health.claims');

      expect(engine.resolved).toHaveBeenCalled();
      expect(precheckSql).toHaveBeenCalled();
    });

    it('rethrows the original error without calling the fixer when sqlRepair is off', async () => {
      const runs = jest
        .fn()
        .mockRejectedValueOnce(new Error('Column claimid cannot be resolved'));
      const { run, fixer } = await bridge({
        runs,
        fixerReplies: [{ sql: 'SELECT claim_id FROM main.health.claims' }],
      });

      await expect(
        run('SELECT claimid FROM main.health.claims', { sqlRepair: false }),
      ).rejects.toThrow('Column claimid cannot be resolved');
      expect(fixer.generate).not.toHaveBeenCalled();
      expect(runs).toHaveBeenCalledTimes(1);
    });

    it('records each repair with the intent guard verdict and the fixer cost', async () => {
      (classifyRepair as jest.Mock).mockReturnValue({
        kind: 'semantic',
        changed: ['WHERE clause'],
        warning:
          'The automatic fix changed the filter — check it still answers the question.',
      });
      const runs = jest
        .fn()
        .mockRejectedValueOnce(new Error('first failure'))
        .mockRejectedValueOnce(new Error('second failure'))
        .mockResolvedValueOnce({ columns: ['n'], rows: [{ n: 3 }] });
      const { run, fixer } = await bridge({
        runs,
        fixerReplies: [
          { sql: 'SELECT 1 FROM main.health.claims' },
          { sql: 'SELECT 2 FROM main.health.claims' },
        ],
        fixerUsage: [
          { inputTokens: 30, outputTokens: 10 },
          { inputTokens: 40, outputTokens: 12 },
        ],
      });

      const result = await run('SELECT 0 FROM main.health.claims');

      expect(classifyRepair).toHaveBeenNthCalledWith(
        1,
        'SELECT 0 FROM main.health.claims',
        'SELECT 1 FROM main.health.claims',
      );
      expect(classifyRepair).toHaveBeenNthCalledWith(
        2,
        'SELECT 1 FROM main.health.claims',
        'SELECT 2 FROM main.health.claims',
      );
      expect(result.correctedSql).toBe('SELECT 2 FROM main.health.claims');
      expect(result.note).toContain('auto-corrected');
      // The fixer call itself is unchanged by the levers.
      expect((fixer.generate.mock.calls as unknown[][])[0][1]).toEqual({
        maxSteps: 1,
        toolChoice: 'none',
        providerOptions: { openai: { reasoningEffort: 'low' } },
        structuredOutput: {
          schema: expect.anything(),
          jsonPromptInjection: 'inline',
        },
      });
      expect(result.repairs).toEqual([
        {
          original: 'SELECT 0 FROM main.health.claims',
          repaired: 'SELECT 1 FROM main.health.claims',
          error: 'first failure',
          kind: 'semantic',
          warning:
            'The automatic fix changed the filter — check it still answers the question.',
          usage: expect.objectContaining({
            inputTokens: 30,
            outputTokens: 10,
            calls: 1,
          }),
        },
        expect.objectContaining({
          original: 'SELECT 1 FROM main.health.claims',
          repaired: 'SELECT 2 FROM main.health.claims',
          error: 'second failure',
          usage: expect.objectContaining({ inputTokens: 40 }),
        }),
      ]);
    });

    it('marks repairs unclassified when the intent guard is off', async () => {
      const runs = jest
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ columns: ['n'], rows: [{ n: 1 }] });
      const { run } = await bridge({
        runs,
        fixerReplies: [{ sql: 'SELECT 1 FROM main.health.claims' }],
      });

      const result = await run('SELECT x FROM main.health.claims', {
        repairIntentGuard: false,
      });

      expect(classifyRepair).not.toHaveBeenCalled();
      expect(result.repairs).toEqual([
        {
          original: 'SELECT x FROM main.health.claims',
          repaired: 'SELECT 1 FROM main.health.claims',
          error: 'boom',
          kind: 'unknown',
        },
      ]);
    });

    it('adds nothing new to a clean run with the default levers', async () => {
      const runs = jest
        .fn()
        .mockResolvedValue({ columns: ['n'], rows: [{ n: 1 }] });
      const { run, knowledge } = await bridge({ runs });

      const result = await run('SELECT n FROM main.health.claims', {});

      expect(result).toEqual({ columns: ['n'], rows: [{ n: 1 }] });
      expect(precheckSql).not.toHaveBeenCalled();
      expect(knowledge.defaultFilters).not.toHaveBeenCalled();
    });

    it('attaches precheck findings without blocking execution', async () => {
      (precheckSql as jest.Mock).mockReturnValue([
        'main.health.claims is usually filtered with is_test = false',
      ]);
      const runs = jest
        .fn()
        .mockResolvedValue({ columns: ['n'], rows: [{ n: 1 }] });
      const { run, dataset } = await bridge({ runs });

      const result = await run('SELECT count(*) AS n FROM main.health.claims', {
        sqlPrecheck: true,
      });

      expect(runs).toHaveBeenCalledTimes(1);
      expect(precheckSql).toHaveBeenCalledWith(
        'SELECT count(*) AS n FROM main.health.claims',
        [dataset],
        {
          defaultFilters: [
            expect.objectContaining({ predicate: 'is_test = false' }),
          ],
          metrics: [expect.objectContaining({ name: 'denial_rate' })],
        },
      );
      expect(result.precheck).toEqual([
        'main.health.claims is usually filtered with is_test = false',
      ]);
    });

    it('withholds curated filters and metrics from the precheck in the bare arm', async () => {
      const runs = jest
        .fn()
        .mockResolvedValue({ columns: ['n'], rows: [{ n: 1 }] });
      const { run, knowledge, metrics } = await bridge({ runs });

      await run('SELECT 1 FROM main.health.claims', {
        sqlPrecheck: true,
        context: 'bare',
      });

      expect(knowledge.defaultFilters).not.toHaveBeenCalled();
      expect(metrics.forEntities).not.toHaveBeenCalled();
      expect(precheckSql).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        {
          defaultFilters: [],
          metrics: [],
        },
      );
    });
  });
});

describe('SessionsService lookup bridge', () => {
  const claims = (kind: 'databricks' | 'postgres', datasourceId = 'ds-1') => ({
    name: kind === 'postgres' ? 'claims-pg' : 'claims',
    datasourceId,
    datasourceKind: kind,
    tables: [kind === 'postgres' ? 'hi.health.claims' : 'main.health.claims'],
    entities: [
      {
        key: kind === 'postgres' ? 'hi.health.claims' : 'main.health.claims',
        columns: [
          { name: 'claim_id', type: 'string', nullable: false },
          { name: 'status', type: 'string', nullable: true },
        ],
      },
    ],
  });

  async function bridge(datasets: ReturnType<typeof claims>[]) {
    const runs = jest.fn().mockResolvedValue({
      columns: ['lookup_value', 'lookup_count'],
      rows: [
        { lookup_value: 'Denied - Prior Auth', lookup_count: '12' },
        { lookup_value: 'Denied', lookup_count: 3 },
      ],
    });
    const knowledge = {
      lookup: jest
        .fn()
        .mockResolvedValue([
          { kind: 'term', title: 'Denial', body: 'status starts with Denied' },
        ]),
      defaultFilters: jest.fn().mockResolvedValue([
        {
          entity: 'main.health.claims',
          predicate: 'is_test = false',
          title: 't',
        },
      ]),
    };
    const metrics = {
      lookup: jest.fn().mockResolvedValue([
        {
          name: 'denial_rate',
          entity: 'main.health.claims',
          expression: 'x',
        },
      ]),
    };
    const service = new SessionsService(
      { list: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {
        list: jest.fn().mockResolvedValue(datasets),
        getByNames: jest
          .fn()
          .mockImplementation(async (names: string[]) =>
            datasets.filter((d) => names.includes(d.name)),
          ),
      } as never,
      { runReadOnlySql: runs } as never,
      {} as never,
      {} as never,
      {} as never,
      metrics as never,
      knowledge as never,
      engineSettings() as never,
    );
    await service.onModuleInit();
    const calls = (setDatasetToolServices as jest.Mock).mock
      .calls as unknown[][];
    const installed = calls.at(-1)![0] as DatasetToolServices;
    return { installed, runs, knowledge, metrics };
  }

  it('returns the most frequent matching values of a bound column', async () => {
    const { installed, runs } = await bridge([claims('databricks')]);

    const values = await installed.lookupValues!(
      'ds-1',
      'main.health.claims',
      'status',
      'Denied',
      5,
    );

    expect(values).toEqual([
      { value: 'Denied - Prior Auth', count: 12 },
      { value: 'Denied', count: 3 },
    ]);
    expect(runs).toHaveBeenCalledWith(
      'ds-1',
      'SELECT `status` AS lookup_value, COUNT(*) AS lookup_count ' +
        'FROM `main`.`health`.`claims` ' +
        "WHERE LOWER(CAST(`status` AS STRING)) LIKE '%denied%' ESCAPE '!' " +
        'GROUP BY `status` ORDER BY lookup_count DESC, lookup_value LIMIT 5',
      5,
    );
  });

  it('quotes Postgres identifiers the way sampleRows does', async () => {
    const { installed, runs } = await bridge([claims('postgres')]);

    await installed.lookupValues!(
      'ds-1',
      'hi.health.claims',
      'STATUS',
      'den',
      10,
    );

    const sql = (runs.mock.calls as unknown[][])[0][1] as string;
    // Canonical names from the snapshot, not the caller's spelling.
    expect(sql).toContain('FROM "health"."claims"');
    expect(sql).toContain('LOWER(CAST("status" AS TEXT))');
  });

  it('escapes the phrase for the literal and for LIKE', async () => {
    const { installed, runs } = await bridge([claims('databricks')]);

    await installed.lookupValues!(
      'ds-1',
      'main.health.claims',
      'status',
      "50%_Off's!\\x",
      500,
    );

    const [, sql, limit] = (runs.mock.calls as unknown[][])[0] as [
      string,
      string,
      number,
    ];
    expect(sql).toContain("LIKE '%50!%!_off''s!!\\\\x%' ESCAPE '!'");
    expect(sql).toContain('LIMIT 50');
    expect(limit).toBe(50);
  });

  it('rejects an entity that is not a table of a dataset on that datasource', async () => {
    const { installed, runs } = await bridge([
      claims('databricks', 'ds-other'),
    ]);

    await expect(
      installed.lookupValues!('ds-1', 'main.health.claims', 'status', 'x', 5),
    ).rejects.toThrow(/not a table of any dataset on this datasource/);
    await expect(
      installed.lookupValues!(
        'ds-other',
        'main.health.claims; DROP TABLE x',
        'status',
        'x',
        5,
      ),
    ).rejects.toThrow(/not a table/);
    expect(runs).not.toHaveBeenCalled();
  });

  it('rejects a column that is not in the snapshot, naming the real ones', async () => {
    const { installed, runs } = await bridge([claims('databricks')]);

    await expect(
      installed.lookupValues!(
        'ds-1',
        'main.health.claims',
        'status) OR (1=1',
        'x',
        5,
      ),
    ).rejects.toThrow(/its columns are claim_id, status/);
    expect(runs).not.toHaveBeenCalled();
  });

  it('answers knowledge lookups from the knowledge and metrics stores', async () => {
    const { installed, knowledge, metrics } = await bridge([
      claims('databricks'),
    ]);

    const found = await installed.knowledgeFor!(['claims'], {
      phrase: 'denial',
      entity: 'main.health.claims',
      column: 'status',
    });

    expect(knowledge.lookup).toHaveBeenCalledWith(['claims'], {
      phrase: 'denial',
      entity: 'main.health.claims',
      column: 'status',
    });
    expect(metrics.lookup).toHaveBeenCalledWith(['main.health.claims'], {
      phrase: 'denial',
      entity: 'main.health.claims',
    });
    expect(found.snippets).toHaveLength(1);
    expect(found.metrics).toEqual([
      expect.objectContaining({ name: 'denial_rate' }),
    ]);
    await expect(installed.defaultFilters!(['claims'])).resolves.toEqual([
      expect.objectContaining({ predicate: 'is_test = false' }),
    ]);
  });
});

describe('SessionsService visual tool bridge (turn records)', () => {
  /** The `createVisual`/`updateVisual` bridge SessionsService installs for the tools. */
  async function bridge() {
    const session: SessionDoc = {
      id: 'session-1',
      name: 'Claims',
      datasets: ['claims'],
      messages: [],
      visualizations: [],
    };
    const repository = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockImplementation(async (_id, patch) => {
        Object.assign(session, patch);
        return session;
      }),
    };
    const meta = (currentVersion: number) => ({
      id: 'visual-1',
      title: 'Chart',
      description: 'A chart.',
      path: 'visuals/visual-1',
      sourceMessageAt: '2024-01-01T00:00:00.000Z',
      createdAt: '2024-01-01T00:00:00.000Z',
      currentVersion,
    });
    const visuals = {
      create: jest.fn().mockResolvedValue({ metadata: meta(1) }),
      update: jest.fn().mockResolvedValue({ metadata: meta(2) }),
      currentVersion: jest
        .fn()
        .mockImplementation(
          (m: { currentVersion?: number }) => m.currentVersion ?? 1,
        ),
    };
    const service = new SessionsService(
      repository as never,
      {
        ensureSessionWorkspace: jest.fn().mockResolvedValue({ id: 'w' }),
      } as never,
      { getByNames: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {} as never,
      visuals as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.onModuleInit();
    const calls = (setDatasetToolServices as jest.Mock).mock
      .calls as unknown[][];
    const installed = calls.at(-1)![0] as DatasetToolServices;
    return { installed, visuals };
  }

  it("forwards the turn's records to VisualizationService.create", async () => {
    const { installed, visuals } = await bridge();
    const turnRecords = [
      { tool: 'run_readonly_sql', input: 'select 1', rows: [{ n: 1 }] },
    ];

    await installed.createVisual(
      'session-1',
      undefined,
      'chart it',
      turnRecords,
    );

    expect(visuals.create).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      'chart it',
      turnRecords,
    );
  });

  it("forwards the turn's records to VisualizationService.update", async () => {
    const { installed, visuals } = await bridge();
    const turnRecords = [
      { tool: 'run_readonly_sql', input: 'select 2', rows: [{ n: 2 }] },
    ];

    await installed.updateVisual(
      'session-1',
      'visual-1',
      'break it down further',
      turnRecords,
    );

    expect(visuals.update).toHaveBeenCalledWith(
      expect.anything(),
      'visual-1',
      'break it down further',
      turnRecords,
    );
  });

  it('passes nothing through for a tool call outside a turn (REST tailoring parity)', async () => {
    const { installed, visuals } = await bridge();

    await installed.createVisual('session-1', undefined, 'chart it');
    await installed.updateVisual('session-1', 'visual-1', 'tweak it');

    expect(visuals.create).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      'chart it',
      undefined,
    );
    expect(visuals.update).toHaveBeenCalledWith(
      expect.anything(),
      'visual-1',
      'tweak it',
      undefined,
    );
  });
});

describe('SessionsService answer feedback', () => {
  function build(session: SessionDoc) {
    const repository = {
      get: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockImplementation(async (_id, patch) => {
        Object.assign(session, patch);
        return session;
      }),
    };
    const verifiedQueries = {
      save: jest.fn().mockResolvedValue({}),
      removeForMessage: jest.fn().mockResolvedValue(1),
    };
    const service = new SessionsService(
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
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, verifiedQueries };
  }

  const answered = (): SessionDoc => ({
    id: 'session-1',
    name: 'Claims',
    datasets: ['claims'],
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
    const session = answered();
    const { service, verifiedQueries } = build(session);

    const updated = await service.recordFeedback(
      'session-1',
      '2024-01-01T00:00:03.000Z',
      'up',
    );

    expect(verifiedQueries.save).toHaveBeenCalledWith({
      question: 'How many claims were denied last year?',
      sql: 'SELECT count(*) FROM main.health.claims',
      datasourceId: 'ds-1',
      entities: ['main.health.claims'],
      sourceSessionId: 'session-1',
      sourceMessageAt: '2024-01-01T00:00:03.000Z',
    });
    expect(updated.messages.at(-1)?.feedback).toBe('up');
    expect(updated.messages.at(-1)?.verified).toBe(true);
  });

  it('clears the verified badge on thumbs-down', async () => {
    const session = answered();
    session.messages[3].verified = true;
    const { service } = build(session);

    await service.recordFeedback(
      'session-1',
      '2024-01-01T00:00:03.000Z',
      'down',
    );

    expect(session.messages.at(-1)?.verified).toBeUndefined();
  });

  it('removes the stored pair on thumbs-down', async () => {
    const session = answered();
    const { service, verifiedQueries } = build(session);

    await service.recordFeedback(
      'session-1',
      '2024-01-01T00:00:03.000Z',
      'down',
    );

    expect(verifiedQueries.removeForMessage).toHaveBeenCalledWith(
      'session-1',
      '2024-01-01T00:00:03.000Z',
    );
    expect(verifiedQueries.save).not.toHaveBeenCalled();
    expect(session.messages.at(-1)?.feedback).toBe('down');
  });

  it('records the rating but saves nothing when the answer ran no SQL', async () => {
    const session = answered();
    delete session.messages[3].data;
    const { service, verifiedQueries } = build(session);

    await service.recordFeedback('session-1', '2024-01-01T00:00:03.000Z', 'up');

    expect(verifiedQueries.save).not.toHaveBeenCalled();
    expect(session.messages.at(-1)?.feedback).toBe('up');
  });
});

/** SQL runs followed by a written answer — the ordinary completed turn. */
async function* answerStream(
  runs: {
    sql: string;
    rows?: Record<string, unknown>[];
    truncated?: boolean;
    /** What the assistant said it was checking with this query. */
    rationale?: string;
    /** Set instead of rows when the query came back as a failure. */
    error?: string;
    /** What the bridge/tool attached to the result (guards, fixer, precheck). */
    warnings?: string[];
    repairs?: Record<string, unknown>[];
    precheck?: string[];
  }[],
) {
  for (const [index, run] of runs.entries()) {
    const toolCallId = `call-${index}`;
    yield {
      type: 'tool-call',
      payload: {
        toolCallId,
        toolName: 'run_readonly_sql',
        args: {
          sql: run.sql,
          ...(run.rationale ? { rationale: run.rationale } : {}),
        },
      },
    };
    yield {
      type: 'tool-result',
      payload: {
        toolCallId,
        toolName: 'run_readonly_sql',
        result: run.error
          ? { error: run.error }
          : {
              columns: ['n'],
              rows: run.rows ?? [],
              ...(run.truncated ? { truncated: true } : {}),
              ...(run.warnings ? { warnings: run.warnings } : {}),
              ...(run.repairs ? { repairs: run.repairs } : {}),
              ...(run.precheck ? { precheck: run.precheck } : {}),
            },
      },
    };
  }
  yield { type: 'text-delta', payload: { text: 'Here is the answer.' } };
}

/** A stream that ends without a single chunk — the model said nothing. */
async function* answerStreamWithoutText(): AsyncGenerator<unknown> {
  yield* [];
}

/** One SQL run, then the model asks for a clarification and the turn ends. */
async function* clarificationStream() {
  yield {
    type: 'tool-call',
    payload: {
      toolCallId: 'call-0',
      toolName: 'run_readonly_sql',
      args: {
        sql: 'select 1',
        rationale: 'I check which seasons the data covers before narrowing.',
      },
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

/** A stream that fails outright — a provider error, a dead connection. */
// eslint-disable-next-line @typescript-eslint/require-yield
async function* failingStream(error: unknown) {
  throw error;
}

describe('SessionsService visual tailoring and repair', () => {
  const visual = (currentVersion: number) => ({
    id: 'visual-1',
    title: 'Claims by month',
    description: 'Denials peak in March.',
    path: 'visuals/visual-1',
    sourceMessageAt: '2024-01-01T00:00:01.000Z',
    createdAt: '2024-01-01T00:00:02.000Z',
    currentVersion,
    versions: [
      {
        version: 1,
        createdAt: '2024-01-01T00:00:02.000Z',
        sourceMessageAt: '2024-01-01T00:00:01.000Z',
      },
    ],
  });

  function build(currentVersion = 1) {
    const session: SessionDoc = {
      id: 'session-1',
      name: 'Claims',
      datasets: ['claims'],
      messages: [],
      visualizations: [visual(currentVersion)],
    };
    const repository = {
      get: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockImplementation(async (_id, patch) => {
        Object.assign(session, patch);
        return session;
      }),
    };
    const visuals = {
      find: jest
        .fn()
        .mockImplementation((doc: SessionDoc, id: string) =>
          (doc.visualizations ?? []).find((v) => v.id === id),
        ),
      currentVersion: jest
        .fn()
        .mockImplementation(
          (meta: { currentVersion?: number }) => meta.currentVersion ?? 1,
        ),
      update: jest
        .fn()
        .mockImplementation(async () => ({ metadata: visual(2) })),
      repair: jest
        .fn()
        .mockImplementation(async () => ({ metadata: visual(2) })),
      load: jest
        .fn()
        .mockImplementation(async (_doc, id: string, version: number) => ({
          ...visual(version),
          id,
          version,
          document: '<html></html>',
        })),
    };
    const service = new SessionsService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      visuals as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, session, visuals };
  }

  it('tailors a visual and records the updated event in the chat', async () => {
    const { service, session, visuals } = build();

    const result = await service.tailorVisualization(
      'session-1',
      'visual-1',
      '  Change the visual to a line chart.  ',
    );

    expect(visuals.update).toHaveBeenCalledWith(
      expect.anything(),
      'visual-1',
      'Change the visual to a line chart.',
    );
    expect(result.visualization.version).toBe(2);
    const last = session.messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.visual).toEqual({
      visualId: 'visual-1',
      version: 2,
      title: 'Claims by month',
      action: 'updated',
    });
    expect(last?.content).toContain('Updated interactive visual');
  });

  it('rejects an empty tailoring instruction before running the designer', async () => {
    const { service, visuals } = build();

    await expect(
      service.tailorVisualization('session-1', 'visual-1', '   '),
    ).rejects.toThrow(/instruction is required/);
    expect(visuals.update).not.toHaveBeenCalled();
  });

  it('repairs the current version without logging a chat event', async () => {
    const { service, session, visuals } = build();

    const result = await service.repairVisualization(
      'session-1',
      'visual-1',
      'visual rendered blank',
      1,
    );

    expect(visuals.repair).toHaveBeenCalledWith(
      expect.anything(),
      'visual-1',
      'visual rendered blank',
    );
    expect(result.visualization.version).toBe(2);
    expect(session.messages).toHaveLength(0);
    expect(session.visualizations?.[0].currentVersion).toBe(2);
  });

  it('refuses to repair anything but the current version', async () => {
    const { service, visuals } = build(3);

    await expect(
      service.repairVisualization('session-1', 'visual-1', 'boom', 2),
    ).rejects.toThrow(/Only the current version can be repaired/);
    expect(visuals.repair).not.toHaveBeenCalled();
  });

  it('refuses a missing or non-numeric version from the client', async () => {
    const { service, visuals } = build();

    await expect(
      service.repairVisualization(
        'session-1',
        'visual-1',
        'boom',
        Number(undefined),
      ),
    ).rejects.toThrow(/Only the current version can be repaired/);
    expect(visuals.repair).not.toHaveBeenCalled();
  });
});

describe('lookupValuesSql', () => {
  it('quotes and qualifies per datasource kind', () => {
    expect(
      lookupValuesSql('postgres', 'db.health.claims', 'status', 'Paid', 5),
    ).toContain('FROM "health"."claims"');
    expect(
      lookupValuesSql('databricks', 'main.health.claims', 'status', 'Paid', 5),
    ).toContain('FROM `main`.`health`.`claims`');
    // REST endpoints are SQLite tables named by their lower-cased key, which
    // the connector recognises when the whole key is quoted.
    const rest = lookupValuesSql(
      'rest',
      'api.World_Cup.Matches',
      'stage',
      'final',
      5,
    );
    expect(rest).toContain('FROM "api.world_cup.matches"');
    expect(rest).toContain('CAST("stage" AS TEXT)');
  });
});
