jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../sessions/sessions.service', () => ({
  SessionsService: class {},
}));
jest.mock('../knowledge/knowledge.service', () => ({
  KnowledgeService: class {},
}));
// One set per agent: a set's agent is its `agentKey`, `assistant` by default.
jest.mock('../../mastra/evals/eval-sets', () => {
  const sets = [
    { id: 'world-cup', cases: [{ id: 'champion-2022' }] },
    { id: 'rfp', agentKey: 'rfp', cases: [{ id: 'rfp-skill-first' }] },
  ];
  const targets: Record<string, unknown> = {
    assistant: { agentKey: 'assistant' },
    rfp: { agentKey: 'rfp', finish: jest.fn().mockResolvedValue(undefined) },
  };
  return {
    evalSetsFor: (key: string) =>
      sets.filter((set) => (set.agentKey ?? 'assistant') === key),
    evalTargetFor: (key: string) => targets[key],
  };
});
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
import {
  createEvalSession,
  fixtureForCases,
  runAssistantEvalCase,
  selectEvalCases,
} from '../../mastra/evals/assistant.evals';
import { evalTargetFor } from '../../mastra/evals/eval-sets';

describe('EvalRunsService dataset validation', () => {
  const datasets = { list: jest.fn() };
  const repository = {
    insert: jest.fn(),
    save: jest.fn(),
    mostRecentCompleted: jest.fn(),
  };
  const knowledge = { definitionBlock: jest.fn().mockResolvedValue('') };
  /** A test body, kept as a wrapper so the cases read as before. */
  const asDemoUser =
    <T>(fn: () => Promise<T>) =>
    (): Promise<T> =>
      fn();
  const service = () =>
    new EvalRunsService(
      datasets as never,
      repository as never,
      {} as never,
      {} as never,
      knowledge as never,
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
        error: expect.stringContaining('bundled World Cup sample') as string,
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
      expect(result).toEqual({ jobId: expect.any(String) as string });
      await new Promise((resolve) => setImmediate(resolve));
      // No judge option given: the judge is off (R143).
      expect(runAssistantEvalCase).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'champion-2022' }),
        ['Sample'],
        'session',
        '',
        { agentKey: 'assistant' },
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

describe('EvalRunsService eval sets per agent (agents.md 8.1)', () => {
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
    );

  beforeEach(() => jest.clearAllMocks());

  it('refuses an agent with no eval set', async () => {
    await expect(service().start('visualization', 'wc')).resolves.toEqual({
      error: 'Agent "visualization" has no evals to run',
    });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("runs the rfp set on the RFP Builder's target and cleans up after it", async () => {
    jest
      .mocked(selectEvalCases)
      .mockReturnValueOnce([
        { id: 'rfp-skill-first', question: 'Start an RFP for Orchard' },
      ] as never);
    jest
      .mocked(runAssistantEvalCase)
      .mockResolvedValueOnce({ id: 'rfp-skill-first', passed: true } as never);

    const started = await service().start('rfp', 'wc', ['rfp-skill-first']);

    expect(started).toEqual({ jobId: expect.any(String) as string });
    const rfpSets = [
      { id: 'rfp', agentKey: 'rfp', cases: [{ id: 'rfp-skill-first' }] },
    ];
    expect(selectEvalCases).toHaveBeenCalledWith(['rfp-skill-first'], rfpSets);
    expect(fixtureForCases).toHaveBeenCalledWith(['rfp-skill-first'], rfpSets);
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKey: 'rfp',
        caseIds: ['rfp-skill-first'],
        totalCases: 1,
      }),
    );
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const target = evalTargetFor('rfp', 'any') as unknown as {
      finish: jest.Mock;
    };
    expect(runAssistantEvalCase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rfp-skill-first' }),
      ['Sample'],
      'session',
      '',
      target,
      { mode: 'off' },
    );
    expect(target.finish).toHaveBeenCalledWith(['Sample']);
  });
});

describe('EvalRunsService one running run per agent', () => {
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

  it('refuses a second start while one runs, answers its status, and frees the agent when it ends', async () => {
    const repository = {
      insert: jest.fn(),
      save: jest.fn().mockResolvedValue(null),
      get: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(0),
      mostRecentCompleted: jest.fn(),
    };
    let release: () => void = () => undefined;
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
    );

    const started = await service.start('assistant', 'wc');
    if (!('jobId' in started)) throw new Error('Run did not start');

    await expect(service.status(started.jobId)).resolves.toMatchObject({
      status: 'running',
    });
    await expect(service.start('assistant', 'wc')).resolves.toEqual({
      conflictWith: started.jobId,
    });
    await expect(service.remove(started.jobId)).resolves.toBe(false);

    release();
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await expect(service.status(started.jobId)).resolves.not.toMatchObject({
      status: 'running',
    });
  });
});

describe('EvalRunsService judge option and summary (R143, R147)', () => {
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
    );
  /** A test body, kept as a wrapper so the cases read as before. */
  const asDemoUser = <T>(fn: () => Promise<T>): Promise<T> => fn();

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
        { agentKey: 'assistant' },
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
