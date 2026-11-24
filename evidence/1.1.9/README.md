# Evidence for 1.1.9 — REST connector cases (Step 3, BA-187)

Branch `feat/BA-9-golden-dataset-evals`, 2026-10-13.

- The local REST API takes switches (paging `page | offset | cursor | next-url`, page size, a nested endpoint, rows under another key, a refused endpoint, a bearer token, a `connector` profile) and serves finance and marketing analytics from their dumps.
- `setup-fixture-rest.ts` registers one datasource per variant and per sample, signs in by itself in local mode (the 401 on `main` is fixed), and sizes page and row caps so every row is read.
- SQLite references for every PostgreSQL reference of World Cup, the golden set, finance and marketing analytics (117, each returning exactly the PostgreSQL rows), and the 12-question REST connector set.

| File | What it shows |
|---|---|
| `setup-*.txt` | Registering each variant and sample. |
| `row-counts-plain-rest-datasources.txt` | Every endpoint read whole through the connector. |
| `validator-world-cup-rest-connector.txt` | The connector set: 11 of 11 references on page, offset and cursor; 6 of 11 on next-url (the connector cannot follow a next-page URL). |
| `validator-rest-fixtures.txt` | `world-cup-rest` 5/5, `world-cup-golden-rest` 11/11, `finance-rest` 59/59, `marketing-analytics-rest` 42/42. |
| `references-sqlite-*.txt` | Each SQLite reference against its PostgreSQL reference. |
| `references-vs-postgres-and-ba11-repros.txt` | Seven connector bug candidates for BA-11, each with a one-line reproduction. Filed on 2026-10-27 as five bugs under BA-11: [BA-246](https://halo-powered.atlassian.net/browse/BA-246) (repros 1 to 3), [BA-247](https://halo-powered.atlassian.net/browse/BA-247) (repro 4), [BA-248](https://halo-powered.atlassian.net/browse/BA-248) (repros 5 and 6), [BA-249](https://halo-powered.atlassian.net/browse/BA-249) (repro 7). The datasource label the runs showed is [BA-250](https://halo-powered.atlassian.net/browse/BA-250). Fixed on the branch `fix/BA-11-bug-fixes` (roadmap 1.7.21 to 1.7.25). |
| `../runs-2026-10-13/world-cup-rest-connector-cursor.*`, `finance-rest.*`, `marketing-analytics-rest.*` | Real runs (judge off). |

**Open before Done:** the DIGS and RSS endpoints of the RFP demo checked against the switch list in writing (their API documents are not in the repository).
