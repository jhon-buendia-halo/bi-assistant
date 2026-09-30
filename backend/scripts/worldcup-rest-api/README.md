# World Cup test REST API

A read-only REST mirror of the World Cup Postgres fixture (schema `world_cup`),
for testing the REST datasource connector against a real-looking API. It serves
a JSON snapshot of the fixture, so it needs no database at runtime.

Served relations (12 tables + 2 views): `confederations`, `countries`, `teams`,
`tournaments`, `tournament_teams`, `venues`, `players`, `squad_members`,
`matches`, `match_team_statistics`, `goals`, `disciplinary_events`,
`v_match_results`, `v_player_goal_totals`.

## Serve

```bash
cd backend
npm run worldcup:api            # http://127.0.0.1:55080
```

`WORLD_CUP_API_PORT` overrides the port. Swagger UI is at `/docs` (loaded from
the unpkg CDN), the OpenAPI 3.0.3 document at `/openapi.json`, and `/` lists
the endpoints.

## Regenerate the data

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
`data/_meta.json` records when and from where the snapshot was taken, with row
counts.

## Endpoint contract

```
GET /api/world_cup/<relation>?page=1&per_page=100
```

| Param      | Default | Notes                            |
| ---------- | ------- | -------------------------------- |
| `page`     | `1`     | 1-based                          |
| `per_page` | `100`   | capped at `500`                  |

Response:

```json
{ "data": [ { "...": "row" } ], "page": 1, "per_page": 100, "total": 47 }
```

- Rows live under `/data`; `total` is the row count of the whole relation.
- A page past the end returns `data: []`.
- Invalid `page` / `per_page` values fall back to their defaults.
- An unknown relation returns `404` with `{ "error": "..." }`.
- No auth; CORS is open (`Access-Control-Allow-Origin: *`).

## Datasource settings in the app

| Setting          | Value                                   |
| ---------------- | --------------------------------------- |
| Base URL         | `http://127.0.0.1:55080`                |
| Endpoint path    | `/api/world_cup/<table>` (e.g. `/api/world_cup/matches`) |
| Rows pointer     | `/data`                                 |
| Pagination style | `page`                                  |
| Page param       | `page`                                  |
| Size param       | `per_page`                              |
| Auth             | none                                    |
