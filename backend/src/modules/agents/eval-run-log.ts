/**
 * Writes eval runs into the repository's `logs/` folder — the spending and
 * quality history the improvement loop is steered by.
 *
 * One JSON file per run plus one append-only NDJSON index, so a run is both
 * readable on its own and greppable as a series. Nothing here talks to the
 * database: a log entry must survive a run whose datastore is a throwaway, and
 * the point of the folder is that it is committed and diffable.
 *
 * The folder lives at the repo root (next to `backend/` and `frontend/`), not
 * in `APP_DATA_DIR` — these are engineering records, not user data.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import {
  DEFAULT_PRICING,
  type EvalRunLogRecord,
  type PricingTable,
} from './eval-telemetry';

/** Subfolder of `logs/` holding one JSON file per run. */
const RUNS_DIRNAME = 'evals';
/** Append-only one-line-per-run index, for `jq` and for quick greps. */
const INDEX_FILENAME = 'index.ndjson';
const PRICING_FILENAME = 'pricing.json';

/**
 * Locate the repo root by walking up for the marker that only the root has.
 * Works from `backend/` under ts-node, from `backend/dist/...` after a build,
 * and from the packaged app's resources — where no repo exists, so callers get
 * `undefined` and skip logging rather than scattering files into a user's
 * Applications folder.
 */
export function findRepoRoot(startDir = __dirname): string | undefined {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 12; depth++) {
    const hasBoth =
      existsSync(join(dir, 'backend', 'package.json')) &&
      existsSync(join(dir, 'docker-compose.yml'));
    if (hasBoth) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * The `logs/` directory to write into. `EVAL_LOG_DIR` overrides it, so a run
 * from the packaged app or CI can still record somewhere writable.
 */
export function resolveLogDir(): string | undefined {
  const override = process.env.EVAL_LOG_DIR?.trim();
  if (override) return resolve(override);
  const root = findRepoRoot();
  return root ? join(root, 'logs') : undefined;
}

/**
 * Operator-maintained rates. Absent or malformed, the run still logs and cost
 * is simply reported as unknown — a pricing typo must never fail a paid run
 * whose token counts are the thing worth keeping.
 */
export function loadPricing(logDir = resolveLogDir()): PricingTable {
  if (!logDir) return DEFAULT_PRICING;
  const file = join(logDir, PRICING_FILENAME);
  try {
    if (!existsSync(file)) return DEFAULT_PRICING;
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return DEFAULT_PRICING;
    }
    // `models` wrapper is optional, so the file can carry comments alongside.
    const table = ((parsed as Record<string, unknown>).models ?? parsed) as Record<
      string,
      unknown
    >;
    const pricing: PricingTable = {};
    for (const [model, value] of Object.entries(table)) {
      if (!value || typeof value !== 'object') continue;
      const rate = value as Record<string, unknown>;
      const input = Number(rate.inputPerMillionUsd);
      const output = Number(rate.outputPerMillionUsd);
      if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
      const cached = Number(rate.cachedInputPerMillionUsd);
      pricing[model.toLowerCase()] = {
        inputPerMillionUsd: input,
        outputPerMillionUsd: output,
        ...(Number.isFinite(cached) ? { cachedInputPerMillionUsd: cached } : {}),
      };
    }
    return pricing;
  } catch {
    return DEFAULT_PRICING;
  }
}

/** `2026-09-22-health-insurance-baseline-1a2b3c4d.json` — sortable and legible. */
export function runLogFilename(record: EvalRunLogRecord): string {
  const date = record.startedAt.slice(0, 10);
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const parts = [date, slug(record.suite)];
  if (record.label) parts.push(slug(record.label));
  parts.push(record.runId.slice(0, 8));
  return `${parts.filter(Boolean).join('-')}.json`;
}

export interface WrittenRunLog {
  /** Absolute path of the per-run JSON file. */
  file: string;
  /** Absolute path of the NDJSON index the run was appended to. */
  indexFile: string;
}

/**
 * Persist one run. Best-effort by design: a full disk or a read-only checkout
 * must not fail a run that has already been paid for, so failures are returned
 * as `undefined` and the caller reports them as a warning.
 */
export function writeRunLog(
  record: EvalRunLogRecord,
  logDir = resolveLogDir(),
): WrittenRunLog | undefined {
  if (!logDir) return undefined;
  try {
    const runsDir = join(logDir, RUNS_DIRNAME);
    mkdirSync(runsDir, { recursive: true });
    const file = join(runsDir, runLogFilename(record));
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

    // The index carries only what a trend line needs, so it stays readable
    // after hundreds of runs.
    const indexFile = join(runsDir, INDEX_FILENAME);
    const summary = {
      runId: record.runId,
      startedAt: record.startedAt,
      suite: record.suite,
      label: record.label,
      harness: record.harness,
      model: record.model,
      gitCommit: record.gitCommit,
      cases: record.totals.cases,
      passed: record.totals.passed,
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      totalTokens: record.usage.totalTokens,
      estimatedCostUsd: record.estimatedCostUsd,
      file: runLogFilename(record),
    };
    appendFileSync(indexFile, `${JSON.stringify(summary)}\n`, 'utf8');
    return { file, indexFile };
  } catch {
    return undefined;
  }
}

/** Every run previously logged, newest last. Used to diff against a baseline. */
export function readRunLogIndex(
  logDir = resolveLogDir(),
): Record<string, unknown>[] {
  if (!logDir) return [];
  const indexFile = join(logDir, RUNS_DIRNAME, INDEX_FILENAME);
  try {
    if (!existsSync(indexFile)) return [];
    return readFileSync(indexFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Read one run back in full, by the filename the index carries. */
export function readRunLog(
  filename: string,
  logDir = resolveLogDir(),
): EvalRunLogRecord | undefined {
  if (!logDir) return undefined;
  try {
    const file = join(logDir, RUNS_DIRNAME, filename);
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, 'utf8')) as EvalRunLogRecord;
  } catch {
    return undefined;
  }
}
