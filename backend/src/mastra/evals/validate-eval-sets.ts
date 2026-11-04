import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { DatasourcesService } from '../../modules/datasources/datasources.service';
import { setAgentModelResolver } from '../model-resolver';
import { getDatasetToolServices } from '../tool-services';
import { assistantEvalDatasetError } from './assistant-eval-datasets';
import { evalSetById, loadEvalSets } from './eval-set-files';
import type { EvalSetDefinition } from './eval-set-files';
import {
  compareEvidence,
  RESULT_SET_ROW_LIMIT,
  runReferenceSql,
} from './result-set-check';
import { tableReferences } from './checks/sql-text';
import { catalogOfEntities, referenceInCatalog } from './databricks-catalog';

/**
 * `npm run eval:validate`: run every reference query of one eval set on its
 * sample, without a model, so a wrong reference fails in seconds instead of
 * after a paid run.
 *
 *   EVAL_SET=world-cup EVAL_DATASETS="World Cup" npm run eval:validate
 *
 * Same inputs as `npm run evals:assistant`, except that it takes one
 * `EVAL_SET` and no `EVAL_CASES`. It boots the application context the way
 * `run-assistant-evals.ts` does, runs the set's dataset preflight, then each
 * reference query on the datasource's connector under the result-set check's
 * row limit and truncation rule (`runReferenceSql`). It deliberately skips the
 * `run_readonly_sql` bridge the result-set check goes through: that bridge
 * hands a failing statement to the `sql-fixer` model and re-runs the rewrite,
 * which would both call a model and hide a broken reference. The model
 * resolver is replaced with one that refuses, so any model call would fail
 * the run rather than spend tokens.
 *
 * A memory set (agents-evals R237) is validated the same way, then each
 * case's trap and teach SQL run too: the trap must run and must not pass the
 * result-set match against the reference's rows, or it catches nothing; each
 * teach signal's SQL must run.
 */

/** What one query returned. */
export interface ReferenceRun {
  rowCount: number;
  /** The rows; a memory set's trap is compared with its reference's (R237). */
  rows?: Record<string, unknown>[];
}

/**
 * What a statement is to the validator: a case's reference when `role` is
 * absent (refused when truncated, R110), else a memory case's trap or a
 * teach signal's SQL, run under the same row limit with no truncation rule.
 */
export type ReferenceRole = 'trap' | 'teach';

/** Runs one of a case's queries; throws with the database's error. */
export type ReferenceRunner = (
  sql: string,
  caseId: string,
  role?: ReferenceRole,
) => Promise<ReferenceRun>;

/** The outcome of validating one set. */
export interface EvalSetValidation {
  /** Reference queries run (cases with a reference in the set's dialect). */
  ran: number;
  /** Cases that failed: their reference, or a memory case's trap or teach. */
  failed: number;
  /** Cases with nothing to validate: no reference query. */
  withoutReference: number;
  exitCode: 0 | 1;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The last `count` name parts, lowercased: how R20 compares entities. */
function lastParts(parts: readonly string[], count: number): string {
  return parts
    .slice(-count)
    .map((part) => part.toLowerCase())
    .join('.');
}

/**
 * The first table or view a reference reads that is not an entity of the
 * selected datasets (agents-evals R110), or undefined when it reads none.
 * Names compare as the dataset preflight compares them (R20): on the last
 * two name parts, ignoring case; a one-part name on its only part. The
 * reading is conservative (`tableReferences`): a name it cannot tell is a
 * table is left out, so a reference can slip through but is never refused
 * for a table it does not read.
 */
export function referenceOutsideDatasets(
  sql: string,
  datasetEntities: readonly string[],
): string | undefined {
  const entities = datasetEntities.map((entity) => entity.split('.'));
  const byTwo = new Set(entities.map((parts) => lastParts(parts, 2)));
  const byOne = new Set(entities.map((parts) => lastParts(parts, 1)));
  for (const parts of tableReferences(sql)) {
    const known =
      parts.length >= 2
        ? byTwo.has(lastParts(parts, 2))
        : byOne.has(lastParts(parts, 1));
    if (!known) return parts.join('.');
  }
  return undefined;
}

/**
 * The validator's pure part: run each case's reference through `run`, one at
 * a time, print `✓ <id>  <dialect>  <n> rows` or `✗ <id>  <dialect>  <reason>`
 * per case, then a summary. A failed case does not stop the others. A
 * preflight error prints and runs nothing. A reference that reads a table
 * outside `datasetEntities` fails without running (R110): the database may
 * hold the table, but a run scoped to the datasets cannot read it. A
 * reference that returns no rows fails too: it is almost always a filter on
 * a misspelled value, and an empty answer is better written as a count.
 * A Databricks set's references run in the catalog of `datasetEntities`,
 * their `` `evals`. `` rewritten (R192); entities that name no single catalog
 * fail like the preflight. A memory case whose reference passed then runs
 * its trap and its teach SQL (R237): `✓ <id>  <dialect>  <n> rows · trap <m>
 * rows`, or `✗` with the first thing that failed. Exit code 1 on any
 * failure.
 */
export async function validateEvalSet(
  set: Pick<EvalSetDefinition, 'id' | 'dialect' | 'cases'>,
  preflightError: string | undefined,
  run: ReferenceRunner,
  print: (line: string) => void,
  datasetEntities?: readonly string[],
): Promise<EvalSetValidation> {
  const withoutReference = set.cases.filter(
    (evalCase) => !evalCase.expectedSql,
  ).length;
  if (preflightError) {
    print(`✗ dataset preflight  ${oneLine(preflightError)}`);
    print(`\n${set.id}: the dataset preflight failed; no reference query ran.`);
    return { ran: 0, failed: 0, withoutReference, exitCode: 1 };
  }
  let inCatalog = (sql: string) => sql;
  if (set.dialect === 'databricks' && datasetEntities) {
    let catalog: string;
    try {
      catalog = catalogOfEntities(datasetEntities);
    } catch (err) {
      print(`✗ dataset preflight  ${oneLine((err as Error).message)}`);
      print(
        `\n${set.id}: the dataset preflight failed; no reference query ran.`,
      );
      return { ran: 0, failed: 0, withoutReference, exitCode: 1 };
    }
    inCatalog = (sql) => referenceInCatalog(sql, catalog);
  }
  let ran = 0;
  let failed = 0;
  for (const evalCase of set.cases) {
    if (!evalCase.expectedSql) continue;
    ran++;
    const outside = datasetEntities
      ? referenceOutsideDatasets(evalCase.expectedSql, datasetEntities)
      : undefined;
    if (outside) {
      failed++;
      print(
        `✗ ${evalCase.id}  ${set.dialect}  the reference reads ${outside}, which is not in the selected datasets`,
      );
      continue;
    }
    let line: string;
    try {
      // `<n> rows` whatever n is: the line format of agents-evals R110.
      const reference = await run(inCatalog(evalCase.expectedSql), evalCase.id);
      if (reference.rowCount === 0) {
        line = `✗ ${evalCase.id}  ${set.dialect}  the reference returned 0 rows`;
      } else if (isMemoryCase(evalCase)) {
        const problem = await memoryCaseProblem(
          evalCase,
          reference,
          run,
          inCatalog,
        );
        line = problem.trapRows
          ? `✓ ${evalCase.id}  ${set.dialect}  ${reference.rowCount} rows · trap ${problem.trapRows} rows`
          : `✗ ${evalCase.id}  ${set.dialect}  ${problem.reason}`;
      } else {
        line = `✓ ${evalCase.id}  ${set.dialect}  ${reference.rowCount} rows`;
      }
    } catch (err) {
      line = `✗ ${evalCase.id}  ${set.dialect}  ${errorLine(err)}`;
    }
    if (line.startsWith('✗')) failed++;
    print(line);
  }
  const none =
    withoutReference > 0
      ? `; ${withoutReference} case${withoutReference === 1 ? ' has' : 's have'} no reference query`
      : '';
  const what = set.cases.some(isMemoryCase)
    ? `memory ${ran === 1 ? 'case' : 'cases'} (reference, trap and teach queries)`
    : `reference ${ran === 1 ? 'query' : 'queries'}`;
  print(`\n${set.id}: ${ran - failed} of ${ran} ${what} passed${none}.`);
  return { ran, failed, withoutReference, exitCode: failed > 0 ? 1 : 0 };
}

type ValidatedCase = EvalSetDefinition['cases'][number];

function errorLine(err: unknown): string {
  return oneLine(err instanceof Error ? err.message : String(err));
}

/** A case of a memory set: it has a trap, or teach signals (R234). */
function isMemoryCase(evalCase: ValidatedCase): boolean {
  return evalCase.trapSql !== undefined || evalCase.teach !== undefined;
}

/**
 * A memory case after its reference ran (R237): its trap must run and must
 * not pass the result-set match against the reference's rows (R31), and each
 * teach signal's SQL must run. The trap's row count, or the first problem.
 */
async function memoryCaseProblem(
  evalCase: ValidatedCase,
  reference: ReferenceRun,
  run: ReferenceRunner,
  inCatalog: (sql: string) => string,
): Promise<
  | { trapRows: number; reason?: undefined }
  | { trapRows?: undefined; reason: string }
> {
  if (!evalCase.trapSql) return { reason: 'the case has no trap query' };
  let trap: ReferenceRun;
  try {
    trap = await run(inCatalog(evalCase.trapSql), evalCase.id, 'trap');
  } catch (err) {
    return { reason: `the trap failed to run — ${errorLine(err)}` };
  }
  const caught = !compareEvidence(
    reference.rows ?? [],
    trap.rows ?? [],
    evalCase.resultSetOptions ?? {},
  ).match;
  if (!caught) {
    return {
      reason: 'the trap returns the reference rows, so it catches nothing',
    };
  }
  for (const [index, signal] of (evalCase.teach ?? []).entries()) {
    try {
      await run(inCatalog(signal.sql), evalCase.id, 'teach');
    } catch (err) {
      return {
        reason: `teach signal ${index + 1} failed to run — ${errorLine(err)}`,
      };
    }
  }
  return { trapRows: trap.rowCount };
}

async function main(): Promise<void> {
  const setId = process.env['EVAL_SET']?.trim() ?? '';
  const datasets = (process.env['EVAL_DATASETS'] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const sets = loadEvalSets();
  const usage =
    'e.g. EVAL_SET=world-cup EVAL_DATASETS="World Cup" npm run eval:validate';

  if (!setId) {
    console.error(
      `Set EVAL_SET to the set to validate (${sets.map((set) => set.id).join(', ')}), ${usage}`,
    );
    process.exitCode = 1;
    return;
  }
  let set: EvalSetDefinition;
  try {
    set = evalSetById(sets, setId);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  if (datasets.length === 0) {
    console.error(
      `Set EVAL_DATASETS to a comma-separated list of saved dataset names, ${usage}`,
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  // `LlmService` installed the real resolver while the app booted; nothing
  // in a validation may reach a model, so make any attempt fail loudly.
  setAgentModelResolver(() =>
    Promise.reject(new Error('eval:validate never calls a model')),
  );
  try {
    const result = await validateOnApp(app, set, datasets);
    process.exitCode = result.exitCode;
  } finally {
    await app.close();
  }
}

async function validateOnApp(
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  set: EvalSetDefinition,
  datasets: string[],
): Promise<EvalSetValidation> {
  const snapshots = await getDatasetToolServices().getDatasets(datasets);
  const datasourceId = snapshots.find(
    (dataset) => datasets.includes(dataset.name) && dataset.datasourceId,
  )?.datasourceId;
  const preflightError =
    assistantEvalDatasetError(datasets, snapshots, set.fixtureId) ??
    (datasourceId ? undefined : 'The selected datasets have no datasource.');
  const datasources = app.get(DatasourcesService);
  console.log(
    `Validating ${set.name} (${set.id}, ${set.dialect}) on ${datasets.join(', ')}\n`,
  );
  const execute = (statement: string, limit: number) =>
    datasources.runReadOnlySql(datasourceId ?? '', statement, limit);
  return validateEvalSet(
    set,
    preflightError,
    async (sql, _caseId, role) => {
      // A reference is refused when truncated (R110); a trap or teach SQL
      // runs under the same row limit, as the assistant's query would.
      const rows = role
        ? (await execute(sql, RESULT_SET_ROW_LIMIT)).rows
        : await runReferenceSql(sql, execute);
      return { rowCount: rows.length, rows };
    },
    (line) => console.log(line),
    snapshots
      .filter((dataset) => datasets.includes(dataset.name))
      .flatMap((dataset) => dataset.tables),
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
