import type { EvalRunView } from './eval-runs.service';
import type { EvalCaseDelta, EvalRegressionSummary } from './eval-regression';
import type {
  AssistantEvalCaseResult,
  EvalToolCall,
} from '../../mastra/evals/assistant.evals';

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

function toolCallSection(call: EvalToolCall, index: number): string {
  const lines = [`##### ${index + 1}. \`${call.name}\``];
  if (call.input) lines.push('', 'Input:', fence(call.input, 'json'));
  if (call.error) lines.push('', 'Error:', fence(call.error));
  else if (call.output) lines.push('', 'Output:', fence(call.output, 'json'));
  return lines.join('\n');
}

function caseSection(result: AssistantEvalCaseResult, index: number): string {
  const verdict = result.passed ? '✅ passed' : '❌ failed';
  const lines = [
    `### ${index + 1}. ${result.question}`,
    '',
    `- **Result:** ${verdict}`,
    `- **Id:** \`${result.id}\``,
    `- **Duration:** ${durationLabel(result.durationMs)}`,
  ];

  if (result.error) lines.push('', `> **Run error:** ${result.error}`);

  if (result.checkResults.length > 0) {
    lines.push('', '| Check | Score | Why |', '| --- | --- | --- |');
    for (const check of result.checkResults) {
      const why = check.passed ? '' : (check.reason ?? '').replace(/\|/g, '\\|');
      lines.push(
        `| ${check.description.replace(/\|/g, '\\|')} | ${check.score} | ${why.replace(/\n/g, ' ')} |`,
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
  lines.push('', result.answer ? result.answer : '_The agent returned no text._');
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
 * run. Callers omit this entirely when `run.comparison` is absent (no
 * previous completed run to compare against, or an old record saved before
 * regression tracking existed).
 */
function comparisonSection(comparison: EvalRegressionSummary): string[] {
  const lines = [
    '',
    '## Compared to previous run',
    '',
    `_Compared to run \`${comparison.previousRunId}\`._`,
  ];

  if (comparison.regressions.length === 0 && comparison.improvements.length === 0) {
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

/** A self-contained Markdown report of one eval run, traces included. */
export function renderEvalRunMarkdown(
  run: EvalRunView,
  datasourceName?: string,
): string {
  const passed = run.results.filter((result) => result.passed).length;
  const failed = run.results.filter((result) => !result.passed);

  const lines = [
    `# Eval run — ${run.agentKey}`,
    '',
    `**${passed}/${run.totalCases} questions passed**`,
    '',
    `- **Started:** ${run.startedAt}`,
    `- **Finished:** ${run.finishedAt ?? '—'}`,
    `- **Duration:** ${runDuration(run)}`,
    `- **Status:** ${run.status}`,
    `- **Datasource:** ${datasourceName ?? run.datasourceId}`,
    `- **Datasets:** ${run.datasets.join(', ') || '—'}`,
    `- **Run id:** \`${run.jobId}\``,
  ];

  if (run.error) lines.push('', `> **Run error:** ${run.error}`);

  lines.push('', '## Summary', '', '| # | Question | Result | Duration |');
  lines.push('| --- | --- | --- | --- |');
  for (const [index, result] of run.results.entries()) {
    lines.push(
      `| ${index + 1} | ${result.question.replace(/\|/g, '\\|')} | ${
        result.passed ? '✅' : '❌'
      } | ${durationLabel(result.durationMs)} |`,
    );
  }

  if (run.comparison) {
    lines.push(...comparisonSection(run.comparison));
  }

  if (failed.length > 0) {
    lines.push('', '## Failures at a glance', '');
    for (const result of failed) {
      const reasons = result.error
        ? [result.error]
        : result.checkResults
            .filter((check) => !check.passed)
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
    lines.push(caseSection(result, index), '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** `eval-run-<agent>-<date>-<short id>.md` */
export function evalRunFilename(run: EvalRunView): string {
  const date = run.startedAt.slice(0, 19).replace(/[:T]/g, '-');
  return `eval-run-${run.agentKey}-${date}-${run.jobId.slice(0, 8)}.md`;
}
