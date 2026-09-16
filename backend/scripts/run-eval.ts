/**
 * Golden-set evaluation harness (Phase 1, item 4).
 *
 * Boots the backend as a Nest standalone application context (no HTTP), asks
 * the assistant each question in `eval/golden-set.json` inside a throwaway
 * project, and compares the result set of the SQL the assistant actually ran
 * against the result set of the case's trusted `expectedSql`.
 *
 * Run with `npm run eval` from `backend/`. See `eval/README.md`.
 */
import { readFileSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import type { INestApplicationContext, LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DatasourcesService } from '../src/modules/datasources/datasources.service';
import type { QueryResult } from '../src/modules/datasources/entities/datasource.entity';
import { LlmService } from '../src/modules/llm/llm.service';
import { ProjectsService } from '../src/modules/projects/projects.service';
// Result-set equality lives with the app code: careful mode's cross-check and
// this harness must judge "same answer" exactly the same way.
import {
  compareResults,
  normalizeValue,
} from '../src/modules/projects/result-compare';
import type {
  ChatMessage,
  ProjectDoc,
  ToolDataRecord,
} from '../src/modules/projects/entities/project.entity';
import { SandboxRepository } from '../src/modules/sandbox/repositories/sandbox.repository';

// Connectors clamp `runReadOnlySql` at 500 rows, so comparing more is moot.
const ROW_LIMIT = Number(process.env.EVAL_ROW_LIMIT ?? 500);
const TURN_TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 300_000);
const DEFAULT_GOLDEN_SET = join(__dirname, '..', 'eval', 'golden-set.json');

interface GoldenCase {
  /** Short identifier used in the summary table. */
  name: string;
  /** The question sent to the assistant, exactly as a user would type it. */
  question: string;
  /** Saved sandbox name the throwaway project is bound to. */
  sandbox: string;
  /** Trusted SQL whose live result set is the reference answer. */
  expectedSql: string;
  /** Seed entries ship as placeholders; they are skipped unless forced. */
  placeholder?: boolean;
  notes?: string;
}

type Verdict = 'PASS' | 'FAIL' | 'ERROR' | 'SKIP';

interface CaseResult {
  name: string;
  verdict: Verdict;
  /** Short verdict qualifier, e.g. `result-mismatch`, `no-sql`, `timeout`. */
  reason: string;
  detail: string;
  expectedRows?: number;
  actualRows?: number;
  durationMs: number;
}

/** A misconfiguration the operator must fix — reported without a stack trace. */
class EvalSetupError extends Error {}

interface Options {
  file: string;
  only?: string;
  includePlaceholders: boolean;
  keepProjects: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    file: DEFAULT_GOLDEN_SET,
    includePlaceholders: false,
    keepProjects: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') {
      const value = argv[++i];
      if (!value) throw new EvalSetupError('--file needs a path');
      options.file = isAbsolute(value) ? value : resolve(process.cwd(), value);
    } else if (arg === '--only' || arg === '-o') {
      const value = argv[++i];
      if (!value) throw new EvalSetupError('--only needs a case-name filter');
      options.only = value;
    } else if (arg === '--include-placeholders') {
      options.includePlaceholders = true;
    } else if (arg === '--keep-projects') {
      options.keepProjects = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new EvalSetupError(`Unknown argument "${arg}" (try --help)`);
    }
  }
  return options;
}

function printUsage(): void {
  console.log(
    [
      'Usage: npm run eval -- [options]',
      '',
      '  -f, --file <path>         golden set to run (default eval/golden-set.json)',
      '  -o, --only <substring>    run only cases whose name contains <substring>',
      '      --include-placeholders run cases still marked "placeholder": true',
      '      --keep-projects       do not delete the throwaway projects',
      '  -v, --verbose             show Nest logs and per-case SQL',
      '',
      'Env: EVAL_ROW_LIMIT (default 500), EVAL_TIMEOUT_MS (default 300000),',
      '     APP_DATA_DIR (datastore location — must match the desktop app).',
    ].join('\n'),
  );
}

// ------------------------------------------------------------ golden set

function loadGoldenSet(file: string): GoldenCase[] {
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
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new EvalSetupError(
      `Golden set ${file} must be a non-empty array of cases`,
    );
  }
  return parsed.map((entry, index) => {
    const value = (entry ?? {}) as Partial<GoldenCase>;
    for (const field of [
      'name',
      'question',
      'sandbox',
      'expectedSql',
    ] as const) {
      if (typeof value[field] !== 'string' || !value[field]!.trim()) {
        throw new EvalSetupError(
          `Case #${index + 1} in ${file} is missing a non-empty "${field}"`,
        );
      }
    }
    return value as GoldenCase;
  });
}

// ------------------------------------------------------------- analysis

function lastAssistantMessage(project: ProjectDoc): ChatMessage | undefined {
  for (let i = project.messages.length - 1; i >= 0; i--) {
    const message = project.messages[i];
    if (message.role === 'assistant') return message;
  }
  return undefined;
}

/** The last `run_readonly_sql` call of the answer that did not error. */
function lastSuccessfulSql(
  message: ChatMessage | undefined,
): ToolDataRecord | undefined {
  const records = message?.data ?? [];
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record.tool === 'run_readonly_sql' && !record.error && record.input) {
      return record;
    }
  }
  return undefined;
}

// ------------------------------------------------------------- runtime

async function resolveDatasourceId(
  sandboxes: SandboxRepository,
  datasources: DatasourcesService,
  name: string,
): Promise<string> {
  const [sandbox] = await sandboxes.getByNames([name]);
  if (!sandbox) {
    const saved = (await sandboxes.list()).map((s) => s.name);
    throw new EvalSetupError(
      `Sandbox "${name}" does not exist in this datastore. ` +
        (saved.length
          ? `Saved sandboxes: ${saved.join(', ')}.`
          : 'No sandboxes are saved — create one in the app first.'),
    );
  }
  const datasourceId =
    sandbox.datasourceId ?? (await datasources.defaultDatasource())?.id;
  if (!datasourceId) {
    throw new EvalSetupError(
      `Sandbox "${name}" has no datasource bound and no datasource is saved — ` +
        'configure a connection in the app first.',
    );
  }
  return datasourceId;
}

async function preflight(
  app: INestApplicationContext,
  cases: GoldenCase[],
): Promise<Map<string, string>> {
  const llm = await app.get(LlmService).getView();
  if (!llm.configured && !process.env.OPENAI_API_KEY) {
    throw new EvalSetupError(
      'No LLM configured. Save provider/model/API key in the app ' +
        '(Settings → LLM) using the same APP_DATA_DIR as this run, or export ' +
        'OPENAI_API_KEY to use the gpt-4o-mini fallback.',
    );
  }

  const sandboxes = app.get(SandboxRepository);
  const datasources = app.get(DatasourcesService);
  const byName = new Map<string, string>();
  for (const name of new Set(cases.map((c) => c.sandbox))) {
    const datasourceId = await resolveDatasourceId(
      sandboxes,
      datasources,
      name,
    );
    try {
      await datasources.runReadOnlySql(datasourceId, 'SELECT 1', 1);
    } catch (error) {
      throw new EvalSetupError(
        `Datasource for sandbox "${name}" is not reachable — ${message(error)}`,
      );
    }
    byName.set(name, datasourceId);
  }
  return byName;
}

async function runCase(
  app: INestApplicationContext,
  testCase: GoldenCase,
  datasourceId: string,
  options: Options,
): Promise<CaseResult> {
  const projects = app.get(ProjectsService);
  const datasources = app.get(DatasourcesService);
  const started = Date.now();
  const done = (
    result: Omit<CaseResult, 'name' | 'durationMs'>,
  ): CaseResult => ({
    name: testCase.name,
    durationMs: Date.now() - started,
    ...result,
  });

  const project = await projects.create(
    `eval ${testCase.name} ${new Date().toISOString()}`.slice(0, 64),
    [testCase.sandbox],
  );
  try {
    const turn = new AbortController();
    const timer = setTimeout(() => turn.abort(), TURN_TIMEOUT_MS);
    try {
      await projects.streamMessage(
        project.id,
        testCase.question,
        () => {},
        turn.signal,
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

    const answered = await projects.get(project.id);
    const answer = lastAssistantMessage(answered);
    const record = lastSuccessfulSql(answer);
    if (!record?.input) {
      return done({
        verdict: 'FAIL',
        reason: 'no-sql',
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
        testCase.expectedSql,
        ROW_LIMIT,
      );
    } catch (error) {
      return done({
        verdict: 'ERROR',
        reason: 'expected-sql',
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
          detail: `could not re-run the assistant's SQL — ${message(error)}`,
        });
      }
      actualRows = record.rows;
      note = ' (compared the stored rows: replay failed)';
    }

    const { match, reason } = compareResults(expected.rows, actualRows);
    return done({
      verdict: match ? 'PASS' : 'FAIL',
      reason: match ? '' : 'result-mismatch',
      detail: match ? `${expected.rows.length} rows match` : reason + note,
      expectedRows: expected.rows.length,
      actualRows: actualRows.length,
    });
  } catch (error) {
    return done({
      verdict: 'ERROR',
      reason: 'turn-failed',
      detail: message(error),
    });
  } finally {
    if (!options.keepProjects) {
      await projects
        .delete(project.id)
        .catch((error: unknown) =>
          console.warn(
            `  ! could not delete throwaway project ${project.id} — ${message(error)}`,
          ),
        );
    }
  }
}

// -------------------------------------------------------------- output

function summarize(results: CaseResult[]): void {
  const rows = results.map((result) => [
    result.name,
    result.verdict + (result.reason ? `(${result.reason})` : ''),
    result.verdict === 'SKIP'
      ? '-'
      : `${result.expectedRows ?? '-'}/${result.actualRows ?? '-'}`,
    result.verdict === 'SKIP'
      ? '-'
      : `${(result.durationMs / 1000).toFixed(1)}s`,
    oneLine(result.detail).slice(0, 80),
  ]);
  const header = ['CASE', 'VERDICT', 'ROWS exp/act', 'TIME', 'DETAIL'];
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

  const count = (verdict: Verdict) =>
    results.filter((result) => result.verdict === verdict).length;
  console.log('');
  console.log(
    `${results.length} cases — ${count('PASS')} passed, ${count('FAIL')} failed, ` +
      `${count('ERROR')} errored, ${count('SKIP')} skipped`,
  );
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------- main

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const all = loadGoldenSet(options.file);
  const selected = options.only
    ? all.filter((c) => c.name.includes(options.only!))
    : all;
  if (!selected.length) {
    throw new EvalSetupError(
      `No case name in ${options.file} contains "${options.only}"`,
    );
  }
  const runnable = options.includePlaceholders
    ? selected
    : selected.filter((c) => !c.placeholder);
  if (!runnable.length) {
    throw new EvalSetupError(
      `Every selected case in ${options.file} is still a placeholder. ` +
        'Point the cases at a real sandbox, replace `expectedSql` with trusted ' +
        'SQL, drop the `"placeholder": true` flag (see eval/README.md), or pass ' +
        '--include-placeholders to run them anyway.',
    );
  }

  const logger: LogLevel[] = options.verbose
    ? ['log', 'warn', 'error']
    : ['warn', 'error'];
  const app = await NestFactory.createApplicationContext(AppModule, { logger });
  const results: CaseResult[] = [];
  try {
    const datasourceIds = await preflight(app, runnable);
    console.log(
      `Running ${runnable.length} case(s) from ${options.file} ` +
        `(row limit ${ROW_LIMIT}, timeout ${Math.round(TURN_TIMEOUT_MS / 1000)}s)`,
    );
    for (const testCase of runnable) {
      console.log(`\n▶ ${testCase.name}: ${oneLine(testCase.question)}`);
      const result = await runCase(
        app,
        testCase,
        datasourceIds.get(testCase.sandbox)!,
        options,
      );
      results.push(result);
      console.log(
        `  ${result.verdict}${result.reason ? `(${result.reason})` : ''} — ${oneLine(result.detail)}`,
      );
    }
  } finally {
    await app.close().catch(() => undefined);
  }

  for (const skipped of selected.filter((c) => !runnable.includes(c))) {
    results.push({
      name: skipped.name,
      verdict: 'SKIP',
      reason: 'placeholder',
      detail: 'marked "placeholder": true',
      durationMs: 0,
    });
  }
  summarize(results);
  return results.some((r) => r.verdict === 'FAIL' || r.verdict === 'ERROR')
    ? 1
    : 0;
}

// Exported for ad-hoc checks; the run only starts when invoked as a script.
export { compareResults, normalizeValue, loadGoldenSet, lastSuccessfulSql };

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
