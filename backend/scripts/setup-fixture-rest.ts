/**
 * Registers a local fixture REST API (`scripts/worldcup-rest-api/serve.ts`) as
 * a `rest` datasource plus a dataset in a RUNNING backend, through its HTTP
 * API (the same calls the frontend makes), one datasource per server variant.
 *
 *   npm run worldcup:api                  # terminal 1: the API (port 55080)
 *   npm run start:dev                     # terminal 2: the backend (port 3000)
 *   npm run fixture:rest:setup            # terminal 3: this script
 *
 *   npm run fixture:rest:setup -- --fixture finance           # API on 55081
 *   npm run fixture:rest:setup -- --api-url http://127.0.0.1:55092 --variant cursor
 *
 * Flags (each also an environment variable):
 *   --api-url <url>      REST_API_URL (or WORLD_CUP_API_URL); default the
 *                        fixture's port: 55080 World Cup, 55081 finance,
 *                        55082 marketing analytics
 *   --fixture <id>       world-cup | finance | marketing-analytics (or the
 *                        -rest id); default: whatever the API serves
 *   --variant <label>    appended to the names, so variants sit side by side:
 *                        "World Cup REST API (cursor)", "World Cup (REST cursor)";
 *                        no commas (EVAL_DATASETS is comma-separated)
 *   --api-token <t>      REST_API_TOKEN: the API's bearer token; a server run
 *                        with a profile needs none (the profile's is used)
 *   --max-rows <e>=<n>   a per-endpoint row cap on the datasource (repeatable,
 *                        or comma-separated); a profile may set some
 *   --allow-unavailable  register endpoints the inventory cannot read, instead
 *                        of failing (the refused ones are always expected)
 *   --backend-url <url>  BACKEND_URL, default http://127.0.0.1:3000
 *   --backend-token <t>  BACKEND_TOKEN: a session token to call the backend
 *                        with (an org server's `qti_session`); without one the
 *                        script signs in as a local persona when it must
 *   --user <id>          BACKEND_USER, the local persona, default `local`
 *                        (Demo User)
 *
 * The endpoints come from the backend's OpenAPI discovery (the Discover button),
 * as a user would get them; the script only adds row caps. Idempotent: the
 * datasource and the dataset are upserted by name.
 */
import {
  findFixture,
  type SampleFixture,
} from '../src/modules/testing-data/fixtures/registry';
import type { RestEndpointDef } from '../src/modules/datasources/entities/datasource.entity';
import { FIXTURE_SOURCES, PROFILES } from './worldcup-rest-api/rest-fixture';

/** The REST connector's own limits (rest.connector.ts), for the warnings. */
export const CONNECTOR_DEFAULT_MAX_ROWS = 10_000;
export const CONNECTOR_MAX_PAGES = 50;
const CONNECTOR_DEFAULT_PAGE_SIZE = 100;

const REQUEST_TIMEOUT_MS = 30_000;
// Inventory samples every endpoint; give a cold backend room.
const INVENTORY_TIMEOUT_MS = 180_000;

export interface SetupOptions {
  backendUrl: string;
  backendToken?: string;
  backendOrigin?: string;
  userId: string;
  apiUrl: string;
  apiToken?: string;
  /** A fixture id the API must serve (`world-cup`, `finance`, …). */
  fixture?: string;
  variant?: string;
  maxRows: Record<string, number>;
  allowUnavailable: boolean;
}

/** What the API says about itself at `/` (rest-fixture.ts `buildIndex`). */
export interface ApiIndex {
  fixture?: string;
  schema?: string;
  rows?: Record<string, number>;
  switches?: {
    profile?: string | null;
    paging?: string;
    defaultPageSize?: number;
    maxPageSize?: number;
    nested?: string[];
    wrapped?: string[];
    refused?: string[];
    tokenRequired?: boolean;
  };
}

interface ColumnSnapshot {
  name: string;
  type: string;
  nullable: boolean;
}
interface EntitySnapshot {
  key: string;
  columns: ColumnSnapshot[];
}
interface TableInfo {
  name: string;
  columns: ColumnSnapshot[];
  selectable?: boolean;
}
interface CatalogInfo {
  name: string;
  schemas: { name: string; tables: TableInfo[] }[];
}
interface OkResponse {
  ok: boolean;
  message?: string;
}

export class SetupError extends Error {}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const USAGE =
  'Usage: setup-fixture-rest.ts [--fixture <id>] [--api-url <url>] [--variant <label>] ' +
  '[--api-token <t>] [--max-rows <endpoint>=<n>] [--allow-unavailable] ' +
  '[--backend-url <url>] [--backend-token <t>] [--user <id>]';

const VALUE_FLAGS = [
  'api-url',
  'fixture',
  'variant',
  'api-token',
  'max-rows',
  'backend-url',
  'backend-token',
  'user',
];

function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** `<endpoint>=<n>[,<endpoint>=<n>…]` into a map; refuses anything else. */
export function parseMaxRows(
  values: readonly string[],
): Record<string, number> {
  const caps: Record<string, number> = {};
  for (const item of values.flatMap((value) => value.split(','))) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const match = /^([A-Za-z0-9_]+)=(\d+)$/.exec(trimmed);
    if (!match || Number(match[2]) < 1) {
      throw new SetupError(
        `--max-rows takes <endpoint>=<positive number>, got "${trimmed}".`,
      );
    }
    caps[match[1]] = Number(match[2]);
  }
  return caps;
}

/** The fixture source a `--fixture` value names (`finance` or `finance-rest`). */
function fixtureSourceId(raw: string): string {
  const id = raw.trim().replace(/-rest$/, '');
  if (!FIXTURE_SOURCES[id]) {
    throw new SetupError(
      `Unknown fixture "${raw}". Known: ${Object.keys(FIXTURE_SOURCES).join(', ')}.`,
    );
  }
  return id;
}

export function parseSetupArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): SetupOptions {
  const values = new Map<string, string[]>();
  let allowUnavailable = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--allow-unavailable') {
      allowUnavailable = true;
      continue;
    }
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match || !VALUE_FLAGS.includes(match[1])) {
      throw new SetupError(`Unexpected argument "${arg}". ${USAGE}`);
    }
    let value = match[2];
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new SetupError(`--${match[1]} needs a value. ${USAGE}`);
      }
      i++;
    }
    values.set(match[1], [...(values.get(match[1]) ?? []), value]);
  }
  const one = (name: string): string | undefined => {
    const list = values.get(name);
    const value = list?.[list.length - 1];
    return value === undefined || value.trim() === ''
      ? undefined
      : value.trim();
  };
  const fixture = one('fixture');
  const variant = one('variant');
  if (variant?.includes(',')) {
    throw new SetupError(
      `--variant must not contain a comma (EVAL_DATASETS lists dataset names separated by commas), got "${variant}".`,
    );
  }
  const sourceId = fixture ? fixtureSourceId(fixture) : undefined;
  const defaultApiUrl = `http://127.0.0.1:${FIXTURE_SOURCES[sourceId ?? 'world-cup'].defaultPort}`;
  const nonEmpty = (value: string | undefined) =>
    value === undefined || value.trim() === '' ? undefined : value.trim();
  return {
    backendUrl: trimUrl(
      one('backend-url') ??
        nonEmpty(env.BACKEND_URL) ??
        'http://127.0.0.1:3000',
    ),
    ...((one('backend-token') ?? nonEmpty(env.BACKEND_TOKEN))
      ? { backendToken: one('backend-token') ?? nonEmpty(env.BACKEND_TOKEN) }
      : {}),
    ...(nonEmpty(env.BACKEND_ORIGIN)
      ? { backendOrigin: trimUrl(env.BACKEND_ORIGIN as string) }
      : {}),
    userId: one('user') ?? nonEmpty(env.BACKEND_USER) ?? 'local',
    apiUrl: trimUrl(
      one('api-url') ??
        (sourceId
          ? undefined
          : (nonEmpty(env.REST_API_URL) ?? nonEmpty(env.WORLD_CUP_API_URL))) ??
        defaultApiUrl,
    ),
    ...((one('api-token') ?? nonEmpty(env.REST_API_TOKEN))
      ? { apiToken: one('api-token') ?? nonEmpty(env.REST_API_TOKEN) }
      : {}),
    ...(sourceId ? { fixture: sourceId } : {}),
    ...(variant ? { variant } : {}),
    maxRows: parseMaxRows(values.get('max-rows') ?? []),
    allowUnavailable,
  };
}

/** The datasource and dataset names of a REST fixture, with the variant. */
export function variantNames(
  fixture: Pick<SampleFixture, 'datasourceName' | 'datasetName'>,
  variant?: string,
): { datasourceName: string; datasetName: string } {
  if (!variant) {
    return {
      datasourceName: fixture.datasourceName,
      datasetName: fixture.datasetName,
    };
  }
  const datasetName = fixture.datasetName.endsWith(')')
    ? `${fixture.datasetName.slice(0, -1)} ${variant})`
    : `${fixture.datasetName} (${variant})`;
  return {
    datasourceName: `${fixture.datasourceName} (${variant})`,
    datasetName,
  };
}

/** The registry entry of the REST sample an API's fixture belongs to. */
export function restFixtureFor(fixtureId: string): SampleFixture {
  const fixture = findFixture(`${fixtureId}-rest`);
  if (!fixture || fixture.datasourceKind !== 'rest') {
    throw new SetupError(
      `No REST sample "${fixtureId}-rest" in the fixture registry for the fixture "${fixtureId}" the API serves.`,
    );
  }
  return fixture;
}

/**
 * The headers that authenticate this script to the backend:
 * - a given token goes as the local-mode bearer and as the org server's
 *   `qti_session` cookie, with the `Origin` an org server checks on writes;
 * - otherwise, when the backend answers 401, the script signs in as a local
 *   persona (`POST /auth/local/sign-in`, admin R69 to R73) and sends the
 *   token it gets as `Authorization: Bearer`;
 * - a backend that needs no sign-in gets no header.
 */
export async function backendAuthHeaders(
  options: Pick<
    SetupOptions,
    'backendUrl' | 'backendToken' | 'backendOrigin' | 'userId'
  >,
  fetchFn: FetchLike = fetch,
): Promise<Record<string, string>> {
  const { backendUrl } = options;
  if (options.backendToken) {
    return {
      authorization: `Bearer ${options.backendToken}`,
      cookie: `qti_session=${options.backendToken}`,
      origin: options.backendOrigin ?? new URL(backendUrl).origin,
    };
  }
  let probe: Response;
  try {
    probe = await fetchFn(`${backendUrl}/datasources`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new SetupError(
      `Backend unreachable at ${backendUrl} (${describe(err)}).\n` +
        '  Start the app or the backend first (e.g. npm run start:dev in backend/).',
    );
  }
  if (probe.status !== 401) return {};
  const res = await fetchFn(`${backendUrl}/auth/local/sign-in`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ userId: options.userId }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => undefined)) as
    { token?: unknown } | undefined;
  if (!res.ok || typeof body?.token !== 'string' || !body.token) {
    throw new SetupError(
      `The backend at ${backendUrl} needs a sign-in, and signing in as the local persona "${options.userId}" failed (HTTP ${res.status}).\n` +
        '  On an org server, sign in in the browser and pass the qti_session cookie value as BACKEND_TOKEN; ' +
        'in local mode, check the persona id (--user, default "local").',
    );
  }
  return { authorization: `Bearer ${body.token}` };
}

/**
 * The datasource's endpoints: discovery's proposal, plus row caps. A cap
 * given on the command line or by the server's profile wins; an endpoint with
 * more rows than the connector's default cap (10 000) gets its row count, so
 * the datasource reads it whole. A page or offset endpoint whose rows need more
 * than the connector's 50 pages gets a bigger page, up to the server's maximum.
 * What still cannot be read whole is returned as a warning.
 */
export function planEndpoints(
  discovered: readonly RestEndpointDef[],
  index: ApiIndex,
  caps: Readonly<Record<string, number>>,
): { endpoints: RestEndpointDef[]; notes: string[] } {
  const notes: string[] = [];
  const rows = index.rows ?? {};
  const maxPageSize = index.switches?.maxPageSize;
  const serverPageSize =
    index.switches?.defaultPageSize ?? CONNECTOR_DEFAULT_PAGE_SIZE;
  const endpoints = discovered.map((original) => {
    const endpoint: RestEndpointDef = {
      ...original,
      ...(original.pagination
        ? { pagination: { ...original.pagination } }
        : {}),
    };
    const count = rows[endpoint.name];
    const cap = caps[endpoint.name];
    if (cap !== undefined) {
      endpoint.maxRows = cap;
      notes.push(
        `${endpoint.name}: capped at ${cap} rows on the datasource${count !== undefined ? ` (the API serves ${count})` : ''}`,
      );
    } else if (count !== undefined && count > CONNECTOR_DEFAULT_MAX_ROWS) {
      endpoint.maxRows = count;
      notes.push(
        `${endpoint.name}: ${count} rows, more than the connector's default cap of ${CONNECTOR_DEFAULT_MAX_ROWS}; maxRows set to ${count}`,
      );
    }
    if (count === undefined) return endpoint;
    const wanted = Math.min(
      count,
      endpoint.maxRows ?? CONNECTOR_DEFAULT_MAX_ROWS,
    );
    const pagination = endpoint.pagination;
    const style = pagination?.style ?? 'none';
    if (pagination && (style === 'page' || style === 'offset')) {
      const pageSize = pagination.pageSize ?? CONNECTOR_DEFAULT_PAGE_SIZE;
      const needed = Math.ceil(wanted / CONNECTOR_MAX_PAGES);
      if (needed > pageSize) {
        const bigger = Math.min(needed, maxPageSize ?? needed);
        if (bigger > pageSize) {
          pagination.pageSize = bigger;
          notes.push(
            `${endpoint.name}: page size raised from ${pageSize} to ${bigger} so ${wanted} rows fit in ${CONNECTOR_MAX_PAGES} pages`,
          );
        }
        if (bigger * CONNECTOR_MAX_PAGES < wanted) {
          notes.push(
            `${endpoint.name}: WARNING ${wanted} rows need more than ${CONNECTOR_MAX_PAGES} pages of ${bigger}; the connector stops at ${bigger * CONNECTOR_MAX_PAGES} rows without saying so`,
          );
        }
      }
    } else if (style === 'cursor') {
      // The connector sends no page size with a cursor: pages are the server's.
      if (serverPageSize * CONNECTOR_MAX_PAGES < wanted) {
        notes.push(
          `${endpoint.name}: WARNING ${wanted} rows need more than ${CONNECTOR_MAX_PAGES} cursor pages of ${serverPageSize}; the connector stops at ${serverPageSize * CONNECTOR_MAX_PAGES} rows without saying so`,
        );
      }
    }
    return endpoint;
  });
  return { endpoints, notes };
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { message?: string } }).cause?.message;
    return cause ? `${err.message} (${cause})` : err.message;
  }
  return String(err);
}

class Client {
  constructor(
    private readonly baseUrl: string,
    private readonly headers: Record<string, string>,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async json<T>(
    path: string,
    init: RequestInit = {},
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<{ status: number; body: T }> {
    const url = `${this.baseUrl}${path}`;
    const res = await this.fetchFn(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...this.headers,
      },
    });
    const text = await res.text();
    try {
      return {
        status: res.status,
        body: (text ? JSON.parse(text) : undefined) as T,
      };
    } catch {
      throw new SetupError(
        `${url} returned HTTP ${res.status} with a non-JSON body: ${text.slice(0, 200)}`,
      );
    }
  }

  async post<T extends OkResponse>(
    path: string,
    payload: unknown,
    what: string,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const { status, body } = await this.json<T>(
      path,
      { method: 'POST', body: JSON.stringify(payload) },
      timeoutMs,
    );
    // Endpoints report failures as HTTP 200 + { ok: false, message }.
    if (status >= 400 || !body?.ok) {
      throw new SetupError(
        `${what} failed: ${body?.message ?? `HTTP ${status}`}`,
      );
    }
    return body;
  }
}

async function readIndex(
  apiUrl: string,
  fetchFn: FetchLike,
): Promise<ApiIndex> {
  try {
    const res = await fetchFn(`${apiUrl}/`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      throw new SetupError(`The API answered HTTP ${res.status} at ${apiUrl}/`);
    return (await res.json()) as ApiIndex;
  } catch (err) {
    if (err instanceof SetupError) throw err;
    throw new SetupError(
      `Fixture REST API unreachable at ${apiUrl} (${describe(err)}).\n` +
        '  Start it with: npm run worldcup:api (or finance:api, marketing-analytics:api)',
    );
  }
}

/** Fetches one row of a served, unrefused endpoint, to prove the token works. */
async function probeApi(
  apiUrl: string,
  index: ApiIndex,
  token: string | undefined,
  fetchFn: FetchLike,
): Promise<void> {
  const refused = new Set(index.switches?.refused ?? []);
  const name = Object.keys(index.rows ?? {}).find((n) => !refused.has(n));
  if (!name || !index.schema) return;
  const url = `${apiUrl}/api/${index.schema}/${name}`;
  const res = await fetchFn(url, {
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) {
    throw new SetupError(
      `The API refused ${token ? 'the bearer token' : 'a request without a token'} at ${url}. ` +
        'Pass its token with --api-token or REST_API_TOKEN.',
    );
  }
  if (!res.ok)
    throw new SetupError(`The API answered HTTP ${res.status} at ${url}`);
}

/**
 * The dataset's entities from the inventory. A refused endpoint must come
 * back unreadable (it proves the switch works) and is kept with no columns,
 * so the assistant sees it exists; any other unreadable endpoint fails the
 * setup unless `allowUnavailable`.
 */
export function snapshotEntities(
  catalogs: readonly CatalogInfo[],
  keys: readonly { key: string; name: string }[],
  refused: ReadonlySet<string>,
  allowUnavailable: boolean,
): { entities: EntitySnapshot[]; problems: string[]; lines: string[] } {
  const found = new Map<string, TableInfo>();
  for (const catalog of catalogs) {
    for (const schema of catalog.schemas) {
      for (const table of schema.tables) {
        found.set(`${catalog.name}.${schema.name}.${table.name}`, table);
      }
    }
  }
  const problems: string[] = [];
  const entities: EntitySnapshot[] = [];
  const lines: string[] = [];
  for (const { key, name } of keys) {
    const table = found.get(key);
    if (!table) {
      problems.push(`${key}: missing from inventory`);
      lines.push(`${key}  MISSING`);
      continue;
    }
    const unreadable = table.selectable === false;
    if (refused.has(name)) {
      if (!unreadable) {
        problems.push(
          `${key}: the API refuses it, yet the inventory read it (is the switch on?)`,
        );
      }
      lines.push(`${key}  refused by the API (expected)`);
    } else if (unreadable) {
      if (!allowUnavailable) {
        problems.push(`${key}: not selectable (endpoint fetch failed)`);
      }
      lines.push(`${key}  UNREADABLE${allowUnavailable ? ' (kept)' : ''}`);
    } else if (table.columns.length === 0) {
      problems.push(`${key}: no columns inferred`);
      lines.push(`${key}  0 columns`);
    } else {
      lines.push(`${key}  ${table.columns.length} columns`);
    }
    entities.push({
      key,
      columns: table.columns.map(({ name: column, type, nullable }) => ({
        name: column,
        type,
        nullable,
      })),
    });
  }
  return { entities, problems, lines };
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchFn: FetchLike = fetch,
): Promise<void> {
  const options = parseSetupArgs(argv, env);
  console.log(
    `Fixture API: ${options.apiUrl}\nBackend:     ${options.backendUrl}`,
  );

  const index = await readIndex(options.apiUrl, fetchFn);
  const fixtureId = index.fixture ?? 'world-cup';
  if (options.fixture && options.fixture !== fixtureId) {
    throw new SetupError(
      `The API at ${options.apiUrl} serves "${fixtureId}", not "${options.fixture}".`,
    );
  }
  const fixture = restFixtureFor(fixtureId);
  const profile = index.switches?.profile
    ? PROFILES[index.switches.profile]
    : undefined;
  const apiToken =
    options.apiToken ??
    (index.switches?.tokenRequired ? profile?.server.token : undefined);
  if (index.switches?.tokenRequired && !apiToken) {
    throw new SetupError(
      'The API requires a bearer token: pass it with --api-token or REST_API_TOKEN.',
    );
  }
  await probeApi(options.apiUrl, index, apiToken, fetchFn);
  console.log(
    `✔ API reachable: ${fixtureId}, switches ${JSON.stringify(index.switches ?? {})}`,
  );

  const backend = new Client(
    options.backendUrl,
    await backendAuthHeaders(options, fetchFn),
    fetchFn,
  );
  const listed = await backend.json<{
    datasources?: { id: string; name: string }[];
  }>('/datasources');
  if (listed.status >= 400 || !Array.isArray(listed.body?.datasources)) {
    throw new SetupError(
      `Backend answered HTTP ${listed.status} at ${options.backendUrl}/datasources`,
    );
  }
  console.log('✔ backend reachable and signed in');

  const { datasourceName, datasetName } = variantNames(
    fixture,
    options.variant,
  );
  const auth = apiToken
    ? { type: 'bearer' as const, token: apiToken }
    : { type: 'none' as const };
  const discovery = await backend.post<
    OkResponse & {
      endpoints?: { endpoint: RestEndpointDef; listResponse: boolean }[];
    }
  >(
    '/datasources/rest/discover',
    { config: { baseUrl: options.apiUrl, auth, endpoints: [] } },
    'OpenAPI discovery',
  );
  const discovered = (discovery.endpoints ?? [])
    .filter((found) => found.listResponse)
    .map((found) => found.endpoint);
  const { endpoints, notes } = planEndpoints(discovered, index, {
    ...(profile?.datasource.maxRows ?? {}),
    ...options.maxRows,
  });
  console.log(`✔ discovery: ${endpoints.length} endpoints`);
  for (const endpoint of endpoints) {
    const p = endpoint.pagination;
    console.log(
      `    ${endpoint.name.padEnd(28)} ${p?.style ?? 'none'}` +
        `${p?.pageSize ? ` size ${p.pageSize}` : ''}` +
        `${p?.cursorPointer ? ` cursor ${p.cursorPointer}` : ''}` +
        ` rows ${endpoint.rowsPointer || '(root)'}` +
        `${endpoint.maxRows ? ` maxRows ${endpoint.maxRows}` : ''}`,
    );
  }
  for (const note of notes) console.log(`  · ${note}`);

  const previous = listed.body.datasources?.find(
    (d) => d.name === datasourceName,
  );
  const saved = await backend.post<
    OkResponse & { datasource?: { id: string } }
  >(
    '/datasources',
    {
      ...(previous ? { id: previous.id } : {}),
      name: datasourceName,
      kind: 'rest',
      config: { baseUrl: options.apiUrl, auth, endpoints },
    },
    'Saving the datasource',
  );
  const datasourceId = saved.datasource?.id ?? previous?.id;
  if (!datasourceId)
    throw new SetupError('Backend saved the datasource but returned no id');
  console.log(
    `✔ datasource "${datasourceName}" ${previous ? 'updated' : 'created'} (${datasourceId})`,
  );

  const inventory = await backend.json<
    OkResponse & { catalogs?: CatalogInfo[] }
  >(
    `/datasources/${encodeURIComponent(datasourceId)}/inventory?refresh=true`,
    {},
    INVENTORY_TIMEOUT_MS,
  );
  if (
    inventory.status >= 400 ||
    !inventory.body?.ok ||
    !inventory.body.catalogs
  ) {
    throw new SetupError(
      `Inventory failed: ${inventory.body?.message ?? `HTTP ${inventory.status}`}`,
    );
  }
  const keys = endpoints.map((endpoint) => ({
    key: `api.${endpoint.group ?? 'default'}.${endpoint.name}`,
    name: endpoint.name,
  }));
  const { entities, problems, lines } = snapshotEntities(
    inventory.body.catalogs,
    keys,
    new Set(index.switches?.refused ?? []),
    options.allowUnavailable,
  );
  console.log(`\n${lines.map((line) => `  ${line}`).join('\n')}\n`);
  if (problems.length > 0) {
    throw new SetupError(
      `Inventory check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}` +
        (options.allowUnavailable
          ? ''
          : '\n  (--allow-unavailable registers unreadable endpoints anyway, to run evals that show the failure)'),
    );
  }

  const dataset = await backend.post(
    '/datasets',
    {
      name: datasetName,
      tables: entities.map((entity) => entity.key),
      entities,
      datasourceId,
      datasourceKind: 'rest',
    },
    'Saving the dataset',
    INVENTORY_TIMEOUT_MS,
  );
  console.log(`✔ ${dataset.message ?? `dataset "${datasetName}" saved`}`);
  // A profile has its own sample when its set needs its endpoints (R120).
  const evalSample =
    (index.switches?.profile &&
      findFixture(`${fixture.id}-${index.switches.profile}`)?.id) ||
    fixture.id;
  console.log(
    `\nDone.\n  datasource: ${datasourceName} (${datasourceId})\n  dataset:    ${datasetName}\n  entities:   ${entities.length}\n\n` +
      `Run an eval set bound to the "${evalSample}" sample with the dataset "${datasetName}" ` +
      `(Agents → assistant → Evals, or EVAL_DATASETS="${datasetName}").`,
  );
}

export function runCli(): void {
  main().catch((error: unknown) => {
    if (error instanceof SetupError) {
      console.error(`\n✖ ${error.message}\n`);
    } else {
      console.error('\n✖ Setup crashed:');
      console.error(error);
    }
    process.exit(1);
  });
}

if (require.main === module) runCli();
