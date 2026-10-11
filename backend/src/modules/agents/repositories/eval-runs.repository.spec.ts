import { EvalRunsRepository } from './eval-runs.repository';

describe('eval regression baseline scope', () => {
  it('skips other datasets and the current run; dataset ordering is irrelevant', async () => {
    const find = jest.fn().mockResolvedValue([
      { jobId: 'current', datasets: ['Core', 'Stats'] },
      { jobId: 'different', datasets: ['Core', 'Other'] },
      { jobId: 'partial', datasets: ['Core'] },
      { jobId: 'baseline', datasets: ['Stats', 'Core'] },
    ]);
    const repository = new EvalRunsRepository({ find } as any);
    const baseline = await repository.mostRecentCompleted(
      'assistant',
      'current',
      'wc',
      ['Core', 'Stats'],
    );
    expect(find).toHaveBeenCalledWith(
      { agentKey: 'assistant', status: 'completed', datasourceId: 'wc' },
      { sort: { startedAt: -1 } },
    );
    expect(baseline?.jobId).toBe('baseline');
  });

  it('returns no baseline when only incompatible scopes exist', async () => {
    const repository = new EvalRunsRepository({
      find: jest.fn().mockResolvedValue([{ jobId: 'other', datasets: ['F1'] }]),
    } as any);
    expect(
      await repository.mostRecentCompleted('assistant', 'current', 'wc', [
        'World Cup',
      ]),
    ).toBeNull();
  });

  it('compares a legacy run only with an earlier legacy run (agents-evals R40)', async () => {
    const repository = new EvalRunsRepository({
      find: jest.fn().mockResolvedValue([
        { jobId: 'model-newer', datasets: ['Core'], path: 'model' },
        { jobId: 'unpathed', datasets: ['Core'] },
        { jobId: 'legacy-older', datasets: ['Core'], path: 'legacy' },
      ]),
    } as never);

    const baseline = await repository.mostRecentCompleted(
      'assistant',
      'current',
      'wc',
      ['Core'],
      'legacy',
    );

    expect(baseline?.jobId).toBe('legacy-older');
  });

  it('compares a model run only with model runs, counting a run saved before paths as model', async () => {
    const repository = new EvalRunsRepository({
      find: jest.fn().mockResolvedValue([
        { jobId: 'legacy-newer', datasets: ['Core'], path: 'legacy' },
        { jobId: 'unpathed', datasets: ['Core'] },
      ]),
    } as never);

    const baseline = await repository.mostRecentCompleted(
      'assistant',
      'current',
      'wc',
      ['Core'],
      'model',
    );

    expect(baseline?.jobId).toBe('unpathed');
  });

  it('finds no baseline for a legacy run when only model runs exist', async () => {
    const repository = new EvalRunsRepository({
      find: jest
        .fn()
        .mockResolvedValue([
          { jobId: 'model', datasets: ['Core'], path: 'model' },
        ]),
    } as never);

    expect(
      await repository.mostRecentCompleted(
        'assistant',
        'current',
        'wc',
        ['Core'],
        'legacy',
      ),
    ).toBeNull();
  });
});
