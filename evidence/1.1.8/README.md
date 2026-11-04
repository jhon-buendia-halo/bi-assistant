# Evidence for 1.1.8 — Databricks fixtures and sets (Step 2, BA-186)

Branch `feat/BA-9-golden-dataset-evals`, 2026-10-13. **Built here without a warehouse; the warehouse runs are done later in the team's VDI** (decided 2026-10-13; runbook `docs/evals/databricks-vdi.md`).

- Loader `npm run fixture:databricks -- --fixture <world-cup|finance|marketing-analytics>`: dump to Databricks tables in any catalog, row-count check, registration in a running backend.
- Fixtures `world-cup-databricks`, `finance-databricks`, `marketing-analytics-databricks` (register-only); the preflight accepts the kind; the Testing Data panel refuses to load it and names the script.
- Databricks references for every PostgreSQL reference of World Cup (5), the golden set (11), finance (59) and marketing analytics (42), plus the 10-question Databricks-only set; references are written with the catalog `evals` and run in the datasource's catalog (R148).

| File | What it shows |
|---|---|
| `databricks-loader-dry-run-*.txt` | The SQL the loader would run, per sample. |
| `databricks-loader-sql-check.txt` | The dry-run SQL parsed as Databricks SQL (sqlglot) and run on DuckDB: row counts equal the dumps. |
| `references-databricks-*.txt`, `databricks-only-references.txt` | Every Databricks reference passing the static dialect checks and, through DuckDB, returning the PostgreSQL rows. Not executed on Databricks. |
| `databricks-unit-tests.txt` | The loader, registration, preflight and catalog-rewrite unit tests. |

**Not verified here:** loading on a real warehouse, the validator on Databricks, runs from the Evals tab and the CLI, cold and warm timing.
