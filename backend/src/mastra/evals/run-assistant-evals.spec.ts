// The real entry point of `npm run evals:assistant` (retrospective,
// 2026-10-13): its refusals run with the real question sets and must come
// before the backend boots. The app module and the run service are not
// loaded (ESM-only Mastra deps); a booted run uses a fake app context.
jest.mock('../../app.module', () => ({ AppModule: class {} }));
const mockCreateApplicationContext = jest.fn();
jest.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: (...args: unknown[]): unknown =>
      mockCreateApplicationContext(...args),
  },
}));
jest.mock('../../modules/agents/eval-runs.service', () => ({
  EvalRunsService: class {},
}));
// The sets load every agent's cases; their agents and scorers never run.
jest.mock('@mastra/core/evals', () => ({
  runEvals: jest.fn(),
  createScorer: (config: Record<string, unknown>) => {
    const scorer: Record<string, unknown> = { ...config };
    for (const step of ['analyze', 'generateScore', 'generateReason']) {
      scorer[step] = () => scorer;
    }
    return scorer;
  },
}));
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/assistant.agent', () => ({ assistantAgent: {} }));
jest.mock('../agents/rfp.agent', () => ({ rfpAgent: {} }));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../tool-services', () => ({ getDatasetToolServices: () => ({}) }));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main } from './run-assistant-evals';
import type { CliOutput } from './run-assistant-evals';
import type { AssistantEvalCaseResult } from './assistant.evals';
import { summarizeEvalResults } from './eval-summary';
import type { EvalRunView } from '../../modules/agents/eval-runs.service';

/** Booting the backend: what no refusal may reach. */
const createApplicationContext = mockCreateApplicationContext;

/** What the command line printed, by stream. */
function capture(): CliOutput & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  };
}

const WORLD_CUP = { EVAL_DATASETS: 'World Cup', EVAL_SET: 'world-cup' };

beforeEach(() => jest.clearAllMocks());

describe('npm run evals:assistant refusals (agents.md 8.5, R222)', () => {
  it.each([
    [{ EVAL_REPEATS: '2' }, 'Repeats must be 1, 3 or 5 (got "2")'],
    [
      { EVAL_REPEATS: 'three', EVAL_SPLIT: 'test' },
      'Repeats must be 1, 3 or 5 (got "three")',
    ],
    [
      { EVAL_JUDGE: 'sometimes', EVAL_REPEATS: '2' },
      'Unknown judge option "sometimes"',
    ],
    [
      { EVAL_SPLIT: 'test', EVAL_CATEGORY: 'joins' },
      'Unknown EVAL_SPLIT "test"; use dev or held-out',
    ],
    [
      { EVAL_CATEGORY: 'lookup,joins' },
      'Unknown EVAL_CATEGORY "joins". Known categories:',
    ],
  ])('refuses %j with "%s" before the backend boots', async (env, message) => {
    const output = capture();
    await expect(main({ ...WORLD_CUP, ...env }, output)).resolves.toBe(1);
    expect(output.err).toHaveLength(1);
    expect(output.err[0]).toContain(message);
    expect(output.out).toEqual([]);
    expect(createApplicationContext).not.toHaveBeenCalled();
  });

  it('refuses a set the split leaves empty, naming the set', async () => {
    const output = capture();
    await expect(
      main(
        {
          EVAL_DATASETS: 'Formula 1',
          EVAL_SET: 'formula-1',
          EVAL_SPLIT: 'held-out',
        },
        output,
      ),
    ).resolves.toBe(1);
    expect(output.err).toEqual([
      'No question of set "formula-1" matches EVAL_SPLIT=held-out',
    ]);
    expect(createApplicationContext).not.toHaveBeenCalled();
  });
});

/** A finished result as the run service hands it over. */
function result(
  id: string,
  overrides: Partial<AssistantEvalCaseResult> = {},
): AssistantEvalCaseResult {
  return {
    id,
    question: `question ${id}`,
    category: 'ratio',
    split: 'held-out',
    scores: {},
    checkResults: [
      {
        id: 'check-includes',
        description: 'Checks if output includes "11%"',
        score: 0,
        passed: false,
        status: 'failed',
        reason: 'expected "11%" in the answer',
      },
    ],
    answer: '',
    toolCalls: [],
    status: 'failed',
    passed: false,
    durationMs: 20,
    passes: 2,
    runs: 3,
    flaky: true,
    usage: [
      {
        agent: 'assistant',
        model: 'gpt-4o-mini',
        inputTokens: 30_000,
        cachedInputTokens: 0,
        outputTokens: 3_000,
        reasoningTokens: 0,
        calls: 3,
        unreportedCalls: 0,
      },
    ],
    costUsd: 0.0063,
    ...overrides,
  };
}

/** A fake app context whose run service hands back `run`. */
function fakeApp(run: EvalRunView, previousRepeats?: number) {
  const service = {
    runFromCommandLine: jest.fn(
      (_request: unknown, onResult?: (r: AssistantEvalCaseResult) => void) => {
        for (const each of run.results) onResult?.(each);
        return Promise.resolve({ run });
      },
    ),
    comparedRunRepeats: jest.fn().mockResolvedValue(previousRepeats),
  };
  const app = { get: jest.fn(() => service), close: jest.fn() };
  createApplicationContext.mockResolvedValueOnce(app);
  return { app, service };
}

function savedRun(results: AssistantEvalCaseResult[]): EvalRunView {
  return {
    jobId: 'job-1',
    agentKey: 'assistant',
    datasourceId: 'wc',
    datasets: ['World Cup'],
    caseIds: results.map((each) => each.id),
    status: 'completed',
    results,
    totalCases: results.length,
    startedAt: '2026-10-20T00:00:00.000Z',
    finishedAt: '2026-10-20T00:01:00.000Z',
    judge: { mode: 'off' },
    repeats: 3,
    model: 'openai/gpt-4o-mini',
    usage: results.flatMap((each) => each.usage ?? []),
    costUsd: 0.0063,
    rates: {},
    source: 'cli',
    summary: summarizeEvalResults(results),
  };
}

describe('npm run evals:assistant run (R154, R222, R223)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eval-cli-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('runs the narrowed selection through the run service, prints the lines and writes the run file', async () => {
    const run = savedRun([result('shot-conversion-2022')]);
    const { app, service } = fakeApp(run);
    const runFile = join(dir, 'run.json');
    const output = capture();

    const code = await main(
      {
        ...WORLD_CUP,
        EVAL_REPEATS: '3',
        EVAL_SPLIT: 'held-out',
        EVAL_CATEGORY: 'ratio',
        EVAL_RUN_FILE: runFile,
      },
      output,
    );

    // A flaky question failed the run.
    expect(code).toBe(1);
    expect(service.runFromCommandLine).toHaveBeenCalledWith(
      {
        agentKey: 'assistant',
        datasets: ['World Cup'],
        caseIds: ['shot-conversion-2022'],
        judge: { mode: 'off' },
        repeats: 3,
      },
      expect.any(Function),
    );
    const printed = output.out.join('\n');
    expect(printed).toContain('Judge: off\nRepeats: 3\n');
    expect(printed).toContain(
      'FAIL  shot-conversion-2022  2/3 attempts  (20ms)  flaky',
    );
    expect(printed).toContain(
      [
        '0/1 questions passed',
        'Flaky: 1',
        'Dev: 0/0 passed · 95% interval —',
        'Held-out: 0/1 passed · 95% interval 0–79%',
        '',
        '## By category',
      ].join('\n'),
    );
    expect(printed).toContain('| ratio | — | 0/1 (0–79%) | 1 | 0 | 1 |');
    expect(printed).toContain(
      [
        'Tokens: 30,000 in (0 cached) · 3,000 out (0 reasoning) · 3 calls',
        'Cost: $0.0063 · $0.0063 per question',
        '',
        'Run id: job-1',
        'No comparable earlier run.',
      ].join('\n'),
    );
    expect(JSON.parse(readFileSync(runFile, 'utf8'))).toEqual(run);
    expect(app.close).toHaveBeenCalled();
  });

  it('prints the comparison as the report writes it, noting other repeats, and exits 0 when all passed', async () => {
    const passed = result('shot-conversion-2022', {
      status: 'passed',
      passed: true,
      passes: 3,
      flaky: false,
      checkResults: [],
    });
    const run = {
      ...savedRun([passed]),
      comparison: {
        previousRunId: 'job-0',
        regressions: [],
        improvements: [
          { id: 'shot-conversion-2022', question: 'question shot' },
        ],
        unchanged: [],
      },
    };
    fakeApp(run, 1);
    const resultsFile = join(dir, 'results.json');
    const output = capture();

    await expect(
      main(
        { ...WORLD_CUP, EVAL_REPEATS: '3', EVAL_RESULTS_FILE: resultsFile },
        output,
      ),
    ).resolves.toBe(0);
    expect(output.out.join('\n')).toContain(
      [
        'Run id: job-1',
        '## Compared to previous run',
        '',
        '_Compared to run `job-0`._',
        '',
        'Note: the previous run used Repeats 1.',
        '',
        '**Improvements** (failed before, now passing):',
        '- `shot-conversion-2022` — question shot',
      ].join('\n'),
    );
    expect(JSON.parse(readFileSync(resultsFile, 'utf8'))).toEqual(run.results);
  });

  it('writes relative run files where npm was started (INIT_CWD), else in the working directory', async () => {
    const run = savedRun([result('case-a')]);
    const files = {
      EVAL_RUN_FILE: 'run.json',
      EVAL_RESULTS_FILE: 'results.json',
    };

    fakeApp(run);
    await main({ ...WORLD_CUP, ...files, INIT_CWD: dir }, capture());
    expect(JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'))).toEqual(
      run,
    );
    expect(JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'))).toEqual(
      run.results,
    );

    const cwd = mkdtempSync(join(tmpdir(), 'eval-cli-cwd-'));
    const spy = jest.spyOn(process, 'cwd').mockReturnValue(cwd);
    try {
      fakeApp(run);
      await main({ ...WORLD_CUP, ...files }, capture());
      expect(JSON.parse(readFileSync(join(cwd, 'run.json'), 'utf8'))).toEqual(
        run,
      );
      expect(
        JSON.parse(readFileSync(join(cwd, 'results.json'), 'utf8')),
      ).toEqual(run.results);
    } finally {
      spy.mockRestore();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('prints a refused run and exits 1', async () => {
    const service = {
      runFromCommandLine: jest.fn().mockResolvedValue({
        error: 'These evals require the bundled World Cup sample: …',
      }),
    };
    createApplicationContext.mockResolvedValueOnce({
      get: () => service,
      close: jest.fn(),
    });
    const output = capture();
    await expect(main(WORLD_CUP, output)).resolves.toBe(1);
    expect(output.err).toEqual([
      'These evals require the bundled World Cup sample: …',
    ]);
  });
});
