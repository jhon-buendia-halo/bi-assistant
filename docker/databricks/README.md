# Eval fixtures on Databricks

Production targets Databricks SQL; every eval documented in
`docker/postgres/README.md` runs on Postgres. This loader copies the same
three fixture schemas (`world_cup`, `health_insurance`, `genomics` — see
`docs/evals/synthetic-domains.md`) into a Databricks catalog, so
Databricks-dialect suite cases and `npm run eval:validate -- --dialect
databricks` have something real to run against.

> [!WARNING]
> **UNTESTED against a live Databricks workspace.** No workspace or token was
> available while this loader was written — it is unit-tested
> (`backend/src/mastra/evals/databricks-fixture-loader.spec.ts` covers type
> mapping, DDL/literal emission and view translation with real fixture data)
> and its `--dry-run` path was run against the live Postgres fixture, but the
> `DBSQLClient` connection, the `CREATE TABLE`/`INSERT` execution and
> `--register` have never touched an actual workspace. **Run with `--dry-run`
> first**, read the printed DDL, and treat the first real run as a trial.

## What it does

`backend/scripts/load-fixtures-databricks.ts`:

1. Reads each schema's tables and column types from the running Postgres
   fixture (`information_schema.columns`), mapping types to Databricks SQL:

   | Postgres | Databricks |
   | --- | --- |
   | `smallint`, `integer` | `INT` |
   | `bigint` | `BIGINT` |
   | `numeric(p,s)` | `DECIMAL(p,s)` (bare `numeric` → `DECIMAL(38,6)`) |
   | `real`, `double precision` | `DOUBLE` |
   | `text`, `varchar`, `char`, `uuid` | `STRING` |
   | `boolean` | `BOOLEAN` |
   | `date` | `DATE` |
   | `timestamp[tz]` | `TIMESTAMP` |
   | arrays, `json`/`jsonb` | `STRING` |

2. Emits `CREATE SCHEMA IF NOT EXISTS <catalog>.<schema>` and
   `CREATE OR REPLACE TABLE` DDL per table, and — only with `--yes` and not
   `--dry-run` — connects with `@databricks/sql`'s `DBSQLClient` **directly**
   (not the app's own `DatabricksConnector`, which is read-only by design and
   rejects DDL — `assertReadOnlySql` in
   `backend/src/modules/datasources/connectors/connector.ts`) and runs the
   DDL, then batch-inserts every row (multi-row `INSERT INTO ... VALUES`, at
   most 500 rows per statement, proper literal escaping — strings, `NULL`,
   `DATE'...'`/`TIMESTAMP'...'`).
3. Translates each schema's views (`v_*`) best-effort for Databricks SQL —
   `::type` casts → `CAST(... AS TYPE)`, `FILTER (WHERE p)` → `CASE WHEN p
   THEN ... END` (Databricks SQL has no `FILTER` clause), double-quoted
   reserved-word identifiers → backticks, `ILIKE` left as-is (Databricks SQL
   supports it), date/time arithmetic **flagged**, never auto-translated —
   and **writes** them to `docker/databricks/views-<schema>.sql` for manual
   review. This script never applies a view; you do, after reading the file.
4. Schema names are kept identical to Postgres (`world_cup`,
   `health_insurance`, `genomics`, under whatever `--catalog` you choose) —
   the suites' `requiredEntities` match on an entity's *last two* segments,
   so no schema renaming or prefixing is needed for the suites to find them.

## Usage

```bash
cd backend

# 1. Preview: prints DDL + row counts read from the live Postgres fixture.
#    Never connects to Databricks, never writes a file.
npx ts-node -T -P tsconfig.json scripts/load-fixtures-databricks.ts \
  --dry-run --catalog eval_fixtures \
  --host https://<workspace>.cloud.databricks.com --warehouse <warehouse-id>

# 2. Load for real, once the preview looks right.
DATABRICKS_TOKEN=<personal access token> \
  npx ts-node -T -P tsconfig.json scripts/load-fixtures-databricks.ts \
  --catalog eval_fixtures \
  --host https://<workspace>.cloud.databricks.com --warehouse <warehouse-id> \
  --yes
```

(Once `fixtures:databricks` lands in `backend/package.json`, the equivalent
is `DATABRICKS_TOKEN=... npm run fixtures:databricks -- --catalog
eval_fixtures --host https://<workspace> --warehouse <id> --yes`.)

Flags:

| Flag | Effect |
| --- | --- |
| `--host` | Workspace URL (required; `https://` prefix is stripped). |
| `--warehouse` | SQL warehouse id (required). |
| `--catalog` | Target Unity Catalog catalog (required) — created schemas/tables land under `<catalog>.world_cup`, `<catalog>.health_insurance`, `<catalog>.genomics`. |
| `--schemas` | Comma-separated subset, default all three (`world_cup,health_insurance,genomics`). |
| `--dry-run` | Print DDL + row counts from Postgres only — no Databricks connection, no file writes. Needs no `DATABRICKS_TOKEN`. |
| `--yes` | Required (with no `--dry-run`) to write `docker/databricks/views-*.sql` and to connect to Databricks and load data. Without it the script refuses to write or connect, and just previews. |
| `--register` | After loading, register a Databricks datasource + one dataset per schema in the app's own datastore, through `DatasourcesService`/`DatasetsService` (the same code path `bootstrap-fixtures.ts` uses for Postgres). Without it, prints the manual registration steps instead. |

Env: `DATABRICKS_TOKEN` (personal access token — required unless
`--dry-run`), `WORLD_CUP_DB_PORT` (the source Postgres, default `55432`).

## Review and apply the views

The loader never runs a `CREATE VIEW`. After a real (non-`--dry-run`,
`--yes`) run, read the generated files:

```
docker/databricks/views-world_cup.sql
docker/databricks/views-health_insurance.sql
docker/databricks/views-genomics.sql
```

Each translated view is preceded by `-- FLAG: ...` comments for anything the
translator could not confidently handle (an untranslatable `FILTER`, `ILIKE`,
date/time arithmetic) — read those first. Once a file looks right, run it
yourself against the warehouse (e.g. via the Databricks SQL editor, or `psql`-
style through your own `DBSQLClient`/CLI of choice); this script does not do
it for you on purpose, so a bad translation never silently lands.

## Register it in the app

Either pass `--register` on the load run (above), or do it by hand:

1. Settings → Data sources → Add → Databricks. Workspace URL, SQL warehouse
   id, and a personal access token (the same three values used to load).
   Test the connection, then save (e.g. as "Fixtures (Databricks)").
2. Datasets → New dataset → select every table under
   `<catalog>.<schema>` → save as `<Name> (Databricks)` (`World Cup
   (Databricks)`, `Health Insurance (Databricks)`, `Genomics (Databricks)`) —
   one per schema you loaded.

## Validate before spending a model call

```bash
cd backend && npm run eval:validate -- --suite world-cup --dialect databricks
```

`eval:validate` runs every case's reference SQL — `expectedSqlByDialect.databricks`
where a case has one, `expectedSql` otherwise — against the Databricks
datasource and compares result sets, at zero LLM cost. Run it per suite
(`world-cup`, `health-insurance`, `genomics`) before pointing an eval run at
the Databricks datasets; a wrong reference is worse than none, and this is
the same zero-cost check `docker/postgres/README.md`'s "Regenerating a
fixture" section uses for the Postgres side.

## Known limits

- **Untested against a live workspace** (see the warning above). The DDL
  emission, type mapping, literal formatting/batching and view translation
  are unit-tested against real fixture data; the actual `DBSQLClient`
  connection, execution and `--register` are not.
- View translation is best-effort, not a SQL parser — it handles the seven
  views these three fixtures actually define (`FILTER`, `::cast`,
  double-quoted reserved words) and flags what it cannot confidently
  translate (an unmatched `FILTER`, `ILIKE`, date/time arithmetic). Read
  every generated `views-*.sql` file before applying it.
- Money/decimal columns with no captured Postgres precision/scale map to a
  generic `DECIMAL(38,6)` — check this against the source column
  (`docker/postgres/init/*.sql`) if a downstream calculation needs the exact
  original precision.
- Re-running the loader on the same catalog uses `CREATE OR REPLACE TABLE` —
  it overwrites, it does not merge or incrementally update.
