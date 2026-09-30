/**
 * Standalone REST API over the World Cup fixture snapshot, for exercising the
 * REST datasource connector against something that behaves like a real API.
 *
 *   npm run worldcup:api                # http://127.0.0.1:55080
 *   WORLD_CUP_API_PORT=8080 npm run worldcup:api
 *
 * Serves the JSON files that `dump.ts` wrote to `data/`; no database needed.
 *
 *   GET /api/world_cup/<relation>?page=1&per_page=100
 *       -> { "data": [...], "page": 1, "per_page": 100, "total": 47 }
 *   GET /openapi.json                   OpenAPI 3.0.3, inferred from the data
 *   GET /docs                           Swagger UI (assets from a CDN)
 *   GET /                               endpoint index
 *
 * Deliberately zero dependencies beyond `node:http`. No auth, permissive CORS:
 * this is a local test tool, not a service.
 */
import { readdirSync, readFileSync } from 'fs';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { join } from 'path';

const HOST = '127.0.0.1';
const PORT = Number(process.env.WORLD_CUP_API_PORT) || 55080;
const DATA_DIR = join(__dirname, 'data');
const API_PREFIX = '/api/world_cup';
const DEFAULT_PER_PAGE = 100;
const MAX_PER_PAGE = 500;
const API_VERSION = '1.0.0';

type Row = Record<string, unknown>;

/** Every `data/<name>.json` except `_meta.json`, keyed by relation name. */
function loadData(): Map<string, Row[]> {
  const relations = new Map<string, Row[]>();
  const files = readdirSync(DATA_DIR)
    .filter((file) => file.endsWith('.json') && !file.startsWith('_'))
    .sort();
  for (const file of files) {
    const rows = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
    if (!Array.isArray(rows)) {
      throw new Error(`${file} must contain a JSON array of rows.`);
    }
    relations.set(file.replace(/\.json$/, ''), rows as Row[]);
  }
  if (relations.size === 0) {
    throw new Error(
      `No data in ${DATA_DIR}. Run \`npm run worldcup:api:dump\` first.`,
    );
  }
  return relations;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** OpenAPI 3.0 schema for one column, inferred from every row of the relation. */
function inferColumn(values: unknown[]): Row {
  const present = values.filter(
    (value) => value !== null && value !== undefined,
  );
  const nullable = present.length < values.length;
  const sample = present[0];
  let schema: Row;
  if (typeof sample === 'number') {
    schema = { type: 'number' };
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

function rowSchema(rows: Row[]): Row {
  const columns = new Set<string>();
  for (const row of rows) Object.keys(row).forEach((key) => columns.add(key));
  const properties: Record<string, Row> = {};
  for (const column of columns) {
    properties[column] = inferColumn(rows.map((row) => row[column]));
  }
  return { type: 'object', properties };
}

function buildOpenApi(relations: Map<string, Row[]>): Row {
  const schemas: Record<string, Row> = {};
  const paths: Record<string, Row> = {};
  for (const [name, rows] of relations) {
    schemas[name] = rowSchema(rows);
    schemas[`${name}_page`] = {
      type: 'object',
      required: ['data', 'page', 'per_page', 'total'],
      properties: {
        data: {
          type: 'array',
          items: { $ref: `#/components/schemas/${name}` },
        },
        page: { type: 'integer', minimum: 1 },
        per_page: { type: 'integer', minimum: 1, maximum: MAX_PER_PAGE },
        total: { type: 'integer', minimum: 0 },
      },
    };
    paths[`${API_PREFIX}/${name}`] = {
      get: {
        operationId: `list_${name}`,
        summary: `List ${name} (${rows.length} rows)`,
        tags: ['world_cup'],
        parameters: [
          {
            name: 'page',
            in: 'query',
            description: '1-based page number.',
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
          {
            name: 'per_page',
            in: 'query',
            description: `Rows per page (max ${MAX_PER_PAGE}).`,
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: MAX_PER_PAGE,
              default: DEFAULT_PER_PAGE,
            },
          },
        ],
        responses: {
          '200': {
            description: `A page of ${name} rows.`,
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${name}_page` },
              },
            },
          },
        },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'World Cup Test API',
      version: API_VERSION,
      description:
        'Read-only REST mirror of the World Cup Postgres fixture (schema `world_cup`): ' +
        'the same tables and views, served as paginated JSON for testing REST datasources.',
    },
    servers: [{ url: '/' }],
    paths,
    components: { schemas },
  };
}

const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>World Cup Test API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });
    </script>
  </body>
</html>
`;

/** Lenient on purpose: junk input falls back to the default instead of a 400. */
function positiveInt(raw: string | null, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  contentType = 'application/json; charset=utf-8',
): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function main(): void {
  const relations = loadData();
  const openApi = buildOpenApi(relations);

  const route = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, { error: `Method ${req.method} not allowed.` });
    }

    if (path === '/') {
      return send(res, 200, {
        name: 'World Cup Test API',
        docs: '/docs',
        openapi: '/openapi.json',
        endpoints: [...relations.keys()].map((name) => `${API_PREFIX}/${name}`),
      });
    }
    if (path === '/openapi.json') return send(res, 200, openApi);
    if (path === '/docs') {
      return send(res, 200, DOCS_HTML, 'text/html; charset=utf-8');
    }

    if (path.startsWith(`${API_PREFIX}/`)) {
      const name = decodeURIComponent(path.slice(API_PREFIX.length + 1));
      const rows = relations.get(name);
      if (!rows) {
        return send(res, 404, { error: `Unknown table "${name}".` });
      }
      const page = positiveInt(url.searchParams.get('page'), 1);
      const perPage = Math.min(
        positiveInt(url.searchParams.get('per_page'), DEFAULT_PER_PAGE),
        MAX_PER_PAGE,
      );
      const start = (page - 1) * perPage;
      return send(res, 200, {
        data: rows.slice(start, start + perPage),
        page,
        per_page: perPage,
        total: rows.length,
      });
    }

    return send(res, 404, { error: `No route for ${req.method} ${path}.` });
  };

  const server = createServer((req, res) => {
    const started = Date.now();
    res.on('finish', () => {
      const path = (req.url ?? '/').split('?')[0];
      console.log(
        `${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`,
      );
    });
    try {
      route(req, res);
    } catch (error) {
      send(res, 500, {
        error: error instanceof Error ? error.message : 'Internal error.',
      });
    }
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${PORT} is already in use. Set WORLD_CUP_API_PORT to another port.`
        : error.message,
    );
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(
      `World Cup Test API on http://${HOST}:${PORT} (${relations.size} tables, docs at /docs)`,
    );
  });
}

main();
