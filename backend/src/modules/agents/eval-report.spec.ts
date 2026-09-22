import { renderEvalRunMarkdown } from './eval-report';
import type { EvalRunView } from './eval-runs.service';
import type { AssistantEvalCaseResult } from '../../mastra/evals/assistant.evals';

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
