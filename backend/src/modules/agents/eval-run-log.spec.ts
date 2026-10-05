import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  candidateLogDirs,
  findRepoRoot,
  listRunLogs,
  loadPricing,
  readRunLog,
  readRunLogByFile,
  readRunLogIndex,
  resolveLogDir,
  runLogFilename,
  safeRunLogFilename,
  writeRunLog,
} from './eval-run-log';
import {
  emptyUsage,
  foldAttempts,
  normalizeRunLog,
  summarizeCases,
  type EvalRunLogAttempt,
  type EvalRunLogRecordV1,
  type EvalRunLogRecordV2,
} from './eval-telemetry';
import { resolveEngineOptions } from '../engine/engine-options';

function record(over: Partial<EvalRunLogRecordV1> = {}): EvalRunLogRecordV1 {
  return {
    schemaVersion: 1,
    runId: '1a2b3c4d-5e6f-7890-abcd-ef1234567890',
    harness: 'golden-set',
    suite: 'health-insurance',
    datasets: ['Health Insurance'],
    startedAt: '2026-09-22T10:00:00.000Z',
    finishedAt: '2026-09-22T10:04:00.000Z',
    durationMs: 240_000,
    totals: { cases: 20, passed: 13, failed: 7, errored: 0, skipped: 0 },
    categories: { 'ratio-trap': { total: 3, passed: 1 } },
    usage: {
      ...emptyUsage(),
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      calls: 20,
    },
    cases: [
      {
        id: 'paid-share',
        category: 'ratio-trap',
        verdict: 'FAIL',
        reason: 'result-mismatch',
        durationMs: 12_000,
      },
    ],
    ...over,
  };
}

describe('runLogFilename', () => {
  it('is date-sortable and carries suite, label and a run-id prefix', () => {
    expect(runLogFilename(record({ label: 'baseline' }))).toBe(
      '2026-09-22-health-insurance-baseline-1a2b3c4d.json',
    );
  });

  it('omits the label when there is none', () => {
    expect(runLogFilename(record())).toBe(
      '2026-09-22-health-insurance-1a2b3c4d.json',
    );
  });

  it('slugs labels that would otherwise be unsafe in a filename', () => {
    expect(runLogFilename(record({ label: 'iter 2 — prompt/ratio' }))).toBe(
      '2026-09-22-health-insurance-iter-2-prompt-ratio-1a2b3c4d.json',
    );
  });
});

describe('writeRunLog / readRunLog', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qti-log-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the run as readable JSON and appends one index line', () => {
    const written = writeRunLog(record({ label: 'baseline' }), dir);
    expect(written).toBeDefined();
    expect(existsSync(written!.file)).toBe(true);

    const parsed = JSON.parse(
      readFileSync(written!.file, 'utf8'),
    ) as EvalRunLogRecordV1;
    expect(parsed.totals.passed).toBe(13);
    expect(parsed.usage.totalTokens).toBe(1200);

    const index = readRunLogIndex(dir);
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({
      suite: 'health-insurance',
      label: 'baseline',
      passed: 13,
      totalTokens: 1200,
    });
  });

  it('carries the expert headline and constraint onto the index line, only for expert runs', () => {
    writeRunLog(record({ runId: 'aaaaaaaa-0000-0000-0000-000000000000' }), dir);
    writeRunLog(
      record({
        runId: 'bbbbbbbb-0000-0000-0000-000000000000',
        expert: {
          graded: 10,
          traced: 9,
          tracedPassed: 6,
          tracedFailed: 3,
          auroc: 0.8333,
          bands: {
            high: { band: 'high', n: 5, correct: 5, accuracy: 1, coverage: 0.5556 },
            medium: { band: 'medium', n: 3, correct: 1, accuracy: 0.3333, coverage: 0.3333 },
            low: { band: 'low', n: 1, correct: 0, accuracy: 0, coverage: 0.1111 },
          },
          highBandTarget: 0.9,
          meetsHighBandTarget: true,
          coverage: {},
        },
      }),
      dir,
    );
    const [plain, expert] = readRunLogIndex(dir);
    expect(plain).not.toHaveProperty('expertAuroc');
    expect(expert).toMatchObject({ expertAuroc: 0.8333, expertHighBandAccuracy: 1 });
  });

  it('appends rather than replacing, so the index is a history', () => {
    writeRunLog(
      record({
        runId: 'aaaaaaaa-0000-0000-0000-000000000000',
        label: 'baseline',
      }),
      dir,
    );
    writeRunLog(
      record({
        runId: 'bbbbbbbb-0000-0000-0000-000000000000',
        label: 'iter-1',
      }),
      dir,
    );
    const index = readRunLogIndex(dir);
    expect(index.map((row) => row.label)).toEqual(['baseline', 'iter-1']);
  });

  it('reads a run back by the filename the index carries, as v2', () => {
    writeRunLog(record({ label: 'baseline' }), dir);
    const [row] = readRunLogIndex(dir);
    const back = readRunLog(String(row.file), dir);
    expect(back?.runId).toBe(record().runId);
    expect(back?.schemaVersion).toBe(2);
    expect(back?.configHash).toBe('legacy');
  });

  it('refuses a filename that would step outside logs/evals', () => {
    writeFileSync(join(dir, 'secret.json'), '{"runId":"x"}', 'utf8');
    expect(readRunLog('../secret.json', dir)).toBeUndefined();
  });

  it('skips a malformed index line instead of throwing away the history', () => {
    writeRunLog(record(), dir);
    const indexFile = join(dir, 'evals', 'index.ndjson');
    writeFileSync(
      indexFile,
      `${readFileSync(indexFile, 'utf8')}not json\n`,
      'utf8',
    );
    expect(readRunLogIndex(dir)).toHaveLength(1);
  });

  it('returns undefined rather than throwing when there is nowhere to write', () => {
    // A paid run must never fail because its log could not be saved.
    expect(
      writeRunLog(record(), join(dir, 'file-not-a-dir', '\0bad')),
    ).toBeUndefined();
  });

  it('reads an empty history when nothing has been logged', () => {
    expect(readRunLogIndex(dir)).toEqual([]);
    expect(readRunLog('nope.json', dir)).toBeUndefined();
  });
});

describe('loadPricing', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qti-price-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (contents: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pricing.json'), contents, 'utf8');
  };

  it('reads rates from a bare table', () => {
    write(
      JSON.stringify({
        'gpt-4o-mini': { inputPerMillionUsd: 1, outputPerMillionUsd: 4 },
      }),
    );
    expect(loadPricing(dir)).toEqual({
      'gpt-4o-mini': { inputPerMillionUsd: 1, outputPerMillionUsd: 4 },
    });
  });

  it('reads rates from a `models` wrapper, so the file can carry comments', () => {
    write(
      JSON.stringify({
        _comment: 'US dollars per million tokens',
        models: {
          'GPT-4o-Mini': {
            inputPerMillionUsd: 1,
            outputPerMillionUsd: 4,
            cachedInputPerMillionUsd: 0.5,
          },
        },
      }),
    );
    // Keys are lowercased so lookup matches normalizeModelId.
    expect(loadPricing(dir)['gpt-4o-mini']).toEqual({
      inputPerMillionUsd: 1,
      outputPerMillionUsd: 4,
      cachedInputPerMillionUsd: 0.5,
    });
  });

  it('drops entries with unusable rates instead of pricing at NaN', () => {
    write(
      JSON.stringify({
        models: {
          good: { inputPerMillionUsd: 2, outputPerMillionUsd: 6 },
          bad: { inputPerMillionUsd: 'free', outputPerMillionUsd: 6 },
          worse: {},
        },
      }),
    );
    expect(Object.keys(loadPricing(dir))).toEqual(['good']);
  });

  it('falls back to an empty table on a missing or malformed file', () => {
    expect(loadPricing(dir)).toEqual({});
    write('{ not json');
    expect(loadPricing(dir)).toEqual({});
    write('[1,2,3]');
    expect(loadPricing(dir)).toEqual({});
  });
});

describe('findRepoRoot / resolveLogDir', () => {
  it('finds the checkout this test is running inside', () => {
    const root = findRepoRoot();
    expect(root).toBeDefined();
    expect(existsSync(join(root!, 'docker-compose.yml'))).toBe(true);
    expect(existsSync(join(root!, 'backend', 'package.json'))).toBe(true);
  });

  it('returns undefined when no repo marker is above the start directory', () => {
    expect(findRepoRoot(tmpdir())).toBeUndefined();
  });

  it('falls back EVAL_LOG_DIR → checkout logs/ → APP_DATA_DIR/logs → cwd/data/logs', () => {
    const env = { EVAL_LOG_DIR: '/x/override', APP_DATA_DIR: '/x/app' };
    expect(resolveLogDir({ env, repoRoot: '/x/repo', cwd: '/x/cwd' })).toBe(
      '/x/override',
    );
    expect(
      resolveLogDir({
        env: { ...env, EVAL_LOG_DIR: '  ' },
        repoRoot: '/x/repo',
        cwd: '/x/cwd',
      }),
    ).toBe(join('/x/repo', 'logs'));
    // The packaged app: no checkout, so its own data folder — never nowhere.
    expect(
      resolveLogDir({
        env: { APP_DATA_DIR: '/x/app' },
        repoRoot: null,
        cwd: '/x/cwd',
      }),
    ).toBe(join('/x/app', 'logs'));
    expect(resolveLogDir({ env: {}, repoRoot: null, cwd: '/x/cwd' })).toBe(
      join('/x/cwd', 'data', 'logs'),
    );
  });

  it('honours EVAL_LOG_DIR, so a packaged or CI run can still record', () => {
    const previous = process.env.EVAL_LOG_DIR;
    process.env.EVAL_LOG_DIR = '/tmp/somewhere-else';
    try {
      expect(resolveLogDir()).toBe('/tmp/somewhere-else');
    } finally {
      if (previous === undefined) delete process.env.EVAL_LOG_DIR;
      else process.env.EVAL_LOG_DIR = previous;
    }
  });
});

/* ------------------------------------------------------------------ v2 */

function v2Record(over: Partial<EvalRunLogRecordV2> = {}): EvalRunLogRecordV2 {
  const attempt: EvalRunLogAttempt = {
    attempt: 1,
    verdict: 'PASS',
    checks: [{ id: 'check-includes', passed: true }],
    finalSql: 'SELECT 1',
    sql: [{ sql: 'SELECT 1', ok: true, rowCount: 1 }],
    answer: 'One.',
    steps: 1,
    calledTools: ['run_readonly_sql'],
    repairs: [],
    warnings: [],
    durationMs: 900,
  };
  const failed: EvalRunLogAttempt = { ...attempt, attempt: 2, verdict: 'FAIL' };
  const cases = [
    {
      id: 'stable',
      category: 'control',
      durationMs: 1800,
      attempts: [attempt, { ...attempt, attempt: 2 }],
      ...foldAttempts([attempt, { ...attempt, attempt: 2 }]),
    },
    {
      id: 'wobbly',
      category: 'ties',
      durationMs: 1800,
      attempts: [attempt, failed],
      ...foldAttempts([attempt, failed]),
    },
  ];
  return {
    schemaVersion: 2,
    runId: 'cccccccc-0000-0000-0000-000000000000',
    label: 'iter-1',
    harness: 'in-app',
    suite: 'health-insurance',
    datasets: ['Health Insurance'],
    model: 'openai/gpt-5',
    repeat: 2,
    arm: 'fixer-off',
    engine: resolveEngineOptions({}, { sqlRepair: false }),
    configHash: 'abcdef123456',
    startedAt: '2026-09-23T10:00:00.000Z',
    finishedAt: '2026-09-23T10:05:00.000Z',
    durationMs: 300_000,
    totals: { cases: 2, passed: 1, failed: 1, errored: 0, gaps: 0, skipped: 0 },
    summary: summarizeCases(cases, 0.4),
    categories: {
      control: { total: 1, passed: 1 },
      ties: { total: 1, passed: 0 },
    },
    usage: {
      ...emptyUsage(),
      inputTokens: 500,
      outputTokens: 50,
      totalTokens: 550,
      calls: 4,
    },
    estimatedCostUsd: 0.4,
    cases,
    status: 'completed',
    ...over,
  };
}

describe('run log v2', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qti-log2-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('puts the arm after the label in the filename', () => {
    expect(runLogFilename(v2Record())).toBe(
      '2026-09-23-health-insurance-iter-1-fixer-off-cccccccc.json',
    );
  });

  it('writes the pass^k headline into the index line', () => {
    writeRunLog(v2Record(), dir);
    const [line] = readRunLogIndex(dir);
    expect(line).toMatchObject({
      schemaVersion: 2,
      harness: 'in-app',
      repeat: 2,
      arm: 'fixer-off',
      configHash: 'abcdef123456',
      passK: 1,
      passKRate: 0.5,
      meanPassRate: 0.75,
      gaps: 0,
      flaky: 1,
      costPerCorrectUsd: 0.4,
      status: 'completed',
    });
  });

  it('keeps v1 index lines exactly as they were', () => {
    writeRunLog(record(), dir);
    const [line] = readRunLogIndex(dir);
    expect(line.schemaVersion).toBeUndefined();
    expect(line.passK).toBeUndefined();
  });

  it('round-trips a v2 record through normalizeRunLog unchanged', () => {
    const original = v2Record();
    writeRunLog(original, dir);
    expect(readRunLog(runLogFilename(original), dir)).toEqual(
      normalizeRunLog(original),
    );
  });
});

describe('safeRunLogFilename', () => {
  it.each([
    [
      '2026-09-22-world-cup-89445f06.json',
      '2026-09-22-world-cup-89445f06.json',
    ],
    ['../pricing.json', undefined],
    ['evals/x.json', undefined],
    ['..\\x.json', undefined],
    ['/etc/passwd', undefined],
    ['index.ndjson', undefined],
    ['.hidden.json', undefined],
    ['', undefined],
  ])('%p → %p', (input, expected) => {
    expect(safeRunLogFilename(input)).toBe(expected);
  });
});

describe('candidateLogDirs / listRunLogs / readRunLogByFile', () => {
  let root: string;
  let repoLogs: string;
  let appLogs: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'qti-logs-'));
    repoLogs = join(root, 'repo', 'logs');
    appLogs = join(root, 'app', 'logs');
    mkdirSync(repoLogs, { recursive: true });
    mkdirSync(appLogs, { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists every existing directory once, preferred first', () => {
    const sources = {
      env: { EVAL_LOG_DIR: repoLogs, APP_DATA_DIR: join(root, 'app') },
      repoRoot: join(root, 'repo'),
      cwd: join(root, 'nowhere'),
    };
    // EVAL_LOG_DIR and the checkout are the same folder; cwd/data/logs does not exist.
    expect(candidateLogDirs(sources)).toEqual([repoLogs, appLogs]);
  });

  it('merges runs across directories, newest first', () => {
    writeRunLog(
      record({ runId: 'aaaaaaaa-1', startedAt: '2026-09-22T10:00:00.000Z' }),
      repoLogs,
    );
    writeRunLog(v2Record(), appLogs);
    const listed = listRunLogs([repoLogs, appLogs]);
    expect(
      listed.map((row) => [row.runId, row.schemaVersion, row.dir]),
    ).toEqual([
      ['cccccccc-0000-0000-0000-000000000000', 2, appLogs],
      ['aaaaaaaa-1', 1, repoLogs],
    ]);
  });

  it('fills pass^k in for a v1 run from its file', () => {
    writeRunLog(
      record({
        runId: 'aaaaaaaa-1',
        totals: { cases: 3, passed: 1, failed: 1, errored: 0, skipped: 1 },
        cases: [
          { id: 'a', verdict: 'PASS', durationMs: 1 },
          { id: 'b', verdict: 'FAIL', durationMs: 1 },
          { id: 'c', verdict: 'SKIP', durationMs: 0 },
        ],
      }),
      repoLogs,
    );
    const [row] = listRunLogs([repoLogs]);
    // The skipped case is out of the denominator: 1 of 2, not 1 of 3.
    expect(row).toMatchObject({
      schemaVersion: 1,
      exists: true,
      passK: 1,
      passKRate: 0.5,
      repeat: 1,
      configHash: 'legacy',
      status: 'completed',
    });
  });

  it('falls back to scanning run files when the index is missing', () => {
    writeRunLog(v2Record(), repoLogs);
    writeRunLog(record({ runId: 'aaaaaaaa-1' }), repoLogs);
    unlinkSync(join(repoLogs, 'evals', 'index.ndjson'));
    const listed = listRunLogs([repoLogs]);
    expect(listed.map((row) => row.runId).sort()).toEqual([
      'aaaaaaaa-1',
      'cccccccc-0000-0000-0000-000000000000',
    ]);
    expect(
      listed.find((row) => row.runId === 'aaaaaaaa-1')?.schemaVersion,
    ).toBe(1);
  });

  it('keeps the last index line for a run written twice (partial, then final)', () => {
    writeRunLog(v2Record({ status: 'aborted' }), repoLogs);
    writeRunLog(v2Record({ status: 'completed' }), repoLogs);
    const listed = listRunLogs([repoLogs]);
    expect(listed).toHaveLength(1);
    expect(listed[0].status).toBe('completed');
  });

  it('prefers the copy whose file exists when a run is listed twice', () => {
    writeRunLog(v2Record(), repoLogs);
    writeRunLog(v2Record(), appLogs);
    unlinkSync(join(repoLogs, 'evals', runLogFilename(v2Record())));
    const listed = listRunLogs([repoLogs, appLogs]);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ dir: appLogs, exists: true });
  });

  it('still lists an index entry whose file is gone, marked as missing', () => {
    writeRunLog(v2Record(), repoLogs);
    unlinkSync(join(repoLogs, 'evals', runLogFilename(v2Record())));
    expect(listRunLogs([repoLogs])[0]).toMatchObject({
      exists: false,
      passK: 1,
    });
  });

  it('reads a run by file from whichever directory has it, normalised', () => {
    writeRunLog(record({ runId: 'aaaaaaaa-1', label: 'baseline' }), appLogs);
    const file = runLogFilename(
      record({ runId: 'aaaaaaaa-1', label: 'baseline' }),
    );
    const back = readRunLogByFile(file, [repoLogs, appLogs]);
    expect(back).toMatchObject({
      runId: 'aaaaaaaa-1',
      schemaVersion: 2,
      configHash: 'legacy',
    });
  });

  it('rejects traversal and non-JSON names instead of reading them', () => {
    writeFileSync(
      join(repoLogs, 'pricing.json'),
      '{"runId":"not-a-run"}',
      'utf8',
    );
    expect(readRunLogByFile('../pricing.json', [repoLogs])).toBeUndefined();
    expect(readRunLogByFile('index.ndjson', [repoLogs])).toBeUndefined();
    expect(readRunLogByFile('nope.json', [repoLogs])).toBeUndefined();
  });

  it('lists nothing from directories without runs', () => {
    expect(listRunLogs([repoLogs, join(root, 'missing')])).toEqual([]);
  });
});
