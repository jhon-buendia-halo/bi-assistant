import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { writeFileSync } from 'fs';
import { EvalRunsService } from '../../modules/agents/eval-runs.service';
import type { EvalRunView } from '../../modules/agents/eval-runs.service';
import { renderComparisonMarkdown } from '../../modules/agents/eval-report';
import type { AssistantEvalCaseResult } from './assistant.evals';
import { narrowCliEvalCases, selectCliEvalCases } from './eval-cli-selection';
import { EVAL_SETS, agentForCases } from './eval-sets';
import { judgeLabel, judgeSettingFromEnv } from './judge-option';
import type { EvalJudgeSetting } from './judge-option';
import { resolveUserPath } from './loop/cli-args';
import { repeatsFromEnv } from './repeats-option';
import type { EvalRepeats } from './repeats-option';
import {
  costText,
  renderSummaryMarkdown,
  splitLines,
  summarizeEvalResults,
  tokensText,
} from './eval-summary';
import type { EvalStatus } from './eval-summary';

/**
 * CLI entry point for the same suite the Agents → Evals tab runs.
 *
 * The Mastra tools load without Nest DI: `SessionsService.onModuleInit`
 * installs their real implementations and `LlmService` installs the model
 * resolver. Booting an application context gives the eval run the same wiring
 * the app has, without opening an HTTP port, and the run goes through the
 * app's own `EvalRunsService`, so it is saved in the data directory's
 * `eval_runs` like a run started in the app, with the source `cli`
 * (agents-evals R223).
 *
 * `EVAL_SET` names one set (`world-cup`, `world-cup-rest`, …) or
 * `EVAL_CASES` lists case ids; a run needs exactly one of them (agents.md
 * 8.5). `EVAL_SPLIT` and `EVAL_CATEGORY` narrow them, and `EVAL_REPEATS`
 * (1, 3 or 5) sets the attempts per question (R222).
 *
 * `EVAL_JUDGE` (`off` by default, `on` or `categories`) and
 * `EVAL_JUDGE_CATEGORIES` set the judge option (agents-evals R154). With it
 * off, judge checks are not scored and no judge call is made.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** Where the command line prints: the console, or a test's capture. */
export interface CliOutput {
  log(line: string): void;
  error(line: string): void;
}

/** The app context the run boots; what the run reads from it. */
type EvalApp = Pick<
  Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  'get' | 'close'
>;

/** What the command line checked before booting. */
interface CliRun {
  datasets: string[];
  caseIds: string[];
  agentKey: string;
  judge: EvalJudgeSetting;
  repeats: EvalRepeats;
}

/**
 * Check every setting, in the order of agents.md 8.5, then boot the app and
 * run. Answers the exit code: 1 on any refusal, before the backend boots and
 * before any model call.
 */
export async function main(
  env: Env = process.env,
  out: CliOutput = console,
): Promise<number> {
  const datasets = (env['EVAL_DATASETS'] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  if (datasets.length === 0) {
    out.error(
      'Set EVAL_DATASETS to a comma-separated list of saved dataset names, ' +
        'e.g. EVAL_DATASETS="World Cup Core" EVAL_SET=world-cup npm run evals:assistant',
    );
    return 1;
  }
  // Pick the questions before booting anything: with no selection every set
  // would run, and the one-fixture preflight refuses that (agents.md 8.5).
  const selection = selectCliEvalCases(env, EVAL_SETS);
  if ('error' in selection) {
    out.error(selection.error);
    return 1;
  }
  // The agent the questions run on: the assistant, or the RFP Builder for
  // EVAL_SET=rfp (agents.md 8.1).
  const agent = agentForCases(selection.caseIds);
  if ('error' in agent) {
    out.error(agent.error);
    return 1;
  }
  // The judge option, checked before the app boots too (R154).
  const judge = judgeSettingFromEnv(env);
  if ('error' in judge) {
    out.error(judge.error);
    return 1;
  }
  // The repeats, then the split and category filters (R222).
  const repeats = repeatsFromEnv(env);
  if ('error' in repeats) {
    out.error(repeats.error);
    return 1;
  }
  const narrowed = narrowCliEvalCases(env, EVAL_SETS, selection.caseIds);
  if ('error' in narrowed) {
    out.error(narrowed.error);
    return 1;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    return await runEvals(app, env, out, {
      datasets,
      caseIds: narrowed.caseIds,
      agentKey: agent.agentKey,
      judge: judge.setting,
      repeats: repeats.repeats,
    });
  } finally {
    await app.close();
  }
}

/** Run the checked selection through the app's eval runner and print it. */
export async function runEvals(
  app: EvalApp,
  env: Env,
  out: CliOutput,
  cli: CliRun,
): Promise<number> {
  // The in-app runner: the same throwaway session for
  // create_visual/update_visual, the same curated-knowledge block a real
  // chat turn gets, and the run saved after every question.
  const evalRuns = app.get(EvalRunsService);
  out.log(`Judge: ${judgeLabel(cli.judge)}`);
  out.log(`Repeats: ${cli.repeats}\n`);
  const outcome = await evalRuns.runFromCommandLine(
    {
      agentKey: cli.agentKey,
      datasets: cli.datasets,
      caseIds: cli.caseIds,
      judge: cli.judge,
      repeats: cli.repeats,
    },
    (result) => printResult(result, cli.repeats, out),
  );
  if ('error' in outcome) {
    out.error(outcome.error);
    return 1;
  }
  const run = outcome.run;
  if (run.status === 'failed') out.error(`Run error: ${run.error ?? ''}`);

  // The closing lines of R222, each as the report writes it (R218).
  const summary = summarizeEvalResults(run.results);
  out.log(`\n${summary.passed}/${run.results.length} questions passed`);
  if (summary.notScored > 0) out.log(`Not scored: ${summary.notScored}`);
  if (summary.flaky > 0) out.log(`Flaky: ${summary.flaky}`);
  for (const line of splitLines(summary)) out.log(line);
  out.log(`\n${renderSummaryMarkdown(summary).join('\n')}`);
  out.log(`\nTokens: ${tokensText(run.usage)}`);
  out.log(
    `Cost: ${costText(run.costUsd, run.usage, run.rates, run.results.length)}`,
  );
  out.log(`\nRun id: ${run.jobId}`);
  out.log(await comparisonText(evalRuns, run));

  // The whole run (answers and tool calls included) for reading failures,
  // and for the improvement loop's tools (R224). A relative path is read
  // where npm was started (`INIT_CWD`), else the working directory, as the
  // loop tools read the paths typed to them (R223).
  const resultsFile = env['EVAL_RESULTS_FILE'];
  if (resultsFile) {
    writeFileSync(
      resolveUserPath(resultsFile, env),
      JSON.stringify(run.results, null, 2),
    );
  }
  const runFile = env['EVAL_RUN_FILE'];
  if (runFile) {
    writeFileSync(resolveUserPath(runFile, env), JSON.stringify(run, null, 2));
  }
  return run.status === 'completed' ? cliExitCode(run.results) : 1;
}

/** The comparison as the report writes it (R41), or that there is none. */
async function comparisonText(
  evalRuns: EvalRunsService,
  run: EvalRunView,
): Promise<string> {
  if (!run.comparison) return 'No comparable earlier run.';
  return renderComparisonMarkdown(
    run.comparison,
    run.repeats,
    await evalRuns.comparedRunRepeats(run),
  )
    .join('\n')
    .trimStart();
}

/** One question's line and its checks, as it lands (agents.md 8.5). */
function printResult(
  result: AssistantEvalCaseResult,
  repeats: EvalRepeats,
  out: CliOutput,
): void {
  const mark = PROGRESS_MARK[result.status];
  const attempts =
    repeats > 1 ? `  ${result.passes}/${result.runs} attempts` : '';
  const flaky = result.flaky ? '  flaky' : '';
  out.log(`${mark}  ${result.id}${attempts}  (${result.durationMs}ms)${flaky}`);
  if (result.error) out.log(`      error: ${result.error}`);
  // Every check of the representative attempt, built-in, custom or judge,
  // with why a failed one failed.
  for (const check of result.checkResults) {
    out.log(
      `      ${CHECK_MARK[check.status]} ${check.id}: ${check.description.slice(0, 120)}` +
        (check.reason ? `\n           ↳ ${check.reason}` : ''),
    );
  }
}

/** Each question's line: a not-scored one is neither a pass nor a fail. */
const PROGRESS_MARK: Readonly<Record<EvalStatus, string>> = {
  passed: 'PASS',
  failed: 'FAIL',
  'not-scored': 'NOT SCORED',
};

/** Each check's line under its question. */
const CHECK_MARK: Readonly<Record<EvalStatus, string>> = {
  passed: 'pass',
  failed: 'FAIL',
  'not-scored': 'not scored',
};

/**
 * 0 only when no question failed and at least one passed (R154): a
 * judge-only question left unscored is a gap that does not fail the run, and
 * a run with nothing scored does not pass. A flaky question is failed
 * (R211), so it fails the run.
 */
function cliExitCode(results: AssistantEvalCaseResult[]): number {
  const failed = results.some((result) => result.status === 'failed');
  const passed = results.some((result) => result.status === 'passed');
  return !failed && passed ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
