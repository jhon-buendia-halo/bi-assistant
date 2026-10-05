import { renderEvalRunMarkdown } from './eval-report';
import type { EvalRunView } from './eval-runs.service';
import type { AssistantEvalCaseResult } from '../../mastra/evals/assistant.evals';
import { resolveEngineOptions } from '../engine/engine-options';

function caseResult(
  id: string,
  passed: boolean,
  question = `question ${id}`,
  category?: string,
): AssistantEvalCaseResult {
  return {
    id,
    question,
    category,
    scores: {},
    checkResults: [],
    answer: 'an answer',
    toolCalls: [],
    passed,
    durationMs: 10,
  };
}

function baseRun(overrides: Partial<EvalRunView> = {}): EvalRunView {
  return {
    jobId: 'job-1',
    agentKey: 'assistant',
    suiteId: 'world-cup',
    suiteName: 'World Cup',
    datasourceId: 'ds-1',
    datasets: ['World Cup'],
    caseIds: ['champion-2022'],
    status: 'completed',
    results: [caseResult('champion-2022', true)],
    totalCases: 1,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:05.000Z',
    ...overrides,
  };
}

describe('renderEvalRunMarkdown — comparison section', () => {
  it('omits the section entirely when there is no previous run', () => {
    const markdown = renderEvalRunMarkdown(baseRun());
    expect(markdown).not.toContain('Compared to previous run');
  });

  it('reports "no change" when nothing regressed or improved', () => {
    const run = baseRun({
      comparison: {
        previousRunId: 'job-0',
        regressions: [],
        improvements: [],
        unchanged: [{ id: 'champion-2022', question: 'Who won?' }],
      },
    });
    const markdown = renderEvalRunMarkdown(run);
    expect(markdown).toContain('## Compared to previous run');
    expect(markdown).toContain('Compared to run `job-0`');
    expect(markdown).toContain('No change from the previous run.');
  });

  it('lists regressions and improvements by case id and question', () => {
    const run = baseRun({
      comparison: {
        previousRunId: 'job-0',
        regressions: [
          { id: 'final-score-2018', question: '2018 final score?' },
        ],
        improvements: [
          { id: 'top-scorer-2022', question: 'Top scorer in 2022?' },
        ],
        unchanged: [],
      },
    });
    const markdown = renderEvalRunMarkdown(run);
    expect(markdown).toContain('**Regressions**');
    expect(markdown).toContain('`final-score-2018` — 2018 final score?');
    expect(markdown).toContain('**Improvements**');
    expect(markdown).toContain('`top-scorer-2022` — Top scorer in 2022?');
  });
});

describe('renderEvalRunMarkdown — categories', () => {
  it('reports a pass rate per failure class, right after the summary', () => {
    const markdown = renderEvalRunMarkdown(
      baseRun({
        totalCases: 3,
        results: [
          caseResult('a', true, 'q a', 'control'),
          caseResult('b', false, 'q b', 'ratio-trap'),
          caseResult('c', true, 'q c', 'ratio-trap'),
        ],
      }),
    );
    expect(markdown).toContain('## By category');
    expect(markdown.indexOf('## By category')).toBeGreaterThan(
      markdown.indexOf('## Summary'),
    );
    expect(markdown).toContain('| control | 1 | 1 | 100% |');
    expect(markdown).toContain('| ratio-trap | 1 | 2 | 50% |');
  });

  it('prefers the tallies the run recorded over recomputing them', () => {
    const markdown = renderEvalRunMarkdown(
      baseRun({ categories: { ties: { total: 4, passed: 1 } } }),
    );
    expect(markdown).toContain('| ties | 1 | 4 | 25% |');
  });

  it('omits the section for a run whose cases carry no category', () => {
    expect(renderEvalRunMarkdown(baseRun())).not.toContain('## By category');
  });
});

describe('renderEvalRunMarkdown — tokens and cost', () => {
  const usage = {
    inputTokens: 12_000,
    outputTokens: 3400,
    totalTokens: 15_400,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    calls: 11,
  };

  it('omits the section on runs recorded before token accounting', () => {
    expect(renderEvalRunMarkdown(baseRun())).not.toContain(
      '## Tokens and cost',
    );
  });

  it('reports counts, the model and the estimated cost', () => {
    const markdown = renderEvalRunMarkdown(
      baseRun({ usage, model: 'openai/gpt-4o-mini', estimatedCostUsd: 0.0234 }),
    );
    expect(markdown).toContain('## Tokens and cost');
    expect(markdown).toContain('`openai/gpt-4o-mini`');
    expect(markdown).toContain('| 12,000 | 3,400 | 15,400 | 11 |');
    expect(markdown).toContain('**Estimated cost:** $0.0234');
  });

  it('says the model is unpriced rather than printing a zero', () => {
    const markdown = renderEvalRunMarkdown(baseRun({ usage }));
    expect(markdown).toContain('not priced — add the model to');
    expect(markdown).not.toContain('$0.0000');
  });

  it('distinguishes "not measured" from "free"', () => {
    const markdown = renderEvalRunMarkdown(
      baseRun({ usage: { ...usage, calls: 0 } }),
    );
    expect(markdown).toContain('reported no token usage');
    expect(markdown).not.toContain('Estimated cost');
  });
});

describe('renderEvalRunMarkdown — pass^k runs', () => {
  const attempts = (verdicts: ('PASS' | 'FAIL' | 'GAP')[]) =>
    verdicts.map((verdict, index) => ({
      attempt: index + 1,
      verdict,
      checks: [
        {
          id: 'result-set-match',
          passed: verdict === 'PASS',
          ...(verdict === 'GAP'
            ? { gap: true, reason: 'reference query failed' }
            : verdict === 'FAIL'
              ? { reason: 'rows differ' }
              : {}),
        },
      ],
      finalSql: `SELECT ${index + 1} AS attempt`,
      sql: [
        { sql: 'SELECT nope', ok: false, error: 'column "nope" does not exist' },
        { sql: `SELECT ${index + 1} AS attempt`, ok: true, rowCount: 1, repaired: true },
      ],
      answer: `answer ${index + 1}`,
      steps: 2,
      calledTools: ['run_readonly_sql', 'run_readonly_sql'],
      repairs:
        verdict === 'FAIL'
          ? [
              {
                original: 'SELECT nope',
                repaired: 'SELECT 1',
                error: 'column "nope" does not exist',
                kind: 'semantic' as const,
                warning: 'the repair changed a filter',
              },
            ]
          : [],
      warnings: verdict === 'FAIL' ? ['constant metric across rows'] : [],
      review: 'ok' as const,
      ...(verdict === 'FAIL' ? { failureLabel: 'wrong-filter' as const } : {}),
      durationMs: 1000,
    }));

  function v2Result(
    id: string,
    verdicts: ('PASS' | 'FAIL' | 'GAP')[],
    extra: Partial<AssistantEvalCaseResult> = {},
  ): AssistantEvalCaseResult {
    const passes = verdicts.filter((verdict) => verdict === 'PASS').length;
    const measured = verdicts.filter((verdict) => verdict !== 'GAP').length;
    const verdict = verdicts.every((x) => x === 'GAP')
      ? 'GAP'
      : passes === verdicts.length
        ? 'PASS'
        : 'FAIL';
    return {
      ...caseResult(id, verdict === 'PASS', `question ${id}`, 'ratio-trap'),
      verdict,
      runs: measured,
      passes,
      flaky: passes > 0 && passes < measured,
      attempts: attempts(verdicts),
      ...(verdict === 'GAP'
        ? {
            checkResults: [
              {
                id: 'result-set-match',
                description: 'Result set matches',
                score: 0,
                passed: false,
                gap: true,
                reason: 'reference query failed',
              },
            ],
          }
        : {}),
      ...extra,
    };
  }

  const run = () =>
    baseRun({
      repeat: 3,
      label: 'iter-1',
      arm: 'fixer-off',
      engine: {
        ...resolveEngineOptions(),
        sqlRepair: false,
        descriptiveErrors: true,
      },
      configHash: 'abc123def456',
      model: 'databricks/my-endpoint',
      reasoningEffort: 'high',
      judgeModel: 'openai/gpt-4.1-mini',
      logFile: '2026-01-01-world-cup-iter-1-fixer-off-job-1.json',
      totalCases: 3,
      results: [
        v2Result('a', ['PASS', 'PASS', 'PASS'], { difficulty: 'easy' }),
        v2Result('b', ['PASS', 'FAIL', 'PASS'], {
          difficulty: 'hard',
          failureLabel: 'wrong-filter',
        }),
        v2Result('c', ['GAP', 'GAP', 'GAP']),
      ],
      summary: {
        passK: 1,
        passKRate: 0.5,
        scored: 2,
        meanPassRate: 5 / 6,
        flaky: 1,
        gaps: 1,
        answeredEveryTime: 3,
        answeredObserved: 3,
        byCategory: {
          'ratio-trap': { total: 1, passK: 0, meanPassRate: 2 / 3 },
          control: { total: 1, passK: 1, meanPassRate: 1 },
        },
        byDifficulty: {
          easy: { total: 1, passK: 1 },
          hard: { total: 1, passK: 0 },
        },
        costPerCorrectUsd: 0.0123,
      },
    });

  it('leads with the pass^k headline', () => {
    const markdown = renderEvalRunMarkdown(run());
    expect(markdown).toContain('**pass^3: 1/2 scored (50%)**');
    expect(markdown).toContain('**Mean pass rate:** 83%');
    expect(markdown).toContain('**Flaky:** 1 · **GAP:** 1');
    expect(markdown).toContain('**Answered every time:** 3/3');
    expect(markdown).toContain('**$ / correct answer:** $0.0123');
    expect(markdown).not.toContain('questions passed');
  });

  it('says what the run ran on: arm, engine diff, hash, model, effort, judge', () => {
    const markdown = renderEvalRunMarkdown(run());
    expect(markdown).toContain('- **Arm:** fixer-off');
    expect(markdown).toContain('`sqlRepair=false`, `descriptiveErrors=true`');
    expect(markdown).toContain('- **Config hash:** `abc123def456`');
    expect(markdown).toContain('- **Model:** `databricks/my-endpoint`');
    expect(markdown).toContain('- **Reasoning effort:** high');
    expect(markdown).toContain('- **Judge:** `openai/gpt-4.1-mini`');
    expect(markdown).toContain('- **Label:** iter-1');
    expect(markdown).toContain(
      '`logs/evals/2026-01-01-world-cup-iter-1-fixer-off-job-1.json`',
    );
  });

  it('tables pass^k per category and per difficulty, worst first', () => {
    const markdown = renderEvalRunMarkdown(run());
    expect(markdown).toContain('## By category (pass^3, worst first)');
    expect(markdown.indexOf('| ratio-trap | 0 | 1 | 0% | 67% |')).toBeLessThan(
      markdown.indexOf('| control | 1 | 1 | 100% | 100% |'),
    );
    expect(markdown).toContain('## By difficulty (pass^3, worst first)');
    expect(markdown.indexOf('| hard | 0 | 1 | 0% |')).toBeLessThan(
      markdown.indexOf('| easy | 1 | 1 | 100% |'),
    );
    // The legacy table is not repeated.
    expect(markdown).not.toContain('| Category | Passed | Cases | Pass rate |');
  });

  it('lists GAP and flaky cases apart from the failures', () => {
    const markdown = renderEvalRunMarkdown(run());
    expect(markdown).toContain('## Not measured (GAP)');
    expect(markdown).toContain('- `c` — question c (reference query failed)');
    expect(markdown).toContain('## Flaky');
    expect(markdown).toContain('- `b` — 2/3 attempts passed');
    const glance = markdown.slice(markdown.indexOf('## Failures at a glance'));
    expect(glance).toContain('question b** — `wrong-filter`');
    expect(glance.split('## Questions')[0]).not.toContain('question c');
  });

  it('shows every attempt: verdict, final SQL, all SQL, repairs, warnings, answer', () => {
    const markdown = renderEvalRunMarkdown(run());
    const caseB = markdown.slice(markdown.indexOf('### 2. question b'));
    expect(caseB).toContain('- **Verdict:** ❌ FAIL — 2/3 attempts passed (flaky)');
    expect(caseB).toContain('- **Failure label:** `wrong-filter`');
    expect(caseB).toContain('- **Difficulty:** hard');
    expect(caseB).toContain('##### Attempt 2 — ❌ FAIL');
    expect(caseB).toContain('```sql\nSELECT 2 AS attempt\n```');
    expect(caseB).toContain('✗ error: column "nope" does not exist');
    expect(caseB).toContain('✓ ok, 1 rows (repaired by the SQL fixer)');
    expect(caseB).toContain('`semantic` repair after');
    expect(caseB).toContain('the repair changed a filter');
    expect(caseB).toContain('- constant metric across rows');
    expect(caseB).toContain('review ok');
    expect(caseB).toContain('answer 2');
  });

  it('notes a comparison that is not like-for-like, and flakiness changes', () => {
    const markdown = renderEvalRunMarkdown(
      baseRun({
        ...run(),
        comparison: {
          previousRunId: 'job-0',
          regressions: [],
          improvements: [],
          unchanged: [],
          flakyChanges: [{ id: 'b', question: 'question b' }],
          unmeasured: [{ id: 'c', question: 'question c' }],
          sameConfig: false,
          sameRepeat: true,
        },
      }),
    );
    expect(markdown).toContain(
      '**Not like-for-like:** the previous run used a different engine config.',
    );
    expect(markdown).toContain('**Flakiness changed:**');
    expect(markdown).toContain('**Not comparable** (GAP or SKIP on one side):');
    expect(markdown).not.toContain('No change from the previous run.');
  });
});
