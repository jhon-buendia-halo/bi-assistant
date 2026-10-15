---
name: intellify-api
description: Run and call the Intellify RFP API (the REST service the RFP Builder agent uses) — get it from 503 to 200, find its X-API-Key, load its database, register it in the app, and call its endpoints with curl. Use when asked to start, test, call or debug the Intellify API / Intellify REST API, when it answers `503 database_unavailable` or `401 API key required`, or when the "Intellify RFP API" Testing Data card says it cannot reach its database.
---

# Intellify RFP API — runbook

The contract (routes, shapes, errors, pagination) is in [specs/system/api.md](../../../specs/system/api.md) §2.16; env vars in §6.1; the `rfp` schema in [data-model.md](../../../specs/system/data-model.md) §7; why it exists in ADR-0027/0028 ([architecture.md](../../../specs/system/architecture.md)). Read those for *what* it answers. This file is *how to get it answering*.

## What it is, in one paragraph

A second NestJS app in `backend/src/intellify-api/`. The normal app (`node backend/dist/cli.js`) starts it **embedded**, in the same process, on its own port (default `3100`, CLI `--intellify-api-port <n>`, `0` = free port; the banner prints `Intellify API: http://127.0.0.1:<port>`). It reads schema `intellify` and writes schema `rfp` in the PostgreSQL database `intellify_mercer_demo` on `127.0.0.1:55432` (user `world_cup` / `world_cup_dev`). Every route except `GET /health` and `GET /openapi.json` needs the header `X-API-Key`. Not a bearer token.

## Bring-up, in order

Each step depends on the previous one. Skipping one gives the symptom in the right column.

| # | Step | Command / action | Symptom if skipped |
|---|---|---|---|
| 1 | Postgres on **55432** is this repo's compose DB | `ss -ltnp \| grep 55432`; if nothing, ask the user, then `docker compose up -d --wait postgres` from the repo root (project name `questions-to-insights-world-cup` is fixed in `docker-compose.yml`, so it reuses the shared volume) | `/health` → `database:"down"` |
| 2 | Database **`intellify_mercer_demo`** exists and is seeded | Load the `intellify` Testing Data fixture **into that database name** (see below). The fixture's own default is `intellify`, the API's default is `intellify_mercer_demo`; they differ on purpose (data-model.md §7) | Same `database:"down"` and `503` even though Postgres is up |
| 3 | App (re)started **after** step 2 | Stop and start the CLI. The `rfp` migrations run **once at API start** and are not retried | Log `rfp migrations not applied: database unavailable`; `/health` → `rfpSchemaVersion:null`; RFP routes fail |
| 4 | API registered as a datasource in the app (only for the RFP Builder agent / app UI; curl doesn't need it) | `POST /testing-data/intellify-api/load` with `{}` | RFP Builder has no datasource; card shows `0/10 entities` |

Healthy looks like: `curl -s http://127.0.0.1:<port>/health` → `{"ok":true,...,"database":"up","schema":"intellify","rfpSchemaVersion":1}`.

### Step 2 — load the data through the app (no psql needed)

The app's Testing Data endpoint creates the database if missing and seeds it. It is what Settings → Testing Data → **Intellify** → Database = `intellify_mercer_demo` → **Load** does:

```bash
curl -s -m 200 -X POST http://127.0.0.1:<app-port>/testing-data/intellify/load \
  -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1","port":55432,"database":"intellify_mercer_demo","user":"world_cup","password":"world_cup_dev","ssl":false}'
# → {"ok":true,"message":"Seeded intellify on 127.0.0.1:55432 and loaded 49 entities into dataset \"Intellify\" — created the database",...}
```

Users commonly click **Register testing data** on the *Intellify RFP API* card first. That only registers the API and fails with `The Intellify API cannot reach its database at 127.0.0.1:55432/intellify_mercer_demo` until this step is done. The fixture to load is the other card, **Intellify** (PostgreSQL, 49 entities).

Alternative to loading into `intellify_mercer_demo`: start the app with `INTELLIFY_DB_NAME=intellify` and load the fixture into its default database.

## The API key

- Embedded and `INTELLIFY_API_KEY` unset: the key is the file **`<data-dir>/.intellify-api-key`** (64 hex chars, created on first start, stable for that data dir). `cat` it.
- `INTELLIFY_API_KEY` set: that value (comma-separated = several accepted keys).
- Standalone (`npm --prefix backend run intellify-api`, after `build`): `INTELLIFY_API_KEY` is **required**; it is configured only from env vars (api.md §6.1).

## Calling it

```bash
K=$(cat <data-dir>/.intellify-api-key); B=http://127.0.0.1:<port>
curl -s $B/health                                    # public
curl -s $B/openapi.json                              # public, OpenAPI 3.0
curl -s -H "X-API-Key: $K" "$B/v1/clients?per_page=5"
curl -s -H "X-API-Key: $K" "$B/v1/clients/<oneCode>/renewals"
curl -s -H "X-API-Key: $K" "$B/v1/rfps"
```

Collections are paged: `page` (1-based), `per_page` (default 100, max 500), response `{ data, page, per_page, total }`. Per-client routes take the client's `oneCode` (get one from `/v1/clients`). RFP writes (`POST /v1/rfps`, `PUT /v1/rfps/:id/...`) and the package (`/v1/rfps/:id/package.zip`, `document.md|pdf`, `exhibits`) are in api.md §2.16.4–2.16.5.

## Status codes → cause

| Answer | Cause | Fix |
|---|---|---|
| `401 API key required` | header missing / wrong key / key from another data dir | re-read `.intellify-api-key` of the data dir the running app uses |
| `503 database_unavailable` | Postgres down, wrong port, or `intellify_mercer_demo` missing | steps 1–2, then step 3 |
| `/health` ok but `rfpSchemaVersion:null` | DB appeared after the app started | step 3 (restart) |
| connection refused on the port | API not started: `--no-intellify-api` / `INTELLIFY_API=off`, port busy (log: `Intellify API not started: <reason>`) | free the port or pass another `--intellify-api-port` |

## Pitfalls seen in practice

- **Another project's Postgres is not this one.** A container such as `agent-poc-pg-test` on 56543 (user `poc`, db `shop`) is unrelated. Check the *port* (55432) and that `world_cup` exists, not just "a Postgres is up".
- **Listing databases without `docker exec`** (which may be refused as touching shared resources): use the backend's `pg` package, read-only:
  ```bash
  cd backend && node -e "const {Client}=require('pg');const c=new Client({host:'127.0.0.1',port:55432,user:'world_cup',password:'world_cup_dev',database:'world_cup'});c.connect().then(()=>c.query('select datname from pg_database where not datistemplate')).then(r=>{console.log(r.rows.map(x=>x.datname).join(', '));return c.end()})"
  ```
- **Running from a worktree:** follow CLAUDE.md's *Worktree deploy convention* — ask shared vs isolated, use an isolated `--data-dir` and free ports (e.g. `--port 3400 --intellify-api-port 3420`), never port 3000. Stop the app by its PID or background task, never `pkill -f`. A fresh data dir has no LLM provider: the RFP Builder needs one set in Settings before it can chat; the API itself does not.
- **Restarting** = stop the CLI process and start it again with the *same* `--data-dir` (so the key stays the same).
