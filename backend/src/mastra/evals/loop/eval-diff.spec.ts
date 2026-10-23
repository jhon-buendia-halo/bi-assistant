import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  checkAcceptRule,
  computeDiff,
  draftChangeLogLine,
  draftTsvRow,
  evalDiffMain,
  findRow,
  formatRate,
  parseTargets,
  renderDiff,
  RESULTS_TSV_COLUMNS,
} from './eval-diff';
import { loopRun, results, storedResult, storedRun } from './test-runs.stub';

const BEFORE = 'b0000000-0000-4000-8000-000000000001';
const AFTER = 'a0000000-0000-4000-8000-000000000002';

const dev = (category: string) => ({ category, split: 'dev' });
const heldOut = (category: string) => ({ category, split: 'held-out' });

/** Newcombe 1998: 48/80 before, 56/70 after (+20 pts, 0.0524 to 0.3339). */
function newcombeSides(extraBefore = {}, extraAfter = {}) {
  const before = loopRun(
    BEFORE,
    [
      ...results('join', 80, 48, dev('join')),
      ...results('ho-join', 4, 3, heldOut('join')),
    ],
    { costUsd: 0.84, ...extraBefore },
  );
  const after = loopRun(
    AFTER,
    [
      ...results('join', 70, 56, dev('join')),
      ...results('ho-join', 4, 4, heldOut('join')),
    ],
    { costUsd: 0.74, ...extraAfter },
  );
  return { before, after };
}

describe('eval:diff rows (agents-evals R225)', () => {
  it('matches Newcombe’s example: +20 pts, +5 to +33 pts, up', () => {
    const { before, after } = newcombeSides();
    const diff = computeDiff([before], [after]);
    const join = findRow(diff, 'dev', 'join')!;
    expect(join.change).toBeCloseTo(0.2, 10);
    expect(join.changeInterval!.low).toBeCloseTo(0.0524, 4);
    expect(join.changeInterval!.high).toBeCloseTo(0.3339, 4);
    expect(join.flag).toBe('up');
    const lines = renderDiff(diff);
    expect(
      lines.find((l) => l.startsWith('dev') && l.includes(' join ')),
    ).toMatch(
      /^dev\s+join\s+48\/80 \(49–70%\)\s+56\/70 \(69–88%\)\s+\+20 pts\s+\+5 to \+33 pts\s+up$/,
    );
  });

  it('orders rows by split, then the category list, uncategorised last, then all', () => {
    const run = loopRun(BEFORE, [
      storedResult('u', 'passed', { category: 'uncategorised' }),
      storedResult('r', 'passed', dev('ratio')),
      storedResult('l', 'failed', dev('lookup')),
      storedResult('h', 'passed', heldOut('ratio')),
    ]);
    const diff = computeDiff([run], [run]);
    expect(diff.rows.map((r) => `${r.split} ${r.category}`)).toEqual([
      'dev lookup',
      'dev ratio',
      'dev uncategorised',
      'dev all',
      'held-out ratio',
      'held-out all',
    ]);
    expect(diff.rows.every((r) => r.flag === 'within')).toBe(true);
  });

  it('counts scored questions only, and writes — for a side with none', () => {
    const before = loopRun(BEFORE, [
      storedResult('n', 'not-scored', dev('visual')),
      storedResult('x', 'passed', dev('join')),
    ]);
    const after = loopRun(AFTER, [storedResult('n', 'passed', dev('visual'))]);
    const diff = computeDiff([before], [after]);
    const visual = findRow(diff, 'dev', 'visual')!;
    expect(visual.before).toMatchObject({
      passed: 0,
      failed: 0,
      notScored: 1,
      scored: 0,
    });
    expect(visual.change).toBeUndefined();
    expect(visual.flag).toBeUndefined();
    expect(formatRate(visual.before)).toBe('—');
    expect(findRow(diff, 'held-out', 'all')!.flag).toBeUndefined();
  });
});

describe('eval:diff flips, sides, cost and warnings (R226)', () => {
  it('lists flips by split and the questions on one side only', () => {
    const before = loopRun(BEFORE, [
      storedResult('a', 'failed', dev('join')),
      storedResult('b', 'passed', heldOut('ratio')),
      storedResult('gone', 'passed', dev('join')),
    ]);
    const after = loopRun(AFTER, [
      storedResult('a', 'passed', dev('join')),
      storedResult('b', 'failed', heldOut('ratio')),
      storedResult('new', 'passed', dev('join')),
    ]);
    const diff = computeDiff([before], [after]);
    expect(diff.flips[0].nowPassing.map((r) => r.id)).toEqual(['a']);
    expect(diff.flips[1].nowFailing.map((r) => r.id)).toEqual(['b']);
    expect(diff.onlyBefore.map((r) => r.id)).toEqual(['gone']);
    expect(diff.onlyAfter.map((r) => r.id)).toEqual(['new']);
    const lines = renderDiff(diff);
    expect(lines).toContain('Flips, dev:');
    expect(lines).toContain('  Now passing: a (join)');
    expect(lines).toContain('  Now failing: b (ratio)');
    expect(lines).toContain('Only before: gone (join)');
  });

  it('combines the runs of a side and refuses a question in two of them', () => {
    const a = loopRun(BEFORE, [storedResult('a', 'passed')]);
    const b = loopRun(AFTER, [storedResult('b', 'passed')]);
    expect(computeDiff([a, b], [a]).before.results.size).toBe(2);
    expect(() => computeDiff([a, a], [b])).toThrow(
      'Question "a" is in two runs of the before side (b0000000, b0000000)',
    );
  });

  it('prints each side’s cost per question and the change in percent', () => {
    const { before, after } = newcombeSides();
    const diff = computeDiff([before], [after]);
    // 0.84 / 84 = $0.0100 per question; 0.74 / 74 = $0.0100: no change.
    expect(diff.cost.before.perQuestion).toBeCloseTo(0.01, 10);
    expect(diff.cost.changePercent).toBeCloseTo(0, 10);
    const lines = renderDiff(diff);
    expect(lines).toContain('Cost before: $0.8400 · $0.0100 per question');
    expect(lines).toContain('Cost per question: 0%');
  });

  it('warns when sets, model, repeats or judge differ, between or within sides', () => {
    const before = loopRun(BEFORE, [storedResult('a', 'passed')], {
      repeats: 1,
    });
    const after = loopRun(
      AFTER,
      [storedResult('b', 'passed')],
      {
        repeats: 3,
        model: 'openai/gpt-4.1-mini',
        judge: { mode: 'on' },
      },
      new Map([
        [
          'b',
          {
            setId: 'finance',
            split: 'dev',
            category: 'lookup',
            question: 'Q?',
          },
        ],
      ]),
    );
    const other = loopRun('c0000000-0000-4000-8000-000000000003', [
      storedResult('c', 'passed'),
    ]);
    const diff = computeDiff([before], [after]);
    expect(diff.warnings).toEqual([
      'the sides cover different sets (before: cases not in the question bank; after: finance)',
      'the model differs (before: openai/gpt-4o-mini; after: openai/gpt-4.1-mini)',
      'the repeats differ (before: 1; after: 3); pass^k is not comparable across repeats',
      'the judge option differs (before: off; after: on)',
    ]);
    expect(computeDiff([before, after], [other]).warnings).toContain(
      'the before side mixes repeats (1, 3); pass^k is not comparable across repeats',
    );
  });
});

describe('eval:diff drafts (R226)', () => {
  it('drafts the change-log line, a missing part left as <…>', () => {
    const { before, after } = newcombeSides();
    const diff = computeDiff([before], [after]);
    expect(
      draftChangeLogLine(diff, {
        round: '3',
        lever: 'prompt: join hints',
        hypothesis: 'Naming the join key helps',
        targets: ['join'],
      }),
    ).toBe(
      'Round 3: prompt: join hints. Naming the join key helps. Dev 48/80 → 56/70, held-out 3/4 → 4/4; dev join up; cost per question $0.0100 → $0.0100. Runs b0000000 → a0000000.',
    );
    expect(draftChangeLogLine(diff)).toMatch(/^Round <…>: <…>\. <…> Dev /);
  });

  it('drafts a results.tsv row with held-out counts only', () => {
    const { before, after } = newcombeSides();
    const row = draftTsvRow(computeDiff([before], [after]), {
      round: '3',
      lever: 'prompt',
      hypothesis: 'tab\tinside',
      targets: ['join'],
      date: '2026-10-21',
    });
    const cells = row.split('\t');
    expect(cells).toHaveLength(RESULTS_TSV_COLUMNS.length);
    const byColumn = Object.fromEntries(
      RESULTS_TSV_COLUMNS.map((c, i) => [c, cells[i]]),
    );
    expect(byColumn).toMatchObject({
      round: '3',
      date: '2026-10-21',
      hypothesis: 'tab inside',
      target_categories: 'join',
      dev_before: 'join:48/80;all:48/80',
      dev_after: 'join:56/70;all:56/70',
      heldout_before: 'join:3/4;all:3/4',
      heldout_after: 'join:4/4;all:4/4',
      categories_down: '',
      cost_per_question_before: '0.0100',
      round_cost_usd: '0.7400',
      decision: '',
      reason: '',
      run_ids_before: 'b0000000',
      run_ids_after: 'a0000000',
    });
    expect(row).not.toContain('ho-join');
  });
});

describe('the accept rule (R227)', () => {
  it('is met by Newcombe’s example with held-out up and cost flat', () => {
    const { before, after } = newcombeSides();
    expect(checkAcceptRule(computeDiff([before], [after]), ['join'])).toEqual({
      met: true,
      reasons: [],
    });
  });

  it('names every condition that fails', () => {
    const before = loopRun(
      BEFORE,
      [
        ...results('join', 8, 4, dev('join')),
        ...results('rank', 10, 10, dev('ranking')),
        ...results('ho-join', 4, 3, heldOut('join')),
        ...results('ho-lookup', 10, 10, heldOut('lookup')),
      ],
      { costUsd: 0.32 },
    );
    const after = loopRun(
      AFTER,
      [
        ...results('join', 8, 5, dev('join')),
        ...results('rank', 10, 0, dev('ranking')),
        ...results('ho-join', 4, 2, heldOut('join')),
        ...results('ho-lookup', 10, 0, heldOut('lookup')),
      ],
      { costUsd: 0.3648 },
    );
    const check = checkAcceptRule(computeDiff([before], [after]), ['join']);
    expect(check.met).toBe(false);
    expect(check.reasons).toEqual([
      'dev join is within, not up',
      'held-out all is down',
      'dev ranking is down',
      'dev all is down',
      'held-out lookup is down',
      'cost per question rose 14% (limit 10%)',
    ]);
    const lines = renderDiff(computeDiff([before], [after]), {
      accept: check,
    });
    expect(lines[lines.length - 1]).toBe(
      `Accept rule: not met (${check.reasons.join('; ')})`,
    );
  });

  it('lets a held-out target fall within its interval, and fails one that is down (changed 2026-10-21)', () => {
    const within = (passedAfter: number, scored: number) => {
      const before = loopRun(
        BEFORE,
        [
          ...results('join', 80, 48, dev('join')),
          ...results('ho-join', scored, scored, heldOut('join')),
        ],
        { costUsd: 0.8 + scored / 100 },
      );
      const after = loopRun(
        AFTER,
        [
          ...results('join', 70, 56, dev('join')),
          ...results('ho-join', scored, passedAfter, heldOut('join')),
        ],
        { costUsd: 0.7 + scored / 100 },
      );
      return checkAcceptRule(computeDiff([before], [after]), ['join']);
    };
    expect(within(3, 4)).toEqual({ met: true, reasons: [] });
    expect(within(0, 10).reasons).toEqual([
      'held-out join is down',
      'held-out all is down',
    ]);
  });

  it('is not met for a target with no held-out question, or a side not priced', () => {
    const before = loopRun(BEFORE, results('join', 80, 48, dev('join')), {
      costUsd: null,
      usage: [],
    });
    const after = loopRun(AFTER, results('join', 70, 56, dev('join')), {
      costUsd: 0.7,
    });
    expect(
      checkAcceptRule(computeDiff([before], [after]), ['join']).reasons,
    ).toEqual([
      'held-out join has no scored question',
      'cost per question is not priced before',
    ]);
  });

  it('takes only the eighteen categories as targets', () => {
    expect(parseTargets('join, ratio,join')).toEqual(['join', 'ratio']);
    expect(parseTargets(undefined)).toBeUndefined();
    expect(() => parseTargets('joins')).toThrow(
      'Unknown category "joins" in --target. Known categories: lookup,',
    );
  });
});

describe('evalDiffMain exit codes', () => {
  let dir: string;
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    out: (l: string) => out.push(l),
    err: (l: string) => err.push(l),
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'eval-diff-'));
    const { before, after } = {
      before: storedRun(BEFORE, results('join', 80, 48, dev('join')), {
        costUsd: 0.8,
      }),
      after: storedRun(AFTER, results('join', 70, 56, dev('join')), {
        costUsd: 0.7,
      }),
    };
    writeFileSync(join(dir, 'before.json'), JSON.stringify(before));
    writeFileSync(join(dir, 'after.json'), JSON.stringify(after));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  beforeEach(() => {
    out.length = 0;
    err.length = 0;
  });

  const env = () => ({ INIT_CWD: dir, APP_DATA_DIR: dir });

  it('exits 0 without --target, and prints the --tsv row', async () => {
    await expect(
      evalDiffMain(
        ['--before', 'before.json', '--after', 'after.json', '--tsv'],
        env(),
        io,
      ),
    ).resolves.toBe(0);
    expect(out).toContain('Draft results.tsv row:');
    expect(out.some((l) => l.startsWith('Accept rule'))).toBe(false);
  });

  it('exits 1 when the accept rule is not met', async () => {
    await expect(
      evalDiffMain(
        [
          '--before',
          'before.json',
          '--after',
          'after.json',
          '--target',
          'join',
        ],
        env(),
        io,
      ),
    ).resolves.toBe(1);
    expect(out[out.length - 1]).toBe(
      'Accept rule: not met (held-out join has no scored question)',
    );
  });

  it('exits 2 on a bad argument, a missing run or an unknown category', async () => {
    for (const argv of [
      ['--before', 'before.json'],
      ['--before', 'before.json', '--after', 'nope.json'],
      ['--before', 'before.json', '--after', 'deadbeef'],
      ['--before', 'before.json', '--after', 'after.json', '--target', 'x'],
      ['--before', 'before.json', '--after', 'after.json', '--bogus'],
    ]) {
      await expect(evalDiffMain(argv, env(), io)).resolves.toBe(2);
    }
    expect(err.join('\n')).toContain('--before and --after are required');
    expect(err.join('\n')).toContain(
      `No eval run "deadbeef" in ${join(dir, 'app.sqlite')}`,
    );
  });
});

describe('evalDiffMain on runs saved in app.sqlite (R225 to R227)', () => {
  let dir: string;
  const out: string[] = [];
  const io = {
    out: (l: string) => out.push(l),
    err: (l: string) => out.push(l),
  };

  // Newcombe's sides, held-out join up and the cost per question flat, as
  // the app and the command line save them in the data directory.
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'eval-diff-db-'));
    const db = new BetterSqlite3(join(dir, 'app.sqlite'));
    db.exec(
      'CREATE TABLE "eval_runs" (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)',
    );
    const insert = db.prepare('INSERT INTO "eval_runs" (doc) VALUES (?)');
    for (const run of [
      storedRun(
        BEFORE,
        [
          ...results('join', 80, 48, dev('join')),
          ...results('ho-join', 4, 3, heldOut('join')),
        ],
        { costUsd: 0.84 },
      ),
      storedRun(
        AFTER,
        [
          ...results('join', 70, 56, dev('join')),
          ...results('ho-join', 4, 4, heldOut('join')),
        ],
        { costUsd: 0.74 },
      ),
    ]) {
      insert.run(JSON.stringify(run));
    }
    db.close();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads both sides by 8-character prefix without writing, and exits 0 when the accept rule is met', async () => {
    const database = join(dir, 'app.sqlite');
    const stored = readFileSync(database);
    await expect(
      evalDiffMain(
        [
          '--before',
          BEFORE.slice(0, 8),
          '--after',
          AFTER.slice(0, 8),
          '--data-dir',
          dir,
          '--target',
          'join',
        ],
        {},
        io,
      ),
    ).resolves.toBe(0);
    expect(out).toContainEqual(
      expect.stringMatching(
        /^dev\s+join\s+48\/80 \(49–70%\)\s+56\/70 \(69–88%\)\s+\+20 pts\s+\+5 to \+33 pts\s+up$/,
      ),
    );
    expect(out).toContainEqual(expect.stringMatching(/^held-out\s+all\s+3\/4/));
    // join-49 to join-56 failed before and pass after; 71 to 80 are gone.
    expect(out).toContainEqual(
      expect.stringMatching(/^ {2}Now passing: join-49 \(join\), join-50 /),
    );
    expect(out).toContainEqual(
      expect.stringMatching(/^Only before: join-71 \(join\), /),
    );
    expect(out).toContain('Cost before: $0.8400 · $0.0100 per question');
    expect(out).toContain('Cost per question: 0%');
    expect(out[out.length - 1]).toBe('Accept rule: met');
    // Read only: the data directory's database is byte for byte the same.
    expect(readFileSync(database).equals(stored)).toBe(true);
  });
});
