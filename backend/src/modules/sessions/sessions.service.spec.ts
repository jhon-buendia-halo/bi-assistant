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
// `marked` is ESM-only; stub the document builder so the suite runs under
// Jest's CommonJS transform.
jest.mock('./visualization-document', () => ({
  sourceEntities: jest.fn().mockReturnValue([]),
}));

// `marked` is ESM-only; the PDF renderer is stubbed to echo its markdown.
jest.mock('../../common/markdown-pdf', () => ({
  renderPdf: jest.fn((markdown: string) =>
    Promise.resolve(Buffer.from(`%PDF-stub ${markdown}`)),
  ),
}));
jest.mock('./workspace-files', () => {
  const actual =
    jest.requireActual<typeof import('./workspace-files')>('./workspace-files');
  return {
    ...actual,
    readWorkspaceFile: jest.fn(actual.readWorkspaceFile),
  };
});

import { BadRequestException, Logger } from '@nestjs/common';
import { resolveAgentModelConfig } from '../../mastra/model-resolver';
import { appSkillBody } from '../../mastra/app-skills';

/** No session in these tests was started from a user agent. */
const userAgentsStub = {
  get: jest.fn().mockResolvedValue(null),
  list: jest.fn().mockResolvedValue([]),
  datasetNames: jest.fn().mockResolvedValue(new Set<string>()),
};
import { setDatasetToolServices } from '../../mastra/tool-services';
import type { DatasetToolServices } from '../../mastra/tool-services';
import {
  QUERY_FACTS_CONTEXT_KEY,
  queryFactsKey,
} from './query-evidence/query-facts';
import { sourceEntities } from './visualization-document';
import { renderPdf } from '../../common/markdown-pdf';
import { readWorkspaceFile } from './workspace-files';
import {
  SessionsService,
  StreamEvent,
  toolCallInput,
} from './sessions.service';
import { streamStored } from './testing/stream-stored';
import type { SessionDoc } from './entities/session.entity';
import { streamTurnWorkflow } from '../../mastra/testing/turn-workflow.stub';

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
    } = {},
  ) {
    const session: SessionDoc = {
      id: 'session-1',
      name: 'World Cup analysis',
      datasets: ['football'],
      // Bound to Michael: every turn runs a registered agent (ADR-0059).
      agentKey: 'insights-analyst',
      messages: [],
      visualizations: [],
    };
    const repository = {
      get: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockImplementation((_id, patch) => {
        Object.assign(session, patch);
        return Promise.resolve(session);
      }),
    };
    const userAgents = userAgentsStub;
    const agent = {
      getMemory: jest.fn().mockResolvedValue({
        getThreadById: jest.fn().mockResolvedValue({ id: session.id }),
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
    const datasources = {
      runReadOnlySql: jest.fn().mockResolvedValue({ columns: ['n'], rows: [] }),
    };
    const llm = {
      getView: jest.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
    };
    const service = new SessionsService(
      repository as never,
      {
        getAgent: jest.fn().mockReturnValue(agent),
        listAgents: () => ({ 'insights-analyst': agent }),
        streamWorkflow: streamTurnWorkflow,
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
      userAgents as never,
    );
    return {
      service,
      session,
      agent,
      verifiedQueries,
      metrics,
      knowledge,
      datasources,
      repository,
      llm,
    };
  }

  beforeEach(() => {
    (sourceEntities as jest.Mock).mockReturnValue([]);
    (resolveAgentModelConfig as jest.Mock).mockResolvedValue(
      'openai/gpt-4.1-mini',
    );
  });

  // Mastra names an OpenAI-compatible client's provider-options bucket after
  // the provider id, so the reasoning-effort chip was a silent no-op on every
  // LenAI deployment while this key was hardcoded to `openai`.
  it('files provider options under the bucket the configured model reads', async () => {
    (resolveAgentModelConfig as jest.Mock).mockResolvedValue({
      id: 'lenai/mmc-tech-gpt-41-mini-1m-2025-04-14',
      apiKey: 'len-key',
      url: 'https://lenai.example.com/openai/v1/deployments/x',
    });
    const { service, agent } = buildStreaming(toolOnlyStream(15));

    await streamStored(
      service,
      'session-1',
      'Why did Argentina win?',
      () => {},
    );

    const options = agent.generate.mock.calls.map(
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

  // llm-settings R51: Mastra reports a failed model call as an `error` chunk;
  // on a custom endpoint the turn fails with the R50 text.
  it.each([
    [
      'an unreachable host',
      apiCallError(undefined, {
        cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8317'), {
          code: 'ECONNREFUSED',
        }),
      }),
      'Could not reach 127.0.0.1:8317 — check the base URL and that the server is running',
    ],
    [
      'a 404',
      apiCallError(404),
      'The endpoint answered 404 at http://127.0.0.1:8317/v1/chat/completions — check the base URL (OpenAI-compatible servers usually end in /v1)',
    ],
    [
      'a rejected key',
      apiCallError(401),
      'The endpoint rejected the API key (401)',
    ],
  ])(
    'fails a custom endpoint turn on %s in the words of R50',
    async (_label, error, message) => {
      const { service, llm } = buildStreaming(errorChunkStream(error));
      llm.getView.mockResolvedValue({
        provider: 'custom',
        baseUrl: 'http://127.0.0.1:8317/v1',
        reasoningEffort: 'medium',
      });

      await expect(
        streamStored(service, 'session-1', 'Why?', () => {}),
      ).rejects.toThrow(message);
    },
  );

  it("keeps today's handling of a model failure for other providers", async () => {
    const { service, session } = buildStreaming(
      errorChunkStream(apiCallError(401)),
    );

    await streamStored(service, 'session-1', 'Why?', () => {});

    expect(session.messages.at(-1)?.role).toBe('assistant');
  });

  it('synthesizes a final answer after a tool-only turn', async () => {
    const { service, session, agent } = buildStreaming(toolOnlyStream(15));
    const events: StreamEvent[] = [];

    await streamStored(
      service,
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
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      session: { id: 'session-1', messages: session.messages },
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

    await streamStored(service, 'session-1', 'Why?', () => {});

    expect(session.messages.at(-1)?.interpretation).toBe(
      'Computed from 2 queries over main.football.matches — 3 rows analyzed.',
    );
  });

  it('stores one evidence entry per data record, from the facts beside the results (plan m1-25 1.25.1)', async () => {
    const streamed: { agent?: { stream: jest.Mock } } = {};
    // The tools write their facts into the turn's map as they run; the
    // stand-in stream does the same before it hands out the chunks.
    function* withFacts(): Generator<unknown> {
      const options = (
        streamed.agent!.stream.mock.calls as unknown[][]
      )[0][1] as {
        requestContext: { get: (key: string) => unknown };
      };
      const facts = options.requestContext.get(QUERY_FACTS_CONTEXT_KEY) as Map<
        string,
        unknown
      >;
      facts.set('call-0', {
        datasourceId: 'ds-1',
        totalRows: 1870,
        rowLimit: 2,
      });
      facts.set(queryFactsKey('run_readonly_sql', 'select 2'), {
        datasourceId: 'ds-1',
        totalRows: 1,
        rowLimit: 100,
      });
      yield* answerChunks([
        { sql: 'select 1', rows: [{ n: 1 }, { n: 2 }], truncated: true },
        { sql: 'select 2', rows: [{ n: 3 }] },
        { sql: 'select nope', error: 'column "nope" does not exist' },
      ]);
    }
    const { service, session, agent } = buildStreaming(streamOf(withFacts()));
    streamed.agent = agent;

    await streamStored(service, 'session-1', 'Why?', () => {});

    const answer = session.messages.at(-1);
    expect(answer?.data).toHaveLength(3);
    expect(answer?.evidence).toEqual([
      {
        index: 0,
        coverage: 'partial',
        datasourceId: 'ds-1',
        totalRows: 1870,
        rowLimit: 2,
      },
      {
        index: 1,
        coverage: 'whole-table',
        datasourceId: 'ds-1',
        totalRows: 1,
        rowLimit: 100,
      },
      { index: 2 },
    ]);
  });

  it('stores evidence on a clarification card too', async () => {
    const { service, session } = buildStreaming(clarificationStream());

    await streamStored(service, 'session-1', 'Who won?', () => {});

    expect(session.messages.at(-1)?.clarification).toBeDefined();
    expect(session.messages.at(-1)?.evidence).toEqual([
      { index: 0, coverage: 'whole-table' },
    ]);
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

    await streamStored(service, 'session-1', 'Why?', () => {});

    expect(session.messages.at(-1)?.knowledge).toEqual(used);
  });

  describe('the curated-knowledge block, its skill on demand (agents.md 4.1, 7.4)', () => {
    const BLOCK =
      'Curated dataset knowledge (user-authored — treat as authoritative over anything you infer from schema):\n- [instruction] Coverage: only 2018 and 2022.';
    type Context = { role: string; content: string }[];
    const streamedContext = (agent: { stream: jest.Mock }) =>
      ((agent.stream.mock.calls as unknown[][])[0][1] as { context: Context })
        .context;
    /** The block is sent, and the skill's rules are not (ADR-0020). */
    const expectBlockWithoutRules = (context: Context) => {
      expect(context.filter((m) => m.content === BLOCK)).toHaveLength(1);
      expect(
        context.some((m) => m.content.includes('Curated knowledge:')),
      ).toBe(false);
      expect(
        context.some((m) => m.content === appSkillBody('curated-knowledge')),
      ).toBe(false);
    };

    it('sends the knowledge block without the skill', async () => {
      const { service, agent } = buildStreaming(
        answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
        { knowledgeBlock: BLOCK },
      );

      await streamStored(service, 'session-1', 'Who won?', () => {});

      expectBlockWithoutRules(streamedContext(agent));
    });

    it('sends no knowledge rules when no knowledge applies', async () => {
      const { service, agent } = buildStreaming(
        answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
      );

      await streamStored(service, 'session-1', 'Who won?', () => {});

      const text = streamedContext(agent)
        .map((m) => m.content)
        .join('\n');
      expect(text).not.toContain('Curated dataset knowledge');
      expect(text).not.toContain('Curated knowledge:');
    });
  });

  it('omits the knowledge record when no snippet applied', async () => {
    const { service, session } = buildStreaming(
      answerStream([{ sql: 'select 1', rows: [{ n: 1 }] }]),
    );

    await streamStored(service, 'session-1', 'Why?', () => {});

    expect(session.messages.at(-1)?.knowledge).toBeUndefined();
  });

  it('omits the interpretation line when no SQL ran', async () => {
    const { service, session } = buildStreaming(answerStream([]));

    await streamStored(service, 'session-1', 'Hello', () => {});

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

    await streamStored(service, 'session-1', 'Why?', () => {});

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

    await streamStored(service, 'session-1', 'Why?', () => {});

    expect(session.messages.at(-1)?.verified).toBeUndefined();
  });

  it('grounds the turn in the curated metrics for the dataset entities', async () => {
    const { service, agent, metrics } = buildStreaming(answerStream([]), {
      tables: ['main.football.matches', 'main.football.players'],
      metricsBlock: 'Governed metric definitions (curated — …):\n- Win rate',
    });

    await streamStored(service, 'session-1', 'Win rate?', () => {});

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

      await streamStored(service, 'session-1', 'Cost per member?', () => {});

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

      await streamStored(service, 'session-1', 'Cost per member?', () => {});

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

      await streamStored(service, 'session-1', 'Why?', () => {});

      expect(session.messages.at(-1)?.data).toHaveLength(1);
      expect(session.messages.at(-1)?.reasoning).toBeUndefined();
    });

    it('keeps the reasoning done before a clarification on the card', async () => {
      const { service, session } = buildStreaming(clarificationStream());

      await streamStored(service, 'session-1', 'Which team?', () => {});

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

      await streamStored(service, 'session-1', 'Why?', (event) =>
        events.push(event),
      );

      const call = events.find((event) => event.type === 'tool');
      expect(JSON.parse(call!.content!)).toEqual({
        name: 'run_readonly_sql',
        rationale: FIRST,
        input: 'select 1',
      });
      const result = events.find((event) => event.type === 'tool-result');
      expect(JSON.parse(result!.content!)).toEqual(
        expect.objectContaining({ rationale: FIRST }),
      );
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
        failingStream(
          new Error('Provider request failed (404) — Resource not found'),
        ),
      );

      await expect(
        streamStored(service, 'session-1', 'Why did Argentina win?', () => {}),
      ).rejects.toThrow('Provider request failed (404)');

      expect(session.messages).toHaveLength(1);
      expect(session.messages[0]).toMatchObject({
        role: 'user',
        content: 'Why did Argentina win?',
      });
    });
  });
});

describe('SessionsService SQL self-correction', () => {
  /** The `run_readonly_sql` bridge SessionsService installs for the tools. */
  async function bridge(overrides: {
    runs: jest.Mock;
    samples?: jest.Mock;
    fixerReplies?: ({ sql: string } | undefined)[];
  }) {
    const fixer = { generate: jest.fn() };
    const interpretResult = jest.fn();
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
      { listAll: jest.fn().mockResolvedValue([]) } as never,
      {
        getAgent: jest.fn().mockReturnValue(fixer),
        ensureSessionWorkspace: jest.fn().mockResolvedValue({ id: 'w' }),
        interpretResult,
      } as never,
      { getByNames: jest.fn().mockResolvedValue([dataset]) } as never,
      {
        runReadOnlySql: overrides.runs,
        sampleRows: overrides.samples,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      userAgentsStub as never,
    );
    await service.onModuleInit();
    const calls = (setDatasetToolServices as jest.Mock).mock
      .calls as unknown[][];
    const installed = calls.at(-1)![0] as DatasetToolServices;
    return {
      service,
      installed,
      interpretResult,
      sample: (signal: AbortSignal) =>
        installed.sampleRows('ds-1', 'main.health.claims', 10, { signal }),
      run: (sql: string, signal?: AbortSignal) =>
        signal
          ? installed.runReadOnlySql('ds-1', sql, 100, ['claims'], { signal })
          : installed.runReadOnlySql('ds-1', sql, 100, ['claims']),
      fixer,
    };
  }

  it('hands the tool call stop signal to each run and to the fixer', async () => {
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
    const stop = new AbortController();

    await run(
      'SELECT count(claimid) AS n FROM main.health.claims',
      stop.signal,
    );

    expect((runs.mock.calls as unknown[][]).map((call) => call[4])).toEqual([
      { signal: stop.signal },
      { signal: stop.signal },
    ]);
    const options = (fixer.generate.mock.calls as unknown[][])[0][1] as {
      abortSignal?: AbortSignal;
    };
    expect(options.abortSignal).toBe(stop.signal);
  });

  it('ends a sample_rows call at once on the stop', async () => {
    const samples = jest.fn(() => new Promise(() => undefined));
    const { sample } = await bridge({ runs: jest.fn(), samples });
    const stop = new AbortController();
    const call = sample(stop.signal);
    stop.abort(new Error('The run was stopped'));

    await expect(call).rejects.toThrow('The run was stopped');
    expect(samples).toHaveBeenCalledWith('ds-1', 'main.health.claims', 10);
  });

  it('ends an explore_result page at once on the stop (agents.md 3.15)', async () => {
    const { service, installed } = await bridge({ runs: jest.fn() });
    const pageOf = jest.fn(() => new Promise(() => undefined));
    (
      service as unknown as { queryEvidence: { pageOf: jest.Mock } }
    ).queryEvidence.pageOf = pageOf;
    const stop = new AbortController();
    const source = { sql: 'SELECT 1', columns: [], kinds: {} };
    const call = installed.pageQuery!(
      source,
      ['claims'],
      { page: 2 },
      {
        signal: stop.signal,
      },
    );
    stop.abort(new Error('The run was stopped'));

    await expect(call).rejects.toThrow('The run was stopped');
    expect(pageOf).toHaveBeenCalledWith(source, ['claims'], { page: 2 });
  });

  it("hands the tool call's stop to result-explorer", async () => {
    const { installed, interpretResult } = await bridge({ runs: jest.fn() });
    const stop = new AbortController();
    const input = { text: 'x', candidates: [], view: null, pageCount: null };
    await installed.interpretResult!(input, { abortSignal: stop.signal });

    expect(interpretResult).toHaveBeenCalledWith(input, {
      abortSignal: stop.signal,
    });
  });

  it('does not repair a statement the stop cut short: the stop ends the call', async () => {
    const stop = new AbortController();
    const runs = jest.fn(() => {
      stop.abort(new Error('The run was stopped'));
      return Promise.reject(
        new Error('canceling statement due to user request'),
      );
    });
    const { run, fixer } = await bridge({ runs });

    await expect(
      run('SELECT count(claimid) AS n FROM main.health.claims', stop.signal),
    ).rejects.toThrow('The run was stopped');
    expect(runs).toHaveBeenCalledTimes(1);
    expect(fixer.generate).not.toHaveBeenCalled();
  });

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
        note: expect.stringContaining('auto-corrected') as string,
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

    const warnings = warn.mock.calls.map((call): unknown => call[0]);
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

  it('flags a result the connector cut at the limit', async () => {
    const rows = Array.from({ length: 100 }, (_, n) => ({ n }));
    const runs = jest
      .fn()
      .mockResolvedValue({ columns: ['n'], rows, totalRows: 2431 });
    const { run } = await bridge({ runs });

    const result = await run('SELECT n FROM main.health.claims');

    expect(result.truncated).toBe(true);
    expect(result.note).toContain('row limit 100 reached');
  });

  it('does not flag a result that lands exactly on the limit with nothing dropped', async () => {
    const rows = Array.from({ length: 100 }, (_, n) => ({ n }));
    const runs = jest
      .fn()
      .mockResolvedValue({ columns: ['n'], rows, totalRows: 100 });
    const { run } = await bridge({ runs });

    const result = await run(
      'SELECT n FROM main.health.claims ORDER BY n LIMIT 100',
    );

    expect(result.truncated).toBeUndefined();
    expect(result.note ?? '').not.toContain('row limit');
  });
});

describe('SessionsService answer feedback', () => {
  function build(session: SessionDoc) {
    const repository = {
      get: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockImplementation((_id, patch) => {
        Object.assign(session, patch);
        return Promise.resolve(session);
      }),
    };
    const verifiedQueries = {
      save: jest.fn().mockResolvedValue({}),
      removeForMessage: jest.fn().mockResolvedValue(1),
      removeForRun: jest.fn().mockResolvedValue(1),
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
      userAgentsStub as never,
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

  it('rates a run answer: the pair is keyed by the run, not a session', async () => {
    const host = answered();
    const { service, verifiedQueries } = build(host);

    const rated = await service.rateRunAnswer(
      'run-1',
      host,
      '2024-01-01T00:00:03.000Z',
      'up',
    );

    expect(verifiedQueries.save).toHaveBeenCalledWith({
      question: 'How many claims were denied last year?',
      sql: 'SELECT count(*) FROM main.health.claims',
      datasourceId: 'ds-1',
      entities: ['main.health.claims'],
      sourceRunId: 'run-1',
      sourceMessageAt: '2024-01-01T00:00:03.000Z',
    });
    expect(rated.feedback).toBe('up');
    expect(rated.verified).toBe(true);

    const down = await service.rateRunAnswer(
      'run-1',
      host,
      '2024-01-01T00:00:03.000Z',
      'down',
    );

    expect(verifiedQueries.removeForRun).toHaveBeenCalledWith('run-1');
    expect(down.feedback).toBe('down');
    expect(down.verified).toBeUndefined();
  });

  it('clears the verified badge on thumbs-down', async () => {
    const session = answered();
    session.messages[3].verified = true;
    const { service } = build(session);

    const rated = await service.rateRunAnswer(
      'run-1',
      session,
      '2024-01-01T00:00:03.000Z',
      'down',
    );
    expect(rated.verified).toBeUndefined();
  });

  it('records the rating but saves nothing when the answer ran no SQL', async () => {
    const session = answered();
    delete session.messages[3].data;
    const { service, verifiedQueries } = build(session);
    const rated = await service.rateRunAnswer(
      'run-1',
      session,
      '2024-01-01T00:00:03.000Z',
      'up',
    );

    expect(verifiedQueries.save).not.toHaveBeenCalled();
    expect(rated.feedback).toBe('up');
  });
});

/** SQL runs followed by a written answer — the ordinary completed turn. */
function* answerChunks(
  runs: {
    sql: string;
    rows?: Record<string, unknown>[];
    truncated?: boolean;
    /** What the assistant said it was checking with this query. */
    rationale?: string;
    /** Set instead of rows when the query came back as a failure. */
    error?: string;
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
            },
      },
    };
  }
  yield { type: 'text-delta', payload: { text: 'Here is the answer.' } };
}

/** One SQL run, then the model asks for a clarification and the turn ends. */
function* clarificationChunks() {
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
        options: ['2022', '2018 — the earlier tournament'],
      },
    },
  };
}

function* toolOnlyChunks(count: number) {
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

/**
 * Hands chunks out one at a time through an async iterator, the way a model's
 * `fullStream` delivers them.
 */
async function* streamOf<T>(chunks: Iterable<T>): AsyncGenerator<T> {
  for (const chunk of chunks) yield Promise.resolve(chunk);
}

function answerStream(...args: Parameters<typeof answerChunks>) {
  return streamOf(answerChunks(...args));
}

function clarificationStream() {
  return streamOf(clarificationChunks());
}

function toolOnlyStream(count: number) {
  return streamOf(toolOnlyChunks(count));
}

/** A model call that failed: Mastra's `error` chunk, as the stream ends. */
async function* errorChunkStream(error: unknown): AsyncGenerator<unknown> {
  yield await Promise.resolve({ type: 'error', payload: { error } });
}

/** The shape of an AI SDK `APICallError` from an OpenAI-style endpoint. */
function apiCallError(
  statusCode: number | undefined,
  extra: { cause?: unknown } = {},
): Error {
  return Object.assign(new Error('API call failed'), {
    name: 'AI_APICallError',
    statusCode,
    url: 'http://127.0.0.1:8317/v1/chat/completions',
    ...extra,
  });
}

/**
 * A stream that fails outright — a provider error, a dead connection: the
 * first read rejects.
 */
async function* failingStream(error: Error): AsyncGenerator<never> {
  yield await Promise.reject(error);
}

describe('SessionsService visual revert and refresh (the viewer, ADR-0059)', () => {
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
      update: jest.fn().mockImplementation((_id, patch) => {
        Object.assign(session, patch);
        return Promise.resolve(session);
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
      revert: jest.fn().mockImplementation(() => Promise.resolve(visual(1))),
      refreshData: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ metadata: visual(2) })),
      load: jest.fn().mockImplementation((_doc, id: string, version: number) =>
        Promise.resolve({
          ...visual(version),
          id,
          version,
          document: '<html></html>',
        }),
      ),
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
      userAgentsStub as never,
    );
    return { service, session, visuals };
  }

  it('runs a visual action on a run host: event and panel item returned, nothing persisted here', async () => {
    const { service, session, visuals } = build(2);
    const host = { ...session, id: 'run-r1', run: true } as SessionDoc;

    const reverted = await service.runVisualAction(host, {
      kind: 'revert',
      visualId: 'visual-1',
      version: 1,
    });
    expect(visuals.revert).toHaveBeenCalledWith(host, 'visual-1', 1);
    expect(reverted.version).toBe(1);
    expect(reverted.event).toEqual({
      visualId: 'visual-1',
      version: 1,
      title: 'Claims by month',
      action: 'reverted',
    });
    expect(reverted.panelItems).toEqual([
      expect.objectContaining({ id: 'visual:visual-1', kind: 'visual' }),
    ]);

    const refreshed = await service.runVisualAction(host, {
      kind: 'refresh',
      visualId: 'visual-1',
    });
    expect(visuals.refreshData).toHaveBeenCalledWith(host, 'visual-1');
    expect(refreshed.version).toBe(2);
    expect(refreshed.event).toBeUndefined();
    expect(session.messages).toHaveLength(0);
  });
});

describe('SessionsService sessions from a user agent (R52, api.md 2.1)', () => {
  const live = {
    name: 'Cup historian',
    description: 'Answers questions about World Cup history',
    instructions: 'Always name the tournament year.',
    datasets: ['World Cup Core', 'Gone'],
    starterQuestions: ['Who won in 2014?'],
  };

  function build(agent: Record<string, unknown> | null, datasets: string[]) {
    const repository = {
      insert: jest
        .fn()
        .mockImplementation((doc: SessionDoc) => Promise.resolve(doc)),
      get: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const mastra = {
      ensureSessionWorkspace: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve({ id: `session-${id}` }),
        ),
      deleteSessionResources: jest.fn().mockResolvedValue(undefined),
      // Elena, who runs a draft's host (ADR-0059).
      listAgents: () => ({ 'insights-lead': { name: 'Insights Lead' } }),
    };
    const userAgents = {
      get: jest.fn().mockResolvedValue(agent),
      list: jest.fn().mockResolvedValue(agent ? [agent] : []),
      datasetNames: jest.fn().mockResolvedValue(new Set(datasets)),
    };
    const service = new SessionsService(
      repository as never,
      mastra as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      userAgents as never,
    );
    return { service, repository, mastra };
  }

  it('derives the agent from its Live version, or marks it deleted', async () => {
    const session: SessionDoc = {
      id: 's-1',
      name: 'Cup historian',
      datasets: ['World Cup Core'],
      agentId: 'agent-1',
      agentName: 'Cup historian',
      messages: [],
    };
    const plain: SessionDoc = { ...session, id: 's-2', agentId: undefined };
    delete plain.agentId;
    delete plain.agentName;

    const present = build({ id: 'agent-1', draft: live, live }, []).service;
    expect((await present.toView(session)).agent).toEqual({
      id: 'agent-1',
      name: 'Cup historian',
      deleted: false,
      description: live.description,
      starterQuestions: live.starterQuestions,
    });
    const [viewed, plainView] = await present.toViews([session, plain]);
    expect(viewed.agent?.deleted).toBe(false);
    expect(plainView).not.toHaveProperty('agent');

    const gone = build(null, []).service;
    expect((await gone.toView(session)).agent).toEqual({
      id: 'agent-1',
      name: 'Cup historian',
      deleted: true,
      description: '',
      starterQuestions: [],
    });
  });

  describe('draft run hosts (api.md R12)', () => {
    it('is a preview-shaped run host over the draft, never stored, discarded with its resources', async () => {
      const { service, repository, mastra } = build(
        { id: 'agent-1', draft: { ...live, name: 'Draft name' } },
        ['World Cup Core'],
      );
      const host = await service.createRunHost({
        runId: 'r1',
        workflowId: 'agent:agent-1',
        name: 'Draft name',
        draftAgentId: 'agent-1',
      });

      // Elena runs it, over the user agent's draft (ADR-0059).
      expect(host).toMatchObject({
        id: 'run-r1',
        datasets: ['World Cup Core'],
        agentKey: 'insights-lead',
        agentId: 'agent-1',
        workflowId: 'agent:agent-1',
        preview: true,
        run: true,
      });
      expect(repository.insert).not.toHaveBeenCalled();
      expect((await service.toView(host)).agent?.name).toBe('Draft name');

      await service.deleteRunHostResources('run-r1');
      expect(mastra.deleteSessionResources).toHaveBeenCalledWith('run-r1');
    });

    it('refuses an unknown agent and a draft with no existing dataset', async () => {
      await expect(
        build(null, []).service.draftRunTarget('nope'),
      ).rejects.toThrow('Agent "nope" not found');
      await expect(
        build({ id: 'agent-1', draft: live }, []).service.draftRunTarget(
          'agent-1',
        ),
      ).rejects.toThrow('Select at least one dataset to preview');
    });
  });

  describe('saveMessage (api.md 144-146: what the query inspector caches)', () => {
    it('writes one message back through the repository, keeping the recency; 404 for an unknown session', async () => {
      const { service, repository } = build(null, []);
      const stored: SessionDoc = {
        id: 's-1',
        name: 'Past chat',
        datasets: [],
        messages: [
          { role: 'user', content: 'Q', at: 'a' },
          { role: 'assistant', content: 'A', at: 'b' },
        ],
      };
      const updateMessages = jest.fn().mockResolvedValue(stored);
      Object.assign(repository, { updateMessages });
      repository.get.mockImplementation((id: string) =>
        Promise.resolve(id === 's-1' ? stored : null),
      );
      const answer = { ...stored.messages[1], evidence: [{ index: 0 }] };

      await service.saveMessage('s-1', 1, answer);

      expect(updateMessages).toHaveBeenCalledWith('s-1', [
        stored.messages[0],
        answer,
      ]);
      expect(repository.update).not.toHaveBeenCalled();
      await expect(service.saveMessage('nope', 1, answer)).rejects.toThrow(
        'Session nope not found',
      );
    });
  });
});

describe('SessionsService panel items (ADR-0029)', () => {
  async function build(extra: Partial<SessionDoc> = {}) {
    const session: SessionDoc = {
      id: 'session-1',
      name: 'Claims',
      datasets: ['claims'],
      messages: [],
      visualizations: [],
      ...extra,
    };
    const repository = {
      listAll: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockImplementation((_id, patch) => {
        Object.assign(session, patch);
        return Promise.resolve(session);
      }),
    };
    const visuals = {
      create: jest.fn().mockResolvedValue({
        metadata: {
          id: 'visual-1',
          title: 'Chart',
          description: 'A chart.',
          path: 'visuals/visual-1',
          sourceMessageAt: '2024-01-01T00:00:00.000Z',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      }),
      currentVersion: jest.fn().mockReturnValue(1),
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
      userAgentsStub as never,
    );
    await service.onModuleInit();
    const calls = (setDatasetToolServices as jest.Mock).mock
      .calls as unknown[][];
    const installed = calls.at(-1)![0] as DatasetToolServices;
    return { service, session, installed };
  }

  it('derives a visual item for a session saved without panel items, and its stored workflow', async () => {
    {
      const { service } = await build({
        visualizations: [
          {
            id: 'v-old',
            title: 'Old chart',
            description: '',
            path: 'visuals/v-old',
            sourceMessageAt: '2024-01-01T00:00:00.000Z',
            createdAt: '2024-02-02T00:00:00.000Z',
          },
        ],
        // The steps the removed assistant defined read as stored (ADR-0059).
        workflowState: {
          current: 2,
          done: [1],
          steps: ['Ask', 'Answer'],
          updatedAt: 'x',
        },
      });
      const view = await service.toView(await service.get('session-1'));
      expect(view.panelItems).toEqual([
        {
          id: 'visual:v-old',
          kind: 'visual',
          title: 'Old chart',
          shownAt: '2024-02-02T00:00:00.000Z',
          visualId: 'v-old',
        },
      ]);
      expect(view.workflow).toEqual({
        phases: [
          { number: 1, title: 'Ask' },
          { number: 2, title: 'Answer' },
        ],
        source: 'agent',
        current: 2,
        done: [1],
        skipped: [],
      });
    }
  });

  it('downloads a document and a .md file as PDF, and refuses other items (BA-231)', async () => {
    const { service } = await build({
      panelItems: [
        {
          id: 'doc-1',
          kind: 'document',
          title: 'Q3 Findings!',
          shownAt: 'x',
          markdown: '# Hi',
        },
        {
          id: 'file-md',
          kind: 'file',
          title: 'Plan',
          shownAt: 'x',
          path: 'notes/plan.md',
        },
        {
          id: 'file-txt',
          kind: 'file',
          title: 'T',
          shownAt: 'x',
          path: 'a.txt',
        },
        {
          id: 'tbl',
          kind: 'table',
          title: 'T',
          shownAt: 'x',
          columns: ['a'],
          rows: [[1]],
        },
      ] as never,
    });
    (readWorkspaceFile as jest.Mock).mockResolvedValueOnce({
      text: '# Plan',
      body: Buffer.from('# Plan'),
      contentType: 'text/markdown',
    });
    const doc = await service.downloadPanelItem('session-1', 'doc-1', 'pdf');
    expect(doc).toMatchObject({
      filename: 'q3-findings.pdf',
      contentType: 'application/pdf',
    });
    expect(doc.body.toString()).toBe('%PDF-stub # Hi');
    expect(renderPdf).toHaveBeenCalledWith(
      '# Hi',
      expect.objectContaining({
        title: 'Q3 Findings!',
        author: 'Questions to Insights',
        createdAt: expect.any(Date) as Date,
      }),
    );
    await expect(
      service.downloadPanelItem('session-1', 'file-md', 'pdf'),
    ).resolves.toMatchObject({
      filename: 'plan.pdf',
      contentType: 'application/pdf',
    });
    await expect(
      service.downloadPanelItem('session-1', 'doc-1', 'md'),
    ).resolves.toMatchObject({ filename: 'q3-findings.md' });
    for (const itemId of ['file-txt', 'tbl']) {
      await expect(
        service.downloadPanelItem('session-1', itemId, 'pdf'),
      ).rejects.toThrow(`Panel item "${itemId}" can't be downloaded as PDF`);
    }
  });

  it('serves a file item only as a file, and a visual cannot be downloaded', async () => {
    const { service } = await build({
      panelItems: [
        {
          id: 'doc-1',
          kind: 'document',
          title: 'Doc',
          shownAt: 'x',
          markdown: 'm',
        },
        {
          id: 'visual:v',
          kind: 'visual',
          title: 'V',
          shownAt: 'x',
          visualId: 'v',
        },
      ],
    });
    await expect(service.panelItemFile('session-1', 'doc-1')).rejects.toThrow(
      'Panel item "doc-1" is not a file',
    );
    await expect(
      service.downloadPanelItem('session-1', 'visual:v'),
    ).rejects.toThrow('Panel item "visual:v" can\'t be downloaded');
    await expect(service.panelItemFile('session-1', 'nope')).rejects.toThrow(
      'Panel item "nope" not found',
    );
  });
});

describe('toolCallInput (api.md 3.1)', () => {
  it('names the skill a skill tool loads', () => {
    expect(toolCallInput('skill', { name: 'sql-analysis' })).toBe(
      'sql-analysis',
    );
    expect(
      toolCallInput('skill_read', {
        skillName: 'result-validation',
        path: 'references/checks.md',
      }),
    ).toBe('result-validation/references/checks.md');
    expect(toolCallInput('skill_search', { query: 'stop-loss' })).toBe(
      'stop-loss',
    );
  });

  it("takes another tool's first text argument, flattened and clipped", () => {
    expect(toolCallInput('get_order', { orderId: 'e006cebc' })).toBe(
      'e006cebc',
    );
    expect(
      toolCallInput('run_readonly_sql', { sql: 'SELECT 1\n  FROM t' }),
    ).toBe('SELECT 1 FROM t');
    const long = toolCallInput('run_readonly_sql', { sql: 'x'.repeat(300) });
    expect(long).toHaveLength(200);
    expect(long?.endsWith('…')).toBe(true);
    expect(toolCallInput('list_entities', {})).toBeUndefined();
  });
});
