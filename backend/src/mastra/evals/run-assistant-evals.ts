import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import {
  CurrentUserService,
  LOCAL_USER,
} from '../../modules/auth/current-user.service';
import { SessionsService } from '../../modules/sessions/sessions.service';
import { KnowledgeService } from '../../modules/knowledge/knowledge.service';
import { ASSISTANT_EVAL_SETS, runAssistantEvals } from './assistant.evals';
import type { AssistantEvalCaseResult } from './assistant.evals';
import { caseIdsForSet } from './eval-set-files';
import { judgeLabel, judgeSettingFromEnv } from './judge-option';
import type { EvalJudgeSetting } from './judge-option';
import { renderSummaryMarkdown, summarizeEvalResults } from './eval-summary';
import type { EvalStatus } from './eval-summary';

/**
 * CLI entry point for the same suite the Agents → Evals tab runs.
 *
 * The Mastra tools load without Nest DI: `SessionsService.onModuleInit`
 * installs their real implementations and `LlmService` installs the model
 * resolver. Booting an application context gives the eval run the same wiring
 * the app has, without opening an HTTP port.
 *
 * Outside a request nobody is signed in (ADR-0012), so the run is explicitly
 * Demo User's: its throwaway sessions and knowledge are Demo User's own.
 *
 * `EVAL_SET` names one set (`world-cup`, `world-cup-rest`, …) and runs only
 * its questions. Without it every set is selected, as before, which the
 * one-sample rule refuses while the sets span several samples.
 *
 * `EVAL_JUDGE` (`off` by default, `on` or `categories`) and
 * `EVAL_JUDGE_CATEGORIES` set the judge option (agents-evals R153). With it
 * off, judge checks are not scored and no judge call is made.
 */
async function main(): Promise<void> {
  const datasets = (process.env['EVAL_DATASETS'] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  if (datasets.length === 0) {
    console.error(
      'Set EVAL_DATASETS to a comma-separated list of saved dataset names, ' +
        'e.g. EVAL_SET=world-cup EVAL_DATASETS="World Cup" npm run evals:assistant',
    );
    process.exitCode = 1;
    return;
  }

  // Resolved before the app boots, so a mistyped set costs nothing.
  let caseIds: string[] | undefined;
  try {
    caseIds = caseIdsForSet(ASSISTANT_EVAL_SETS, process.env['EVAL_SET']);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  const judge = judgeSettingFromEnv(process.env);
  if ('error' in judge) {
    console.error(judge.error);
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    await app
      .get(CurrentUserService)
      .runAs(LOCAL_USER, () =>
        runAsDemoUser(app, datasets, caseIds, judge.setting),
      );
  } finally {
    await app.close();
  }
}

async function runAsDemoUser(
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  datasets: string[],
  caseIds: string[] | undefined,
  judge: EvalJudgeSetting,
): Promise<void> {
  // Same Nest app the eval-runs.service in-app runner uses, so a throwaway
  // session for create_visual/update_visual works here too — no CLI-only
  // degrade needed.
  const sessions = app.get(SessionsService);
  // Same curated-knowledge block a real chat turn gets from
  // SessionsService.agentContext.
  const knowledgeBlock = await app
    .get(KnowledgeService)
    .definitionBlock(datasets);
  console.log(`Judge: ${judgeLabel(judge)}\n`);
  const results = await runAssistantEvals(
    datasets,
    (result) => {
      const mark = PROGRESS_MARK[result.status];
      console.log(`${mark}  ${result.id}  (${result.durationMs}ms)`);
      if (result.error) console.log(`      error: ${result.error}`);
      for (const [id, score] of Object.entries(result.scores)) {
        console.log(`      ${id}: ${score}`);
      }
    },
    caseIds,
    sessions,
    knowledgeBlock,
    judge,
  );
  const summary = summarizeEvalResults(results);
  console.log(`\n${summary.passed}/${results.length} questions passed`);
  if (summary.notScored > 0) console.log(`Not scored: ${summary.notScored}`);
  console.log(`\n${renderSummaryMarkdown(summary).join('\n')}`);
  process.exitCode = cliExitCode(results);
}

/** Each question's line: a not-scored one is neither a pass nor a fail. */
const PROGRESS_MARK: Readonly<Record<EvalStatus, string>> = {
  passed: 'PASS',
  failed: 'FAIL',
  'not-scored': 'NOT SCORED',
};

/**
 * 0 only when no question failed and at least one passed (R153): a
 * judge-only question left unscored is a gap that does not fail the run, and
 * a run with nothing scored does not pass.
 */
function cliExitCode(results: AssistantEvalCaseResult[]): number {
  const failed = results.some((result) => result.status === 'failed');
  const passed = results.some((result) => result.status === 'passed');
  return !failed && passed ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
