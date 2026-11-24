import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  costOfRun,
  costOfRuns,
  loadRun,
  loadRuns,
  readResult,
  readRunFromDb,
  runFromFileContent,
} from './run-source';
import {
  loopRun,
  storedResult,
  storedRun,
  testIndex,
  usage,
} from './test-runs.stub';

const JOB_A = 'aaaa1111-0000-4000-8000-000000000001';
const JOB_B = 'aaaa1111-0000-4000-8000-000000000002';
const JOB_C = 'cccc3333-0000-4000-8000-000000000003';

function dataDirWith(docs: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'eval-loop-runs-'));
  const db = new BetterSqlite3(join(dir, 'app.sqlite'));
  db.exec(
    'CREATE TABLE "eval_runs" (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)',
  );
  const insert = db.prepare('INSERT INTO "eval_runs" (doc) VALUES (?)');
  for (const doc of docs) insert.run(JSON.stringify(doc));
  db.close();
  return dir;
}

describe('run-source (agents-evals R224, R225)', () => {
  const index = testIndex({
    'old-1': { split: 'held-out', category: 'ratio', setId: 'finance' },
  });
  let dir: string;

  beforeAll(() => {
    dir = dataDirWith([
      storedRun(JOB_A, [storedResult('q-1', 'passed')]),
      storedRun(JOB_B, [storedResult('q-2', 'failed')]),
      storedRun(JOB_C, [storedResult('q-3', 'passed')]),
    ]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  describe('saved runs, read without writing from app.sqlite', () => {
    it('finds a run by its whole id or its 8-character prefix', () => {
      expect(readRunFromDb(dir, JOB_C, index).jobId).toBe(JOB_C);
      const run = readRunFromDb(dir, 'cccc3333', index);
      expect(run.jobId).toBe(JOB_C);
      expect(run.label).toBe('cccc3333');
    });

    it('refuses a prefix that matches several runs, and an unknown id', () => {
      expect(() => readRunFromDb(dir, 'aaaa1111', index)).toThrow(
        'Run id "aaaa1111" matches 2 runs (aaaa1111, aaaa1111); give more characters',
      );
      expect(() => readRunFromDb(dir, 'ffffffff', index)).toThrow(
        `No eval run "ffffffff" in ${join(dir, 'app.sqlite')}`,
      );
    });

    it('refuses an id in a data dir with no database or no runs table', () => {
      const empty = mkdtempSync(join(tmpdir(), 'eval-loop-empty-'));
      try {
        expect(() => readRunFromDb(empty, 'x', index)).toThrow(
          'No eval run "x"',
        );
        new BetterSqlite3(join(empty, 'app.sqlite')).close();
        expect(() => readRunFromDb(empty, 'x', index)).toThrow(
          'No eval run "x"',
        );
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });
  });

  describe('the three shapes of an exported run file', () => {
    it('reads a run record (EVAL_RUN_FILE)', () => {
      const run = runFromFileContent(
        storedRun(JOB_A, [storedResult('q-1', 'passed')], { repeats: 3 }),
        'run.json',
        index,
      );
      expect(run).toMatchObject({
        jobId: JOB_A,
        label: 'aaaa1111',
        repeats: 3,
        model: 'openai/gpt-4o-mini',
        judge: { mode: 'off' },
        file: 'run.json',
      });
    });

    it('reads a poll response (endpoint 38), and refuses a refused poll', () => {
      const poll = {
        ok: true,
        message: 'completed',
        ...storedRun(JOB_B, [storedResult('q-2', 'failed')]),
      };
      expect(
        runFromFileContent(poll, 'poll.json', index).results[0].status,
      ).toBe('failed');
      expect(() =>
        runFromFileContent(
          { ok: false, message: 'Eval run "x" not found' },
          'poll.json',
          index,
        ),
      ).toThrow('poll.json: Eval run "x" not found');
    });

    it('reads a bare results array (EVAL_RESULTS_FILE), its repeats from its results', () => {
      const run = runFromFileContent(
        [storedResult('q-1', 'passed', { runs: 3, passes: 3 })],
        '/runs/results.json',
        index,
      );
      expect(run).toMatchObject({ label: 'results.json', repeats: 3 });
      expect(run.jobId).toBeUndefined();
      expect(run.model).toBeUndefined();
      expect(run.judge).toBeUndefined();
    });

    it('refuses anything else', () => {
      for (const content of [{ hello: 1 }, 'text', [{ nope: 1 }], null]) {
        expect(() => runFromFileContent(content, 'x.json', index)).toThrow(
          'x.json is not an eval run: expected a run record, a poll response or a results array',
        );
      }
    });

    it('reads a value that names a file as a file, anything else as an id', () => {
      const file = join(dir, 'run-a.json');
      writeFileSync(file, JSON.stringify(storedRun(JOB_A, [])));
      expect(loadRun('run-a.json', dir, { INIT_CWD: dir }, index).file).toBe(
        file,
      );
      expect(loadRun('cccc3333', dir, { INIT_CWD: dir }, index).jobId).toBe(
        JOB_C,
      );
      expect(() =>
        loadRun('missing.json', dir, { INIT_CWD: dir }, index),
      ).toThrow('No such run file');
      expect(
        loadRuns(`run-a.json, ${JOB_B}`, dir, { INIT_CWD: dir }, index).map(
          (r) => r.label,
        ),
      ).toEqual(['aaaa1111', 'aaaa1111']);
    });
  });

  describe('read-time defaults (data-model 3.8)', () => {
    it('fills split and category from the case index, else dev and uncategorised', () => {
      const old = {
        id: 'old-1',
        question: 'Q?',
        passed: true,
        checkResults: [],
      };
      expect(readResult(old, index)).toMatchObject({
        split: 'held-out',
        category: 'ratio',
        setId: 'finance',
        status: 'passed',
        passes: 1,
        runs: 1,
        flaky: false,
        representative: 1,
      });
      expect(readResult({ id: 'gone', passed: false }, index)).toMatchObject({
        split: 'dev',
        category: 'uncategorised',
        status: 'failed',
      });
    });

    it('reads a run saved before BA-184 as judged, with repeats 1', () => {
      const run = runFromFileContent(
        { jobId: JOB_A, results: [] },
        'old.json',
        index,
      );
      expect(run).toMatchObject({
        judge: { mode: 'on' },
        repeats: 1,
        source: 'app',
      });
    });

    it('takes the representative attempt: the first failed, else the first', () => {
      const result = readResult(
        storedResult('q', 'failed', {
          runs: 3,
          passes: 1,
          flaky: true,
          attempts: [
            { attempt: 1, status: 'passed', checkResults: [], answer: 'a1' },
            { attempt: 2, status: 'failed', checkResults: [], answer: 'a2' },
            { attempt: 3, status: 'failed', checkResults: [], answer: 'a3' },
          ],
        }),
        index,
      );
      expect(result.attempts).toHaveLength(3);
      expect(result.representative).toBe(2);
      expect(result.flaky).toBe(true);
    });
  });

  describe('cost', () => {
    it('uses the run cost, else the sum of its results, else says why not', () => {
      expect(costOfRun(loopRun(JOB_A, [], { costUsd: 0.5 }))).toEqual({
        kind: 'usd',
        usd: 0.5,
      });
      expect(
        costOfRun(
          loopRun(JOB_A, [
            storedResult('a', 'passed', { costUsd: 0.25 }),
            storedResult('b', 'passed', { costUsd: 0.5 }),
          ]),
        ),
      ).toEqual({ kind: 'usd', usd: 0.75 });
      expect(costOfRun(loopRun(JOB_A, [storedResult('a', 'passed')]))).toEqual({
        kind: 'not-recorded',
      });
      expect(
        costOfRun(
          loopRun(JOB_A, [], {
            costUsd: null,
            usage: usage(10, 10, 'mystery-1'),
          }),
        ),
      ).toEqual({ kind: 'not-priced', models: ['mystery-1'] });
    });

    it('sums several runs, not priced or not recorded when any part is', () => {
      const priced = loopRun(JOB_A, [], { costUsd: 0.1 });
      const unpriced = loopRun(JOB_B, [], {
        costUsd: null,
        usage: usage(1, 1, 'x'),
      });
      const old = loopRun(JOB_C, [storedResult('a', 'passed')]);
      expect(costOfRuns([priced, priced])).toEqual({ kind: 'usd', usd: 0.2 });
      expect(costOfRuns([priced, unpriced]).kind).toBe('not-priced');
      expect(costOfRuns([priced, unpriced, old]).kind).toBe('not-recorded');
    });
  });
});
