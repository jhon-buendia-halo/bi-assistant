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
| `references-vs-postgres-and-ba11-repros.txt` | Seven connector bug candidates for BA-11, each with a one-line reproduction. **Not filed yet** (needs the user's go-ahead). |
| `../runs-2026-10-13/world-cup-rest-connector-cursor.*`, `finance-rest.*`, `marketing-analytics-rest.*` | Real runs (judge off). |

**Open before Done:** the BA-11 bugs filed; the DIGS and RSS endpoints of the RFP demo checked against the switch list in writing (their API documents are not in the repository).
