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
jest.mock('../../mastra/model-resolver', () => ({
  resolveAgentModel: jest.fn().mockResolvedValue('openai/gpt-4.1-mini'),
}));
jest.mock('../../mastra/tool-services', () => ({
  setDatasetToolServices: jest.fn(),
}));
jest.mock('../../mastra/tools/dataset.tools', () => ({
  DATASETS_CONTEXT_KEY: 'datasets',
  DEFAULT_SQL_ROW_LIMIT: 100,
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
// Business expert mode's service loads the Mastra agent — stub the module;
// the streaming tests hand SessionsService their own `buildTrace` double.
jest.mock('../expert-mode/expert-mode.service', () => ({
  ExpertModeService: class {},
}));
// The learning service loads the feedback-learner agent (ESM-only Mastra
// core) — stub the module; the feedback tests hand in their own double.
jest.mock('../learning/learning.service', () => ({
  LearningService: class {},
}));
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

import { BadRequestException, Logger } from '@nestjs/common';
import { resolveAgentModel } from '../../mastra/model-resolver';
import { setDatasetToolServices } from '../../mastra/tool-services';
import type { DatasetToolServices } from '../../mastra/tool-services';
import { TURN_RECORDS_CONTEXT_KEY } from '../../mastra/tools/visual.tools';
import { sourceEntities } from './visualization-document';
import { SessionsService, StreamEvent } from './sessions.service';
import type { ChatMessage, SessionDoc } from './entities/session.entity';
import type { AnswerPinDoc } from '../answer-pins/entities/answer-pin.entity';
import { fingerprintFor, lineageKeyFor } from '../answer-pins/pin-key';
import { stripForPin } from '../answer-pins/answer-pins.service';

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
      /** Business expert mode: what `buildTrace` resolves to (or throws). */
      expertTrace?: unknown;
      expertThrows?: boolean;
      /** Answer pins, keyed by lineage — share one map across builds. */
      pinStore?: Map<string, AnswerPinDoc>;
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
        text: Promise.resolve(''),
        ...(options.totalUsage ? { totalUsage: options.totalUsage } : {}),
        ...(options.usage ? { usage: options.usage } : {}),
      }),
      generate: jest.fn().mockResolvedValue({
        text:
          options.answer ?? 'Argentina won through superior chance creation.',
      }),
    };
    const verifiedQueries = {
      referenceBlock: jest.fn().mockResolvedValue(undefined),
      isVerifiedSql: jest.fn().mockResolvedValue(options.verified ?? false),
      save: jest.fn().mockResolvedValue({}),
      removeForMessage: jest.fn().mockResolvedValue(1),
    };
    const metrics = {
      definitionBlock: jest
        .fn()
        .mockResolvedValue(options.metricsBlock ?? undefined),
    };
    const knowledge = {
      definitionBlock: jest
        .fn()
        .mockResolvedValue(options.knowledgeBlock ?? ''),
      contextFor: jest.fn().mockResolvedValue({
        block: options.knowledgeBlock ?? '',
        used: options.knowledgeUsed ?? [],
      }),
    };
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
    const expertMode = {
      buildTrace: options.expertThrows
        ? jest.fn().mockRejectedValue(new Error('explainer crashed'))
        : jest.fn().mockResolvedValue(options.expertTrace),
    };
    const pins = pinsDouble(options.pinStore);
    const learning = {
      learnFromComment: jest.fn(),
      forget: jest.fn(),
    };
    const service = new SessionsService(
      repository as never,
      {
        getAgent: jest
          .fn()
          .mockImplementation((id: string) =>
            id === 'sql-verifier' ? verifier : agent,
          ),
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
      {
        getView: jest.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
      } as never,
      {} as never,
      verifiedQueries as never,
      metrics as never,
      knowledge as never,
      expertMode as never,
      pins as never,
      learning as never,
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
      expertMode,
      pins,
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

    expect(metrics.definitionBlock).toHaveBeenCalledWith([
      'main.football.matches',
      'main.football.players',
    ]);
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

  it('tells an expert-mode turn to answer under a stated convention instead of asking', async () => {
    const reviewMode = (options: { context: { content: string }[] }) =>
      options.context.some((block) =>
        block.content.includes('Business expert mode is on for this turn'),
      );
    const plain = buildStreaming(answerStream([]));
    await plain.service.streamMessage('session-1', 'FY2025 revenue?', () => {});
    const expert = buildStreaming(answerStream([]));
    await expert.service.streamMessage(
      'session-1',
      'FY2025 revenue?',
      () => {},
      undefined,
      undefined,
      false,
      true,
    );

    const optionsOf = (agent: typeof plain.agent) =>
      (agent.stream.mock.calls as unknown[][])[0][1] as {
        context: { content: string }[];
      };
    expect(reviewMode(optionsOf(plain.agent))).toBe(false);
    expect(reviewMode(optionsOf(expert.agent))).toBe(true);
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

    it('hands the verifier the curated knowledge the answer worked under', async () => {
      const { service, verifier } = buildStreaming(
        answerStream([{ sql: PRIMARY, rows: [{ n: 64 }] }]),
        {
          crossCheck: {
            sql: 'SELECT COUNT(1) AS total FROM main.football.matches',
            rows: [{ total: 64 }],
          },
          tables: ['main.football.matches'],
          knowledgeBlock:
            'Curated dataset knowledge:\n- [default_filter] Finals only: count knockout matches only.',
        },
      );

      await run(service, true);

      // Same business rules as the answer — a verifier without them disagrees
      // with every correct answer that applied a default filter.
      const prompt = (
        verifier.generate.mock.calls as unknown[][]
      )[0][0] as string;
      expect(prompt).toContain('<curated-knowledge>');
      expect(prompt).toContain('[default_filter] Finals only');
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

  describe('business expert mode', () => {
    const PRIMARY = 'SELECT count(*) AS n FROM main.football.matches';
    const TRACE = {
      id: 'trace-1',
      version: 1,
      blocks: [],
      overall: { score: 0.9, band: 'high', signals: [] },
      generatedAt: '2026-09-29T00:00:00.000Z',
    };

    const expertTurn = (
      options: Parameters<typeof buildStreaming>[1] = {},
      stream: AsyncGenerator<unknown> = answerStream([
        { sql: PRIMARY, rows: [{ n: 64 }] },
      ]),
    ) =>
      buildStreaming(stream, {
        tables: ['main.football.matches'],
        crossCheck: { sql: PRIMARY, rows: [{ n: 64 }] },
        ...options,
      });

    const run = (
      service: SessionsService,
      events: StreamEvent[],
      flags: { careful?: boolean; expert?: boolean } = {},
    ) =>
      service.streamMessage(
        'session-1',
        'How many matches were played?',
        (event) => events.push(event),
        undefined,
        undefined,
        flags.careful ?? false,
        flags.expert ?? false,
      );

    it('leaves a turn without the flag untouched: no pass, no status events', async () => {
      const { service, session, expertMode, verifier } = expertTurn({
        expertTrace: TRACE,
      });
      const events: StreamEvent[] = [];

      await run(service, events);

      expect(expertMode.buildTrace).not.toHaveBeenCalled();
      expect(verifier.generate).not.toHaveBeenCalled();
      expect(events.some((e) => e.type === 'expert-status')).toBe(false);
      expect(session.messages.at(-1)).not.toHaveProperty('expertTrace');
    });

    it('cross-checks, explains and persists the trace on the answer', async () => {
      const { service, session, expertMode, verifier } = expertTurn({
        expertTrace: TRACE,
        verified: true,
        knowledgeUsed: [
          { id: 'k1', kind: 'term', title: 'Match', body: 'A played game.' },
        ],
        metricsBlock:
          'Governed metric definitions (curated — …):\n- Matches (match_count) on main.football.matches: COUNT(*)',
      });
      const events: StreamEvent[] = [];

      await run(service, events, { expert: true });

      // Expert implies the careful-mode cross-check.
      expect(verifier.generate).toHaveBeenCalledTimes(1);
      expect(
        events.filter((e) => e.type === 'expert-status').map((e) => e.content),
      ).toEqual(['cross-check', 'explaining']);
      expect(events.at(-1)?.type).toBe('done');

      const input = (expertMode.buildTrace.mock.calls as unknown[][])[0][0] as {
        [key: string]: unknown;
      };
      expect(input).toEqual(
        expect.objectContaining({
          sessionId: 'session-1',
          question: 'How many matches were played?',
          answer: 'Here is the answer.',
          verified: true,
          crossCheck: expect.objectContaining({ status: 'agree' }),
          knowledgeUsed: [expect.objectContaining({ title: 'Match' })],
          metricsBlock: expect.stringContaining('Matches (match_count)'),
          repairedSql: [],
        }),
      );
      expect(input.data).toEqual([
        expect.objectContaining({ tool: 'run_readonly_sql', input: PRIMARY }),
      ]);
      expect(input.entities).toEqual([
        expect.objectContaining({ key: 'main.football.matches' }),
      ]);
      const message = session.messages.at(-1)!;
      expect(message.expertTrace).toEqual(TRACE);
      expect(message.crossCheck?.status).toBe('agree');
      expect(message.verified).toBe(true);
    });

    it('skips the cross-check status when the turn ran no SQL', async () => {
      const { service, expertMode } = expertTurn(
        { expertTrace: TRACE },
        answerStream([]),
      );
      const events: StreamEvent[] = [];

      await run(service, events, { expert: true });

      expect(
        events.filter((e) => e.type === 'expert-status').map((e) => e.content),
      ).toEqual(['explaining']);
      expect(expertMode.buildTrace).toHaveBeenCalledTimes(1);
    });

    it('saves the answer without a trace and reports failure when none could be built', async () => {
      const { service, session } = expertTurn({ expertTrace: undefined });
      const events: StreamEvent[] = [];

      await run(service, events, { expert: true });

      expect(
        events.filter((e) => e.type === 'expert-status').map((e) => e.content),
      ).toEqual(['cross-check', 'explaining', 'failed']);
      const message = session.messages.at(-1)!;
      expect(message.content).toBe('Here is the answer.');
      expect(message).not.toHaveProperty('expertTrace');
      expect(events.at(-1)?.type).toBe('done');
    });

    it('never lets a crashing explainer lose the answer', async () => {
      const { service, session } = expertTurn({ expertThrows: true });
      const events: StreamEvent[] = [];

      await run(service, events, { expert: true });

      expect(events.at(-1)?.type).toBe('done');
      expect(session.messages.at(-1)?.content).toBe('Here is the answer.');
      expect(
        events.some(
          (e) => e.type === 'expert-status' && e.content === 'failed',
        ),
      ).toBe(true);
    });

    it('gives a clarification no trace', async () => {
      const { service, session, expertMode } = expertTurn(
        { expertTrace: TRACE },
        clarificationStream(),
      );
      const events: StreamEvent[] = [];

      await run(service, events, { expert: true });

      expect(expertMode.buildTrace).not.toHaveBeenCalled();
      expect(events.some((e) => e.type === 'expert-status')).toBe(false);
      expect(session.messages.at(-1)?.clarification).toBeDefined();
      expect(session.messages.at(-1)).not.toHaveProperty('expertTrace');
    });

    it('tells the trace which statements the fixer repaired', async () => {
      const { service, expertMode } = expertTurn(
        { expertTrace: TRACE },
        answerStream([
          {
            sql: 'SELECT cnt FROM main.football.matches',
            rows: [{ n: 64 }],
            correctedSql: PRIMARY,
          },
        ]),
      );

      await run(service, [], { expert: true });

      const input = (expertMode.buildTrace.mock.calls as unknown[][])[0][0] as {
        repairedSql: string[];
      };
      expect(input.repairedSql).toEqual([PRIMARY]);
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

  describe('answer pinning', () => {
    const QUESTION = 'What was net revenue in fiscal year 2025?';
    const SQL = 'SELECT sum(amount) AS n FROM main.football.matches';
    const SQL_BLOCK = {
      kind: 'sql' as const,
      sql: SQL,
      annotations: [],
      confidence: { score: 0.6, band: 'medium' as const, signals: [] },
    };
    const TRACE = {
      id: 'trace-1',
      version: 1 as const,
      blocks: [SQL_BLOCK],
      overall: { score: 0.6, band: 'medium' as const, signals: [] },
      generatedAt: '2026-09-30T00:00:00.000Z',
    };
    const USER_TERM = {
      id: 'k-user',
      kind: 'term',
      title: 'Match',
      body: 'A played game.',
      source: 'user' as const,
    };
    const lesson = (id: string, title: string) => ({
      id,
      kind: 'term',
      title,
      body: `${title} is defined by the reviewer.`,
      datasetId: 'football',
      source: 'feedback' as const,
    });

    /** A pinning-ready harness whose first turn answers with one SQL run. */
    const pinningTurn = (
      options: Parameters<typeof buildStreaming>[1] = {},
      first: AsyncGenerator<unknown> = answerStream([
        { sql: SQL, rows: [{ n: 64 }] },
      ]),
    ) =>
      buildStreaming(first, { tables: ['main.football.matches'], ...options });

    const ask = (
      service: SessionsService,
      events: StreamEvent[] = [],
      flags: {
        careful?: boolean;
        expert?: boolean;
        pin?: boolean;
        activeVisualId?: string;
      } = {},
    ) =>
      service.streamMessage(
        'session-1',
        QUESTION,
        (event) => events.push(event),
        undefined,
        flags.activeVisualId,
        flags.careful ?? false,
        flags.expert ?? false,
        flags.pin ?? true,
      );

    /** The same question from a brand-new session — the same lineage. */
    const freshSession = (session: SessionDoc) => {
      session.messages = [];
    };

    /** The model stream the next derived turn reads. */
    const nextStream = (
      agent: { stream: jest.Mock },
      fullStream: AsyncGenerator<unknown>,
    ) =>
      agent.stream.mockResolvedValueOnce({
        fullStream,
        text: Promise.resolve(''),
      });

    const lineage = (mode: 'plain' | 'careful' | 'expert' = 'plain') =>
      lineageKeyFor({
        question: QUESTION,
        datasets: ['football'],
        chain: [],
        mode,
      });

    it('pins an eligible answer under its lineage', async () => {
      const { service, session, pins } = pinningTurn({
        knowledgeUsed: [USER_TERM],
        totalUsage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
      });

      await ask(service);

      const message = session.messages.at(-1)!;
      expect(message.consistency).toBeUndefined();
      expect(pins.save).toHaveBeenCalledTimes(1);
      const doc = (pins.save.mock.calls as unknown[][])[0][0] as AnswerPinDoc;
      expect(doc).toEqual(
        expect.objectContaining({
          lineageKey: lineage(),
          question: QUESTION,
          normalizedQuestion: 'what was net revenue in fiscal year 2025',
          datasets: ['football'],
          chain: [],
          mode: 'plain',
          datasourceId: 'ds-1',
          sql: SQL,
          columns: ['n'],
          rows: [{ n: 64 }],
          rowCount: 1,
          rowLimit: 100,
          knowledgeIds: ['k-user'],
          sourceSessionId: 'session-1',
          sourceMessageAt: message.at,
          replays: 0,
        }),
      );
      expect(doc.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(doc.fingerprintParts.v).toBe(1);
      // The message minus the per-turn fields a replay must not carry over.
      expect(doc.message).toEqual(
        expect.objectContaining({
          role: 'assistant',
          content: 'Here is the answer.',
        }),
      );
      expect(doc.message).not.toHaveProperty('at');
      expect(doc.message).not.toHaveProperty('usage');
    });

    it('replays a pinned answer whose SQL returns the same rows, with no model call', async () => {
      const { service, session, agent, pins, datasources } = pinningTurn({
        totalUsage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
      });
      await ask(service);
      const pinned = session.messages.at(-1)!;
      freshSession(session);
      // Same fact, connector-typed differently.
      datasources.runReadOnlySql.mockResolvedValueOnce({
        columns: ['n'],
        rows: [{ n: '64' }],
      });
      const events: StreamEvent[] = [];

      await ask(service, events);

      expect(agent.stream).toHaveBeenCalledTimes(1);
      expect(agent.generate).not.toHaveBeenCalled();
      // max(rowCount + 1, rowLimit): growth past the pinned rows shows up.
      expect(datasources.runReadOnlySql).toHaveBeenCalledWith('ds-1', SQL, 100);
      expect(events.map((e) => e.type)).toEqual(['text', 'done']);
      expect(events[0].content).toBe(pinned.content);
      expect(session.messages).toHaveLength(2);
      const replayed = session.messages.at(-1)!;
      expect(replayed.content).toBe(pinned.content);
      expect(replayed.data).toEqual(pinned.data);
      expect(replayed.consistency).toEqual({
        kind: 'replay',
        pinnedAt: pinned.at,
        sourceSessionId: 'session-1',
        verifiedAt: replayed.at,
      });
      expect(replayed.usage).toBeUndefined();
      expect(pins.touchReplay).toHaveBeenCalledWith(lineage(), replayed.at);
      expect(pins.save).toHaveBeenCalledTimes(1);
      expect(events.at(-1)).toEqual({ type: 'done', session });
    });

    it('replays an expert answer with its trace and none of the expert passes', async () => {
      const { service, session, agent, expertMode, verifier } = pinningTurn({
        expertTrace: TRACE,
        crossCheck: { sql: SQL, rows: [{ n: 64 }] },
      });
      await ask(service, [], { expert: true });
      freshSession(session);
      const events: StreamEvent[] = [];

      await ask(service, events, { expert: true });

      expect(agent.stream).toHaveBeenCalledTimes(1);
      expect(expertMode.buildTrace).toHaveBeenCalledTimes(1);
      expect(verifier.generate).toHaveBeenCalledTimes(1);
      expect(events.some((e) => e.type === 'expert-status')).toBe(false);
      const replayed = session.messages.at(-1)!;
      expect(replayed.consistency?.kind).toBe('replay');
      expect(replayed.expertTrace).toEqual(TRACE);
      expect(replayed.crossCheck?.status).toBe('agree');
    });

    it('never replays an expert pin for a plain ask of the same question', async () => {
      const { service, session, agent } = pinningTurn({
        expertTrace: TRACE,
        crossCheck: { sql: SQL, rows: [{ n: 64 }] },
      });
      await ask(service, [], { expert: true });
      freshSession(session);
      nextStream(agent, answerStream([{ sql: SQL, rows: [{ n: 64 }] }]));

      await ask(service);

      expect(agent.stream).toHaveBeenCalledTimes(2);
      expect(session.messages.at(-1)?.consistency).toBeUndefined();
    });

    it('derives afresh and re-pins when the pinned SQL returns different rows', async () => {
      const { service, session, agent, pins, datasources } = pinningTurn();
      await ask(service);
      const first = session.messages.at(-1)!;
      freshSession(session);
      datasources.runReadOnlySql.mockResolvedValueOnce({
        columns: ['n'],
        rows: [{ n: 65 }],
      });
      nextStream(
        agent,
        answerStream([{ sql: SQL, rows: [{ n: 65 }] }], 'Revenue was 65.'),
      );

      await ask(service);

      expect(agent.stream).toHaveBeenCalledTimes(2);
      const message = session.messages.at(-1)!;
      expect(message.content).toBe('Revenue was 65.');
      expect(message.consistency).toEqual({
        kind: 'updated',
        pinnedAt: first.at,
        sourceSessionId: 'session-1',
      });
      expect(pins.save).toHaveBeenCalledTimes(2);
      const pin = pins.store.get(lineage())!;
      expect(pin.rows).toEqual([{ n: 65 }]);
      expect(pin.message.content).toBe('Revenue was 65.');
      expect(pin.sourceMessageAt).toBe(message.at);
    });

    it('keeps the pinned wording when the context moved but the rows did not', async () => {
      const { service, session, agent, pins, knowledge, datasources } =
        pinningTurn();
      await ask(service);
      const first = session.messages.at(-1)!;
      const before = pins.store.get(lineage())!.fingerprint;
      const learned = lesson('lesson-1', 'Fiscal year');
      knowledge.contextFor.mockResolvedValue({
        block: 'Curated dataset knowledge:\n- Fiscal year',
        used: [learned],
      });
      freshSession(session);
      const rewritten =
        'SELECT sum(amount) AS total FROM main.football.matches';
      nextStream(
        agent,
        answerStream([{ sql: rewritten, rows: [{ total: 64 }] }], 'It was 64.'),
      );

      await ask(service);

      // The fingerprint moved, so the pinned SQL is not even re-run.
      expect(datasources.runReadOnlySql).not.toHaveBeenCalled();
      expect(agent.stream).toHaveBeenCalledTimes(2);
      const message = session.messages.at(-1)!;
      expect(message.content).toBe(first.content);
      expect(message.consistency).toEqual({
        kind: 'kept',
        pinnedAt: first.at,
        sourceSessionId: 'session-1',
      });
      // Everything but the wording is this turn's fresh derivation.
      expect(message.knowledge).toEqual([learned]);
      expect(message.data?.[0]?.input).toBe(rewritten);
      const pin = pins.store.get(lineage())!;
      expect(pin.fingerprint).not.toBe(before);
      expect(pin.sql).toBe(rewritten);
      expect(pin.message.content).toBe(first.content);
      expect(pin.knowledgeIds).toEqual(['lesson-1']);
    });

    it('marks the answer updated, naming only the lessons new since the pin', async () => {
      const older = lesson('lesson-0', 'Order date');
      const { service, session, agent, knowledge } = pinningTurn({
        knowledgeUsed: [USER_TERM, older],
      });
      await ask(service);
      const first = session.messages.at(-1)!;
      knowledge.contextFor.mockResolvedValue({
        block: 'Curated dataset knowledge: …',
        used: [
          USER_TERM,
          older,
          lesson('lesson-1', 'Fiscal year'),
          lesson('lesson-2', 'Net revenue'),
        ],
      });
      freshSession(session);
      nextStream(
        agent,
        answerStream([{ sql: SQL, rows: [{ n: 70 }] }], 'Net revenue was 70.'),
      );

      await ask(service);

      const message = session.messages.at(-1)!;
      expect(message.content).toBe('Net revenue was 70.');
      expect(message.consistency).toEqual({
        kind: 'updated',
        pinnedAt: first.at,
        sourceSessionId: 'session-1',
        lessons: ['Fiscal year', 'Net revenue'],
      });
    });

    describe('never pins an ineligible turn', () => {
      it.each([
        ['a clarification', () => clarificationStream()],
        [
          'a truncated result',
          () =>
            answerStream([{ sql: SQL, rows: [{ n: 64 }], truncated: true }]),
        ],
        [
          'a result-guard warning',
          () =>
            answerStream([
              { sql: SQL, rows: [{ n: 64 }], warnings: ['join fan-out'] },
            ]),
        ],
        ['a failed query', () => answerStream([{ sql: SQL, error: 'boom' }])],
        ['an empty result', () => answerStream([{ sql: SQL, rows: [] }])],
        ['no SQL at all', () => answerStream([])],
        ['a visual tool turn', () => visualStream(SQL)],
      ])('%s', async (_label, stream) => {
        const { service, pins } = pinningTurn({}, stream());

        await ask(service);

        expect(pins.save).not.toHaveBeenCalled();
      });

      it('an expert answer whose trace could not be built', async () => {
        const { service, pins } = pinningTurn({ expertTrace: undefined });

        await ask(service, [], { expert: true });

        expect(pins.save).not.toHaveBeenCalled();
      });

      it.each([
        ['pin: false', { pin: false }],
        ['an open visual', { activeVisualId: 'visual-1' }],
      ])('%s — no lookup either', async (_label, flags) => {
        const { service, pins } = pinningTurn();

        await ask(service, [], flags);

        expect(pins.lookup).not.toHaveBeenCalled();
        expect(pins.save).not.toHaveBeenCalled();
      });

      it('the answer to a pending clarification — no lookup either', async () => {
        const { service, session, pins } = pinningTurn();
        session.messages = [
          { role: 'user', content: 'Revenue?', at: '2026-09-30T09:00:00.000Z' },
          {
            role: 'assistant',
            content: 'Which year?',
            at: '2026-09-30T09:00:01.000Z',
            clarification: { question: 'Which year?', options: [] },
          },
        ];

        await ask(service);

        expect(pins.lookup).not.toHaveBeenCalled();
        expect(pins.save).not.toHaveBeenCalled();
      });
    });

    it('answers normally when the pin lookup fails', async () => {
      const { service, session, agent, pins } = pinningTurn();
      pins.lookup.mockRejectedValueOnce(new Error('database is locked'));
      const events: StreamEvent[] = [];

      await ask(service, events);

      expect(agent.stream).toHaveBeenCalledTimes(1);
      expect(session.messages.at(-1)?.content).toBe('Here is the answer.');
      expect(session.messages.at(-1)?.consistency).toBeUndefined();
      expect(pins.save).not.toHaveBeenCalled();
      expect(events.at(-1)?.type).toBe('done');
    });

    it('derives afresh when re-running the pinned SQL fails', async () => {
      const { service, session, agent, datasources } = pinningTurn();
      await ask(service);
      freshSession(session);
      datasources.runReadOnlySql.mockRejectedValueOnce(
        new Error('connection refused'),
      );
      nextStream(agent, answerStream([{ sql: SQL, rows: [{ n: 64 }] }]));

      await ask(service);

      expect(agent.stream).toHaveBeenCalledTimes(2);
      expect(session.messages.at(-1)?.consistency?.kind).toBe('kept');
    });

    it('never fails a turn because its pin could not be saved', async () => {
      const { service, session, pins } = pinningTurn();
      pins.save.mockRejectedValueOnce(new Error('disk full'));
      const events: StreamEvent[] = [];

      await ask(service, events);

      expect(session.messages.at(-1)?.content).toBe('Here is the answer.');
      expect(events.at(-1)?.type).toBe('done');
    });

    describe('feedback', () => {
      it('approves the pin on 👍 — re-keyed, verified, rescored — and the next ask replays it', async () => {
        const { service, session, agent, pins, verifiedQueries } = pinningTurn({
          expertTrace: TRACE,
          crossCheck: { sql: SQL, rows: [{ n: 64 }] },
        });
        await ask(service, [], { expert: true });
        const answer = session.messages.at(-1)!;
        const before = pins.store.get(lineage('expert'))!.fingerprint;
        const beforeParts = pins.store.get(lineage('expert'))!.fingerprintParts;
        // The 👍 adds this pair to the verified library, so the verified block
        // this question gets from now on changes.
        verifiedQueries.referenceBlock.mockResolvedValue(
          `Verified reference queries:\n- ${QUESTION} → ${SQL}`,
        );

        await service.recordFeedback('session-1', answer.at, 'up');

        expect(verifiedQueries.save).toHaveBeenCalledTimes(1);
        expect(pins.approve).toHaveBeenCalledTimes(1);
        const [key, patch] = (pins.approve.mock.calls as unknown[][])[0] as [
          string,
          {
            fingerprint: string;
            fingerprintParts: AnswerPinDoc['fingerprintParts'];
            message: ChatMessage;
          },
        ];
        expect(key).toBe(lineage('expert'));
        expect(patch.fingerprint).not.toBe(before);
        // Only the verified part moved, and the stored parts hash to the key.
        expect(patch.fingerprintParts.verified).not.toBe(beforeParts.verified);
        expect(patch.fingerprintParts.knowledge).toBe(beforeParts.knowledge);
        expect(fingerprintFor(patch.fingerprintParts)).toBe(patch.fingerprint);
        expect(patch.message.verified).toBe(true);
        expect(patch.message.expertTrace?.overall.score).toBeGreaterThanOrEqual(
          0.85,
        );
        expect(
          patch.message.expertTrace?.overall.signals.map((s) => s.id),
        ).toContain('verified_match');
        const rated = session.messages.at(-1)!;
        expect(rated.verified).toBe(true);
        expect(rated.feedback).toBe('up');
        expect(rated.expertTrace?.overall.band).toBe('high');

        // The recomputed key is exactly the one the next ask computes.
        freshSession(session);
        await ask(service, [], { expert: true });

        expect(agent.stream).toHaveBeenCalledTimes(1);
        const replayed = session.messages.at(-1)!;
        expect(replayed.consistency?.kind).toBe('replay');
        expect(replayed.verified).toBe(true);
        expect(replayed.expertTrace?.overall.band).toBe('high');
      });

      it('recomputes the same fingerprint the turn keyed when nothing moved', async () => {
        const { service, session, pins } = pinningTurn({
          knowledgeUsed: [USER_TERM],
          metricsBlock: 'Governed metric definitions (curated — …):\n- Revenue',
        });
        await ask(service);
        const pinned = pins.store.get(lineage())!;

        await service.recordFeedback(
          'session-1',
          session.messages.at(-1)!.at,
          'up',
        );

        const patch = (pins.approve.mock.calls as unknown[][])[0][1] as {
          fingerprint: string;
        };
        expect(patch.fingerprint).toBe(pinned.fingerprint);
      });

      it('does not let a 👍 on an older answer vouch for a newer pin', async () => {
        const { service, session, pins } = pinningTurn();
        await ask(service);
        pins.store.get(lineage())!.message.content = 'A newer answer.';

        await service.recordFeedback(
          'session-1',
          session.messages.at(-1)!.at,
          'up',
        );

        expect(pins.approve).not.toHaveBeenCalled();
      });

      it('marks the pin rejected — not deleted — and withdraws the verified pair on 👎', async () => {
        const { service, session, pins, verifiedQueries } = pinningTurn();
        await ask(service);
        const answer = session.messages.at(-1)!;

        await service.recordFeedback('session-1', answer.at, 'down');

        expect(pins.reject).toHaveBeenCalledWith(
          lineage(),
          expect.any(String),
          undefined,
        );
        const pin = pins.store.get(lineage())!;
        expect(pin.rejectedAt).toEqual(expect.any(String));
        expect(pin.sql).toBe(SQL);
        expect(verifiedQueries.removeForMessage).toHaveBeenCalledWith(
          'session-1',
          answer.at,
        );
        expect(session.messages.at(-1)?.verified).toBeUndefined();
      });

      it('lifts a rejection on a later 👍, storing the recomputed fingerprint parts', async () => {
        const { service, session, pins } = pinningTurn();
        await ask(service);
        const answer = session.messages.at(-1)!;
        const saved = pins.store.get(lineage())!;
        await service.recordFeedback('session-1', answer.at, 'down');

        await service.recordFeedback('session-1', answer.at, 'up');

        const patch = (pins.approve.mock.calls as unknown[][])[0][1] as {
          fingerprintParts: AnswerPinDoc['fingerprintParts'];
        };
        expect(patch.fingerprintParts).toEqual(saved.fingerprintParts);
        const pin = pins.store.get(lineage())!;
        expect(pin).not.toHaveProperty('rejectedAt');
        expect(pin.message.verified).toBe(true);
      });
    });

    describe('a rejected pin', () => {
      /** One answered turn whose pin a reviewer then rejected. */
      async function rejectedTurn(
        options: Parameters<typeof buildStreaming>[1] = {},
      ) {
        const built = pinningTurn(options);
        await ask(built.service);
        const rejected = built.session.messages.at(-1)!;
        await built.service.recordFeedback('session-1', rejected.at, 'down');
        freshSession(built.session);
        return { ...built, rejected };
      }

      it('is never replayed, even under the same fingerprint with identical rows', async () => {
        const { service, agent, pins, datasources } = await rejectedTurn();
        // Were the SQL re-run, it would match the pin exactly.
        datasources.runReadOnlySql.mockResolvedValue({
          columns: ['n'],
          rows: [{ n: 64 }],
        });
        nextStream(agent, answerStream([{ sql: SQL, rows: [{ n: 70 }] }]));
        const events: StreamEvent[] = [];

        await ask(service, events);

        // Not even re-run: a rejected pin is never a replay candidate.
        expect(datasources.runReadOnlySql).not.toHaveBeenCalled();
        expect(agent.stream).toHaveBeenCalledTimes(2);
        expect(pins.touchReplay).not.toHaveBeenCalled();
        expect(events.at(-1)?.type).toBe('done');
      });

      it('an answer with different rows is updated, naming the lessons learned since', async () => {
        const { service, session, agent, pins, knowledge, rejected } =
          await rejectedTurn({ knowledgeUsed: [USER_TERM] });
        knowledge.contextFor.mockResolvedValue({
          block: 'Curated dataset knowledge: …',
          used: [USER_TERM, lesson('lesson-1', 'Fiscal year')],
        });
        nextStream(
          agent,
          answerStream(
            [{ sql: SQL, rows: [{ n: 70 }] }],
            'Net revenue was 70.',
          ),
        );

        await ask(service);

        const message = session.messages.at(-1)!;
        expect(message.content).toBe('Net revenue was 70.');
        expect(message.consistency).toEqual({
          kind: 'updated',
          pinnedAt: rejected.at,
          sourceSessionId: 'session-1',
          lessons: ['Fiscal year'],
        });
        // The fresh derivation replaces the rejected pin, un-rejected.
        const pin = pins.store.get(lineage())!;
        expect(pin).not.toHaveProperty('rejectedAt');
        expect(pin.rows).toEqual([{ n: 70 }]);
        expect(pin.message.content).toBe('Net revenue was 70.');
      });

      it('an answer reproducing the rejected rows claims no continuity and keeps its own wording', async () => {
        const { service, session, agent, pins } = await rejectedTurn();
        nextStream(
          agent,
          answerStream([{ sql: SQL, rows: [{ n: 64 }] }], 'It was 64 again.'),
        );

        await ask(service);

        const message = session.messages.at(-1)!;
        expect(message.content).toBe('It was 64 again.');
        expect(message).not.toHaveProperty('consistency');
        const pin = pins.store.get(lineage())!;
        expect(pin).not.toHaveProperty('rejectedAt');
        expect(pin.message.content).toBe('It was 64 again.');
      });

      it('replays normally again once its replacement is pinned', async () => {
        const { service, session, agent, datasources } = await rejectedTurn();
        nextStream(agent, answerStream([{ sql: SQL, rows: [{ n: 64 }] }]));
        await ask(service);
        freshSession(session);
        datasources.runReadOnlySql.mockResolvedValueOnce({
          columns: ['n'],
          rows: [{ n: 64 }],
        });

        await ask(service);

        expect(agent.stream).toHaveBeenCalledTimes(2);
        expect(session.messages.at(-1)?.consistency?.kind).toBe('replay');
      });
    });
  });

  describe('memory catch-up after replays', () => {
    const at = (n: number) => `2026-09-30T10:00:0${n}.000Z`;
    const replay = { kind: 'replay' as const, pinnedAt: at(0) };

    it('prepends the replayed exchanges, stopping at the last real answer', async () => {
      const { service, session, agent } = buildStreaming(answerStream([]));
      session.messages = [
        { role: 'user', content: 'Q0', at: at(0) },
        { role: 'assistant', content: 'A0', at: at(1) },
        { role: 'user', content: 'Q1', at: at(2) },
        { role: 'assistant', content: 'A1', at: at(3), consistency: replay },
        { role: 'user', content: 'Q2', at: at(4) },
        { role: 'assistant', content: 'A2', at: at(5), consistency: replay },
      ];

      await service.streamMessage('session-1', 'Q3', () => {});

      expect((agent.stream.mock.calls as unknown[][])[0][0]).toEqual([
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
        { role: 'user', content: 'Q3' },
      ]);
    });

    it('sends just the question after a real derivation, kept or updated included', async () => {
      const { service, session, agent } = buildStreaming(answerStream([]));
      session.messages = [
        { role: 'user', content: 'Q1', at: at(0) },
        { role: 'assistant', content: 'A1', at: at(1), consistency: replay },
        { role: 'user', content: 'Q2', at: at(2) },
        {
          role: 'assistant',
          content: 'A2',
          at: at(3),
          consistency: { kind: 'kept', pinnedAt: at(0) },
        },
      ];

      await service.streamMessage('session-1', 'Q3', () => {});

      expect((agent.stream.mock.calls as unknown[][])[0][0]).toBe('Q3');
    });

    it('keeps the clarification catch-up exactly as before', async () => {
      const { service, session, agent } = buildStreaming(answerStream([]));
      session.messages = [
        { role: 'user', content: 'Revenue?', at: at(0) },
        {
          role: 'assistant',
          content: 'Which year?',
          at: at(1),
          clarification: { question: 'Which year?', options: [] },
        },
      ];

      await service.streamMessage('session-1', '2025', () => {});

      expect((agent.stream.mock.calls as unknown[][])[0][0]).toEqual([
        { role: 'assistant', content: 'Which year?' },
        { role: 'user', content: '2025' },
      ]);
    });
  });
});

describe('SessionsService SQL self-correction', () => {
  /** The `run_readonly_sql` bridge SessionsService installs for the tools. */
  async function bridge(overrides: {
    runs: jest.Mock;
    fixerReplies?: ({ sql: string } | undefined)[];
  }) {
    const fixer = { generate: jest.fn() };
    for (const reply of overrides.fixerReplies ?? []) {
      fixer.generate.mockResolvedValueOnce({ object: reply });
    }
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
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.onModuleInit();
    const calls = (setDatasetToolServices as jest.Mock).mock
      .calls as unknown[][];
    const installed = calls.at(-1)![0] as DatasetToolServices;
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
    const pins = pinsDouble();
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
      pins as never,
      {} as never,
    );
    return { service, verifiedQueries, pins };
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

  it('rejects the pin of the rated answer’s lineage on thumbs-down', async () => {
    const session = answered();
    const { service, pins } = build(session);

    await service.recordFeedback(
      'session-1',
      '2024-01-01T00:00:03.000Z',
      'down',
    );

    // The question it answered, every user message before it, plain mode —
    // the key the chat turn computed when it pinned this answer.
    expect(pins.reject).toHaveBeenCalledWith(
      lineageKeyFor({
        question: 'How many claims were denied last year?',
        datasets: ['claims'],
        chain: ['ignore me'],
        mode: 'plain',
      }),
      expect.any(String),
      undefined,
    );
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

describe('SessionsService reasoning-block feedback', () => {
  const AT = '2026-09-29T10:00:03.000Z';
  const SQL_BLOCK = {
    kind: 'sql' as const,
    sql: 'SELECT 1',
    annotations: [],
    confidence: { score: 0.9, band: 'high' as const, signals: [] },
  };

  const FINAL_SQL = 'SELECT avg(salary) AS avg_salary FROM main.hr.employees';
  const LESSONS = [
    {
      id: 'lesson-1',
      kind: 'term' as const,
      title: 'Fiscal year',
      body: 'Runs 1 February to 31 January.',
      method: 'agent' as const,
    },
  ];

  function build(withTrace = true) {
    const session: SessionDoc = {
      id: 'session-1',
      name: 'HR',
      datasets: ['hr'],
      visualizations: [],
      messages: [
        {
          role: 'user',
          content: 'Average tech salary in 2025?',
          at: '2026-09-29T10:00:00.000Z',
        },
        {
          role: 'assistant',
          content: '$132,400.',
          at: AT,
          verified: true,
          entities: ['main.hr.employees'],
          data: [
            {
              tool: 'run_readonly_sql',
              input: FINAL_SQL,
              columns: ['avg_salary'],
              rows: [{ avg_salary: 132400 }],
              rowCount: 1,
            },
          ],
          ...(withTrace
            ? {
                expertTrace: {
                  id: 'trace-1',
                  version: 1 as const,
                  blocks: [SQL_BLOCK],
                  overall: { score: 0.9, band: 'high' as const, signals: [] },
                  generatedAt: AT,
                },
              }
            : {}),
        },
      ],
    };
    const repository = {
      get: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockImplementation(async (_id, patch) => {
        Object.assign(session, patch);
        return session;
      }),
    };
    const stored: Record<string, unknown> = {};
    const expertMode = {
      saveFeedback: jest
        .fn()
        .mockImplementation(
          (
            key: Record<string, unknown>,
            context: Record<string, unknown>,
            patch: { vote?: string | null; comment?: string | null },
          ) => {
            if (patch.vote === null) delete stored.vote;
            else if (patch.vote) stored.vote = patch.vote;
            if (patch.comment === null || patch.comment === '') {
              delete stored.comment;
            } else if (patch.comment) stored.comment = patch.comment;
            return Promise.resolve({
              id: 'f-1',
              ...key,
              ...context,
              ...stored,
              createdAt: '2026-09-29T11:00:00.000Z',
              updatedAt: '2026-09-29T11:00:00.000Z',
            });
          },
        ),
    };
    const entities = [
      {
        key: 'main.hr.employees',
        columns: [{ name: 'salary', type: 'double', nullable: false }],
      },
    ];
    const verifiedQueries = {
      save: jest.fn().mockResolvedValue({}),
      removeForMessage: jest.fn().mockResolvedValue(1),
      referenceBlock: jest.fn().mockResolvedValue(undefined),
    };
    const knowledge = {
      list: jest.fn().mockResolvedValue([{ title: 'Tech department' }]),
      contextFor: jest.fn().mockResolvedValue({ block: '', used: [] }),
    };
    const learning = {
      learnFromComment: jest
        .fn()
        .mockResolvedValue({ lessons: LESSONS, superseded: 0 }),
      forget: jest.fn().mockResolvedValue(1),
    };
    const pins = pinsDouble();
    const service = new SessionsService(
      repository as never,
      {} as never,
      {
        getByNames: jest.fn().mockResolvedValue([
          {
            name: 'hr',
            datasourceId: 'ds-1',
            tables: ['main.hr.employees'],
            entities,
          },
        ]),
      } as never,
      {} as never,
      {
        getView: jest.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
      } as never,
      {} as never,
      verifiedQueries as never,
      { definitionBlock: jest.fn().mockResolvedValue(undefined) } as never,
      knowledge as never,
      expertMode as never,
      pins as never,
      learning as never,
    );
    return {
      service,
      session,
      expertMode,
      learning,
      pins,
      verifiedQueries,
      knowledge,
      entities,
    };
  }

  it('stores the rating with the question and block, and mirrors it onto the trace', async () => {
    const { service, session, expertMode } = build();

    const updated = await service.recordBlockFeedback('session-1', {
      messageAt: AT,
      block: 'sql',
      vote: 'down',
      comment: 'Should use the 31 December rate',
    });

    expect(expertMode.saveFeedback).toHaveBeenCalledWith(
      { sessionId: 'session-1', messageAt: AT, block: 'sql' },
      {
        traceId: 'trace-1',
        question: 'Average tech salary in 2025?',
        blockSnapshot: SQL_BLOCK,
      },
      { vote: 'down', comment: 'Should use the 31 December rate' },
    );
    expect(updated.session.messages[1].expertTrace?.feedback).toEqual({
      sql: {
        vote: 'down',
        comment: 'Should use the 31 December rate',
        at: '2026-09-29T11:00:00.000Z',
      },
    });
    expect(session.messages[1].expertTrace?.blocks).toEqual([SQL_BLOCK]);
  });

  it('applies PATCH semantics and drops the mirror once both fields are cleared', async () => {
    const { service, expertMode } = build();
    await service.recordBlockFeedback('session-1', {
      messageAt: AT,
      block: 'sql',
      vote: 'up',
    });

    const commented = await service.recordBlockFeedback('session-1', {
      messageAt: AT,
      block: 'sql',
      comment: 'Good',
    });
    expect((expertMode.saveFeedback.mock.calls as unknown[][])[1][2]).toEqual({
      comment: 'Good',
    });
    expect(commented.session.messages[1].expertTrace?.feedback?.sql).toEqual(
      expect.objectContaining({ vote: 'up', comment: 'Good' }),
    );

    await service.recordBlockFeedback('session-1', {
      messageAt: AT,
      block: 'sql',
      vote: null,
    });
    const cleared = await service.recordBlockFeedback('session-1', {
      messageAt: AT,
      block: 'sql',
      comment: null,
    });
    expect(cleared.session.messages[1].expertTrace?.feedback).toEqual({});
  });

  describe('learning and pinning', () => {
    const lineage = lineageKeyFor({
      question: 'Average tech salary in 2025?',
      datasets: ['hr'],
      chain: [],
      mode: 'expert',
    });

    it('learns from a new comment once and returns the lessons', async () => {
      const { service, learning, entities } = build();

      const result = await service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'sql',
        comment: 'Tech means department = Engineering',
      });

      expect(learning.learnFromComment).toHaveBeenCalledTimes(1);
      expect(learning.learnFromComment).toHaveBeenCalledWith({
        sessionId: 'session-1',
        messageAt: AT,
        feedbackId: 'f-1',
        datasets: ['hr'],
        question: 'Average tech salary in 2025?',
        answer: '$132,400.',
        block: 'sql',
        comment: 'Tech means department = Engineering',
        blockSnapshot: SQL_BLOCK,
        finalSql: FINAL_SQL,
        entities,
        existingTitles: ['Tech department'],
      });
      expect(result.lessons).toEqual(LESSONS);
      expect(learning.forget).not.toHaveBeenCalled();
    });

    it('does not re-learn when the comment did not change', async () => {
      const { service, learning } = build();
      await service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'sql',
        comment: 'Tech means department = Engineering',
      });

      const again = await service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'sql',
        comment: 'Tech means department = Engineering',
      });
      const voteOnly = await service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'sql',
        vote: 'down',
      });

      expect(learning.learnFromComment).toHaveBeenCalledTimes(1);
      expect(again.lessons).toBeUndefined();
      expect(voteOnly.lessons).toBeUndefined();
    });

    it('re-learns an edited comment and forgets a cleared one', async () => {
      const { service, learning } = build();
      await service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'sql',
        comment: 'first note',
      });
      await service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'sql',
        comment: 'edited note',
      });
      expect(learning.learnFromComment).toHaveBeenCalledTimes(2);

      const cleared = await service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'sql',
        comment: null,
      });

      expect(learning.forget).toHaveBeenCalledWith('f-1');
      expect(cleared.lessons).toBeUndefined();
    });

    it('still saves the rating when learning fails', async () => {
      const { service, learning, session } = build();
      learning.learnFromComment.mockRejectedValueOnce(new Error('db locked'));

      const result = await service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'sql',
        comment: 'Tech means Engineering',
      });

      expect(result.lessons).toBeUndefined();
      expect(session.messages[1].expertTrace?.feedback?.sql?.comment).toBe(
        'Tech means Engineering',
      );
    });

    it('a 👎 on a block marks the pin rejected by that block, removes the verified pair and clears the badge', async () => {
      const { service, session, pins, verifiedQueries } = build();

      await service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'sql',
        vote: 'down',
      });

      expect(pins.reject).toHaveBeenCalledWith(lineage, expect.any(String), {
        block: 'sql',
      });
      expect(verifiedQueries.removeForMessage).toHaveBeenCalledWith(
        'session-1',
        AT,
      );
      expect(session.messages[1].verified).toBeUndefined();
    });

    it('a 👍 on the SQL block approves the answer like a whole-answer 👍', async () => {
      const { service, session, pins, verifiedQueries } = build();
      delete session.messages[1].verified;
      pins.store.set(lineage, {
        lineageKey: lineage,
        fingerprint: 'stale',
        message: stripForPin(session.messages[1]),
      } as AnswerPinDoc);

      await service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'sql',
        vote: 'up',
      });

      expect(verifiedQueries.save).toHaveBeenCalledWith(
        expect.objectContaining({
          question: 'Average tech salary in 2025?',
          sql: FINAL_SQL,
          sourceMessageAt: AT,
        }),
      );
      const approved = pins.store.get(lineage)!;
      expect(approved.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(approved.message.verified).toBe(true);
      const message = session.messages[1];
      expect(message.verified).toBe(true);
      expect(
        message.expertTrace?.overall.signals.map((signal) => signal.id),
      ).toContain('verified_match');
      // The block rating is still mirrored on the rescored trace.
      expect(message.expertTrace?.feedback?.sql?.vote).toBe('up');
    });

    it('a 👍 on another block records the rating only', async () => {
      const { service, pins, verifiedQueries, session } = build();
      session.messages[1].expertTrace!.blocks.push({
        kind: 'metric',
        confidence: { score: 0.9, band: 'high', signals: [] },
      } as never);

      await service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'metric',
        vote: 'up',
      });

      expect(verifiedQueries.save).not.toHaveBeenCalled();
      expect(pins.lookup).not.toHaveBeenCalled();
      expect(pins.reject).not.toHaveBeenCalled();
    });
  });

  it('rejects bad bodies before touching the session', async () => {
    const { service, expertMode } = build();

    await expect(
      service.recordBlockFeedback('session-1', { block: 'sql', vote: 'up' }),
    ).rejects.toThrow('messageAt is required');
    await expect(
      service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'nope' as never,
        vote: 'up',
      }),
    ).rejects.toThrow('block must be one of');
    await expect(
      service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'sql',
        vote: 'sideways' as never,
      }),
    ).rejects.toThrow("vote must be 'up', 'down' or null");
    await expect(
      service.recordBlockFeedback('session-1', { messageAt: AT, block: 'sql' }),
    ).rejects.toThrow('send a vote, a comment, or both');
    expect(expertMode.saveFeedback).not.toHaveBeenCalled();
  });

  it('refuses an answer without a trace, a missing block or an unknown message', async () => {
    await expect(
      build(false).service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'sql',
        vote: 'up',
      }),
    ).rejects.toThrow('no reasoning trace');
    await expect(
      build().service.recordBlockFeedback('session-1', {
        messageAt: AT,
        block: 'metric',
        vote: 'up',
      }),
    ).rejects.toThrow('no metric block');
    await expect(
      build().service.recordBlockFeedback('session-1', {
        messageAt: '1999-01-01T00:00:00.000Z',
        block: 'sql',
        vote: 'up',
      }),
    ).rejects.toThrow('No assistant message');
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
    /** The statement the SQL fixer ran instead of the one written. */
    correctedSql?: string;
    /** Result-guard verdicts the tool attached to the result. */
    warnings?: string[];
  }[],
  answer = 'Here is the answer.',
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
              ...(run.correctedSql ? { correctedSql: run.correctedSql } : {}),
              ...(run.warnings ? { warnings: run.warnings } : {}),
            },
      },
    };
  }
  yield { type: 'text-delta', payload: { text: answer } };
}

/** One SQL run, then the model builds an interactive visual from it. */
async function* visualStream(sql: string) {
  yield* answerStream([{ sql, rows: [{ n: 64 }] }], '');
  yield {
    type: 'tool-call',
    payload: {
      toolCallId: 'call-visual',
      toolName: 'create_visual',
      args: { instruction: 'chart it' },
    },
  };
  yield {
    type: 'tool-result',
    payload: {
      toolCallId: 'call-visual',
      toolName: 'create_visual',
      result: { visualId: 'visual-1', version: 1, title: 'Revenue' },
    },
  };
  yield { type: 'text-delta', payload: { text: 'Here is the chart.' } };
}

/** An in-memory `AnswerPinsService`, keyed by lineage like the real one. */
function pinsDouble(store = new Map<string, AnswerPinDoc>()) {
  return {
    store,
    lookup: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    save: jest.fn((doc: AnswerPinDoc) => {
      store.set(doc.lineageKey, doc);
      return Promise.resolve(doc);
    }),
    approve: jest.fn((key: string, patch: Partial<AnswerPinDoc>) => {
      const pin = store.get(key);
      if (!pin) return Promise.resolve(null);
      // Approval lifts a rejection, like the real service.
      const { rejectedAt, rejectedBy, ...rest } = { ...pin, ...patch };
      void rejectedAt;
      void rejectedBy;
      store.set(key, rest);
      return Promise.resolve(rest);
    }),
    reject: jest.fn((key: string, at: string, by?: { block?: string }) => {
      const pin = store.get(key);
      if (!pin) return Promise.resolve(0);
      const { rejectedBy, ...rest } = pin;
      void rejectedBy;
      store.set(key, {
        ...rest,
        rejectedAt: at,
        ...(by ? { rejectedBy: by } : {}),
      });
      return Promise.resolve(1);
    }),
    remove: jest.fn((key: string) =>
      Promise.resolve(store.delete(key) ? 1 : 0),
    ),
    touchReplay: jest.fn((key: string, at: string) => {
      const pin = store.get(key);
      if (!pin) return Promise.resolve(null);
      const next = { ...pin, replays: pin.replays + 1, lastReplayedAt: at };
      store.set(key, next);
      return Promise.resolve(next);
    }),
  };
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
