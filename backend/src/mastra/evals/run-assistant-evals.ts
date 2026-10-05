import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { SessionsService } from '../../modules/sessions/sessions.service';
import { getDatasetToolServices } from '../tool-services';
import {
  agentModelId,
  lastAgentModelId,
  resolveAgentModel,
} from '../model-resolver';
import {
  mergeEngineOverrides,
  runAssistantEvals,
  sumSidePassUsage,
} from './assistant.evals';
import type { EvalCaseOutcome } from './assistant.evals';
import { DEFAULT_SUITE_ID } from './suite-loader';
import {
  parseEngineOverride,
  resolveEngineOptions,
} from '../../modules/engine/engine-options';
import type { EngineOptions } from '../../modules/engine/engine-options';
import { summarizeCases } from '../../modules/agents/eval-telemetry';
import type { EvalRunStatus } from '../../modules/agents/eval-telemetry';
import { buildRunLogRecordV2 } from '../../modules/agents/eval-run-record';
import { loadPricing, writeRunLog } from '../../modules/agents/eval-run-log';

/**
 * CLI entry point for the same suite the Agents → Evals tab runs, through
 * the same parity harness (`runAssistantEvalCaseRepeated` → `runTurn`).
 *
 * The Mastra tools load without Nest DI: `SessionsService.onModuleInit`
 * installs their real implementations and `LlmService` installs the model
 * resolver. Booting an application context gives the eval run the same wiring
 * the app has, without opening an HTTP port.
 *
 * Environment:
 * - `EVAL_DATASETS` (required) — comma-separated saved dataset names.
 * - `EVAL_SUITE` — suite id (default `world-cup`).
 * - `EVAL_REPEAT` — attempts per case, pass^k (default 1).
 * - `EVAL_ARM` — an `ARM_PRESETS` name or `custom:{json}`.
 * - `EVAL_ENGINE` — lever overrides over the arm, `sqlRepair=false,careful=auto`.
 * - `EVAL_INCLUDE_VARIANTS=1` — also run each case's paraphrases.
 * - `EVAL_TIMEOUT_MS` — per-attempt budget (default 300000).
 * - `EVAL_LABEL` — the run log's label (default `evals:assistant`).
 *
 * Every run writes a v2 run log (`logs/evals/runs/`), also when it fails or
 * is stopped with Ctrl-C — a paid run's token counts are worth keeping.
 */
function parseRepeat(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  if (!text) return 1;
  const repeat = Number(text);
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(`EVAL_REPEAT must be a positive integer, got "${text}"`);
  }
  return repeat;
}

async function main(): Promise<void> {
  const datasets = (process.env['EVAL_DATASETS'] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const suiteId = (process.env['EVAL_SUITE'] ?? '').trim() || DEFAULT_SUITE_ID;
  const arm = (process.env['EVAL_ARM'] ?? '').trim() || undefined;
  const engineText = (process.env['EVAL_ENGINE'] ?? '').trim();
  const includeVariants = /^(1|true|yes)$/i.test(
    (process.env['EVAL_INCLUDE_VARIANTS'] ?? '').trim(),
  );
  const label = (process.env['EVAL_LABEL'] ?? '').trim() || 'evals:assistant';

  if (datasets.length === 0) {
    console.error(
      'Set EVAL_DATASETS to a comma-separated list of saved dataset names, ' +
        'e.g. EVAL_DATASETS="World Cup Core" npm run evals:assistant',
    );
    process.exitCode = 1;
    return;
  }
  // Fail on a typo before booting anything, let alone spending a token.
  const repeat = parseRepeat(process.env['EVAL_REPEAT']);
  const overrides = engineText ? parseEngineOverride(engineText) : undefined;
  const merged = mergeEngineOverrides(arm, overrides);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const stop = new AbortController();
  const onSigint = () => {
    if (stop.signal.aborted) process.exit(130);
    console.log('\nStopping after the current attempt… (Ctrl-C again to quit)');
    stop.abort();
  };
  process.on('SIGINT', onSigint);

  const startedAt = new Date().toISOString();
  const outcomes: EvalCaseOutcome[] = [];
  let status: EvalRunStatus = 'completed';
  let error: string | undefined;
  const pricing = loadPricing();
  // Resolved once up front (settings only, no model call) so each case can
  // be priced as it lands; `lastAgentModelId()` would still be empty here.
  const pricedModel = await resolveAgentModel()
    .then(agentModelId)
    .catch(() => undefined);
  try {
    const sessions = app.get(SessionsService);
    console.log(
      `Suite ${suiteId} · repeat ${repeat}${arm ? ` · arm ${arm}` : ''}${
        engineText ? ` · engine ${engineText}` : ''
      }`,
    );
    await runAssistantEvals(
      datasets,
      undefined,
      undefined,
      sessions,
      undefined,
      suiteId,
      {
        repeat,
        ...(arm ? { arm } : {}),
        ...(overrides ? { engine: overrides } : {}),
        includeVariants,
        abortSignal: stop.signal,
        pricing: { model: pricedModel, table: pricing },
        onOutcome: (outcome) => {
          outcomes.push(outcome);
          const { logCase, result } = outcome;
          const tally = repeat > 1 ? ` ${logCase.passes}/${logCase.runs}` : '';
          const flags = [
            logCase.flaky ? 'flaky' : '',
            logCase.failureLabel ? `[${logCase.failureLabel}]` : '',
          ]
            .filter(Boolean)
            .join(' ');
          console.log(
            `${logCase.verdict.padEnd(5)} ${logCase.id}${tally}${
              flags ? `  ${flags}` : ''
            }  (${logCase.durationMs}ms)`,
          );
          if (result.error) console.log(`      error: ${result.error}`);
          for (const check of result.checkResults) {
            if (check.passed) continue;
            console.log(
              `      ${check.gap ? 'gap ' : ''}${check.id}: ${check.reason ?? 'failed'}`,
            );
          }
        },
      },
    );
    if (stop.signal.aborted) status = 'aborted';
  } catch (err) {
    status = stop.signal.aborted ? 'aborted' : 'failed';
    error = err instanceof Error ? err.message : String(err);
    console.error(error);
  } finally {
    process.off('SIGINT', onSigint);
    const cases = outcomes.map((outcome) => outcome.logCase);
    const first = outcomes.find((outcome) => outcome.engine);
    const engine: EngineOptions =
      first?.engine ?? resolveEngineOptions({}, merged);
    const sidePassUsage = sumSidePassUsage(
      outcomes.map((outcome) => outcome.sidePassUsage),
    );
    const kind = await getDatasetToolServices()
      .getDatasets(datasets)
      .then(
        (snapshots) => snapshots.find((s) => s.datasourceKind)?.datasourceKind,
      )
      .catch(() => undefined);
    const model = lastAgentModelId() ?? pricedModel;
    const judgeModel = outcomes.find(
      (outcome) => outcome.judgeModel,
    )?.judgeModel;
    const written = writeRunLog(
      buildRunLogRecordV2({
        runId: randomUUID(),
        label,
        harness: 'in-app',
        suite: suiteId,
        datasets,
        ...(kind
          ? {
              datasourceKind: kind,
              // REST datasources are queried as SQLite.
              dialect: kind === 'rest' ? 'sqlite' : kind,
            }
          : {}),
        ...(model ? { model } : {}),
        ...(engine.reasoningEffort
          ? { reasoningEffort: engine.reasoningEffort }
          : {}),
        ...(judgeModel ? { judgeModel } : {}),
        repeat,
        ...(arm ? { arm } : {}),
        engine,
        configHash: first?.configHash ?? 'unknown',
        startedAt,
        finishedAt: new Date().toISOString(),
        cases,
        pricing,
        status,
        ...(error ? { error } : {}),
        ...(Object.keys(sidePassUsage).length ? { sidePassUsage } : {}),
      }),
    );

    const summary = summarizeCases(cases);
    console.log(
      `\npass^${repeat}: ${summary.passK}/${summary.scored} scored cases ` +
        `(${Math.round(summary.passKRate * 100)}%) · mean pass rate ` +
        `${Math.round(summary.meanPassRate * 100)}% · flaky ${summary.flaky} · gaps ${summary.gaps}` +
        (status !== 'completed' ? ` · run ${status}` : ''),
    );
    console.log(
      written ? `Run log: ${written.file}` : 'Run log could not be written.',
    );
    // Green only when something was measured and nothing measured failed:
    // a gap is the harness's problem, an all-gap run measured nothing.
    const failed = cases.some(
      (item) => item.verdict === 'FAIL' || item.verdict === 'ERROR',
    );
    process.exitCode =
      status === 'completed' && !failed && summary.scored > 0 ? 0 : 1;
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
