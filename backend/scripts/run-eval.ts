/**
 * Golden-set evaluation harness — the CLI face of the improvement loop.
 *
 * Boots the backend as a Nest standalone application context (no HTTP) and
 * grades each case through the **shared harness** in
 * `src/mastra/evals/assistant.evals.ts` (`runAssistantEvalCaseRepeated`): the
 * production turn (`SessionsService.runTurn`), text checks on the final text,
 * the result-set check final-SQL-first, the LLM judge, and GAP when the
 * harness could not measure. The in-app runner calls the same function, so a
 * CLI run and an Agents → Evals run of the same suite score identically and
 * their logs compare field for field in History → Compare.
 *
 * What the CLI adds on top of that one function:
 *
 * - **Arms and loops.** `--arm fixer-off` (or `--engine sqlRepair=false,…`)
 *   switches the engine's levers for a run without a code change; `--suites`
 *   × `--arms` runs every cell sequentially under one `loopId` and prints the
 *   suite × arm matrix the next decision is made from.
 * - **pass^k.** `--repeat 3` runs every case three times; a case passes only
 *   when every attempt passed, and flaky cases are counted, not hidden.
 * - **`--validate`** checks every reference query (each
 *   `expectedSqlAlternatives` entry too, and every `trapSql`) against the
 *   live fixture with **zero model calls** — a reference that errors,
 *   returns nothing or equals its own trap cannot judge an answer, and
 *   finding that out during a paid run wastes the run.
 * - **Run log v2** on every terminal state (completed, failed, aborted) into
 *   `logs/evals/`, built by `eval-run-record.ts` like the in-app runner's.
 *
 * Run with `npm run eval` from `backend/`. See `eval/README.md`.
 */
// Must stay the first import: see scripts/lib/use-isolated-observability.ts.
import './lib/use-isolated-observability';
import { randomUUID } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, isAbsolute, join, resolve } from 'path';
import type { INestApplicationContext, LogLevel } from '@nestjs/common';
// Type-only imports: erased at runtime, so naming these services costs nothing
// until `boot()` actually loads the graph (see the WHY there).
import type { DatasourcesService } from '../src/modules/datasources/datasources.service';
import type { DatasetsRepository } from '../src/modules/datasets/repositories/datasets.repository';
import type { EngineSettingsService } from '../src/modules/engine/engine-settings.service';
import type { LlmSettingsView } from '../src/modules/llm/llm.types';
import type { SessionsService } from '../src/modules/sessions/sessions.service';
import type { SidePass } from '../src/modules/sessions/turn-result';
import type { DatasetSnapshot } from '../src/mastra/tool-services';
import type {
  EvalSuite,
  SuiteEvalCase,
} from '../src/mastra/evals/suite-loader';
// Result-set equality lives with the app code: careful mode's cross-check,
// the shared harness and `--validate`'s trap check must judge "same answer"
// exactly the same way. Pure module, so importing it eagerly pulls nothing in.
import {
  compareResults,
  normalizeValue,
} from '../src/modules/sessions/result-compare';
// Engine levers, token accounting, record building and the run log are pure
// modules shared with the in-app runner.
import {
  ARM_PRESETS,
  ENGINE_DEFAULTS,
  armOptions,
  describeEngineDiff,
  engineConfigHash,
  parseEngineOverride,
  resolveEngineOptions,
  sanitizeEngineOptions,
  type EngineOptions,
} from '../src/modules/engine/engine-options';
import {
  addUsage,
  isUsageUnobserved,
  normalizeModelId,
  representativeAttempt,
  type EvalRunLogAttempt,
  type EvalRunLogCaseV2,
  type EvalRunLogRecordV2,
  type EvalRunStatus,
  type EvalRunSummary,
  type EvalVerdict,
  type PricingTable,
  type TokenUsage,
} from '../src/modules/agents/eval-telemetry';
import {
  buildLogCase,
  buildRunLogRecordV2,
} from '../src/modules/agents/eval-run-record';
import {
  loadPricing,
  resolveLogDir,
  writeRunLog,
  type WrittenRunLog,
} from '../src/modules/agents/eval-run-log';

// Connectors clamp `runReadOnlySql` at 500 rows, so comparing more is moot.
const ROW_LIMIT = Number(process.env.EVAL_ROW_LIMIT ?? 500);
const TURN_TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 300_000);
const DEFAULT_GOLDEN_SET = join(__dirname, '..', 'eval', 'golden-set.json');
const SUITE_LOADER_PATH = '../src/mastra/evals/suite-loader';
/** Exit code for a flag the harness cannot honour (`--judge-model`). */
const EXIT_UNSUPPORTED = 2;
/** Conventional exit code for a run stopped by Ctrl-C. */
const EXIT_INTERRUPTED = 130;
const DEFAULT_ARM = 'baseline';

interface GoldenCase {
  /** Short identifier used in the summary table. Suite cases use their `id`. */
  name: string;
  /** The question sent to the assistant, exactly as a user would type it. */
  question: string;
  /** Saved dataset name the throwaway session is bound to. */
  dataset: string;
  /**
   * Failure class this case guards (`ratio-trap`, `ties`, `control`, …). The
   * unit the per-category table is grouped by; absent on the legacy World Cup
   * cases, which fall under `uncategorised`.
   */
  category?: string;
  /**
   * Trusted SQL whose live result set is the reference answer. Required in a
   * flat golden-set file; optional in a suite, where a case can be graded by
   * tool checks or a judge instead.
   */
  expectedSql?: string;
  /** Seed entries ship as placeholders; they are skipped unless forced. */
  placeholder?: boolean;
  notes?: string;
  /**
   * Suite-shaped files only: the tempting wrong query and per-dialect
   * references, so a suite can be validated by path while it is drafted.
   */
  trapSql?: string;
  expectedSqlByDialect?: { postgres?: string; databricks?: string };
  /** Suite-shaped files only: further equally correct references. */
  expectedSqlAlternatives?: string[];
  /**
   * The case as the shared harness grades it — set on registered suites
   * (`--suite`/`--suites`), where checks, the judge rubric, `trapSql` and the
   * per-dialect references come from the suite file. Absent on `--file`
   * cases, which `goldenToSuiteEvalCase` maps on demand.
   */
  evalCase?: SuiteEvalCase;
}

type Dialect = 'postgres' | 'databricks';
type DialectOption = 'auto' | Dialect;
const DIALECT_OPTIONS: readonly DialectOption[] = [
  'auto',
  'postgres',
  'databricks',
];

/**
 * `--validate` answers a different question than a graded run — "can this
 * reference judge anything?" — so it gets its own vocabulary. Every status
 * still maps onto a verdict so the exit code and the run log stay one code
 * path: WARN is a PASS that prints a warning (a reference returning nothing is
 * worth rewriting, not a broken build); TOO-MANY, TRAP-VACUOUS and TRAP-ERROR
 * are FAILs; ERROR is an ERROR.
 */
type ValidateStatus =
  'OK' | 'WARN' | 'TOO-MANY' | 'ERROR' | 'TRAP-VACUOUS' | 'TRAP-ERROR';

/** A misconfiguration the operator must fix — reported without a stack trace. */
class EvalSetupError extends Error {
  constructor(
    message: string,
    /** 1 for a setup problem; 2 for a flag the harness cannot honour. */
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

interface Options {
  file: string;
  /** True when `--file` was given, so `--suite`/`--suites` can reject the combination. */
  fileExplicit: boolean;
  suite?: string;
  /** `--suites a,b` — several registered suites; `['all']` = every suite on disk. */
  suites?: string[];
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
  /** `--arm <name>`: an `ARM_PRESETS` name or `custom:{json}`. Default `baseline`. */
  arm?: string;
  /** `--arms a,b`: a loop — every suite × every arm. Excludes `--arm`. */
  arms?: string[];
  /** `--engine k=v,…`, merged over the arm (later wins). */
  engine?: Partial<EngineOptions>;
  /** `--judge-model`: asserted against the pinned judge, never silently ignored. */
  judgeModel?: string;
  /** Which reference SQL to use; `auto` = the dataset's datasource kind. */
  dialect: DialectOption;
  /** Also run each case's paraphrase `variants` (`<id>~v1`, …). */
  includeVariants: boolean;
  /** Stop the run (and the loop) at the first case whose verdict is ERROR. */
  stopOnError: boolean;
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
    dialect: 'auto',
    includeVariants: false,
    stopOnError: false,
  };
  const value = (flag: string, index: number, what: string): string => {
    const next = argv[index];
    if (next === undefined || next === '') {
      throw new EvalSetupError(`${flag} needs ${what}`);
    }
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') {
      const path = value('--file', ++i, 'a path');
      if (options.suite || options.suites)
        throw new EvalSetupError(SUITE_AND_FILE);
      options.file = isAbsolute(path) ? path : resolve(process.cwd(), path);
      options.fileExplicit = true;
    } else if (arg === '--suite') {
      const id = value('--suite', ++i, 'a suite id');
      if (options.fileExplicit) throw new EvalSetupError(SUITE_AND_FILE);
      if (options.suites) throw new EvalSetupError(SUITE_AND_SUITES);
      options.suite = id;
    } else if (arg === '--suites') {
      const list = value(
        '--suites',
        ++i,
        'a comma-separated list of suite ids, or "all"',
      );
      if (options.fileExplicit) throw new EvalSetupError(SUITE_AND_FILE);
      if (options.suite) throw new EvalSetupError(SUITE_AND_SUITES);
      options.suites = parseSuiteList(list);
    } else if (arg === '--only' || arg === '-o') {
      options.only = value('--only', ++i, 'a case-name filter');
    } else if (arg === '--category' || arg === '-c') {
      options.category = value('--category', ++i, 'a substring');
    } else if (arg === '--label') {
      options.label = value('--label', ++i, 'a tag');
    } else if (arg === '--repeat') {
      const raw = argv[++i];
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new EvalSetupError(
          `--repeat needs a whole number of runs per case (got "${raw ?? ''}")`,
        );
      }
      options.repeat = parsed;
    } else if (arg === '--arm') {
      const arm = value(
        '--arm',
        ++i,
        'an arm name (e.g. baseline, fixer-off) or custom:{json}',
      );
      if (options.arms) throw new EvalSetupError(ARM_AND_ARMS);
      options.arm = checkArm(arm);
    } else if (arg === '--arms') {
      const list = value('--arms', ++i, 'a comma-separated list of arms');
      if (options.arm) throw new EvalSetupError(ARM_AND_ARMS);
      const arms = [...new Set(splitArmList(list).map(checkArm))];
      if (!arms.length)
        throw new EvalSetupError('--arms needs at least one arm');
      options.arms = arms;
    } else if (arg === '--engine') {
      const text = value(
        '--engine',
        ++i,
        'key=value pairs, e.g. sqlRepair=false,careful=auto',
      );
      let parsed: Partial<EngineOptions>;
      try {
        parsed = parseEngineOverride(text);
      } catch (error) {
        throw new EvalSetupError(`--engine: ${message(error)}`);
      }
      // Repeated `--engine` flags accumulate; a later key wins.
      options.engine = { ...options.engine, ...parsed };
    } else if (arg === '--judge-model') {
      const id = value(
        '--judge-model',
        ++i,
        'a router id, e.g. openai/gpt-4.1-mini',
      ).trim();
      if (!/^[^/\s]+\/\S+$/.test(id)) {
        throw new EvalSetupError(
          `--judge-model needs a <provider>/<model> router id, e.g. openai/gpt-4.1-mini (got "${id}")`,
        );
      }
      options.judgeModel = id;
    } else if (arg === '--dialect') {
      const dialect = value('--dialect', ++i, 'auto, postgres or databricks');
      if (!DIALECT_OPTIONS.includes(dialect as DialectOption)) {
        throw new EvalSetupError(
          `--dialect must be one of ${DIALECT_OPTIONS.join(', ')} (got "${dialect}")`,
        );
      }
      options.dialect = dialect as DialectOption;
    } else if (arg === '--include-variants') {
      options.includeVariants = true;
    } else if (arg === '--stop-on-error') {
      options.stopOnError = true;
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
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new EvalSetupError(`Unknown argument "${arg}" (try --help)`);
    }
  }
  if (options.validate) {
    // A validate run makes no model call, so a lever flag would do nothing —
    // and a user who passed one probably believes it did something.
    const graded = [
      options.arm && '--arm',
      options.arms && '--arms',
      options.engine && '--engine',
      options.judgeModel && '--judge-model',
    ].filter(Boolean);
    if (graded.length) {
      throw new EvalSetupError(
        `--validate runs reference SQL only (zero model calls), so ${graded.join(', ')} ` +
          'would have no effect. Drop them, or drop --validate for a graded run.',
      );
    }
  }
  return options;
}

const SUITE_AND_FILE =
  '--suite/--suites and --file are mutually exclusive: --suite runs a registered ' +
  'JSON suite from src/mastra/evals/suites, --file runs a case file by path';
const SUITE_AND_SUITES =
  '--suite and --suites are mutually exclusive: use --suites a,b to run several suites';
const ARM_AND_ARMS =
  '--arm and --arms are mutually exclusive: use --arms a,b to loop over several arms';

/** `a, b,a` → `['a', 'b']`; `all` must stand alone. */
function parseSuiteList(text: string): string[] {
  const ids = [
    ...new Set(
      text
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (!ids.length) {
    throw new EvalSetupError('--suites needs at least one suite id, or "all"');
  }
  if (ids.includes('all') && ids.length > 1) {
    throw new EvalSetupError(
      '--suites all already selects every suite — do not combine it with suite ids',
    );
  }
  return ids;
}

/** An arm name as `armOptions` accepts it; unknown names fail before any token. */
function checkArm(arm: string): string {
  const name = arm.trim();
  try {
    armOptions(name);
  } catch (error) {
    throw new EvalSetupError(message(error));
  }
  return name;
}

/**
 * Split `--arms` on top-level commas only: `custom:{"sqlRepair":false,"careful":"auto"}`
 * carries commas inside its JSON, and splitting there would turn one arm
 * into two broken ones.
 */
function splitArmList(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      current += ch;
      if (ch === '\\' && i + 1 < text.length) current += text[++i];
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * The overrides a cell runs with: the arm's preset, then `--engine` on top.
 * Settings → Engine levers stay underneath — `runTurn` resolves these over
 * the saved production defaults, which is what `baseline` means.
 */
function armEngineOverrides(
  arm: string | undefined,
  engine: Partial<EngineOptions> | undefined,
): Partial<EngineOptions> {
  // Same merge as the harness's `mergeEngineOverrides` (not imported: that
  // module loads Mastra, and this one must stay cheap to import).
  return {
    ...sanitizeEngineOptions(armOptions(arm)),
    ...sanitizeEngineOptions(engine ?? {}),
  };
}

/** `auto` → the dataset's datasource kind; an explicit dialect wins. */
function resolveDialect(
  option: DialectOption,
  kind: string | undefined,
): Dialect | undefined {
  if (option !== 'auto') return option;
  return kind === 'postgres' || kind === 'databricks' ? kind : undefined;
}

function printUsage(): void {
  console.log(
    [
      'Usage: npm run eval -- [options]',
      '',
      'Cases',
      '  -f, --file <path>          case file to run (default eval/golden-set.json)',
      '      --suite <id>           run a registered JSON suite from',
      '                             src/mastra/evals/suites (excludes --file)',
      '      --suites <a,b|all>     run several registered suites, one log each',
      '                             (excludes --suite and --file)',
      '  -o, --only <substring>     run only cases whose name contains <substring>',
      '  -c, --category <substring> run only cases whose category contains <substring>',
      "      --include-variants     also run each case's paraphrase variants",
      '                             (<id>~v1, …); graded runs only',
      '      --include-placeholders run cases still marked "placeholder": true',
      '',
      'Engine',
      '      --arm <name>           lever preset for the run (default baseline =',
      '                             Settings → Engine levers), or custom:{json}',
      '      --arms <a,b>           loop: every suite × every arm, sequentially,',
      '                             one log per cell plus a loop matrix',
      '      --engine <k=v,...>     lever overrides merged over the arm, e.g.',
      '                             sqlRepair=false,careful=auto,promptAblation=visuals+ratio',
      '      --judge-model <id>     assert the judge model (pinned in Settings →',
      '                             Engine levers); exits 2 when it differs',
      '      --dialect <d>          auto (the datasource kind), postgres or',
      '                             databricks — picks the reference SQL',
      '',
      'Run',
      '      --repeat <n>           attempts per case; a case passes only if every',
      '                             attempt passes — pass^n (default 1)',
      '      --stop-on-error        stop at the first case whose verdict is ERROR',
      "      --validate             run every case's reference SQL (and trapSql)",
      '                             and stop: zero model calls, no LLM needed',
      '      --label <text>         tag recorded in the run log (e.g. iter0-gpt5)',
      '      --no-log               do not write a run log into logs/evals',
      '      --keep-sessions        do not delete the throwaway sessions',
      '  -v, --verbose              show Nest logs and per-attempt SQL',
      '  -h, --help                 show this message',
      '',
      'Examples',
      '  npm run eval -- --suites all --repeat 3 --arms baseline --label iter0-gpt5',
      '  npm run eval -- --suite health-insurance --repeat 3 --arms baseline,fixer-off',
      '  npm run eval:validate -- --suites all',
      '  npm run eval:diff -- <before.json> <after.json> [--markdown]',
      '',
      'Env: EVAL_ROW_LIMIT (validate row cap, default 500), EVAL_TIMEOUT_MS',
      '     (per turn, default 300000), APP_DATA_DIR (datastore location — must',
      '     match the desktop app), EVAL_LOG_DIR (run-log folder; default <repo>/logs).',
      '',
      `Arms: ${Object.keys(ARM_PRESETS).join(', ')}, custom:{json}`,
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
  /** The loaded suite, for registered suites only. */
  registered?: EvalSuite;
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
 *
 * `expandVariants` returns the cases the shared harness grades; each is kept
 * whole on `evalCase` (never spread — its lazy `scorers` getter would load
 * Mastra for a caller that only wants the data).
 */
function loadSuiteCases(id: string, includeVariants: boolean): CaseSource {
  const loader = suiteLoader();
  let suite: EvalSuite;
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
    registered: suite,
    cases: loader.expandVariants(suite, includeVariants).map((evalCase) => ({
      name: evalCase.id,
      ...(evalCase.category ? { category: evalCase.category } : {}),
      question: evalCase.question,
      dataset,
      ...(evalCase.expectedSql ? { expectedSql: evalCase.expectedSql } : {}),
      evalCase,
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

/** The suite ids a run selects, `all` expanded; undefined for a `--file` run. */
function selectedSuiteIds(options: Options): string[] | undefined {
  if (options.suite) return [options.suite];
  if (!options.suites) return undefined;
  if (options.suites[0] !== 'all') return options.suites;
  const ids = safeSuiteIds(suiteLoader());
  if (!ids.length) {
    throw new EvalSetupError(
      'No suites found under src/mastra/evals/suites — nothing for --suites all to run',
    );
  }
  return ids;
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
 * their own, and may omit `expectedSql`. A `--file` case is graded by its
 * result set only (`goldenToSuiteEvalCase` gives it no text checks), so one
 * without `expectedSql` is skipped — register the file as a suite to grade
 * its checks and rubric.
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
  const byDialect = suiteShaped
    ? dialectReferences(value.expectedSqlByDialect)
    : undefined;
  const alternatives = suiteShaped
    ? alternativeReferences(value.expectedSqlAlternatives, where)
    : undefined;
  if (alternatives && !expectedSql) {
    throw new EvalSetupError(
      `${where} has "expectedSqlAlternatives" but no "expectedSql" for them to be alternatives to`,
    );
  }
  return {
    name,
    question,
    dataset,
    ...(text('category') ? { category: text('category') } : {}),
    ...(expectedSql ? { expectedSql } : {}),
    ...(value.placeholder === true ? { placeholder: true } : {}),
    ...(text('notes') ? { notes: text('notes') } : {}),
    ...(suiteShaped && text('trapSql') ? { trapSql: text('trapSql') } : {}),
    ...(byDialect ? { expectedSqlByDialect: byDialect } : {}),
    ...(alternatives ? { expectedSqlAlternatives: alternatives } : {}),
  };
}

/**
 * `expectedSqlAlternatives` as a suite file writes it. Unlike a malformed
 * dialect map, a malformed list is an error: a validator that quietly drops
 * a reference it was asked to check is how a broken one ships.
 */
function alternativeReferences(
  value: unknown,
  where: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some((sql) => typeof sql !== 'string' || !sql.trim())
  ) {
    throw new EvalSetupError(
      `${where} has an "expectedSqlAlternatives" that is not a non-empty array of SQL strings`,
    );
  }
  return value as string[];
}

/** `expectedSqlByDialect` as a suite file writes it; anything malformed is ignored. */
function dialectReferences(
  value: unknown,
): GoldenCase['expectedSqlByDialect'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const raw = value as Record<string, unknown>;
  const pick = (key: Dialect) => {
    const sql = raw[key];
    return typeof sql === 'string' && sql.trim() ? { [key]: sql } : {};
  };
  const references = { ...pick('postgres'), ...pick('databricks') };
  return Object.keys(references).length ? references : undefined;
}

/** Back-compatible entry point: the cases of a file, in file order. */
function loadGoldenSet(file: string): GoldenCase[] {
  return readCaseFile(file).cases;
}

/**
 * A golden-set case as the shared harness grades it: no text checks, just
 * the reference SQL — the result-set check is the whole verdict, exactly what
 * this CLI always measured for a flat file.
 */
function goldenToSuiteEvalCase(golden: GoldenCase): SuiteEvalCase {
  const evalCase: SuiteEvalCase = {
    id: golden.name,
    ...(golden.category ? { category: golden.category } : {}),
    question: golden.question,
    intent: '',
    checks: [],
    ...(golden.expectedSql ? { expectedSql: golden.expectedSql } : {}),
    ...(golden.expectedSqlByDialect
      ? { expectedSqlByDialect: golden.expectedSqlByDialect }
      : {}),
    ...(golden.expectedSqlAlternatives
      ? { expectedSqlAlternatives: golden.expectedSqlAlternatives }
      : {}),
  };
  return evalCase;
}

function toSuiteEvalCase(testCase: GoldenCase): SuiteEvalCase {
  return testCase.evalCase ?? goldenToSuiteEvalCase(testCase);
}

/** Cases the filters selected, or a clear message about why none matched. */
function selectCases<T extends { name: string; category?: string }>(
  source: { origin: string; cases: T[] },
  options: Pick<Options, 'only' | 'category'>,
): T[] {
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

interface SkippedCase {
  testCase: GoldenCase;
  reason: 'placeholder' | 'no-expected-sql';
  detail: string;
}

/** One source, selected and split into what runs and what is reported as SKIP. */
interface PreparedSource {
  source: CaseSource;
  runnable: GoldenCase[];
  skipped: SkippedCase[];
}

type Mode = 'graded' | 'validate';

/**
 * Cases that cannot be graded (or validated) here are reported, never
 * silently dropped. A registered suite case without `expectedSql` is graded
 * by its checks and rubric; only a `--file` case with nothing to compare, or
 * a validate case with no reference, is skipped.
 */
function partitionCases(
  cases: GoldenCase[],
  options: Pick<Options, 'includePlaceholders'>,
  mode: Mode,
): { runnable: GoldenCase[]; skipped: SkippedCase[] } {
  const runnable: GoldenCase[] = [];
  const skipped: SkippedCase[] = [];
  for (const testCase of cases) {
    if (!options.includePlaceholders && testCase.placeholder) {
      skipped.push({
        testCase,
        reason: 'placeholder',
        detail: 'marked "placeholder": true',
      });
      continue;
    }
    const byDialect =
      testCase.evalCase?.expectedSqlByDialect ?? testCase.expectedSqlByDialect;
    const hasReference =
      !!testCase.expectedSql ||
      !!byDialect?.postgres ||
      !!byDialect?.databricks;
    if (
      mode === 'validate' ? !hasReference : !testCase.evalCase && !hasReference
    ) {
      skipped.push({
        testCase,
        reason: 'no-expected-sql',
        detail:
          mode === 'validate'
            ? 'no reference SQL to validate — the case is graded by checks or a judge'
            : 'no reference SQL and no checks — register the file as a suite to grade its checks',
      });
      continue;
    }
    runnable.push(testCase);
  }
  return { runnable, skipped };
}

function allSkippedMessage(source: CaseSource, skipped: SkippedCase[]): string {
  const reasons = [...new Set(skipped.map((s) => s.reason))];
  return (
    `Every selected case in ${source.origin} was skipped (${reasons.join(', ')}). ` +
    (reasons.includes('no-expected-sql')
      ? 'Cases without reference SQL are graded by checks or a judge — give them a ' +
        'trusted `expectedSql`, or register the file as a suite and run it with --suite. '
      : '') +
    (reasons.includes('placeholder')
      ? 'Point the placeholder cases at a real dataset, replace `expectedSql` ' +
        'with trusted SQL and drop the `"placeholder": true` flag (see ' +
        'eval/README.md), or pass --include-placeholders to run them anyway.'
      : '')
  );
}

/**
 * Every source the run selects, filtered and partitioned. With one source a
 * filter that matches nothing is an error (as it always was); with several
 * (`--suites`), a suite the filter does not touch is skipped with a note —
 * `--category ratio-trap` over every suite should run the suites that have
 * that category, not fail on the first one that does not.
 */
function prepareSources(options: Options, mode: Mode): PreparedSource[] {
  const ids = selectedSuiteIds(options);
  const includeVariants = mode === 'graded' && options.includeVariants;
  const sources = ids
    ? ids.map((id) => loadSuiteCases(id, includeVariants))
    : [readCaseFile(options.file)];
  const prepared: PreparedSource[] = [];
  for (const source of sources) {
    try {
      const { runnable, skipped } = partitionCases(
        selectCases(source, options),
        options,
        mode,
      );
      if (!runnable.length) {
        throw new EvalSetupError(allSkippedMessage(source, skipped));
      }
      prepared.push({ source, runnable, skipped });
    } catch (error) {
      if (sources.length === 1 || !(error instanceof EvalSetupError))
        throw error;
      console.warn(`  ! ${source.suite}: not run — ${error.message}`);
    }
  }
  if (!prepared.length) {
    throw new EvalSetupError(
      'No selected suite has a case to run for these filters.',
    );
  }
  return prepared;
}

// ------------------------------------------------------------- runtime

/**
 * Services resolved from the Nest context. Held as an object so `--validate`
 * can use the datasource half without ever naming `LlmService` or the shared
 * harness.
 */
interface Services {
  app: INestApplicationContext;
  sessions: SessionsService;
  datasources: DatasourcesService;
  datasets: DatasetsRepository;
  /** The resolved `LlmService` view, only ever fetched by the graded preflight. */
  llmView: () => Promise<LlmSettingsView>;
  /** Settings → Engine levers (production defaults, pinned judge). */
  engineSettings: () => EngineSettingsService;
  /** Dataset snapshots as the tools see them, for the suite preflight. */
  datasetSnapshots: (names: string[]) => Promise<DatasetSnapshot[]>;
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
      const { LlmService } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../src/modules/llm/llm.service') as typeof import('../src/modules/llm/llm.service');
      return app.get(LlmService).getView();
    },
    engineSettings: () => {
      const { EngineSettingsService: Service } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../src/modules/engine/engine-settings.service') as typeof import('../src/modules/engine/engine-settings.service');
      return app.get(Service);
    },
    datasetSnapshots: (names) => {
      const { getDatasetToolServices } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../src/mastra/tool-services') as typeof import('../src/mastra/tool-services');
      return getDatasetToolServices().getDatasets(names);
    },
  };
}

/**
 * The shared harness, loaded only on the graded path. It pulls in
 * `@mastra/core` and the agents, which `--help`, `--validate` and the unit
 * test must never pay for (same WHY as `boot`).
 */
function sharedHarness(): typeof import('../src/mastra/evals/assistant.evals') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../src/mastra/evals/assistant.evals') as typeof import('../src/mastra/evals/assistant.evals');
}

interface ResolvedDataset {
  datasourceId: string;
  kind?: Dialect;
}

async function resolveDataset(
  services: Services,
  name: string,
  cache: Map<string, ResolvedDataset>,
): Promise<ResolvedDataset> {
  const cached = cache.get(name);
  if (cached) return cached;
  const [dataset] = await services.datasets.getByNames([name]);
  if (!dataset) {
    const saved = (await services.datasets.list()).map((s) => s.name);
    throw new EvalSetupError(
      `Dataset "${name}" does not exist in this datastore. ` +
        (saved.length
          ? `Saved datasets: ${saved.join(', ')}.`
          : 'No datasets are saved — create one in the app first.'),
    );
  }
  const datasourceId =
    dataset.datasourceId ??
    (await services.datasources.defaultDatasource())?.id;
  if (!datasourceId) {
    throw new EvalSetupError(
      `Dataset "${name}" has no datasource bound and no datasource is saved — ` +
        'configure a connection in the app first.',
    );
  }
  try {
    await services.datasources.runReadOnlySql(datasourceId, 'SELECT 1', 1);
  } catch (error) {
    throw new EvalSetupError(
      `Datasource for dataset "${name}" is not reachable — ${message(error)}`,
    );
  }
  let kind: string | undefined = dataset.datasourceKind;
  if (!kind) {
    try {
      kind = (await services.datasources.get(datasourceId)).kind;
    } catch {
      kind = undefined;
    }
  }
  const resolved: ResolvedDataset = {
    datasourceId,
    ...(kind === 'postgres' || kind === 'databricks' ? { kind } : {}),
  };
  cache.set(name, resolved);
  return resolved;
}

/**
 * The model id that will actually answer, for the run log — mirroring
 * `LlmService.resolveAgentModel`: the saved `<provider>/<model>` for every
 * provider (openai, lenai, databricks), else the env fallback.
 */
function modelRouterId(
  view: Pick<LlmSettingsView, 'provider' | 'model' | 'configured'>,
): string {
  return view.configured && view.model
    ? `${view.provider ?? 'openai'}/${view.model}`
    : 'openai/gpt-4o-mini';
}

/**
 * `--judge-model` is an assertion, not an override: the judge is pinned in
 * Settings → Engine levers (so changing the assistant's model does not move
 * the ruler), and the shared harness reads it from there. A flag that differs
 * would otherwise be silently ignored — so say how to pin it instead.
 */
function judgeModelMismatch(
  requested: string | undefined,
  pinned: string | undefined,
  assistantModel: string,
): string | undefined {
  if (!requested) return undefined;
  const effective = pinned ?? assistantModel;
  if (requested.trim().toLowerCase() === effective.trim().toLowerCase()) {
    return undefined;
  }
  const port = process.env.BACKEND_PORT ?? '3000';
  return [
    `--judge-model ${requested} differs from the judge this run would use: ${effective} ` +
      (pinned
        ? '(pinned in Settings → Engine levers).'
        : "(nothing pinned, so the judge runs on the assistant's own model)."),
    'The judge model is pinned in Settings, not per run, so this flag cannot change it — ' +
      'and a run that silently used a different ruler would not be comparable. Pin it first:',
    `  • in the app: Settings → Engine levers → Judge model = ${requested} → Save, or`,
    `  • with the backend running on this APP_DATA_DIR: curl -X PUT http://localhost:${port}/engine/settings ` +
      `-H 'Content-Type: application/json' -d '{"judgeModel":"${requested}"}'`,
    'Then re-run without --judge-model, or with the same value to assert it.',
  ].join('\n');
}

/** What a graded run needs to know before it spends a token. */
interface GradedEnv {
  services: Services;
  options: Options;
  /** `<provider>/<model>` — for the log and the price lookup. */
  model: string;
  /** Settings → LLM effort, when no arm overrides it. */
  llmEffort?: string;
  /** Settings → Engine levers, resolved: what `baseline` means. */
  defaults: EngineOptions;
  pinnedJudge?: string;
  datasets: Map<string, ResolvedDataset>;
  /** The sessions service the harness gets — a keep-alive wrapper under `--keep-sessions`. */
  sessions: SessionsService;
  keptSessions: string[];
}

/**
 * Graded-run preflight, for every cell before the first: an LLM must be
 * configured, `--judge-model` must match the pinned judge, every dataset must
 * resolve to a reachable datasource, and a registered suite's saved scope
 * must contain its `requiredEntities` (the same check the in-app runner
 * makes). A loop that fails its third cell's preflight after paying for two
 * would waste both.
 */
async function preflight(
  services: Services,
  options: Options,
  prepared: PreparedSource[],
): Promise<GradedEnv> {
  const llm = await services.llmView();
  if (!llm.configured && !process.env.OPENAI_API_KEY) {
    throw new EvalSetupError(
      'No LLM configured. Save provider/model/API key in the app ' +
        '(Settings → LLM) using the same APP_DATA_DIR as this run, or export ' +
        'OPENAI_API_KEY to use the gpt-4o-mini fallback.',
    );
  }
  const model = modelRouterId(llm);

  let defaults: EngineOptions;
  let pinnedJudge: string | undefined;
  try {
    const settings = services.engineSettings();
    defaults = await settings.resolved();
    pinnedJudge = await settings.judgeModel();
  } catch {
    defaults = resolveEngineOptions();
    pinnedJudge = undefined;
  }
  const mismatch = judgeModelMismatch(options.judgeModel, pinnedJudge, model);
  if (mismatch) throw new EvalSetupError(mismatch, EXIT_UNSUPPORTED);

  const datasets = new Map<string, ResolvedDataset>();
  for (const { source, runnable } of prepared) {
    for (const name of new Set(runnable.map((c) => c.dataset))) {
      const resolved = await resolveDataset(services, name, datasets);
      const dialect = resolveDialect(options.dialect, resolved.kind);
      if (
        options.dialect !== 'auto' &&
        resolved.kind &&
        resolved.kind !== dialect
      ) {
        console.warn(
          `  ! --dialect ${options.dialect}, but dataset "${name}" is on a ${resolved.kind} ` +
            'datasource — dialect-specific reference SQL will likely fail (GAP).',
        );
      }
    }
    if (source.registered) {
      const names = [...new Set(runnable.map((c) => c.dataset))];
      const error = suiteLoader().suiteDatasetError(
        source.registered,
        names,
        await services.datasetSnapshots(names),
      );
      if (error) throw new EvalSetupError(error);
    }
  }

  const keptSessions: string[] = [];
  return {
    services,
    options,
    model,
    llmEffort: llm.reasoningEffort,
    defaults,
    pinnedJudge,
    datasets,
    sessions: options.keepSessions
      ? keepSessionsWrapper(services.sessions, keptSessions)
      : services.sessions,
    keptSessions,
  };
}

/**
 * `--keep-sessions` without a harness flag: the shared harness deletes each
 * attempt's throwaway session in a `finally`, so hand it a sessions service
 * whose `delete` only records the id. Everything else is the real service.
 */
function keepSessionsWrapper(
  sessions: SessionsService,
  kept: string[],
): SessionsService {
  return new Proxy(sessions, {
    get(target, prop, receiver) {
      if (prop === 'delete') {
        return (id: string) => {
          kept.push(id);
          return Promise.resolve(undefined);
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}

/** Ctrl-C: first press stops after the current attempt, second exits now. */
class InterruptState {
  readonly controller = new AbortController();
  aborted = false;
  /** Writes the in-flight cell's partial log; set while a cell runs. */
  flush?: (status: EvalRunStatus) => void;

  private readonly handler = (): void => {
    if (!this.aborted) {
      this.aborted = true;
      console.warn(
        '\n  ! Interrupted — stopping after the current attempt and writing the run log ' +
          '(Ctrl-C again to exit now).',
      );
      this.controller.abort();
      return;
    }
    this.flush?.('aborted');
    console.warn('  ! Exiting now.');
    process.exit(EXIT_INTERRUPTED);
  };

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  install(): void {
    process.on('SIGINT', this.handler);
  }

  uninstall(): void {
    process.off('SIGINT', this.handler);
  }
}

/** One suite × arm of a graded run. */
interface Cell extends PreparedSource {
  arm: string;
}

interface CellResult {
  suite: string;
  arm: string;
  record: EvalRunLogRecordV2;
  written?: WrittenRunLog;
  /** Why the run stopped early, when it did — the loop stops with it. */
  stopped?: 'aborted' | 'stop-on-error' | 'crashed';
}

/** The part of the shared harness's `EvalCaseOutcome` the CLI reads. */
interface CaseOutcomeLike {
  logCase: EvalRunLogCaseV2;
  engine?: EngineOptions;
  configHash?: string;
  judgeModel?: string;
  sidePassUsage?: Partial<Record<SidePass, TokenUsage>>;
  /** The abort signal fired during the case — its attempts are incomplete. */
  stopped?: boolean;
}

async function runCell(
  env: GradedEnv,
  harness: ReturnType<typeof sharedHarness>,
  cell: Cell,
  state: InterruptState,
  loopId: string | undefined,
  sink: CellResult[],
): Promise<CellResult> {
  const { options } = env;
  const overrides = armEngineOverrides(cell.arm, options.engine);
  const fallbackEngine = resolveEngineOptions(env.defaults, overrides);
  const effort = fallbackEngine.reasoningEffort ?? env.llmEffort;
  const fallbackHash = engineConfigHash(fallbackEngine, {
    model: env.model,
    reasoningEffort: effort,
  });
  const datasets = [...new Set(cell.runnable.map((c) => c.dataset))];
  const kinds = [
    ...new Set(
      datasets
        .map((name) => env.datasets.get(name)?.kind)
        .filter((kind): kind is Dialect => !!kind),
    ),
  ];
  const dialectFor = (testCase: GoldenCase): Dialect | undefined =>
    resolveDialect(options.dialect, env.datasets.get(testCase.dataset)?.kind);
  const dialects = [
    ...new Set(
      cell.runnable
        .map(dialectFor)
        .filter((dialect): dialect is Dialect => !!dialect),
    ),
  ];
  const levers = describeEngineDiff(fallbackEngine, ENGINE_DEFAULTS);

  console.log(
    `\nRunning ${cell.runnable.length} case(s) from ${cell.source.origin} — arm ${cell.arm}` +
      (options.repeat > 1 ? `, pass^${options.repeat}` : '') +
      `, model ${env.model}${effort ? ` (effort ${effort})` : ''}` +
      `, timeout ${Math.round(TURN_TIMEOUT_MS / 1000)}s` +
      (dialects.length ? `, dialect ${dialects.join('/')}` : ''),
  );
  console.log(
    `Levers vs today's engine: ${levers.length ? levers.join(', ') : "none (today's engine)"}`,
  );

  const startedAt = new Date();
  const outcomes: CaseOutcomeLike[] = [];
  let status: EvalRunStatus = 'completed';
  let error: string | undefined;
  let notReached = 0;
  let stopped: CellResult['stopped'];
  let record: EvalRunLogRecordV2 | undefined;
  let written: WrittenRunLog | undefined;

  const finish = (forced?: EvalRunStatus): EvalRunLogRecordV2 => {
    if (record) return record;
    if (forced) {
      status = forced;
      error ??= 'interrupted (SIGINT)';
      notReached = cell.runnable.length - outcomes.length;
    }
    record = buildCliRunRecord({
      runId: randomUUID(),
      label: options.label,
      harness: 'golden-set',
      suite: cell.source.suite,
      datasets,
      ...(kinds.length === 1 ? { datasourceKind: kinds[0] } : {}),
      ...(dialects.length === 1 ? { dialect: dialects[0] } : {}),
      model: env.model,
      reasoningEffort: effort,
      judgeModel: env.pinnedJudge,
      repeat: options.repeat,
      arm: cell.arm,
      engineFallback: fallbackEngine,
      configHashFallback: fallbackHash,
      loopId,
      startedAt,
      finishedAt: new Date(),
      outcomes,
      skipped: cell.skipped.map(skippedLogCase),
      notReached,
      pricing: pricing(),
      status,
      error,
    });
    if (options.log) written = writeRunLog(record);
    return record;
  };
  state.flush = finish;

  let result: CellResult | undefined;
  try {
    for (let index = 0; index < cell.runnable.length; index++) {
      if (state.aborted) {
        notReached = cell.runnable.length - index;
        status = 'aborted';
        error = 'interrupted (SIGINT)';
        stopped = 'aborted';
        break;
      }
      const testCase = cell.runnable[index];
      console.log(`\n▶ ${testCase.name}: ${oneLine(testCase.question)}`);
      const outcome: CaseOutcomeLike =
        await harness.runAssistantEvalCaseRepeated(
          toSuiteEvalCase(testCase),
          {
            sessions: env.sessions,
            datasets: [testCase.dataset],
            ...(cell.source.registered
              ? { suite: cell.source.registered }
              : {}),
            engine: overrides,
            arm: cell.arm,
            dialect: dialectFor(testCase),
            timeoutMs: TURN_TIMEOUT_MS,
            abortSignal: state.signal,
          },
          options.repeat,
          {
            onAttempt: (attempt) =>
              printAttempt(attempt, options.repeat, options.verbose),
            pricing: { model: env.model, table: pricing() },
          },
        );
      if (state.aborted || outcome.stopped) {
        // The case was cut short: its last attempt says "stopped", not how
        // the engine did. Leave it out rather than log it as an ERROR.
        notReached = cell.runnable.length - index;
        status = 'aborted';
        error = 'interrupted (SIGINT)';
        stopped = 'aborted';
        break;
      }
      outcomes.push(outcome);
      console.log(`  ${caseLine(outcome.logCase)}`);
      if (options.stopOnError && outcome.logCase.verdict === 'ERROR') {
        notReached = cell.runnable.length - index - 1;
        status = 'failed';
        error = `stopped after ${testCase.name} errored (--stop-on-error)`;
        stopped = 'stop-on-error';
        break;
      }
    }
  } catch (err) {
    status = 'failed';
    error = message(err);
    notReached = cell.runnable.length - outcomes.length;
    stopped = 'crashed';
    throw err;
  } finally {
    state.flush = undefined;
    const final = finish();
    result = {
      suite: cell.source.suite,
      arm: cell.arm,
      record: final,
      ...(written ? { written } : {}),
      ...(stopped ? { stopped } : {}),
    };
    sink.push(result);
    printCellReport(result, options, env.model);
  }
  return result;
}

/**
 * A graded run: every selected suite × every arm, one after the other. Exit
 * code 1 when any case FAILed or ERRORed, 130 when interrupted, 0 otherwise —
 * a GAP does not fail the run (it is the harness's fault, not the engine's),
 * but it is printed as loudly as a failure.
 */
async function runGraded(options: Options): Promise<number> {
  const prepared = prepareSources(options, 'graded');
  const arms = options.arms ?? [options.arm ?? DEFAULT_ARM];
  const cells: Cell[] = prepared.flatMap((source) =>
    arms.map((arm) => ({ ...source, arm })),
  );
  const loop = cells.length > 1 || options.arms !== undefined;
  const loopId = loop ? randomUUID() : undefined;
  const loopStartedAt = new Date();
  const results: CellResult[] = [];
  const state = new InterruptState();
  let env: GradedEnv | undefined;
  let crashed = false;

  const services = await boot(options.verbose);
  try {
    env = await preflight(services, options, prepared);
    const harness = sharedHarness();
    if (loop) {
      console.log(
        `Loop ${loopId!.slice(0, 8)}: ${prepared.length} suite(s) × ${arms.length} arm(s) = ` +
          `${cells.length} run(s), repeat ${options.repeat}`,
      );
    }
    state.install();
    for (const cell of cells) {
      const result = await runCell(env, harness, cell, state, loopId, results);
      if (result.stopped) break;
    }
  } catch (error) {
    crashed = true;
    throw error;
  } finally {
    state.uninstall();
    if (loop && results.length) {
      finishLoop(
        loopId!,
        loopStartedAt,
        options,
        env?.model,
        prepared.map((p) => p.source.suite),
        arms,
        results,
        crashed,
      );
    }
    if (env?.keptSessions.length) {
      console.log(
        `\nKept ${env.keptSessions.length} throwaway session(s) (--keep-sessions): ` +
          env.keptSessions.join(', '),
      );
    }
    await services.app.close().catch(() => undefined);
  }

  if (results.some((result) => result.stopped === 'aborted')) {
    return EXIT_INTERRUPTED;
  }
  return results.some((result) =>
    result.record.cases.some(
      (item) => item.verdict === 'FAIL' || item.verdict === 'ERROR',
    ),
  )
    ? 1
    : 0;
}

// ------------------------------------------------------------ run log

interface CliRunRecordInput {
  runId: string;
  label?: string;
  harness: 'golden-set' | 'validate';
  suite: string;
  datasets: string[];
  datasourceKind?: Dialect;
  dialect?: string;
  model?: string;
  reasoningEffort?: string;
  /** Fallback when no outcome reported the judge it ran on. */
  judgeModel?: string;
  repeat: number;
  arm?: string;
  /** Used when no outcome carried the engine it ran with (nothing ran). */
  engineFallback: EngineOptions;
  configHashFallback: string;
  loopId?: string;
  startedAt: Date;
  finishedAt: Date;
  outcomes: CaseOutcomeLike[];
  /** Cases selected but not run (placeholders, nothing to grade). */
  skipped: EvalRunLogCaseV2[];
  /** Cases selected but never reached (aborted, stopped, crashed). */
  notReached: number;
  pricing: PricingTable;
  status: EvalRunStatus;
  error?: string;
  /** Tests pass a fixed value; defaults to `runEnvironment()`. */
  environment?: { appVersion?: string; gitCommit?: string };
}

/**
 * The CLI's v2 record: the harness's folded cases, then the skipped ones,
 * through the same `buildRunLogRecordV2` the in-app runner uses. The engine
 * and config hash are the ones the turns actually reported (`runTurn`
 * resolves them over Settings); the fallback only fills in a run that never
 * reached a turn.
 */
function buildCliRunRecord(input: CliRunRecordInput): EvalRunLogRecordV2 {
  const engine =
    input.outcomes.find((outcome) => outcome.engine)?.engine ??
    input.engineFallback;
  const configHash =
    input.outcomes.find((outcome) => outcome.configHash)?.configHash ??
    input.configHashFallback;
  const judgeModel =
    input.outcomes.find((outcome) => outcome.judgeModel)?.judgeModel ??
    input.judgeModel;
  const sidePassUsage = mergeSidePassUsage(
    input.outcomes.map((outcome) => outcome.sidePassUsage),
  );
  return buildRunLogRecordV2({
    runId: input.runId,
    ...(input.label ? { label: input.label } : {}),
    harness: input.harness,
    suite: input.suite,
    datasets: input.datasets,
    ...(input.datasourceKind ? { datasourceKind: input.datasourceKind } : {}),
    ...(input.dialect ? { dialect: input.dialect } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.reasoningEffort
      ? { reasoningEffort: input.reasoningEffort }
      : {}),
    ...(judgeModel ? { judgeModel } : {}),
    repeat: input.repeat,
    ...(input.arm ? { arm: input.arm } : {}),
    engine,
    configHash,
    ...(input.loopId ? { loopId: input.loopId } : {}),
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    cases: [
      ...input.outcomes.map((outcome) => outcome.logCase),
      ...input.skipped,
    ],
    ...(input.notReached > 0 ? { notReached: input.notReached } : {}),
    pricing: input.pricing,
    status: input.status,
    ...(input.error ? { error: input.error } : {}),
    ...(sidePassUsage ? { sidePassUsage } : {}),
    ...(input.environment ? { environment: input.environment } : {}),
  });
}

/** Per side pass, the sum over every case that measured it. */
function mergeSidePassUsage(
  items: readonly (Partial<Record<SidePass, TokenUsage>> | undefined)[],
): Partial<Record<SidePass, TokenUsage>> | undefined {
  const merged: Partial<Record<SidePass, TokenUsage>> = {};
  for (const item of items) {
    for (const [pass, usage] of Object.entries(item ?? {}) as [
      SidePass,
      TokenUsage | undefined,
    ][]) {
      if (!usage) continue;
      const current = merged[pass];
      merged[pass] = current ? addUsage(current, usage) : { ...usage };
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

/** A case that never ran, as its v2 log entry: SKIP, zero runs, the reason. */
function skippedLogCase(skipped: SkippedCase): EvalRunLogCaseV2 {
  const { testCase } = skipped;
  return {
    ...buildLogCase(
      {
        id: testCase.name,
        ...(testCase.category ? { category: testCase.category } : {}),
        question: testCase.question,
      },
      [],
    ),
    reason: skipped.reason,
  };
}

let pricingCache: PricingTable | undefined;
function pricing(): PricingTable {
  return (pricingCache ??= loadPricing());
}

// -------------------------------------------------------------- output

function printAttempt(
  attempt: EvalRunLogAttempt,
  repeat: number,
  verbose: boolean,
): void {
  const label = attempt.failureLabel ? `(${attempt.failureLabel})` : '';
  const tokens =
    attempt.usage && attempt.usage.calls > 0
      ? ` · ${attempt.usage.totalTokens.toLocaleString('en-US')} tok`
      : '';
  const detail = attemptDetail(attempt);
  console.log(
    `  · run ${attempt.attempt}/${repeat} ${attempt.verdict}${label} ` +
      `${seconds(attempt.durationMs)}${tokens}${detail ? ` — ${oneLine(detail).slice(0, 160)}` : ''}`,
  );
  if (verbose && attempt.finalSql) {
    console.log(`    sql: ${oneLine(attempt.finalSql)}`);
  }
}

/**
 * Why an attempt landed where it did, in one line: what threw, the gap the
 * harness hit, the first failing check — or, on a PASS, how many checks held.
 */
function attemptDetail(attempt: EvalRunLogAttempt | undefined): string {
  if (!attempt) return '';
  if (attempt.error) return attempt.error;
  const checks = attempt.checks ?? [];
  const failed =
    (attempt.verdict === 'GAP'
      ? checks.find((check) => check.gap)
      : checks.find((check) => !check.passed && !check.gap)) ??
    checks.find((check) => !check.passed);
  if (failed) return `${failed.id}: ${failed.reason ?? 'failed'}`;
  if (attempt.verdict === 'PASS') {
    return (
      `${checks.length} check${checks.length === 1 ? '' : 's'} passed` +
      (attempt.viaSupportingQuery ? ' (result matched an earlier query)' : '')
    );
  }
  if (attempt.clarification) return `asked: "${attempt.clarification}"`;
  return '';
}

function verdictText(item: EvalRunLogCaseV2): string {
  const qualifier =
    item.failureLabel ?? (item.verdict !== 'PASS' ? item.reason : undefined);
  return `${item.verdict}${qualifier ? `(${qualifier})` : ''}`;
}

/**
 * `passes/runs`, plus the attempts that did not count: a GAP draw is no
 * evidence about the engine, so `foldAttempts` leaves it out of `runs` — and a
 * bare `0/0` would hide that the case did run.
 */
function runsText(item: EvalRunLogCaseV2): string {
  const gaps = (item.attempts ?? []).filter(
    (attempt) => attempt.verdict === 'GAP',
  ).length;
  return `${item.passes}/${item.runs}${gaps ? ` +${gaps} gap` : ''}`;
}

function caseLine(item: EvalRunLogCaseV2): string {
  const detail = attemptDetail(representativeAttempt(item.attempts));
  return (
    `${verdictText(item)} ${runsText(item)}${item.flaky ? ' flaky' : ''}` +
    (detail ? ` — ${oneLine(detail).slice(0, 160)}` : '')
  );
}

function printCellReport(
  result: CellResult,
  options: Options,
  model: string,
): void {
  const { record } = result;
  const rows = record.cases.map((item) => [
    item.id,
    verdictText(item),
    item.verdict === 'SKIP' ? '-' : runsText(item),
    item.verdict === 'SKIP' ? '-' : seconds(item.durationMs),
    item.usage && item.usage.calls > 0
      ? item.usage.totalTokens.toLocaleString('en-US')
      : '-',
    oneLine(
      item.verdict === 'SKIP'
        ? skipDetail(item.reason)
        : attemptDetail(representativeAttempt(item.attempts)),
    ).slice(0, 80),
  ]);
  printTable(['CASE', 'VERDICT', 'RUNS', 'TIME', 'TOKENS', 'DETAIL'], rows);
  summarizeCategories(record.summary.byCategory, record.repeat);

  console.log('');
  console.log(
    `${record.suite} · arm ${record.arm ?? DEFAULT_ARM}: ${formatHeadline(record)}`,
  );
  const count = (verdict: EvalVerdict) =>
    record.cases.filter((item) => item.verdict === verdict).length;
  console.log(
    `${record.totals.cases} cases — ${count('PASS')} passed, ${count('FAIL')} failed, ` +
      `${count('ERROR')} errored, ${count('GAP')} gap, ${record.totals.skipped} skipped` +
      (record.status !== 'completed'
        ? ` — run ${record.status}${record.error ? `: ${record.error}` : ''}`
        : ''),
  );
  reportSpend(record, model);
  const gaps = record.cases.filter((item) => item.verdict === 'GAP');
  if (gaps.length) {
    console.warn('');
    console.warn(
      `  ⚠ ${gaps.length} GAP case(s): ${gaps.map((item) => item.id).join(', ')}`,
    );
    console.warn(
      '  ⚠ GAP = the harness could not measure — fix the harness, not the engine.',
    );
  }
  console.log('');
  if (!options.log) return;
  if (result.written) {
    console.log(
      `Run log${record.status === 'completed' ? '' : ` (${record.status})`}: ${result.written.file}`,
    );
  } else {
    console.warn(
      `  ! could not write the run log (${resolveLogDir()}) — the run itself is unaffected`,
    );
  }
}

function skipDetail(reason: string | undefined): string {
  return reason === 'placeholder'
    ? 'marked "placeholder": true'
    : reason === 'no-expected-sql'
      ? 'nothing to compare: no reference SQL'
      : (reason ?? '');
}

/**
 * The run in one line, the way the improvement loop reads it:
 * `pass^3 12/19 (63%) · mean 71% · 2 flaky · 1 gap · answered 19/19 · $0.42/correct`.
 */
function formatHeadline(
  record: Pick<
    EvalRunLogRecordV2,
    'summary' | 'repeat' | 'estimatedCostUsd' | 'usage'
  >,
): string {
  const { summary } = record;
  const parts = [
    `pass^${record.repeat} ${summary.passK}/${summary.scored} (${percent(summary.passKRate)})`,
    `mean ${percent(summary.meanPassRate)}`,
    `${summary.flaky} flaky`,
    `${summary.gaps} gap${summary.gaps === 1 ? '' : 's'}`,
    `answered ${summary.answeredEveryTime}/${summary.answeredObserved}`,
  ];
  if (summary.costPerCorrectUsd !== undefined) {
    parts.push(`${formatUsd(summary.costPerCorrectUsd)}/correct`);
  } else if (isUsageUnobserved(record.usage)) {
    parts.push('tokens not reported');
  } else if (record.estimatedCostUsd !== undefined) {
    parts.push(`${formatUsd(record.estimatedCostUsd)} spent, 0 correct`);
  } else {
    parts.push('not priced');
  }
  return parts.join(' · ');
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatUsd(value: number): string {
  return `$${value >= 0.01 || value === 0 ? value.toFixed(2) : value.toFixed(4)}`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Per-category pass^k, worst first.
 *
 * The loop is steered by which failure class is failing, not by the total, so
 * the eye should land on the worst row without scanning. GAP and SKIP are
 * excluded by `summarizeCases` — a case that was not measured cannot lower a
 * rate.
 */
function summarizeCategories(
  byCategory: EvalRunSummary['byCategory'],
  repeat = 1,
): void {
  const names = Object.keys(byCategory);
  if (!names.length) return;
  const rate = (name: string) =>
    byCategory[name].total
      ? byCategory[name].passK / byCategory[name].total
      : 0;
  names.sort(
    (a, b) =>
      rate(a) - rate(b) ||
      byCategory[b].total - byCategory[a].total ||
      a.localeCompare(b),
  );
  printTable(
    ['CATEGORY', `PASS^${repeat}/TOTAL`, 'RATE', 'MEAN'],
    names.map((name) => [
      name,
      `${byCategory[name].passK}/${byCategory[name].total}`,
      percent(rate(name)),
      percent(byCategory[name].meanPassRate),
    ]),
  );
}

/** Tokens are exact; money is an estimate, and says so. */
function reportSpend(
  record: EvalRunLogRecordV2,
  model: string | undefined,
): void {
  const usage = record.usage;
  console.log('');
  if (isUsageUnobserved(usage)) {
    console.log(
      'Tokens: not reported by the provider for this run (counts are never estimated here).',
    );
    return;
  }
  const cost = record.estimatedCostUsd;
  console.log(
    `Tokens: ${usage.inputTokens.toLocaleString('en-US')} in / ` +
      `${usage.outputTokens.toLocaleString('en-US')} out / ` +
      `${usage.totalTokens.toLocaleString('en-US')} total over ${usage.calls} call(s)` +
      (cost === undefined
        ? ` — not priced (add "${model ? normalizeModelId(model) : 'the model'}" to logs/pricing.json)`
        : ` — est. $${cost.toFixed(4)} at logs/pricing.json rates`),
  );
  const sides = Object.entries(record.sidePassUsage ?? {}).filter(
    ([, side]) => side && side.calls > 0,
  );
  if (sides.length) {
    console.log(
      `  of which side passes: ${sides
        .map(
          ([pass, side]) =>
            `${pass} ${side.totalTokens.toLocaleString('en-US')}`,
        )
        .join(' · ')}`,
    );
  }
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

// ---------------------------------------------------------------- loop

/** One suite × arm cell of a loop, as the matrix and the loop file show it. */
interface LoopCell {
  suite: string;
  arm: string;
  model?: string;
  status: EvalRunStatus;
  passK: number;
  scored: number;
  passKRate: number;
  meanPassRate: number;
  flaky: number;
  gaps: number;
  /** Total tokens, or undefined when the provider reported none. */
  tokens?: number;
  costUsd?: number;
  costPerCorrectUsd?: number;
  configHash: string;
  runId: string;
  /** The run log's basename under `logs/evals/`. */
  file?: string;
}

function loopCell(record: EvalRunLogRecordV2, file?: string): LoopCell {
  return {
    suite: record.suite,
    arm: record.arm ?? DEFAULT_ARM,
    ...(record.model ? { model: record.model } : {}),
    status: record.status,
    passK: record.summary.passK,
    scored: record.summary.scored,
    passKRate: record.summary.passKRate,
    meanPassRate: record.summary.meanPassRate,
    flaky: record.summary.flaky,
    gaps: record.summary.gaps,
    ...(record.usage.calls > 0 ? { tokens: record.usage.totalTokens } : {}),
    ...(record.estimatedCostUsd !== undefined
      ? { costUsd: record.estimatedCostUsd }
      : {}),
    ...(record.summary.costPerCorrectUsd !== undefined
      ? { costPerCorrectUsd: record.summary.costPerCorrectUsd }
      : {}),
    configHash: record.configHash,
    runId: record.runId,
    ...(file ? { file: basename(file) } : {}),
  };
}

/** The suite × arm matrix: the table a lever decision is made from. */
function loopMatrixTable(
  cells: LoopCell[],
  repeat: number,
): { header: string[]; rows: string[][] } {
  return {
    header: [
      'SUITE',
      'ARM',
      `PASS^${repeat}`,
      'MEAN',
      'FLAKY',
      'GAPS',
      'TOKENS',
      '$/CORRECT',
      'STATUS',
      'LOG',
    ],
    rows: cells.map((cell) => [
      cell.suite,
      cell.arm,
      `${cell.passK}/${cell.scored} (${percent(cell.passKRate)})`,
      percent(cell.meanPassRate),
      String(cell.flaky),
      String(cell.gaps),
      cell.tokens !== undefined ? cell.tokens.toLocaleString('en-US') : 'n/a',
      cell.costPerCorrectUsd !== undefined
        ? formatUsd(cell.costPerCorrectUsd)
        : cell.tokens === undefined
          ? 'n/a'
          : 'not priced',
      cell.status,
      cell.file ?? '-',
    ]),
  };
}

/** What `logs/evals/loops/<date>-<loopId8>.json` holds. */
interface LoopSummaryFile {
  loopId: string;
  label?: string;
  harness: 'golden-set';
  repeat: number;
  model?: string;
  suites: string[];
  arms: string[];
  startedAt: string;
  finishedAt: string;
  status: 'completed' | 'failed' | 'aborted';
  rows: LoopCell[];
}

function loopFilename(loopId: string, startedAt: Date): string {
  return `${startedAt.toISOString().slice(0, 10)}-${loopId.slice(0, 8)}.json`;
}

function finishLoop(
  loopId: string,
  startedAt: Date,
  options: Options,
  model: string | undefined,
  suites: string[],
  arms: string[],
  results: CellResult[],
  crashed: boolean,
): void {
  const rows = results.map((result) =>
    loopCell(result.record, result.written?.file),
  );
  const { header, rows: table } = loopMatrixTable(rows, options.repeat);
  console.log(
    `\nLoop ${loopId.slice(0, 8)} — suite × arm, pass^${options.repeat}`,
  );
  printTable(header, table);
  const status: LoopSummaryFile['status'] = results.some(
    (result) => result.stopped === 'aborted',
  )
    ? 'aborted'
    : crashed || results.some((result) => result.record.status === 'failed')
      ? 'failed'
      : 'completed';
  if (!options.log) return;
  const summary: LoopSummaryFile = {
    loopId,
    ...(options.label ? { label: options.label } : {}),
    harness: 'golden-set',
    repeat: options.repeat,
    ...(model ? { model } : {}),
    suites,
    arms,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status,
    rows,
  };
  try {
    const dir = join(resolveLogDir(), 'evals', 'loops');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, loopFilename(loopId, startedAt));
    writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(`\nLoop summary: ${file}`);
  } catch (error) {
    console.warn(`  ! could not write the loop summary — ${message(error)}`);
  }
}

// ------------------------------------------------------------ validate

type Row = Record<string, unknown>;

interface QueryOutcome {
  rows?: Row[];
  error?: string;
}

interface ValidateDecision {
  status: ValidateStatus;
  verdict: 'PASS' | 'FAIL' | 'ERROR';
  reason: string;
  detail: string;
  /**
   * Set when the status is about an `expectedSqlAlternatives` entry (its
   * 0-based index) rather than the primary reference: it errored, hit the
   * cap, returned nothing, or equals the trap.
   */
  alternativeIndex?: number;
}

/**
 * Would the grader accept the trap's result as the answer? Same comparison
 * the result-set check makes: width- and precision-tolerant, but a trap that
 * projects fewer columns than the reference omits reference values, which
 * the grader rejects — so it is not vacuous.
 */
function trapMatchesReference(reference: Row[], trap: Row[]): boolean {
  const width = (rows: Row[]) => Object.keys(rows[0] ?? {}).length;
  if (reference.length && trap.length && width(trap) < width(reference)) {
    return false;
  }
  return compareResults(reference, trap, {
    widthTolerant: true,
    precisionTolerant: true,
  }).match;
}

const rowsText = (count: number) => `${count} row${count === 1 ? '' : 's'}`;

/**
 * The validate verdict for one case, from what its references and trap
 * returned. Order matters: a reference that cannot run or truncates is
 * reported before its trap, because nothing can be concluded from a trap
 * compared against an untrustworthy reference. Every
 * `expectedSqlAlternatives` entry is held to the primary's rules (ERROR,
 * TOO-MANY, WARN), and the trap must differ from ALL of them: the grader
 * passes an answer that matches any reference, so a trap equal to one
 * alternative is as vacuous as a trap equal to the primary.
 */
function decideValidateStatus(input: {
  reference: QueryOutcome;
  /** `expectedSqlAlternatives`, in file order. */
  alternatives?: QueryOutcome[];
  trap?: QueryOutcome;
  rowLimit: number;
}): ValidateDecision {
  const { reference, alternatives = [], trap, rowLimit } = input;
  const references = [reference, ...alternatives];
  // Details about the primary read as they always have; one about an
  // alternative names it, so the operator knows which SQL to fix.
  const about = (index: number) =>
    index === 0 ? {} : { alternativeIndex: index - 1 };
  const named = (index: number, detail: string) =>
    index === 0 ? detail : `expectedSqlAlternatives[${index - 1}]: ${detail}`;
  const ran: Row[][] = [];
  for (const [index, outcome] of references.entries()) {
    if (outcome.error !== undefined || !outcome.rows) {
      return {
        status: 'ERROR',
        verdict: 'ERROR',
        reason: 'sql-error',
        detail: named(
          index,
          outcome.error ?? 'the reference returned no result',
        ),
        ...about(index),
      };
    }
    const count = outcome.rows.length;
    if (count >= rowLimit) {
      return {
        status: 'TOO-MANY',
        verdict: 'FAIL',
        reason: 'too-many-rows',
        detail: named(
          index,
          `${count} rows at the ${rowLimit}-row cap — both sides are truncated, so the comparison is untrustworthy; aggregate the reference down`,
        ),
        ...about(index),
      };
    }
    ran.push(outcome.rows);
  }
  // Every reference ran below the cap from here on.
  const counts = ran.map((rows) => rows.length);
  if (trap) {
    if (trap.error !== undefined || !trap.rows) {
      return {
        status: 'TRAP-ERROR',
        verdict: 'FAIL',
        reason: 'trap-error',
        detail: `trapSql failed to run — ${trap.error ?? 'no result'}`,
      };
    }
    for (const [index, rows] of ran.entries()) {
      if (trapMatchesReference(rows, trap.rows)) {
        return {
          status: 'TRAP-VACUOUS',
          verdict: 'FAIL',
          reason: 'trap-vacuous',
          detail:
            index === 0
              ? `the tempting wrong query returns the right answer, so this case tests nothing (${rowsText(trap.rows.length)} each)`
              : `the tempting wrong query returns the answer of expectedSqlAlternatives[${index - 1}], so this case tests nothing (${rowsText(trap.rows.length)} each)`,
          ...about(index),
        };
      }
    }
  }
  const trapNote = trap
    ? `; trap differs (${rowsText(trap.rows!.length)})`
    : '';
  const empty = counts.findIndex((count) => count === 0);
  if (empty !== -1) {
    return {
      status: 'WARN',
      verdict: 'PASS',
      reason: 'empty',
      detail:
        empty === 0
          ? `the reference returns no rows — it cannot tell a right answer from a wrong one${trapNote}`
          : `expectedSqlAlternatives[${empty - 1}] returns no rows — it cannot tell a right answer from a wrong one${trapNote}`,
      ...about(empty),
    };
  }
  const alternativeNote = alternatives.length
    ? `; ${alternatives.length} alternative${alternatives.length === 1 ? '' : 's'} (${counts
        .slice(1)
        .map(rowsText)
        .join(', ')})`
    : '';
  return {
    status: 'OK',
    verdict: 'PASS',
    reason: '',
    detail: `${rowsText(counts[0])}${alternativeNote}${trapNote}`,
  };
}

interface ValidateRow {
  name: string;
  category?: string;
  question: string;
  status: ValidateStatus | 'SKIP';
  verdict: EvalVerdict;
  reason: string;
  detail: string;
  referenceRows?: number;
  trapRows?: number;
  referenceSql?: string;
  referenceError?: string;
  trapSql?: string;
  trapError?: string;
  /** Each `expectedSqlAlternatives` entry, as it ran. */
  alternatives?: ValidateAlternative[];
  /** See `ValidateDecision.alternativeIndex`. */
  alternativeIndex?: number;
  dialect?: Dialect;
  durationMs: number;
}

interface ValidateAlternative {
  sql: string;
  rows?: number;
  error?: string;
}

/**
 * `N references — a ok, b warn(empty), c too many rows, d errored, e trap-vacuous, f skipped`,
 * with `(+k alternatives)` after N when cases carry alternatives. N stays the
 * case count: the statuses are per case, alternatives included.
 */
function validateSummaryLine(
  rows: readonly { status: string; alternatives?: readonly unknown[] }[],
): string {
  const count = (...statuses: string[]) =>
    rows.filter((row) => statuses.includes(row.status)).length;
  const alternatives = rows.reduce(
    (sum, row) => sum + (row.alternatives?.length ?? 0),
    0,
  );
  return (
    `${rows.length} references${alternatives ? ` (+${alternatives} alternative${alternatives === 1 ? '' : 's'})` : ''} — ` +
    `${count('OK')} ok, ${count('WARN')} warn(empty), ` +
    `${count('TOO-MANY')} too many rows, ${count('ERROR', 'TRAP-ERROR')} errored, ` +
    `${count('TRAP-VACUOUS')} trap-vacuous, ${count('SKIP')} skipped`
  );
}

async function runQuery(
  services: Services,
  datasourceId: string,
  sql: string,
): Promise<QueryOutcome> {
  try {
    return {
      rows: (
        await services.datasources.runReadOnlySql(datasourceId, sql, ROW_LIMIT)
      ).rows,
    };
  } catch (error) {
    return { error: message(error) };
  }
}

/**
 * `--validate`: run the case's reference SQL for its dialect — and its
 * `trapSql`, when it has one — and report what they return. Nothing here
 * touches a model, a session or the agent graph: a fixture's references can
 * be checked for free, as often as they are edited.
 */
async function validateCase(
  services: Services,
  testCase: GoldenCase,
  resolved: ResolvedDataset,
  dialectOption: DialectOption,
): Promise<ValidateRow> {
  const started = Date.now();
  const dialect = resolveDialect(dialectOption, resolved.kind);
  const [referenceSql, ...alternativeSqls] = suiteLoader().referenceSqlsFor(
    testCase.evalCase ?? testCase,
    dialect,
  );
  const trapSql = testCase.evalCase?.trapSql ?? testCase.trapSql;
  const reference = await runQuery(
    services,
    resolved.datasourceId,
    referenceSql,
  );
  // Every alternative runs even when the primary broke: the point of a free
  // check is to see every problem at once.
  const alternatives: QueryOutcome[] = [];
  for (const sql of alternativeSqls) {
    alternatives.push(await runQuery(services, resolved.datasourceId, sql));
  }
  // A reference that errors or truncates has nothing to compare a trap to.
  const trap =
    trapSql &&
    [reference, ...alternatives].every(
      (outcome) => outcome.rows && outcome.rows.length < ROW_LIMIT,
    )
      ? await runQuery(services, resolved.datasourceId, trapSql)
      : undefined;
  const decision = decideValidateStatus({
    reference,
    alternatives,
    trap,
    rowLimit: ROW_LIMIT,
  });
  return {
    name: testCase.name,
    ...(testCase.category ? { category: testCase.category } : {}),
    question: testCase.question,
    ...decision,
    ...(reference.rows ? { referenceRows: reference.rows.length } : {}),
    ...(trap?.rows ? { trapRows: trap.rows.length } : {}),
    referenceSql,
    ...(reference.error !== undefined
      ? { referenceError: reference.error }
      : {}),
    ...(trapSql ? { trapSql } : {}),
    ...(trap?.error !== undefined ? { trapError: trap.error } : {}),
    ...(alternativeSqls.length
      ? {
          alternatives: alternativeSqls.map((sql, index) => ({
            sql,
            ...(alternatives[index].rows
              ? { rows: alternatives[index].rows.length }
              : {}),
            ...(alternatives[index].error !== undefined
              ? { error: alternatives[index].error }
              : {}),
          })),
        }
      : {}),
    ...(dialect ? { dialect } : {}),
    durationMs: Date.now() - started,
  };
}

function skippedValidateRow(skipped: SkippedCase): ValidateRow {
  return {
    name: skipped.testCase.name,
    ...(skipped.testCase.category
      ? { category: skipped.testCase.category }
      : {}),
    question: skipped.testCase.question,
    status: 'SKIP',
    verdict: 'SKIP',
    reason: skipped.reason,
    detail: skipped.detail,
    durationMs: 0,
  };
}

/**
 * A validate row as its v2 log entry: one attempt whose checks are the
 * reference (and the trap), whose SQL list carries the statements and row
 * counts — never the rows.
 */
function validateLogCase(row: ValidateRow): EvalRunLogCaseV2 {
  const meta = {
    id: row.name,
    ...(row.category ? { category: row.category } : {}),
    question: row.question,
  };
  if (row.status === 'SKIP') {
    return { ...buildLogCase(meta, []), reason: row.reason };
  }
  // ERROR / TOO-MANY name one reference: the primary, or the alternative
  // `alternativeIndex` points at. The trap is only judged when all ran.
  const referencesOk = row.status !== 'ERROR' && row.status !== 'TOO-MANY';
  const onAlternative = row.alternativeIndex !== undefined;
  const referenceOk = referencesOk || onAlternative;
  const alternativesOk = referencesOk || !onAlternative;
  const attempt: EvalRunLogAttempt = {
    attempt: 1,
    verdict: row.verdict,
    checks: [
      {
        id: 'reference-sql',
        passed: referenceOk,
        ...(referenceOk ? {} : { reason: row.detail }),
      },
      ...(row.alternatives?.length
        ? [
            {
              id: 'alternative-sql',
              passed: alternativesOk,
              ...(alternativesOk ? {} : { reason: row.detail }),
            },
          ]
        : []),
      ...(row.trapSql && referencesOk
        ? [
            {
              id: 'trap-sql',
              passed:
                row.status !== 'TRAP-VACUOUS' && row.status !== 'TRAP-ERROR',
              ...(row.status === 'TRAP-VACUOUS' || row.status === 'TRAP-ERROR'
                ? { reason: row.detail }
                : {}),
            },
          ]
        : []),
    ],
    ...(row.referenceSql ? { finalSql: row.referenceSql } : {}),
    sql: [
      ...(row.referenceSql
        ? [
            {
              sql: row.referenceSql,
              ok: row.referenceError === undefined,
              ...(row.referenceError !== undefined
                ? { error: row.referenceError }
                : {}),
              ...(row.referenceRows !== undefined
                ? { rowCount: row.referenceRows }
                : {}),
            },
          ]
        : []),
      ...(row.alternatives ?? []).map((alternative) => ({
        sql: alternative.sql,
        ok: alternative.error === undefined,
        ...(alternative.error !== undefined
          ? { error: alternative.error }
          : {}),
        ...(alternative.rows !== undefined
          ? { rowCount: alternative.rows }
          : {}),
      })),
      ...(row.trapSql &&
      (row.trapRows !== undefined || row.trapError !== undefined)
        ? [
            {
              sql: row.trapSql,
              ok: row.trapError === undefined,
              ...(row.trapError !== undefined ? { error: row.trapError } : {}),
              ...(row.trapRows !== undefined ? { rowCount: row.trapRows } : {}),
            },
          ]
        : []),
    ],
    steps: 0,
    calledTools: [],
    repairs: [],
    warnings: row.status === 'WARN' ? [row.detail] : [],
    durationMs: row.durationMs,
  };
  return buildLogCase(meta, [attempt]);
}

/** A validate run as a v2 record, so History lists it next to graded runs. */
function buildValidateRecord(input: {
  runId: string;
  label?: string;
  suite: string;
  datasets: string[];
  datasourceKind?: Dialect;
  dialect?: string;
  startedAt: Date;
  finishedAt: Date;
  rows: ValidateRow[];
  environment?: { appVersion?: string; gitCommit?: string };
}): EvalRunLogRecordV2 {
  return buildRunLogRecordV2({
    runId: input.runId,
    ...(input.label ? { label: input.label } : {}),
    harness: 'validate',
    suite: input.suite,
    datasets: input.datasets,
    ...(input.datasourceKind ? { datasourceKind: input.datasourceKind } : {}),
    ...(input.dialect ? { dialect: input.dialect } : {}),
    repeat: 1,
    engine: resolveEngineOptions(),
    configHash: 'validate',
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    cases: input.rows.map(validateLogCase),
    pricing: {},
    status: 'completed',
    ...(input.environment ? { environment: input.environment } : {}),
  });
}

function printValidateTable(rows: ValidateRow[]): void {
  printTable(
    ['CASE', 'STATUS', 'ROWS', 'TRAP', 'TIME', 'DETAIL'],
    rows.map((row) => [
      row.name,
      row.status,
      // `12+12`: the primary's rows, then each alternative's.
      [row.referenceRows, ...(row.alternatives ?? []).map((a) => a.rows)]
        .map((count) => (count !== undefined ? String(count) : '-'))
        .join('+'),
      row.trapRows !== undefined
        ? String(row.trapRows)
        : row.trapError !== undefined
          ? 'error'
          : '-',
      row.status === 'SKIP' ? '-' : seconds(row.durationMs),
      oneLine(row.detail).slice(0, 80),
    ]),
  );
}

/**
 * Validate every selected source. With `--suites`, a suite whose dataset
 * cannot be resolved is reported and counted as a failure, and the others
 * still validate — the point of a free check is to see every problem at once.
 */
async function runValidate(options: Options): Promise<number> {
  const prepared = prepareSources(options, 'validate');
  const services = await boot(options.verbose);
  const cache = new Map<string, ResolvedDataset>();
  const all: ValidateRow[] = [];
  let setupFailures = 0;
  try {
    for (const { source, runnable, skipped } of prepared) {
      const startedAt = new Date();
      try {
        for (const name of new Set(runnable.map((c) => c.dataset))) {
          await resolveDataset(services, name, cache);
        }
      } catch (error) {
        if (prepared.length === 1 || !(error instanceof EvalSetupError))
          throw error;
        console.error(`\n✖ ${source.suite}: ${error.message}`);
        setupFailures++;
        continue;
      }
      const traps = runnable.filter(
        (c) => c.evalCase?.trapSql ?? c.trapSql,
      ).length;
      const alternatives = runnable.reduce(
        (sum, c) =>
          sum +
          (
            c.evalCase?.expectedSqlAlternatives ??
            c.expectedSqlAlternatives ??
            []
          ).length,
        0,
      );
      console.log(
        `\nValidating ${runnable.length} reference quer${runnable.length === 1 ? 'y' : 'ies'}` +
          (alternatives
            ? ` (+${alternatives} alternative${alternatives === 1 ? '' : 's'})`
            : '') +
          (traps ? ` and ${traps} trap${traps === 1 ? '' : 's'}` : '') +
          ` from ${source.origin} (row limit ${ROW_LIMIT}, dialect ${options.dialect}, zero model calls)`,
      );
      const rows: ValidateRow[] = [];
      for (const testCase of runnable) {
        const row = await validateCase(
          services,
          testCase,
          cache.get(testCase.dataset)!,
          options.dialect,
        );
        rows.push(row);
        console.log(
          `  ${row.status} ${testCase.name} — ${oneLine(row.detail)}`,
        );
      }
      rows.push(...skipped.map(skippedValidateRow));
      printValidateTable(rows);
      console.log('');
      console.log(validateSummaryLine(rows));
      const warned = rows.filter((row) => row.status === 'WARN');
      if (warned.length) {
        console.warn(
          `  ⚠ ${warned.length} reference(s) return no rows and cannot tell a right answer ` +
            `from a wrong one — rewrite them: ${warned.map((row) => row.name).join(', ')}`,
        );
      }
      const vacuous = rows.filter((row) => row.status === 'TRAP-VACUOUS');
      if (vacuous.length) {
        console.warn(
          `  ✖ ${vacuous.length} trap(s) return the right answer, so those cases test nothing: ` +
            vacuous.map((row) => row.name).join(', '),
        );
      }
      if (options.log) {
        const datasets = [...new Set(runnable.map((c) => c.dataset))];
        const kinds = [
          ...new Set(
            datasets.map((name) => cache.get(name)?.kind).filter(Boolean),
          ),
        ] as Dialect[];
        const dialects = [
          ...new Set(rows.map((row) => row.dialect).filter(Boolean)),
        ] as Dialect[];
        const written = writeRunLog(
          buildValidateRecord({
            runId: randomUUID(),
            label: options.label,
            suite: source.suite,
            datasets,
            ...(kinds.length === 1 ? { datasourceKind: kinds[0] } : {}),
            ...(dialects.length === 1 ? { dialect: dialects[0] } : {}),
            startedAt,
            finishedAt: new Date(),
            rows,
          }),
        );
        console.log(
          written
            ? `Run log: ${written.file}`
            : `  ! could not write the run log (${resolveLogDir()}) — the check itself is unaffected`,
        );
      }
      all.push(...rows);
    }
  } finally {
    await services.app.close().catch(() => undefined);
  }
  if (prepared.length > 1) {
    console.log(`\nAll suites: ${validateSummaryLine(all)}`);
  }
  return setupFailures > 0 ||
    all.some((row) => row.verdict === 'FAIL' || row.verdict === 'ERROR')
    ? 1
    : 0;
}

// ---------------------------------------------------------------- main

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  return options.validate ? runValidate(options) : runGraded(options);
}

// Exported for ad-hoc checks and the unit test; the run only starts when
// invoked as a script.
export {
  compareResults,
  normalizeValue,
  loadGoldenSet,
  readCaseFile,
  parseArgs,
  selectCases,
  partitionCases,
  summarizeCategories,
  splitArmList,
  armEngineOverrides,
  resolveDialect,
  goldenToSuiteEvalCase,
  modelRouterId,
  judgeModelMismatch,
  decideValidateStatus,
  validateSummaryLine,
  validateLogCase,
  buildValidateRecord,
  buildCliRunRecord,
  mergeSidePassUsage,
  formatHeadline,
  attemptDetail,
  runsText,
  loopCell,
  loopMatrixTable,
  loopFilename,
  EvalSetupError,
};
export type {
  GoldenCase,
  CaseSource,
  Options,
  ValidateStatus,
  ValidateDecision,
  ValidateRow,
  ValidateAlternative,
  CaseOutcomeLike,
  CliRunRecordInput,
  LoopCell,
  LoopSummaryFile,
};

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      if (error instanceof EvalSetupError) {
        console.error(`\n✖ ${error.message}\n`);
        process.exit(error.exitCode);
      }
      console.error('\n✖ Eval run crashed:');
      console.error(error);
      process.exit(1);
    });
}
