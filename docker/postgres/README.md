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
| `retail` | `Retail` | Stores, products, customers, orders, order lines | `init/005_retail.sql` (generated) |
| `supply_chain` | `Supply Chain` | Suppliers, purchase orders, shipments, receipts, inventory | `init/006_supply_chain.sql` (generated) |
| `banking` | `Banking` | Customers, accounts, cards, transactions, loans | `init/007_banking.sql` (generated) |

The World Cup scores and knockout outcomes mirror the real tournaments;
its detailed metrics are representative sample values. The health-insurance,
genomics, HR, retail, supply-chain and banking fixtures are **entirely
synthetic** — invented members, invented providers, invented variants,
invented employees, invented shoppers, invented suppliers, invented account
holders. The genomics data must never be used for any clinical purpose.

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

The same for `retail` — a volume created before `005_retail.sql` existed never
ran it, so this is also how an existing setup gets the schema:

```bash
docker exec -i questions-to-insights-world-cup-postgres-1 \
  psql -U world_cup -d world_cup -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS retail CASCADE'
docker exec -i questions-to-insights-world-cup-postgres-1 \
  psql -U world_cup -d world_cup -v ON_ERROR_STOP=1 < docker/postgres/init/005_retail.sql
```

The container name is Compose's default for this repo — check `docker compose ps`.

Connect with `psql`:

```bash
docker compose exec postgres psql -U world_cup -d world_cup
```

Set `WORLD_CUP_DB_PORT` before starting Compose if port 55432 is already in use.

## Register it in the app

One command, instead of clicking through Datasources and Datasets once per
fixture:

```bash
cd backend && npm run fixtures:register
```

It creates the datasource **Fixtures (local Postgres)**, saves one dataset per
schema with its snapshot, and seeds the **full business-semantics document**
per fixture — every knowledge snippet and metric in
`backend/scripts/fixture-semantics.ts` (column vocabularies, default filters,
join paths, units, coverage boundaries, `net_paid`/`denial_rate`/
`paid_share_of_billed`/`allele_fraction`/`high_confidence_call_rate`), plus
each dataset's one-paragraph description. It is idempotent — run it again
after regenerating a fixture, or after editing `fixture-semantics.ts`; an
existing knowledge snippet or metric with the same title/name is updated in
place, everything else is left untouched (a fresh run prints a
created/updated/unchanged summary table).

`hr` and `retail` have no semantics document (and so no dataset description);
they get curated glossaries kept in `backend/scripts/bootstrap-fixtures.ts`
instead, seeded the same idempotent way. The HR glossary covers tech
employees, the 31 December salary row, the employees-only and active-at-date
filters, local currency, top performers and total compensation, with the
`avg_base_salary_usd`, `attrition_rate` and `total_compensation_usd` metrics.
The retail glossary covers completed orders only, order date, units, line
discount and coverage — and deliberately leaves out the fiscal calendar and
the definition of net revenue: those are what the learning demo teaches
(`npm run learning:demo`, see `docs/evals/synthetic-domains.md`), so Retail
must never get a full semantics document.

When the datasource already exists but points at a stack that is no longer
there (another `WORLD_CUP_DB_PORT`, an isolated `docker compose -p …`
project), the run repoints it at the database it just verified and
re-snapshots every dataset, as if `--force-refresh` had been passed.

Flags:

| Flag | Effect |
| --- | --- |
| `--dry-run` | Print what would change, touch nothing. |
| `--force-refresh` | Re-snapshot datasets that already exist (sample values, profiles, join hints). |
| `--reprofile` | Also recompute column profiles for each fixture dataset (`DatasetsService.reprofile`). |
| `--descriptions` | Set dataset descriptions only — skip knowledge/metric seeding. |
| `--semantics-only` | Skip datasource/dataset creation entirely — seed knowledge/metrics/descriptions (and `--reprofile`, if also given) against datasets a prior run already registered. Never touches Postgres; useful for iterating on `fixture-semantics.ts` alone. |

`--reprofile` and `--descriptions` compose with each other and with
`--semantics-only` (e.g. `npm run fixtures:register -- --reprofile
--descriptions` runs both actions together, restricted to descriptions —
this is the combination the Wave 4 runbook uses).

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

`001_world_cup.sql` is hand-written and stays that way. The other six are
produced by seeded generators in `generate/`:

```bash
cd backend
npm run fixtures:health-insurance    # rewrites init/002_health_insurance.sql
npm run fixtures:genomics            # rewrites init/003_genomics.sql
npm run fixtures:hr                  # rewrites init/004_hr.sql
npm run fixtures:retail              # rewrites init/005_retail.sql
npm run fixtures:supply-chain        # rewrites init/006_supply_chain.sql
npm run fixtures:banking             # rewrites init/007_banking.sql
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
cd backend && npm run eval:validate -- --suite retail             # likewise
cd backend && npm run eval:validate -- --suites all               # every suite at once
```

## Databricks-dialect coverage

Production targets Databricks SQL; every eval above runs on Postgres. To load
these schemas into a Databricks catalog for
`npm run eval:validate -- --dialect databricks` and Databricks-dialect suite
cases, see `docker/databricks/README.md` — a separate loader
(`backend/scripts/load-fixtures-databricks.ts`), **untested against a live
workspace**. The loader covers `world_cup`, `health_insurance`, `genomics`,
`supply_chain` and `banking`; `hr` and `retail` are Postgres-only for now.
