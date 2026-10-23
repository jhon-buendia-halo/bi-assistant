/**
 * Reads the eval runs the improvement-loop tools compare and export
 * (agents-evals R224, R225, R228): a run id, whole or its first 8 characters,
 * read without writing from `app.sqlite` in a data directory; or an exported
 * run file, which is a run record (`EVAL_RUN_FILE`), a poll response of
 * endpoint 38, or a bare results array (`EVAL_RESULTS_FILE`).
 *
 * Every run comes back in one shape, `LoopRun`, read with the read-time
 * defaults of data-model 3.8: a missing judge option is `on`, missing repeats
 * are 1, a status comes from the `passed` flag, a result is its own one
 * attempt. A result's missing split and category come from the question bank
 * case with its id (the case index), else `dev` and `uncategorised`.
 *
 * The record shapes are those of data-model 3.8 and api.md 2.6, read
 * defensively: the tools must read runs saved before BA-242 and BA-184 too.
 *
 * No Nest, no Mastra, no model.
 */
import BetterSqlite3 from 'better-sqlite3';
import { existsSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';
import { evalCaseIndex } from '../eval-case-index';
import type { EvalCaseIndexEntry } from '../eval-case-index';
import type { EvalSplit } from '../eval-set-files';
import { costOf, mergeUsage, PRICE_TABLE } from '../eval-usage';
import type { ModelRate, ModelUsageEntry } from '../eval-usage';
import { LoopInputError, resolveUserPath } from './cli-args';

export type EvalStatus = 'passed' | 'failed' | 'not-scored';

/** The category of a result with none, and of a case defined in code. */
export const UNCATEGORISED = 'uncategorised';

export interface LoopToolCall {
  name: string;
  input?: string;
  output?: string;
  error?: string;
}

export interface LoopCheck {
  id: string;
  description: string;
  status: EvalStatus;
  reason?: string;
  criterion?: string;
}

/** One attempt of a question (R210); a one-attempt result is its own. */
export interface LoopAttempt {
  attempt: number;
  status: EvalStatus;
  checks: LoopCheck[];
  answer: string;
  toolCalls: LoopToolCall[];
  error?: string;
}

export interface LoopResult {
  id: string;
  question: string;
  category: string;
  split: EvalSplit;
  /** The set the case belongs to, from the case index, when known. */
  setId?: string;
  /** The verdict over every attempt (pass^k, R211). */
  status: EvalStatus;
  passes: number;
  runs: number;
  flaky: boolean;
  /** Every attempt in order; one entry when the run asked once. */
  attempts: LoopAttempt[];
  /** The representative attempt's number: the first failed, else 1. */
  representative: number;
  /** The representative attempt's checks, answer, tool calls and error. */
  checks: LoopCheck[];
  answer: string;
  toolCalls: LoopToolCall[];
  error?: string;
  usage?: ModelUsageEntry[];
  /** Dollars; null when not priced; absent when not recorded. */
  costUsd?: number | null;
}

export interface LoopJudge {
  mode: 'off' | 'on' | 'categories';
  categories?: string[];
}

export interface LoopRun {
  /** How the run is named in output: its 8-character id, else its file. */
  label: string;
  jobId?: string;
  /** The file it was read from, when it was. */
  file?: string;
  agentKey?: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  /** The router id its agent ran on; absent on a results array. */
  model?: string;
  repeats: number;
  /** Absent on a results array, which does not record it. */
  judge?: LoopJudge;
  source?: 'app' | 'cli';
  datasets: string[];
  results: LoopResult[];
  usage?: ModelUsageEntry[];
  costUsd?: number | null;
  rates?: Record<string, ModelRate>;
}

/** What a run or a side of runs cost (R218, R221). */
export type LoopCost =
  | { kind: 'usd'; usd: number }
  | { kind: 'not-priced'; models: string[] }
  | { kind: 'not-recorded' };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function statusOf(raw: Json): EvalStatus {
  const status = raw.status;
  if (status === 'passed' || status === 'failed' || status === 'not-scored') {
    return status;
  }
  return raw.passed === true ? 'passed' : 'failed';
}

function readChecks(raw: unknown): LoopCheck[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).map((check) => ({
    id: str(check.id) ?? 'check',
    description: str(check.description) ?? '',
    status: statusOf(check),
    ...(str(check.reason) ? { reason: str(check.reason) } : {}),
    ...(str(check.criterion) ? { criterion: str(check.criterion) } : {}),
  }));
}

function readToolCalls(raw: unknown): LoopToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).map((call) => ({
    name: str(call.name) ?? 'unknown',
    ...(str(call.input) !== undefined ? { input: str(call.input) } : {}),
    ...(str(call.output) !== undefined ? { output: str(call.output) } : {}),
    ...(str(call.error) !== undefined ? { error: str(call.error) } : {}),
  }));
}

function readAttempt(raw: Json, attempt: number): LoopAttempt {
  return {
    attempt: num(raw.attempt) ?? attempt,
    status: statusOf(raw),
    checks: readChecks(raw.checkResults),
    answer: str(raw.answer) ?? '',
    toolCalls: readToolCalls(raw.toolCalls),
    ...(str(raw.error) ? { error: str(raw.error) } : {}),
  };
}

function readUsageList(raw: unknown): ModelUsageEntry[] | undefined {
  return Array.isArray(raw)
    ? (raw.filter(isObject) as unknown as ModelUsageEntry[])
    : undefined;
}

function readCost(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  return num(raw);
}

/**
 * One stored result as a `LoopResult`, with the read-time defaults of
 * data-model 3.8 and the split and category of the case index (R224).
 */
export function readResult(
  raw: Json,
  index: ReadonlyMap<string, EvalCaseIndexEntry> = evalCaseIndex(),
): LoopResult {
  const id = str(raw.id) ?? '';
  const known = index.get(id);
  const status = statusOf(raw);
  const stored = Array.isArray(raw.attempts)
    ? raw.attempts.filter(isObject)
    : [];
  const attempts =
    stored.length > 0
      ? stored.map((attempt, i) => readAttempt(attempt, i + 1))
      : [readAttempt({ ...raw, status }, 1)];
  const runs = num(raw.runs) ?? attempts.length;
  const passes =
    num(raw.passes) ?? attempts.filter((a) => a.status === 'passed').length;
  const firstFailed = attempts.find((a) => a.status === 'failed');
  const representative = (firstFailed ?? attempts[0]).attempt;
  const split =
    raw.split === 'dev' || raw.split === 'held-out'
      ? raw.split
      : (known?.split ?? 'dev');
  const usage = readUsageList(raw.usage);
  const costUsd = readCost(raw.costUsd);
  return {
    id,
    question: str(raw.question) ?? known?.question ?? '',
    category: str(raw.category) ?? known?.category ?? UNCATEGORISED,
    split,
    ...(known ? { setId: known.setId } : {}),
    status,
    passes,
    runs,
    flaky: raw.flaky === true,
    attempts,
    representative,
    checks: readChecks(raw.checkResults),
    answer: str(raw.answer) ?? '',
    toolCalls: readToolCalls(raw.toolCalls),
    ...(str(raw.error) ? { error: str(raw.error) } : {}),
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

function readJudge(raw: unknown): LoopJudge {
  if (!isObject(raw)) return { mode: 'on' };
  const mode =
    raw.mode === 'off' || raw.mode === 'categories' ? raw.mode : 'on';
  const categories = Array.isArray(raw.categories)
    ? raw.categories.filter((c): c is string => typeof c === 'string')
    : undefined;
  return mode === 'categories' && categories ? { mode, categories } : { mode };
}

/** A run record (or a poll response without `ok` and `message`). */
export function readRunRecord(
  raw: Json,
  file?: string,
  index: ReadonlyMap<string, EvalCaseIndexEntry> = evalCaseIndex(),
): LoopRun {
  const jobId = str(raw.jobId) ?? '';
  const results = (Array.isArray(raw.results) ? raw.results : [])
    .filter(isObject)
    .map((result) => readResult(result, index));
  const usage = readUsageList(raw.usage);
  const costUsd = readCost(raw.costUsd);
  const repeats = num(raw.repeats);
  return {
    label: jobId.slice(0, 8),
    jobId,
    ...(file ? { file } : {}),
    ...(str(raw.agentKey) ? { agentKey: str(raw.agentKey) } : {}),
    ...(str(raw.status) ? { status: str(raw.status) } : {}),
    ...(str(raw.startedAt) ? { startedAt: str(raw.startedAt) } : {}),
    ...(str(raw.finishedAt) ? { finishedAt: str(raw.finishedAt) } : {}),
    ...(str(raw.model) ? { model: str(raw.model) } : {}),
    repeats: repeats === 3 || repeats === 5 ? repeats : 1,
    judge: readJudge(raw.judge),
    source: raw.source === 'cli' ? 'cli' : 'app',
    datasets: Array.isArray(raw.datasets)
      ? raw.datasets.filter((d): d is string => typeof d === 'string')
      : [],
    results,
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(isObject(raw.rates)
      ? { rates: raw.rates as Record<string, ModelRate> }
      : {}),
  };
}

/**
 * A results array as `EVAL_RESULTS_FILE` writes it: no run id, model, judge
 * option or repeats; its repeats are its results' `runs`, else 1 (R224).
 */
export function readResultsArray(
  raw: unknown[],
  file: string,
  index: ReadonlyMap<string, EvalCaseIndexEntry> = evalCaseIndex(),
): LoopRun {
  const results = raw
    .filter(isObject)
    .map((result) => readResult(result, index));
  const runs = results.map((r) => r.runs).find((n) => n > 1);
  return {
    label: basename(file),
    file,
    repeats: runs ?? 1,
    datasets: [],
    results,
  };
}

/** Read the content of an exported run file, whatever its shape (R224). */
export function runFromFileContent(
  content: unknown,
  file: string,
  index: ReadonlyMap<string, EvalCaseIndexEntry> = evalCaseIndex(),
): LoopRun {
  const notARun = new LoopInputError(
    `${file} is not an eval run: expected a run record, a poll response or a results array`,
  );
  if (Array.isArray(content)) {
    if (!content.every((r) => isObject(r) && typeof r.id === 'string')) {
      throw notARun;
    }
    return readResultsArray(content, file, index);
  }
  if (!isObject(content)) throw notARun;
  if (content.ok === false) {
    throw new LoopInputError(
      `${file}: ${str(content.message) ?? 'the poll was refused'}`,
    );
  }
  if (typeof content.jobId !== 'string' || !Array.isArray(content.results)) {
    throw notARun;
  }
  // A poll response is the run record with `ok` and `message` added.
  const record: Json = { ...content };
  delete record.ok;
  delete record.message;
  return readRunRecord(record, file, index);
}

/** Read an exported run file. */
export function readRunFile(
  path: string,
  index: ReadonlyMap<string, EvalCaseIndexEntry> = evalCaseIndex(),
): LoopRun {
  let content: unknown;
  try {
    content = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new LoopInputError(
      `${path} is not an eval run: expected a run record, a poll response or a results array`,
    );
  }
  return runFromFileContent(content, path, index);
}

/**
 * The run with id `id` (whole, or a prefix such as the 8 characters a report
 * file name carries) in `<dataDir>/app.sqlite`, opened read-only.
 */
export function readRunFromDb(
  dataDir: string,
  id: string,
  index: ReadonlyMap<string, EvalCaseIndexEntry> = evalCaseIndex(),
): LoopRun {
  const dbPath = join(dataDir, 'app.sqlite');
  const unknown = new LoopInputError(`No eval run "${id}" in ${dbPath}`);
  if (!existsSync(dbPath)) throw unknown;
  let docs: string[];
  const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  try {
    docs = (
      db
        .prepare(
          `SELECT doc FROM eval_runs WHERE substr(json_extract(doc, '$.jobId'), 1, ?) = ?`,
        )
        .all(id.length, id) as { doc: string }[]
    ).map((row) => row.doc);
  } catch {
    // A data directory whose app never saved a run has no eval_runs table.
    throw unknown;
  } finally {
    db.close();
  }
  const records = docs
    .map((doc) => JSON.parse(doc) as unknown)
    .filter(isObject);
  const exact = records.find((record) => record.jobId === id);
  if (exact) return readRunRecord(exact, undefined, index);
  if (records.length === 0) throw unknown;
  if (records.length > 1) {
    const ids = records.map((r) => String(r.jobId).slice(0, 8)).join(', ');
    throw new LoopInputError(
      `Run id "${id}" matches ${records.length} runs (${ids}); give more characters`,
    );
  }
  return readRunRecord(records[0], undefined, index);
}

function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.json$/i.test(value);
}

/**
 * One run named on the command line: a value that names an existing file is
 * read as a file, anything else as a run id in the data directory (R225).
 */
export function loadRun(
  value: string,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  index: ReadonlyMap<string, EvalCaseIndexEntry> = evalCaseIndex(),
): LoopRun {
  const trimmed = value.trim();
  if (!trimmed) throw new LoopInputError('An empty run was given');
  const path = resolveUserPath(trimmed, env);
  if (existsSync(path) && statSync(path).isFile()) {
    return readRunFile(path, index);
  }
  if (looksLikePath(trimmed)) {
    throw new LoopInputError(`No such run file: ${path}`);
  }
  return readRunFromDb(dataDir, trimmed, index);
}

/** The comma-separated runs of one side, `--before` or `--after`. */
export function loadRuns(
  values: string,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  index: ReadonlyMap<string, EvalCaseIndexEntry> = evalCaseIndex(),
): LoopRun[] {
  const parts = values.split(',').filter((part) => part.trim() !== '');
  if (parts.length === 0) throw new LoopInputError('No run was given');
  return parts.map((part) => loadRun(part, dataDir, env, index));
}

/** A run's usage: its own, else the sum of its results'. */
export function usageOfRun(run: LoopRun): ModelUsageEntry[] | undefined {
  if (run.usage) return run.usage;
  const lists = run.results.map((r) => r.usage);
  if (lists.length === 0 || lists.some((list) => list === undefined)) {
    return undefined;
  }
  return lists.reduce<ModelUsageEntry[]>(
    (sum, list) => mergeUsage(sum, list),
    [],
  );
}

/**
 * What a run cost: its `costUsd`, else the sum of its results' (a results
 * array has no run-level cost). Not priced when any part is not priced, not
 * recorded when any part has no cost (a run saved before BA-242).
 */
export function costOfRun(run: LoopRun): LoopCost {
  const notPricedModels = (): string[] => {
    const usage = usageOfRun(run) ?? [];
    const cost = costOf(usage, run.rates ?? PRICE_TABLE);
    return 'notPriced' in cost ? cost.notPriced : [];
  };
  if (run.costUsd === null) {
    return { kind: 'not-priced', models: notPricedModels() };
  }
  if (typeof run.costUsd === 'number') return { kind: 'usd', usd: run.costUsd };
  if (run.results.length === 0) return { kind: 'not-recorded' };
  if (run.results.some((r) => r.costUsd === undefined)) {
    return { kind: 'not-recorded' };
  }
  if (run.results.some((r) => r.costUsd === null)) {
    return { kind: 'not-priced', models: notPricedModels() };
  }
  const usd = run.results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  return { kind: 'usd', usd: Math.round(usd * 1_000_000) / 1_000_000 };
}

/** The cost of several runs together: the sum, else why there is none. */
export function costOfRuns(runs: readonly LoopRun[]): LoopCost {
  const costs = runs.map(costOfRun);
  if (costs.some((c) => c.kind === 'not-recorded')) {
    return { kind: 'not-recorded' };
  }
  const notPriced = costs.filter(
    (c): c is { kind: 'not-priced'; models: string[] } =>
      c.kind === 'not-priced',
  );
  if (notPriced.length > 0) {
    return {
      kind: 'not-priced',
      models: [...new Set(notPriced.flatMap((c) => c.models))],
    };
  }
  const usd = costs.reduce((sum, c) => sum + (c.kind === 'usd' ? c.usd : 0), 0);
  return { kind: 'usd', usd: Math.round(usd * 1_000_000) / 1_000_000 };
}

/** The judge option as the report's judge line writes it (R153). */
export function describeJudge(judge: LoopJudge | undefined): string {
  if (!judge) return 'not recorded';
  if (judge.mode === 'categories') {
    return `on for ${(judge.categories ?? []).join(', ')}`;
  }
  return judge.mode;
}
