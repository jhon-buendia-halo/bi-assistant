jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../sessions/sessions.service', () => ({
  SessionsService: class {},
}));
jest.mock('../knowledge/knowledge.service', () => ({
  KnowledgeService: class {},
}));
jest.mock('../../mastra/evals/assistant.evals', () => ({
  selectEvalCases: jest.fn(() => [
    { id: 'champion-2022', question: 'Who won the 2022 World Cup?' },
  ]),
  createEvalSession: jest.fn().mockResolvedValue({ id: 'session' }),
  cleanupEvalSession: jest.fn().mockResolvedValue(undefined),
  runAssistantEvalCase: jest
    .fn()
    .mockResolvedValue({ id: 'champion-2022', passed: true }),
  // The real helper resolves the set's fixture from the registry; keep the
  // mock honest by handing back the same entry the World Cup set points at.
  fixtureForCases: jest.fn(() =>
    jest
      .requireActual<typeof import('../testing-data/fixtures/registry')>(
        '../testing-data/fixtures/registry',
      )
      .findFixture('world-cup'),
  ),
}));

import { EvalRunsService } from './eval-runs.service';
import {
  createEvalSession,
  runAssistantEvalCase,
} from '../../mastra/evals/assistant.evals';

describe('EvalRunsService dataset validation', () => {
  const datasets = { list: jest.fn() };
  const repository = {
    insert: jest.fn(),
    save: jest.fn(),
    mostRecentCompleted: jest.fn(),
  };
  const knowledge = { definitionBlock: jest.fn().mockResolvedValue('') };
  const metrics = { definitionBlock: jest.fn().mockResolvedValue(undefined) };
  const service = () =>
    new EvalRunsService(
      datasets as any,
      repository as any,
      {} as any,
      {} as any,
      knowledge as any,
      metrics as any,
    );

  beforeEach(() => jest.clearAllMocks());

  it('rejects the reported F1 selection before persisting a run or calling a model', async () => {
    datasets.list.mockResolvedValue([
      {
        name: 'Nick F1 Data source',
        datasourceId: 'f1',
        datasourceKind: 'postgres',
        tables: ['formula1.formula1.race'],
      },
      {
        name: 'F1 Test',
        datasourceId: 'f1',
        datasourceKind: 'postgres',
        tables: ['formula1.formula1.driver'],
      },
    ]);
    const result = await service().start('assistant', 'f1');
    expect(result).toEqual({
      error: expect.stringContaining('bundled World Cup sample'),
    });
    expect(repository.insert).not.toHaveBeenCalled();
    expect(createEvalSession).not.toHaveBeenCalled();
    expect(runAssistantEvalCase).not.toHaveBeenCalled();
  });

  it('still starts and completes a run with the fixture scope', async () => {
    datasets.list.mockResolvedValue([
      {
        name: 'Sample',
        datasourceId: 'wc',
        datasourceKind: 'postgres',
        tables: [
          'tournaments',
          'teams',
          'matches',
          'venues',
          'players',
          'goals',
          'match_team_statistics',
          'v_match_results',
          'v_player_goal_totals',
        ].map((table) => `world_cup.world_cup.${table}`),
      },
    ]);
    const runner = service();
    const result = await runner.start('assistant', 'wc');
    expect(result).toEqual({ jobId: expect.any(String) });
    await new Promise((resolve) => setImmediate(resolve));
    expect(runAssistantEvalCase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'champion-2022' }),
      ['Sample'],
      'session',
      '',
      { path: 'model', metricsBlock: undefined },
    );
    if (!('jobId' in result)) throw new Error('Run did not start');
    expect((await runner.status(result.jobId))?.status).toBe('completed');
    expect(repository.mostRecentCompleted).toHaveBeenCalledWith(
      'assistant',
      result.jobId,
      'wc',
      ['Sample'],
    );
  });
});
