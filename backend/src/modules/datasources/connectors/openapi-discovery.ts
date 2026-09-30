import type {
  DiscoveredEndpoint,
  RestEndpointDef,
} from '../entities/datasource.entity';

/**
 * Turns an OpenAPI 3.x / Swagger 2.0 document into REST endpoint definitions.
 * Pure: the caller fetches the spec. Only `GET` operations without path
 * parameters become endpoints; everything else is reported as skipped.
 */

type Json = Record<string, unknown>;

const MAX_REF_DEPTH = 16;
const ROWS_SEARCH_DEPTH = 2;
const CURSOR_SEARCH_DEPTH = 3;
/** Page size used when the spec caps it; fewer requests than most defaults. */
const DISCOVERED_PAGE_SIZE = 200;

const ROWS_NAMES = [
  'data',
  'items',
  'results',
  'records',
  'rows',
  'content',
  'values',
  'entries',
  'list',
  'objects',
];
const PAGE_PARAMS = ['page', 'page_number', 'pagenumber', 'page_no', 'pageno'];
const OFFSET_PARAMS = ['offset', 'skip', 'start', '$skip'];
const CURSOR_PARAMS = [
  'cursor',
  'page_token',
  'pagetoken',
  'next_token',
  'nexttoken',
  'starting_after',
  'after',
  'continuation',
  'continuation_token',
];
const SIZE_PARAMS = [
  'per_page',
  'perpage',
  'page_size',
  'pagesize',
  'limit',
  'size',
  'count',
  'take',
  'top',
  '$top',
  'max_results',
  'maxresults',
  'pagelen',
];
const CURSOR_FIELDS = [
  'next_cursor',
  'nextcursor',
  'next_page_token',
  'nextpagetoken',
  'next_token',
  'nexttoken',
  'cursor',
  'next',
];

export interface OpenApiDiscovery {
  title?: string;
  /** Absolute server URL the spec's paths are relative to. */
  serverUrl: string;
  endpoints: DiscoveredEndpoint[];
  skipped: { path: string; reason: string }[];
}

export function discoverFromOpenApi(
  spec: unknown,
  specUrl: string,
  baseUrl: string,
): OpenApiDiscovery {
  if (!isObject(spec)) {
    throw new Error('The spec is not a JSON object');
  }
  const isV3 = typeof spec.openapi === 'string' && spec.openapi.startsWith('3');
  const isV2 = spec.swagger === '2.0';
  if (!isV3 && !isV2) {
    throw new Error(
      'Not an OpenAPI 3.x or Swagger 2.0 document (no "openapi" / "swagger" field)',
    );
  }
  if (!isObject(spec.paths)) {
    throw new Error('The spec declares no paths');
  }

  const resolver = new RefResolver(spec);
  const serverUrl = isV3
    ? v3ServerUrl(spec, specUrl)
    : v2ServerUrl(spec, specUrl);
  const base = trimSlashes(baseUrl.trim() || serverUrl);
  const info = isObject(spec.info) ? spec.info : {};
  const title = typeof info.title === 'string' ? info.title : undefined;

  const endpoints: DiscoveredEndpoint[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const taken = new Set<string>();

  for (const [path, rawItem] of Object.entries(spec.paths)) {
    const item = resolver.resolve(rawItem);
    if (!isObject(item)) continue;
    const get = resolver.resolve(item.get);
    if (!isObject(get)) {
      skipped.push({ path, reason: 'no GET operation' });
      continue;
    }
    if (/\{[^}]+\}/.test(path)) {
      skipped.push({ path, reason: 'needs path parameters' });
      continue;
    }

    const params = [...asArray(item.parameters), ...asArray(get.parameters)]
      .map((p) => resolver.resolve(p))
      .filter((p): p is Json => isObject(p) && typeof p.name === 'string');
    const requiredQuery = params.filter(
      (p) =>
        p.in === 'query' &&
        p.required === true &&
        !isPaginationParam(p.name as string),
    );
    if (requiredQuery.length) {
      skipped.push({
        path,
        reason: `needs query parameter${requiredQuery.length > 1 ? 's' : ''} ${requiredQuery.map((p) => p.name as string).join(', ')}`,
      });
      continue;
    }

    const responseSchema = resolver.resolveSchema(
      isV3 ? v3ResponseSchema(get, resolver) : v2ResponseSchema(get, resolver),
    );
    const rows = findRows(responseSchema, resolver);
    const tags = asArray(get.tags).filter(
      (t): t is string => typeof t === 'string',
    );

    const endpoint: RestEndpointDef = {
      name: uniqueName(path, get, tags[0], taken),
      path: relativePath(serverUrl, path, base),
    };
    if (tags[0]) endpoint.group = tags[0];
    if (rows?.pointer) endpoint.rowsPointer = rows.pointer;
    const pagination = detectPagination(params, responseSchema, resolver, isV3);
    if (pagination) endpoint.pagination = pagination;

    const summary =
      typeof get.summary === 'string'
        ? get.summary
        : typeof get.description === 'string'
          ? get.description.split('\n')[0]
          : undefined;
    const fields = rows ? countFields(rows.item, resolver) : undefined;
    endpoints.push({
      endpoint,
      method: 'GET',
      ...(summary ? { summary: summary.slice(0, 200) } : {}),
      listResponse: !!rows,
      ...(fields !== undefined ? { fields } : {}),
    });
  }

  return { title, serverUrl, endpoints, skipped };
}

/** Local `$ref` lookup (`#/components/...`, `#/definitions/...`), cycle-safe. */
class RefResolver {
  constructor(private readonly root: Json) {}

  resolve(value: unknown, depth = 0): unknown {
    if (!isObject(value) || typeof value.$ref !== 'string') return value;
    if (depth >= MAX_REF_DEPTH) return undefined;
    const ref = value.$ref;
    if (!ref.startsWith('#/')) return undefined;
    let current: unknown = this.root;
    for (const raw of ref.slice(2).split('/')) {
      const segment = decodeURIComponent(raw)
        .replace(/~1/g, '/')
        .replace(/~0/g, '~');
      if (!isObject(current)) return undefined;
      current = current[segment];
    }
    return this.resolve(current, depth + 1);
  }

  /** Resolves refs and folds `allOf` into one object schema. */
  resolveSchema(value: unknown, depth = 0): Json | undefined {
    const schema = this.resolve(value);
    if (!isObject(schema)) return undefined;
    if (!Array.isArray(schema.allOf) || depth >= MAX_REF_DEPTH) return schema;
    const properties: Json = {};
    let merged: Json = { ...schema };
    delete merged.allOf;
    for (const part of schema.allOf) {
      const resolved = this.resolveSchema(part, depth + 1);
      if (!resolved) continue;
      if (isObject(resolved.properties)) {
        Object.assign(properties, resolved.properties);
      }
      merged = { ...resolved, ...merged };
    }
    if (isObject(schema.properties))
      Object.assign(properties, schema.properties);
    if (Object.keys(properties).length) {
      merged.properties = properties;
      merged.type ??= 'object';
    }
    return merged;
  }
}

function v3ServerUrl(spec: Json, specUrl: string): string {
  const [server] = asArray(spec.servers).filter(isObject);
  let url = typeof server?.url === 'string' ? server.url : '/';
  const variables = isObject(server?.variables) ? server.variables : {};
  url = url.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const variable = variables[name];
    const value = isObject(variable) ? variable.default : undefined;
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  });
  return trimSlashes(new URL(url || '/', specUrl).toString());
}

function v2ServerUrl(spec: Json, specUrl: string): string {
  const from = new URL(specUrl);
  const schemes = asArray(spec.schemes).filter(
    (s): s is string => typeof s === 'string',
  );
  const scheme = schemes.includes(from.protocol.replace(':', ''))
    ? from.protocol.replace(':', '')
    : (schemes[0] ?? from.protocol.replace(':', ''));
  const host =
    typeof spec.host === 'string' && spec.host ? spec.host : from.host;
  const basePath = typeof spec.basePath === 'string' ? spec.basePath : '';
  return trimSlashes(
    new URL(basePath || '/', `${scheme}://${host}`).toString(),
  );
}

function successResponse(
  operation: Json,
  resolver: RefResolver,
): Json | undefined {
  const responses = isObject(operation.responses) ? operation.responses : {};
  const key =
    ['200', '2XX', '2xx', '201', '203', '206'].find((k) => k in responses) ??
    Object.keys(responses).find((k) => /^2\d\d$/.test(k)) ??
    ('default' in responses ? 'default' : undefined);
  if (!key) return undefined;
  const response = resolver.resolve(responses[key]);
  return isObject(response) ? response : undefined;
}

function v3ResponseSchema(operation: Json, resolver: RefResolver): unknown {
  const response = successResponse(operation, resolver);
  const content = isObject(response?.content) ? response.content : {};
  const mediaType =
    content['application/json'] ??
    Object.entries(content).find(([type]) => /json/i.test(type))?.[1];
  return isObject(mediaType) ? mediaType.schema : undefined;
}

function v2ResponseSchema(operation: Json, resolver: RefResolver): unknown {
  return successResponse(operation, resolver)?.schema;
}

/**
 * Where the rows live: the root array, else the best array property within
 * `ROWS_SEARCH_DEPTH` levels — arrays of objects first, then shallow, then
 * well-known names (`data`, `items`, …).
 */
function findRows(
  schema: Json | undefined,
  resolver: RefResolver,
): { pointer: string; item: Json | undefined } | undefined {
  if (!schema) return undefined;
  if (isArraySchema(schema)) {
    return { pointer: '', item: resolver.resolveSchema(schema.items) };
  }
  const candidates: {
    pointer: string;
    item: Json | undefined;
    score: [number, number, number];
  }[] = [];
  const walk = (node: Json, pointer: string, depth: number) => {
    if (!isObject(node.properties) || depth >= ROWS_SEARCH_DEPTH) return;
    for (const [name, raw] of Object.entries(node.properties)) {
      const property = resolver.resolveSchema(raw);
      if (!property) continue;
      const path = `${pointer}/${escapePointer(name)}`;
      if (isArraySchema(property)) {
        const item = resolver.resolveSchema(property.items);
        const rowLike =
          !!item && (item.type === 'object' || isObject(item.properties));
        candidates.push({
          pointer: path,
          item,
          score: [rowLike ? 0 : 1, depth, nameRank(name)],
        });
      } else if (isObject(property.properties)) {
        walk(property, path, depth + 1);
      }
    }
  };
  walk(schema, '', 0);
  candidates.sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) {
      if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
    }
    return 0;
  });
  const [best] = candidates;
  return best ? { pointer: best.pointer, item: best.item } : undefined;
}

function isArraySchema(schema: Json): boolean {
  return schema.type === 'array' || schema.items !== undefined;
}

function nameRank(name: string): number {
  const i = ROWS_NAMES.indexOf(name.toLowerCase());
  return i === -1 ? ROWS_NAMES.length : i;
}

function countFields(
  item: Json | undefined,
  resolver: RefResolver,
): number | undefined {
  const schema = resolver.resolveSchema(item);
  return schema && isObject(schema.properties)
    ? Object.keys(schema.properties).length
    : undefined;
}

function isPaginationParam(name: string): boolean {
  const n = name.toLowerCase();
  return [PAGE_PARAMS, OFFSET_PARAMS, CURSOR_PARAMS, SIZE_PARAMS].some((list) =>
    list.includes(n),
  );
}

function detectPagination(
  params: Json[],
  responseSchema: Json | undefined,
  resolver: RefResolver,
  isV3: boolean,
): RestEndpointDef['pagination'] | undefined {
  const query = params.filter(
    (p) => p.in === 'query' && typeof p.name === 'string',
  );
  const find = (names: string[]) =>
    names
      .map((n) => query.find((p) => String(p.name).toLowerCase() === n))
      .find((p) => p !== undefined);

  const size = find(SIZE_PARAMS);
  const page = find(PAGE_PARAMS);
  const offset = find(OFFSET_PARAMS);
  const cursor = find(CURSOR_PARAMS);
  const pageSize = size ? sizeFor(size, resolver, isV3) : undefined;
  const sizePart = {
    ...(size ? { sizeParam: String(size.name) } : {}),
    ...(pageSize ? { pageSize } : {}),
  };

  if (cursor) {
    const cursorPointer = findCursorField(responseSchema, resolver);
    return {
      style: 'cursor',
      cursorParam: String(cursor.name),
      ...(cursorPointer ? { cursorPointer } : {}),
      ...(pageSize ? { pageSize } : {}),
    };
  }
  if (page) {
    return { style: 'page', pageParam: String(page.name), ...sizePart };
  }
  if (offset) {
    return { style: 'offset', offsetParam: String(offset.name), ...sizePart };
  }
  return undefined;
}

/** The spec's cap (bounded) when it has one, else its default. */
function sizeFor(
  param: Json,
  resolver: RefResolver,
  isV3: boolean,
): number | undefined {
  const schema = isV3 ? resolver.resolveSchema(param.schema) : param;
  const maximum = toPositiveInt(schema?.maximum);
  if (maximum) return Math.min(maximum, DISCOVERED_PAGE_SIZE);
  return toPositiveInt(schema?.default);
}

function findCursorField(
  schema: Json | undefined,
  resolver: RefResolver,
  pointer = '',
  depth = 0,
): string | undefined {
  if (!schema || !isObject(schema.properties) || depth >= CURSOR_SEARCH_DEPTH) {
    return undefined;
  }
  const entries = Object.entries(schema.properties);
  for (const wanted of CURSOR_FIELDS) {
    const match = entries.find(([name]) => name.toLowerCase() === wanted);
    if (!match) continue;
    const property = resolver.resolveSchema(match[1]);
    if (property?.type === 'string' || property?.type === 'integer') {
      return `${pointer}/${escapePointer(match[0])}`;
    }
  }
  for (const [name, raw] of entries) {
    const property = resolver.resolveSchema(raw);
    if (!property || isArraySchema(property)) continue;
    const nested = findCursorField(
      property,
      resolver,
      `${pointer}/${escapePointer(name)}`,
      depth + 1,
    );
    if (nested) return nested;
  }
  return undefined;
}

/** Path relative to the datasource base URL, or absolute when outside it. */
function relativePath(
  serverUrl: string,
  path: string,
  baseUrl: string,
): string {
  const full = `${serverUrl}/${path.replace(/^\/+/, '')}`;
  if (full === baseUrl) return '/';
  if (full.startsWith(`${baseUrl}/`)) return full.slice(baseUrl.length);
  return full;
}

function uniqueName(
  path: string,
  operation: Json,
  group: string | undefined,
  taken: Set<string>,
): string {
  const segments = path
    .split('/')
    .filter((s) => s && !s.startsWith('{'))
    .map(toIdent)
    .filter(Boolean);
  const operationId =
    typeof operation.operationId === 'string'
      ? toIdent(operation.operationId)
      : '';
  const candidates = [
    segments[segments.length - 1],
    segments.slice(-2).join('_'),
    segments.join('_'),
    operationId,
  ].filter((c): c is string => !!c);
  const scope = toIdent(group ?? '') || 'default';
  let name = candidates.find((c) => !taken.has(`${scope}.${c}`));
  if (!name) {
    const stem = candidates[0] ?? 'endpoint';
    let i = 2;
    while (taken.has(`${scope}.${stem}_${i}`)) i++;
    name = `${stem}_${i}`;
  }
  taken.add(`${scope}.${name}`);
  return name;
}

function toIdent(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
