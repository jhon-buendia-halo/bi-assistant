# Sampling statement timings (story 1.22.1, live timing first)

- **Date:** 2026-11-11
- **Method:** scratch Node script using `pg` and `@databricks/sql` directly (not the backend profilers), PostgreSQL inside `BEGIN READ ONLY`, SELECT and metadata statements only, 3 runs each, 60 s cap per statement, values fetched in full (PostgreSQL as raw text). Timings are client wall-clock including network.
- **PostgreSQL:** local sample server on 127.0.0.1:55432 (World Cup and US Health sample databases).
- **Databricks:** the user's workspace, SQL warehouse already configured in the app, `samples` catalog (the only catalog with tables; `workspace` is empty).
- **Caveat on Databricks runs:** run 1 is cold, runs 2 and 3 are served warm (warehouse and result caches), so the median hides the cold cost. The gate below is judged on **run 1**.

## PostgreSQL

| Table | Estimate (`reltuples`) | Statement | Runs (ms) | Median | Rows |
|---|---|---|---|---|---|
| `world_cup.players` | -1 (never analyzed = unknown) | `SELECT c.reltuples::bigint ... FROM pg_class` | 3, 1, 1 | 1 | 1 |
| `world_cup.players` | unknown, so tier `limit` | `SELECT * FROM "world_cup"."players" LIMIT 1000` | 2, 1, 1 | 1 | 50 |
| `world_cup.players` | (reference) | `SELECT COUNT(*) FROM "world_cup"."players"` | 1, 0, 0 | 0 | 1 |
| `us_health.medical_claims` (largest) | 348,950 | pg_class estimate | 1, 1, 1 | 1 | 1 |
| `us_health.medical_claims` | 348,950, p = 0.4299 | `SELECT * FROM "us_health"."medical_claims" TABLESAMPLE BERNOULLI (0.4299) REPEATABLE (7) LIMIT 1000` | 146, 75, 7 | 75 | 1000 |
| `us_health.medical_claims` | (comparison) | same with `TABLESAMPLE SYSTEM (0.4299)` | 4, 3, 3 | 3 | 1000 |
| `us_health.medical_claims` | (fallback) | `SELECT * ... LIMIT 1000` | 3, 3, 3 | 3 | 1000 |
| `us_health.medical_claims` | (reference) | `SELECT COUNT(*)` | 43, 10, 9 | 10 | 1 |

Other US Health tables by `reltuples`: `rx_claims` 156,774, `survey_responses` 105,568, `enrollments` 21,924, `members` 18,225.

## Databricks (`samples` catalog)

| Table | Rows (COUNT) | Statement | Runs (ms) | Median | Rows returned |
|---|---|---|---|---|---|
| `samples.tpch.region` (small) | 5 | `SELECT COUNT(*) AS n FROM ...` (what `rowCount()` runs) | 1693, 339, 308 | 339 | 1 |
| | | `DESCRIBE DETAIL` (single run: 534 ms; numFiles 1, sizeInBytes 1,833) | 534 | | |
| | | full tier `SELECT * ... LIMIT 1000` | 1265, 330, 311 | 330 | 5 |
| `samples.tpch.orders` | 7,500,000 | COUNT(*) | 889, 297, 326 | 326 | 1 |
| | | `DESCRIBE DETAIL` (single run: 420 ms; 3 files, 188,534,438 bytes) | 420 | | |
| | | ``TABLESAMPLE (0.02 PERCENT) REPEATABLE (7) LIMIT 1000`` | 2546, 420, 418 | 420 | 1000 |
| | | `LIMIT 1000` | 551, 307, 297 | 307 | 1000 |
| `samples.tpch.lineitem` (plan's large table) | 29,999,795 | COUNT(*) | 909, 294, 327 | 327 | 1 |
| | | `DESCRIBE DETAIL` (single run: 390 ms; 10 files, 753,837,113 bytes) | 390 | | |
| | | ``SELECT * FROM `samples`.`tpch`.`lineitem` TABLESAMPLE (0.0051 PERCENT) REPEATABLE (7) LIMIT 1000`` | 3598, 468, 458 | 468 | 1000 |
| | | `LIMIT 1000` | 617, 386, 404 | 404 | 1000 |
| `samples.tpch_sf1000.lineitem` (extreme, 160 GB) | 5,999,989,709 | COUNT(*) | 2205, 297, 284 | 297 | 1 |
| | | `DESCRIBE DETAIL` (single run: 375 ms; 2,470 files, 160,349,373,524 bytes) | 375 | | |
| | | ``TABLESAMPLE (0.0001 PERCENT) REPEATABLE (7) LIMIT 1000`` | **52251**, 5767, 5616 | 5767 | 1000 |
| | | `LIMIT 1000` | 1579, 314, 300 | 314 | 1000 |

Warm-up `SELECT 1`: 294 ms.

## Verdict against the plan gate

Gate: Databricks `TABLESAMPLE (p PERCENT)` over 15 s on the large table means switching that tier to `LIMIT`.

- **`samples.tpch.lineitem` (30 M rows, the plan's named table): PASS.** Cold 3.6 s, warm 0.46 s, 1000 rows returned.
- **`samples.tpch_sf1000.lineitem` (6 B rows, 160 GB): FAIL on a cold run.** 52 s cold (above both the gate and the app's 15 s statement timeout, which would turn it into `error`), 5.7 s warm. `LIMIT 1000` stays at 1.6 s cold.
- PostgreSQL: every statement is under 150 ms. No change needed.

Recommendation: keep `TABLESAMPLE` for Databricks, but add a size guard on the Databricks tier. For tables above a threshold (for example sizeInBytes over about 50 GB or more than about 1 B rows, from `DESCRIBE DETAIL`), use `LIMIT` (method `limit`). Without it, a table of that size times out at the 15 s budget and ends with `error` and `sampledRows: 0`.

## Findings that differ from plan section 2.1

1. Databricks `rowCount()` is a plain `COUNT(*)` in `databricks-profiling.ts` (line 68), not Delta metadata as plan table section 1 says. It was cheap here (about 0.3 s warm, 0.9 to 2.2 s cold, even at 6 B rows, because Delta answers COUNT from file statistics), but it is not "metadata". `DESCRIBE DETAIL` gives `sizeInBytes` and `numFiles` in 0.4 to 0.5 s but no row count.
2. PostgreSQL `world_cup.players` has `reltuples = -1` (never analyzed), so the plan's "unknown" tier fires: `LIMIT 1000`, method `limit`, even for a 50-row table. Correct per the plan, but the UI chip will read "First 1,000 rows (sampling not supported here)" for tables that were simply never analyzed. Consider treating `-1` as a prompt to try `LIMIT` and label it `full` when fewer rows than the limit come back.
3. PostgreSQL BERNOULLI on 349 k rows is slower than SYSTEM and LIMIT on the first run (146 ms vs 4 ms and 3 ms) because it scans every page. Still far below any budget.
4. Sampling returned the full 1000 rows in every tier, and no TABLESAMPLE syntax error occurred. Views were not tested: `samples` held no views among the tables listed, so the TABLESAMPLE-on-view fallback is unverified live.
5. The very small `p` values the formula yields on large tables (0.0001 percent on 6 B rows) were accepted by Databricks and returned 1000 rows.
