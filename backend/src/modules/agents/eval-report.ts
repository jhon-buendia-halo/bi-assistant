import type { EvalRunView } from './eval-runs.service';
import type { EvalCaseDelta, EvalRegressionSummary } from './eval-regression';
import { tallyCategories } from './eval-telemetry';
import type { CategoryTally } from './eval-telemetry';
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
    ...(result.category ? [`- **Category:** ${result.category}`] : []),
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

/**
 * Pass rate per failure class — the table the improvement loop actually reads.
 * An overall "7/10 passed" says the engine got worse without saying at what,
 * whereas "ratio-trap 0/2, control 4/4" points straight at the change to make.
 *
 * Prefers the tallies the run recorded, and recomputes from the case results
 * otherwise, so a run stored before `categories` existed still gets the table
 * as long as its cases carry a category.
 */
function categorySection(run: EvalRunView): string[] {
  const tallies: Record<string, CategoryTally> =
    run.categories ??
    tallyCategories(
      run.results.map((result) => ({
        category: result.category,
        verdict: result.error
          ? ('ERROR' as const)
          : result.passed
            ? ('PASS' as const)
            : ('FAIL' as const),
      })),
    );
  const rows = Object.entries(tallies).sort(([a], [b]) => a.localeCompare(b));
  // Nothing to say for a run whose cases predate categories entirely.
  if (
    rows.length === 0 ||
    (rows.length === 1 && rows[0][0] === 'uncategorised')
  ) {
    return [];
  }
  const lines = [
    '',
    '## By category',
    '',
    '| Category | Passed | Cases | Pass rate |',
    '| --- | --- | --- | --- |',
  ];
  for (const [category, tally] of rows) {
    const rate = tally.total
      ? `${Math.round((tally.passed / tally.total) * 100)}%`
      : '—';
    lines.push(`| ${category} | ${tally.passed} | ${tally.total} | ${rate} |`);
  }
  return lines;
}

/** Thousands separators: six-figure token counts are unreadable without them. */
function tokens(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * What the run spent. Counts are measured and exact; the dollar figure is an
 * estimate from `logs/pricing.json`, and is reported as missing rather than
 * guessed when the model that ran has no rate configured — a wrong number in a
 * cost report is worse than no number.
 */
function tokenSection(run: EvalRunView): string[] {
  const usage = run.usage;
  if (!usage) return [];
  const lines = ['', '## Tokens and cost', ''];
  if (run.model) lines.push(`- **Model:** \`${run.model}\``);
  if (usage.calls === 0) {
    lines.push(
      '',
      '_The provider reported no token usage for this run — that is "not ' +
        'measured", not "free"._',
    );
    return lines;
  }
  lines.push(
    '',
    '| Input | Output | Total | Model calls |',
    '| --- | --- | --- | --- |',
    `| ${tokens(usage.inputTokens)} | ${tokens(usage.outputTokens)} | ${tokens(
      usage.totalTokens,
    )} | ${usage.calls} |`,
  );
  if (usage.cachedInputTokens > 0 || usage.reasoningTokens > 0) {
    lines.push(
      '',
      `_Of which ${tokens(usage.cachedInputTokens)} cached input and ${tokens(
        usage.reasoningTokens,
      )} reasoning tokens._`,
    );
  }
  lines.push(
    '',
    run.estimatedCostUsd === undefined
      ? '**Estimated cost:** not priced — add the model to `logs/pricing.json`.'
      : `**Estimated cost:** $${run.estimatedCostUsd.toFixed(4)}`,
  );
  return lines;
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
    `- **Suite:** ${run.suiteName ?? run.suiteId ?? '—'}`,
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

  // Straight after the per-question summary: what kind of question failed
  // matters more than which one, and the cost of finding out belongs with it.
  lines.push(...categorySection(run));
  lines.push(...tokenSection(run));

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
