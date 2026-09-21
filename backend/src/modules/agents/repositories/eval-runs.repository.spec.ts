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
});
