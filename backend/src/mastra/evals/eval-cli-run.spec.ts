import {
  cliDatasourceId,
  cliRun,
  savedLlmLabel,
  type CliRunInput,
} from './eval-cli-run';
import type { EvalRunView } from '../../modules/agents/eval-runs.service';
import type { AssistantEvalCaseResult } from './assistant.evals';

const result = (id: string, passed: boolean) =>
  ({ id, passed, checkResults: [] }) as unknown as AssistantEvalCaseResult;

const input = (over: Partial<CliRunInput> = {}): CliRunInput => ({
  agentKey: 'assistant',
  datasets: ['A', 'B'],
  caseIds: ['q1', 'q2'],
  setId: 'world-cup',
  provider: 'custom',
  model: 'm1',
  datasetList: [
    { name: 'A', datasourceId: 'ds1' },
    { name: 'B', datasourceId: 'ds1' },
  ],
  ...over,
});

const store = () => ({
  insert: jest.fn<Promise<void>, [EvalRunView]>().mockResolvedValue(undefined),
  save: jest.fn<Promise<void>, [EvalRunView]>().mockResolvedValue(undefined),
  mostRecentCompleted: jest
    .fn<Promise<EvalRunView | null>, unknown[]>()
    .mockResolvedValue(null),
});

describe('cliRun', () => {
  it('stores nothing when no question finished', async () => {
    const s = store();
    const run = cliRun(s, input());
    await run.finish('refused');
    expect(s.insert).not.toHaveBeenCalled();
    expect(s.save).not.toHaveBeenCalled();
  });

  it('inserts on the first result, saves each next one, then completes', async () => {
    const s = store();
    const before = Date.now();
    const run = cliRun(s, input());
    await run.add(result('q1', true));
    expect(s.insert).toHaveBeenCalledTimes(1);
    expect(s.insert.mock.calls[0][0]).toMatchObject({
      jobId: run.jobId,
      source: 'cli',
      setId: 'world-cup',
      provider: 'custom',
      model: 'm1',
      datasourceId: 'ds1',
      status: 'running',
      totalCases: 2,
    });
    expect(
      Date.parse(s.insert.mock.calls[0][0].startedAt),
    ).toBeGreaterThanOrEqual(before);
    await run.add(result('q2', false));
    expect(s.save).toHaveBeenCalledTimes(1);
    await run.finish();
    const saved = s.save.mock.calls[s.save.mock.calls.length - 1][0];
    expect(saved).toMatchObject({ status: 'completed' });
    expect(saved.finishedAt).toEqual(expect.any(String));
    expect(saved.results).toHaveLength(2);
  });

  it('marks the run failed with the error', async () => {
    const s = store();
    const run = cliRun(s, input());
    await run.add(result('q1', true));
    await run.finish('boom');
    expect(s.save.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'failed',
      error: 'boom',
    });
  });

  it('attaches the comparison with the previous completed run', async () => {
    const s = store();
    s.mostRecentCompleted.mockResolvedValue({
      jobId: 'prev',
      results: [result('q1', true)],
    } as unknown as EvalRunView);
    const run = cliRun(s, input({ caseIds: ['q1'] }));
    await run.add(result('q1', false));
    await run.finish();
    expect(s.mostRecentCompleted).toHaveBeenCalledWith(
      'assistant',
      run.jobId,
      'ds1',
      ['A', 'B'],
    );
    expect(s.save.mock.calls.at(-1)?.[0].comparison).toMatchObject({
      previousRunId: 'prev',
    });
  });
});

describe('cliDatasourceId', () => {
  const list = [
    { name: 'A', datasourceId: 'ds1' },
    { name: 'B', datasourceId: 'ds2' },
  ];
  it('is the one shared datasource', () => {
    expect(cliDatasourceId(['A'], list)).toBe('ds1');
  });
  it('is empty across datasources or for unknown names', () => {
    expect(cliDatasourceId(['A', 'B'], list)).toBe('');
    expect(cliDatasourceId(['Z'], list)).toBe('');
  });
});

describe('savedLlmLabel', () => {
  it('falls back to the env default when nothing is saved', () => {
    expect(savedLlmLabel({ provider: null, model: null })).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    expect(savedLlmLabel({ provider: 'copilot', model: 'gpt-5' })).toEqual({
      provider: 'copilot',
      model: 'gpt-5',
    });
  });
});
