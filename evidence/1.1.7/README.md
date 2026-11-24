# Evidence for 1.1.7 — Domain databases (Step 1d, BA-185)

Branch `feat/BA-9-golden-dataset-evals`, 2026-10-13. Synthetic data written by Claude; no business review (decided 2026-10-13).

| Domain | Questions | Held out | PostgreSQL references | Source |
|---|---|---|---|---|
| Finance | 68 | 20 | 59 | the branch's banking domain extended to finance and wealth (15 tables, 2 views) |
| Marketing analytics | 50 | 16 | 42 | new, with 4 governance questions |
| Health insurance | 42 | 14 | 33 | `feat/engine-eval-loop`, as is |
| Genomics | 49 | 16 | 40 | `feat/engine-eval-loop`, as is |
| Supply chain | 20 | 6 | 17 | `feat/engine-eval-loop`, as is |

| File | What it shows |
|---|---|
| `references-<domain>.txt` | Every reference run on the loaded fixture (validator output plus rows), each returning rows, finance and marketing analytics checked against their planted `facts.json`, every trap query returning different rows. |
| `conversion.txt` | How the branch's 16 categories map onto the 18. |
| `dump-finance.txt`, `dump-marketing-analytics.txt` | The gzipped dumps (0.44 MB and 0.16 MB), every relation's row count equal to PostgreSQL. |
| `../runs-2026-10-13/finance-postgres.*`, `marketing-analytics-postgres.*` | The baseline run of each new domain (judge off). |

Known limit: the domains have no knowledge seed yet (the branch's seeding touched wiring `main` rewrote), so business-term and default-filter questions rely on the schema alone.
