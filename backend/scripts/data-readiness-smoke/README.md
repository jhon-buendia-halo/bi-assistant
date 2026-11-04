# Data readiness live smoke (BA-259)

Runs the whole data readiness path (Postgres profiler, adapter, engine, store,
API 2.17) against a real PostgreSQL, and compares the reports with scores
computed by hand from the spec formulas (data-readiness R12 to R22).

## Run

```bash
cd backend && npm run build
PG_PORT=55471 APP_PORT=3311 scripts/data-readiness-smoke/run.sh
```

- `run.sh` makes one temp dir, installs `embedded-postgres` and `pg` there (not
  in `package.json`), starts Postgres on `PG_PORT`, loads `seed.sql`, starts
  `node dist/cli.js --no-open` on `APP_PORT` with `INTELLIFY_API_PORT=0`, runs
  `smoke.mjs`, then stops both by PID and deletes the temp dir.
- Pick ports that are free; it refuses busy ones. Avoid 55432, 3000, 3100 and
  4200 (the compose Postgres, the default app, the Intellify API and `ng serve`).
- Set `OUT_DIR=<dir>` to keep the three reports as `reports.json` (evidence).
- Exit code 0 means every check passed.

## Files

| File | Role |
|---|---|
| `seed.sql` | Schema `smoke` in database `smokedb`, with one known defect per check, and the limited role `smoke_reader` the datasource connects as. |
| `start-postgres.cjs` | Starts embedded Postgres, creates `smokedb`, loads the seed, stops on SIGTERM. |
| `smoke.mjs` | Creates the datasource, calls the API and checks each answer. No dependencies. |
| `run.sh` | Ties the three together. |

## What it checks

| Call | Expected |
|---|---|
| `POST` whole datasource | 5 entities (`audit_log`, `customers`, `events`, `orders`, `secrets`), 17 findings, overall 74, Defined |
| `POST` `smokedb.smoke.orders` | 1 entity, overall 86, Managed |
| `POST` `customers`, `events` and a missing table | 2 entities (the missing key is dropped), overall 76, Defined |
| `POST` only a missing table | 400 `None of the entities to assess exist` |
| `POST` with no `datasourceId` | 400 `datasourceId is required` |
| `POST` an unknown datasource | 404 `Datasource "nope" not found` |
| `POST` a `rest` datasource | 400 `Data readiness supports PostgreSQL and Databricks datasources only` |
| `GET` list | the three reports, newest first, summary fields only; 400 without `datasourceId`; `{ reports: [] }` for an unknown one |
| `GET` by id | the stored report, unchanged; 404 for an unknown id |

Whole-datasource scores, as `score (checks, findings, worst)`:

| Dimension | Expected | Why |
|---|---|---|
| Completeness | 63 (6, 4, high) | `nickname` 60 % null (high), `region` 20 % (medium), `events.event_id` and `events.customer_id` 1 of 6 (medium); `email` and `orders.customer_id` nullable with no nulls |
| Validity | 60 (1, 1, medium) | 3 bad `email` values |
| Consistency | 97 (3, 1, low) | `segment` has 5 distinct values, 2 after lower/trim |
| Uniqueness | 87 (6, 2, medium) | 4 primary keys clean (secrets unmeasured); `events` has no key, so `event_id` (2 duplicates) and `customer_id` (1) are inferred |
| Integrity | 30 (2, 2, high) | declared FK `orders.customer_id` (added `NOT VALID`) with orphan 999 (high); inferred `events.customer_id` → `customers.id` with orphan 777 (medium) |
| Accessibility | 92 (5, 1, medium) | `audit_log` (INSERT grant only) and `secrets` (no grant) are not readable; one finding for the namespace |
| Timeliness | 73 (3, 2, medium) | `customers.created_at` newest 2020; `events.event_year` newest 2019 (year fallback); `orders` is fresh |
| Reasonability | 92 (13, 4, medium) | negative `amount`, `discount_pct` 150, future `ordered_at`, `created_at` in 1899 |

`smoke.secrets` has no grant at all. The profiler lists relations from
`pg_class`, as the inventory does, so it is still assessed: accessibility flags
it, and its declared key and numeric `id` add one uniqueness and one
reasonability check (unmeasured, so passing).
