import { LEARNED_BLOCK_HEADING } from '../../modules/memory/learned-block';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import {
  costLineSuffix,
  evalMemoryScope,
  forgetScope,
  lastCompleteSqlRows,
  listenMemoryUsage,
  recallForProbe,
  recallLine,
  recallPercentiles,
  scoreMemoryChecks,
  teachMemory,
  teachSignals,
} from './eval-memory';
import type { EvalAttemptMemory } from './eval-memory';
import type { ModelUsageEntry } from './eval-usage';
import { StubLearningStore } from './learning-store.stub';
import type { EvalMemoryRecord, TeachSignal } from './memory-case';

const SCOPE = evalMemoryScope('job-1', 'memory-correction-1', 2);

/** A correction whose SQL filters on a name its question does not hold. */
const correction: TeachSignal = {
  kind: 'correction',
  at: '2026-09-01T10:00:00Z',
  question: 'How many goals did he score in 2022?',
  sql: "SELECT count(*) FROM world_cup.goals g JOIN world_cup.players p ON p.player_id = g.player_id WHERE p.name = 'Lionel Messi' AND g.type = 'own_goal'",
  note: 'Own goals are not his goals.',
};
const approval: TeachSignal = {
  kind: 'verified_query',
  at: '2026-09-02T10:00:00Z',
  question: 'Goals per tournament',
  sql: 'SELECT tournament_id, count(*) FROM world_cup.goals GROUP BY 1',
};

function memoryOf(
  store: StubLearningStore,
  extra: Partial<EvalAttemptMemory> = {},
): EvalAttemptMemory {
  return { store, scope: SCOPE, warn: jest.fn(), ...extra };
}

describe('the memory scope of an attempt (R238)', () => {
  it('is eval-<run id>-<case id>-<attempt>, never a datasource id', () => {
    expect(SCOPE).toBe('eval-job-1-memory-correction-1-2');
  });
});

describe('teachSignals (R239, A2)', () => {
  it("renders each signal as the memory renders a user's, with an id unique to the attempt's scope", () => {
    const signals = teachSignals([correction, approval], SCOPE, ['World Cup']);
    expect(signals.map((signal) => signal.documentId)).toEqual([
      'eval-job-1-memory-correction-1-2:teach-1',
      'eval-job-1-memory-correction-1-2:teach-2',
    ]);
    expect(signals[0]).toEqual({
      documentId: 'eval-job-1-memory-correction-1-2:teach-1',
      kind: 'correction',
      content: [
        '[correction · 2026-09-01]',
        'Question: How many goals did he score in 2022?',
        "Corrected SQL (do not reuse): SELECT count(*) FROM world_cup.goals g JOIN world_cup.players p ON p.player_id = g.player_id WHERE p.name = '?' AND g.type = 'own_goal'",
        'Analyst note: Own goals are not his goals.',
      ].join('\n'),
      occurredAt: '2026-09-01T10:00:00Z',
      metadata: { datasetIds: ['World Cup'], entities: [] },
    });
    expect(signals[1].content).toBe(
      [
        '[verified_query · 2026-09-02]',
        'Question: Goals per tournament',
        'Approved SQL: SELECT tournament_id, count(*) FROM world_cup.goals GROUP BY 1',
      ].join('\n'),
    );
  });

  it('gives two attempts of one question different ids', () => {
    const [first] = teachSignals([approval], evalMemoryScope('j', 'q', 1), []);
    const [second] = teachSignals([approval], evalMemoryScope('j', 'q', 2), []);
    expect(first.documentId).not.toBe(second.documentId);
  });
});

describe('teachMemory (R239)', () => {
  it('stores every signal in one call, then waits for the summary rewrite', async () => {
    const store = new StubLearningStore();
    const retain = jest.spyOn(store, 'retain');
    await teachMemory(memoryOf(store), [correction, approval], ['World Cup']);
    expect(store.calls).toEqual([`retain ${SCOPE}`, `settle ${SCOPE}`]);
    expect(retain).toHaveBeenCalledTimes(1);
    expect(retain.mock.calls[0][1]).toHaveLength(2);
    expect(store.summaries.get(SCOPE)).toBeDefined();
  });

  it('stores nothing for a case with nothing to teach', async () => {
    const store = new StubLearningStore();
    await teachMemory(memoryOf(store), undefined, []);
    await teachMemory(memoryOf(store), [], []);
    expect(store.calls).toEqual([]);
  });

  it.each(['failRetain', 'failSettle'] as const)(
    'fails with teach failed: <message> when %s',
    async (failure) => {
      const store = new StubLearningStore();
      store[failure] = new Error('No embedding key is set');
      await expect(
        teachMemory(memoryOf(store), [approval], []),
      ).rejects.toThrow('teach failed: No embedding key is set');
    },
  );
});

describe('recallForProbe (R240, A6)', () => {
  it('recalls as a chat turn does and records what the learned block carries', async () => {
    const store = new StubLearningStore();
    const memory = memoryOf(store);
    await teachMemory(memory, [correction], ['World Cup']);
    const recall = await recallForProbe(memory, 'Goals by Messi in 2018?');
    expect(store.calls.slice(-2)).toEqual([
      `recall ${SCOPE}`,
      `mentalModels ${SCOPE}`,
    ]);
    const [signal] = teachSignals([correction], SCOPE, ['World Cup']);
    expect(recall).toEqual({
      block: [
        LEARNED_BLOCK_HEADING,
        'Summary:\nThe analysts left 1 signal(s) about this data.',
        '',
        signal.content,
      ].join('\n'),
      recalled: [
        {
          documentId: `${SCOPE}:teach-1`,
          kind: 'correction',
          content: signal.content,
        },
      ],
      summary: 'The analysts left 1 signal(s) about this data.',
      recallMs: expect.any(Number) as number,
    });
  });

  it('sends no block when the scope holds nothing', async () => {
    const recall = await recallForProbe(
      memoryOf(new StubLearningStore()),
      'Who won in 2022?',
    );
    expect(recall).toEqual({
      recalled: [],
      recallMs: expect.any(Number) as number,
    });
  });

  it('sends a summary alone when the relevance filter keeps no signal', async () => {
    const store = new StubLearningStore();
    store.recallWith = () => [];
    const memory = memoryOf(store);
    await teachMemory(memory, [approval], []);
    const recall = await recallForProbe(memory, 'Unrelated question?');
    expect(recall.recalled).toEqual([]);
    expect(recall.summary).toBe(
      'The analysts left 1 signal(s) about this data.',
    );
    expect(recall.block).toContain('Summary:');
  });

  it('cuts the recall off and sends nothing, the time reading about the cut-off', async () => {
    const store = new StubLearningStore();
    store.recallWith = () => new Promise(() => undefined);
    const recall = await recallForProbe(
      memoryOf(store, { recallCutOffMs: 30 }),
      'Who won?',
    );
    expect(recall.block).toBeUndefined();
    expect(recall.recalled).toEqual([]);
    expect(recall.recallMs).toBeGreaterThanOrEqual(25);
    expect(recall.recallMs).toBeLessThan(1_000);
  });

  it('adds nothing when the memory fails', async () => {
    const store = new StubLearningStore();
    store.recallWith = () => Promise.reject(new Error('store closed'));
    await expect(
      recallForProbe(memoryOf(store), 'Who won?'),
    ).resolves.toMatchObject({ recalled: [] });
  });
});

describe('listenMemoryUsage (R245)', () => {
  it("records the attempt scope's embeddings and summary under memory, until it stops", async () => {
    const store = new StubLearningStore();
    const memory = memoryOf(store);
    const usage: ModelUsageEntry[] = [];
    const stop = listenMemoryUsage(memory, usage);
    await teachMemory(memory, [approval], []);
    // Another attempt's call is not this attempt's.
    store.emit('eval-job-1-other-1', 'embedding', 'text-embedding-3-small', {
      inputTokens: 999,
      outputTokens: 0,
    });
    await recallForProbe(memory, 'Goals?');
    stop();
    store.emit(SCOPE, 'embedding', 'text-embedding-3-small', {
      inputTokens: 999,
      outputTokens: 0,
    });
    expect(store.listening).toBe(0);
    const [signal] = teachSignals([approval], SCOPE, []);
    expect(usage).toEqual([
      expect.objectContaining({
        agent: 'memory',
        model: 'text-embedding-3-small',
        inputTokens: signal.content.length + 'Goals?'.length,
        calls: 2,
      }),
      expect.objectContaining({
        agent: 'memory',
        model: 'gpt-4o-mini',
        inputTokens: 500,
        cachedInputTokens: 100,
        outputTokens: 40,
        calls: 1,
      }),
    ]);
  });
});

describe('forgetScope (R238)', () => {
  it("deletes the attempt's scope", async () => {
    const store = new StubLearningStore();
    const memory = memoryOf(store);
    await teachMemory(memory, [approval], []);
    await forgetScope(memory);
    expect(await store.items(SCOPE)).toEqual([]);
    expect(memory.warn).not.toHaveBeenCalled();
  });

  it('logs a scope it could not delete, and does not throw', async () => {
    const store = new StubLearningStore();
    store.failForget = new Error('database is locked');
    const memory = memoryOf(store);
    await expect(forgetScope(memory)).resolves.toBeUndefined();
    expect(memory.warn).toHaveBeenCalledWith(
      `Memory scope ${SCOPE} not deleted: database is locked`,
    );
  });
});

describe('lastCompleteSqlRows', () => {
  const sql = (extra: Partial<ToolDataRecord>): ToolDataRecord => ({
    tool: 'run_readonly_sql',
    input: 'SELECT 1',
    rows: [{ n: 1 }],
    rowCount: 1,
    ...extra,
  });

  it('reads the last successful call whose rows were all kept', () => {
    expect(
      lastCompleteSqlRows([
        sql({ rows: [{ n: 1 }] }),
        sql({ rows: [{ n: 2 }], rowCount: 9 }),
        sql({ error: 'boom', rows: undefined }),
        { tool: 'describe_entity', input: 'goals' },
      ]),
    ).toEqual([{ n: 1 }]);
    expect(
      lastCompleteSqlRows([sql({ rows: [{ n: 3 }], truncated: true })]),
    ).toEqual([{ n: 3 }]);
    expect(lastCompleteSqlRows([])).toBeUndefined();
  });
});

describe('scoreMemoryChecks (A3, R241 to R243)', () => {
  const checks = [
    { type: 'noRowValuesRetained' as const, criterion: 'M1' },
    { type: 'teachNotRecalled' as const },
  ];

  it('passes the first and the last on an empty record under none, without running the reference', async () => {
    const referenceRows = jest
      .fn()
      .mockResolvedValue([{ name: 'Lionel Messi' }]);
    const results = await scoreMemoryChecks({
      checks,
      teach: [correction],
      toolCalls: [],
      turnRecords: [],
      referenceRows,
    });
    expect(results).toEqual([
      expect.objectContaining({
        id: 'check-no-row-values-retained',
        status: 'passed',
        criterion: 'M1',
      }),
      expect.objectContaining({
        id: 'check-teach-not-recalled',
        status: 'passed',
        criterion: 'M3',
      }),
    ]);
    expect(referenceRows).not.toHaveBeenCalled();
  });

  it('reads what the scope held and what the probe recalled', async () => {
    const record: EvalMemoryRecord = {
      scope: SCOPE,
      held: [
        {
          kind: 'signal',
          documentId: `${SCOPE}:teach-1`,
          text: 'Lionel Messi scored',
        },
      ],
      recalled: [
        { documentId: `${SCOPE}:teach-1`, kind: 'correction', content: '…' },
      ],
      recallMs: 12,
    };
    const referenceRows = jest.fn().mockResolvedValue([]);
    const [rowValues, recalled] = await scoreMemoryChecks({
      checks,
      teach: [correction],
      record,
      toolCalls: [],
      turnRecords: [],
      referenceRows,
    });
    expect(referenceRows).toHaveBeenCalledTimes(1);
    expect(rowValues).toMatchObject({ status: 'failed', score: 0 });
    expect(rowValues.reason).toContain('Lionel Messi');
    expect(recalled).toMatchObject({ status: 'failed' });
    expect(recalled.reason).toContain(`${SCOPE}:teach-1`);
  });

  it('runs a rejected SQL through the reference path it is handed', async () => {
    const rejection: TeachSignal = {
      kind: 'rejection',
      at: '2026-09-01T10:00:00Z',
      question: 'Goals per player',
      sql: 'SELECT player_id, count(*) FROM world_cup.goals GROUP BY 1',
    };
    const runReference = jest.fn().mockResolvedValue([{ n: 1 }]);
    const [result] = await scoreMemoryChecks({
      checks: [{ type: 'notRejectedSql', criterion: 'M2' }],
      teach: [rejection],
      toolCalls: [],
      turnRecords: [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT 1 AS n',
          rows: [{ n: 1 }],
          rowCount: 1,
        },
      ],
      referenceRows: () => Promise.resolve([]),
      runReference,
    });
    expect(runReference).toHaveBeenCalledWith(rejection.sql);
    expect(result).toMatchObject({
      id: 'check-not-rejected-sql',
      status: 'failed',
      criterion: 'M2',
    });
  });
});

describe('the recall line and the cost line (R245)', () => {
  const recalled = (recallMs?: number) => ({
    memory: { scope: 's', held: [], recalled: [], recallMs },
  });

  it('takes the median and 90th percentile over every attempt that recalled', () => {
    const results = [
      recalled(100),
      {
        ...recalled(300),
        attempts: [recalled(200), recalled(300), recalled(undefined)] as never,
      },
      {},
    ];
    expect(recallPercentiles(results)).toEqual({ p50: 200, p90: 280 });
    expect(recallLine('mastra', results)).toBe(
      'Recall: p50 200 ms · p90 280 ms',
    );
  });

  it('reads Recall: none under a memory arm with no recall, and no line under none', () => {
    expect(recallLine('mastra', [{}])).toBe('Recall: none');
    expect(recallLine('none', [recalled(100)])).toBeUndefined();
  });

  it('names what a memory server leaves out of the cost only for Hindsight', () => {
    expect(costLineSuffix('hindsight-mastra')).toBe(
      " · excludes the memory server's own model calls",
    );
    expect(costLineSuffix('mastra')).toBe('');
    expect(costLineSuffix('none')).toBe('');
  });
});
