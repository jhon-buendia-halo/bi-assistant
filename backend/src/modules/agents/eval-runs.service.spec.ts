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
// The command line's preflight reads the named datasets as a chat turn does.
const mockGetDatasets = jest.fn();
jest.mock('../../mastra/tool-services', () => ({
  getDatasetToolServices: () => ({ getDatasets: mockGetDatasets }),
}));
jest.mock('../../mastra/evals/assistant.evals', () => ({
  selectEvalCases: jest.fn(() => [
    { id: 'champion-2022', question: 'Who won the 2022 World Cup?' },
  ]),
  evalRunModel: jest.fn().mockResolvedValue('openai/gpt-4o-mini'),
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
      // No judge option given: the judge is off (R144).
      expect(runAssistantEvalCase).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'champion-2022' }),
        ['Sample'],
        'session',
        '',
        { agentKey: 'assistant' },
        { mode: 'off' },
        { model: 'openai/gpt-4o-mini' },
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
      { model: 'openai/gpt-4o-mini' },
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

describe('EvalRunsService judge option and summary (R144, R148)', () => {
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
        { model: 'openai/gpt-4o-mini' },
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
        split: 'dev',
        passes: 0,
        runs: 1,
        flaky: false,
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
      const notScored = {
        passed: 0,
        failed: 0,
        notScored: 1,
        flaky: 0,
        total: 1,
      };
      const none = { passed: 0, failed: 0, notScored: 0, flaky: 0, total: 0 };
      expect(view?.summary).toEqual({
        passed: 0,
        failed: 0,
        notScored: 1,
        flaky: 0,
        bySplit: { dev: notScored, heldOut: none },
        byCategory: [
          {
            category: 'out-of-scope',
            ...notScored,
            dev: notScored,
            heldOut: none,
          },
        ],
        byCriterion: [],
      });
      // Persisted with the summary.
      const saved = (repository.save.mock.calls.at(-1) as [EvalRunView])[0];
      expect(saved.summary.notScored).toBe(1);
    }));
});

describe('EvalRunsService repeats, attempts and usage (R209 to R211, R219 to R223)', () => {
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
  const cases = [
    { id: 'champion-2022', question: 'Who won the 2022 World Cup?' },
    {
      id: 'shot-conversion-2022',
      question: 'What share of shots were converted?',
      split: 'held-out',
    },
  ];
  /** The run as it was when each save happened. */
  let saved: EvalRunView[];
  let inserted: EvalRunView[];
  const repository = {
    insert: jest.fn((view: EvalRunView) => {
      inserted.push(structuredClone(view));
      return Promise.resolve(view);
    }),
    save: jest.fn((view: EvalRunView) => {
      saved.push(structuredClone(view));
      return Promise.resolve(view);
    }),
    get: jest.fn(),
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
  /** The assistant's tokens on one model for one call. */
  const usage = (model: string, inputTokens: number) => [
    {
      agent: 'assistant' as const,
      model,
      inputTokens,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      calls: 1,
      unreportedCalls: 0,
    },
  ];
  /** One attempt as the runner returns it. */
  const attempt = (
    id: string,
    passed: boolean,
    costUsd: number | null = 0.15,
    model = 'gpt-4o-mini',
  ) => ({
    id,
    question: id,
    split: id === 'shot-conversion-2022' ? 'held-out' : 'dev',
    scores: {},
    checkResults: [],
    answer: '',
    toolCalls: [],
    status: passed ? 'passed' : 'failed',
    passed,
    durationMs: 1,
    passes: passed ? 1 : 0,
    runs: 1,
    flaky: false,
    usage: usage(model, 1_000_000),
    costUsd,
  });
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    saved = [];
    inserted = [];
    jest.mocked(selectEvalCases).mockReturnValue(cases as never);
  });
  afterEach(() => {
    // Back to the module mock's defaults for the tests that follow.
    jest
      .mocked(selectEvalCases)
      .mockReturnValue([
        { id: 'champion-2022', question: 'Who won the 2022 World Cup?' },
      ] as never);
    jest
      .mocked(runAssistantEvalCase)
      .mockResolvedValue({ id: 'champion-2022', passed: true } as never);
  });

  it.each([
    [2, 'Repeats must be 1, 3 or 5 (got "2")'],
    ['3', 'Repeats must be 1, 3 or 5 (got "3")'],
    [true, 'Repeats must be 1, 3 or 5 (got "true")'],
  ])(
    'refuses repeats %j without recording a run or calling a model',
    async (repeats, message) => {
      await expect(
        service().start('assistant', 'wc', undefined, { repeats }),
      ).resolves.toEqual({ error: message });
      expect(repository.insert).not.toHaveBeenCalled();
      expect(runAssistantEvalCase).not.toHaveBeenCalled();
    },
  );

  it('refuses a bad judge option before bad repeats (R19 steps 8 and 9)', async () => {
    await expect(
      service().start('assistant', 'wc', undefined, {
        judge: 'sometimes',
        repeats: 2,
      }),
    ).resolves.toEqual({ error: 'Unknown judge option "sometimes"' });
  });

  it('records the repeats, the model, no usage yet and the source app at start (R22)', async () => {
    const started = await service().start('assistant', 'wc', undefined, {
      repeats: 3,
    });
    expect(started).toEqual({ jobId: expect.any(String) as string });
    expect(inserted[0]).toMatchObject({
      repeats: 3,
      model: 'openai/gpt-4o-mini',
      usage: [],
      costUsd: 0,
      source: 'app',
      currentQuestion: 'Who won the 2022 World Cup?',
      currentAttempt: 1,
    });
    await settle();
  });

  it('defaults to one attempt per question', async () => {
    await service().start('assistant', 'wc');
    expect(inserted[0].repeats).toBe(1);
    await settle();
    expect(runAssistantEvalCase).toHaveBeenCalledTimes(2);
  });

  it('runs every attempt of a question before the next, saving once per question, with the attempt in flight', async () => {
    const seen: string[] = [];
    let live: EvalRunView | undefined;
    repository.insert.mockImplementationOnce((view: EvalRunView) => {
      live = view;
      inserted.push(structuredClone(view));
      return Promise.resolve(view);
    });
    jest
      .mocked(runAssistantEvalCase)
      .mockImplementation((evalCase: { id: string }) => {
        seen.push(`${evalCase.id} #${live?.currentAttempt}`);
        // The held-out question passes 2 of its 3 attempts.
        const passed =
          evalCase.id !== 'shot-conversion-2022' ||
          seen.filter((s) => s.startsWith('shot')).length !== 2;
        return Promise.resolve(attempt(evalCase.id, passed) as never);
      });

    const runner = service();
    const started = await runner.start('assistant', 'wc', undefined, {
      repeats: 3,
    });
    if (!('jobId' in started)) throw new Error('Run did not start');
    await settle();

    expect(seen).toEqual([
      'champion-2022 #1',
      'champion-2022 #2',
      'champion-2022 #3',
      'shot-conversion-2022 #1',
      'shot-conversion-2022 #2',
      'shot-conversion-2022 #3',
    ]);
    // One save per question, then the final one.
    expect(saved.map((view) => view.results.length)).toEqual([1, 2, 2]);
    expect(saved[0]).toMatchObject({
      currentQuestion: 'What share of shots were converted?',
      currentAttempt: 1,
    });
    const view = await runner.status(started.jobId);
    expect(view).toMatchObject({ status: 'completed' });
    expect(view).not.toHaveProperty('currentAttempt', expect.anything());
    expect(
      view?.results.map((r) => [r.id, r.status, r.passes, r.flaky]),
    ).toEqual([
      ['champion-2022', 'passed', 3, false],
      ['shot-conversion-2022', 'failed', 2, true],
    ]);
    expect(view?.results[1].attempts).toHaveLength(3);
    expect(view?.summary).toMatchObject({ passed: 1, failed: 1, flaky: 1 });
    expect(view?.summary.bySplit.heldOut).toMatchObject({
      failed: 1,
      flaky: 1,
    });
    // Six attempts of 1M input tokens at $0.15 per million.
    expect(view?.usage).toEqual([
      expect.objectContaining({
        agent: 'assistant',
        model: 'gpt-4o-mini',
        inputTokens: 6_000_000,
        calls: 6,
      }),
    ]);
    expect(view?.costUsd).toBe(0.9);
    expect(view?.rates).toEqual({
      'gpt-4o-mini': expect.objectContaining({
        inputPerMillionUsd: 0.15,
      }) as unknown,
    });
  });

  it('is not priced as a whole when one question is not', async () => {
    jest
      .mocked(runAssistantEvalCase)
      .mockResolvedValueOnce(attempt('champion-2022', true) as never)
      .mockResolvedValueOnce(
        attempt('shot-conversion-2022', true, null, 'llama-3') as never,
      );
    const runner = service();
    const started = await runner.start('assistant', 'wc');
    if (!('jobId' in started)) throw new Error('Run did not start');
    await settle();
    const view = await runner.status(started.jobId);
    expect(view?.costUsd).toBeNull();
    expect(view?.usage?.map((entry) => entry.model)).toEqual([
      'gpt-4o-mini',
      'llama-3',
    ]);
    expect(Object.keys(view?.rates ?? {})).toEqual(['gpt-4o-mini']);
  });

  it('answers the repeats of the run it was compared with', async () => {
    const runner = service();
    repository.get.mockResolvedValueOnce({ jobId: 'job-0', repeats: 1 });
    const view = {
      comparison: {
        previousRunId: 'job-0',
        regressions: [],
        improvements: [],
        unchanged: [],
      },
    } as unknown as EvalRunView;
    await expect(runner.comparedRunRepeats(view)).resolves.toBe(1);
    expect(repository.get).toHaveBeenCalledWith('job-0');
    await expect(
      runner.comparedRunRepeats({} as EvalRunView),
    ).resolves.toBeUndefined();
  });

  describe('runFromCommandLine (R42, R223)', () => {
    const request = {
      agentKey: 'assistant',
      datasets: ['Sample'],
      caseIds: ['champion-2022', 'shot-conversion-2022'],
      judge: { mode: 'off' as const },
      repeats: 1 as const,
    };

    it('saves the run with the source cli and the datasource of the named datasets, and waits for it', async () => {
      mockGetDatasets.mockResolvedValue(sample);
      jest
        .mocked(runAssistantEvalCase)
        .mockResolvedValueOnce(attempt('champion-2022', true) as never)
        .mockResolvedValueOnce(attempt('shot-conversion-2022', false) as never);
      const heard: string[] = [];

      const outcome = await service().runFromCommandLine(request, (result) =>
        heard.push(result.id),
      );

      expect(mockGetDatasets).toHaveBeenCalledWith(['Sample']);
      if (!('run' in outcome)) throw new Error(outcome.error);
      expect(outcome.run).toMatchObject({
        status: 'completed',
        source: 'cli',
        datasourceId: 'wc',
        datasets: ['Sample'],
        repeats: 1,
        model: 'openai/gpt-4o-mini',
        caseIds: ['champion-2022', 'shot-conversion-2022'],
      });
      expect(inserted[0]).toMatchObject({ source: 'cli', status: 'running' });
      expect(heard).toEqual(['champion-2022', 'shot-conversion-2022']);
      // Saved after each question, as the app's runs are, and compared.
      expect(saved.map((view) => view.results.length)).toEqual([1, 2, 2]);
      expect(repository.mostRecentCompleted).toHaveBeenCalledWith(
        'assistant',
        outcome.run.jobId,
        'wc',
        ['Sample'],
        ['champion-2022', 'shot-conversion-2022'],
      );
    });

    it('refuses datasets that do not cover the sample, recording nothing', async () => {
      mockGetDatasets.mockResolvedValue([]);
      const outcome = await service().runFromCommandLine(request);
      expect(outcome).toEqual({
        error: expect.stringContaining('Datasets not found: Sample') as string,
      });
      expect(repository.insert).not.toHaveBeenCalled();
      expect(runAssistantEvalCase).not.toHaveBeenCalled();
    });
  });
});
