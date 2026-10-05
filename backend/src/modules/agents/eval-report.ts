import type { EvalRunView } from './eval-runs.service';
import type { EvalCaseDelta, EvalRegressionSummary } from './eval-regression';
import { tallyCategories } from './eval-telemetry';
import type {
  CategoryTally,
  EvalRunLogAttempt,
  EvalRunSummary,
  EvalVerdict,
  TokenUsage,
} from './eval-telemetry';
import {
  describeEngineDiff,
  resolveEngineOptions,
} from '../engine/engine-options';
import type {
  AssistantEvalCaseResult,
  EvalToolCall,
} from '../../mastra/evals/assistant.evals';

/**
 * The Markdown report behind "Download" on a run. Runs recorded since
 * pass^k (they carry `summary` or per-case `verdict`s) get the v2 report:
 * the pass^k headline, the arm and engine they ran, per-category and
 * per-difficulty pass^k, GAP and flaky lists, and every attempt's SQL.
 * Older runs render exactly as they always did.
 */

/** Fenced blocks must not be broken by fences inside the payload. */
function fence(body: string, language = ''): string {
  const ticks = '```';
  return `${ticks}${language}\n${body.replace(/```/g, "'''")}\n${ticks}`;
}

/** A value safe inside one Markdown table cell. */
function cell(text: string | undefined): string {
  return (text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function durationLabel(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function dollars(value: number): string {
  return `$${value.toFixed(4)}`;
}

function runDuration(run: EvalRunView): string {
  if (!run.finishedAt) {
    return run.status === 'queued' ? 'not started' : 'still running';
  }
  return durationLabel(
    new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime(),
  );
}

/** A run recorded since pass^k: the v2 report applies. */
function isPassKRun(run: EvalRunView): boolean {
  return (
    run.summary !== undefined ||
    run.results.some((result) => result.verdict !== undefined)
  );
}

/** The case's pass^k verdict, falling back to `passed`/`error` for old results. */
function verdictOf(result: AssistantEvalCaseResult): EvalVerdict {
  if (result.verdict) return result.verdict;
  if (result.error) return 'ERROR';
  return result.passed ? 'PASS' : 'FAIL';
}

const VERDICT_LABELS: Record<EvalVerdict, string> = {
  PASS: '✅ PASS',
  FAIL: '❌ FAIL',
  ERROR: '⚠️ ERROR',
  GAP: '◌ GAP',
  SKIP: '⏭ SKIP',
};

function passesText(result: AssistantEvalCaseResult): string {
  return result.runs !== undefined && result.passes !== undefined
    ? `${result.passes}/${result.runs}`
    : result.passed
      ? '1/1'
      : '0/1';
}

function toolCallSection(call: EvalToolCall, index: number): string {
  const lines = [`##### ${index + 1}. \`${call.name}\``];
  if (call.input) lines.push('', 'Input:', fence(call.input, 'json'));
  if (call.error) lines.push('', 'Error:', fence(call.error));
  else if (call.output) lines.push('', 'Output:', fence(call.output, 'json'));
  return lines.join('\n');
}

/** One attempt: its verdict, the SQL it ran (final first), and what fired. */
function attemptSection(attempt: EvalRunLogAttempt): string[] {
  const lines = [
    `##### Attempt ${attempt.attempt} — ${VERDICT_LABELS[attempt.verdict] ?? attempt.verdict} (${durationLabel(attempt.durationMs)})`,
    '',
  ];
  const facts: string[] = [];
  if (attempt.failureLabel)
    facts.push(`failure label \`${attempt.failureLabel}\``);
  if (attempt.viaSupportingQuery) {
    facts.push('matched on a supporting query, not the final one');
  }
  if (attempt.review) facts.push(`review ${attempt.review}`);
  if (attempt.crossCheck) facts.push(`cross-check ${attempt.crossCheck}`);
  if (attempt.clarification) facts.push('asked a clarifying question');
  facts.push(`${attempt.steps} tool call${attempt.steps === 1 ? '' : 's'}`);
  lines.push(`- ${facts.join(' · ')}`);
  if (attempt.error)
    lines.push(`- **Error:** ${attempt.error.replace(/\n/g, ' ')}`);

  const failed = attempt.checks.filter((check) => !check.passed);
  if (failed.length) {
    lines.push('- **Checks that did not pass:**');
    for (const check of failed) {
      lines.push(
        `  - \`${check.id}\`${check.gap ? ' (not measured)' : ''}${check.reason ? ` — ${check.reason.replace(/\n/g, ' ')}` : ''}`,
      );
    }
  }
  if (attempt.clarification) {
    lines.push(
      `- **Clarification:** ${attempt.clarification.replace(/\n/g, ' ')}`,
    );
  }

  lines.push('', '**Final SQL:**', '');
  lines.push(
    attempt.finalSql
      ? fence(attempt.finalSql, 'sql')
      : '_No successful SQL — the answer did not rest on a query._',
  );

  if (attempt.sql.length) {
    lines.push('', '**All SQL, in order:**', '');
    for (const [index, statement] of attempt.sql.entries()) {
      const status = statement.ok
        ? `ok${statement.rowCount !== undefined ? `, ${statement.rowCount} rows` : ''}`
        : `error: ${(statement.error ?? 'failed').replace(/\n/g, ' ')}`;
      lines.push(
        `${index + 1}. ${statement.ok ? '✓' : '✗'} ${status}${statement.repaired ? ' (repaired by the SQL fixer)' : ''}`,
        '',
        fence(statement.sql, 'sql'),
        '',
      );
    }
  }

  if (attempt.warnings.length) {
    lines.push(
      '',
      '**Warnings:**',
      ...attempt.warnings.map((w) => `- ${w.replace(/\n/g, ' ')}`),
    );
  }
  if (attempt.repairs.length) {
    lines.push('', '**SQL repairs:**');
    for (const repair of attempt.repairs) {
      lines.push(
        '',
        `- \`${repair.kind}\` repair after: ${repair.error.replace(/\n/g, ' ')}${repair.warning ? ` — ⚠️ ${repair.warning}` : ''}`,
        '',
        fence(
          `-- original\n${repair.original}\n-- repaired\n${repair.repaired}`,
          'sql',
        ),
      );
    }
  }

  lines.push('', '**Answer:**', '');
  lines.push(attempt.answer?.trim() ? attempt.answer : '_No answer text._');
  return lines;
}

function caseSection(
  result: AssistantEvalCaseResult,
  index: number,
  passK: boolean,
): string {
  const lines = [`### ${index + 1}. ${result.question}`, ''];
  if (passK) {
    lines.push(
      `- **Verdict:** ${VERDICT_LABELS[verdictOf(result)]} — ${passesText(result)} attempts passed${result.flaky ? ' (flaky)' : ''}`,
    );
    if (result.failureLabel) {
      lines.push(`- **Failure label:** \`${result.failureLabel}\``);
    }
  } else {
    lines.push(`- **Result:** ${result.passed ? '✅ passed' : '❌ failed'}`);
  }
  lines.push(`- **Id:** \`${result.id}\``);
  if (result.category) lines.push(`- **Category:** ${result.category}`);
  if (result.difficulty) lines.push(`- **Difficulty:** ${result.difficulty}`);
  if (result.variantOf) lines.push(`- **Variant of:** \`${result.variantOf}\``);
  lines.push(`- **Duration:** ${durationLabel(result.durationMs)}`);

  if (result.error) lines.push('', `> **Run error:** ${result.error}`);

  if (result.checkResults.length > 0) {
    lines.push('', '| Check | Score | Why |', '| --- | --- | --- |');
    for (const check of result.checkResults) {
      const why = check.passed ? '' : (check.reason ?? '');
      lines.push(
        `| ${cell(check.description)} | ${check.score} | ${cell(why)} |`,
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

  if (passK && result.attempts?.length) {
    lines.push('', '#### Attempts');
    for (const attempt of result.attempts) {
      lines.push('', ...attemptSection(attempt));
    }
  }
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
        verdict: verdictOf(result),
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

function rateOf(passK: number, total: number): number {
  return total > 0 ? passK / total : 0;
}

/** pass^k per category, worst first — the lever the next iteration pulls. */
function passKCategorySection(summary: EvalRunSummary, k: number): string[] {
  const rows = Object.entries(summary.byCategory).sort(
    ([a, x], [b, y]) =>
      rateOf(x.passK, x.total) - rateOf(y.passK, y.total) || a.localeCompare(b),
  );
  if (!rows.length || (rows.length === 1 && rows[0][0] === 'uncategorised')) {
    return [];
  }
  const lines = [
    '',
    `## By category (pass^${k}, worst first)`,
    '',
    `| Category | pass^${k} | Cases | Rate | Mean pass rate |`,
    '| --- | --- | --- | --- | --- |',
  ];
  for (const [category, tally] of rows) {
    lines.push(
      `| ${category} | ${tally.passK} | ${tally.total} | ${percent(rateOf(tally.passK, tally.total))} | ${percent(tally.meanPassRate)} |`,
    );
  }
  return lines;
}

function difficultySection(summary: EvalRunSummary, k: number): string[] {
  const rows = Object.entries(summary.byDifficulty).sort(
    ([a, x], [b, y]) =>
      rateOf(x.passK, x.total) - rateOf(y.passK, y.total) || a.localeCompare(b),
  );
  if (!rows.length || (rows.length === 1 && rows[0][0] === 'unrated')) {
    return [];
  }
  const lines = [
    '',
    `## By difficulty (pass^${k}, worst first)`,
    '',
    `| Difficulty | pass^${k} | Cases | Rate |`,
    '| --- | --- | --- | --- |',
  ];
  for (const [difficulty, tally] of rows) {
    lines.push(
      `| ${difficulty} | ${tally.passK} | ${tally.total} | ${percent(rateOf(tally.passK, tally.total))} |`,
    );
  }
  return lines;
}

/** Thousands separators: six-figure token counts are unreadable without them. */
function tokens(value: number): string {
  return value.toLocaleString('en-US');
}

function usageRow(label: string, usage: TokenUsage): string {
  return `| ${label} | ${tokens(usage.inputTokens)} | ${tokens(usage.outputTokens)} | ${tokens(usage.totalTokens)} | ${usage.calls} |`;
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
  const sides = Object.entries(run.sidePassUsage ?? {}).filter(
    (entry): entry is [string, TokenUsage] => Boolean(entry[1]),
  );
  if (sides.length) {
    lines.push(
      '',
      'Side passes (included above):',
      '',
      '| Pass | Input | Output | Total | Model calls |',
      '| --- | --- | --- | --- | --- |',
      ...sides.map(([pass, sideUsage]) => usageRow(pass, sideUsage)),
    );
  }
  lines.push(
    '',
    run.estimatedCostUsd === undefined
      ? '**Estimated cost:** not priced — add the model to `logs/pricing.json`.'
      : `**Estimated cost:** ${dollars(run.estimatedCostUsd)}`,
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
  const caveats: string[] = [];
  if (comparison.sameConfig === false)
    caveats.push('a different engine config');
  if (comparison.sameRepeat === false) caveats.push('a different repeat');
  if (caveats.length) {
    lines.push(
      '',
      `> **Not like-for-like:** the previous run used ${caveats.join(' and ')}.`,
    );
  }

  const flaky = comparison.flakyChanges ?? [];
  const unmeasured = comparison.unmeasured ?? [];
  if (
    comparison.regressions.length === 0 &&
    comparison.improvements.length === 0 &&
    flaky.length === 0
  ) {
    lines.push('', 'No change from the previous run.');
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
  if (flaky.length > 0) {
    lines.push('', '**Flakiness changed:**', ...deltaList(flaky));
  }
  if (unmeasured.length > 0) {
    lines.push(
      '',
      '**Not comparable** (GAP or SKIP on one side):',
      ...deltaList(unmeasured),
    );
  }
  return lines;
}

/** The pass^k headline and what the run ran on. */
function passKHeader(
  run: EvalRunView,
  summary: EvalRunSummary | undefined,
): string[] {
  const k = run.repeat ?? 1;
  const lines: string[] = [];
  if (summary) {
    lines.push(
      `**pass^${k}: ${summary.passK}/${summary.scored} scored (${percent(summary.passKRate)})**`,
      '',
      `- **Mean pass rate:** ${percent(summary.meanPassRate)} (passes ÷ attempts)`,
      `- **Flaky:** ${summary.flaky} · **GAP:** ${summary.gaps} (not measured — excluded from the rates)`,
      `- **Answered every time:** ${summary.answeredEveryTime}/${summary.answeredObserved}`,
      `- **$ / correct answer:** ${summary.costPerCorrectUsd !== undefined ? dollars(summary.costPerCorrectUsd) : 'not priced'}`,
      `- **Cases:** ${run.results.length}/${run.totalCases} run`,
    );
  } else {
    lines.push(
      `**${run.results.length}/${run.totalCases} questions run so far**`,
    );
  }
  return lines;
}

function engineLines(run: EvalRunView): string[] {
  const lines = [`- **Repeat:** ${run.repeat ?? 1}`];
  if (run.label) lines.push(`- **Label:** ${run.label}`);
  lines.push(`- **Arm:** ${run.arm ?? 'baseline'}`);
  const engine =
    run.engine ?? resolveEngineOptions(undefined, run.engineOverrides);
  const diff = describeEngineDiff(engine);
  lines.push(
    `- **Engine:** ${diff.length ? diff.map((item) => `\`${item}\``).join(', ') : 'shipped defaults (no lever changed)'}`,
  );
  if (run.configHash) lines.push(`- **Config hash:** \`${run.configHash}\``);
  if (run.model) lines.push(`- **Model:** \`${run.model}\``);
  if (run.reasoningEffort)
    lines.push(`- **Reasoning effort:** ${run.reasoningEffort}`);
  lines.push(
    `- **Judge:** ${run.judgeModel ? `\`${run.judgeModel}\`` : "the assistant's model"}`,
  );
  if (run.dialect) lines.push(`- **Dialect:** ${run.dialect}`);
  if (run.includeVariants) lines.push('- **Variants:** included');
  if (run.categoryFilter?.length) {
    lines.push(`- **Categories:** ${run.categoryFilter.join(', ')}`);
  }
  if (run.loopId) lines.push(`- **Loop:** \`${run.loopId}\``);
  if (run.logFile) lines.push(`- **Run log:** \`logs/evals/${run.logFile}\``);
  return lines;
}

/** A self-contained Markdown report of one eval run, traces included. */
export function renderEvalRunMarkdown(
  run: EvalRunView,
  datasourceName?: string,
): string {
  const passK = isPassKRun(run);
  const k = run.repeat ?? 1;
  const passed = run.results.filter((result) => result.passed).length;
  const failed = run.results.filter((result) => {
    const verdict = verdictOf(result);
    return verdict === 'FAIL' || verdict === 'ERROR';
  });

  const lines = [`# Eval run — ${run.agentKey}`, ''];
  if (passK) lines.push(...passKHeader(run, run.summary));
  else lines.push(`**${passed}/${run.totalCases} questions passed**`);
  lines.push(
    '',
    `- **Started:** ${run.startedAt}`,
    `- **Finished:** ${run.finishedAt ?? '—'}`,
    `- **Duration:** ${runDuration(run)}`,
    `- **Status:** ${run.status}`,
    `- **Suite:** ${run.suiteName ?? run.suiteId ?? '—'}`,
    `- **Datasource:** ${datasourceName ?? run.datasourceId}`,
    `- **Datasets:** ${run.datasets.join(', ') || '—'}`,
    `- **Run id:** \`${run.jobId}\``,
  );
  if (passK) lines.push(...engineLines(run));

  if (run.error) lines.push('', `> **Run error:** ${run.error}`);

  lines.push('', '## Summary', '');
  if (passK) {
    lines.push(
      '| # | Question | Verdict | Passes | Failure label | Duration |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const [index, result] of run.results.entries()) {
      lines.push(
        `| ${index + 1} | ${cell(result.question)} | ${VERDICT_LABELS[verdictOf(result)]}${result.flaky ? ' (flaky)' : ''} | ${passesText(result)} | ${result.failureLabel ?? ''} | ${durationLabel(result.durationMs)} |`,
      );
    }
  } else {
    lines.push(
      '| # | Question | Result | Duration |',
      '| --- | --- | --- | --- |',
    );
    for (const [index, result] of run.results.entries()) {
      lines.push(
        `| ${index + 1} | ${cell(result.question)} | ${
          result.passed ? '✅' : '❌'
        } | ${durationLabel(result.durationMs)} |`,
      );
    }
  }

  // Straight after the per-question summary: what kind of question failed
  // matters more than which one, and the cost of finding out belongs with it.
  if (passK && run.summary) {
    lines.push(...passKCategorySection(run.summary, k));
    lines.push(...difficultySection(run.summary, k));
  } else {
    lines.push(...categorySection(run));
  }

  if (passK) {
    const gaps = run.results.filter((result) => verdictOf(result) === 'GAP');
    if (gaps.length) {
      lines.push(
        '',
        '## Not measured (GAP)',
        '',
        '_The harness could not grade these (reference query failed, judge errored) — excluded from every rate, not counted as failures._',
        '',
        ...gaps.map((result) => {
          const reason = result.checkResults.find((check) => check.gap)?.reason;
          return `- \`${result.id}\` — ${cell(result.question)}${reason ? ` (${reason.replace(/\n/g, ' ')})` : ''}`;
        }),
      );
    }
    const flaky = run.results.filter((result) => result.flaky);
    if (flaky.length) {
      lines.push(
        '',
        '## Flaky',
        '',
        ...flaky.map(
          (result) =>
            `- \`${result.id}\` — ${passesText(result)} attempts passed — ${cell(result.question)}`,
        ),
      );
    }
  }

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
      lines.push(
        `- **${result.question}**${passK && result.failureLabel ? ` — \`${result.failureLabel}\`` : ''}`,
      );
      for (const reason of reasons) {
        lines.push(`  - ${reason.replace(/\n/g, ' ')}`);
      }
    }
  }

  lines.push('', '## Questions', '');
  for (const [index, result] of run.results.entries()) {
    lines.push(caseSection(result, index, passK), '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** `eval-run-<agent>-<date>-<short id>.md` */
export function evalRunFilename(run: EvalRunView): string {
  const date = run.startedAt.slice(0, 19).replace(/[:T]/g, '-');
  return `eval-run-${run.agentKey}-${date}-${run.jobId.slice(0, 8)}.md`;
}
