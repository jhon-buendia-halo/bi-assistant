/**
 * Loads a sample fixture's JSON dump into a Databricks Unity Catalog schema,
 * checks the row counts, and registers the sample's datasource and dataset in
 * a RUNNING backend (BA-9 Step 2, BA-186; testing-data R22 to R24). Runbook:
 * docs/evals/databricks-vdi.md.
 *
 *   npm run fixture:databricks -- --fixture world-cup --dry-run
 *   npm run fixture:databricks -- --fixture world-cup
 *
 * Flags:
 *   --fixture <world-cup|finance|marketing-analytics>  the sample (required);
 *                       its Databricks id (world-cup-databricks) works too
 *   --dry-run           print the SQL it would run, the column types and what
 *                       it would register; connect to nothing, need no env
 *   --full              with --dry-run, print every INSERT whole
 *   --no-register       load and check, but leave the backend alone
 *   --register-only     register a schema an earlier run loaded
 *   --batch-rows <n>    rows per INSERT (default 500)
 *
 * Environment:
 *   DATABRICKS_HOST         workspace host (adb-….azuredatabricks.net)
 *   DATABRICKS_HTTP_PATH    the SQL warehouse's HTTP path (/sql/1.0/warehouses/<id>),
 *   or DATABRICKS_WAREHOUSE_ID
 *   DATABRICKS_TOKEN        a personal access token that can create schemas
 *                           and tables in the catalog
 *   DATABRICKS_CATALOG      default `evals`; any catalog the token can create schemas in
 *                           (the eval references run in the dataset's catalog)
 *   DATABRICKS_SCHEMA       default the sample's schema (world_cup, finance,
 *                           marketing_analytics), the schema the eval preflight needs
 *   BACKEND_URL             default http://127.0.0.1:3000 (local mode)
 *   BACKEND_USER            the local persona to sign in as, default `local`
 *
 * Idempotent: CREATE SCHEMA IF NOT EXISTS and CREATE OR REPLACE TABLE, then
 * the datasource is upserted by name and the dataset replaced by name.
 */
import { join, relative } from 'node:path';
import { DBSQLClient, DBSQLLogger, LogLevel } from '@databricks/sql';
import {
  DATABRICKS_FIXTURE_CATALOG,
  type SampleFixture,
} from '../src/modules/testing-data/fixtures/registry';
import {
  buildLoadPlan,
  DEFAULT_BATCH_LIMITS,
  findDumpDirectory,
  FixtureLoadError,
  formatPlan,
  readFixtureDump,
  readSeedSql,
  resolveDatabricksFixture,
  runLoadPlan,
  type LoadTarget,
  type SqlRunner,
} from '../src/modules/testing-data/databricks/fixture-load';
import {
  connectionFromEnv,
  registerDatabricksFixture,
  RegisterError,
} from '../src/modules/testing-data/databricks/register';

const BACKEND_ROOT = join(__dirname, '..');
const REPO_ROOT = join(BACKEND_ROOT, '..');
const FIXTURES_DIR = join(
  BACKEND_ROOT,
  'src',
  'modules',
  'testing-data',
  'fixtures',
);
/** A stopped warehouse starts on the first statement: give it minutes. */
const SOCKET_TIMEOUT_MS = 10 * 60_000;

const USAGE =
  'Usage: npm run fixture:databricks -- --fixture <world-cup|finance|marketing-analytics> ' +
  '[--dry-run [--full]] [--no-register | --register-only] [--batch-rows <n>]';

interface Options {
  fixture: string;
  dryRun: boolean;
  full: boolean;
  register: boolean;
  load: boolean;
  batchRows: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    fixture: '',
    dryRun: false,
    full: false,
    register: true,
    load: true,
    batchRows: DEFAULT_BATCH_LIMITS.rows,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) {
        throw new FixtureLoadError(`${flag} needs a value. ${USAGE}`);
      }
      return next;
    };
    if (flag === '--fixture') options.fixture = value();
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--full') options.full = true;
    else if (flag === '--no-register') options.register = false;
    else if (flag === '--register-only') options.load = false;
    else if (flag === '--batch-rows') options.batchRows = Number(value());
    else throw new FixtureLoadError(`Unknown argument "${flag}". ${USAGE}`);
  }
  if (!options.fixture)
    throw new FixtureLoadError(`--fixture is required. ${USAGE}`);
  if (!options.register && !options.load) {
    throw new FixtureLoadError(
      '--no-register and --register-only leave nothing to do',
    );
  }
  if (!Number.isInteger(options.batchRows) || options.batchRows < 1) {
    throw new FixtureLoadError('--batch-rows must be a positive whole number');
  }
  return options;
}

/** Where the sample goes: `DATABRICKS_CATALOG` (default `evals`) and `DATABRICKS_SCHEMA` (default its own schema). */
function targetFor(fixture: SampleFixture): LoadTarget {
  const target = {
    catalog:
      process.env['DATABRICKS_CATALOG']?.trim() || DATABRICKS_FIXTURE_CATALOG,
    schema: process.env['DATABRICKS_SCHEMA']?.trim() || fixture.schema,
  };
  // Any catalog works: the references run in the dataset's catalog
  // (agents-evals R148). The schema does not: the preflight and the
  // references name the sample's own schema.
  if (target.schema !== fixture.schema) {
    console.warn(
      `⚠ Loading into schema ${target.schema}. The eval preflight and the Databricks reference ` +
        `queries need ${fixture.schema}.<table>, so the eval sets will not run on this copy.\n`,
    );
  }
  return target;
}

/**
 * One `@databricks/sql` session for the whole load. A connection failure is
 * reported with the host and warehouse, never the token.
 */
async function openRunner(connection: {
  host: string;
  token: string;
  warehouseId: string;
  httpPath: string;
}): Promise<{ runner: SqlRunner; close: () => Promise<void> }> {
  // The driver logs every step at info level; only its errors matter here.
  const client = new DBSQLClient({
    logger: new DBSQLLogger({ level: LogLevel.error }),
  });
  let session: Awaited<ReturnType<DBSQLClient['openSession']>>;
  try {
    await client.connect({
      host: connection.host,
      path: connection.httpPath,
      authType: 'access-token',
      token: connection.token,
      socketTimeout: SOCKET_TIMEOUT_MS,
      telemetryEnabled: false,
    });
    session = await client.openSession();
  } catch (err) {
    await client.close().catch(() => undefined);
    throw new FixtureLoadError(
      `could not open a session on ${connection.host} (warehouse ${connection.warehouseId}): ` +
        `${err instanceof Error ? err.message : String(err)}. Check DATABRICKS_HOST, ` +
        'DATABRICKS_HTTP_PATH and that the token is valid.',
    );
  }
  return {
    runner: {
      run: async (sql) => {
        const operation = await session.executeStatement(sql);
        try {
          return (await operation.fetchAll()) as Record<string, unknown>[];
        } finally {
          await operation.close().catch(() => undefined);
        }
      },
    },
    close: async () => {
      await session.close().catch(() => undefined);
      await client.close().catch(() => undefined);
    },
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { fixture, source } = resolveDatabricksFixture(options.fixture);
  const target = targetFor(fixture);

  const plan = options.load
    ? buildLoadPlan({
        fixture,
        source,
        dump: readFixtureDump(findDumpDirectory(BACKEND_ROOT, source.id)),
        seedSql: readSeedSql(FIXTURES_DIR, source),
        target,
        limits: { ...DEFAULT_BATCH_LIMITS, rows: options.batchRows },
      })
    : undefined;
  const entities = fixture.requiredTables.map(
    (table) => `${target.catalog}.${target.schema}.${table}`,
  );

  if (options.dryRun) {
    if (plan) {
      process.stdout.write(
        formatPlan(
          { ...plan, dumpDirectory: relative(REPO_ROOT, plan.dumpDirectory) },
          { full: options.full },
        ),
      );
    }
    console.log(
      options.register
        ? `\n-- Would register in the backend at ${process.env['BACKEND_URL'] ?? 'http://127.0.0.1:3000'}:\n` +
            `--   datasource "${fixture.datasourceName}" (kind databricks, upserted by name)\n` +
            `--   dataset "${fixture.datasetName}" with ${entities.length} entities: ${entities.join(', ')}\n` +
            '-- Dry run: nothing was connected to.'
        : '\n-- Dry run: nothing was connected to; --no-register leaves the backend alone.',
    );
    return;
  }

  const connection = connectionFromEnv(process.env);
  console.log(
    `${fixture.name} → ${target.catalog}.${target.schema} on ${connection.host} ` +
      `(warehouse ${connection.warehouseId})`,
  );

  if (plan) {
    const { runner, close } = await openRunner(connection);
    try {
      const started = Date.now();
      const report = await runLoadPlan(plan, runner, (line) =>
        console.log(line),
      );
      console.log(
        `✔ loaded ${report.relations.length} relations in ${report.statements} statements, ` +
          `${Math.round((Date.now() - started) / 1000)} s`,
      );
    } finally {
      await close();
    }
  }

  if (options.register) {
    const backendUrl = process.env['BACKEND_URL'] ?? 'http://127.0.0.1:3000';
    const result = await registerDatabricksFixture({
      backendUrl,
      fixture,
      connection,
      target,
      userId: process.env['BACKEND_USER']?.trim() || undefined,
      log: (line) => console.log(line),
    });
    const sets =
      fixture.id === 'world-cup-databricks'
        ? `${fixture.id} (and world-cup-databricks-only)`
        : fixture.id;
    console.log(
      `\nDone.\n  datasource: ${fixture.datasourceName} (${result.datasourceId})\n` +
        `  dataset:    ${fixture.datasetName} (${result.entities.length} entities)\n\n` +
        `Validate the references, no model needed (sets: ${sets}), from backend/ with\n` +
        "APP_DATA_DIR set to the app's data directory (docs/evals/databricks-vdi.md, step 5):\n" +
        `  EVAL_SET=${fixture.id} EVAL_DATASETS="${fixture.datasetName}" node dist/mastra/evals/validate-eval-sets.js\n` +
        `Then run the set from Agents → assistant → Evals on the "${fixture.datasourceName}" datasource.`,
    );
  }
}

main().catch((error: unknown) => {
  if (error instanceof FixtureLoadError || error instanceof RegisterError) {
    console.error(`\n✖ ${error.message}\n`);
  } else {
    console.error('\n✖ The Databricks loader crashed:');
    console.error(error);
  }
  process.exit(1);
});
