/**
 * Registers the local World Cup test REST API as a `rest` datasource plus a
 * dataset, in a RUNNING backend, through its HTTP API (the same calls the
 * frontend makes).
 *
 *   npm run worldcup:api          # terminal 1: the test API (port 55080)
 *   npm run start:dev             # terminal 2: the backend (port 3000)
 *   npm run worldcup:rest:setup   # terminal 3: this script
 *
 * Env: BACKEND_URL (default http://127.0.0.1:3000),
 *      WORLD_CUP_API_URL (default http://127.0.0.1:55080).
 *
 * Idempotent: the datasource is upserted by name, the dataset by name.
 */

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://127.0.0.1:3000').replace(
  /\/+$/,
  '',
);
const API_URL = (process.env.WORLD_CUP_API_URL ?? 'http://127.0.0.1:55080').replace(
  /\/+$/,
  '',
);

const DATASOURCE_NAME = 'World Cup REST API';
const DATASET_NAME = 'World Cup (REST)';
const GROUP = 'world_cup';
const PAGE_SIZE = 200;
const REQUEST_TIMEOUT_MS = 30_000;
// Inventory samples every endpoint; give a cold backend room.
const INVENTORY_TIMEOUT_MS = 180_000;

const ENDPOINT_NAMES = [
  'confederations',
  'countries',
  'teams',
  'tournaments',
  'tournament_teams',
  'venues',
  'players',
  'squad_members',
  'matches',
  'match_team_statistics',
  'goals',
  'disciplinary_events',
  'v_match_results',
  'v_player_goal_totals',
] as const;

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
  selectable?: boolean;
  schemas: {
    name: string;
    selectable?: boolean;
    tables: TableInfo[];
  }[];
}
interface OkResponse {
  ok: boolean;
  message?: string;
}

class SetupError extends Error {}

function buildEndpoints() {
  return ENDPOINT_NAMES.map((name) => ({
    name,
    group: GROUP,
    path: `/api/${GROUP}/${name}`,
    rowsPointer: '/data',
    pagination: {
      style: 'page' as const,
      pageParam: 'page',
      sizeParam: 'per_page',
      pageSize: PAGE_SIZE,
    },
  }));
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { message?: string } }).cause?.message;
    return cause ? `${err.message} (${cause})` : err.message;
  }
  return String(err);
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ status: number; body: T }> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    throw new SetupError(
      `${url} returned HTTP ${res.status} with a non-JSON body: ${text.slice(0, 200)}`,
    );
  }
  return { status: res.status, body: body as T };
}

async function probeTestApi(): Promise<void> {
  const url = `${API_URL}/api/${GROUP}/tournaments?per_page=1`;
  try {
    const { status } = await requestJson<unknown>(url, {}, 10_000);
    if (status >= 400) {
      throw new SetupError(`Test API answered HTTP ${status} at ${url}`);
    }
  } catch (err) {
    if (err instanceof SetupError) throw err;
    throw new SetupError(
      `World Cup test API unreachable at ${API_URL} (${describe(err)}).\n` +
        '  Start it with: npm run worldcup:api',
    );
  }
}

async function listDatasources(): Promise<{ id: string; name: string }[]> {
  try {
    const { status, body } = await requestJson<{
      datasources?: { id: string; name: string }[];
    }>(`${BACKEND_URL}/datasources`, {}, 10_000);
    if (status >= 400 || !Array.isArray(body?.datasources)) {
      throw new SetupError(
        `Backend answered HTTP ${status} at ${BACKEND_URL}/datasources`,
      );
    }
    return body.datasources;
  } catch (err) {
    if (err instanceof SetupError) throw err;
    throw new SetupError(
      `Backend unreachable at ${BACKEND_URL} (${describe(err)}).\n` +
        '  Start the app or the backend first (e.g. npm run start:dev in backend/).',
    );
  }
}

async function postChecked<T extends OkResponse>(
  path: string,
  payload: unknown,
  what: string,
): Promise<T> {
  const { status, body } = await requestJson<T>(`${BACKEND_URL}${path}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  // Endpoints report failures as HTTP 200 + { ok: false, message }.
  if (status >= 400 || !body?.ok) {
    throw new SetupError(
      `${what} failed: ${body?.message ?? `HTTP ${status}`}`,
    );
  }
  return body;
}

async function upsertDatasource(existingId?: string): Promise<string> {
  const payload = {
    ...(existingId ? { id: existingId } : {}),
    name: DATASOURCE_NAME,
    kind: 'rest',
    config: {
      baseUrl: API_URL,
      auth: { type: 'none' },
      endpoints: buildEndpoints(),
    },
  };
  const res = await postChecked<OkResponse & { datasource?: { id: string } }>(
    '/datasources',
    payload,
    'Saving the datasource',
  );
  const id = res.datasource?.id ?? existingId;
  if (!id) throw new SetupError('Backend saved the datasource but returned no id');
  return id;
}

async function fetchInventory(datasourceId: string): Promise<CatalogInfo[]> {
  const { status, body } = await requestJson<
    OkResponse & { catalogs?: CatalogInfo[] }
  >(
    `${BACKEND_URL}/datasources/${encodeURIComponent(datasourceId)}/inventory?refresh=true`,
    {},
    INVENTORY_TIMEOUT_MS,
  );
  if (status >= 400 || !body?.ok || !body.catalogs) {
    throw new SetupError(
      `Inventory failed: ${body?.message ?? `HTTP ${status}`}`,
    );
  }
  return body.catalogs;
}

/** Verifies all expected tables came back usable; returns their snapshots. */
function snapshotEntities(catalogs: CatalogInfo[]): EntitySnapshot[] {
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
  const rows: [string, string][] = [];
  for (const name of ENDPOINT_NAMES) {
    const key = `api.${GROUP}.${name}`;
    const table = found.get(key);
    if (!table) {
      problems.push(`${key}: missing from inventory`);
      rows.push([key, 'MISSING']);
      continue;
    }
    if (table.selectable === false) {
      problems.push(`${key}: not selectable (endpoint fetch failed)`);
    } else if (table.columns.length === 0) {
      problems.push(`${key}: no columns inferred`);
    }
    rows.push([key, String(table.columns.length)]);
    entities.push({
      key,
      columns: table.columns.map(({ name: n, type, nullable }) => ({
        name: n,
        type,
        nullable,
      })),
    });
  }

  const width = Math.max(...rows.map(([k]) => k.length), 'entity'.length);
  console.log(`\n${'entity'.padEnd(width)}  columns`);
  console.log(`${'-'.repeat(width)}  -------`);
  for (const [key, count] of rows) console.log(`${key.padEnd(width)}  ${count}`);
  console.log('');

  if (problems.length > 0) {
    throw new SetupError(
      `Inventory check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
  return entities;
}

async function main(): Promise<void> {
  console.log(`Test API: ${API_URL}\nBackend:  ${BACKEND_URL}`);

  await probeTestApi();
  console.log('✔ test API reachable');
  const existing = await listDatasources();
  console.log('✔ backend reachable');

  const previous = existing.find((d) => d.name === DATASOURCE_NAME);
  const datasourceId = await upsertDatasource(previous?.id);
  console.log(
    `✔ datasource "${DATASOURCE_NAME}" ${previous ? 'updated' : 'created'} (${datasourceId})`,
  );

  const catalogs = await fetchInventory(datasourceId);
  const entities = snapshotEntities(catalogs);
  console.log(`✔ inventory: ${entities.length} entities`);

  const res = await postChecked('/datasets', {
    name: DATASET_NAME,
    tables: entities.map((e) => e.key),
    entities,
    datasourceId,
    datasourceKind: 'rest',
  }, 'Saving the dataset');

  console.log(`✔ ${res.message ?? `dataset "${DATASET_NAME}" saved`}`);
  console.log(
    `\nDone.\n  datasource: ${DATASOURCE_NAME} (${datasourceId})\n  dataset:    ${DATASET_NAME}\n  entities:   ${entities.length}\n\n` +
      `Run the eval from Agents → assistant → Evals, datasource '${DATASOURCE_NAME}', set 'World Cup (REST API)'.`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof SetupError) {
    console.error(`\n✖ ${error.message}\n`);
  } else {
    console.error('\n✖ Setup crashed:');
    console.error(error);
  }
  process.exit(1);
});
