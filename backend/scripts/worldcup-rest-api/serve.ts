/**
 * Standalone REST API over a fixture's JSON dump, for exercising the REST
 * datasource connector against something that behaves like a real API.
 *
 *   npm run worldcup:api                     # World Cup on http://127.0.0.1:55080
 *   npm run finance:api                      # Finance on 55081
 *   npm run marketing-analytics:api          # Marketing Analytics on 55082
 *   REST_API_PROFILE=connector REST_API_PAGING=cursor REST_API_PORT=55092 \
 *     npm run worldcup:api                   # the connector cases, cursor paging
 *
 * Serves the files `worldcup-rest-api/dump.ts` (World Cup, plain JSON) or
 * `scripts/dump-fixture.ts` (the other fixtures, gzipped JSON) wrote; no
 * database needed. With no switch it answers exactly as it always did:
 *
 *   GET /api/<schema>/<relation>?page=1&per_page=100
 *       -> { "data": [...], "page": 1, "per_page": 100, "total": 47 }
 *   GET /openapi.json                   OpenAPI 3.0.3, inferred from the data
 *   GET /docs                           Swagger UI (assets from a CDN)
 *   GET /                               the endpoints, row counts and switches
 *
 * The switches (paging style, page size, a nested endpoint, rows under another
 * key, a refused endpoint, a bearer token) are in `rest-fixture.ts` and
 * specs/system/delivery.md. Zero dependencies beyond `node:http`; permissive
 * CORS: this is a local test tool, not a service.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import {
  buildIndex,
  buildOpenApi,
  checkEndpointNames,
  handleApiRequest,
  loadRelations,
  readServerOptions,
  ServerOptionsError,
  servedRelations,
} from './rest-fixture';

const HOST = '127.0.0.1';

const DOCS_HTML = (title: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
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

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  contentType = 'application/json; charset=utf-8',
): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    ...headers,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function main(): void {
  let options: ReturnType<typeof readServerOptions>;
  let relations: ReturnType<typeof servedRelations>;
  try {
    options = readServerOptions(process.env, process.argv.slice(2));
    relations = servedRelations(
      options,
      loadRelations(options.fixture.dataDir),
    );
    checkEndpointNames(options, relations);
  } catch (error) {
    console.error(
      error instanceof ServerOptionsError || error instanceof Error
        ? error.message
        : error,
    );
    process.exit(1);
  }
  const openApi = buildOpenApi(options, relations);
  const index = buildIndex(options, relations);
  const prefix = `/api/${options.fixture.schema}/`;

  const route = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? `${HOST}:${options.port}`}`,
    );
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, { error: `Method ${req.method} not allowed.` });
    }
    if (path === '/') return send(res, 200, index);
    if (path === '/openapi.json') return send(res, 200, openApi);
    if (path === '/docs') {
      return send(
        res,
        200,
        DOCS_HTML(options.fixture.title),
        {},
        'text/html; charset=utf-8',
      );
    }
    if (path.startsWith(prefix)) {
      const answer = handleApiRequest(
        options,
        relations,
        url,
        req.headers.authorization,
      );
      return send(res, answer.status, answer.body, answer.headers);
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
        ? `Port ${options.port} is already in use. Set REST_API_PORT to another port.`
        : error.message,
    );
    process.exit(1);
  });
  server.listen(options.port, HOST, () => {
    const switches = index.switches as Record<string, unknown>;
    console.log(
      `${options.fixture.title} on http://${HOST}:${options.port} ` +
        `(${relations.size} endpoints, docs at /docs)\n` +
        `  switches: ${JSON.stringify(switches)}`,
    );
  });
}

main();
