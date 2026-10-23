import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { EvalRunView } from '../eval-runs.service';
import { EvalRunsRepository } from './eval-runs.repository';

/** A store whose `find` returns these runs, newest first. */
function storeOf(runs: unknown[]): DocStore<EvalRunView> {
  return {
    find: jest.fn().mockResolvedValue(runs),
  } as unknown as DocStore<EvalRunView>;
}

describe('eval regression baseline scope', () => {
  it('skips other datasets and the current run; dataset ordering is irrelevant', async () => {
    const find = jest.fn().mockResolvedValue([
      { jobId: 'current', datasets: ['Core', 'Stats'], caseIds: ['q1'] },
      { jobId: 'different', datasets: ['Core', 'Other'], caseIds: ['q1'] },
      { jobId: 'partial', datasets: ['Core'], caseIds: ['q1'] },
      { jobId: 'baseline', datasets: ['Stats', 'Core'], caseIds: ['q1'] },
    ]);
    const repository = new EvalRunsRepository({ find } as never);
    const baseline = await repository.mostRecentCompleted(
      'assistant',
      'current',
      'wc',
      ['Core', 'Stats'],
      ['q1'],
    );
    expect(find).toHaveBeenCalledWith(
      { agentKey: 'assistant', status: 'completed', datasourceId: 'wc' },
      { sort: { startedAt: -1 } },
    );
    expect(baseline?.jobId).toBe('baseline');
  });

  it('returns no baseline when only incompatible scopes exist', async () => {
    const repository = new EvalRunsRepository({
      find: jest
        .fn()
        .mockResolvedValue([
          { jobId: 'other', datasets: ['F1'], caseIds: ['q1'] },
        ]),
    } as never);
    expect(
      await repository.mostRecentCompleted(
        'assistant',
        'current',
        'wc',
        ['World Cup'],
        ['q1'],
      ),
    ).toBeNull();
  });

  describe('a baseline must share a question with the run (R40)', () => {
    /** A completed run on the World Cup datasource and dataset. */
    const run = (jobId: string, caseIds: string[]) => ({
      jobId,
      datasets: ['World Cup'],
      caseIds,
      results: caseIds.map((id) => ({ id, passed: true })),
    });
    const worldCup = ['dbx-champion-2022', 'dbx-final-score-2018'];
    const databricksOnly = [
      'matches-per-tournament',
      'top-attendance-per-tournament',
    ];

    it('does not compare a world-cup-databricks-only run with an earlier world-cup-databricks run', async () => {
      const repository = new EvalRunsRepository(
        storeOf([run('wc-1', worldCup)]),
      );
      expect(
        await repository.mostRecentCompleted(
          'assistant',
          'only-1',
          'wc',
          ['World Cup'],
          databricksOnly,
        ),
      ).toBeNull();
    });

    it('compares a world-cup-databricks run with the earlier world-cup-databricks run, past a world-cup-databricks-only run in between', async () => {
      const repository = new EvalRunsRepository(
        // Newest first, as the store sorts them.
        storeOf([run('only-1', databricksOnly), run('wc-1', worldCup)]),
      );
      const baseline = await repository.mostRecentCompleted(
        'assistant',
        'wc-2',
        'wc',
        ['World Cup'],
        worldCup,
      );
      expect(baseline?.jobId).toBe('wc-1');
    });

    it('counts one shared question as comparable, from the results when the run has no case ids', async () => {
      const repository = new EvalRunsRepository(
        storeOf([
          {
            jobId: 'older',
            datasets: ['World Cup'],
            results: [{ id: 'champion-2022', passed: false }],
          },
        ]),
      );
      const baseline = await repository.mostRecentCompleted(
        'assistant',
        'current',
        'wc',
        ['World Cup'],
        ['champion-2022', 'shootouts'],
      );
      expect(baseline?.jobId).toBe('older');
    });
  });
});

describe('runs saved before BA-184 are read with defaults (R144, R147, R148)', () => {
  const old = {
    jobId: 'old',
    agentKey: 'assistant',
    datasourceId: 'wc',
    datasets: ['World Cup'],
    caseIds: ['champion-2022', 'out-of-scope'],
    status: 'completed',
    totalCases: 2,
    startedAt: '2026-10-01T00:00:00.000Z',
    results: [
      {
        id: 'champion-2022',
        question: 'Who won the 2022 World Cup?',
        scores: {},
        checkResults: [
          { id: 'check-includes', description: 'd', score: 1, passed: true },
        ],
        answer: 'Argentina',
        toolCalls: [],
        passed: true,
        durationMs: 1,
      },
      {
        id: 'out-of-scope',
        question: 'How many goals did Pelé score in 1970?',
        scores: {},
        checkResults: [
          { id: 'llm-judge', description: 'j', score: 0, passed: false },
        ],
        answer: '',
        toolCalls: [],
        passed: false,
        durationMs: 1,
      },
    ],
  };

  it('fills the judge option, the statuses and the summary on get and list', async () => {
    const store = {
      find: jest.fn().mockResolvedValue([old]),
      findOne: jest.fn().mockResolvedValue(old),
    } as unknown as DocStore<EvalRunView>;
    const repository = new EvalRunsRepository(store);
    for (const run of [
      await repository.get('old'),
      (await repository.list('assistant'))[0],
    ]) {
      expect(run?.judge).toEqual({ mode: 'on' });
      expect(run?.results.map((result) => result.status)).toEqual([
        'passed',
        'failed',
      ]);
      expect(run?.results[1].checkResults[0].status).toBe('failed');
      const counts = { passed: 1, failed: 1, notScored: 0, flaky: 0, total: 2 };
      const both = { ...counts, interval: expect.any(Object) as object };
      const none = { passed: 0, failed: 0, notScored: 0, flaky: 0, total: 0 };
      expect(run?.summary).toEqual({
        passed: 1,
        failed: 1,
        notScored: 0,
        flaky: 0,
        // Both cases are dev in the World Cup question bank.
        bySplit: { dev: both, heldOut: none },
        byCategory: [
          {
            category: 'uncategorised',
            ...counts,
            dev: both,
            heldOut: none,
          },
        ],
        byCriterion: [],
      });
    }
  });

  it('keeps a stored judge option and returns null for a missing run', async () => {
    const repository = new EvalRunsRepository({
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ ...old, judge: { mode: 'off' } })
        .mockResolvedValueOnce(null),
    } as unknown as DocStore<EvalRunView>);
    expect((await repository.get('old'))?.judge).toEqual({ mode: 'off' });
    expect(await repository.get('missing')).toBeNull();
  });

  it('gives the regression baseline its statuses too', async () => {
    const repository = new EvalRunsRepository(storeOf([old]));
    const baseline = await repository.mostRecentCompleted(
      'assistant',
      'current',
      'wc',
      ['World Cup'],
      ['champion-2022'],
    );
    expect(baseline?.results.map((result) => result.status)).toEqual([
      'passed',
      'failed',
    ]);
  });
});

describe('runs saved before BA-242 are read with defaults (data-model 3.8, R209, R215, R223)', () => {
  const old = {
    jobId: 'old',
    agentKey: 'assistant',
    datasourceId: 'wc',
    datasets: ['World Cup'],
    caseIds: ['champion-2022', 'shot-conversion-2022', 'gone-from-the-bank'],
    status: 'completed',
    totalCases: 3,
    startedAt: '2026-10-15T00:00:00.000Z',
    judge: { mode: 'off' },
    results: [
      'champion-2022',
      'shot-conversion-2022',
      'gone-from-the-bank',
    ].map((id, index) => ({
      id,
      question: `question ${id}`,
      category: 'lookup',
      scores: {},
      checkResults: [],
      answer: '',
      toolCalls: [],
      status: index === 1 ? 'failed' : 'passed',
      passed: index !== 1,
      durationMs: 1,
    })),
  };
  const repository = new EvalRunsRepository({
    findOne: jest.fn().mockResolvedValue(old),
    find: jest.fn().mockResolvedValue([old]),
  } as unknown as DocStore<EvalRunView>);

  it('reads one attempt per question, the source app and each split from the question bank, else dev', async () => {
    for (const run of [
      await repository.get('old'),
      (await repository.list('assistant'))[0],
    ]) {
      expect(run).toMatchObject({ repeats: 1, source: 'app' });
      expect(
        run?.results.map(({ id, split, passes, runs, flaky }) => ({
          id,
          split,
          passes,
          runs,
          flaky,
        })),
      ).toEqual([
        { id: 'champion-2022', split: 'dev', passes: 1, runs: 1, flaky: false },
        {
          id: 'shot-conversion-2022',
          split: 'held-out',
          passes: 0,
          runs: 1,
          flaky: false,
        },
        {
          id: 'gone-from-the-bank',
          split: 'dev',
          passes: 1,
          runs: 1,
          flaky: false,
        },
      ]);
      // No usage was recorded, so none is made up; the category stays.
      expect(run).not.toHaveProperty('usage');
      expect(run).not.toHaveProperty('costUsd');
      expect(run?.results[0].category).toBe('lookup');
      expect(run?.summary.bySplit.dev).toMatchObject({ passed: 2, total: 2 });
      expect(run?.summary.bySplit.heldOut).toMatchObject({
        failed: 1,
        total: 1,
      });
    }
  });

  it('keeps what a newer run stored', async () => {
    const current = {
      ...old,
      repeats: 3,
      source: 'cli',
      usage: [],
      costUsd: 0,
      results: [
        {
          ...old.results[0],
          split: 'held-out',
          passes: 2,
          runs: 3,
          flaky: true,
          status: 'failed',
          passed: false,
        },
      ],
    };
    const read = await new EvalRunsRepository({
      findOne: jest.fn().mockResolvedValue(current),
    } as unknown as DocStore<EvalRunView>).get('current');
    expect(read).toMatchObject({
      repeats: 3,
      source: 'cli',
      usage: [],
      costUsd: 0,
    });
    expect(read?.results[0]).toMatchObject({
      split: 'held-out',
      passes: 2,
      runs: 3,
      flaky: true,
    });
    expect(read?.summary.flaky).toBe(1);
  });
});
