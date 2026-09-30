# Eval fixtures (local PostgreSQL)

One Docker Postgres holds every fixture the eval harnesses run against, each in
its own schema. Fixtures exist so the engine can be measured repeatably without
touching customer data — and so a trap can be *planted* on purpose and then
asked about.

| Schema | Dataset name in the app | Domain | Rows from |
| --- | --- | --- | --- |
| `world_cup` | `World Cup` | FIFA World Cup 2018 + 2022 | `init/001_world_cup.sql` (hand-written) |
| `health_insurance` | `Health Insurance` | Claims, members, providers, denials | `init/002_health_insurance.sql` (generated) |
| `genomics` | `Genomics` | Variant calls, samples, gene expression | `init/003_genomics.sql` (generated) |
| `hr` | `HR` | Employees, salary history, bonuses, reviews, org chart | `init/004_hr.sql` (generated) |

The World Cup scores and knockout outcomes mirror the real tournaments;
its detailed metrics are representative sample values. The health-insurance,
genomics and HR fixtures are **entirely synthetic** — invented members, invented
providers, invented variants, invented employees. The genomics data must never
be used for any clinical purpose.

See `docs/evals/synthetic-domains.md` for the schema sketches and the trap
catalogue each fixture was built around.

## Start it

From the repository root:

```bash
docker compose up -d postgres
docker compose ps
```

Every file in `init/` is loaded **on first start only**. After changing or
regenerating one, rebuild the volume:

```bash
docker compose down -v
docker compose up -d postgres
```

Or, to keep the other schemas and reload just one into the running container
(here `hr`; each init script creates its own schema inside one transaction):

```bash
docker exec -i questions-to-insights-world-cup-postgres-1 \
  psql -U world_cup -d world_cup -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS hr CASCADE'
docker exec -i questions-to-insights-world-cup-postgres-1 \
  psql -U world_cup -d world_cup -v ON_ERROR_STOP=1 < docker/postgres/init/004_hr.sql
```

The container name is Compose's default for this repo — check `docker compose ps`.

Connect with `psql`:

```bash
docker compose exec postgres psql -U world_cup -d world_cup
```

Set `WORLD_CUP_DB_PORT` before starting Compose if port 55432 is already in use.

## Register it in the app

One command, instead of clicking through Datasources and Datasets three times:

```bash
cd backend && npm run fixtures:register
```

It creates the datasource **Fixtures (local Postgres)**, saves one dataset per
schema with its snapshot, and seeds the knowledge terms and metrics the traps
depend on (net paid, allele fraction, the test-claim and control-sample default
filters, and the HR glossary: tech employees, the 31 December salary row, the
employees-only and active-at-date filters, attrition and total compensation).
It is idempotent — run it again after regenerating a fixture, or with
`--force-refresh` to re-snapshot.

To do it by hand instead, configure a PostgreSQL datasource with:

| Field | Value |
| --- | --- |
| Host | `localhost` |
| Port | `55432` |
| Database | `world_cup` |
| User | `world_cup` |
| Password | `world_cup_dev` |
| SSL | Off |

## Regenerating a fixture

`001_world_cup.sql` is hand-written and stays that way. The others are
produced by seeded generators in `generate/`:

```bash
cd backend
npm run fixtures:health-insurance    # rewrites init/002_health_insurance.sql
npm run fixtures:genomics            # rewrites init/003_genomics.sql
npm run fixtures:hr                  # rewrites init/004_hr.sql
```

Each generator draws every value from a single seeded `Rng`
(`generate/lib/rng.ts`), so the same seed always produces byte-identical SQL.
That is load-bearing: every `expectedSql` in `backend/eval/` was verified by
hand against these exact rows, and a generator that reached for `Math.random()`
would silently turn all of them into guesses. Each generator also asserts its
own planted invariants (the deliberate ties, the null rates, the constant
columns) and throws rather than emitting a fixture whose traps have drifted.

Change the data and you must re-verify the eval sets:

```bash
cd backend && npm run eval:validate -- --suite health-insurance   # zero model calls
cd backend && npm run eval:validate -- --suite hr                 # likewise
```
