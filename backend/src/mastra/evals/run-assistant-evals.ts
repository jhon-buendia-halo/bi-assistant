import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { SessionsService } from '../../modules/sessions/sessions.service';
import { KnowledgeService } from '../../modules/knowledge/knowledge.service';
import { runAssistantEvals } from './assistant.evals';

/**
 * CLI entry point for the same suite the Agents → Evals tab runs.
 *
 * The Mastra tools load without Nest DI: `SessionsService.onModuleInit`
 * installs their real implementations and `LlmService` installs the model
 * resolver. Booting an application context gives the eval run the same wiring
 * the app has, without opening an HTTP port.
 */
async function main(): Promise<void> {
  const datasets = (process.env['EVAL_DATASETS'] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  if (datasets.length === 0) {
    console.error(
      'Set EVAL_DATASETS to a comma-separated list of saved dataset names, ' +
        'e.g. EVAL_DATASETS="World Cup Core" npm run evals:assistant',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
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
        for (const [id, score] of Object.entries(result.scores)) {
          console.log(`      ${id}: ${score}`);
        }
      },
      undefined,
      sessions,
      knowledgeBlock,
    );
    const passed = results.filter((result) => result.passed).length;
    console.log(`\n${passed}/${results.length} questions passed`);
    process.exitCode = passed === results.length ? 0 : 1;
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
