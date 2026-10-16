import { renderEvalRunMarkdown } from './eval-report';
import type { EvalRunView } from './eval-runs.service';
import type {
  AssistantEvalCaseResult,
  EvalCheckResult,
} from '../../mastra/evals/assistant.evals';
import { summarizeEvalResults } from '../../mastra/evals/eval-summary';

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
      '**1/3 questions passed**\n\nJudge: off\n\nNot scored: 1\n',
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
    expect(markdown).toContain('| lookup | 1 | 0 | 0 | 1 |');
    expect(markdown).toContain('| join | 0 | 1 | 0 | 1 |');
    expect(markdown).toContain('| out-of-scope | 0 | 0 | 1 | 1 |');
    expect(markdown).toContain('| D1 | 1 | 1 | 2 |');
    expect(markdown).not.toContain('| G2 |');
  });

  it('shows a not-scored question and check as not scored, never as passed or failed', () => {
    const markdown = renderEvalRunMarkdown(mixedRun());
    expect(markdown).toContain('| 3 | Pelé in 1970? | ➖ | 10ms |');
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
