/**
 * Builds run-log v2 records — the one place a case's attempts are folded into
 * a verdict and a run's cases into totals, a pass^k summary and a price.
 *
 * Two harnesses write run logs (the in-app runner in `eval-runs.service.ts`
 * and the CLI in `scripts/run-eval.ts`). Before this module each assembled
 * its own record, which is how the two drifted: the CLI logged `runs`/
 * `passes` as extra keys the in-app runner never wrote. Both now call these
 * builders, so a CLI run and an in-app run of the same suite produce records
 * that compare field for field in History → Compare.
 *
 * Pure apart from `runEnvironment` (reads `package.json` and asks git for the
 * commit) — everything else unit-tests without a database or a model.
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { EngineOptions } from '../engine/engine-options';
import type { SidePass } from '../sessions/turn-result';
import { findRepoRoot } from './eval-run-log';
import {
  estimateCostUsd,
  foldAttempts,
  isUsageUnobserved,
  sumUsage,
  summarizeCases,
  tallyCategories,
  type EvalDifficulty,
  type EvalHarness,
  type EvalRunLogAttempt,
  type EvalRunLogCaseV2,
  type EvalRunLogRecordV2,
  type EvalRunStatus,
  type PricingTable,
  type TokenUsage,
} from './eval-telemetry';

/** What a case is, independent of how it went. */
export interface LogCaseMeta {
  id: string;
  category?: string;
  question?: string;
  difficulty?: EvalDifficulty;
  variantOf?: string;
}

/**
 * One case's attempts folded into its v2 log entry: pass^k verdict
 * (`foldAttempts`), summed usage and — when the model has a rate — its
 * estimated cost. `reason` is the first failing check of the representative
 * attempt, so a log stays greppable by *why* without opening every attempt.
 */
export function buildLogCase(
  meta: LogCaseMeta,
  attempts: EvalRunLogAttempt[],
  pricing?: { model?: string; table: PricingTable },
): EvalRunLogCaseV2 {
  const folded = foldAttempts(attempts);
  const usage = sumUsage(attempts.map((attempt) => attempt.usage));
  const observed = !isUsageUnobserved(usage);
  const representative =
    attempts.find((attempt) => attempt.verdict !== 'PASS') ?? attempts[0];
  const firstFailedCheck = representative?.checks.find(
    (check) => !check.passed,
  );
  const reason =
    representative?.verdict === 'ERROR'
      ? 'run-error'
      : representative?.verdict === 'PASS'
        ? undefined
        : firstFailedCheck?.id;
  const cost =
    observed && pricing
      ? estimateCostUsd(pricing.model, usage, pricing.table)
      : undefined;
  return {
    id: meta.id,
    ...(meta.category ? { category: meta.category } : {}),
    ...(meta.question ? { question: meta.question } : {}),
    ...(meta.difficulty ? { difficulty: meta.difficulty } : {}),
    ...(meta.variantOf ? { variantOf: meta.variantOf } : {}),
    ...folded,
    ...(reason ? { reason } : {}),
    durationMs: attempts.reduce(
      (total, attempt) => total + attempt.durationMs,
      0,
    ),
    ...(observed ? { usage } : {}),
    ...(cost !== undefined ? { estimatedCostUsd: cost } : {}),
    attempts,
  };
}

export interface RunRecordInput {
  runId: string;
  label?: string;
  harness: EvalHarness;
  suite: string;
  agentKey?: string;
  datasets: string[];
  datasourceKind?: 'postgres' | 'databricks' | 'rest';
  dialect?: string;
  model?: string;
  reasoningEffort?: string;
  judgeModel?: string;
  repeat: number;
  arm?: string;
  engine: EngineOptions;
  configHash: string;
  loopId?: string;
  startedAt: string;
  finishedAt: string;
  cases: EvalRunLogCaseV2[];
  /** Cases selected but never reached (the run failed or was aborted partway). */
  notReached?: number;
  pricing: PricingTable;
  status: EvalRunStatus;
  error?: string;
  sidePassUsage?: Partial<Record<SidePass, TokenUsage>>;
  comparedToRunId?: string;
  regressions?: string[];
  improvements?: string[];
  flakyChanges?: string[];
  /** Defaults to `runEnvironment()`; tests pass a fixed value. */
  environment?: { appVersion?: string; gitCommit?: string };
}

/**
 * A complete v2 record. Money follows the telemetry rules: tokens are
 * measured, cost is estimated from the operator's `pricing.json`, an
 * unpriced model yields no cost at all, and `costIncomplete` marks a run
 * whose usage was observed but could not be priced.
 */
export function buildRunLogRecordV2(input: RunRecordInput): EvalRunLogRecordV2 {
  const cases = input.cases;
  const usage = sumUsage(cases.map((item) => item.usage));
  const estimated = estimateCostUsd(input.model, usage, input.pricing);
  const count = (verdict: EvalRunLogCaseV2['verdict']) =>
    cases.filter((item) => item.verdict === verdict).length;
  const environment = input.environment ?? runEnvironment();
  return {
    schemaVersion: 2,
    runId: input.runId,
    ...(input.label ? { label: input.label } : {}),
    harness: input.harness,
    suite: input.suite,
    ...(input.agentKey ? { agentKey: input.agentKey } : {}),
    datasets: input.datasets,
    ...(input.datasourceKind ? { datasourceKind: input.datasourceKind } : {}),
    ...(input.dialect ? { dialect: input.dialect } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.reasoningEffort
      ? { reasoningEffort: input.reasoningEffort }
      : {}),
    ...(input.judgeModel ? { judgeModel: input.judgeModel } : {}),
    repeat: input.repeat,
    ...(input.arm ? { arm: input.arm } : {}),
    engine: input.engine,
    configHash: input.configHash,
    ...(input.loopId ? { loopId: input.loopId } : {}),
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: Math.max(
      0,
      new Date(input.finishedAt).getTime() -
        new Date(input.startedAt).getTime(),
    ),
    ...(environment.appVersion ? { appVersion: environment.appVersion } : {}),
    ...(environment.gitCommit ? { gitCommit: environment.gitCommit } : {}),
    totals: {
      cases: cases.length + (input.notReached ?? 0),
      passed: count('PASS'),
      failed: count('FAIL'),
      errored: count('ERROR'),
      gaps: count('GAP'),
      skipped: count('SKIP') + (input.notReached ?? 0),
    },
    summary: summarizeCases(cases, estimated),
    categories: tallyCategories(cases),
    usage,
    ...(input.sidePassUsage ? { sidePassUsage: input.sidePassUsage } : {}),
    ...(estimated !== undefined ? { estimatedCostUsd: estimated } : {}),
    ...(estimated === undefined && usage.calls > 0
      ? { costIncomplete: true }
      : {}),
    cases,
    ...(input.comparedToRunId
      ? { comparedToRunId: input.comparedToRunId }
      : {}),
    ...(input.regressions ? { regressions: input.regressions } : {}),
    ...(input.improvements ? { improvements: input.improvements } : {}),
    ...(input.flakyChanges ? { flakyChanges: input.flakyChanges } : {}),
    status: input.status,
    ...(input.error ? { error: input.error } : {}),
  };
}

/**
 * The app version and commit a run was produced by. `frontend/package.json`
 * is the release's single source of truth (CLAUDE.md), read from the
 * checkout; a packaged app has no checkout, so it falls back to the backend
 * `package.json` shipped beside `dist/` (kept in lockstep). The commit is
 * absent outside a git checkout — never guessed.
 */
export function runEnvironment(): { appVersion?: string; gitCommit?: string } {
  const root = findRepoRoot();
  const candidates = [
    ...(root ? [join(root, 'frontend', 'package.json')] : []),
    join(__dirname, '..', '..', '..', 'package.json'),
  ];
  let appVersion: string | undefined;
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
        version?: unknown;
      };
      if (typeof pkg.version === 'string') {
        appVersion = pkg.version;
        break;
      }
    } catch {
      // A malformed package.json must not fail a paid run's log.
    }
  }
  let gitCommit: string | undefined;
  if (root) {
    try {
      gitCommit =
        execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || undefined;
    } catch {
      gitCommit = undefined;
    }
  }
  return {
    ...(appVersion ? { appVersion } : {}),
    ...(gitCommit ? { gitCommit } : {}),
  };
}
