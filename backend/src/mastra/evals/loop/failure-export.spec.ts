import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ANSWER_LIMIT,
  buildFailureExport,
  EXPORT_MARKER,
  exportFailuresMain,
  TOOL_TEXT_LIMIT,
  writeFailureExport,
} from './failure-export';
import { loopRun, storedResult, storedRun } from './test-runs.stub';

const JOB = 'e0000000-0000-4000-8000-000000000001';

const check = (id: string, status: string, reason?: string) => ({
  id,
  description: `checks ${id}`,
  score: status === 'passed' ? 1 : 0,
  passed: status === 'passed',
  status,
  ...(reason ? { reason } : {}),
});

/** A dev question that failed 2 of 3 attempts, one of them with an error. */
const flakyDev = storedResult('dev-fail', 'failed', {
  category: 'join',
  question: 'Which branch opened the most accounts?',
  runs: 3,
  passes: 1,
  flaky: true,
  checkResults: [check('check-matches', 'failed', 'expected 31, got 30')],
  toolCalls: [
    {
      name: 'run_readonly_sql',
      input: 'x'.repeat(TOOL_TEXT_LIMIT + 50),
      output: '[{"n":30}]',
    },
    { name: 'describe_entity', input: '{}', error: 'boom' },
  ],
  answer: 'y'.repeat(ANSWER_LIMIT + 10),
  attempts: [
    {
      attempt: 1,
      status: 'passed',
      checkResults: [check('check-matches', 'passed')],
      answer: 'ok',
    },
    {
      attempt: 2,
      status: 'failed',
      checkResults: [check('check-matches', 'failed', 'expected 31, got 30')],
      answer: 'thirty',
    },
    {
      attempt: 3,
      status: 'failed',
      checkResults: [check('check-matches', 'failed', 'expected 31, got 30')],
      answer: '',
      error: 'model timed out',
    },
  ],
});

/** Everything of the held-out question carries the word SECRET. */
const secretHeldOut = storedResult('secret-held-out-case', 'failed', {
  category: 'ratio',
  split: 'held-out',
  question: 'What is the SECRET held-out question?',
  answer: 'SECRET answer',
  checkResults: [check('check-includes', 'failed', 'SECRET reason')],
  toolCalls: [
    { name: 'run_readonly_sql', input: 'SECRET sql', output: 'SECRET rows' },
  ],
});

function exportedRun() {
  return loopRun(
    JOB,
    [
      flakyDev,
      storedResult('dev-pass', 'passed', { category: 'join' }),
      secretHeldOut,
      storedResult('held-pass', 'passed', {
        category: 'ratio',
        split: 'held-out',
      }),
    ],
    { repeats: 3 },
  );
}

describe('eval:export-failures (agents-evals R228)', () => {
  const tags = new Map([['dev-fail', ['trap:join-key', 'difficulty:hard']]]);

  it('writes a README and one file per failed dev question', () => {
    const files = buildFailureExport(exportedRun(), tags);
    expect(files.map((f) => f.name)).toEqual(['README.md', 'dev-fail.md']);
    const readme = files[0].content;
    expect(readme).toContain('- Run: e0000000-0000-4000-8000-000000000001');
    expect(readme).toContain('- Repeats: 3');
    expect(readme).toContain('- Judge: off');
    expect(readme).toContain('| join | 1/2 (9–91%) | 1 | 0 | 2 |');
    expect(readme).toContain('| ratio | 1 | 1 | 0 | 2 |');
    expect(readme).toContain(
      '[dev-fail.md](dev-fail.md): join, 1/3 attempts passed',
    );
  });

  it('never writes a held-out id, question, answer, check reason or tool call', () => {
    for (const file of buildFailureExport(exportedRun(), tags)) {
      expect(file.name).not.toMatch(/secret/i);
      expect(file.content).not.toContain('secret-held-out-case');
      expect(file.content).not.toContain('SECRET');
      expect(file.content).not.toContain('held-pass');
    }
  });

  it('gives each failed check’s reason once, with its attempts, and cuts long text', () => {
    const file = buildFailureExport(exportedRun(), tags)[1].content;
    expect(file).toContain(
      '- Question: Which branch opened the most accounts?',
    );
    expect(file).toContain('- Tags: trap:join-key, difficulty:hard');
    expect(file).toContain('- Attempts: 1/3 passed (flaky)');
    expect(file).toContain(
      '- **check-matches: checks check-matches** (attempts 2, 3): expected 31, got 30',
    );
    expect(file).toContain('- **run error** (attempt 3): model timed out');
    expect(file.split('expected 31, got 30')).toHaveLength(2);
    expect(file).toContain('## Tool calls of attempt 2');
    expect(file).toContain(`${'x'.repeat(TOOL_TEXT_LIMIT)}… (truncated)`);
    expect(file).not.toContain('x'.repeat(TOOL_TEXT_LIMIT + 1));
    expect(file).toContain('Error:');
    expect(file).toContain(`${'y'.repeat(ANSWER_LIMIT)}… (truncated)`);
  });

  it('says so when no dev question failed', () => {
    const run = loopRun(JOB, [
      storedResult('dev-pass', 'passed'),
      secretHeldOut,
    ]);
    const files = buildFailureExport(run, tags);
    expect(files).toHaveLength(1);
    expect(files[0].content).toContain('No dev question failed.');
  });

  describe('the folder', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'eval-export-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('refuses a folder that is not empty, and replaces only an earlier export with --force', () => {
      const out = join(dir, 'export');
      const run = exportedRun();
      writeFailureExport(out, buildFailureExport(run, tags), run);
      expect(readdirSync(out).sort()).toEqual([
        EXPORT_MARKER,
        'README.md',
        'dev-fail.md',
      ]);
      expect(() =>
        writeFailureExport(out, buildFailureExport(run, tags), run),
      ).toThrow(
        `${out} is not empty; pass --force to replace an earlier export`,
      );
      writeFileSync(join(out, 'notes.txt'), 'mine');
      const passing = loopRun(JOB, [storedResult('dev-pass', 'passed')]);
      writeFailureExport(out, buildFailureExport(passing, tags), passing, true);
      expect(readdirSync(out).sort()).toEqual([
        EXPORT_MARKER,
        'README.md',
        'notes.txt',
      ]);
    });

    it('refuses --force on a folder that holds no earlier export', () => {
      const out = join(dir, 'mine');
      mkdirSync(out);
      writeFileSync(join(out, 'keep.txt'), 'mine');
      const run = exportedRun();
      expect(() =>
        writeFailureExport(out, buildFailureExport(run, tags), run, true),
      ).toThrow('holds no earlier export');
      expect(existsSync(join(out, 'keep.txt'))).toBe(true);
    });

    it('runs as a command from a run file, exit 0, or 2 on a bad input', async () => {
      writeFileSync(
        join(dir, 'run.json'),
        JSON.stringify(storedRun(JOB, [flakyDev])),
      );
      const out: string[] = [];
      const io = { out: (l: string) => out.push(l), err: () => undefined };
      const env = { INIT_CWD: dir, APP_DATA_DIR: dir };
      await expect(
        exportFailuresMain(['--run', 'run.json', '--out', 'x'], env, io),
      ).resolves.toBe(0);
      expect(out[0]).toContain(
        'README.md and 1 failed dev question of run e0000000',
      );
      expect(readFileSync(join(dir, 'x', 'dev-fail.md'), 'utf8')).toContain(
        '# dev-fail',
      );
      await expect(
        exportFailuresMain(['--run', 'run.json', '--out', 'x'], env, io),
      ).resolves.toBe(2);
      await expect(
        exportFailuresMain(['--run', 'run.json'], env, io),
      ).resolves.toBe(2);
      await expect(
        exportFailuresMain(['--run', 'a,b', '--out', 'y'], env, io),
      ).resolves.toBe(2);
    });
  });
});
