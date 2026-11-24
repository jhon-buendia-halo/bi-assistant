# Fixture test REST API

A read-only REST mirror of a sample fixture, for testing the REST datasource
connector against a real-looking API. It serves a JSON dump of the fixture, so
it needs no database at runtime:

| Fixture | Dump | Default port | Endpoints |
| --- | --- | --- | --- |
| `world-cup` | `data/*.json` (this folder, `dump.ts`) | 55080 | `/api/world_cup/<relation>`, 12 tables + 2 views |
| `finance` | `../fixtures/finance/data/*.json.gz` (`dump-fixture.ts`) | 55081 | `/api/finance/<relation>`, 15 tables + 2 views |
| `marketing-analytics` | `../fixtures/marketing-analytics/data/*.json.gz` | 55082 | `/api/marketing_analytics/<relation>`, 14 tables |

## Serve

```bash
cd backend
npm run worldcup:api                 # http://127.0.0.1:55080, as it always was
npm run finance:api                  # http://127.0.0.1:55081
npm run marketing-analytics:api      # http://127.0.0.1:55082
```

Swagger UI is at `/docs` (loaded from the unpkg CDN), the OpenAPI 3.0.3
document at `/openapi.json`, and `/` lists the endpoints, their row counts and
the server's switches.

## Switches: make it behave like a real API

One process serves one fixture under one set of switches (a variant), each an
environment variable or a flag: paging style (`page`, `offset`, `cursor`,
`next-url`), page size, a nested endpoint, rows under `result.items`, refused
endpoints (503, optionally with `Retry-After`) and a required bearer token.
The `connector` profile turns on what the REST-only eval set needs:

```bash
REST_API_PROFILE=connector REST_API_PAGING=cursor REST_API_PORT=55092 npm run worldcup:api
```

The full list, the eval variants and the setup script's flags are in
[specs/system/delivery.md](../../../specs/system/delivery.md), section 2,
*The fixture REST API*. The logic is `rest-fixture.ts`, tested by
`rest-fixture.spec.ts`.

## Register it in the app

With the backend running (it signs in by itself in local mode):

```bash
npm run worldcup:rest:setup                                   # World Cup on 55080
npm run fixture:rest:setup -- --api-url http://127.0.0.1:55092 --variant cursor
npm run finance:rest:setup
```

The endpoints come from the app's OpenAPI discovery, as the Discover button
would propose them.

## Regenerate the World Cup data

`data/*.json` is checked in. Re-dump only when the fixture changes:

```bash
docker compose up -d            # fixture Postgres on 127.0.0.1:55432
cd backend
npm run worldcup:api:dump
```

Connection defaults match `docker-compose.yml`; override with
`WORLD_CUP_DB_HOST`, `WORLD_CUP_DB_PORT`, `WORLD_CUP_DB_DATABASE`,
`WORLD_CUP_DB_USER`, `WORLD_CUP_DB_PASSWORD`. NUMERIC, BIGINT and FLOAT columns
are written as JSON numbers, dates as `YYYY-MM-DD`, timestamps as ISO 8601 UTC.
The finance and marketing analytics dumps come from `npm run fixture:dump`.

## Endpoint contract with no switch

```
GET /api/<schema>/<relation>?page=1&per_page=100
```

| Param      | Default | Notes          |
| ---------- | ------- | -------------- |
| `page`     | `1`     | 1-based        |
| `per_page` | `100`   | capped at `500` |

```json
{ "data": [ { "...": "row" } ], "page": 1, "per_page": 100, "total": 47 }
```

- A page past the end returns `data: []`.
- Invalid `page` / `per_page` values fall back to their defaults.
- An unknown relation returns `404` with `{ "error": "..." }`.
- No auth; CORS is open (`Access-Control-Allow-Origin: *`).
