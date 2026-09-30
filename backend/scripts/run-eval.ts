/**
 * Golden-set evaluation harness (Phase 1, item 4).
 *
 * Boots the backend as a Nest standalone application context (no HTTP), asks
 * the assistant each question in a case set inside a throwaway session, and
 * compares the result set of the SQL the assistant actually ran against the
 * result set of the case's trusted `expectedSql`.
 *
 * Three things it does beyond that loop, because the improvement loop needs
 * them and neither is worth a second tool:
 *
 * - `--validate` checks every reference query against the live fixture with
 *   **zero model calls**. A reference that errors, returns nothing, or returns
 *   more rows than the cap cannot judge an answer, and finding that out during
 *   a paid run wastes the run.
 * - Verdicts are tallied **per category** (the failure class the case guards),
 *   because "which category is failing" is what the next prompt change is
 *   steered by — a flat pass count says only that something is wrong.
 * - Every run writes a token/cost record into the repo's `logs/` folder, so
 *   spend and quality are one history instead of two anecdotes.
 *
 * `--expert` runs every turn in business expert mode and measures the
 * reasoning trace it produces (`src/modules/expert-mode/expert-metrics.ts`):
 * the headline is the AUROC of the trace's overall confidence against the
 * verdict, the constraint is the accuracy inside the high band, and each
 * case's `expectedReasoning` is scored for coverage. The verdict itself is
 * graded exactly as without the flag — the trace never changes a PASS.
 *
 * Run with `npm run eval` from `backend/`. See `eval/README.md`.
 */
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { basename, isAbsolute, join, resolve } from 'path';
import type { INestApplicationContext, LogLevel } from '@nestjs/common';
// Type-only imports: erased at runtime, so naming these services costs nothing
// until `nestRuntime()` actually loads the graph (see the WHY there).
import type { DatasourcesService } from '../src/modules/datasources/datasources.service';
import type { QueryResult } from '../src/modules/datasources/entities/datasource.entity';
import type { SessionsService } from '../src/modules/sessions/sessions.service';
import type { DatasetsRepository } from '../src/modules/datasets/repositories/datasets.repository';
// Result-set equality lives with the app code: careful mode's cross-check and
// this harness must judge "same answer" exactly the same way. Pure module, so
// importing it eagerly pulls nothing in.
import {
  compareResults,
  normalizeValue,
} from '../src/modules/sessions/result-compare';
import type {
  ChatMessage,
  SessionDoc,
  ToolDataRecord,
} from '../src/modules/sessions/entities/session.entity';
// Token accounting + the run log are pure modules shared with the in-app
// runner, so both harnesses report spend the same way.
import {
  estimateCostUsd,
  isUsageUnobserved,
  sumUsage,
  tallyCategories,
  type EvalRunLogCase,
  type EvalRunLogRecord,
  type TokenUsage,
} from '../src/modules/agents/eval-telemetry';
import {
  findRepoRoot,
  loadPricing,
  resolveLogDir,
  writeRunLog,
} from '../src/modules/agents/eval-run-log';
import type { EvalRunLogExpertCase } from '../src/modules/agents/eval-telemetry';
// Expert-mode metrics are pure as well: AUROC, selective accuracy, coverage.
import {
  expertCaseRecord,
  summarizeExpert,
  type ExpectedReasoning,
  type ExpertCaseRecord,
  type ExpertRunSummary,
} from '../src/modules/expert-mode/expert-metrics';
import type { ReasoningTrace } from '../src/modules/expert-mode/entities/reasoning-trace.entity';
import { pickAnswerRecord } from '../src/modules/expert-mode/answer-record';

// Connectors clamp `runReadOnlySql` at 500 rows, so comparing more is moot.
const ROW_LIMIT = Number(process.env.EVAL_ROW_LIMIT ?? 500);
const TURN_TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 300_000);
const DEFAULT_GOLDEN_SET = join(__dirname, '..', 'eval', 'golden-set.json');
const SUITE_LOADER_PATH = '../src/mastra/evals/suite-loader';

interface GoldenCase {
  /** Short identifier used in the summary table. Suite cases use their `id`. */
  name: string;
  /** The question sent to the assistant, exactly as a user would type it. */
  question: string;
  /** Saved dataset name the throwaway session is bound to. */
  dataset: string;
  /**
   * `percentEquivalent`: the reference is a ratio the assistant may report as
   * a fraction or a percentage — both are accepted. Suite cases only.
   */
  resultSetOptions?: { distinctRows?: boolean; percentEquivalent?: boolean };
  /**
   * Failure class this case guards (`ratio-trap`, `ties`, `control`, …). The
   * unit the per-category table is grouped by; absent on the legacy World Cup
   * cases, which fall under `uncategorised`.
   */
  category?: string;
  /**
   * Trusted SQL whose live result set is the reference answer. Optional only
   * for suite-shaped sets, where a case can be graded by tool checks or a
   * judge instead — this harness skips those rather than guessing.
   */
  expectedSql?: string;
  /** Seed entries ship as placeholders; they are skipped unless forced. */
  placeholder?: boolean;
  notes?: string;
  /** What a correct reasoning trace names — scored by `--expert` runs only. */
  expectedReasoning?: ExpectedReasoning;
}

type Verdict = 'PASS' | 'FAIL' | 'ERROR' | 'SKIP';

/**
 * `--validate` answers a different question than a graded run, so it gets its
 * own vocabulary. It still maps onto a `Verdict` (below) so the exit code and
 * the run log stay one code path: TOO-MANY is a FAIL, EMPTY is a PASS that
 * prints a warning, because a reference returning nothing is a case worth
 * rewriting but not a broken build.
 */
type ValidateStatus = 'OK' | 'EMPTY' | 'TOO-MANY' | 'ERROR';

interface CaseResult {
  name: string;
  category?: string;
  verdict: Verdict;
  /** Short verdict qualifier, e.g. `result-mismatch`, `no-sql`, `timeout`. */
  reason: string;
  detail: string;
  /** Set on `--validate` runs; shown instead of the verdict in the table. */
  status?: ValidateStatus;
  expectedRows?: number;
  actualRows?: number;
  durationMs: number;
  /** How many repetitions ran, and how many of them passed (`--repeat`). */
  runs?: number;
  passes?: number;
  /** Absent when the provider reported nothing — never faked from text length. */
  usage?: TokenUsage;
  /**
   * `--expert` only: the reasoning-trace measurements of the attempt this
   * result reports (see `expert-metrics.ts`). `{ traced: false }` when the
   * answer carried no trace; absent when the turn never completed.
   */
  expert?: ExpertCaseRecord;
  /** `--expert` only: every attempt's verdict and trace — what the AUROC ranks. */
  expertAttempts?: { verdict: Verdict; record: ExpertCaseRecord }[];
  /**
   * `--expert` only: an ungraded case (no reference SQL) that was still run,
   * once, to record whether its answer carried a trace.
   */
  probe?: boolean;
  /** Probes only: the turn ended in a clarifying question. */
  clarified?: boolean;
}

/** A misconfiguration the operator must fix — reported without a stack trace. */
class EvalSetupError extends Error {}

interface Options {
  file: string;
  /** True when `--file` was given, so `--suite` can reject the combination. */
  fileExplicit: boolean;
  suite?: string;
  only?: string;
  category?: string;
  label?: string;
  repeat: number;
  validate: boolean;
  /** `--no-log` clears this; a run that writes no record. */
  log: boolean;
  includePlaceholders: boolean;
  keepSessions: boolean;
  verbose: boolean;
  /** `--expert`: run every turn in business expert mode and score its trace. */
  expert: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    file: DEFAULT_GOLDEN_SET,
    fileExplicit: false,
    repeat: 1,
    validate: false,
    log: true,
    includePlaceholders: false,
    keepSessions: false,
    verbose: false,
    expert: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') {
      const value = argv[++i];
      if (!value) throw new EvalSetupError('--file needs a path');
      if (options.suite) throw new EvalSetupError(SUITE_AND_FILE);
      options.file = isAbsolute(value) ? value : resolve(process.cwd(), value);
      options.fileExplicit = true;
    } else if (arg === '--suite') {
      const value = argv[++i];
      if (!value) throw new EvalSetupError('--suite needs a suite id');
      if (options.fileExplicit) throw new EvalSetupError(SUITE_AND_FILE);
      options.suite = value;
    } else if (arg === '--only' || arg === '-o') {
      const value = argv[++i];
      if (!value) throw new EvalSetupError('--only needs a case-name filter');
      options.only = value;
    } else if (arg === '--category' || arg === '-c') {
      const value = argv[++i];
      if (!value) throw new EvalSetupError('--category needs a substring');
      options.category = value;
    } else if (arg === '--label') {
      const value = argv[++i];
      if (!value) throw new EvalSetupError('--label needs a tag');
      options.label = value;
    } else if (arg === '--repeat') {
      const value = argv[++i];
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new EvalSetupError(
          `--repeat needs a whole number of runs per case (got "${value ?? ''}")`,
        );
      }
      options.repeat = parsed;
    } else if (arg === '--validate') {
      options.validate = true;
    } else if (arg === '--no-log') {
      options.log = false;
    } else if (arg === '--include-placeholders') {
      options.includePlaceholders = true;
    } else if (arg === '--keep-sessions') {
      options.keepSessions = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--expert') {
      options.expert = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new EvalSetupError(`Unknown argument "${arg}" (try --help)`);
    }
  }
  if (options.expert && options.validate) {
    throw new EvalSetupError(
      '--expert measures the reasoning trace of answered turns and --validate ' +
        'makes no model calls — drop one of them',
    );
  }
  return options;
}

const SUITE_AND_FILE =
  '--suite and --file are mutually exclusive: --suite runs a registered JSON ' +
  'suite from src/mastra/evals/suites, --file runs a case file by path';

function printUsage(): void {
  console.log(
    [
      'Usage: npm run eval -- [options]',
      '',
      '  -f, --file <path>          case file to run (default eval/golden-set.json)',
      '      --suite <id>           run a registered JSON suite from',
      '                             src/mastra/evals/suites (excludes --file)',
      '  -o, --only <substring>     run only cases whose name contains <substring>',
      '  -c, --category <substring> run only cases whose category contains <substring>',
      "      --validate             run every case's expectedSql and stop: zero",
      '                             model calls, no sessions, no LLM needed',
      '      --repeat <n>           run each case n times; the case passes only if',
      '                             every run passes (default 1)',
      '      --expert               business expert mode: every turn also builds a',
      '                             reasoning trace; reports the AUROC of its overall',
      '                             confidence vs PASS (headline), accuracy in the',
      '                             high band (constraint) and expectedReasoning',
      '                             coverage. Cases without expectedSql run once,',
      '                             ungraded, to record trace presence (excludes',
      '                             --validate)',
      '      --label <text>         tag recorded in the run log (e.g. baseline)',
      '      --no-log               do not write a run log into logs/evals',
      '      --include-placeholders run cases still marked "placeholder": true',
      '      --keep-sessions        do not delete the throwaway sessions',
      '  -v, --verbose              show Nest logs and per-case SQL',
      '  -h, --help                 show this message',
      '',
      'Env: EVAL_ROW_LIMIT (default 500), EVAL_TIMEOUT_MS (default 300000),',
      '     APP_DATA_DIR (datastore location — must match the desktop app),',
      '     EVAL_LOG_DIR (run-log folder; default <repo>/logs).',
    ].join('\n'),
  );
}

// ------------------------------------------------------------ case sets

/** A selected set of cases plus the name the run log files it under. */
interface CaseSource {
  /** Suite id, or the case file's basename — what `logs/evals` groups by. */
  suite: string;
  /** Where the cases came from, for operator-facing messages. */
  origin: string;
  cases: GoldenCase[];
}

/**
 * The suite loader, loaded on demand so `--help`, `--file` runs and this
 * file's unit test never pay for (or depend on) the suite registry.
 */
function suiteLoader(): typeof import('../src/mastra/evals/suite-loader') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(
      SUITE_LOADER_PATH,
    ) as typeof import('../src/mastra/evals/suite-loader');
  } catch (error) {
    throw new EvalSetupError(
      `Could not load the suite registry (${SUITE_LOADER_PATH}) — ${message(error)}`,
    );
  }
}

/**
 * Cases from a registered JSON suite. A suite states its datasets once, at the
 * top, because every case in it runs against the same fixture; the first entry
 * is the one the throwaway session binds to.
 */
function loadSuiteCases(id: string): CaseSource {
  const loader = suiteLoader();
  let suite: import('../src/mastra/evals/suite-loader').EvalSuite;
  try {
    suite = loader.loadSuite(id);
  } catch (error) {
    const known = safeSuiteIds(loader);
    throw new EvalSetupError(
      `${message(error)}${known.length ? ` Known suites: ${known.join(', ')}.` : ''}`,
    );
  }
  const dataset = suite.datasets?.[0];
  if (!dataset) {
    throw new EvalSetupError(
      `Suite "${suite.id}" declares no datasets. Add the saved dataset name to ` +
        'its "datasets" array — the throwaway session has nothing to bind to ' +
        'without one.',
    );
  }
  if (!suite.cases?.length) {
    throw new EvalSetupError(`Suite "${suite.id}" has no cases`);
  }
  return {
    suite: suite.id,
    origin: `suite ${suite.id} (${suite.name})`,
    cases: suite.cases.map((entry) => ({
      name: entry.id,
      category: entry.category,
      question: entry.question,
      dataset,
      expectedSql: entry.expectedSql,
      notes: entry.notes,
      ...(entry.resultSetOptions
        ? { resultSetOptions: entry.resultSetOptions }
        : {}),
      ...(entry.expectedReasoning
        ? { expectedReasoning: entry.expectedReasoning }
        : {}),
    })),
  };
}

function safeSuiteIds(
  loader: typeof import('../src/mastra/evals/suite-loader'),
): string[] {
  try {
    return loader.listSuites().map((suite) => suite.id);
  } catch {
    return [];
  }
}

/**
 * Read a case file. Two shapes are accepted on purpose:
 *
 * - the original **flat array** of cases (`eval/golden-set.json`), and
 * - a **suite object** (`{ id, name, datasets, requiredEntities, cases }`),
 *   the same shape `src/mastra/evals/suites/*.json` uses.
 *
 * One format for both runners means a suite can be driven from this CLI by
 * path while it is still being written, and a case never has to be maintained
 * twice. Suite-shaped cases inherit `datasets[0]` when they name no dataset of
 * their own, and may omit `expectedSql` — those are graded in-app by checks or
 * a judge, and this harness skips them rather than guessing a reference.
 */
function readCaseFile(file: string): CaseSource {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new EvalSetupError(`Golden set not found at ${file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new EvalSetupError(
      `Golden set ${file} is not valid JSON — ${message(error)}`,
    );
  }

  const suiteShaped =
    !!parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as { cases?: unknown }).cases);
  const object = (parsed ?? {}) as Record<string, unknown>;
  const entries: unknown[] = suiteShaped
    ? (object.cases as unknown[])
    : Array.isArray(parsed)
      ? parsed
      : [];
  if (!suiteShaped && !Array.isArray(parsed)) {
    throw new EvalSetupError(
      `Golden set ${file} must be an array of cases, or a suite object with a ` +
        '"cases" array',
    );
  }
  if (!entries.length) {
    throw new EvalSetupError(`Golden set ${file} contains no cases`);
  }

  const datasets = Array.isArray(object.datasets)
    ? (object.datasets as unknown[]).filter(
        (value): value is string => typeof value === 'string' && !!value.trim(),
      )
    : [];
  const inherited = suiteShaped ? datasets[0] : undefined;
  const suiteId =
    (suiteShaped && typeof object.id === 'string' && object.id.trim()) ||
    basename(file).replace(/\.json$/i, '');

  const cases = entries.map((entry, index) =>
    normalizeCase(entry, index, file, inherited, suiteShaped),
  );
  return { suite: suiteId, origin: file, cases };
}

/**
 * One case, from either shape. Suite cases key their identifier as `id`; flat
 * cases call it `name`. Everything downstream sees `name`.
 */
function normalizeCase(
  entry: unknown,
  index: number,
  file: string,
  inheritedDataset: string | undefined,
  suiteShaped: boolean,
): GoldenCase {
  const value = (entry ?? {}) as Record<string, unknown>;
  const where = `Case #${index + 1} in ${file}`;
  const text = (field: string): string | undefined => {
    const raw = value[field];
    return typeof raw === 'string' && raw.trim() ? raw : undefined;
  };

  const name = text('name') ?? text('id');
  if (!name) {
    throw new EvalSetupError(`${where} is missing a non-empty "name"`);
  }
  const question = text('question');
  if (!question) {
    throw new EvalSetupError(`${where} is missing a non-empty "question"`);
  }
  const dataset = text('dataset') ?? inheritedDataset;
  if (!dataset) {
    throw new EvalSetupError(
      `${where} is missing a non-empty "dataset"` +
        (suiteShaped
          ? ' and the file declares no "datasets" to inherit the first entry from'
          : ''),
    );
  }
  const expectedSql = text('expectedSql');
  // A flat case with no reference SQL is almost always a typo, and silently
  // skipping it would hide the case forever. A suite case legitimately has
  // none (tool-check or judge grading), so only the flat shape is strict.
  if (!expectedSql && !suiteShaped) {
    throw new EvalSetupError(`${where} is missing a non-empty "expectedSql"`);
  }
  // Held to the registered suites' rules — one validator, loaded only when a
  // case file actually carries the field.
  let expectedReasoning: ExpectedReasoning | undefined;
  if (value.expectedReasoning !== undefined) {
    try {
      expectedReasoning = suiteLoader().parseExpectedReasoning(
        value.expectedReasoning,
        file,
        `case "${name}"`,
      );
    } catch (error) {
      if (error instanceof EvalSetupError) throw error;
      throw new EvalSetupError(message(error));
    }
  }
  return {
    name,
    question,
    dataset,
    ...(text('category') ? { category: text('category') } : {}),
    ...(expectedSql ? { expectedSql } : {}),
    ...(value.placeholder === true ? { placeholder: true } : {}),
    ...(text('notes') ? { notes: text('notes') } : {}),
    ...(expectedReasoning ? { expectedReasoning } : {}),
  };
}

/** Back-compatible entry point: the cases of a file, in file order. */
function loadGoldenSet(file: string): GoldenCase[] {
  return readCaseFile(file).cases;
}

// ------------------------------------------------------------- analysis

function lastAssistantMessage(session: SessionDoc): ChatMessage | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i];
    if (message.role === 'assistant') return message;
  }
  return undefined;
}

/**
 * Width-tolerant comparison, optionally accepting a ratio reported as a
 * fraction or a percentage: with `percentEquivalent` the assistant's numeric
 * cells are also tried scaled by 100 and by 1/100.
 */
function compareLenient(
  expected: Record<string, unknown>[],
  actual: Record<string, unknown>[],
  percentEquivalent: boolean,
): ReturnType<typeof compareResults> {
  const direct = compareResults(expected, actual, { widthTolerant: true });
  if (direct.match || !percentEquivalent) return direct;
  for (const factor of [100, 0.01]) {
    const scaled = actual.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => {
          const numeric =
            typeof value === 'number'
              ? value
              : typeof value === 'string' &&
                  /^-?\d+(?:\.\d+)?$/.test(value.trim())
                ? Number(value)
                : undefined;
          return [key, numeric === undefined ? value : numeric * factor];
        }),
      ),
    );
    const result = compareResults(expected, scaled, { widthTolerant: true });
    if (result.match) return result;
  }
  return direct;
}

/**
 * The `run_readonly_sql` call the answer is built on. Not merely the last
 * successful one: the assistant often runs a supporting query after the one
 * that produced the figure (a `COUNT(*)` to say "over 38 employees"), and
 * grading that query marks a correct answer as a result mismatch. The picker
 * chooses the successful query whose result values the answer text quotes,
 * latest on a tie, and falls back to the last successful query when the
 * answer quotes nothing — see `expert-mode/answer-record.ts`.
 */
function lastSuccessfulSql(
  message: ChatMessage | undefined,
): ToolDataRecord | undefined {
  return pickAnswerRecord(message?.data, message?.content);
}

/**
 * The reasoning trace business expert mode saved on the answer, if any.
 * Clarification turns never carry one.
 */
function expertTraceOf(
  message: ChatMessage | undefined,
): ReasoningTrace | undefined {
  return message?.expertTrace;
}

/**
 * `SessionsService.streamMessage` with its trailing `expert` flag — the
 * production turn, not a bare agent call. With `expert` false this is the
 * exact call the harness made before the flag existed (every trailing
 * argument at its default).
 */
function streamTurn(
  sessions: SessionsService,
  sessionId: string,
  question: string,
  signal: AbortSignal,
  expert: boolean,
): Promise<void> {
  return sessions.streamMessage(
    sessionId,
    question,
    () => {},
    signal,
    undefined,
    false,
    expert,
  );
}

// ------------------------------------------------------------- runtime

/**
 * Services resolved from the Nest context. Held as an object so `--validate`
 * can use the datasource half without ever naming `LlmService`.
 */
interface Services {
  app: INestApplicationContext;
  sessions: SessionsService;
  datasources: DatasourcesService;
  datasets: DatasetsRepository;
  /** The resolved `LlmService`, only ever fetched by the graded preflight. */
  llmView: () => Promise<{
    provider: string | null;
    model: string | null;
    configured: boolean;
  }>;
}

/**
 * Load the Nest graph on demand.
 *
 * WHY `require` and not a static import: this file is also imported by its
 * unit test and by `--help`, and importing `AppModule` drags in the whole
 * backend — including `src/mastra/index.ts`, which builds its Mastra instance
 * and opens LibSQL storage the moment it is loaded. `await import()` is not an
 * option either: TypeScript preserves dynamic imports under `module: nodenext`,
 * and Node's ESM loader cannot read the `.ts` sources ts-node is serving.
 */
async function boot(verbose: boolean): Promise<Services> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { NestFactory } =
    require('@nestjs/core') as typeof import('@nestjs/core');
  const { AppModule } =
    require('../src/app.module') as typeof import('../src/app.module');
  const { SessionsService } =
    require('../src/modules/sessions/sessions.service') as typeof import('../src/modules/sessions/sessions.service');
  const { DatasourcesService } =
    require('../src/modules/datasources/datasources.service') as typeof import('../src/modules/datasources/datasources.service');
  const { DatasetsRepository } =
    require('../src/modules/datasets/repositories/datasets.repository') as typeof import('../src/modules/datasets/repositories/datasets.repository');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const logger: LogLevel[] = verbose
    ? ['log', 'warn', 'error']
    : ['warn', 'error'];
  const app = await NestFactory.createApplicationContext(AppModule, { logger });
  return {
    app,
    sessions: app.get(SessionsService),
    datasources: app.get(DatasourcesService),
    datasets: app.get(DatasetsRepository),
    llmView: async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { LlmService } =
        require('../src/modules/llm/llm.service') as typeof import('../src/modules/llm/llm.service');
      return app.get(LlmService).getView();
    },
  };
}

async function resolveDatasourceId(
  datasets: DatasetsRepository,
  datasources: DatasourcesService,
  name: string,
): Promise<string> {
  const [dataset] = await datasets.getByNames([name]);
  if (!dataset) {
    const saved = (await datasets.list()).map((s) => s.name);
    throw new EvalSetupError(
      `Dataset "${name}" does not exist in this datastore. ` +
        (saved.length
          ? `Saved datasets: ${saved.join(', ')}.`
          : 'No datasets are saved — create one in the app first.'),
    );
  }
  const datasourceId =
    dataset.datasourceId ?? (await datasources.defaultDatasource())?.id;
  if (!datasourceId) {
    throw new EvalSetupError(
      `Dataset "${name}" has no datasource bound and no datasource is saved — ` +
        'configure a connection in the app first.',
    );
  }
  return datasourceId;
}

/**
 * Every case's dataset resolved to a reachable datasource. Shared by the
 * graded run and `--validate`, which needs the datasources and nothing else.
 */
async function resolveDatasources(
  services: Services,
  cases: GoldenCase[],
): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const name of new Set(cases.map((c) => c.dataset))) {
    const datasourceId = await resolveDatasourceId(
      services.datasets,
      services.datasources,
      name,
    );
    try {
      await services.datasources.runReadOnlySql(datasourceId, 'SELECT 1', 1);
    } catch (error) {
      throw new EvalSetupError(
        `Datasource for dataset "${name}" is not reachable — ${message(error)}`,
      );
    }
    byName.set(name, datasourceId);
  }
  return byName;
}

/**
 * Graded-run preflight: an LLM must be configured, and every dataset must
 * resolve. Returns the model id that will actually answer, for the run log —
 * mirroring `LlmService.resolveAgentModel`, which is the only other place that
 * decides it.
 */
async function preflight(
  services: Services,
  cases: GoldenCase[],
): Promise<{ datasourceIds: Map<string, string>; model?: string }> {
  const llm = await services.llmView();
  if (!llm.configured && !process.env.OPENAI_API_KEY) {
    throw new EvalSetupError(
      'No LLM configured. Save provider/model/API key in the app ' +
        '(Settings → LLM) using the same APP_DATA_DIR as this run, or export ' +
        'OPENAI_API_KEY to use the gpt-4o-mini fallback.',
    );
  }
  const model =
    llm.configured && llm.model
      ? `${llm.provider === 'lenai' ? 'lenai' : 'openai'}/${llm.model}`
      : 'openai/gpt-4o-mini';
  return { datasourceIds: await resolveDatasources(services, cases), model };
}

async function runCase(
  services: Services,
  testCase: GoldenCase,
  datasourceId: string,
  options: Options,
): Promise<CaseResult> {
  const { sessions, datasources } = services;
  const started = Date.now();
  // Set once the answer is read; every verdict after that carries it, so a
  // FAIL(no-sql) still records whether its answer was traced.
  let expert: ExpertCaseRecord | undefined;
  const done = (
    result: Omit<CaseResult, 'name' | 'durationMs'>,
  ): CaseResult => ({
    name: testCase.name,
    category: testCase.category,
    durationMs: Date.now() - started,
    ...result,
    ...(expert ? { expert } : {}),
  });

  const session = await sessions.create(
    `eval ${testCase.name} ${new Date().toISOString()}`.slice(0, 64),
    [testCase.dataset],
  );
  try {
    const turn = new AbortController();
    const timer = setTimeout(() => turn.abort(), TURN_TIMEOUT_MS);
    try {
      await streamTurn(
        sessions,
        session.id,
        testCase.question,
        turn.signal,
        options.expert,
      );
    } finally {
      clearTimeout(timer);
    }
    if (turn.signal.aborted) {
      return done({
        verdict: 'ERROR',
        reason: 'timeout',
        detail: `the turn exceeded ${Math.round(TURN_TIMEOUT_MS / 1000)}s`,
      });
    }

    const answered = await sessions.get(session.id);
    const answer = lastAssistantMessage(answered);
    if (options.expert) {
      expert = expertCaseRecord(
        expertTraceOf(answer),
        testCase.expectedReasoning,
      );
    }
    // Token counts come off the persisted answer — measured by the provider,
    // never inferred here. Absent means the provider reported nothing.
    const usage = answer?.usage;
    const record = lastSuccessfulSql(answer);
    if (!record?.input) {
      return done({
        verdict: 'FAIL',
        reason: 'no-sql',
        usage,
        detail: answer?.clarification
          ? `the assistant asked a clarifying question instead: "${answer.clarification.question}"`
          : 'the answer ran no successful run_readonly_sql',
      });
    }
    if (options.verbose) console.log(`    sql: ${oneLine(record.input)}`);

    let expected: QueryResult;
    try {
      expected = await datasources.runReadOnlySql(
        datasourceId,
        testCase.expectedSql!,
        ROW_LIMIT,
      );
    } catch (error) {
      return done({
        verdict: 'ERROR',
        reason: 'expected-sql',
        usage,
        detail: `expectedSql failed to run — ${message(error)}`,
      });
    }

    // Re-run the assistant's SQL: the stored rows are capped at 200 and the
    // reference run is capped at 500, so replay it under the same limit.
    let actualRows: Record<string, unknown>[];
    let note = '';
    try {
      actualRows = (
        await datasources.runReadOnlySql(datasourceId, record.input, ROW_LIMIT)
      ).rows;
    } catch (error) {
      if (!record.rows?.length) {
        return done({
          verdict: 'ERROR',
          reason: 'replay-failed',
          usage,
          detail: `could not re-run the assistant's SQL — ${message(error)}`,
        });
      }
      actualRows = record.rows;
      note = ' (compared the stored rows: replay failed)';
    }

    // The reference SQL projects exactly what the question asked; the assistant
    // also selects the figures its answer leans on. Judging that difference as
    // a failure would flag correct answers, so compare the facts and report the
    // shape separately.
    const percentEquivalent =
      testCase.resultSetOptions?.percentEquivalent === true;
    const { match, reason, shapeDiffers } = compareLenient(
      expected.rows,
      actualRows,
      percentEquivalent,
    );
    if (match) {
      return done({
        verdict: 'PASS',
        reason: shapeDiffers ? 'extra-columns' : '',
        detail: `${expected.rows.length} rows match${shapeDiffers ? ' (assistant projected different columns)' : ''}`,
        expectedRows: expected.rows.length,
        actualRows: actualRows.length,
        usage,
      });
    }
    // The answer may lean on several queries — a headline total plus a
    // breakdown, a rate plus its numerator and denominator. The in-app suite
    // passes when one complete successful result carries every reference
    // fact; so does the CLI, trying the other complete queries before failing.
    const alternates = (answer?.data ?? []).filter(
      (candidate) =>
        candidate !== record &&
        candidate.tool === 'run_readonly_sql' &&
        !candidate.error &&
        !candidate.truncated &&
        candidate.input?.trim(),
    );
    for (const [index, candidate] of alternates.entries()) {
      let rows: Record<string, unknown>[];
      try {
        rows = (
          await datasources.runReadOnlySql(
            datasourceId,
            candidate.input!,
            ROW_LIMIT,
          )
        ).rows;
      } catch {
        continue;
      }
      const alt = compareLenient(expected.rows, rows, percentEquivalent);
      if (alt.match) {
        if (options.verbose) {
          console.log(
            `    matched by another query: ${oneLine(candidate.input!)}`,
          );
        }
        return done({
          verdict: 'PASS',
          reason: 'alternate-query',
          detail: `${expected.rows.length} rows match another of the assistant's ${alternates.length + 1} queries (#${index + 1}), not the one its answer quotes most`,
          expectedRows: expected.rows.length,
          actualRows: rows.length,
          usage,
        });
      }
    }
    return done({
      verdict: 'FAIL',
      reason: 'result-mismatch',
      detail: reason + note,
      expectedRows: expected.rows.length,
      actualRows: actualRows.length,
      usage,
    });
  } catch (error) {
    return done({
      verdict: 'ERROR',
      reason: 'turn-failed',
      detail: message(error),
    });
  } finally {
    if (!options.keepSessions) {
      await sessions
        .delete(session.id)
        .catch((error: unknown) =>
          console.warn(
            `  ! could not delete throwaway session ${session.id} — ${message(error)}`,
          ),
        );
    }
  }
}

/**
 * Run one case `--repeat` times and fold the attempts into a single verdict.
 *
 * WHY every repetition must pass: a model is non-deterministic, so one flip is
 * noise — but a case that passes 4 times in 5 is not a case that passes, and
 * treating it as one hides exactly the instability the loop is trying to
 * remove. The `k/n` column is there so a flake reads as a flake, not a fail.
 */
async function runCaseRepeated(
  services: Services,
  testCase: GoldenCase,
  datasourceId: string,
  options: Options,
): Promise<CaseResult> {
  const attempts: CaseResult[] = [];
  for (let run = 1; run <= options.repeat; run++) {
    if (options.repeat > 1) console.log(`  · run ${run}/${options.repeat}`);
    const attempt = await runCase(services, testCase, datasourceId, options);
    if (options.repeat > 1) {
      console.log(
        `    ${attempt.verdict}${attempt.reason ? `(${attempt.reason})` : ''} — ${oneLine(attempt.detail)}`,
      );
    }
    attempts.push(attempt);
  }
  const passes = attempts.filter((a) => a.verdict === 'PASS').length;
  // The first failure is the one worth reporting: it is the attempt whose
  // detail explains what went wrong.
  const representative =
    attempts.find((a) => a.verdict !== 'PASS') ?? attempts[0];
  const usage = sumUsage(attempts.map((a) => a.usage));
  const expertAttempts = attempts.flatMap((a) =>
    a.expert ? [{ verdict: a.verdict, record: a.expert }] : [],
  );
  return {
    ...representative,
    ...(expertAttempts.length ? { expertAttempts } : {}),
    verdict: passes === attempts.length ? 'PASS' : representative.verdict,
    detail:
      options.repeat > 1 && passes !== attempts.length
        ? `${passes}/${attempts.length} runs passed — ${representative.detail}`
        : representative.detail,
    durationMs: attempts.reduce((total, a) => total + a.durationMs, 0),
    runs: attempts.length,
    passes,
    usage: isUsageUnobserved(usage) ? undefined : usage,
  };
}

/**
 * `--expert` on a case with no reference SQL — typically a clarification case.
 * This harness cannot grade it, so it stays SKIP; but the turn is still run,
 * once, because whether its answer carried a reasoning trace is itself a
 * check: a clarification turn must carry none.
 */
async function runProbe(
  services: Services,
  testCase: GoldenCase,
  options: Options,
): Promise<CaseResult> {
  const { sessions } = services;
  const started = Date.now();
  const result = (
    detail: string,
    extra: Partial<CaseResult> = {},
  ): CaseResult => ({
    name: testCase.name,
    category: testCase.category,
    verdict: 'SKIP',
    reason: 'no-expected-sql',
    detail,
    durationMs: Date.now() - started,
    probe: true,
    ...extra,
  });

  const session = await sessions.create(
    `eval ${testCase.name} ${new Date().toISOString()}`.slice(0, 64),
    [testCase.dataset],
  );
  try {
    const turn = new AbortController();
    const timer = setTimeout(() => turn.abort(), TURN_TIMEOUT_MS);
    try {
      await streamTurn(
        sessions,
        session.id,
        testCase.question,
        turn.signal,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
    if (turn.signal.aborted) {
      return result(
        `not graded (no reference SQL); the probe turn exceeded ${Math.round(TURN_TIMEOUT_MS / 1000)}s`,
      );
    }
    const answer = lastAssistantMessage(await sessions.get(session.id));
    const expert = expertCaseRecord(
      expertTraceOf(answer),
      testCase.expectedReasoning,
    );
    const clarified = !!answer?.clarification;
    const detail = clarified
      ? expert.traced
        ? 'not graded (no reference SQL); clarified but carried a reasoning trace — clarification turns should carry none'
        : 'not graded (no reference SQL); clarified, no reasoning trace (as expected)'
      : `not graded (no reference SQL); answered without clarifying, reasoning trace ${expert.traced ? 'present' : 'absent'}`;
    return result(detail, { expert, clarified, usage: answer?.usage });
  } catch (error) {
    return result(
      `not graded (no reference SQL); the probe turn failed — ${message(error)}`,
    );
  } finally {
    if (!options.keepSessions) {
      await sessions
        .delete(session.id)
        .catch((error: unknown) =>
          console.warn(
            `  ! could not delete throwaway session ${session.id} — ${message(error)}`,
          ),
        );
    }
  }
}

/**
 * `--validate`: run the case's reference SQL and report what it returns.
 * Nothing here touches a model, a session or the agent graph — the whole point
 * is that a fixture's references can be checked for free, as often as they are
 * edited.
 */
async function validateCase(
  services: Services,
  testCase: GoldenCase,
  datasourceId: string,
): Promise<CaseResult> {
  const started = Date.now();
  const done = (
    status: ValidateStatus,
    verdict: Verdict,
    reason: string,
    detail: string,
    rows?: number,
  ): CaseResult => ({
    name: testCase.name,
    category: testCase.category,
    status,
    verdict,
    reason,
    detail,
    expectedRows: rows,
    durationMs: Date.now() - started,
  });

  let result: QueryResult;
  try {
    result = await services.datasources.runReadOnlySql(
      datasourceId,
      testCase.expectedSql!,
      ROW_LIMIT,
    );
  } catch (error) {
    return done('ERROR', 'ERROR', 'sql-error', message(error));
  }
  const rows = result.rows.length;
  if (rows === 0) {
    return done(
      'EMPTY',
      'PASS',
      'empty',
      'the reference returns no rows — it cannot tell a right answer from a wrong one',
      0,
    );
  }
  if (rows >= ROW_LIMIT) {
    return done(
      'TOO-MANY',
      'FAIL',
      'too-many-rows',
      `${rows} rows at the ${ROW_LIMIT}-row cap — both sides are truncated, so the comparison is untrustworthy; aggregate the reference down`,
      rows,
    );
  }
  return done('OK', 'PASS', '', `${rows} row${rows === 1 ? '' : 's'}`, rows);
}

// -------------------------------------------------------------- output

function summarize(results: CaseResult[], options: Options): void {
  const withRuns = options.repeat > 1;
  const rows = results.map((result) => [
    result.name,
    result.status ??
      result.verdict + (result.reason ? `(${result.reason})` : ''),
    ...(withRuns
      ? [result.runs ? `${result.passes ?? 0}/${result.runs}` : '-']
      : []),
    result.verdict === 'SKIP'
      ? '-'
      : options.validate
        ? `${result.expectedRows ?? '-'}`
        : `${result.expectedRows ?? '-'}/${result.actualRows ?? '-'}`,
    result.verdict === 'SKIP'
      ? '-'
      : `${(result.durationMs / 1000).toFixed(1)}s`,
    oneLine(result.detail).slice(0, 80),
  ]);
  const header = [
    'CASE',
    options.validate ? 'STATUS' : 'VERDICT',
    ...(withRuns ? ['RUNS'] : []),
    options.validate ? 'ROWS' : 'ROWS exp/act',
    'TIME',
    'DETAIL',
  ];
  printTable(header, rows);

  const count = (verdict: Verdict) =>
    results.filter((result) => result.verdict === verdict).length;
  console.log('');
  if (options.validate) {
    const status = (value: ValidateStatus) =>
      results.filter((result) => result.status === value).length;
    console.log(
      `${results.length} references — ${status('OK')} ok, ${status('EMPTY')} empty, ` +
        `${status('TOO-MANY')} too many rows, ${status('ERROR')} errored, ` +
        `${count('SKIP')} skipped`,
    );
  } else {
    console.log(
      `${results.length} cases — ${count('PASS')} passed, ${count('FAIL')} failed, ` +
        `${count('ERROR')} errored, ${count('SKIP')} skipped`,
    );
  }
}

/**
 * Per-category pass rates, worst first.
 *
 * The loop is steered by which failure class is failing, not by the total, so
 * the eye should land on the worst row without scanning. SKIPs are excluded by
 * `tallyCategories` — a case that never ran cannot lower a rate.
 */
function summarizeCategories(results: CaseResult[]): void {
  const tally = tallyCategories(results);
  const names = Object.keys(tally);
  if (!names.length) return;
  const rate = (name: string) => tally[name].passed / tally[name].total;
  names.sort(
    (a, b) =>
      rate(a) - rate(b) ||
      tally[b].total - tally[a].total ||
      a.localeCompare(b),
  );
  printTable(
    ['CATEGORY', 'PASSED/TOTAL', 'RATE'],
    names.map((name) => [
      name,
      `${tally[name].passed}/${tally[name].total}`,
      `${Math.round(rate(name) * 100)}%`,
    ]),
  );
}

/* ------------------------------------------------------ expert mode */

/** One line under a case's verdict while the run is in progress. */
function describeExpert(record: ExpertCaseRecord | undefined): string {
  if (!record) return 'the turn did not complete — nothing to measure';
  if (!record.traced) return 'no reasoning trace on this answer';
  const parts = [
    `conf ${formatScore(record.confidence)} (${record.band ?? '-'})`,
    `tables ${formatShare(record.tablesCoverage)}`,
    `assumptions ${formatShare(record.assumptionsCoverage)}`,
    `metric ${formatMatch(record.metricMatched)}`,
  ];
  return parts.join(' · ');
}

/**
 * Fold every graded attempt (PASS or FAIL — an ERROR says nothing about the
 * answer) and every probe into the run's expert summary.
 */
function expertSummaryOf(results: CaseResult[]): ExpertRunSummary {
  const attempts = results
    .filter((result) => !result.probe)
    .flatMap((result) => result.expertAttempts ?? [])
    .filter(
      (attempt) => attempt.verdict === 'PASS' || attempt.verdict === 'FAIL',
    )
    .map((attempt) => ({
      record: attempt.record,
      correct: attempt.verdict === 'PASS',
    }));
  const probes = results.flatMap((result) =>
    result.probe && result.expert
      ? [{ record: result.expert, clarified: !!result.clarified }]
      : [],
  );
  return summarizeExpert(attempts, probes);
}

/**
 * The per-case expert table, then the headline (AUROC), the constraint
 * (high-band accuracy) and the coverage means. Cases that never ran
 * (placeholders, SKIPs without a probe) are left out of the table.
 */
function reportExpert(results: CaseResult[], summary: ExpertRunSummary): void {
  const shown = results.filter(
    (result) => result.verdict !== 'SKIP' || result.probe,
  );
  printTable(
    ['CASE', 'VERDICT', 'CONF', 'BAND', 'TABLES', 'ASSUMPTIONS', 'METRIC'],
    shown.map((result) => [
      result.name,
      result.verdict + (result.reason ? `(${result.reason})` : ''),
      formatScore(result.expert?.confidence),
      !result.expert
        ? '-'
        : result.expert.traced
          ? (result.expert.band ?? '-')
          : 'no trace',
      formatShare(result.expert?.tablesCoverage),
      formatShare(result.expert?.assumptionsCoverage),
      formatMatch(result.expert?.metricMatched),
    ]),
  );

  const high = summary.bands.high;
  const target = `target ≥ ${Math.round(summary.highBandTarget * 100)}%`;
  const lines = [
    `Expert mode: ${summary.traced}/${summary.graded} graded answer(s) carried a reasoning trace`,
    summary.auroc !== undefined
      ? `  Headline   AUROC (overall confidence vs PASS): ${summary.auroc.toFixed(2)} over ${summary.traced} traced answer(s) (${summary.tracedPassed} pass / ${summary.tracedFailed} fail)`
      : `  Headline   AUROC: not measurable — needs at least one PASS and one FAIL among traced answers (have ${summary.tracedPassed} pass / ${summary.tracedFailed} fail)`,
    high.accuracy !== undefined
      ? `  Constraint high-band accuracy: ${high.correct}/${high.n} = ${formatShare(high.accuracy)} (${target}: ${summary.meetsHighBandTarget ? 'met' : 'NOT met'}); the high band holds ${formatShare(high.coverage)} of traced answers`
      : `  Constraint high-band accuracy: no traced answer was shown as high (${target}: not measurable)`,
    `  Bands      ${(['high', 'medium', 'low'] as const)
      .map((band) => {
        const entry = summary.bands[band];
        return `${band} ${entry.correct}/${entry.n}${entry.accuracy !== undefined ? ` = ${formatShare(entry.accuracy)}` : ''}`;
      })
      .join(' · ')}`,
  ];
  const { tables, assumptions, metric } = summary.coverage;
  lines.push(
    tables || assumptions || metric
      ? `  Coverage   ${[
          tables
            ? `tables ${formatShare(tables.mean)} (n=${tables.n})`
            : 'tables -',
          assumptions
            ? `assumptions ${formatShare(assumptions.mean)} (n=${assumptions.n})`
            : 'assumptions -',
          metric ? `metric ${metric.matched}/${metric.n} matched` : 'metric -',
        ].join(
          ' · ',
        )} — means over traced answers whose case declares expectedReasoning`
      : '  Coverage   no traced answer belongs to a case with expectedReasoning',
  );
  if (summary.probes) {
    const probes = summary.probes;
    lines.push(
      `  Probes     ${probes.run} ungraded case(s) run, ${probes.clarified} clarified, ${probes.traced} carried a trace`,
    );
    if (probes.tracedClarifications) {
      lines.push(
        `  ! ${probes.tracedClarifications} clarification turn(s) carried a reasoning trace — they should carry none`,
      );
    }
  }
  console.log('');
  for (const line of lines) console.log(line);
}

function formatScore(value: number | undefined): string {
  return value === undefined ? '-' : value.toFixed(2);
}

function formatShare(value: number | undefined): string {
  return value === undefined ? '-' : `${Math.round(value * 100)}%`;
}

function formatMatch(value: boolean | undefined): string {
  return value === undefined ? '-' : value ? 'yes' : 'no';
}

function printTable(header: string[], rows: string[][]): void {
  const widths = header.map((label, column) =>
    Math.max(label.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  console.log('');
  console.log(line(header));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) console.log(line(row));
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ------------------------------------------------------------- run log

/** Short commit of the tree that produced this run; absent outside a checkout. */
function gitCommit(): string | undefined {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

/** `frontend/package.json` is the single source of truth for the version. */
function appVersion(): string | undefined {
  const root = findRepoRoot();
  if (!root) return undefined;
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, 'frontend', 'package.json'), 'utf8'),
    ) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build and write the run record, then say where it landed.
 *
 * Costs are estimated from `logs/pricing.json` and token counts are measured,
 * so a model with no configured rate reports tokens and no money rather than a
 * confident wrong number — `costIncomplete` marks a total that is a floor.
 */
function recordRun(
  results: CaseResult[],
  options: Options,
  source: CaseSource,
  datasets: string[],
  model: string | undefined,
  startedAt: Date,
  expertSummary?: ExpertRunSummary,
): void {
  // `runs`/`passes` are extra keys the CLI adds when `--repeat` is used: the
  // shared record shape has no field for them, and a 4/5 case must not be
  // logged as a plain PASS or FAIL. Documented in `logs/README.md`.
  const logCases: (EvalRunLogCase & { runs?: number; passes?: number })[] =
    results.map((result) => ({
      id: result.name,
      ...(result.category ? { category: result.category } : {}),
      verdict: result.verdict,
      ...(result.reason ? { reason: result.reason } : {}),
      durationMs: result.durationMs,
      ...(result.runs && result.runs > 1
        ? { runs: result.runs, passes: result.passes }
        : {}),
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.usage
        ? { estimatedCostUsd: estimateCostUsd(model, result.usage, pricing()) }
        : {}),
      ...(result.expert ? { expert: expertLogCase(result) } : {}),
    }));
  const usage = sumUsage(results.map((result) => result.usage));
  const estimated = estimateCostUsd(model, usage, pricing());
  const observed = results.filter((result) => result.usage).length;
  const finishedAt = new Date();
  const version = appVersion();
  const commit = gitCommit();

  const record: EvalRunLogRecord = {
    schemaVersion: 1,
    runId: randomUUID(),
    ...(options.label ? { label: options.label } : {}),
    harness: options.validate ? 'validate' : 'golden-set',
    suite: source.suite,
    datasets,
    ...(model ? { model } : {}),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    ...(version ? { appVersion: version } : {}),
    ...(commit ? { gitCommit: commit } : {}),
    totals: {
      cases: results.length,
      passed: results.filter((r) => r.verdict === 'PASS').length,
      failed: results.filter((r) => r.verdict === 'FAIL').length,
      errored: results.filter((r) => r.verdict === 'ERROR').length,
      skipped: results.filter((r) => r.verdict === 'SKIP').length,
    },
    categories: tallyCategories(results),
    usage,
    ...(estimated !== undefined ? { estimatedCostUsd: estimated } : {}),
    ...(observed && estimated === undefined ? { costIncomplete: true } : {}),
    cases: logCases,
    ...(expertSummary ? { expert: expertSummary } : {}),
  };

  const written = writeRunLog(record);
  console.log('');
  if (written) {
    console.log(`Run log: ${written.file}`);
  } else {
    console.warn(
      `  ! could not write the run log (${resolveLogDir() ?? 'no logs/ folder found'}) — the run itself is unaffected`,
    );
  }
}

/**
 * A case's expert record as logged. With `--repeat`, every attempt's
 * (verdict, confidence) pair is kept so the run's AUROC can be recomputed
 * from the log alone.
 */
function expertLogCase(result: CaseResult): EvalRunLogExpertCase {
  const attempts = result.expertAttempts ?? [];
  return {
    ...result.expert!,
    ...(result.probe ? { clarified: !!result.clarified } : {}),
    ...(attempts.length > 1
      ? {
          attempts: attempts.map(({ verdict, record }) => ({
            verdict,
            traced: record.traced,
            ...(record.confidence !== undefined
              ? { confidence: record.confidence }
              : {}),
            ...(record.band ? { band: record.band } : {}),
          })),
        }
      : {}),
  };
}

let pricingCache: ReturnType<typeof loadPricing> | undefined;
function pricing(): ReturnType<typeof loadPricing> {
  return (pricingCache ??= loadPricing());
}

/** Tokens are exact; money is an estimate, and says so. */
function reportSpend(results: CaseResult[], model: string | undefined): void {
  const usage = sumUsage(results.map((result) => result.usage));
  console.log('');
  if (isUsageUnobserved(usage)) {
    console.log(
      'Tokens: not reported by the provider for this run (counts are never estimated here).',
    );
    return;
  }
  const cost = estimateCostUsd(model, usage, pricing());
  console.log(
    `Tokens: ${usage.inputTokens.toLocaleString()} in / ` +
      `${usage.outputTokens.toLocaleString()} out / ` +
      `${usage.totalTokens.toLocaleString()} total over ${usage.calls} turn(s)` +
      (cost === undefined
        ? ` — not priced (add "${model ?? 'the model'}" to logs/pricing.json)`
        : ` — est. $${cost.toFixed(4)} at logs/pricing.json rates`),
  );
}

// ---------------------------------------------------------------- main

/** Cases the filters selected, or a clear message about why none matched. */
function selectCases(source: CaseSource, options: Options): GoldenCase[] {
  let selected = source.cases;
  if (options.only) {
    selected = selected.filter((c) => c.name.includes(options.only!));
    if (!selected.length) {
      throw new EvalSetupError(
        `No case name in ${source.origin} contains "${options.only}"`,
      );
    }
  }
  if (options.category) {
    selected = selected.filter((c) =>
      (c.category ?? '').includes(options.category!),
    );
    if (!selected.length) {
      const known = [
        ...new Set(source.cases.map((c) => c.category).filter(Boolean)),
      ];
      throw new EvalSetupError(
        `No case in ${source.origin} has a category containing "${options.category}". ` +
          (known.length
            ? `Categories present: ${known.join(', ')}.`
            : 'No case in this set carries a "category".'),
      );
    }
  }
  return selected;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const source = options.suite
    ? loadSuiteCases(options.suite)
    : readCaseFile(options.file);
  const selected = selectCases(source, options);

  // Cases that cannot be graded here are reported, never silently dropped.
  const skipped: CaseResult[] = [];
  // `--expert` still runs ungraded cases once, for trace presence.
  const probeCases: GoldenCase[] = [];
  const runnable = selected.filter((testCase) => {
    if (!options.includePlaceholders && testCase.placeholder) {
      skipped.push(skip(testCase, 'placeholder', 'marked "placeholder": true'));
      return false;
    }
    if (!testCase.expectedSql) {
      if (options.expert) {
        probeCases.push(testCase);
        return false;
      }
      skipped.push(
        skip(
          testCase,
          'no-expected-sql',
          'the case has no reference SQL — it is graded in-app by checks or a judge',
        ),
      );
      return false;
    }
    return true;
  });
  if (!runnable.length && !probeCases.length) {
    const reasons = [...new Set(skipped.map((s) => s.reason))];
    throw new EvalSetupError(
      `Every selected case in ${source.origin} was skipped (${reasons.join(', ')}). ` +
        (reasons.includes('no-expected-sql')
          ? 'Cases without reference SQL are graded in-app by checks or a judge — ' +
            'give them a trusted `expectedSql`, or run them from Agents → Evals. '
          : '') +
        (reasons.includes('placeholder')
          ? 'Point the placeholder cases at a real dataset, replace `expectedSql` ' +
            'with trusted SQL and drop the `"placeholder": true` flag (see ' +
            'eval/README.md), or pass --include-placeholders to run them anyway.'
          : ''),
    );
  }

  const results: CaseResult[] = [];
  let model: string | undefined;
  const services = await boot(options.verbose);
  try {
    if (options.validate) {
      // No LLM preflight, no model, no session: a validate run must cost
      // nothing and must work on a machine with no provider configured.
      const datasourceIds = await resolveDatasources(services, runnable);
      console.log(
        `Validating ${runnable.length} reference quer${runnable.length === 1 ? 'y' : 'ies'} ` +
          `from ${source.origin} (row limit ${ROW_LIMIT}, zero model calls)`,
      );
      for (const testCase of runnable) {
        const result = await validateCase(
          services,
          testCase,
          datasourceIds.get(testCase.dataset)!,
        );
        results.push(result);
        console.log(
          `  ${result.status} ${testCase.name} — ${oneLine(result.detail)}`,
        );
      }
    } else {
      const ready = await preflight(services, [...runnable, ...probeCases]);
      model = ready.model;
      console.log(
        `Running ${runnable.length} case(s) from ${source.origin} ` +
          `(row limit ${ROW_LIMIT}, timeout ${Math.round(TURN_TIMEOUT_MS / 1000)}s` +
          (options.repeat > 1 ? `, ${options.repeat} runs per case` : '') +
          `, model ${model ?? 'unknown'}` +
          (options.expert
            ? `, business expert mode${probeCases.length ? ` + ${probeCases.length} ungraded probe(s)` : ''}`
            : '') +
          ')',
      );
      for (const testCase of runnable) {
        console.log(`\n▶ ${testCase.name}: ${oneLine(testCase.question)}`);
        const result = await runCaseRepeated(
          services,
          testCase,
          ready.datasourceIds.get(testCase.dataset)!,
          options,
        );
        results.push(result);
        console.log(
          `  ${result.verdict}${result.reason ? `(${result.reason})` : ''} — ${oneLine(result.detail)}`,
        );
        if (options.expert) {
          console.log(`    expert: ${describeExpert(result.expert)}`);
        }
      }
      for (const testCase of probeCases) {
        console.log(
          `\n▶ ${testCase.name} (ungraded — trace presence only): ${oneLine(testCase.question)}`,
        );
        const result = await runProbe(services, testCase, options);
        results.push(result);
        console.log(`  SKIP(${result.reason}) — ${oneLine(result.detail)}`);
      }
    }
  } finally {
    await services.app.close().catch(() => undefined);
  }

  results.push(...skipped);
  summarize(results, options);
  summarizeCategories(results);
  const expertSummary = options.expert ? expertSummaryOf(results) : undefined;
  if (expertSummary) reportExpert(results, expertSummary);
  if (!options.validate) reportSpend(results, model);
  if (options.log) {
    const datasets = [
      ...new Set([...runnable, ...probeCases].map((c) => c.dataset)),
    ];
    recordRun(
      results,
      options,
      source,
      datasets,
      model,
      startedAt,
      expertSummary,
    );
  }
  return results.some((r) => r.verdict === 'FAIL' || r.verdict === 'ERROR')
    ? 1
    : 0;
}

function skip(
  testCase: GoldenCase,
  reason: string,
  detail: string,
): CaseResult {
  return {
    name: testCase.name,
    category: testCase.category,
    verdict: 'SKIP',
    reason,
    detail,
    durationMs: 0,
  };
}

// Exported for ad-hoc checks and the unit test; the run only starts when
// invoked as a script.
export {
  compareResults,
  normalizeValue,
  loadGoldenSet,
  readCaseFile,
  lastSuccessfulSql,
  parseArgs,
  selectCases,
  summarizeCategories,
  expertSummaryOf,
  reportExpert,
  EvalSetupError,
};
export type { GoldenCase, CaseResult, CaseSource, Options };

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      if (error instanceof EvalSetupError) {
        console.error(`\n✖ ${error.message}\n`);
      } else {
        console.error('\n✖ Eval run crashed:');
        console.error(error);
      }
      process.exit(1);
    });
}
