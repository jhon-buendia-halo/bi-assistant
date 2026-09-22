import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  findRepoRoot,
  loadPricing,
  readRunLog,
  readRunLogIndex,
  resolveLogDir,
  runLogFilename,
  writeRunLog,
} from './eval-run-log';
import { emptyUsage, type EvalRunLogRecord } from './eval-telemetry';

function record(over: Partial<EvalRunLogRecord> = {}): EvalRunLogRecord {
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
    usage: { ...emptyUsage(), inputTokens: 1000, outputTokens: 200, totalTokens: 1200, calls: 20 },
    cases: [
      { id: 'paid-share', category: 'ratio-trap', verdict: 'FAIL', reason: 'result-mismatch', durationMs: 12_000 },
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

    const parsed = JSON.parse(readFileSync(written!.file, 'utf8')) as EvalRunLogRecord;
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

  it('appends rather than replacing, so the index is a history', () => {
    writeRunLog(record({ runId: 'aaaaaaaa-0000-0000-0000-000000000000', label: 'baseline' }), dir);
    writeRunLog(record({ runId: 'bbbbbbbb-0000-0000-0000-000000000000', label: 'iter-1' }), dir);
    const index = readRunLogIndex(dir);
    expect(index.map((row) => row.label)).toEqual(['baseline', 'iter-1']);
  });

  it('reads a run back by the filename the index carries', () => {
    writeRunLog(record({ label: 'baseline' }), dir);
    const [row] = readRunLogIndex(dir);
    const back = readRunLog(String(row.file), dir);
    expect(back?.runId).toBe(record().runId);
  });

  it('skips a malformed index line instead of throwing away the history', () => {
    writeRunLog(record(), dir);
    const indexFile = join(dir, 'evals', 'index.ndjson');
    writeFileSync(indexFile, `${readFileSync(indexFile, 'utf8')}not json\n`, 'utf8');
    expect(readRunLogIndex(dir)).toHaveLength(1);
  });

  it('returns undefined rather than throwing when there is nowhere to write', () => {
    // A paid run must never fail because its log could not be saved.
    expect(writeRunLog(record(), join(dir, 'file-not-a-dir', '\0bad'))).toBeUndefined();
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
    write(JSON.stringify({ 'gpt-4o-mini': { inputPerMillionUsd: 1, outputPerMillionUsd: 4 } }));
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
