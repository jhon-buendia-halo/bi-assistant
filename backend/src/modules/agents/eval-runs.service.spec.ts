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
import type { EvalRunView } from './eval-runs.service';
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
  /** As Demo User: nobody is signed in outside `runAs` (ADR-0012). */
  const asDemoUser =
    <T>(fn: () => Promise<T>) =>
    (): Promise<T> =>
      users.runAs(LOCAL_USER, fn);
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

  it(
    'rejects the reported F1 selection before persisting a run or calling a model',
    asDemoUser(async () => {
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
    }),
  );

  it(
    'still starts and completes a run with the fixture scope',
    asDemoUser(async () => {
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
            'disciplinary_events',
            'v_match_results',
            'v_player_goal_totals',
          ].map((table) => `world_cup.world_cup.${table}`),
        },
      ]);
      const runner = service();
      const result = await runner.start('assistant', 'wc');
      expect(result).toEqual({ jobId: expect.any(String) });
      await new Promise((resolve) => setImmediate(resolve));
      // No judge option given: the judge is off (R100).
      expect(runAssistantEvalCase).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'champion-2022' }),
        ['Sample'],
        'session',
        '',
        { mode: 'off' },
      );
      if (!('jobId' in result)) throw new Error('Run did not start');
      expect((await runner.status(result.jobId))?.status).toBe('completed');
      // R40: the baseline must also share a question with this run.
      expect(repository.mostRecentCompleted).toHaveBeenCalledWith(
        'assistant',
        result.jobId,
        'wc',
        ['Sample'],
        ['champion-2022'],
      );
    }),
  );
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
        'disciplinary_events',
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
          release = () =>
            resolve({ id: 'champion-2022', passed: true } as never);
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

describe('EvalRunsService judge option and summary (R100, R104)', () => {
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
        'disciplinary_events',
        'v_match_results',
        'v_player_goal_totals',
      ].map((table) => `world_cup.world_cup.${table}`),
    },
  ];
  const users = new CurrentUserService();
  const repository = {
    insert: jest.fn(),
    save: jest.fn(),
    mostRecentCompleted: jest.fn(),
  };
  const service = () =>
    new EvalRunsService(
      { list: jest.fn().mockResolvedValue(sample) } as never,
      repository as never,
      {} as never,
      {} as never,
      { definitionBlock: jest.fn().mockResolvedValue('') } as never,
      users,
    );
  const asDemoUser = <T>(fn: () => Promise<T>): Promise<T> =>
    users.runAs(LOCAL_USER, fn);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [{ judge: 'sometimes' }, 'Unknown judge option "sometimes"'],
    [{ judge: 'categories' }, 'Pick at least one category to judge'],
    [
      { judge: 'categories', judgeCategories: ['joins'] },
      'Unknown judge category "joins". Known categories:',
    ],
  ])(
    'refuses %j without recording a run or calling a model',
    (options, message) =>
      asDemoUser(async () => {
        const result = await service().start(
          'assistant',
          'wc',
          undefined,
          options,
        );
        expect('error' in result ? result.error : '').toContain(message);
        expect(repository.insert).not.toHaveBeenCalled();
        expect(runAssistantEvalCase).not.toHaveBeenCalled();
      }),
  );

  it('records the judge option and passes it to every question', () =>
    asDemoUser(async () => {
      const runner = service();
      const started = await runner.start('assistant', 'wc', undefined, {
        judge: 'categories',
        judgeCategories: ['out-of-scope', 'ambiguous'],
      });
      if (!('jobId' in started)) throw new Error('Run did not start');
      const judge = {
        mode: 'categories',
        categories: ['ambiguous', 'out-of-scope'],
      };
      expect(repository.insert).toHaveBeenCalledWith(
        expect.objectContaining({ judge }),
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(runAssistantEvalCase).toHaveBeenCalledWith(
        expect.anything(),
        ['Sample'],
        'session',
        '',
        judge,
      );
    }));

  it('keeps the summary current as questions finish', () =>
    asDemoUser(async () => {
      jest.mocked(runAssistantEvalCase).mockResolvedValueOnce({
        id: 'champion-2022',
        question: 'Who won the 2022 World Cup?',
        category: 'out-of-scope',
        scores: {},
        checkResults: [
          {
            id: 'llm-judge',
            description: 'LLM judge: …',
            score: 0,
            passed: false,
            status: 'not-scored',
            reason: 'Judge off for this run',
            criterion: 'G2',
          },
        ],
        answer: '',
        toolCalls: [],
        status: 'not-scored',
        passed: false,
        durationMs: 1,
      });
      const runner = service();
      const started = await runner.start('assistant', 'wc');
      if (!('jobId' in started)) throw new Error('Run did not start');
      // The run object is updated in place, so only its keys are checked here.
      const inserted = (repository.insert.mock.calls[0] as [EvalRunView])[0];
      expect(inserted.judge).toEqual({ mode: 'off' });
      expect(inserted.summary).toBeDefined();
      await new Promise((resolve) => setImmediate(resolve));
      const view = await runner.status(started.jobId);
      expect(view?.status).toBe('completed');
      expect(view?.summary).toEqual({
        passed: 0,
        failed: 0,
        notScored: 1,
        byCategory: [
          {
            category: 'out-of-scope',
            passed: 0,
            failed: 0,
            notScored: 1,
            total: 1,
          },
        ],
        byCriterion: [],
      });
      // Persisted with the summary.
      const saved = (repository.save.mock.calls.at(-1) as [EvalRunView])[0];
      expect(saved.summary.notScored).toBe(1);
    }));
});
