/**
 * Writes eval runs into a `logs/` folder — the spending and quality history
 * the improvement loop is steered by — and reads them back for History,
 * Compare and Trend.
 *
 * One JSON file per run plus one append-only NDJSON index, so a run is both
 * readable on its own and greppable as a series. Nothing here talks to the
 * database: a log entry must survive a run whose datastore is a throwaway, and
 * the point of the folder is that it is committed and diffable.
 *
 * Where it lives (`resolveLogDir`): `EVAL_LOG_DIR`, else the checkout's
 * `logs/` (engineering records, committed), else `<APP_DATA_DIR>/logs` (the
 * packaged app, which has no checkout — it used to log nothing at all), else
 * `<cwd>/data/logs` (a standalone backend). Reading merges every one of those
 * that exists (`candidateLogDirs`), so an app started from a checkout lists
 * the CLI's runs too.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join, resolve } from 'path';
import {
  DEFAULT_PRICING,
  isRunLogV2,
  normalizeRunLog,
  type EvalHarness,
  type EvalRunLogRecord,
  type EvalRunLogRecordV2,
  type EvalRunStatus,
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
 * `undefined` and fall through to the app's own data folder rather than
 * scattering files into a user's Applications folder.
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
 * What the log directory is resolved from. Every field defaults to the real
 * process; the parameters exist so the fallback order is unit-testable
 * without moving the test run out of its checkout.
 */
export interface LogDirSources {
  env?: Record<string, string | undefined>;
  /** `null` = "no checkout here". Defaults to `findRepoRoot()`. */
  repoRoot?: string | null;
  cwd?: string;
}

/** Every place a log directory can be, preferred first (existing or not). */
function logDirChain(sources: LogDirSources = {}): string[] {
  const env = sources.env ?? process.env;
  const chain: string[] = [];
  const override = env.EVAL_LOG_DIR?.trim();
  if (override) chain.push(resolve(override));
  const root =
    sources.repoRoot === undefined ? findRepoRoot() : sources.repoRoot;
  if (root) chain.push(join(root, 'logs'));
  const appData = env.APP_DATA_DIR?.trim();
  if (appData) chain.push(join(resolve(appData), 'logs'));
  chain.push(join(resolve(sources.cwd ?? process.cwd()), 'data', 'logs'));
  return chain;
}

/**
 * The `logs/` directory to write into — never undefined, so the packaged app
 * records its runs too. Writing is still best-effort (`writeRunLog`).
 */
export function resolveLogDir(sources?: LogDirSources): string {
  return logDirChain(sources)[0];
}

/**
 * Every log directory that exists, preferred first, each once (symlinks and
 * `/tmp` vs `/private/tmp` collapse to one entry).
 */
export function candidateLogDirs(sources?: LogDirSources): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const dir of logDirChain(sources)) {
    if (!existsSync(dir)) continue;
    let key = dir;
    try {
      key = realpathSync(dir);
    } catch {
      // Keep the unresolved path; a dedupe miss only lists a run twice.
    }
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(dir);
  }
  return dirs;
}

/**
 * Operator-maintained rates. Absent or malformed, the run still logs and cost
 * is simply reported as unknown — a pricing typo must never fail a paid run
 * whose token counts are the thing worth keeping.
 */
export function loadPricing(
  logDir: string | undefined = resolveLogDir(),
): PricingTable {
  if (!logDir) return DEFAULT_PRICING;
  const file = join(logDir, PRICING_FILENAME);
  try {
    if (!existsSync(file)) return DEFAULT_PRICING;
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return DEFAULT_PRICING;
    }
    // `models` wrapper is optional, so the file can carry comments alongside.
    const table = ((parsed as Record<string, unknown>).models ??
      parsed) as Record<string, unknown>;
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
        ...(Number.isFinite(cached)
          ? { cachedInputPerMillionUsd: cached }
          : {}),
      };
    }
    return pricing;
  } catch {
    return DEFAULT_PRICING;
  }
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * `2026-09-22-health-insurance-baseline-fixer-off-1a2b3c4d.json` — date,
 * suite, label, arm (v2), run-id prefix: sortable and legible.
 */
export function runLogFilename(record: EvalRunLogRecord): string {
  const date = record.startedAt.slice(0, 10);
  const parts = [date, slug(record.suite)];
  if (record.label) parts.push(slug(record.label));
  if (isRunLogV2(record) && record.arm) parts.push(slug(record.arm));
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
 * One index line. v1 lines carry the first block only; v2 lines add the
 * pass^k headline so a trend or a history list needs no per-run file read.
 */
export interface RunLogIndexLine {
  runId: string;
  startedAt: string;
  suite: string;
  label?: string;
  harness?: EvalHarness;
  model?: string;
  gitCommit?: string;
  cases: number;
  passed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  file: string;
  // v2 only ↓
  schemaVersion?: 1 | 2;
  repeat?: number;
  arm?: string;
  configHash?: string;
  loopId?: string;
  passK?: number;
  passKRate?: number;
  meanPassRate?: number;
  gaps?: number;
  flaky?: number;
  costPerCorrectUsd?: number;
  status?: EvalRunStatus;
}

function indexLine(record: EvalRunLogRecord): RunLogIndexLine {
  const line: RunLogIndexLine = {
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
  if (!isRunLogV2(record)) return line;
  return {
    ...line,
    schemaVersion: 2,
    repeat: record.repeat,
    arm: record.arm,
    configHash: record.configHash,
    loopId: record.loopId,
    passK: record.summary.passK,
    passKRate: record.summary.passKRate,
    meanPassRate: record.summary.meanPassRate,
    gaps: record.summary.gaps,
    flaky: record.summary.flaky,
    costPerCorrectUsd: record.summary.costPerCorrectUsd,
    status: record.status,
  };
}

/**
 * Persist one run, v1 or v2. Best-effort by design: a full disk or a
 * read-only checkout must not fail a run that has already been paid for, so
 * failures are returned as `undefined` and the caller reports them as a
 * warning.
 *
 * Writing the same run twice (a partial write on abort, then the final one)
 * overwrites its file and appends a second index line; readers keep the last
 * line per run id.
 */
export function writeRunLog(
  record: EvalRunLogRecord,
  logDir: string | undefined = resolveLogDir(),
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
    appendFileSync(indexFile, `${JSON.stringify(indexLine(record))}\n`, 'utf8');
    return { file, indexFile };
  } catch {
    return undefined;
  }
}

/** Every run previously logged in one directory, newest last. */
export function readRunLogIndex(
  logDir: string | undefined = resolveLogDir(),
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

/**
 * A run filename as a caller may pass it — from an API path parameter, so
 * untrusted. Only a bare `*.json` basename is accepted: no separators, no
 * `..`, nothing that could step outside `logs/evals`.
 */
export function safeRunLogFilename(file: string): string | undefined {
  const name = (file ?? '').trim();
  if (!name || name !== basename(name)) return undefined;
  if (name.includes('/') || name.includes('\\') || name.includes('\0'))
    return undefined;
  if (name === '.' || name === '..' || name.startsWith('.')) return undefined;
  if (!name.endsWith('.json')) return undefined;
  return name;
}

/** A run file, normalised, plus the version it was written in. */
function loadRecordFile(
  path: string,
): { record: EvalRunLogRecordV2; version: 1 | 2 } | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as EvalRunLogRecord;
    if (!parsed || typeof parsed !== 'object' || !parsed.runId)
      return undefined;
    return {
      record: normalizeRunLog(parsed),
      version: isRunLogV2(parsed) ? 2 : 1,
    };
  } catch {
    return undefined;
  }
}

function readRecordFile(path: string): EvalRunLogRecordV2 | undefined {
  return loadRecordFile(path)?.record;
}

/**
 * Read one run back in full, by the filename the index carries, as v2
 * (`normalizeRunLog`) whatever version it was written in.
 */
export function readRunLog(
  filename: string,
  logDir: string | undefined = resolveLogDir(),
): EvalRunLogRecordV2 | undefined {
  const name = safeRunLogFilename(filename);
  if (!logDir || !name) return undefined;
  return readRecordFile(join(logDir, RUNS_DIRNAME, name));
}

/** The same, searching every candidate directory in preference order. */
export function readRunLogByFile(
  file: string,
  dirs: string[] = candidateLogDirs(),
): EvalRunLogRecordV2 | undefined {
  const name = safeRunLogFilename(file);
  if (!name) return undefined;
  for (const dir of dirs) {
    const record = readRecordFile(join(dir, RUNS_DIRNAME, name));
    if (record) return record;
  }
  return undefined;
}

/**
 * One run in a history listing: its index line with the pass^k fields always
 * filled in (v1 lines are hydrated from their file), plus where it lives.
 */
export interface RunLogSummary extends RunLogIndexLine {
  schemaVersion: 1 | 2;
  /** Basename under `<dir>/evals/`, the key `readRunLogByFile` takes. */
  file: string;
  /** The `logs/` directory the run was found in. */
  dir: string;
  /** False when the index names a file that is no longer on disk. */
  exists: boolean;
  repeat: number;
  configHash: string;
  passK: number;
  passKRate: number;
  meanPassRate: number;
  gaps: number;
  flaky: number;
  status: EvalRunStatus;
}

function summaryFromRecord(
  record: EvalRunLogRecordV2,
  file: string,
  dir: string,
  schemaVersion: 1 | 2,
): RunLogSummary {
  return {
    ...indexLine(record),
    schemaVersion,
    file,
    dir,
    exists: true,
    repeat: record.repeat,
    configHash: record.configHash,
    passK: record.summary.passK,
    passKRate: record.summary.passKRate,
    meanPassRate: record.summary.meanPassRate,
    gaps: record.summary.gaps,
    flaky: record.summary.flaky,
    costPerCorrectUsd: record.summary.costPerCorrectUsd,
    status: record.status,
  };
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * An index line as a summary. v2 lines are complete; a v1 line (or a v2 line
 * missing fields) is hydrated from its file when the file is there — the v1
 * set is a fixed legacy handful, so the extra reads are bounded — and
 * otherwise derived from the line itself (one draw per case, no GAPs).
 */
function summaryFromLine(
  line: RunLogIndexLine,
  dir: string,
): RunLogSummary | undefined {
  const file = safeRunLogFilename(String(line.file ?? ''));
  if (!file || !line.runId) return undefined;
  const path = join(dir, RUNS_DIRNAME, file);
  const exists = existsSync(path);
  const complete =
    line.schemaVersion === 2 &&
    typeof line.passKRate === 'number' &&
    typeof line.meanPassRate === 'number';
  if (!complete && exists) {
    const loaded = loadRecordFile(path);
    if (loaded)
      return summaryFromRecord(loaded.record, file, dir, loaded.version);
  }
  const cases = num(line.cases, 0);
  const passed = num(line.passed, 0);
  const rate = cases > 0 ? passed / cases : 0;
  return {
    ...line,
    schemaVersion: line.schemaVersion === 2 ? 2 : 1,
    file,
    dir,
    exists,
    repeat: num(line.repeat, 1),
    configHash:
      line.configHash ?? (line.schemaVersion === 2 ? 'unknown' : 'legacy'),
    passK: num(line.passK, passed),
    passKRate: num(line.passKRate, rate),
    meanPassRate: num(line.meanPassRate, rate),
    gaps: num(line.gaps, 0),
    flaky: num(line.flaky, 0),
    status: line.status ?? 'completed',
  };
}

/** Every run in one directory: its index, plus any run file the index lacks. */
function runsInDir(dir: string): RunLogSummary[] {
  const byRunId = new Map<string, RunLogSummary>();
  const indexed = new Set<string>();
  for (const raw of readRunLogIndex(dir)) {
    const summary = summaryFromLine(raw as unknown as RunLogIndexLine, dir);
    if (!summary) continue;
    indexed.add(summary.file);
    // Later lines win: a run written twice (partial, then final) keeps its
    // final state.
    byRunId.set(summary.runId, summary);
  }
  // The index is append-only and best-effort; a missing or partial one must
  // not hide runs whose files are right there.
  let files: string[] = [];
  try {
    files = readdirSync(join(dir, RUNS_DIRNAME));
  } catch {
    files = [];
  }
  for (const entry of files) {
    const file = safeRunLogFilename(entry);
    if (!file || indexed.has(file)) continue;
    const loaded = loadRecordFile(join(dir, RUNS_DIRNAME, file));
    if (!loaded || byRunId.has(loaded.record.runId)) continue;
    byRunId.set(
      loaded.record.runId,
      summaryFromRecord(loaded.record, file, dir, loaded.version),
    );
  }
  return [...byRunId.values()];
}

/**
 * Every logged run across `dirs`, newest first, one entry per run id. When a
 * run appears in more than one directory, the entry whose file exists wins,
 * then the preferred directory.
 */
export function listRunLogs(
  dirs: string[] = candidateLogDirs(),
): RunLogSummary[] {
  const chosen = new Map<string, RunLogSummary>();
  for (const dir of dirs) {
    for (const summary of runsInDir(dir)) {
      const current = chosen.get(summary.runId);
      if (!current || (!current.exists && summary.exists)) {
        chosen.set(summary.runId, summary);
      }
    }
  }
  return [...chosen.values()].sort(
    (a, b) =>
      String(b.startedAt).localeCompare(String(a.startedAt)) ||
      b.file.localeCompare(a.file),
  );
}
