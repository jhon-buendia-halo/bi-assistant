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
import { CurrentUserService, LOCAL_USER } from '../auth/current-user.service';
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
  const users = new CurrentUserService();
  const service = () =>
    new EvalRunsService(
      datasets as any,
      repository as any,
      {} as any,
      {} as any,
      knowledge as any,
      users,
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

describe('EvalRunsService ownership (admin R30, R32)', () => {
  const sample = [
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
  ];
  const ada = { ...LOCAL_USER, id: 'ada' };
  const bob = { ...LOCAL_USER, id: 'bob' };

  function build() {
    const users = new CurrentUserService();
    const repository = {
      insert: jest.fn(),
      save: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(0),
      mostRecentCompleted: jest.fn(),
    };
    let release: () => void = () => undefined;
    const savedBy: (string | undefined)[] = [];
    repository.save.mockImplementation(() => {
      savedBy.push(users.current()?.id);
      return Promise.resolve(null);
    });
    jest.mocked(runAssistantEvalCase).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ id: 'champion-2022', passed: true });
        }),
    );
    const service = new EvalRunsService(
      { list: jest.fn().mockResolvedValue(sample) } as never,
      repository as never,
      {} as never,
      {} as never,
      { definitionBlock: jest.fn().mockResolvedValue('') } as never,
      users,
    );
    return { service, users, repository, savedBy, release: () => release() };
  }

  it('hides a running run from other users and lets each user run their own', async () => {
    const { service, users, repository, savedBy, release } = build();

    const started = await users.runAs(ada, () =>
      service.start('assistant', 'wc'),
    );
    if (!('jobId' in started)) throw new Error('Run did not start');

    // Bob neither sees Ada's run nor is blocked by it.
    await expect(
      users.runAs(bob, () => service.status(started.jobId)),
    ).resolves.toBeNull();
    await expect(
      users.runAs(bob, () => service.remove(started.jobId)),
    ).resolves.toBe(false);
    expect(repository.delete).toHaveBeenCalledTimes(1);
    const bobs = await users.runAs(bob, () => service.start('assistant', 'wc'));
    expect('jobId' in bobs).toBe(true);

    // Ada still sees hers, and a second start of hers conflicts with it.
    await expect(
      users.runAs(ada, () => service.status(started.jobId)),
    ).resolves.toMatchObject({ status: 'running' });
    await expect(
      users.runAs(ada, () => service.start('assistant', 'wc')),
    ).resolves.toEqual({ conflictWith: started.jobId });

    // The run keeps writing as Ada.
    release();
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(savedBy.length).toBeGreaterThan(0);
    expect(
      savedBy.filter((id) => id !== 'bob').every((id) => id === 'ada'),
    ).toBe(true);
  });
});
