import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { SessionsService } from '../../modules/sessions/sessions.service';
import { KnowledgeService } from '../../modules/knowledge/knowledge.service';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { runAssistantEvals } from './assistant.evals';
import type { AssistantEvalCaseResult } from './assistant.evals';
import { selectCliEvalCases } from './eval-cli-selection';
import { EVAL_SETS, agentForCases, evalTargetFor } from './eval-sets';
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
 * `EVAL_SET` names one set (`world-cup`, `world-cup-rest`, …) or
 * `EVAL_CASES` lists case ids; a run needs exactly one of them (agents.md
 * 8.5).
 *
 * `EVAL_JUDGE` (`off` by default, `on` or `categories`) and
 * `EVAL_JUDGE_CATEGORIES` set the judge option (agents-evals R154). With it
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
        'e.g. EVAL_DATASETS="World Cup Core" EVAL_SET=world-cup npm run evals:assistant',
    );
    process.exitCode = 1;
    return;
  }
  // Pick the questions before booting anything: with no selection every set
  // would run, and the one-fixture preflight refuses that (agents.md 8.5).
  const selection = selectCliEvalCases(process.env, EVAL_SETS);
  if ('error' in selection) {
    console.error(selection.error);
    process.exitCode = 1;
    return;
  }
  // The agent the questions run on: the assistant, or the RFP Builder for
  // EVAL_SET=rfp (agents.md 8.1).
  const agent = agentForCases(selection.caseIds);
  if ('error' in agent) {
    console.error(agent.error);
    process.exitCode = 1;
    return;
  }
  // The judge option, checked before the app boots too (R154).
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
    await runEvals(
      app,
      datasets,
      selection.caseIds,
      agent.agentKey,
      judge.setting,
    );
  } finally {
    await app.close();
  }
}

async function runEvals(
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  datasets: string[],
  caseIds: string[],
  agentKey: string,
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
      // Every check, built-in, custom or judge, with why a failed one failed.
      for (const check of result.checkResults) {
        console.log(
          `      ${CHECK_MARK[check.status]} ${check.id}: ${check.description.slice(0, 120)}` +
            (check.reason ? `\n           ↳ ${check.reason}` : ''),
        );
      }
    },
    caseIds,
    sessions,
    knowledgeBlock,
    evalTargetFor(agentKey, randomUUID()),
    judge,
  );
  // The whole run (answers and tool calls included) for reading failures.
  const resultsFile = process.env['EVAL_RESULTS_FILE'];
  if (resultsFile) writeFileSync(resultsFile, JSON.stringify(results, null, 2));
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

/** Each check's line under its question. */
const CHECK_MARK: Readonly<Record<EvalStatus, string>> = {
  passed: 'pass',
  failed: 'FAIL',
  'not-scored': 'not scored',
};

/**
 * 0 only when no question failed and at least one passed (R154): a
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
