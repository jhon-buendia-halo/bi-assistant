import type { EvalRunView } from './eval-runs.service';
import type { EvalCaseDelta, EvalRegressionSummary } from './eval-regression';
import type {
  AssistantEvalCaseResult,
  EvalCheckResult,
  EvalToolCall,
} from '../../mastra/evals/assistant.evals';
import {
  checkStatusOf,
  costText,
  renderSummaryMarkdown,
  resultStatusOf,
  splitLines,
  summarizeEvalResults,
  tokensText,
} from '../../mastra/evals/eval-summary';
import type { EvalStatus } from '../../mastra/evals/eval-summary';
import {
  judgeLabel,
  LEGACY_JUDGE_SETTING,
} from '../../mastra/evals/judge-option';
import type { ModelRate } from '../../mastra/evals/eval-usage';

/** A question's result as the report shows it (R38). */
const VERDICT: Readonly<Record<EvalStatus, string>> = {
  passed: '✅ passed',
  failed: '❌ failed',
  'not-scored': '➖ not scored',
};

/** The same, as the summary table's one-character mark. */
const MARK: Readonly<Record<EvalStatus, string>> = {
  passed: '✅',
  failed: '❌',
  'not-scored': '➖',
};

function checkScore(check: EvalCheckResult): string {
  return checkStatusOf(check) === 'not-scored'
    ? 'not scored'
    : String(check.score);
}

/** Fenced blocks must not be broken by fences inside the payload. */
function fence(body: string, language = ''): string {
  const ticks = '```';
  return `${ticks}${language}\n${body.replace(/```/g, "'''")}\n${ticks}`;
}

function durationLabel(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function runDuration(run: EvalRunView): string {
  if (!run.finishedAt) return 'still running';
  return durationLabel(
    new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime(),
  );
}

/** A result's attempts; one for a result saved before repeats (R211). */
function runsOf(result: AssistantEvalCaseResult): number {
  return result.runs ?? 1;
}

function toolCallSection(call: EvalToolCall, index: number): string {
  const lines = [`##### ${index + 1}. \`${call.name}\``];
  if (call.input) lines.push('', 'Input:', fence(call.input, 'json'));
  if (call.error) lines.push('', 'Error:', fence(call.error));
  else if (call.output) lines.push('', 'Output:', fence(call.output, 'json'));
  return lines.join('\n');
}

function caseSection(
  result: AssistantEvalCaseResult,
  index: number,
  rates: Readonly<Record<string, ModelRate>> | undefined,
): string {
  const verdict = VERDICT[resultStatusOf(result)];
  const lines = [
    `### ${index + 1}. ${result.question}`,
    '',
    `- **Result:** ${verdict}`,
    `- **Id:** \`${result.id}\``,
    `- **Split:** ${result.split ?? 'dev'}`,
  ];
  if (runsOf(result) > 1) {
    lines.push(
      `- **Attempts:** ${result.passes} of ${runsOf(result)} passed${result.flaky ? ', flaky' : ''}`,
    );
  }
  lines.push(
    `- **Duration:** ${durationLabel(result.durationMs)}`,
    `- **Tokens:** ${tokensText(result.usage)}`,
    `- **Cost:** ${costText(result.costUsd, result.usage, rates)}`,
  );

  if (result.error) lines.push('', `> **Run error:** ${result.error}`);

  // The representative attempt's checks, steps and answer (R211).
  if (result.checkResults.length > 0) {
    lines.push('', '| Check | Score | Why |', '| --- | --- | --- |');
    for (const check of result.checkResults) {
      const why = check.passed
        ? ''
        : (check.reason ?? '').replace(/\|/g, '\\|');
      lines.push(
        `| ${check.description.replace(/\|/g, '\\|')} | ${checkScore(check)} | ${why.replace(/\n/g, ' ')} |`,
      );
    }
  }

  lines.push('', '#### Executed steps');
  if (result.toolCalls.length === 0) {
    lines.push('', '_The agent answered without calling any tool._');
  } else {
    for (const [i, call] of result.toolCalls.entries()) {
      lines.push('', toolCallSection(call, i));
    }
  }

  lines.push('', '#### Answer');
  lines.push(
    '',
    result.answer ? result.answer : '_The agent returned no text._',
  );
  return lines.join('\n');
}

function deltaList(deltas: EvalCaseDelta[]): string[] {
  return deltas.map(
    (delta) => `- \`${delta.id}\` — ${delta.question.replace(/\|/g, '\\|')}`,
  );
}

/**
 * "Compared to previous run" section — regressions and improvements by case
 * id/question, matched against the agent's most recent previous completed
 * run (R41), as the report and the command line print it. Callers omit this
 * entirely when `run.comparison` is absent (no previous completed run to
 * compare against, or an old record saved before regression tracking
 * existed). With `previousRepeats` other than `repeats`, it notes the
 * previous run's (R218).
 */
export function renderComparisonMarkdown(
  comparison: EvalRegressionSummary,
  repeats = 1,
  previousRepeats?: number,
): string[] {
  const lines = [
    '',
    '## Compared to previous run',
    '',
    `_Compared to run \`${comparison.previousRunId}\`._`,
  ];
  if (previousRepeats !== undefined && previousRepeats !== repeats) {
    lines.push('', `Note: the previous run used Repeats ${previousRepeats}.`);
  }

  if (
    comparison.regressions.length === 0 &&
    comparison.improvements.length === 0
  ) {
    lines.push('', 'No change from the previous run.');
    return lines;
  }

  if (comparison.regressions.length > 0) {
    lines.push(
      '',
      '**Regressions** (passed before, now failing):',
      ...deltaList(comparison.regressions),
    );
  }
  if (comparison.improvements.length > 0) {
    lines.push(
      '',
      '**Improvements** (failed before, now passing):',
      ...deltaList(comparison.improvements),
    );
  }
  return lines;
}

/**
 * The repeats, dev, held-out, flaky, tokens and cost lines that follow the
 * judge and not-scored lines (R218). The cost per question counts the
 * finished questions.
 */
export function renderRunMetricLines(
  run: Pick<EvalRunView, 'repeats' | 'results' | 'usage' | 'costUsd' | 'rates'>,
  summary = summarizeEvalResults(run.results),
): string[] {
  return [
    `Repeats: ${run.repeats ?? 1}`,
    ...splitLines(summary),
    ...(summary.flaky > 0 ? [`Flaky: ${summary.flaky}`] : []),
    `Tokens: ${tokensText(run.usage)}`,
    `Cost: ${costText(run.costUsd, run.usage, run.rates, run.results.length)}`,
  ];
}

/**
 * A self-contained Markdown report of one eval run, traces included.
 * `previousRepeats` is the repeats of the run it was compared with, when
 * known, so the comparison can note a difference (R218).
 */
export function renderEvalRunMarkdown(
  run: EvalRunView,
  datasourceName?: string,
  previousRepeats?: number,
): string {
  // From the results, so a run read without a stored summary has one too.
  const summary = summarizeEvalResults(run.results);
  const failed = run.results.filter(
    (result) => resultStatusOf(result) === 'failed',
  );

  const lines = [
    `# Eval run — ${run.agentKey}`,
    '',
    `**${summary.passed}/${run.totalCases} questions passed**`,
    '',
    `Judge: ${judgeLabel(run.judge ?? LEGACY_JUDGE_SETTING)}`,
    '',
  ];
  if (summary.notScored > 0) {
    lines.push(`Not scored: ${summary.notScored}`, '');
  }
  for (const line of renderRunMetricLines(run, summary)) {
    lines.push(line, '');
  }
  lines.push(
    `- **Started:** ${run.startedAt}`,
    `- **Finished:** ${run.finishedAt ?? '—'}`,
    `- **Duration:** ${runDuration(run)}`,
    `- **Status:** ${run.status}`,
    `- **Datasource:** ${datasourceName ?? run.datasourceId}`,
    `- **Datasets:** ${run.datasets.join(', ') || '—'}`,
    `- **Run id:** \`${run.jobId}\``,
  );

  if (run.error) lines.push('', `> **Run error:** ${run.error}`);

  lines.push('', ...renderSummaryMarkdown(summary));

  lines.push(
    '',
    '## Summary',
    '',
    '| # | Question | Split | Result | Duration |',
  );
  lines.push('| --- | --- | --- | --- | --- |');
  for (const [index, result] of run.results.entries()) {
    const attempts =
      runsOf(result) > 1 ? ` ${result.passes}/${runsOf(result)}` : '';
    lines.push(
      `| ${index + 1} | ${result.question.replace(/\|/g, '\\|')} | ${
        result.split ?? 'dev'
      } | ${MARK[resultStatusOf(result)]}${attempts} | ${durationLabel(
        result.durationMs,
      )} |`,
    );
  }

  if (run.comparison) {
    lines.push(
      ...renderComparisonMarkdown(
        run.comparison,
        run.repeats ?? 1,
        previousRepeats,
      ),
    );
  }

  if (failed.length > 0) {
    lines.push('', '## Failures at a glance', '');
    for (const result of failed) {
      const reasons = result.error
        ? [result.error]
        : result.checkResults
            .filter((check) => checkStatusOf(check) === 'failed')
            .map((check) =>
              check.reason
                ? `${check.description} — ${check.reason}`
                : check.description,
            );
      lines.push(`- **${result.question}**`);
      for (const reason of reasons) {
        lines.push(`  - ${reason.replace(/\n/g, ' ')}`);
      }
    }
  }

  lines.push('', '## Questions', '');
  for (const [index, result] of run.results.entries()) {
    lines.push(caseSection(result, index, run.rates), '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** `eval-run-<agent>-<date>-<short id>.md` */
export function evalRunFilename(run: EvalRunView): string {
  const date = run.startedAt.slice(0, 19).replace(/[:T]/g, '-');
  return `eval-run-${run.agentKey}-${date}-${run.jobId.slice(0, 8)}.md`;
}
