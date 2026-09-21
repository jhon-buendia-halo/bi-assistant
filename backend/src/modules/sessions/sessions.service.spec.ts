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

import { setDatasetToolServices } from '../../mastra/tool-services';
import type { DatasetToolServices } from '../../mastra/tool-services';
import { TURN_RECORDS_CONTEXT_KEY } from '../../mastra/tools/visual.tools';
import { sourceEntities } from './visualization-document';
import { SessionsService, StreamEvent } from './sessions.service';
import type { SessionDoc } from './entities/session.entity';

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
      /** Careful mode: what the verifier replies and what its SQL returns. */
      crossCheck?: {
        sql?: string;
        verifierFails?: boolean;
        rows?: Record<string, unknown>[];
        runFails?: boolean;
      };
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
    };
  }

  beforeEach(() => {
    (sourceEntities as jest.Mock).mockReturnValue([]);
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
