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
    const repository = new EvalRunsRepository({ find } as any);
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
    } as any);
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
