# M1-31 — Excel and CSV files as datasources

- **Roadmap:** Milestone 1.31 · **Status:** Confirmed (2026-11-17: the user picked DuckDB ("Let's use DuckDB"), agreed to copy files into the app, a 200 MB cap per file and Data Readiness and synthetic data out of the first version, then picked option B, the review dialog, "Let's go with your recommendation".)

## Goal

A user uploads Excel workbooks (`.xlsx`) and CSV files as a datasource, confirms how each sheet reads (header row, range, a trailing total row, column types), builds datasets from the sheets, and asks the agents questions answered with SQL over them, with the same query evidence as any database.

## Scope

- The `file` datasource kind ("Excel / CSV"): its DuckDB connector and importer (1.31.1); the DuckDB `excel` extension shipped in the installer, the CLI and development (1.31.2); upload, preview and storage of files (1.31.3); the form with the review dialog (1.31.4); the `duckdb` dialect in the agents (1.31.5); allow-list refusals in Data Readiness, synthetic data and Consumption Gap, and explicit errors where an unknown kind falls back silently today (1.31.6); the World Cup Excel sample and the E2E (1.31.7).

## Out of scope

- Data Readiness, synthetic data and Consumption Gap Analysis on file datasources (each refuses them with a clear message).
- `.xls`, password-protected workbooks, macros, several tables in one sheet found automatically (the range picks one), live links to the original file, writing back to a workbook, Google Sheets.

## Stories

| Story | What | Status |
|---|---|---|
| 1.31.1 | DuckDB connector and importer for the `file` kind | Planned |
| 1.31.2 | The `excel` extension ships with the app | Planned |
| 1.31.3 | Upload, preview and storage of files | Planned |
| 1.31.4 | The Excel / CSV form and the review dialog | Planned |
| 1.31.5 | The `duckdb` dialect in the agents | Planned |
| 1.31.6 | Allow-list refusals and no silent fallbacks | Planned |
| 1.31.7 | World Cup Excel sample and E2E | Planned |

## Specs touched

- [datasources](../../capabilities/datasources/spec.md) R1, R30, R33–R37, R52 and new rules for the kind; [datasets](../../capabilities/datasets/spec.md) R6; [data-readiness](../../capabilities/data-readiness/spec.md), [synthetic-data](../../capabilities/synthetic-data/spec.md), [workflows](../../capabilities/workflows/spec.md) (the refusals); [testing-data](../../capabilities/testing-data/spec.md); [api.md](../../system/api.md) 2.2 (156–158); [data-model.md](../../system/data-model.md) 3.1 and the data dir layout; [delivery.md](../../system/delivery.md) (the extension in the build); [ui.md](../../system/ui.md) (the form and the dialog); [agents.md](../../system/agents.md) (the dialect); [architecture.md](../../system/architecture.md) ADR-0052.

## Acceptance

- On the web target with the LLM stub: uploading the World Cup Excel sample's workbook and CSV proposes their sheets, flags the title row and the total row, the review dialog changes the header row and the range, Import and check passes, Save stores the datasource, a dataset picks its sheets, and an agent's query over them answers with its evidence in the query inspector (page, filter, sort).
- A query that reads another file (`read_csv('<path>')`) or writes is refused; the app makes no request to `extensions.duckdb.org`.
- The Windows installer imports an `.xlsx` with the network off.
- Data Readiness and synthetic data refuse an Excel / CSV datasource with the message of the plan.
- The assistant's and the two workflows' eval sets pass on the branch as on the base (the agents' prompts change).

## Dependencies, risks and open questions

- Plan and contract: [docs/plans/m1-31-excel-csv-datasources.md](../../../docs/plans/m1-31-excel-csv-datasources.md). Decision: ADR-0052.
- Risk: DuckDB's type detection reads a column's type from its first data row; the review dialog shows the types and offers Read every column as text.
- Risk: the extension must match DuckDB's version exactly; a build check guards it.
- Data Readiness on file datasources is a candidate follow-up: DuckDB's SQL is close to PostgreSQL's, so most of the PostgreSQL profiling queries should carry over.
