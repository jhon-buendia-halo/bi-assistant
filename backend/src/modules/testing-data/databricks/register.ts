/**
 * Registering a loaded Databricks sample in a running backend, through the
 * same HTTP API the app uses (BA-186): sign in as a local persona, upsert the
 * sample's datasource by name, read its inventory live, and save its dataset
 * with the sample's required entities. Idempotent: a second run updates the
 * same datasource and replaces the same dataset.
 *
 * Local mode only: on an org server the sign-in route answers 404 and the
 * datasource and dataset are created from the app instead. `fetch` is
 * injected so the unit test runs without a backend.
 */
import type { SampleFixture } from '../fixtures/registry';
import type { LoadTarget } from './fixture-load';

/** What the Databricks connector needs (`DatabricksConfig`). */
export interface DatabricksConnection {
  host: string;
  warehouseId: string;
  token: string;
}

export interface RegisterInput {
  backendUrl: string;
  fixture: SampleFixture;
  connection: DatabricksConnection;
  target: LoadTarget;
  /** The local persona to sign in as; `local` (Demo User) by default. */
  userId?: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  /** A live inventory walks every catalog the token sees; on a cold warehouse that takes minutes. */
  inventoryTimeoutMs?: number;
}

export interface RegisterResult {
  datasourceId: string;
  created: boolean;
  /** The dataset's entity keys, as the inventory spells them (`evals.world_cup.matches`). */
  entities: string[];
}

/**
 * The connection from the loader's environment: `DATABRICKS_HOST` (with or
 * without `https://`), `DATABRICKS_TOKEN`, and the SQL warehouse as
 * `DATABRICKS_HTTP_PATH` (`/sql/1.0/warehouses/<id>`, as the warehouse's
 * Connection details show it) or `DATABRICKS_WAREHOUSE_ID`. A cluster's HTTP
 * path is refused: the app's connector talks to SQL warehouses only. Every
 * problem is reported at once; the token is never echoed.
 */
export function connectionFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): DatabricksConnection & { httpPath: string } {
  const host = (env['DATABRICKS_HOST'] ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const token = (env['DATABRICKS_TOKEN'] ?? '').trim();
  const httpPath = (env['DATABRICKS_HTTP_PATH'] ?? '').trim();
  const fromPath = /^\/?sql\/1\.0\/warehouses\/([A-Za-z0-9._-]+)\/?$/.exec(
    httpPath,
  )?.[1];
  const warehouseId =
    (env['DATABRICKS_WAREHOUSE_ID'] ?? '').trim() || fromPath || '';
  const problems: string[] = [];
  if (!host)
    problems.push(
      'DATABRICKS_HOST is not set (e.g. adb-1234567890123456.7.azuredatabricks.net)',
    );
  else if (!/^[A-Za-z0-9._-]+$/.test(host))
    problems.push(`DATABRICKS_HOST "${host}" is not a hostname`);
  if (!token)
    problems.push('DATABRICKS_TOKEN is not set (a personal access token)');
  if (httpPath && !fromPath) {
    problems.push(
      `DATABRICKS_HTTP_PATH "${httpPath}" is not a SQL warehouse path (/sql/1.0/warehouses/<id>); the app's connector needs a SQL warehouse`,
    );
  } else if (
    fromPath &&
    env['DATABRICKS_WAREHOUSE_ID']?.trim() &&
    fromPath !== warehouseId
  ) {
    problems.push(
      `DATABRICKS_HTTP_PATH names warehouse ${fromPath} but DATABRICKS_WAREHOUSE_ID is ${warehouseId}`,
    );
  } else if (!warehouseId) {
    problems.push(
      'set DATABRICKS_HTTP_PATH (/sql/1.0/warehouses/<id>) or DATABRICKS_WAREHOUSE_ID',
    );
  }
  if (problems.length) {
    throw new RegisterError(
      `the Databricks connection is incomplete:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
  return {
    host,
    token,
    warehouseId,
    httpPath: `/sql/1.0/warehouses/${warehouseId}`,
  };
}

/** Any registration failure; its message is the report. */
export class RegisterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegisterError';
  }
}

interface InventoryColumn {
  name: string;
  type: string;
  nullable: boolean;
}
interface InventoryTable {
  name: string;
  selectable?: boolean;
  columns: InventoryColumn[];
}
interface InventoryCatalog {
  name: string;
  selectable?: boolean;
  schemas: { name: string; selectable?: boolean; tables: InventoryTable[] }[];
}

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_INVENTORY_TIMEOUT_MS = 15 * 60_000;

function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { message?: string } }).cause?.message;
    return cause ? `${err.message} (${cause})` : err.message;
  }
  return String(err);
}

/**
 * The dataset's entities: every required table of the sample, found in the
 * target schema of the inventory (names compared ignoring case, keys kept as
 * the inventory spells them). A table missing, browse-only or without
 * columns is a problem; all problems are reported together.
 */
export function datasetEntities(
  catalogs: readonly InventoryCatalog[],
  fixture: SampleFixture,
  target: LoadTarget,
): { key: string; columns: InventoryColumn[] }[] {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const catalog = catalogs.find((c) => same(c.name, target.catalog));
  const schema = catalog?.schemas.find((s) => same(s.name, target.schema));
  if (!catalog || !schema) {
    throw new RegisterError(
      `the inventory has no ${target.catalog}.${target.schema}: check that the load finished ` +
        'and that the token can see the catalog (Unity Catalog lists only what it may browse)',
    );
  }
  const problems: string[] = [];
  const entities = fixture.requiredTables.flatMap((name) => {
    const table = schema.tables.find((t) => same(t.name, name));
    const key = `${catalog.name}.${schema.name}.${table?.name ?? name}`;
    if (!table) {
      problems.push(`${key}: missing from the inventory`);
      return [];
    }
    if (table.selectable === false || schema.selectable === false) {
      problems.push(`${key}: browse-only, the token cannot query it`);
    } else if (table.columns.length === 0) {
      problems.push(`${key}: no columns`);
    }
    return [
      {
        key,
        columns: table.columns.map(({ name: column, type, nullable }) => ({
          name: column,
          type,
          nullable,
        })),
      },
    ];
  });
  if (problems.length) {
    throw new RegisterError(
      `the inventory check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
  return entities;
}

/** Sign in, upsert the datasource, read the inventory, save the dataset. */
export async function registerDatabricksFixture(
  input: RegisterInput,
): Promise<RegisterResult> {
  const fetchImpl = input.fetch ?? fetch;
  const log = input.log ?? (() => undefined);
  const base = input.backendUrl.replace(/\/+$/, '');
  // The bearer token of the sign-in below; every later request carries it.
  const session: { token?: string } = {};

  const request = async <T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<{ status: number; body: T | undefined }> => {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(session.token
            ? { authorization: `Bearer ${session.token}` }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      throw new RegisterError(
        `the backend at ${base} did not answer ${method} ${path} (${describe(err)}). ` +
          'Start the app or the backend first (npm run start:dev in backend/).',
      );
    }
    const text = await res.text();
    try {
      return {
        status: res.status,
        body: text ? (JSON.parse(text) as T) : undefined,
      };
    } catch {
      throw new RegisterError(
        `${method} ${path} answered HTTP ${res.status} with a body that is not JSON: ${text.slice(0, 200)}`,
      );
    }
  };
  type Ok = { ok?: boolean; message?: string };
  const checked = <T extends Ok>(
    what: string,
    answer: { status: number; body: T | undefined },
  ): T => {
    if (answer.status >= 400 || !answer.body || answer.body.ok === false) {
      throw new RegisterError(
        `${what} failed: ${answer.body?.message ?? `HTTP ${answer.status}`}`,
      );
    }
    return answer.body;
  };

  const userId = input.userId ?? 'local';
  const signIn = await request<Ok & { token?: string }>(
    'POST',
    '/auth/local/sign-in',
    { userId },
  );
  if (
    signIn.status === 404 &&
    /org server mode/i.test(signIn.body?.message ?? '')
  ) {
    throw new RegisterError(
      `the backend at ${base} runs in org server mode, where this script cannot sign in. ` +
        'Create the datasource and dataset from the app, or register against a local-mode backend.',
    );
  }
  session.token = checked(`Signing in as "${userId}"`, signIn).token;
  if (!session.token)
    throw new RegisterError('the sign-in answered without a token');
  log(`✔ signed in to ${base} as ${userId}`);

  const listed = checked(
    'Listing the datasources',
    await request<Ok & { datasources?: { id: string; name: string }[] }>(
      'GET',
      '/datasources',
    ),
  );
  const previous = (listed.datasources ?? []).find(
    (datasource) => datasource.name === input.fixture.datasourceName,
  );
  const saved = checked(
    `Saving the datasource "${input.fixture.datasourceName}"`,
    await request<Ok & { datasource?: { id: string } }>(
      'POST',
      '/datasources',
      {
        ...(previous ? { id: previous.id } : {}),
        name: input.fixture.datasourceName,
        kind: 'databricks',
        config: input.connection,
      },
    ),
  );
  const datasourceId = saved.datasource?.id ?? previous?.id;
  if (!datasourceId) {
    throw new RegisterError(
      'the backend saved the datasource but returned no id',
    );
  }
  log(
    `✔ datasource "${input.fixture.datasourceName}" ${previous ? 'updated' : 'created'} (${datasourceId})`,
  );

  log(
    '… reading the inventory live (every catalog the token can see; minutes on a cold warehouse)',
  );
  const inventory = checked(
    'Reading the inventory',
    await request<Ok & { catalogs?: InventoryCatalog[] }>(
      'GET',
      `/datasources/${encodeURIComponent(datasourceId)}/inventory?refresh=true`,
      undefined,
      input.inventoryTimeoutMs ?? DEFAULT_INVENTORY_TIMEOUT_MS,
    ),
  );
  const entities = datasetEntities(
    inventory.catalogs ?? [],
    input.fixture,
    input.target,
  );
  log(
    `✔ inventory: all ${entities.length} required entities in ${input.target.catalog}.${input.target.schema}`,
  );

  const dataset = checked(
    `Saving the dataset "${input.fixture.datasetName}"`,
    await request<Ok>(
      'POST',
      '/datasets',
      {
        name: input.fixture.datasetName,
        tables: entities.map((entity) => entity.key),
        entities,
        datasourceId,
        datasourceKind: 'databricks',
      },
      input.inventoryTimeoutMs ?? DEFAULT_INVENTORY_TIMEOUT_MS,
    ),
  );
  log(`✔ ${dataset.message ?? `dataset "${input.fixture.datasetName}" saved`}`);
  return {
    datasourceId,
    created: !previous,
    entities: entities.map((entity) => entity.key),
  };
}
