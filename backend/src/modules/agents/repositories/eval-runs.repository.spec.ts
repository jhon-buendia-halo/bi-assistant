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
    const worldCup = ['champion-2022', 'final-score-2018'];
    const golden = ['pass-accuracy-by-team', 'teams-tied-on-four-goals'];

    it('does not compare a golden-set run with an earlier World Cup run', async () => {
      const repository = new EvalRunsRepository(
        storeOf([run('wc-1', worldCup)]),
      );
      expect(
        await repository.mostRecentCompleted(
          'assistant',
          'golden-1',
          'wc',
          ['World Cup'],
          golden,
        ),
      ).toBeNull();
    });

    it('compares a World Cup run with the earlier World Cup run, past a golden-set run in between', async () => {
      const repository = new EvalRunsRepository(
        // Newest first, as the store sorts them.
        storeOf([run('golden-1', golden), run('wc-1', worldCup)]),
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

describe('runs saved before BA-184 are read with defaults (R143, R146, R147)', () => {
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
      expect(run?.summary).toEqual({
        passed: 1,
        failed: 1,
        notScored: 0,
        byCategory: [
          {
            category: 'uncategorised',
            passed: 1,
            failed: 1,
            notScored: 0,
            total: 2,
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
