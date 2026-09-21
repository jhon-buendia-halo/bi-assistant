import { renderEvalRunMarkdown } from './eval-report';
import type { EvalRunView } from './eval-runs.service';
import type { AssistantEvalCaseResult } from '../../mastra/evals/assistant.evals';

function caseResult(
  id: string,
  passed: boolean,
  question = `question ${id}`,
): AssistantEvalCaseResult {
  return {
    id,
    question,
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
