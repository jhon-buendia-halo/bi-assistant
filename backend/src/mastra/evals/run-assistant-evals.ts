import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { SessionsService } from '../../modules/sessions/sessions.service';
import { KnowledgeService } from '../../modules/knowledge/knowledge.service';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { runAssistantEvals } from './assistant.evals';
import { selectCliEvalCases } from './eval-cli-selection';
import { EVAL_SETS, agentForCases, evalTargetFor } from './eval-sets';

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

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    await runEvals(app, datasets, selection.caseIds, agent.agentKey);
  } finally {
    await app.close();
  }
}

async function runEvals(
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  datasets: string[],
  caseIds: string[],
  agentKey: string,
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
  const results = await runAssistantEvals(
    datasets,
    (result) => {
      const mark = result.passed ? 'PASS' : 'FAIL';
      console.log(`${mark}  ${result.id}  (${result.durationMs}ms)`);
      if (result.error) console.log(`      error: ${result.error}`);
      // Every check, built-in, custom or judge, with why a failed one failed.
      for (const check of result.checkResults) {
        const verdict = check.passed ? 'pass' : 'FAIL';
        console.log(
          `      ${verdict} ${check.id}: ${check.description.slice(0, 120)}` +
            (check.reason ? `\n           ↳ ${check.reason}` : ''),
        );
      }
    },
    caseIds,
    sessions,
    knowledgeBlock,
    evalTargetFor(agentKey, randomUUID()),
  );
  // The whole run (answers and tool calls included) for reading failures.
  const resultsFile = process.env['EVAL_RESULTS_FILE'];
  if (resultsFile) writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  const passed = results.filter((result) => result.passed).length;
  console.log(`\n${passed}/${results.length} questions passed`);
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
