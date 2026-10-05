jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../sessions/sessions.service', () => ({
  SessionsService: class {},
}));
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));
jest.mock('../engine/engine-settings.service', () => ({
  EngineSettingsService: class {},
}));
// The harness is mocked away: this spec is about what the service does
// around a run (preflight, queue, stop, telemetry, logs), not about the agent.
// `mergeEngineOverrides` keeps its real semantics so the arm merge is tested.
jest.mock('../../mastra/evals/assistant.evals', () => {
  const engine = jest.requireActual('../engine/engine-options');
  return {
    runAssistantEvalCaseRepeated: jest.fn(),
    mergeEngineOverrides: jest.fn((arm: string | undefined, overrides: unknown) => ({
      ...engine.sanitizeEngineOptions(engine.armOptions(arm)),
      ...engine.sanitizeEngineOptions(overrides ?? {}),
    })),
  };
});
jest.mock('../../mastra/evals/suite-loader', () => {
  const actual = jest.requireActual('../../mastra/evals/suite-loader');
  return { ...actual, loadSuite: jest.fn(actual.loadSuite) };
});

import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  EvalRunsService,
  INTERRUPTED_BY_RESTART,
  STOPPED_BEFORE_START,
  STOPPED_BY_OPERATOR,
} from './eval-runs.service';
import type { EvalRunView } from './eval-runs.service';
import { runAssistantEvalCaseRepeated } from '../../mastra/evals/assistant.evals';
import type {
  EvalCaseContext,
  EvalCaseOutcome,
} from '../../mastra/evals/assistant.evals';
import { loadSuite } from '../../mastra/evals/suite-loader';
import type { EvalSuite, SuiteEvalCase } from '../../mastra/evals/suite-loader';
import { buildLogCase } from './eval-run-record';
import { readRunLogByFile } from './eval-run-log';
import { resolveEngineOptions } from '../engine/engine-options';
import type {
  EvalRunLogAttempt,
  EvalVerdict,
  TokenUsage,
} from './eval-telemetry';

// Run logs are written to the repo by design; point them at a throwaway
// directory so a test run never appends to the real spending history.
const logDir = mkdtempSync(join(tmpdir(), 'eval-log-'));
process.env.EVAL_LOG_DIR = logDir;

const harness = runAssistantEvalCaseRepeated as jest.MockedFunction<
  typeof runAssistantEvalCaseRepeated
>;
const actualLoadSuite: typeof loadSuite = jest.requireActual(
  '../../mastra/evals/suite-loader',
).loadSuite;

const USAGE: TokenUsage = {
  inputTokens: 100,
  outputTokens: 20,
  totalTokens: 120,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  calls: 1,
};

/** One attempt as the harness logs it; `'STOPPED'` = cut off by Stop. */
function attempt(
  verdict: EvalVerdict | 'STOPPED',
  index: number,
): EvalRunLogAttempt {
  return {
    attempt: index + 1,
    verdict: verdict === 'STOPPED' ? 'ERROR' : verdict,
    checks: [
      {
        id: 'result-set-match',
        passed: verdict === 'PASS',
        ...(verdict === 'GAP' ? { gap: true } : {}),
      },
    ],
    ...(verdict === 'STOPPED' ? { error: 'stopped' } : {}),
    sql: [{ sql: 'SELECT 1', ok: true, rowCount: 1 }],
    finalSql: 'SELECT 1',
    answer: 'an answer',
    steps: 1,
    calledTools: ['run_readonly_sql'],
    repairs: [],
    warnings: [],
    durationMs: 5,
    usage: USAGE,
  };
}

/** What the real harness returns, folded with the real `buildLogCase`. */
function outcomeFor(
  evalCase: SuiteEvalCase,
  verdicts: (EvalVerdict | 'STOPPED')[],
  ctx?: EvalCaseContext,
  extra: Partial<EvalCaseOutcome> = {},
): EvalCaseOutcome {
  const attempts = verdicts.map(attempt);
  const logCase = buildLogCase(
    {
      id: evalCase.id,
      category: evalCase.category,
      question: evalCase.question,
    },
    attempts,
  );
  return {
    result: {
      id: evalCase.id,
      category: evalCase.category,
      question: evalCase.question,
      scores: {},
      checkResults: [],
      answer: 'an answer',
      toolCalls: [],
      passed: logCase.verdict === 'PASS',
      durationMs: logCase.durationMs,
      usage: logCase.usage,
      verdict: logCase.verdict,
      runs: logCase.runs,
      passes: logCase.passes,
      flaky: logCase.flaky,
      attempts,
    },
    logCase,
    engine: resolveEngineOptions(undefined, ctx?.engine),
    configHash: 'hash-abc',
    judgeModel: 'openai/gpt-4.1-mini',
    sidePassUsage: { grounding: USAGE },
    stopped: verdicts.includes('STOPPED'),
    ...extra,
  };
}

/** Every attempt passes. */
function passEverything(): void {
  harness.mockImplementation(async (evalCase, ctx, repeat) =>
    outcomeFor(evalCase as SuiteEvalCase, Array(repeat).fill('PASS'), ctx),
  );
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!condition()) throw new Error('condition never became true');
}

/** A dataset holding exactly the suite's required entities. */
function fixtureDataset(suiteId: string, name: string, datasourceId = 'fixtures') {
  return {
    name,
    datasourceId,
    datasourceKind: 'postgres' as const,
    tables: actualLoadSuite(suiteId).requiredEntities.map(
      (entity) => `fixtures.${entity}`,
    ),
  };
}

describe('EvalRunsService', () => {
  const datasets = { list: jest.fn() };
  let store: Map<string, EvalRunView>;
  const repository = {
    insert: jest.fn(async (view: EvalRunView) => {
      store.set(view.jobId, structuredClone(view));
      return view;
    }),
    save: jest.fn(async (view: EvalRunView) => {
      store.set(view.jobId, structuredClone(view));
      return view;
    }),
    get: jest.fn(async (jobId: string) => store.get(jobId) ?? null),
    list: jest.fn(async () => [...store.values()]),
    delete: jest.fn(async (jobId: string) => (store.delete(jobId) ? 1 : 0)),
    mostRecentCompleted: jest.fn(),
    findByLoop: jest.fn(async (loopId: string) =>
      [...store.values()].filter((view) => view.loopId === loopId),
    ),
  };
  const engineSettings = {
    resolved: jest.fn(),
    judgeModel: jest.fn(),
  };
  const llm = { getView: jest.fn() };
  const service = () =>
    new EvalRunsService(
      datasets as any,
      repository as any,
      {} as any,
      { runTurn: jest.fn() } as any,
      engineSettings as any,
      llm as any,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    store = new Map();
    repository.mostRecentCompleted.mockResolvedValue(null);
    engineSettings.resolved.mockResolvedValue(resolveEngineOptions());
    engineSettings.judgeModel.mockResolvedValue(undefined);
    llm.getView.mockResolvedValue({ reasoningEffort: 'high' });
    (loadSuite as jest.Mock).mockImplementation(actualLoadSuite);
    datasets.list.mockResolvedValue([fixtureDataset('world-cup', 'Sample', 'wc')]);
    passEverything();
  });

  describe('preflight', () => {
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
      const result = await service().start('assistant', { datasourceId: 'f1' });
      expect(result).toEqual({
        error: expect.stringContaining('bundled World Cup sample'),
      });
      expect(repository.insert).not.toHaveBeenCalled();
      expect(harness).not.toHaveBeenCalled();
    });

    it('rejects an unknown suite before touching the datasets', async () => {
      expect(
        await service().start('assistant', {
          datasourceId: 'wc',
          suiteId: 'nope',
        }),
      ).toEqual({ error: expect.stringContaining('Unknown eval suite "nope"') });
      expect(datasets.list).not.toHaveBeenCalled();
    });

    it('accepts repeat 1, 3 and 5 only', async () => {
      const runner = service();
      for (const repeat of [0, 2, 4, 10]) {
        expect(
          await runner.start('assistant', { datasourceId: 'wc', repeat }),
        ).toEqual({ error: expect.stringContaining('Repeat must be 1, 3 or 5') });
      }
      expect(repository.insert).not.toHaveBeenCalled();

      const result = await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['champion-2022'],
        repeat: 3,
      });
      await runner.whenIdle();
      expect(harness).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'champion-2022' }),
        expect.anything(),
        3,
        expect.anything(),
      );
      if (!('jobId' in result)) throw new Error('Run did not start');
      expect((await runner.status(result.jobId))?.repeat).toBe(3);
    });

    it('rejects an unknown arm with the list of known ones', async () => {
      expect(
        await service().start('assistant', { datasourceId: 'wc', arm: 'nope' }),
      ).toEqual({ error: expect.stringContaining('Unknown arm "nope"') });
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('treats an explicit empty selection as nothing, not everything', async () => {
      expect(
        await service().start('assistant', { datasourceId: 'wc', caseIds: [] }),
      ).toEqual({ error: 'Pick at least one question to run' });
    });
  });

  describe('a run', () => {
    it('runs every selected case through the harness with the run context', async () => {
      const runner = service();
      const result = await runner.start('assistant', { datasourceId: 'wc' });
      expect(result).toEqual({ jobId: expect.any(String), queued: false });
      await runner.whenIdle();
      if (!('jobId' in result)) throw new Error('Run did not start');

      const suite = actualLoadSuite('world-cup');
      expect(harness).toHaveBeenCalledTimes(suite.cases.length);
      expect(harness).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'champion-2022' }),
        expect.objectContaining({
          datasets: ['Sample'],
          suite: expect.objectContaining({ id: 'world-cup' }),
          engine: {},
          arm: 'baseline',
          dialect: 'postgres',
          abortSignal: expect.any(Object),
          sessions: expect.anything(),
        }),
        1,
        { pricing: { model: expect.any(String), table: expect.any(Object) } },
      );
      const view = await runner.status(result.jobId);
      expect(view?.status).toBe('completed');
      expect(view?.suiteId).toBe('world-cup');
      expect(view?.suiteName).toBe('World Cup');
      expect(view?.results).toHaveLength(suite.cases.length);
      // The suite is part of the baseline's identity: a health-insurance run
      // must never be compared against a World Cup one.
      expect(repository.mostRecentCompleted).toHaveBeenCalledWith(
        'assistant',
        result.jobId,
        'wc',
        ['Sample'],
        'world-cup',
      );
    });

    // Regression: the run used to be scoped to every dataset on the datasource.
    // After `fixtures:register` that is all three fixtures at once, so a genomics
    // run saw World Cup tables.
    it("scopes the run to the suite's own datasets when the datasource has them", async () => {
      datasets.list.mockResolvedValue([
        fixtureDataset('world-cup', 'World Cup'),
        fixtureDataset('genomics', 'Genomics'),
        fixtureDataset('health-insurance', 'Health Insurance'),
      ]);
      const runner = service();
      const result = await runner.start('assistant', {
        datasourceId: 'fixtures',
        caseIds: ['champion-2022'],
      });
      await runner.whenIdle();
      expect(harness).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ datasets: ['World Cup'] }),
        1,
        expect.anything(),
      );
      if (!('jobId' in result)) throw new Error('Run did not start');
      expect((await runner.status(result.jobId))?.datasets).toEqual([
        'World Cup',
      ]);
    });

    it('runs against the datasets the caller names, not the set default', async () => {
      datasets.list.mockResolvedValue([
        // Named like the set's default but missing most of the fixture.
        {
          name: 'World Cup',
          datasourceId: 'fixtures',
          datasourceKind: 'postgres',
          tables: ['fixtures.world_cup.matches'],
        },
        fixtureDataset('world-cup', 'My World Cup'),
      ]);
      const runner = service();
      const result = await runner.start('assistant', {
        datasourceId: 'fixtures',
        caseIds: ['champion-2022'],
        datasets: ['My World Cup'],
      });
      await runner.whenIdle();
      if (!('jobId' in result)) throw new Error('Run did not start');
      expect((await runner.status(result.jobId))?.datasets).toEqual([
        'My World Cup',
      ]);
    });

    it('rejects a dataset name the datasource does not have', async () => {
      expect(
        await service().start('assistant', {
          datasourceId: 'wc',
          caseIds: ['champion-2022'],
          datasets: ['Nope'],
        }),
      ).toEqual({ error: 'That datasource has no dataset named Nope' });
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('resolves the set from the case ids when no suiteId is given', async () => {
      datasets.list.mockResolvedValue([
        fixtureDataset('genomics', 'Genomics'),
      ]);
      const genomicsCase = actualLoadSuite('genomics').cases[0].id;
      const runner = service();
      const result = await runner.start('assistant', {
        datasourceId: 'fixtures',
        caseIds: [genomicsCase],
      });
      await runner.whenIdle();
      if (!('jobId' in result)) throw new Error('Run did not start');
      expect((await runner.status(result.jobId))?.suiteId).toBe('genomics');
    });

    it('refuses questions that span several sets', async () => {
      const genomicsCase = actualLoadSuite('genomics').cases[0].id;
      expect(
        await service().start('assistant', {
          datasourceId: 'wc',
          caseIds: ['champion-2022', genomicsCase],
        }),
      ).toEqual({ error: expect.stringContaining('span several sets') });
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('merges the arm preset with explicit overrides for the harness', async () => {
      const runner = service();
      await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['champion-2022'],
        arm: 'fixer-off',
        engine: { careful: 'on', bogus: true } as never,
      });
      await runner.whenIdle();
      expect(harness.mock.calls[0][1].engine).toEqual({
        sqlRepair: false,
        descriptiveErrors: true,
        careful: 'on',
      });
      expect(harness.mock.calls[0][1].arm).toBe('fixer-off');

      // `custom` has no preset: the overrides are all in `engine`.
      harness.mockClear();
      const custom = await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['champion-2022'],
        arm: 'custom',
        engine: { columnProfiles: true },
      });
      await runner.whenIdle();
      expect(harness.mock.calls[0][1].engine).toEqual({ columnProfiles: true });
      if (!('jobId' in custom)) throw new Error('Run did not start');
      const view = await runner.status(custom.jobId);
      expect(view?.arm).toBe('custom');
      expect(view?.engineOverrides).toEqual({ columnProfiles: true });
      // The resolved engine and hash come from the turn that ran.
      expect(view?.engine?.columnProfiles).toBe(true);
      expect(view?.configHash).toBe('hash-abc');
      expect(view?.judgeModel).toBe('openai/gpt-4.1-mini');
      expect(view?.reasoningEffort).toBe('high');
    });

    it('filters by category and lets variants follow their base case', async () => {
      const base = actualLoadSuite('world-cup');
      const withVariants: EvalSuite = {
        ...base,
        cases: base.cases.map((c) =>
          c.id === 'champion-2022'
            ? { ...c, variants: ['Which country won in 2022?', 'Who lifted the 2022 trophy?'] }
            : c,
        ),
      };
      (loadSuite as jest.Mock).mockReturnValue(withVariants);
      const runner = service();

      await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['champion-2022', 'shootouts'],
        includeVariants: true,
      });
      await runner.whenIdle();
      expect(harness.mock.calls.map((call) => call[0].id)).toEqual([
        'champion-2022',
        'champion-2022~v1',
        'champion-2022~v2',
        'shootouts',
        'shootouts~v1',
        'shootouts~v2',
      ]);

      harness.mockClear();
      await runner.start('assistant', {
        datasourceId: 'wc',
        categories: ['multi-step-join'],
      });
      await runner.whenIdle();
      expect(harness.mock.calls.map((call) => call[0].id)).toEqual([
        'final-score-2018',
        'possession-vs-result',
        'south-american-goals',
        'third-placed-team-scorers-2018',
      ]);
    });

    it('updates the pass^k summary live, after every case', async () => {
      const second = deferred();
      harness
        .mockImplementationOnce(async (c, ctx) =>
          outcomeFor(c as SuiteEvalCase, ['PASS'], ctx),
        )
        .mockImplementationOnce(async (c, ctx) => {
          await second.promise;
          return outcomeFor(c as SuiteEvalCase, ['FAIL'], ctx);
        });
      const runner = service();
      const result = await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['champion-2022', 'final-score-2018'],
      });
      if (!('jobId' in result)) throw new Error('Run did not start');
      await until(() => harness.mock.calls.length === 2);

      const live = await runner.status(result.jobId);
      expect(live?.status).toBe('running');
      expect(live?.summary).toMatchObject({ passK: 1, scored: 1, passKRate: 1 });
      expect(live?.currentQuestion).toBe(
        actualLoadSuite('world-cup').cases[1].question,
      );
      // Persisted as it goes, not only at the end.
      expect(store.get(result.jobId)?.results).toHaveLength(1);

      second.resolve();
      await runner.whenIdle();
      const done = await runner.status(result.jobId);
      expect(done?.summary).toMatchObject({ passK: 1, scored: 2, passKRate: 0.5 });
      expect(done?.categories).toEqual({
        control: { total: 1, passed: 1 },
        'multi-step-join': { total: 1, passed: 0 },
      });
    });

    it('tallies tokens, side passes and categories, and writes a v2 run log', async () => {
      const runner = service();
      const result = await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['champion-2022'],
        repeat: 3,
        label: 'iter-1',
        arm: 'guards',
      });
      await runner.whenIdle();
      if (!('jobId' in result)) throw new Error('Run did not start');

      const view = await runner.status(result.jobId);
      expect(view?.usage).toMatchObject({ totalTokens: 360, calls: 3 });
      expect(view?.sidePassUsage).toEqual({ grounding: USAGE });
      expect(view?.categories).toEqual({ control: { total: 1, passed: 1 } });
      // No rate is configured for the test model, so cost stays unknown
      // rather than being reported as zero.
      expect(view?.estimatedCostUsd).toBeUndefined();
      expect(view?.model).toBeTruthy();
      expect(view?.logFile).toMatch(/-world-cup-iter-1-guards-.*\.json$/);

      const record = readRunLogByFile(view!.logFile!, [logDir]);
      expect(record).toMatchObject({
        schemaVersion: 2,
        runId: result.jobId,
        harness: 'in-app',
        agentKey: 'assistant',
        suite: 'world-cup',
        label: 'iter-1',
        arm: 'guards',
        repeat: 3,
        configHash: 'hash-abc',
        judgeModel: 'openai/gpt-4.1-mini',
        reasoningEffort: 'high',
        dialect: 'postgres',
        datasourceKind: 'postgres',
        status: 'completed',
        totals: { cases: 1, passed: 1, failed: 0, errored: 0, gaps: 0, skipped: 0 },
        summary: { passK: 1, passKRate: 1, meanPassRate: 1 },
        sidePassUsage: { grounding: USAGE },
      });
      expect(record?.engine.extendedGuards).toBe(true);
      expect(record?.cases[0]).toMatchObject({
        id: 'champion-2022',
        verdict: 'PASS',
        runs: 3,
        passes: 3,
      });
      expect(record?.cases[0].attempts).toHaveLength(3);
    });

    it('logs a failed run too, with the config it was going to measure', async () => {
      harness
        .mockImplementationOnce(async (c, ctx) =>
          outcomeFor(c as SuiteEvalCase, ['PASS'], ctx),
        )
        .mockRejectedValueOnce(new Error('datasource went away'));
      const runner = service();
      const result = await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['champion-2022', 'final-score-2018', 'shootouts'],
      });
      await runner.whenIdle();
      if (!('jobId' in result)) throw new Error('Run did not start');
      const view = await runner.status(result.jobId);
      expect(view?.status).toBe('failed');
      expect(view?.error).toBe('datasource went away');
      expect(repository.mostRecentCompleted).not.toHaveBeenCalled();

      const record = readRunLogByFile(view!.logFile!, [logDir]);
      expect(record).toMatchObject({
        status: 'failed',
        error: 'datasource went away',
        totals: { cases: 3, passed: 1, skipped: 2 },
      });
      expect(record?.cases).toHaveLength(1);
    });

    it('still logs a run whose every turn failed before reporting a config', async () => {
      harness.mockRejectedValueOnce(new Error('model unreachable'));
      engineSettings.resolved.mockResolvedValue(
        resolveEngineOptions({ columnProfiles: true }),
      );
      const runner = service();
      const result = await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['champion-2022'],
        arm: 'bare',
      });
      await runner.whenIdle();
      if (!('jobId' in result)) throw new Error('Run did not start');
      const view = await runner.status(result.jobId);
      // Production defaults + the arm, resolved the way runTurn does.
      expect(view?.engine).toMatchObject({ columnProfiles: true, context: 'bare' });
      expect(view?.configHash).toMatch(/^[0-9a-f]{12}$/);
      const record = readRunLogByFile(view!.logFile!, [logDir]);
      expect(record?.configHash).toBe(view?.configHash);
      expect(record?.status).toBe('failed');
    });
  });

  describe('queue', () => {
    it('queues a second start and runs it after the first', async () => {
      const gate = deferred();
      const order: string[] = [];
      harness.mockImplementation(async (c, ctx) => {
        order.push(`start ${c.id}`);
        if (c.id === 'champion-2022') await gate.promise;
        order.push(`end ${c.id}`);
        return outcomeFor(c as SuiteEvalCase, ['PASS'], ctx);
      });
      const runner = service();
      const first = await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['champion-2022'],
      });
      const second = await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['shootouts'],
      });
      expect(first).toEqual({ jobId: expect.any(String), queued: false });
      expect(second).toEqual({ jobId: expect.any(String), queued: true });
      if (!('jobId' in first) || !('jobId' in second)) throw new Error('no job');

      await until(() => order.length === 1);
      expect((await runner.status(first.jobId))?.status).toBe('running');
      expect((await runner.status(second.jobId))?.status).toBe('queued');
      // Listed while waiting, and not deletable.
      expect((await runner.list('assistant')).map((v) => v.status)).toContain(
        'queued',
      );
      expect(await runner.remove(second.jobId)).toBe(false);

      gate.resolve();
      await runner.whenIdle();
      expect(order).toEqual([
        'start champion-2022',
        'end champion-2022',
        'start shootouts',
        'end shootouts',
      ]);
      expect((await runner.status(second.jobId))?.status).toBe('completed');
    });
  });

  describe('stop', () => {
    it('aborts a running run, keeps what it spent and logs it as aborted', async () => {
      harness.mockImplementationOnce(
        (c, ctx) =>
          new Promise((resolve) => {
            ctx.abortSignal?.addEventListener('abort', () =>
              resolve(outcomeFor(c as SuiteEvalCase, ['PASS', 'STOPPED'], ctx)),
            );
          }),
      );
      const runner = service();
      const result = await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['champion-2022', 'final-score-2018'],
        repeat: 3,
      });
      if (!('jobId' in result)) throw new Error('Run did not start');
      await until(() => harness.mock.calls.length === 1);

      expect(await runner.stop(result.jobId)).toEqual({
        ok: true,
        message: expect.stringContaining('Stopping'),
      });
      await runner.whenIdle();

      // The second question never started.
      expect(harness).toHaveBeenCalledTimes(1);
      const view = await runner.status(result.jobId);
      expect(view?.status).toBe('failed');
      expect(view?.error).toBe(STOPPED_BY_OPERATOR);
      // The stopped case folds to SKIP by itself; its tokens stay counted.
      expect(view?.results[0].verdict).toBe('SKIP');
      expect(view?.usage?.calls).toBe(2);

      const record = readRunLogByFile(view!.logFile!, [logDir]);
      expect(record).toMatchObject({
        status: 'aborted',
        error: STOPPED_BY_OPERATOR,
        totals: { cases: 2, passed: 0, skipped: 2 },
        summary: { scored: 0 },
      });
      expect(record?.usage.calls).toBe(2);
    });

    it('removes a queued run without ever starting it', async () => {
      const gate = deferred();
      harness.mockImplementation(async (c, ctx) => {
        await gate.promise;
        return outcomeFor(c as SuiteEvalCase, ['PASS'], ctx);
      });
      const runner = service();
      const first = await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['champion-2022'],
      });
      const second = await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['shootouts'],
      });
      if (!('jobId' in first) || !('jobId' in second)) throw new Error('no job');

      expect(await runner.stop(second.jobId)).toEqual({
        ok: true,
        message: 'Removed from the queue',
      });
      gate.resolve();
      await runner.whenIdle();

      expect(harness.mock.calls.map((call) => call[0].id)).toEqual([
        'champion-2022',
      ]);
      const stopped = await runner.status(second.jobId);
      expect(stopped?.status).toBe('failed');
      expect(stopped?.error).toBe(STOPPED_BEFORE_START);
      expect(stopped?.logFile).toBeUndefined();
      expect(store.get(second.jobId)?.status).toBe('failed');
      expect((await runner.status(first.jobId))?.status).toBe('completed');
    });

    it('clears a stored run that no worker owns any more', async () => {
      store.set('stale', {
        jobId: 'stale',
        status: 'queued',
      } as EvalRunView);
      const runner = service();
      expect(await runner.stop('stale')).toEqual({
        ok: true,
        message: 'Marked as interrupted',
      });
      expect(store.get('stale')).toMatchObject({
        status: 'failed',
        error: INTERRUPTED_BY_RESTART,
      });
      expect(await runner.stop('stale')).toEqual({
        ok: false,
        message: 'That run has already failed',
      });
      expect((await runner.stop('missing')).ok).toBe(false);
    });
  });

  describe('loop', () => {
    beforeEach(() => {
      datasets.list.mockResolvedValue([
        fixtureDataset('world-cup', 'World Cup'),
        fixtureDataset('health-insurance', 'Health Insurance'),
      ]);
    });

    it('queues one run per suite × arm, suite-major, and summarises them', async () => {
      const runner = service();
      const result = await runner.startLoop('assistant', {
        datasourceId: 'fixtures',
        suiteIds: ['world-cup', 'health-insurance'],
        arms: ['baseline', 'fixer-off'],
        repeat: 3,
        label: 'loop-1',
        categories: ['control', 'ratio-trap'],
      });
      if (!('loopId' in result)) throw new Error(result.error);
      expect(result.jobIds).toHaveLength(4);
      expect(result.skipped).toEqual([]);

      const queued = await Promise.all(result.jobIds.map((id) => runner.status(id)));
      expect(queued.map((view) => [view?.suiteId, view?.arm])).toEqual([
        ['world-cup', 'baseline'],
        ['world-cup', 'fixer-off'],
        ['health-insurance', 'baseline'],
        ['health-insurance', 'fixer-off'],
      ]);
      expect(queued.every((view) => view?.loopId === result.loopId)).toBe(true);
      expect(queued.every((view) => view?.label === 'loop-1')).toBe(true);
      expect(queued.map((view) => view?.loopIndex)).toEqual([0, 1, 2, 3]);

      await runner.whenIdle();
      // Categories narrow each suite; the arms reach the harness.
      const calls = harness.mock.calls.map((call) => [
        call[0].id,
        call[1].arm,
        call[2],
      ]);
      expect(calls[0]).toEqual(['champion-2022', 'baseline', 3]);
      expect(calls.filter((call) => call[1] === 'fixer-off').length).toBe(
        calls.length / 2,
      );

      const loop = await runner.getLoop(result.loopId);
      expect(loop?.status).toBe('completed');
      expect(loop?.jobs).toHaveLength(4);
      expect(loop?.summary.rows[0]).toMatchObject({
        suite: 'world-cup',
        arm: 'baseline',
        repeat: 3,
        passKRate: 1,
        meanPassRate: 1,
        flaky: 0,
        gaps: 0,
        tokens: expect.any(Number),
        file: expect.stringMatching(/\.json$/),
        status: 'completed',
      });

      // A restarted backend rebuilds the loop from the stored runs.
      const fresh = await service().getLoop(result.loopId);
      expect(fresh?.jobs.map((job) => job.arm)).toEqual([
        'baseline',
        'fixer-off',
        'baseline',
        'fixer-off',
      ]);
    });

    it('validates the whole loop before queueing any of it', async () => {
      const runner = service();
      expect(
        await runner.startLoop('assistant', {
          datasourceId: 'fixtures',
          suiteIds: ['world-cup', 'health-insurance'],
          arms: ['baseline', 'nope'],
        }),
      ).toEqual({ error: expect.stringContaining('world-cup × nope') });
      expect(
        await runner.startLoop('assistant', {
          datasourceId: 'fixtures',
          suiteIds: [],
          arms: ['baseline'],
        }),
      ).toEqual({ error: expect.stringContaining('at least one suite') });
      expect(repository.insert).not.toHaveBeenCalled();
      expect(harness).not.toHaveBeenCalled();
    });

    it('skips a suite with no question in the requested categories', async () => {
      const runner = service();
      const result = await runner.startLoop('assistant', {
        datasourceId: 'fixtures',
        suiteIds: ['world-cup', 'health-insurance'],
        arms: ['baseline'],
        // World Cup has no money columns, so no unit-confusion questions.
        categories: ['unit-confusion'],
      });
      if (!('loopId' in result)) throw new Error(result.error);
      expect(result.skipped).toEqual(['world-cup']);
      expect(result.jobIds).toHaveLength(1);
      await runner.whenIdle();
    });
  });

  describe('regression', () => {
    it('compares pass^k verdicts and flags flakiness changes', async () => {
      repository.mostRecentCompleted.mockResolvedValue({
        jobId: 'previous',
        configHash: 'other-hash',
        repeat: 3,
        results: [
          // pass^k record
          { id: 'champion-2022', question: 'q', passed: true, verdict: 'PASS', flaky: false },
          // a record from before pass^k: `passed` only
          { id: 'final-score-2018', question: 'q', passed: false },
          { id: 'shootouts', question: 'q', passed: true, verdict: 'PASS', flaky: false },
        ],
      });
      harness.mockImplementation(async (c, ctx) =>
        outcomeFor(
          c as SuiteEvalCase,
          c.id === 'champion-2022'
            ? ['PASS', 'FAIL', 'PASS']
            : c.id === 'shootouts'
              ? ['GAP', 'GAP', 'GAP']
              : ['PASS', 'PASS', 'PASS'],
          ctx,
        ),
      );
      const runner = service();
      const result = await runner.start('assistant', {
        datasourceId: 'wc',
        caseIds: ['champion-2022', 'final-score-2018', 'shootouts'],
        repeat: 3,
      });
      await runner.whenIdle();
      if (!('jobId' in result)) throw new Error('Run did not start');
      const view = await runner.status(result.jobId);
      expect(view?.comparison).toMatchObject({
        previousRunId: 'previous',
        regressions: [{ id: 'champion-2022' }],
        improvements: [{ id: 'final-score-2018' }],
        unmeasured: [{ id: 'shootouts' }],
        flakyChanges: [{ id: 'champion-2022' }],
        sameConfig: false,
        sameRepeat: true,
      });
      const record = readRunLogByFile(view!.logFile!, [logDir]);
      expect(record).toMatchObject({
        comparedToRunId: 'previous',
        regressions: ['champion-2022'],
        improvements: ['final-score-2018'],
        flakyChanges: ['champion-2022'],
      });
    });
  });
});
