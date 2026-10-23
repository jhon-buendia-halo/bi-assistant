/**
 * The logic of the local fixture REST API (`serve.ts`): which fixture it
 * serves, the switches that make it behave like a real API, and the answer to
 * each request. Pure apart from reading the dump files, so the unit tests
 * drive it without a socket.
 *
 * One process serves one fixture under one set of switches (one "variant"),
 * each an environment variable or a flag (BA-187, specs/system/delivery.md):
 *
 *   REST_API_FIXTURE   / --fixture    world-cup (default) | finance | marketing-analytics
 *   REST_API_PORT      / --port       default 55080, 55081, 55082 by fixture
 *                                     (WORLD_CUP_API_PORT still works)
 *   REST_API_PROFILE   / --profile    a named set of the switches below
 *   REST_API_PAGING    / --paging     page (default) | offset | cursor | next-url
 *   REST_API_PAGE_SIZE / --page-size  rows per page, also the most a request gets
 *   REST_API_NESTED    / --nested     1 adds the fixture's nested endpoint
 *   REST_API_WRAPPED   / --wrapped    endpoints whose rows sit under result.items
 *   REST_API_REFUSE    / --refuse     endpoints that answer 503
 *   REST_API_RETRY_AFTER / --retry-after  seconds sent as Retry-After with a 503
 *   REST_API_TOKEN     / --token      a bearer token every /api request needs
 *
 * A flag beats its variable, a variable beats the profile.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { gunzipSync } from 'zlib';

export type Row = Record<string, unknown>;

export const PAGING_STYLES = ['page', 'offset', 'cursor', 'next-url'] as const;
export type PagingStyle = (typeof PAGING_STYLES)[number];

/** Without a page-size switch the server pages as it always did. */
export const DEFAULT_PER_PAGE = 100;
export const MAX_PER_PAGE = 500;

/** Where a fixture's dump lives and how the server presents it. */
export interface FixtureSource {
  id: string;
  /** The schema the dump came from; endpoints are `/api/<schema>/<relation>`. */
  schema: string;
  title: string;
  dataDir: string;
  defaultPort: number;
  /** The extra endpoint `REST_API_NESTED` adds, built from the dump's rows. */
  nested: { name: string; build: (relations: Map<string, Row[]>) => Row[] };
}

export interface ServerOptions {
  fixture: FixtureSource;
  port: number;
  profile?: string;
  paging: PagingStyle;
  /** Rows per page and the most one request returns; undefined = 100 / 500. */
  pageSize?: number;
  nested: boolean;
  wrapped: string[];
  refused: string[];
  /** Seconds sent as `Retry-After` with a refusal; none by default. */
  retryAfter?: number;
  token?: string;
}

/** What a profile sets: switches of the server, settings of the datasource. */
export interface RestProfile {
  description: string;
  fixtures: string[];
  server: {
    pageSize?: number;
    nested?: boolean;
    wrapped?: string[];
    refused?: string[];
    token?: string;
  };
  /** Read by the setup script: per-endpoint `maxRows` on the datasource. */
  datasource: { maxRows: Record<string, number> };
}

/**
 * `connector`: every behaviour the REST-only eval set needs on one server, so
 * the set runs whole against each paging style (agents-evals R164 to R183).
 * Pages of 20 rows (players, goals and squad members span 3 or 4 pages), the
 * nested `matches_nested` endpoint, `tournament_teams` under `result.items`,
 * `squad_members` refused, a bearer token, and a datasource cap of 20 rows on
 * `match_team_statistics` (32 rows).
 */
export const PROFILES: Readonly<Record<string, RestProfile>> = {
  connector: {
    description:
      'The REST connector cases: pages of 20, matches_nested, tournament_teams ' +
      'under result.items, squad_members refused, a bearer token, and ' +
      'match_team_statistics capped at 20 rows on the datasource.',
    fixtures: ['world-cup'],
    server: {
      pageSize: 20,
      nested: true,
      wrapped: ['tournament_teams'],
      refused: ['squad_members'],
      token: 'world-cup-test-token',
    },
    datasource: { maxRows: { match_team_statistics: 20 } },
  },
};

function byId(rows: Row[] | undefined): Map<unknown, Row> {
  return new Map((rows ?? []).map((row) => [row.id, row]));
}

/** World Cup: matches with home, away and venue as objects (two levels). */
function worldCupMatchesNested(relations: Map<string, Row[]>): Row[] {
  const teams = byId(relations.get('teams'));
  const venues = byId(relations.get('venues'));
  const tournaments = byId(relations.get('tournaments'));
  const team = (id: unknown): Row | null => {
    const found = teams.get(id);
    return found
      ? { name: found.common_name, fifa_code: found.fifa_code }
      : null;
  };
  return (relations.get('matches') ?? []).map((match) => {
    const venue = venues.get(match.venue_id);
    return {
      id: match.id,
      tournament_year: tournaments.get(match.tournament_id)?.tournament_year,
      match_number: match.match_number,
      stage: match.stage,
      kicked_off_at: match.kicked_off_at,
      went_to_extra_time: match.went_to_extra_time,
      attendance: match.attendance,
      venue: venue
        ? { name: venue.name, city: venue.city, capacity: venue.capacity }
        : null,
      home: {
        team: team(match.home_team_id),
        goals: match.home_goals,
        penalties: match.home_penalties,
      },
      away: {
        team: team(match.away_team_id),
        goals: match.away_goals,
        penalties: match.away_penalties,
      },
      winner: team(match.winner_team_id),
    };
  });
}

/** Finance: accounts with customer, account type and branch (and region) nested. */
function financeAccountsNested(relations: Map<string, Row[]>): Row[] {
  return (relations.get('v_accounts') ?? []).map((row) => ({
    account_id: row.account_id,
    account_number: row.account_number,
    currency: row.currency,
    status: row.status,
    opened_on: row.opened_on,
    closed_on: row.closed_on,
    current_balance_minor: row.current_balance_minor,
    is_test: row.is_test,
    customer: {
      id: row.customer_id,
      name: row.customer_name,
      segment: row.segment,
    },
    account_type: {
      code: row.account_type_code,
      name: row.account_type_name,
      category: row.account_category,
    },
    branch: {
      id: row.branch_id,
      name: row.branch_name,
      region: { name: row.region_name },
    },
  }));
}

/** Marketing analytics: campaign results with the campaign and the funnel nested. */
function marketingCampaignResultsNested(relations: Map<string, Row[]>): Row[] {
  const campaigns = byId(relations.get('campaigns'));
  return (relations.get('campaign_results') ?? []).map((row) => {
    const campaign = campaigns.get(row.campaign_id);
    return {
      id: row.id,
      period_id: row.period_id,
      budget_cents: row.budget_cents,
      spend_cents: row.spend_cents,
      campaign: campaign
        ? {
            id: campaign.id,
            code: campaign.campaign_code,
            name: campaign.name,
            objective: campaign.objective,
            carrier_id: campaign.carrier_id,
            line_id: campaign.line_id,
            channel_id: campaign.channel_id,
          }
        : null,
      funnel: {
        impressions: row.impressions,
        clicks: row.clicks,
        leads: row.leads,
        quotes: row.quotes,
        policies_bound: row.policies_bound,
      },
    };
  });
}

export const FIXTURE_SOURCES: Readonly<Record<string, FixtureSource>> = {
  'world-cup': {
    id: 'world-cup',
    schema: 'world_cup',
    title: 'World Cup Test API',
    dataDir: join(__dirname, 'data'),
    defaultPort: 55080,
    nested: { name: 'matches_nested', build: worldCupMatchesNested },
  },
  finance: {
    id: 'finance',
    schema: 'finance',
    title: 'Finance Test API',
    dataDir: join(__dirname, '..', 'fixtures', 'finance', 'data'),
    defaultPort: 55081,
    nested: { name: 'accounts_nested', build: financeAccountsNested },
  },
  'marketing-analytics': {
    id: 'marketing-analytics',
    schema: 'marketing_analytics',
    title: 'Marketing Analytics Test API',
    dataDir: join(__dirname, '..', 'fixtures', 'marketing-analytics', 'data'),
    defaultPort: 55082,
    nested: {
      name: 'campaign_results_nested',
      build: marketingCampaignResultsNested,
    },
  },
};

const SWITCHES = [
  'fixture',
  'port',
  'profile',
  'paging',
  'page-size',
  'nested',
  'wrapped',
  'refuse',
  'retry-after',
  'token',
] as const;
type Switch = (typeof SWITCHES)[number];

const USAGE =
  'Usage: serve.ts [--fixture world-cup|finance|marketing-analytics] [--port <n>] ' +
  '[--profile connector] [--paging page|offset|cursor|next-url] [--page-size <n>] ' +
  '[--nested 1] [--wrapped <a,b>] [--refuse <a,b>] [--retry-after <s>] [--token <t>] ' +
  '(or the REST_API_* environment variables)';

export class ServerOptionsError extends Error {}

function envName(name: Switch): string {
  return `REST_API_${name.toUpperCase().replace(/-/g, '_')}`;
}

/** `--name value` and `--name=value`; unknown flags are refused. */
function parseFlags(argv: readonly string[]): Map<Switch, string> {
  const flags = new Map<Switch, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match || !SWITCHES.includes(match[1] as Switch)) {
      throw new ServerOptionsError(`Unexpected argument "${arg}". ${USAGE}`);
    }
    let value = match[2];
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new ServerOptionsError(`--${match[1]} needs a value. ${USAGE}`);
      }
      i++;
    }
    flags.set(match[1] as Switch, value);
  }
  return flags;
}

function list(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function flag(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new ServerOptionsError(`REST_API_NESTED must be 1 or 0, got "${raw}".`);
}

function positive(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ServerOptionsError(
      `${name} must be a positive integer, got "${raw}".`,
    );
  }
  return value;
}

/**
 * The options of one process, from its flags, its environment and its
 * profile. Endpoint names are checked against the relations later
 * (`checkEndpointNames`), once the dump is read.
 */
export function readServerOptions(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[] = [],
): ServerOptions {
  const flags = parseFlags(argv);
  const get = (name: Switch): string | undefined => {
    const value = flags.get(name) ?? env[envName(name)];
    return value === undefined || value.trim() === '' ? undefined : value;
  };
  const fixtureId = get('fixture') ?? 'world-cup';
  const fixture = FIXTURE_SOURCES[fixtureId];
  if (!fixture) {
    throw new ServerOptionsError(
      `Unknown fixture "${fixtureId}". Known: ${Object.keys(FIXTURE_SOURCES).join(', ')}.`,
    );
  }
  const profileName = get('profile');
  const profile = profileName ? PROFILES[profileName] : undefined;
  if (profileName && !profile) {
    throw new ServerOptionsError(
      `Unknown profile "${profileName}". Known: ${Object.keys(PROFILES).join(', ')}.`,
    );
  }
  if (profile && !profile.fixtures.includes(fixture.id)) {
    throw new ServerOptionsError(
      `Profile "${profileName}" is for ${profile.fixtures.join(', ')}, not ${fixture.id}.`,
    );
  }
  const paging = get('paging') ?? 'page';
  if (!PAGING_STYLES.includes(paging as PagingStyle)) {
    throw new ServerOptionsError(
      `REST_API_PAGING must be one of ${PAGING_STYLES.join(', ')}, got "${paging}".`,
    );
  }
  const port =
    positive('REST_API_PORT', flags.get('port') ?? env.REST_API_PORT) ??
    positive('WORLD_CUP_API_PORT', env.WORLD_CUP_API_PORT) ??
    fixture.defaultPort;
  const pageSize =
    positive('REST_API_PAGE_SIZE', get('page-size')) ??
    profile?.server.pageSize;
  const retryAfter = positive('REST_API_RETRY_AFTER', get('retry-after'));
  if (pageSize !== undefined && pageSize > MAX_PER_PAGE) {
    throw new ServerOptionsError(
      `REST_API_PAGE_SIZE must be at most ${MAX_PER_PAGE}, got ${pageSize}.`,
    );
  }
  return {
    fixture,
    port,
    ...(profileName ? { profile: profileName } : {}),
    paging: paging as PagingStyle,
    ...(pageSize !== undefined ? { pageSize } : {}),
    nested: flag(get('nested')) ?? profile?.server.nested ?? false,
    wrapped: list(get('wrapped')) ?? profile?.server.wrapped ?? [],
    refused: list(get('refuse')) ?? profile?.server.refused ?? [],
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...((get('token') ?? profile?.server.token)
      ? { token: get('token') ?? profile?.server.token }
      : {}),
  };
}

/**
 * Every `<relation>.json` or `<relation>.json.gz` in a dump folder (files
 * starting with `_`, such as `_meta.json`, are skipped), by relation name.
 */
export function loadRelations(dataDir: string): Map<string, Row[]> {
  const relations = new Map<string, Row[]>();
  let files: string[];
  try {
    files = readdirSync(dataDir);
  } catch {
    throw new Error(`No dump folder at ${dataDir}.`);
  }
  for (const file of files
    .filter((name) => /\.json(\.gz)?$/.test(name) && !name.startsWith('_'))
    .sort()) {
    const raw = readFileSync(join(dataDir, file));
    const text = file.endsWith('.gz')
      ? gunzipSync(raw).toString('utf8')
      : raw.toString('utf8');
    const rows: unknown = JSON.parse(text);
    if (!Array.isArray(rows)) {
      throw new Error(`${file} must contain a JSON array of rows.`);
    }
    relations.set(file.replace(/\.json(\.gz)?$/, ''), rows as Row[]);
  }
  if (relations.size === 0) {
    throw new Error(`No data in ${dataDir}.`);
  }
  return relations;
}

/** The relations a process serves: the dump, plus the nested endpoint if on. */
export function servedRelations(
  options: ServerOptions,
  dump: Map<string, Row[]>,
): Map<string, Row[]> {
  const relations = new Map(dump);
  if (options.nested) {
    relations.set(
      options.fixture.nested.name,
      options.fixture.nested.build(dump),
    );
  }
  return relations;
}

/** Refuses a wrapped or refused endpoint that the fixture does not serve. */
export function checkEndpointNames(
  options: ServerOptions,
  relations: Map<string, Row[]>,
): void {
  for (const [variable, names] of [
    ['REST_API_WRAPPED', options.wrapped],
    ['REST_API_REFUSE', options.refused],
  ] as const) {
    const unknown = names.filter((name) => !relations.has(name));
    if (unknown.length > 0) {
      throw new ServerOptionsError(
        `${variable} names ${unknown.join(', ')}, which ${options.fixture.id} does not serve. Known: ${[...relations.keys()].join(', ')}.`,
      );
    }
  }
}

/** Rows per page when a request names none, and the most it may ask for. */
export function pageLimits(options: ServerOptions): {
  defaultSize: number;
  maxSize: number;
} {
  return options.pageSize
    ? { defaultSize: options.pageSize, maxSize: options.pageSize }
    : { defaultSize: DEFAULT_PER_PAGE, maxSize: MAX_PER_PAGE };
}

/** The query parameter carrying the page size, per paging style. */
function sizeParamOf(paging: PagingStyle): string {
  return paging === 'page' ? 'per_page' : 'limit';
}

/** The opaque token of cursor and next-url paging: the next row's offset. */
export function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

export function decodeCursor(token: string): number | undefined {
  const decoded = Buffer.from(token, 'base64url').toString('utf8');
  const match = /^o:(\d+)$/.exec(decoded);
  return match ? Number(match[1]) : undefined;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** OpenAPI 3.0 schema for one field, inferred from every row's value. */
export function inferSchema(values: unknown[]): Row {
  const present = values.filter(
    (value) => value !== null && value !== undefined,
  );
  const nullable = present.length < values.length;
  const sample = present[0];
  let schema: Row;
  if (isPlainObject(sample)) {
    schema = rowSchema(present.filter(isPlainObject));
  } else if (Array.isArray(sample)) {
    schema = { type: 'array', items: {} };
  } else if (typeof sample === 'number') {
    schema = {
      type: present.every((v) => Number.isInteger(v)) ? 'integer' : 'number',
    };
  } else if (typeof sample === 'boolean') {
    schema = { type: 'boolean' };
  } else {
    schema = { type: 'string' };
    const strings = present.filter((v): v is string => typeof v === 'string');
    if (strings.length > 0 && strings.every((v) => ISO_TIMESTAMP.test(v))) {
      schema.format = 'date-time';
    } else if (strings.length > 0 && strings.every((v) => ISO_DATE.test(v))) {
      schema.format = 'date';
    }
  }
  return nullable ? { ...schema, nullable: true } : schema;
}

export function rowSchema(rows: Row[]): Row {
  const columns = new Set<string>();
  for (const row of rows) Object.keys(row).forEach((key) => columns.add(key));
  const properties: Record<string, Row> = {};
  for (const column of columns) {
    properties[column] = inferSchema(rows.map((row) => row[column]));
  }
  return { type: 'object', properties };
}

/** The page fields of one paging style, as an OpenAPI properties object. */
function pageFields(options: ServerOptions): Record<string, Row> {
  const { maxSize } = pageLimits(options);
  switch (options.paging) {
    case 'page':
      return {
        page: { type: 'integer', minimum: 1 },
        per_page: { type: 'integer', minimum: 1, maximum: maxSize },
        total: { type: 'integer', minimum: 0 },
      };
    case 'offset':
      return {
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: maxSize },
        total: { type: 'integer', minimum: 0 },
      };
    case 'cursor':
      return {
        next_cursor: {
          type: 'string',
          nullable: true,
          description:
            'Pass as `cursor` to get the next page; null on the last page.',
        },
      };
    case 'next-url':
      return {
        next: {
          type: 'string',
          format: 'uri',
          nullable: true,
          description: 'The URL of the next page; null on the last page.',
        },
      };
  }
}

function queryParameters(options: ServerOptions): Row[] {
  const { defaultSize, maxSize } = pageLimits(options);
  const size: Row = {
    name: sizeParamOf(options.paging),
    in: 'query',
    description: `Rows per page (max ${maxSize}).`,
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: maxSize,
      default: defaultSize,
    },
  };
  switch (options.paging) {
    case 'page':
      return [
        {
          name: 'page',
          in: 'query',
          description: '1-based page number.',
          schema: { type: 'integer', minimum: 1, default: 1 },
        },
        size,
      ];
    case 'offset':
      return [
        {
          name: 'offset',
          in: 'query',
          description: '0-based index of the first row.',
          schema: { type: 'integer', minimum: 0, default: 0 },
        },
        size,
      ];
    case 'cursor':
      return [
        {
          name: 'cursor',
          in: 'query',
          description:
            'The `next_cursor` of the previous page; omit for the first.',
          schema: { type: 'string' },
        },
        size,
      ];
    case 'next-url':
      return [
        {
          name: 'page_token',
          in: 'query',
          description:
            'Set by the `next` URL of the previous page; follow that URL rather than building it.',
          schema: { type: 'string' },
        },
        size,
      ];
  }
}

export function buildOpenApi(
  options: ServerOptions,
  relations: Map<string, Row[]>,
): Row {
  const prefix = `/api/${options.fixture.schema}`;
  const schemas: Record<string, Row> = {};
  const paths: Record<string, Row> = {};
  for (const [name, rows] of relations) {
    schemas[name] = rowSchema(rows);
    const items = {
      type: 'array',
      items: { $ref: `#/components/schemas/${name}` },
    };
    schemas[`${name}_page`] = options.wrapped.includes(name)
      ? {
          type: 'object',
          properties: {
            result: {
              type: 'object',
              properties: { items, ...pageFields(options) },
            },
          },
        }
      : {
          type: 'object',
          properties: { data: items, ...pageFields(options) },
        };
    paths[`${prefix}/${name}`] = {
      get: {
        operationId: `list_${name}`,
        summary: `List ${name} (${rows.length} rows)`,
        tags: [options.fixture.schema],
        parameters: queryParameters(options),
        responses: {
          '200': {
            description: `A page of ${name} rows.`,
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${name}_page` },
              },
            },
          },
          ...(options.token
            ? { '401': { description: 'Missing or wrong bearer token.' } }
            : {}),
        },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: options.fixture.title,
      version: '1.1.0',
      description:
        `Read-only REST mirror of the ${options.fixture.id} fixture (schema ` +
        `\`${options.fixture.schema}\`): the same tables and views, served as ` +
        'paged JSON for testing REST datasources.',
    },
    servers: [{ url: '/' }],
    paths,
    components: {
      schemas,
      ...(options.token
        ? {
            securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
          }
        : {}),
    },
    ...(options.token ? { security: [{ bearerAuth: [] }] } : {}),
  };
}

/** The server's description of itself at `/`, read by the setup script. */
export function buildIndex(
  options: ServerOptions,
  relations: Map<string, Row[]>,
): Row {
  const prefix = `/api/${options.fixture.schema}`;
  const { defaultSize, maxSize } = pageLimits(options);
  return {
    name: options.fixture.title,
    fixture: options.fixture.id,
    schema: options.fixture.schema,
    docs: '/docs',
    openapi: '/openapi.json',
    endpoints: [...relations.keys()].map((name) => `${prefix}/${name}`),
    rows: Object.fromEntries(
      [...relations].map(([name, rows]) => [name, rows.length]),
    ),
    switches: {
      profile: options.profile ?? null,
      paging: options.paging,
      defaultPageSize: defaultSize,
      maxPageSize: maxSize,
      nested: options.nested ? [options.fixture.nested.name] : [],
      wrapped: options.wrapped,
      refused: options.refused,
      retryAfter: options.retryAfter ?? null,
      tokenRequired: Boolean(options.token),
    },
  };
}

/** One answer: what `serve.ts` writes to the socket. */
export interface ApiResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

function lenientInt(raw: string | null, fallback: number, min: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

/**
 * The answer to `GET /api/<schema>/<relation>?…`. Order of the checks: the
 * token (a real API authenticates first), the relation, the refusal, then the
 * page. Junk page numbers and sizes fall back to the defaults, as before; a
 * cursor or page token the server did not issue is a 400.
 */
export function handleApiRequest(
  options: ServerOptions,
  relations: Map<string, Row[]>,
  url: URL,
  authorization: string | undefined,
): ApiResponse {
  const prefix = `/api/${options.fixture.schema}/`;
  if (options.token && authorization !== `Bearer ${options.token}`) {
    return {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="fixture-api"' },
      body: { error: 'Missing or invalid bearer token.' },
    };
  }
  const path = url.pathname.replace(/\/+$/, '');
  const name = decodeURIComponent(path.slice(prefix.length));
  const rows = relations.get(name);
  if (!rows) {
    return { status: 404, body: { error: `Unknown table "${name}".` } };
  }
  if (options.refused.includes(name)) {
    return {
      status: 503,
      // Off by default: the app's global fetch honours Retry-After (BA-187
      // evidence), so a long one stalls every request to the endpoint.
      ...(options.retryAfter
        ? { headers: { 'Retry-After': String(options.retryAfter) } }
        : {}),
      body: { error: `The ${name} endpoint is temporarily unavailable.` },
    };
  }

  const { defaultSize, maxSize } = pageLimits(options);
  const params = url.searchParams;
  const size = Math.min(
    lenientInt(params.get(sizeParamOf(options.paging)), defaultSize, 1),
    maxSize,
  );
  let start: number;
  let fields: Row;
  switch (options.paging) {
    case 'page': {
      const page = lenientInt(params.get('page'), 1, 1);
      start = (page - 1) * size;
      fields = { page, per_page: size, total: rows.length };
      break;
    }
    case 'offset': {
      start = lenientInt(params.get('offset'), 0, 0);
      fields = { offset: start, limit: size, total: rows.length };
      break;
    }
    case 'cursor':
    case 'next-url': {
      const param = options.paging === 'cursor' ? 'cursor' : 'page_token';
      const token = params.get(param);
      const offset = token === null ? 0 : decodeCursor(token);
      if (offset === undefined) {
        return {
          status: 400,
          body: { error: `Invalid ${param} "${token?.slice(0, 80)}".` },
        };
      }
      start = offset;
      const nextOffset = start + size;
      const more = nextOffset < rows.length;
      if (options.paging === 'cursor') {
        fields = { next_cursor: more ? encodeCursor(nextOffset) : null };
      } else {
        const next = new URL(url.toString());
        next.search = '';
        next.searchParams.set('page_token', encodeCursor(nextOffset));
        next.searchParams.set('limit', String(size));
        fields = { next: more ? next.toString() : null };
      }
      break;
    }
  }
  const data = rows.slice(start, start + size);
  return {
    status: 200,
    body: options.wrapped.includes(name)
      ? { result: { items: data, ...fields } }
      : { data, ...fields },
  };
}
