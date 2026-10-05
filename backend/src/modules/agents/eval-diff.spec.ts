import {
  diffRunLogs,
  draftChangeLogEntry,
  renderRunLogDiffMarkdown,
} from './eval-diff';
import {
  emptyUsage,
  foldAttempts,
  normalizeRunLog,
  summarizeCases,
  type EvalRunLogAttempt,
  type EvalRunLogCaseV2,
  type EvalRunLogRecordV2,
  type EvalVerdict,
  type TokenUsage,
} from './eval-telemetry';
import { resolveEngineOptions } from '../engine/engine-options';

function attempt(
  verdict: EvalVerdict,
  over: Partial<EvalRunLogAttempt> = {},
): EvalRunLogAttempt {
  return {
    attempt: 1,
    verdict,
    checks: [
      { id: 'result-set-match', passed: verdict === 'PASS' },
      { id: 'check-includes', passed: true },
    ],
    sql: [],
    steps: 1,
    calledTools: ['run_readonly_sql'],
    repairs: [],
    warnings: [],
    durationMs: 1000,
    answer: 'An answer.',
    ...over,
  };
}

const usage = (totalTokens: number): TokenUsage => ({
  ...emptyUsage(),
  inputTokens: totalTokens,
  totalTokens,
  calls: 1,
});

function item(
  id: string,
  category: string,
  verdicts: EvalVerdict[],
  sql: string,
  tokens = 1000,
): EvalRunLogCaseV2 {
  const attempts = verdicts.map((verdict, index) =>
    attempt(verdict, { attempt: index + 1, finalSql: sql }),
  );
  return {
    id,
    category,
    durationMs: 1000,
    usage: usage(tokens),
    attempts,
    ...foldAttempts(attempts),
  };
}

function run(
  runId: string,
  cases: EvalRunLogCaseV2[],
  over: Partial<EvalRunLogRecordV2> = {},
): EvalRunLogRecordV2 {
  const total = cases.reduce((sum, c) => sum + (c.usage?.totalTokens ?? 0), 0);
  const cost = over.estimatedCostUsd;
  return {
    schemaVersion: 2,
    runId,
    harness: 'in-app',
    suite: 'health-insurance',
    datasets: ['Health Insurance'],
    model: 'openai/gpt-5',
    repeat: 3,
    engine: resolveEngineOptions(),
    configHash: 'aaaaaaaaaaaa',
    startedAt: '2026-09-23T10:00:00.000Z',
    finishedAt: '2026-09-23T10:10:00.000Z',
    durationMs: 600_000,
    totals: {
      cases: cases.length,
      passed: 0,
      failed: 0,
      errored: 0,
      gaps: 0,
      skipped: 0,
    },
    summary: summarizeCases(cases, cost),
    categories: {},
    usage: { ...usage(total), calls: cases.length },
    cases,
    status: 'completed',
    ...over,
  };
}

const before = run(
  'before-0000',
  [
    item(
      'paid-share',
      'ratio-trap',
      ['FAIL', 'FAIL', 'FAIL'],
      'SELECT SUM(paid) / SUM(paid)',
    ),
    item('plan-share', 'ratio-trap', ['PASS', 'PASS', 'PASS'], 'SELECT 1'),
    item('ties', 'ties', ['PASS', 'FAIL', 'PASS'], 'SELECT 2'),
    item('gone', 'control', ['PASS', 'PASS', 'PASS'], 'SELECT 3'),
  ],
  { label: 'baseline', arm: 'baseline', estimatedCostUsd: 0.3 },
);

const after = run(
  'after-00000',
  [
    item(
      'paid-share',
      'ratio-trap',
      ['PASS', 'PASS', 'PASS'],
      'SELECT SUM(paid) / SUM(billed)',
      800,
    ),
    item('plan-share', 'ratio-trap', ['PASS', 'FAIL', 'FAIL'], 'SELECT 1'),
    item('ties', 'ties', ['PASS', 'PASS', 'PASS'], 'SELECT 2'),
    item('new-case', 'control', ['PASS', 'PASS', 'PASS'], 'SELECT 4'),
  ],
  {
    label: 'iter-1',
    arm: 'guards',
    configHash: 'bbbbbbbbbbbb',
    estimatedCostUsd: 0.25,
  },
);

describe('diffRunLogs', () => {
  const diff = diffRunLogs(before, after);

  it('finds regressions and improvements by pass^k verdict', () => {
    expect(diff.improvements).toEqual(['paid-share', 'ties']);
    expect(diff.regressions).toEqual(['plan-share']);
    expect(diff.flakyChanges).toEqual(['plan-share', 'ties']);
  });

  it('keeps cases that exist on one side only, as SKIP on the other', () => {
    expect(diff.onlyBefore).toEqual(['gone']);
    expect(diff.onlyAfter).toEqual(['new-case']);
    expect(diff.perCase.find((row) => row.id === 'gone')).toMatchObject({
      before: 'PASS',
      after: 'SKIP',
    });
    // A case that vanished is not a regression.
    expect(diff.regressions).not.toContain('gone');
  });

  it('carries SQL, pass counts, check deltas and tokens per case', () => {
    const row = diff.perCase.find((entry) => entry.id === 'paid-share');
    expect(row).toMatchObject({
      category: 'ratio-trap',
      before: 'FAIL',
      after: 'PASS',
      passesBefore: 0,
      passesAfter: 3,
      runsBefore: 3,
      runsAfter: 3,
      sqlBefore: 'SELECT SUM(paid) / SUM(paid)',
      sqlAfter: 'SELECT SUM(paid) / SUM(billed)',
      tokensDelta: -200,
    });
    // Only the check that moved is listed.
    expect(row?.checkDeltas).toEqual([
      { id: 'result-set-match', before: false, after: true },
    ]);
  });

  it('compares pass^k per category', () => {
    expect(diff.categoryDeltas['ratio-trap']).toEqual({
      before: 0.5,
      after: 0.5,
      passKBefore: 1,
      passKAfter: 1,
      totalBefore: 2,
      totalAfter: 2,
    });
    expect(diff.categoryDeltas.ties).toMatchObject({ before: 0, after: 1 });
  });

  it('flags what makes the comparison not like-for-like', () => {
    expect(diff.sameModel).toBe(true);
    expect(diff.sameConfig).toBe(false);
    expect(diff.sameSuite).toBe(true);
    expect(diff.tokensComparable).toBe(true);
    expect(diff.tokensDelta).toBe(3800 - 4000);
    expect(diff.costDelta).toBeCloseTo(-0.05, 6);
  });

  it('does not count a GAP as a regression or an improvement', () => {
    const gapped = run('gap-0000000', [
      item('paid-share', 'ratio-trap', ['GAP', 'GAP', 'GAP'], ''),
      item('plan-share', 'ratio-trap', ['GAP', 'GAP', 'GAP'], ''),
    ]);
    const result = diffRunLogs(before, gapped);
    expect(result.regressions).toEqual([]);
    expect(result.improvements).toEqual([]);
  });

  it('diffs a normalised v1 log against a v2 one', () => {
    const v1 = normalizeRunLog({
      schemaVersion: 1,
      runId: 'legacy-0000',
      harness: 'in-app',
      suite: 'health-insurance',
      datasets: [],
      model: 'openai/gpt-4o-mini',
      startedAt: '2026-09-22T10:00:00.000Z',
      finishedAt: '2026-09-22T10:01:00.000Z',
      durationMs: 60_000,
      totals: { cases: 1, passed: 0, failed: 1, errored: 0, skipped: 0 },
      categories: {},
      usage: emptyUsage(),
      cases: [
        {
          id: 'paid-share',
          category: 'ratio-trap',
          verdict: 'FAIL',
          durationMs: 1,
        },
      ],
    });
    const result = diffRunLogs(v1, after);
    expect(result.improvements).toContain('paid-share');
    expect(result.sameModel).toBe(false);
    // The v1 run reported no usage: a token "saving" would be fiction.
    expect(result.tokensComparable).toBe(false);
  });
});

describe('renderRunLogDiffMarkdown', () => {
  const markdown = renderRunLogDiffMarkdown(diffRunLogs(before, after));

  it('leads with the pass^k headline and the like-for-like warning', () => {
    expect(markdown).toContain(
      '# health-insurance: baseline · arm baseline · openai/gpt-5 → iter-1 · arm guards · openai/gpt-5',
    );
    expect(markdown).toContain(
      '**Not like-for-like:** different engine configs (aaaaaaaaaaaa vs bbbbbbbbbbbb)',
    );
    expect(markdown).toContain('| pass^3 | 2/4 (50%) | 3/4 (75%) |');
  });

  it('lists categories, regressions, improvements and each verdict change with its SQL', () => {
    expect(markdown).toContain('| ties | 0/1 | 1/1 ▲ |');
    expect(markdown).toMatch(/## Regressions\n\n- plan-share/);
    expect(markdown).toMatch(/## Improvements\n\n- paid-share\n- ties/);
    expect(markdown).toContain(
      '### paid-share (ratio-trap): FAIL 0/3 → PASS 3/3',
    );
    expect(markdown).toContain('- result-set-match: fail → pass');
    expect(markdown).toContain('SELECT SUM(paid) / SUM(billed)');
  });
});

describe('draftChangeLogEntry', () => {
  const entry = draftChangeLogEntry(diffRunLogs(before, after), {
    lever: 'tools & guards',
    change: 'Extended result guards flag a ratio of a column to itself.',
    why: 'paid-share failed every draw with SUM(x)/SUM(x).',
    runA: '2026-09-23-health-insurance-baseline-baseline-before-0.json',
    runB: 'logs/evals/2026-09-23-health-insurance-iter-1-guards-after-00.json',
    date: '2026-09-23',
  });

  it('follows the docs/evals/change-log.md template, heading by heading', () => {
    for (const heading of [
      '## 2026-09-23 — ',
      '- **Suite:** health-insurance',
      '- **Lever:** tools & guards',
      '- **Change:** Extended result guards flag a ratio of a column to itself.',
      '- **Why:** paid-share failed every draw with SUM(x)/SUM(x).',
      '- **Before → after:** ',
      '- **Side effects:** ',
      '- **Verdict:** keep | revert — <reason>',
      '- **Runs:** ',
    ]) {
      expect(entry).toContain(heading);
    }
  });

  it('fills in the measured half: pass^k, changed categories, tokens, runs', () => {
    expect(entry).toContain('`pass^3 2/4 → 3/4`');
    expect(entry).toContain('`ties 0/1 → 1/1`');
    // Unmoved categories are left out: the line is about what changed.
    expect(entry).not.toContain('`control');
    expect(entry).not.toContain('`ratio-trap');
    expect(entry).toContain('tokens −200');
    expect(entry).toContain('regressions in this run: plan-share');
    expect(entry).toContain('Not like-for-like: different engine configs');
    expect(entry).toContain(
      '`logs/evals/2026-09-23-health-insurance-baseline-baseline-before-0.json` →\n  `logs/evals/2026-09-23-health-insurance-iter-1-guards-after-00.json`',
    );
  });

  it('titles the entry with the lever and the pass^k move unless given a title', () => {
    expect(entry.split('\n')[0]).toBe(
      '## 2026-09-23 — tools & guards: health-insurance pass^3 2/4 → 3/4',
    );
    const titled = draftChangeLogEntry(diffRunLogs(before, after), {
      lever: 'context',
      change: 'c',
      why: 'w',
      title: 'Ranked knowledge',
      date: '2026-09-24',
    });
    expect(titled.split('\n')[0]).toBe('## 2026-09-24 — Ranked knowledge');
    expect(titled).toContain('`run before-0000` →');
  });
});
