import { renderEvalRunMarkdown } from './eval-report';
import type { EvalRunView } from './eval-runs.service';
import type {
  AssistantEvalCaseResult,
  EvalCheckResult,
} from '../../mastra/evals/assistant.evals';
import { summarizeEvalResults } from '../../mastra/evals/eval-summary';
import type { ModelUsageEntry } from '../../mastra/evals/eval-usage';

function caseResult(
  id: string,
  passed: boolean,
  question = `question ${id}`,
): AssistantEvalCaseResult {
  return {
    id,
    question,
    category: 'lookup',
    scores: {},
    checkResults: [],
    answer: 'an answer',
    toolCalls: [],
    status: passed ? 'passed' : 'failed',
    passed,
    durationMs: 10,
    split: 'dev',
    passes: passed ? 1 : 0,
    runs: 1,
    flaky: false,
  };
}

function baseRun(overrides: Partial<EvalRunView> = {}): EvalRunView {
  const results = overrides.results ?? [caseResult('champion-2022', true)];
  return {
    jobId: 'job-1',
    agentKey: 'assistant',
    datasourceId: 'ds-1',
    datasets: ['World Cup'],
    caseIds: ['champion-2022'],
    status: 'completed',
    results,
    totalCases: results.length,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:05.000Z',
    judge: { mode: 'off' },
    repeats: 1,
    source: 'app',
    summary: summarizeEvalResults(results),
    ...overrides,
  };
}

const judgeOff: EvalCheckResult = {
  id: 'llm-judge',
  description: 'LLM judge: says it cannot answer',
  score: 0,
  passed: false,
  status: 'not-scored',
  reason: 'Judge off for this run',
  criterion: 'G2',
};

/** One passed lookup, one failed join, one judge-only out-of-scope question. */
function mixedRun(overrides: Partial<EvalRunView> = {}): EvalRunView {
  return baseRun({
    results: [
      {
        ...caseResult('champion-2022', true, 'Who won the 2022 World Cup?'),
        checkResults: [
          {
            id: 'result-set-match',
            description: 'Result set matches expectedSql',
            score: 1,
            passed: true,
            status: 'passed',
            criterion: 'D1',
          },
        ],
      },
      {
        ...caseResult('final-score-2018', false, 'Score of the 2018 final?'),
        category: 'join',
        checkResults: [
          {
            id: 'result-set-match',
            description: 'Result set matches expectedSql',
            score: 0,
            passed: false,
            status: 'failed',
            reason: 'none matched',
            criterion: 'D1',
          },
          { ...judgeOff, reason: 'Judge off for this run' },
        ],
      },
      {
        ...caseResult('out-of-scope', false, 'Pelé in 1970?'),
        category: 'out-of-scope',
        status: 'not-scored',
        checkResults: [judgeOff],
      },
    ],
    ...overrides,
  });
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

describe('renderEvalRunMarkdown — judge option and summary (R38, R153)', () => {
  it('prints the judge line and the not-scored count after the passed line', () => {
    const markdown = renderEvalRunMarkdown(mixedRun());
    expect(markdown).toContain(
      '**1/3 questions passed**\n\nJudge: off\n\nNot scored: 1\n\nRepeats: 1\n',
    );
  });

  it('leaves out the not-scored line when every question was scored', () => {
    const markdown = renderEvalRunMarkdown(baseRun({ judge: { mode: 'on' } }));
    expect(markdown).toContain('Judge: on');
    expect(markdown).not.toContain('Not scored:');
  });

  it('names the judged categories', () => {
    const markdown = renderEvalRunMarkdown(
      baseRun({
        judge: {
          mode: 'categories',
          categories: ['ambiguous', 'out-of-scope'],
        },
      }),
    );
    expect(markdown).toContain('Judge: on for ambiguous, out-of-scope');
  });

  it('reads a run saved before the option as judged', () => {
    const legacy = { ...baseRun(), judge: undefined } as unknown as EvalRunView;
    expect(renderEvalRunMarkdown(legacy)).toContain('Judge: on');
  });

  it('has the By category and By criterion tables after the run details and before the summary', () => {
    const markdown = renderEvalRunMarkdown(mixedRun());
    const details = markdown.indexOf('- **Run id:**');
    const byCategory = markdown.indexOf('## By category');
    const byCriterion = markdown.indexOf('## By criterion');
    const summary = markdown.indexOf('## Summary');
    expect(details).toBeGreaterThan(-1);
    expect(byCategory).toBeGreaterThan(details);
    expect(byCriterion).toBeGreaterThan(byCategory);
    expect(summary).toBeGreaterThan(byCriterion);
    expect(markdown).toContain(
      '| Category | Dev | Held-out | Flaky | Not scored | Total |',
    );
    expect(markdown).toContain('| lookup | 1/1 (21–100%) | — | 0 | 0 | 1 |');
    expect(markdown).toContain('| join | 0/1 (0–79%) | — | 0 | 0 | 1 |');
    expect(markdown).toContain('| out-of-scope | — | — | 0 | 1 | 1 |');
    expect(markdown).toContain('| D1 | 1 | 1 | 2 |');
    expect(markdown).not.toContain('| G2 |');
  });

  it('shows a not-scored question and check as not scored, never as passed or failed', () => {
    const markdown = renderEvalRunMarkdown(mixedRun());
    expect(markdown).toContain('| 3 | Pelé in 1970? | dev | ➖ | 10ms |');
    expect(markdown).toContain('- **Result:** ➖ not scored');
    expect(markdown).toContain(
      '| LLM judge: says it cannot answer | not scored | Judge off for this run |',
    );
  });

  it('lists only failed questions and failed checks under Failures at a glance', () => {
    const markdown = renderEvalRunMarkdown(mixedRun());
    const glance = markdown.slice(
      markdown.indexOf('## Failures at a glance'),
      markdown.indexOf('## Questions'),
    );
    expect(glance).toContain('Score of the 2018 final?');
    expect(glance).toContain('none matched');
    expect(glance).not.toContain('Pelé in 1970?');
    expect(glance).not.toContain('Judge off for this run');
  });
});

/** The assistant's and the SQL fixer's tokens, on one model. */
function usage(model = 'gpt-4o-mini', unreportedCalls = 0): ModelUsageEntry[] {
  return [
    {
      agent: 'assistant',
      model,
      inputTokens: 12_000,
      cachedInputTokens: 2_000,
      outputTokens: 1_500,
      reasoningTokens: 0,
      calls: 2,
      unreportedCalls,
    },
    {
      agent: 'sql-fixer',
      model,
      inputTokens: 800,
      cachedInputTokens: 0,
      outputTokens: 50,
      reasoningTokens: 0,
      calls: 1,
      unreportedCalls: 0,
    },
  ];
}

/** A repeat-3 run: a dev question passed 3/3, a held-out one 2/3 (flaky). */
function repeatRun(overrides: Partial<EvalRunView> = {}): EvalRunView {
  const results: AssistantEvalCaseResult[] = [
    {
      ...caseResult('champion-2022', true, 'Who won the 2022 World Cup?'),
      passes: 3,
      runs: 3,
      usage: usage(),
      costUsd: 0.0012,
    },
    {
      ...caseResult('shot-conversion-2022', false, 'Shot conversion 2022?'),
      category: 'ratio',
      split: 'held-out',
      passes: 2,
      runs: 3,
      flaky: true,
      usage: usage('gpt-4o-mini', 1),
      costUsd: 0.0011,
    },
  ];
  return baseRun({
    results,
    repeats: 3,
    model: 'openai/gpt-4o-mini',
    // The two questions' usage summed.
    usage: [
      {
        agent: 'assistant',
        model: 'gpt-4o-mini',
        inputTokens: 24_000,
        cachedInputTokens: 4_000,
        outputTokens: 3_000,
        reasoningTokens: 0,
        calls: 4,
        unreportedCalls: 1,
      },
      {
        agent: 'sql-fixer',
        model: 'gpt-4o-mini',
        inputTokens: 1_600,
        cachedInputTokens: 0,
        outputTokens: 100,
        reasoningTokens: 0,
        calls: 2,
        unreportedCalls: 0,
      },
    ],
    costUsd: 0.0023,
    rates: {
      'gpt-4o-mini': {
        inputPerMillionUsd: 0.15,
        cachedInputPerMillionUsd: 0.075,
        outputPerMillionUsd: 0.6,
      },
    },
    ...overrides,
  });
}

describe('renderEvalRunMarkdown — repeats, splits, tokens and cost (R218)', () => {
  it('prints the repeats, dev, held-out, flaky, tokens and cost lines after the judge line, in order', () => {
    const markdown = renderEvalRunMarkdown(repeatRun());
    expect(markdown).toContain(
      [
        '**1/2 questions passed**',
        '',
        'Judge: off',
        '',
        'Repeats: 3',
        '',
        'Dev: 1/1 passed · 95% interval 21–100%',
        '',
        'Held-out: 0/1 passed · 95% interval 0–79%',
        '',
        'Flaky: 1',
        '',
        'Tokens: 25,600 in (4,000 cached) · 3,100 out (0 reasoning) · 7 calls · 1 without usage',
        '',
        'Cost: $0.0023 · $0.0011 per question',
        '',
        '- **Started:**',
      ].join('\n'),
    );
  });

  it('writes the split and the attempts in the summary table and in each question', () => {
    const markdown = renderEvalRunMarkdown(repeatRun());
    expect(markdown).toContain('| # | Question | Split | Result | Duration |');
    expect(markdown).toContain(
      '| 1 | Who won the 2022 World Cup? | dev | ✅ 3/3 | 10ms |',
    );
    expect(markdown).toContain(
      '| 2 | Shot conversion 2022? | held-out | ❌ 2/3 | 10ms |',
    );
    expect(markdown).toContain(
      [
        '- **Result:** ❌ failed',
        '- **Id:** `shot-conversion-2022`',
        '- **Split:** held-out',
        '- **Attempts:** 2 of 3 passed, flaky',
        '- **Duration:** 10ms',
        '- **Tokens:** 12,800 in (2,000 cached) · 1,550 out (0 reasoning) · 4 calls · 1 without usage',
        '- **Cost:** $0.0011',
      ].join('\n'),
    );
    expect(markdown).toContain('- **Attempts:** 3 of 3 passed\n');
  });

  it('writes the By category cells as passed over scored with the interval', () => {
    const markdown = renderEvalRunMarkdown(repeatRun());
    expect(markdown).toContain('| lookup | 1/1 (21–100%) | — | 0 | 0 | 1 |');
    expect(markdown).toContain('| ratio | — | 0/1 (0–79%) | 1 | 0 | 1 |');
  });

  it('leaves out the attempts and the flaky line with Repeats 1', () => {
    const markdown = renderEvalRunMarkdown(baseRun({ usage: [], costUsd: 0 }));
    expect(markdown).toContain('Repeats: 1');
    expect(markdown).not.toContain('Flaky:');
    expect(markdown).not.toContain('**Attempts:**');
    expect(markdown).toContain(
      '| 1 | question champion-2022 | dev | ✅ | 10ms |',
    );
  });

  it('reads a freshly started run as no tokens and no cost yet', () => {
    const markdown = renderEvalRunMarkdown(
      baseRun({ results: [], totalCases: 3, usage: [], costUsd: 0 }),
    );
    expect(markdown).toContain(
      'Tokens: 0 in (0 cached) · 0 out (0 reasoning) · 0 calls',
    );
    expect(markdown).toContain('Cost: $0.0000\n');
    expect(markdown).toContain('Dev: 0/0 passed · 95% interval —');
  });

  it('names the models with no rate when the run is not priced', () => {
    const markdown = renderEvalRunMarkdown(
      repeatRun({
        usage: usage('llama-3'),
        costUsd: null,
        rates: {},
        results: [
          {
            ...caseResult('champion-2022', true),
            usage: usage('llama-3'),
            costUsd: null,
          },
        ],
      }),
    );
    expect(markdown).toContain('Cost: not priced (llama-3)');
    expect(markdown).toContain('- **Cost:** not priced (llama-3)');
    expect(markdown).toContain('Tokens: 12,800 in');
  });

  it('says not recorded for a run saved before usage was recorded', () => {
    const markdown = renderEvalRunMarkdown(baseRun());
    expect(markdown).toContain('Tokens: not recorded');
    expect(markdown).toContain('Cost: not recorded');
    expect(markdown).toContain('- **Tokens:** not recorded');
    expect(markdown).toContain('- **Cost:** not recorded');
    expect(markdown).toContain('- **Split:** dev');
  });

  it('notes a comparison with a run of other repeats', () => {
    const comparison = {
      previousRunId: 'job-0',
      regressions: [],
      improvements: [],
      unchanged: [{ id: 'champion-2022', question: 'Who won?' }],
    };
    const noted = renderEvalRunMarkdown(
      repeatRun({ comparison }),
      undefined,
      1,
    );
    expect(noted).toContain(
      '_Compared to run `job-0`._\n\nNote: the previous run used Repeats 1.\n',
    );
    for (const previous of [3, undefined]) {
      expect(
        renderEvalRunMarkdown(repeatRun({ comparison }), undefined, previous),
      ).not.toContain('Note: the previous run');
    }
  });
});
