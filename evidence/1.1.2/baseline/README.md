# Baseline on main (BA-127, plan 3.0 action 3), 2026-10-13

- **Code:** the epic branch at `5f3a4e2`, identical to `main` at `f3ef18e` in code (only documents differ), built with `npm --prefix backend run build:all` and run as `node backend/dist/cli.js --no-open --port 3141 --data-dir <scratch>` (empty data dir), signed in as Demo User.
- **Model:** nothing saved in LLM Settings, so the app's fallback `openai/gpt-4o-mini`, with `OPENAI_API_KEY` from the main checkout's `.env`. Judge on, as `main` always runs it.
- **Data:** World Cup sample seeded through `POST /testing-data/world-cup/load` into its own database `world_cup_ba9_baseline` on the shared PostgreSQL (port 55432); the local World Cup REST API (`npm run worldcup:api`, port 55080) registered with `npm run worldcup:rest:setup` plus a bearer token added from outside the repository, because the script gets HTTP 401 on `main` since BA-161.
- **Runs:** `POST /agents/assistant/evals/run` with the set's case ids, one at a time, polled until finished; reports from `GET /agents/assistant/evals/runs/:jobId/download`.

| File | Set | Datasource | Passed |
|---|---|---|---|
| `world-cup-postgres-run1.{md,json}` | World Cup | World Cup PostgreSQL | 1/10 |
| `world-cup-postgres-run2.{md,json}` | World Cup | World Cup PostgreSQL | 0/10 |
| `world-cup-postgres-run3.{md,json}` | World Cup | World Cup PostgreSQL | 0/10 |
| `world-cup-rest-run1.{md,json}` | World Cup (REST API) | World Cup REST API | 0/10 |
| `world-cup-rest-run2.{md,json}` | World Cup (REST API) | World Cup REST API | 0/10 |
| `world-cup-rest-run3.{md,json}` | World Cup (REST API) | World Cup REST API | 0/10 |

The summary and what the numbers say are in `docs/research/BA-9.md`, section "Baseline on main".
